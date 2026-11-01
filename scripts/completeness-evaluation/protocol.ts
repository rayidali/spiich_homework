import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { Decimal } from '../../shared/money';
import type { CompletenessCase, CompletenessRoute, EvaluationSplit } from './types';

/** Prepared limits, not authorization. Live execution also requires a separately
 * approved private permit bound to the final source and an unused workflow run. */
export const PROTOCOL = {
  version: 'daybook-completeness-comparison-v1',
  cohort: 'completeness-20261101-v1',
  repository: 'rayidali/spiich_homework',
  workflow: 'completeness-evaluation.yml',
  model: 'gemini-3.5-flash-lite',
  routes: ['composable', 'adaptive', 'complete'],
  families: ['common', 'discovery', 'arithmetic', 'boundary'],
  prices: {
    inputUsdPerMillion: '0.30',
    outputUsdPerMillion: '2.50',
    checkedAt: '2026-10-31',
    source: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite',
    thinkingIncludedInOutput: true,
    serviceTier: 'standard',
  },
  phases: {
    development: { cases: 4, executions: 12, maxAttempts: 32, ceilingUsd: '0.20' },
    holdout: { cases: 16, executions: 48, maxAttempts: 128, ceilingUsd: '0.70' },
  },
  maximumRequestBytes: 256 * 1024,
  maximumOutputTokens: 4000,
  totalCeilingUsd: '0.90',
  totalMaxAttempts: 160,
  adoption: {
    minimumAdditionalCompleteAnswers: 2,
    wrongFinancialClaimsAllowed: 0,
    hardBoundaryViolationsAllowed: 0,
    commonQueryRegressionsAllowed: 0,
    requiredBoundaryPasses: 4,
    familywiseAlpha: 0.05,
    correction: 'holm_two_candidate_comparisons',
    statisticalImprovementRequired: true,
    inconclusiveAction: 'retain_composable',
  },
} as const;

export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const phaseNames = ['development', 'holdout'] as const;
export const attemptsForRoute = (route: CompletenessRoute) => (route === 'composable' ? 2 : 3);
function requireValue(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`COMPLETENESS_${code}`);
}
function snapshot(root: string, excludeHoldout: boolean) {
  const paths: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      requireValue(!entry.isSymbolicLink(), 'SOURCE_SYMLINK');
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|json|sql)$/.test(path)) paths.push(path);
    }
  };
  for (const directory of [
    'server',
    'shared',
    'db/migrations',
    'scripts/completeness-evaluation',
    'tests/completeness-evaluation',
  ])
    walk(directory);
  paths.push(
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'scripts/migrate.ts',
    '.github/workflows/completeness-evaluation.yml',
    '.github/workflows/ci.yml',
    'docs/research/COMPLETENESS_EVALUATION.md',
  );
  const lateFiles = new Set([
    'scripts/completeness-evaluation/fixtures/holdout.json',
    'scripts/completeness-evaluation/fixtures/holdout-worked-totals.json',
    'scripts/completeness-evaluation/freeze.json',
  ]);
  const files = Object.fromEntries(
    paths
      .filter((path) => !excludeHoldout || !lateFiles.has(path))
      .sort()
      .map((path) => {
        const full = join(root, path);
        requireValue(lstatSync(full).isFile() && !lstatSync(full).isSymbolicLink(), 'SOURCE_FILE_INVALID');
        return [path, sha256(readFileSync(full))];
      }),
  );
  return { hash: sha256(JSON.stringify(files)), files };
}
export const evaluationSource = (root = process.cwd()) => snapshot(resolve(root), false);
export const coreSource = (root = process.cwd()) => snapshot(resolve(root), true);

