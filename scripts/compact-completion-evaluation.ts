import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Decimal } from '../shared/money';
import { evaluationSource as inheritedSource, sha256 } from './completion-repair-evaluation/protocol';
import { createEvaluationTransport } from './completion-repair-evaluation/transport';
import {
  decryptArtifact,
  encryptArtifact,
  type ArtifactBinding,
} from './completion-repair-evaluation/encrypted-artifact';
import {
  fixtureMessages,
  loadCases,
  seedFixtures,
  verifyCaseReferences,
} from './completeness-evaluation/fixtures';
import { scoreCompletenessResponse } from './completeness-evaluation/scoring';
import {
  analyzeCompleteness,
  renderCompletenessMarkdown,
  renderCompletenessSvg,
} from './completeness-evaluation/analysis';
import { pairedSchedule, attemptsForRoute } from './completeness-evaluation/protocol';
import {
  jsonFile,
  safeErrorCode,
  sealArtifacts,
  verifyArtifacts,
  writeEvidence,
} from './completeness-evaluation/artifacts';
import type {
  CompletenessCase,
  CompletenessOutcome,
  CompletenessRoute,
  CompletenessScore,
  EvaluationSplit,
} from './completeness-evaluation/types';

export const PROTOCOL = {
  version: 'compact-completion-comparison-v1',
  cohort: 'compact-completion-20261101-v1',
  repository: 'rayidali/spiich_homework',
  workflow: 'compact-completion-evaluation.yml',
  model: 'gemini-3.5-flash-lite',
  priorChargedUsd: '0.2983252',
  totalCeilingUsd: '0.49',
  approvedOverallCeilingUsd: '0.90',
  phases: {
    development: { executions: 3, maxAttempts: 9, ceilingUsd: '0.07' },
    holdout: { executions: 48, maxAttempts: 128, ceilingUsd: '0.42' },
  },
} as const;
const output = '.tools/compact-completion-output',
  predecessor = '.tools/compact-completion-predecessor';
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  commit = z.string().regex(/^[a-f0-9]{40}$/);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValue(value: unknown, code: string): asserts value {
  if (!value) throw Error(`COMPLETENESS_COMPACT_${code}`);
}
export function evaluationSource(root = process.cwd()) {
  const files = { ...inheritedSource(root).files };
  for (const path of [
    'scripts/compact-completion-evaluation.ts',
    'tests/compact-completion-evaluation.test.ts',
    'tests/completion-wire.test.ts',
    '.github/workflows/compact-completion-evaluation.yml',
    'docs/research/COMPACT_COMPLETION_EVALUATION.md',
    'docs/evidence/completion-repair-runs/development-v1/closure.json',
  ]) {
    const full = join(root, path);
    requireValue(lstatSync(full).isFile() && !lstatSync(full).isSymbolicLink(), 'SOURCE_FILE');
    files[path] = sha256(readFileSync(full));
  }
  const inherited = JSON.parse(
    readFileSync(join(root, 'scripts/completion-repair-evaluation/inherited-source.json'), 'utf8'),
  ) as { files: Record<string, string> };
  for (const [path, expected] of Object.entries(inherited.files))
    requireValue(files[path] === expected, 'INHERITED_CHANGED');
  const prior = JSON.parse(
    readFileSync(join(root, 'docs/evidence/completion-repair-runs/development-v1/closure.json'), 'utf8'),
  );
  requireValue(
    prior.status === 'PERMANENTLY_CLOSED_INCOMPLETE' && prior.overallChargedUsd === PROTOCOL.priorChargedUsd,
    'PRIOR_ACCOUNTING',
  );
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return { hash: sha256(JSON.stringify(sorted)), files: sorted };
}
const permitSchema = z.strictObject({
  version: z.literal('compact-completion-private-approval-v1'),
  cohort: z.literal(PROTOCOL.cohort),
  sourceCommit: commit,
  sourceHash: hash,
  keySha256: hash,
  artifactKeySha256: hash,
  nonce: z.string().regex(/^[a-f0-9]{32}$/),
  approvedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  priorChargedUsd: z.literal(PROTOCOL.priorChargedUsd),
  approvedOverallCeilingUsd: z.literal('0.90'),
  ceilings: z.strictObject({
    development: z.literal('0.07'),
    holdout: z.literal('0.42'),
    total: z.literal('0.49'),
  }),
  attempts: z.strictObject({ development: z.literal(9), holdout: z.literal(128), total: z.literal(137) }),
  authorization: z.literal('explicit_user_approval_recorded_by_operator'),
});
export function validatePermit(
  raw: string,
  expected: { approvalSha256: string; sourceCommit: string; sourceHash: string },
  now = Date.now(),
) {
  requireValue(Buffer.byteLength(raw) <= 4096 && sha256(raw) === expected.approvalSha256, 'APPROVAL_HASH');
  const permit = permitSchema.parse(JSON.parse(raw));
  requireValue(
    permit.sourceCommit === expected.sourceCommit && permit.sourceHash === expected.sourceHash,
    'APPROVAL_SOURCE',
  );
  const start = Date.parse(permit.approvedAt),
    end = Date.parse(permit.expiresAt);
  requireValue(start <= now && now < end && end - start <= 7 * 86400000, 'APPROVAL_TIME');
  return permit;
}
export function binding(env: NodeJS.ProcessEnv = process.env) {
  requireValue(['development', 'holdout'].includes(env.COMPACT_PHASE ?? ''), 'PHASE');
  requireValue(
    env.GITHUB_ACTIONS === 'true' &&
      env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      env.GITHUB_REPOSITORY === PROTOCOL.repository &&
      env.GITHUB_REF === 'refs/heads/main' &&
      env.GITHUB_RUN_ATTEMPT === '1' &&
      env.NODE_ENV === 'test' &&
      env.COMPACT_COHORT === PROTOCOL.cohort &&
      commit.safeParse(env.GITHUB_SHA).success &&
      env.GITHUB_SHA === env.COMPACT_SOURCE_COMMIT &&
      hash.safeParse(env.COMPACT_SOURCE_HASH).success &&
      hash.safeParse(env.COMPACT_APPROVAL_SHA256).success &&
      /^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? ''),
    'RUN_BINDING',
  );
  requireValue(
    env.COMPACT_PHASE === 'holdout'
      ? /^[1-9]\d*$/.test(env.COMPACT_DEVELOPMENT_RUN ?? '') &&
          env.COMPACT_DEVELOPMENT_RUN !== env.GITHUB_RUN_ID
      : !env.COMPACT_DEVELOPMENT_RUN,
    'PREDECESSOR',
  );
  return {
    phase: env.COMPACT_PHASE as EvaluationSplit,
    runId: env.GITHUB_RUN_ID!,
    sourceCommit: env.GITHUB_SHA!,
  };
}
function context() {
  const bound = binding(),
    source = evaluationSource();
  requireValue(source.hash === process.env.COMPACT_SOURCE_HASH, 'SOURCE_DRIFT');
  const approvalSha256 = process.env.COMPACT_APPROVAL_SHA256!;
  const permit = validatePermit(process.env.COMPACT_PRIVATE_APPROVAL ?? '', {
    approvalSha256,
    sourceCommit: bound.sourceCommit,
    sourceHash: source.hash,
  });
  return { ...bound, source, permit, approvalSha256 };
}
export function schedule(cases: CompletenessCase[], phase: EvaluationSplit) {
  if (phase === 'holdout') return pairedSchedule(cases, phase);
  const selected = ['D01', 'D02', 'D03'].map((id) => cases.find((item) => item.id === id));
  requireValue(
    selected.every((item) => item?.split === 'development') &&
      new Set(cases.map((item) => item.id)).size === cases.length,
    'SMOKE_CASES',
  );
  return selected.map((item) => ({ item: item!, route: 'complete' as const }));
}
export function hasValidatedFinancialPlan(response: unknown) {
  return (
    object(response) &&
    object(response.query) &&
    [
      'financial_analysis',
      'financial_scenario',
      'inspect_financial_data',
      'show_inspected_results',
      'calculate_from_inspection',
    ].includes(String(response.query.name))
  );
}
type Budget = ReturnType<ReturnType<typeof createEvaluationTransport>['summary']>;
type Cell = {
  caseId: string;
  route: CompletenessRoute;
  durationMs: number;
  attempts: number;
  knownUsd: string;
  unknownReservedUsd: string;
  validatedFinancialPlan: boolean;
  score: CompletenessScore;
};
export function operationallyComplete(value: {
  phase: EvaluationSplit;
  failure: string | null;
  trials: Pick<Cell, 'validatedFinancialPlan'>[];
  budget: Budget;
  sourceHash: string;
  finalSourceHash: string | null;
  initialFingerprint: unknown;
  finalFingerprint: unknown;
}) {
  const limits = PROTOCOL.phases[value.phase],
    b = value.budget;
  const decimal = (v: string) => /^\d+(?:\.\d+)?$/.test(v);
  const fp = value.initialFingerprint;
  return (
    !value.failure &&
    value.trials.length === limits.executions &&
    hash.safeParse(value.sourceHash).success &&
    value.sourceHash === value.finalSourceHash &&
    object(fp) &&
    Object.keys(fp).sort().join(',') === 'accounts,entries,lines,organizations,scope,sha256' &&
    ['accounts', 'entries', 'lines', 'organizations'].every(
      (key) => Number.isSafeInteger(fp[key]) && Number(fp[key]) >= 0,
    ) &&
    hash.safeParse(fp.sha256).success &&
    fp.scope === 'full_org_account_entry_line_rows' &&
    JSON.stringify(fp) === JSON.stringify(value.finalFingerprint) &&
    b.state === 'closed' &&
    b.pending === 0 &&
    b.activeTrial === null &&
    b.haltReason === null &&
    Number.isSafeInteger(b.attempts) &&
    b.attempts >= 0 &&
    b.attempts <= limits.maxAttempts &&
    [b.knownUsd, b.unknownReservedUsd, b.chargedUsd].every(decimal) &&
    new Decimal(b.knownUsd).plus(b.unknownReservedUsd).eq(b.chargedUsd) &&
    new Decimal(b.chargedUsd).lte(limits.ceilingUsd) &&
    (value.phase === 'holdout' || value.trials.some((item) => item.validatedFinancialPlan))
  );
}
export function assertUnusedPhase(
  runs: { id: number; display_title: string }[],
  runId: string,
  phase: EvaluationSplit,
) {
  requireValue(
    !runs.some(
      (run) =>
        run.display_title === `compact-completion-evaluation/${PROTOCOL.cohort}/${phase}` &&
        String(run.id) !== runId,
    ),
    'PHASE_USED',
  );
}
export function verifySmokeArtifact(
  directory: string,
  expected: {
    runId: string;
    sourceCommit: string;
    sourceHash: string;
    approvalSha256: string;
    keySha256: string;
  },
) {
  const manifest = verifyArtifacts(directory),
    summary = jsonFile(join(directory, 'summary.json')) as Record<string, unknown>;
  requireValue(
    summary.version === PROTOCOL.version &&
      summary.cohort === PROTOCOL.cohort &&
      summary.phase === 'development' &&
      summary.runId === expected.runId &&
      summary.sourceCommit === expected.sourceCommit &&
      summary.sourceHash === expected.sourceHash &&
      summary.approvalSha256 === expected.approvalSha256 &&
      summary.complete === true,
    'SMOKE_BINDING',
  );
  const trials = summary.trials as Cell[],
    budget = summary.budget as Budget;
  requireValue(
    Array.isArray(trials) &&
      trials.map((item) => `${item.caseId}/${item.route}`).join(',') ===
        'D01/complete,D02/complete,D03/complete',
    'SMOKE_CELLS',
  );
  requireValue(
    operationallyComplete({
      phase: 'development',
      failure: summary.failure as string | null,
      trials,
      budget,
      sourceHash: expected.sourceHash,
      finalSourceHash: summary.finalSourceHash as string | null,
      initialFingerprint: summary.initialFingerprint,
      finalFingerprint: summary.finalFingerprint,
    }),
    'SMOKE_INCOMPLETE',
  );
  const transport = jsonFile(join(directory, 'transport/manifest.json')) as Record<string, unknown>;
  requireValue(
    transport.version === 'completion-repair-evaluation-v1' &&
      transport.model === PROTOCOL.model &&
      transport.expectedKeySha256 === expected.keySha256 &&
      transport.ceilingUsd === '0.07' &&
      transport.maxAttempts === 9 &&
      transport.maxRequestBytes === 256 * 1024 &&
      transport.maxOutputTokens === 4000 &&
      transport.inputUsdPerMillion === '0.30' &&
      transport.outputUsdPerMillion === '2.50',
    'SMOKE_TRANSPORT',
  );
  const ledger = jsonFile(join(directory, 'transport/ledger.json')) as {
    version: string;
    state: string;
    haltReason: string | null;
    manifestSha256: string;
    records: { id: string; trial: string; state: string; costUsd: string | null; reservedUsd: string }[];
    trials: Record<string, { state: string }>;
  };
  requireValue(
    ledger.version === 'completion-repair-evaluation-v1' &&
      ledger.state === 'closed' &&
      ledger.haltReason === null &&
      ledger.manifestSha256 === sha256(readFileSync(join(directory, 'transport/manifest.json'))) &&
      ledger.records.length === budget.attempts &&
      new Set(ledger.records.map((row) => row.id)).size === ledger.records.length &&
      Object.keys(ledger.trials).sort().join(',') === 'complete/D01,complete/D02,complete/D03',
    'SMOKE_LEDGER',
  );
  let known = new Decimal(0),
    unknown = new Decimal(0);
  for (const record of ledger.records) {
    requireValue(
      Object.hasOwn(ledger.trials, record.trial) && ['known', 'unknown'].includes(record.state),
      'SMOKE_RECORD',
    );
    const amount = record.state === 'known' ? record.costUsd : record.reservedUsd;
    requireValue(typeof amount === 'string' && /^\d+(?:\.\d+)?$/.test(amount), 'SMOKE_COST');
    if (record.state === 'known') known = known.plus(amount);
    else unknown = unknown.plus(amount);
  }
  requireValue(
    known.eq(budget.knownUsd) &&
      unknown.eq(budget.unknownReservedUsd) &&
      known.plus(unknown).eq(budget.chargedUsd),
    'SMOKE_ACCOUNTING',
  );
  for (const cell of trials) {
    const path = join(directory, 'trials', `${cell.caseId}-${cell.route}`),
      before = jsonFile(join(path, 'before.json')),
      after = jsonFile(join(path, 'after.json'));
    const result = jsonFile(join(path, 'outcome.json')) as { outcome: CompletenessOutcome },
      score = jsonFile(join(path, 'score.json'));
    requireValue(
      JSON.stringify(before) === JSON.stringify(summary.initialFingerprint) &&
        JSON.stringify(after) === JSON.stringify(before) &&
        object(score) &&
        score.caseId === cell.caseId &&
        score.split === 'development' &&
        JSON.stringify(score) === JSON.stringify(cell.score) &&
        hasValidatedFinancialPlan(result.outcome.response) === cell.validatedFinancialPlan &&
        ledger.trials[`complete/${cell.caseId}`].state === 'finished' &&
        ledger.records.filter((row) => row.trial === `complete/${cell.caseId}`).length === cell.attempts &&
        cell.attempts <= 3,
      'SMOKE_CELL',
    );
  }
  return {
    runId: expected.runId,
    chargedUsd: budget.chargedUsd,
    attempts: budget.attempts,
    artifactSha256: manifest.sha256,
  };
}
async function authorize() {
  const c = context(),
    token = process.env.GH_TOKEN;
  requireValue(token, 'GITHUB_AUTH');
  async function get(path: string) {
    const response = await fetch(`https://api.github.com/repos/${PROTOCOL.repository}/actions${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    requireValue(response.ok, 'GITHUB_REQUEST');
    const text = await response.text();
    requireValue(Buffer.byteLength(text) < 4 * 1024 * 1024, 'GITHUB_SIZE');
    return JSON.parse(text);
  }
  let current = false,
    completeHistory = false;
  for (let page = 1; page <= 20; page++) {
    const data = await get(
      `/workflows/${PROTOCOL.workflow}/runs?event=workflow_dispatch&per_page=100&page=${page}`,
    );
    requireValue(Array.isArray(data.workflow_runs), 'GITHUB_SHAPE');
    assertUnusedPhase(data.workflow_runs, c.runId, c.phase);
    const run = data.workflow_runs.find((item: { id: number }) => String(item.id) === c.runId);
    if (run) {
      requireValue(
        run.head_sha === c.sourceCommit &&
          run.run_attempt === 1 &&
          run.event === 'workflow_dispatch' &&
          run.display_title === `compact-completion-evaluation/${PROTOCOL.cohort}/${c.phase}`,
        'CURRENT_RUN',
      );
      current = true;
    }
    if (data.workflow_runs.length < 100) {
      completeHistory = true;
      break;
    }
  }
  requireValue(current && completeHistory, 'HISTORY_INCOMPLETE');
  let prior = null;
  if (c.phase === 'holdout') {
    const runId = process.env.COMPACT_DEVELOPMENT_RUN!,
      run = await get(`/runs/${runId}`);
    requireValue(
      String(run.id) === runId &&
        run.head_sha === c.sourceCommit &&
        run.run_attempt === 1 &&
        run.event === 'workflow_dispatch' &&
        run.path === `.github/workflows/${PROTOCOL.workflow}` &&
        run.status === 'completed' &&
        run.conclusion === 'success' &&
        run.display_title === `compact-completion-evaluation/${PROTOCOL.cohort}/development`,
      'SMOKE_RUN',
    );
    prior = verifySmokeArtifact(predecessor, {
      runId,
      sourceCommit: c.sourceCommit,
      sourceHash: c.source.hash,
      approvalSha256: c.approvalSha256,
      keySha256: c.permit.keySha256,
    });
  }
  writeEvidence(join(output, 'authorization.json'), {
    phase: c.phase,
    runId: c.runId,
    sourceCommit: c.sourceCommit,
    sourceHash: c.source.hash,
    approvalSha256: c.approvalSha256,
    predecessor: prior,
  });
  console.log(JSON.stringify({ authorized: true, phase: c.phase, sourceHash: c.source.hash }));
}
function attemptsFor(trial: string) {
  const ledger = jsonFile(join(output, 'transport/ledger.json')) as {
    records: { id: string; trial: string; state: string; costUsd: string | null; reservedUsd: string }[];
  };
  return ledger.records
    .filter((row) => row.trial === trial)
    .map((row) => ({
      ...row,
      request: jsonFile(join(output, 'transport/attempts', row.id, 'request.json')),
      response: existsSync(join(output, 'transport/attempts', row.id, 'response.json'))
        ? jsonFile(join(output, 'transport/attempts', row.id, 'response.json'))
        : null,
    }));
}
async function runEvaluation() {
  const c = context(),
    authorization = jsonFile(join(output, 'authorization.json')) as Record<string, unknown>;
  requireValue(
    authorization.runId === c.runId &&
      authorization.phase === c.phase &&
      authorization.sourceCommit === c.sourceCommit &&
      authorization.sourceHash === c.source.hash &&
      authorization.approvalSha256 === c.approvalSha256,
    'AUTHORIZATION',
  );
  const prior =
    c.phase === 'holdout'
      ? verifySmokeArtifact(predecessor, {
          runId: process.env.COMPACT_DEVELOPMENT_RUN!,
          sourceCommit: c.sourceCommit,
          sourceHash: c.source.hash,
          approvalSha256: c.approvalSha256,
          keySha256: c.permit.keySha256,
        })
      : null;
  requireValue(JSON.stringify(prior) === JSON.stringify(authorization.predecessor), 'PREDECESSOR_CHANGED');
  const key = process.env.GEMINI_API_KEY?.trim();
  requireValue(
    key &&
      sha256(key) === c.permit.keySha256 &&
      process.env.AI_PROVIDER === 'gemini' &&
      process.env.AI_MODEL === PROTOCOL.model,
    'PROVIDER_BINDING',
  );
  const cases = loadCases(c.phase),
    cells = schedule(cases, c.phase),
    limits = PROTOCOL.phases[c.phase];
  for (const { item } of cells) verifyCaseReferences(item);
  requireValue(
    new Decimal(prior?.chargedUsd ?? '0').plus(limits.ceilingUsd).lte(PROTOCOL.totalCeilingUsd),
    'TOTAL_CAP',
  );
  writeEvidence(join(output, 'run.json'), {
    version: PROTOCOL.version,
    cohort: PROTOCOL.cohort,
    phase: c.phase,
    runId: c.runId,
    sourceCommit: c.sourceCommit,
    source: c.source,
    approvalSha256: c.approvalSha256,
    protocol: PROTOCOL,
    predecessor: prior,
    schedule: cells.map(({ item, route }) => ({ caseId: item.id, route })),
    inheritedScoringProtocol: 'daybook-completeness-comparison-v1',
    startedAt: new Date().toISOString(),
  });
  const transport = createEvaluationTransport({
    directory: join(output, 'transport'),
    model: PROTOCOL.model,
    apiKey: key,
    expectedKeySha256: c.permit.keySha256,
    ceilingUsd: limits.ceilingUsd,
    maxAttempts: limits.maxAttempts,
    inputUsdPerMillion: '0.30',
    outputUsdPerMillion: '2.50',
    maxRequestBytes: 256 * 1024,
  });
  let fixture: Awaited<ReturnType<typeof seedFixtures>> | undefined,
    restore: (() => void) | undefined,
    closePool: (() => Promise<void>) | undefined;
  let failure: string | null = null,
    finalFingerprint: unknown = null,
    finalSourceHash: string | null = null;
  const trials: Cell[] = [];
  try {
    fixture = await seedFixtures({
      ownerUrl: process.env.MIGRATION_DATABASE_URL ?? '',
      runtimeUrl: process.env.DATABASE_URL ?? '',
      confirmation: 'CREATE_ISOLATED_COMPLETENESS_FIXTURE',
    });
    writeEvidence(join(output, 'fixture.json'), {
      orgId: fixture.orgId,
      foreignOrgId: fixture.foreignOrgId,
      chart: fixture.chart,
      counterparties: fixture.counterparties,
      entryAliases: fixture.entryAliases,
      referenceChecks: fixture.referenceChecks,
      workedChecks: fixture.workedChecks,
      storedLineChecks: fixture.storedLineChecks,
      counts: fixture.counts,
      fingerprint: fixture.initialFingerprint,
    });
    restore = transport.install();
    const { config } = await import('../server/config'),
      { financialChat } = await import('../server/ai'),
      { pool } = await import('../server/db');
    closePool = () => pool.end();
    requireValue(
      config.aiProvider === 'gemini' &&
        config.aiModel === PROTOCOL.model &&
        config.aiKey === key &&
        config.databaseUrl === process.env.DATABASE_URL,
      'IMPORTED_CONFIG',
    );
    for (const { item, route } of cells) {
      requireValue(evaluationSource().hash === c.source.hash, 'SOURCE_DRIFT');
      const before = await fixture.fingerprint();
      requireValue(before.sha256 === fixture.initialFingerprint.sha256, 'BOOKS_CHANGED');
      const path = join(output, 'trials', `${item.id}-${route}`);
      writeEvidence(join(path, 'before.json'), before);
      transport.beginTrial({ caseId: item.id, route, maxAttempts: attemptsForRoute(route) });
      const started = performance.now(),
        outcome: CompletenessOutcome = {};
      try {
        outcome.response = await financialChat(fixture.orgId, fixtureMessages(item), { route });
      } catch (error) {
        outcome.error = { code: safeErrorCode(error) };
      } finally {
        transport.endTrial();
      }
      const durationMs = Math.round(performance.now() - started),
        attempts = attemptsFor(`${route}/${item.id}`);
      outcome.attempts = attempts;
      requireValue(!JSON.stringify(outcome).includes(key), 'CREDENTIAL_IN_OUTCOME');
      writeEvidence(join(path, 'outcome.json'), { caseId: item.id, route, durationMs, outcome });
      const after = await fixture.fingerprint();
      writeEvidence(join(path, 'after.json'), after);
      requireValue(
        before.sha256 === after.sha256 && evaluationSource().hash === c.source.hash,
        'BOOKS_OR_SOURCE_CHANGED',
      );
      const score = scoreCompletenessResponse(item, outcome, {
        organizationId: fixture.orgId,
        chart: fixture.chart,
        counterparties: fixture.counterparties,
        referenceLedgerClaim: fixture.referenceLedgerClaim,
      });
      writeEvidence(join(path, 'score.json'), score);
      trials.push({
        caseId: item.id,
        route,
        durationMs,
        attempts: attempts.length,
        knownUsd: attempts.reduce((sum, row) => sum.plus(row.costUsd ?? '0'), new Decimal(0)).toString(),
        unknownReservedUsd: attempts
          .filter((row) => row.state !== 'known')
          .reduce((sum, row) => sum.plus(row.reservedUsd), new Decimal(0))
          .toString(),
        validatedFinancialPlan: hasValidatedFinancialPlan(outcome.response),
        score,
      });
      writeEvidence(
        join(output, 'progress.json'),
        { completed: trials.length, planned: limits.executions, trials, budget: transport.summary() },
        false,
      );
      console.log(
        JSON.stringify({
          caseId: item.id,
          route,
          classification: score.classification,
          attempts: attempts.length,
        }),
      );
      requireValue(!transport.summary().haltReason, 'TRANSPORT_HALTED');
      requireValue(
        !outcome.error ||
          !['DATABASE_ERROR', 'DATABASE_UNAVAILABLE', 'COMPLETENESS_EXECUTION_FAILED'].includes(
            outcome.error.code,
          ),
        'INFRASTRUCTURE',
      );
    }
  } catch (error) {
    failure = safeErrorCode(error);
  } finally {
    try {
      restore?.();
    } catch {
      failure ??= 'COMPLETENESS_RESTORE_FAILED';
    }
    try {
      if (fixture) finalFingerprint = await fixture.fingerprint();
    } catch {
      failure ??= 'COMPLETENESS_FINAL_FINGERPRINT_FAILED';
    }
    try {
      await closePool?.();
    } catch {
      failure ??= 'COMPLETENESS_POOL_CLOSE_FAILED';
    }
    try {
      await fixture?.close();
    } catch {
      failure ??= 'COMPLETENESS_FIXTURE_CLOSE_FAILED';
    }
  }
  let budget: Budget;
  try {
    budget = transport.close();
  } catch {
    failure ??= 'COMPLETENESS_LEDGER_CLOSE_FAILED';
    budget = transport.summary();
  }
  try {
    finalSourceHash = evaluationSource().hash;
  } catch {
    failure ??= 'COMPLETENESS_FINAL_SOURCE_FAILED';
  }
  let complete = operationallyComplete({
    phase: c.phase,
    failure,
    trials,
    budget,
    sourceHash: c.source.hash,
    finalSourceHash,
    initialFingerprint: fixture?.initialFingerprint,
    finalFingerprint,
  });
  if (!complete)
    failure ??=
      c.phase === 'development' && trials.length === 3 && !trials.some((item) => item.validatedFinancialPlan)
        ? 'COMPLETENESS_SMOKE_NO_VALIDATED_PLAN'
        : 'COMPLETENESS_FINAL_INTEGRITY_FAILED';
  let aggregate: ReturnType<typeof analyzeCompleteness> | null = null;
  if (complete && c.phase === 'holdout') {
    try {
      aggregate = analyzeCompleteness({
        cases: cases.map(({ id, family }) => ({ id, family })),
        observations: trials,
      });
    } catch (error) {
      failure = safeErrorCode(error);
      complete = false;
    }
  }
  const comparisonCharged = new Decimal(prior?.chargedUsd ?? '0').plus(budget.chargedUsd);
  writeEvidence(join(output, 'summary.json'), {
    version: PROTOCOL.version,
    cohort: PROTOCOL.cohort,
    phase: c.phase,
    runId: c.runId,
    sourceCommit: c.sourceCommit,
    sourceHash: c.source.hash,
    finalSourceHash,
    approvalSha256: c.approvalSha256,
    complete,
    failure,
    plannedExecutions: limits.executions,
    completedExecutions: trials.length,
    trials,
    aggregate,
    budget,
    predecessor: prior,
    initialFingerprint: fixture?.initialFingerprint ?? null,
    finalFingerprint,
    cumulativeAccounting: {
      priorClosedChargesUsd: PROTOCOL.priorChargedUsd,
      comparisonChargedUsd: comparisonCharged.toString(),
      overallChargedUsd: comparisonCharged.plus(PROTOCOL.priorChargedUsd).toString(),
      approvedOverallCeilingUsd: '0.90',
      unusedPhaseAllowanceTransferred: false,
    },
    finishedAt: new Date().toISOString(),
  });
  if (aggregate) {
    writeFileSync(join(output, 'report.md'), renderCompletenessMarkdown(aggregate), {
      flag: 'wx',
      mode: 0o600,
    });
    writeFileSync(join(output, 'comparison.svg'), renderCompletenessSvg(aggregate), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  sealArtifacts(output);
  console.log(
    JSON.stringify({ phase: c.phase, complete, completedExecutions: trials.length, failure, budget }),
  );
  if (!complete) process.exitCode = 1;
}
function artifactCommand(command: string) {
  // Encryption must still preserve failures if the live source drifted after
  // authorization. Bind authenticated metadata to the original reviewed run.
  const c = binding(),
    key = process.env.COMPACT_ARTIFACT_KEY ?? '';
  const permitRaw = process.env.COMPACT_PRIVATE_APPROVAL ?? '';
  const permit = validatePermit(
    permitRaw,
    {
      approvalSha256: process.env.COMPACT_APPROVAL_SHA256!,
      sourceCommit: c.sourceCommit,
      sourceHash: process.env.COMPACT_SOURCE_HASH!,
    },
    command === 'encrypt' ? Date.parse(JSON.parse(permitRaw).approvedAt) : Date.now(),
  );
  requireValue(/^[a-f0-9]{64}$/.test(key) && sha256(key) === permit.artifactKeySha256, 'ARTIFACT_KEY');
  const bound: ArtifactBinding = { sourceCommit: c.sourceCommit, runId: c.runId, phase: c.phase };
  if (command === 'preflight') {
    requireValue(
      decryptArtifact(encryptArtifact([], key, bound), key, bound).length === 0,
      'ENCRYPTION_PREFLIGHT',
    );
    console.log(JSON.stringify({ encryptedArtifactPreflight: true }));
    return;
  }
  if (command === 'decrypt') {
    const path = '.tools/compact-completion-encrypted-predecessor/artifact.json';
    requireValue(
      lstatSync(path).isFile() &&
        !lstatSync(path).isSymbolicLink() &&
        lstatSync(path).size <= 512 * 1024 * 1024,
      'ARCHIVE_FILE',
    );
    const files = decryptArtifact(JSON.parse(readFileSync(path, 'utf8')), key, {
      sourceCommit: c.sourceCommit,
      runId: process.env.COMPACT_DEVELOPMENT_RUN!,
      phase: 'development',
    });
    mkdirSync(predecessor, { mode: 0o700 });
    for (const file of files) {
      const path = join(predecessor, file.path);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, Buffer.from(file.data, 'base64'), { flag: 'wx', mode: 0o600 });
    }
    return;
  }
  requireValue(command === 'encrypt', 'COMMAND');
  if (!existsSync(output)) return;
  const files: { path: string; data: string; sha256: string }[] = [];
  let bytes = 0;
  function collect(relative: string) {
    for (const file of readdirSync(join(output, relative), { withFileTypes: true })) {
      requireValue(!file.isSymbolicLink(), 'ARCHIVE_SYMLINK');
      const path = relative ? `${relative}/${file.name}` : file.name;
      if (file.isDirectory()) collect(path);
      else {
        requireValue(file.isFile(), 'ARCHIVE_FILE');
        const data = readFileSync(join(output, path));
        bytes += data.length;
        requireValue(bytes <= 256 * 1024 * 1024, 'ARCHIVE_SIZE');
        files.push({ path, data: data.toString('base64'), sha256: sha256(data) });
      }
    }
  }
  collect('');
  const archive = JSON.stringify(encryptArtifact(files, key, bound)) + '\n',
    directory = '.tools/compact-completion-encrypted';
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, 'artifact.json'), archive, { flag: 'wx', mode: 0o600 });
  writeEvidence(join(directory, 'receipt.json'), {
    ...bound,
    encrypted: true,
    algorithm: 'AES-256-GCM',
    archiveSha256: sha256(archive),
    archiveBytes: Buffer.byteLength(archive),
  });
  console.log(JSON.stringify({ encrypted: true, files: files.length, archiveSha256: sha256(archive) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  Promise.resolve()
    .then(() =>
      command === 'inspect'
        ? console.log(JSON.stringify({ protocol: PROTOCOL, source: evaluationSource() }))
        : command === 'authorize'
          ? authorize()
          : command === 'run'
            ? runEvaluation()
            : artifactCommand(command),
    )
    .catch((error) => {
      console.error(JSON.stringify({ error: safeErrorCode(error) }));
      process.exitCode = 1;
    });
}