const freezeSchema = z.strictObject({
  version: z.literal('completeness-core-freeze-v1'),
  cohort: z.literal(PROTOCOL.cohort),
  coreHash: z.string().regex(hashPattern),
  createdAt: z.iso.datetime(),
  heldOutQuestionsAuthored: z.literal(false),
  sharedAiAuthorshipDisclosed: z.literal(true),
});
export function validateCoreFreeze(root = process.cwd()) {
  const raw = readFileSync(join(root, 'scripts/completeness-evaluation/freeze.json'));
  const frozen = freezeSchema.parse(JSON.parse(raw.toString('utf8')));
  requireValue(frozen.coreHash === coreSource(root).hash, 'CORE_CHANGED_AFTER_FREEZE');
  return { ...frozen, freezeSha256: sha256(raw) };
}

/** All six permutations repeat on sorted case IDs; routes share one case block.
 * No outcome-dependent ordering, retries or selective reruns are allowed. */
export function pairedSchedule(cases: CompletenessCase[], phase: EvaluationSplit) {
  const config = PROTOCOL.phases[phase];
  requireValue(
    cases.length === config.cases && new Set(cases.map((item) => item.id)).size === cases.length,
    'CASE_COUNT_OR_ID',
  );
  for (const family of PROTOCOL.families)
    requireValue(
      cases.filter((item) => item.family === family).length === (phase === 'development' ? 1 : 4),
      'FAMILY_COUNT',
    );
  requireValue(
    cases.every((item) => item.split === phase && /^[a-zA-Z0-9_-]{1,64}$/.test(item.id)),
    'CASE_SPLIT',
  );
  const permutations: CompletenessRoute[][] = [
    ['composable', 'adaptive', 'complete'],
    ['adaptive', 'complete', 'composable'],
    ['complete', 'composable', 'adaptive'],
    ['composable', 'complete', 'adaptive'],
    ['complete', 'adaptive', 'composable'],
    ['adaptive', 'composable', 'complete'],
  ];
  return [...cases]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((item, index) => permutations[index % permutations.length].map((route) => ({ item, route })));
}

export function validateRunEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const phase = env.COMPLETENESS_PHASE;
  requireValue(phaseNames.includes(phase as EvaluationSplit), 'PHASE_INVALID');
  requireValue(
    env.GITHUB_ACTIONS === 'true' &&
      env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      env.GITHUB_REPOSITORY === PROTOCOL.repository &&
      env.GITHUB_REF === 'refs/heads/main' &&
      env.GITHUB_RUN_ATTEMPT === '1' &&
      env.NODE_ENV === 'test' &&
      env.COMPLETENESS_COHORT === PROTOCOL.cohort &&
      commitPattern.test(env.GITHUB_SHA ?? '') &&
      env.GITHUB_SHA === env.COMPLETENESS_SOURCE_COMMIT &&
      hashPattern.test(env.COMPLETENESS_SOURCE_HASH ?? '') &&
      hashPattern.test(env.COMPLETENESS_APPROVAL_SHA256 ?? '') &&
      /^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? ''),
    'RUN_BINDING_INVALID',
  );
  if (phase === 'holdout')
    requireValue(
      /^[1-9]\d*$/.test(env.COMPLETENESS_DEVELOPMENT_RUN ?? '') &&
        env.COMPLETENESS_DEVELOPMENT_RUN !== env.GITHUB_RUN_ID,
      'DEVELOPMENT_RUN_REQUIRED',
    );
  else requireValue(!env.COMPLETENESS_DEVELOPMENT_RUN, 'UNEXPECTED_PREDECESSOR');
  return { phase: phase as EvaluationSplit, runId: env.GITHUB_RUN_ID!, sourceCommit: env.GITHUB_SHA! };
}

const permitSchema = z.strictObject({
  version: z.literal('completeness-private-approval-v1'),
  cohort: z.literal(PROTOCOL.cohort),
  sourceCommit: z.string().regex(commitPattern),
  sourceHash: z.string().regex(hashPattern),
  freezeSha256: z.string().regex(hashPattern),
  keySha256: z.string().regex(hashPattern),
  nonce: z.string().regex(/^[a-f0-9]{32}$/),
  approvedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  ceilings: z.strictObject({
    development: z.literal('0.20'),
    holdout: z.literal('0.70'),
    total: z.literal('0.90'),
  }),
  attempts: z.strictObject({ development: z.literal(32), holdout: z.literal(128), total: z.literal(160) }),
  authorization: z.literal('explicit_user_approval_recorded_by_operator'),
});
export function validatePermit(
  raw: string | undefined,
  expected: {
    approvalSha256: string;
    sourceCommit: string;
    sourceHash: string;
    freezeSha256: string;
  },
  now = Date.now(),
) {
  requireValue(
    typeof raw === 'string' && Buffer.byteLength(raw) <= 4096 && hashPattern.test(expected.approvalSha256),
    'APPROVAL_MISSING',
  );
  requireValue(sha256(raw) === expected.approvalSha256, 'APPROVAL_HASH_MISMATCH');
  let permit: z.infer<typeof permitSchema>;
  try {
    permit = permitSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error('COMPLETENESS_APPROVAL_INVALID');
  }
  requireValue(
    permit.sourceCommit === expected.sourceCommit &&
      permit.sourceHash === expected.sourceHash &&
      permit.freezeSha256 === expected.freezeSha256,
    'APPROVAL_SOURCE_MISMATCH',
  );
  const start = Date.parse(permit.approvedAt),
    end = Date.parse(permit.expiresAt);
  requireValue(
    Number.isFinite(now) && start <= now && now < end && end - start <= 7 * 86400000,
    'APPROVAL_TIME_INVALID',
  );
  return permit;
}

/** Read a completed predecessor only. No old cohort or allowance can be adopted. */
export function validateDevelopmentSummary(
  value: unknown,
  expected: {
    runId: string;
    sourceHash: string;
    sourceCommit: string;
    approvalSha256: string;
  },
) {
  const schema = z
    .object({
      version: z.literal(PROTOCOL.version),
      cohort: z.literal(PROTOCOL.cohort),
      phase: z.literal('development'),
      runId: z.string(),
      sourceCommit: z.string(),
      sourceHash: z.string(),
      finalSourceHash: z.string(),
      approvalSha256: z.string(),
      complete: z.literal(true),
      failure: z.null(),
      plannedExecutions: z.literal(12),
      completedExecutions: z.literal(12),
      initialFingerprint: z.object({ sha256: z.string().regex(hashPattern) }).passthrough(),
      finalFingerprint: z.object({ sha256: z.string().regex(hashPattern) }).passthrough(),
      budget: z.object({
        state: z.literal('closed'),
        attempts: z.number().int().min(1).max(32),
        knownUsd: z.string(),
        unknownReservedUsd: z.literal('0'),
        chargedUsd: z.string(),
        haltReason: z.null(),
        pending: z.literal(0),
        activeTrial: z.null(),
      }),
    })
    .passthrough();
  const parsed = schema.safeParse(value);
  requireValue(parsed.success, 'DEVELOPMENT_NOT_COMPLETE');
  const summary = parsed.data;
  requireValue(
    summary.runId === expected.runId &&
      summary.sourceHash === expected.sourceHash &&
      summary.finalSourceHash === expected.sourceHash &&
      summary.sourceCommit === expected.sourceCommit &&
      summary.approvalSha256 === expected.approvalSha256 &&
      summary.initialFingerprint.sha256 === summary.finalFingerprint.sha256,
    'DEVELOPMENT_BINDING_MISMATCH',
  );
  requireValue(
    /^\d+(?:\.\d+)?$/.test(summary.budget.chargedUsd) &&
      new Decimal(summary.budget.chargedUsd).lte(PROTOCOL.phases.development.ceilingUsd) &&
      new Decimal(summary.budget.chargedUsd).eq(summary.budget.knownUsd),
    'DEVELOPMENT_BUDGET_INVALID',
  );
  return summary;
}
