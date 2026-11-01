import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Decimal } from '../../shared/money';

export const PREDECESSOR = {
  runId: '41256839576',
  sourceCommit: 'e0f21342e90c08ebe6f6152f587038ff4d283c28',
  sourceHash: '5339d774fb3c60dedd7ce985a234e82b2c0b7739b7005418620666cc2d9ccda3',
  chargedUsd: '0.0430523',
  attempts: 10,
  manifestPath: 'docs/evidence/adaptive-runs/development-v1/predecessor.json',
  manifestSha256: 'b19a5821da982fa46f236eb7dbdbc6276f418c3a8b7e5043cde7abd36af01ed7',
  calibrationPath: 'docs/evidence/adaptive-runs/development-v1/calibration-v2.json',
  resultsPath: 'docs/evidence/adaptive-runs/development-v1/scores-v2.json',
  scorerPath: 'scripts/adaptive-evaluation/scoring-v2.ts',
} as const;

export const PROTOCOL = {
  version: 'daybook-adaptive-comparison-v2-calibrated',
  cohort: 'adaptive-loop-20261031-v1',
  repository: 'rayidali/spiich_homework',
  workflow: 'adaptive-evaluation.yml',
  model: 'gemini-3.5-flash-lite',
  routes: ['composable', 'adaptive'],
  prices: {
    inputUsdPerMillion: '0.30',
    outputUsdPerMillion: '2.50',
    checkedAt: '2026-10-31',
    source: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite',
  },
  phases: {
    development: { cases: 4, executions: 8, maxAttempts: 20, ceilingUsd: '0.10' },
    holdout: { cases: 16, executions: 32, maxAttempts: 80, ceilingUsd: '0.40' },
  },
  maximumRequestBytes: 256 * 1024,
  maximumOutputTokens: 4000,
  totalCeilingUsd: '0.50',
  totalMaxAttempts: 100,
  scoringVersion: 'v2',
} as const;
export type EvaluationPhase = keyof typeof PROTOCOL.phases;
export type EvaluationRoute = (typeof PROTOCOL.routes)[number];
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** Hash the complete runtime, migrations, evaluator, protocol and workflow, without secrets or outputs. */
export function evaluationSource(root = process.cwd()) {
  const paths: string[] = [];
  function walk(directory: string) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw Error('EVALUATION_SOURCE_SYMLINK');
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|json|sql)$/.test(path)) paths.push(path);
    }
  }
  for (const directory of [
    'server',
    'shared',
    'db/migrations',
    'scripts/adaptive-evaluation',
    'tests/adaptive-evaluation',
  ])
    walk(directory);
  paths.push(
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'scripts/migrate.ts',
    '.github/workflows/adaptive-evaluation.yml',
    'docs/research/ADAPTIVE_EVALUATION.md',
    'docs/research/ADAPTIVE_EVALUATION_V2.md',
    PREDECESSOR.manifestPath,
    PREDECESSOR.calibrationPath,
    PREDECESSOR.resultsPath,
  );
  const files = Object.fromEntries(
    paths.sort().map((path) => [path, sha256(readFileSync(join(root, path)))]),
  );
  return { hash: sha256(JSON.stringify(files)), files };
}

export function phaseValue(value: string | undefined): EvaluationPhase {
  if (value !== 'development' && value !== 'holdout') throw Error('EVALUATION_PHASE_INVALID');
  return value;
}

export function validateRunEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const phase = phaseValue(env.EVALUATION_PHASE);
  if (phase !== 'holdout') throw Error('EVALUATION_DEVELOPMENT_CLOSED');
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    env.GITHUB_REPOSITORY !== PROTOCOL.repository ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_RUN_ATTEMPT !== '1' ||
    env.EVALUATION_COHORT !== PROTOCOL.cohort ||
    env.NODE_ENV !== 'test' ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ||
    env.GITHUB_SHA !== env.EVALUATION_SOURCE_COMMIT ||
    !/^[a-f0-9]{64}$/.test(env.EVALUATION_SOURCE_HASH ?? '') ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '')
  )
    throw Error('EVALUATION_RUN_NOT_AUTHORIZED');
  if (env.EVALUATION_DEVELOPMENT_RUN !== PREDECESSOR.runId) throw Error('EVALUATION_DEVELOPMENT_REQUIRED');
  return { phase, sourceCommit: env.GITHUB_SHA!, runId: env.GITHUB_RUN_ID! };
}

type Json = Record<string, any>;
function requireBinding(condition: unknown, code: string): asserts condition {
  if (!condition) throw Error(`EVALUATION_${code}`);
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

export const CALIBRATION_CHANGED_PATHS: readonly string[] = [
  'scripts/adaptive-evaluation/protocol.ts',
  'scripts/adaptive-evaluation/authorize.ts',
  'scripts/adaptive-evaluation/cli.ts',
  'scripts/adaptive-evaluation/calibrate.ts',
  PREDECESSOR.scorerPath,
  'tests/adaptive-evaluation/protocol.test.ts',
  'tests/adaptive-evaluation/runner.test.ts',
  'tests/adaptive-evaluation/scoring-v2.test.ts',
  '.github/workflows/adaptive-evaluation.yml',
  'docs/research/ADAPTIVE_EVALUATION_V2.md',
  PREDECESSOR.manifestPath,
  PREDECESSOR.calibrationPath,
  PREDECESSOR.resultsPath,
];

/** Every production/runtime input, fixture and original accountant remains byte-identical.
 * New scoring, admission, tests and explanatory evidence are versioned separately. */
export function assertUnchangedInference(previous: Record<string, string>, current: Record<string, string>) {
  requireBinding(
    [...new Set([...Object.keys(previous), ...Object.keys(current)])].every(
      (path) => previous[path] === current[path] || CALIBRATION_CHANGED_PATHS.includes(path),
    ),
    'UNREVIEWED_SOURCE_CHANGE',
  );
  const immutable = (path: string) =>
    /^(server\/|shared\/|db\/migrations\/)/.test(path) ||
    [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'scripts/migrate.ts',
      'scripts/adaptive-evaluation/fixtures.ts',
      'scripts/adaptive-evaluation/transport.ts',
      'scripts/adaptive-evaluation/scoring.ts',
    ].includes(path) ||
    path.startsWith('scripts/adaptive-evaluation/fixtures/');
  const select = (files: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(files)
        .filter(([path]) => immutable(path))
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  const before = select(previous),
    after = select(current);
  requireBinding(
    Object.keys(before).length > 0 && canonical(before) === canonical(after),
    'INFERENCE_CHANGED',
  );
  return sha256(JSON.stringify(before));
}

/** Reject unknown, unfinished or repriced predecessor usage. Historical rows are only read. */
export function assertClosedDevelopment(ledger: Json, summary: Json, manifest: Json) {
  requireBinding(
    ledger.state === 'closed' &&
      ledger.haltReason === null &&
      Array.isArray(ledger.records) &&
      ledger.records.length === PREDECESSOR.attempts &&
      Object.keys(ledger.trials ?? {}).length === 8 &&
      Object.values(ledger.trials).every((t: any) => t.state === 'finished'),
    'PREDECESSOR_NOT_CLOSED',
  );
  let charged = new Decimal(0);
  for (const [index, record] of ledger.records.entries()) {
    const u = record.usage;
    requireBinding(
      record.id === String(index + 1).padStart(4, '0') &&
        record.state === 'known' &&
        u &&
        ['inputTokens', 'outputTokens', 'thinkingTokens', 'totalTokens'].every(
          (k) => Number.isSafeInteger(u[k]) && u[k] >= 0,
        ) &&
        u.inputTokens + u.outputTokens + u.thinkingTokens === u.totalTokens &&
        typeof record.costUsd === 'string' &&
        /^\d+(?:\.\d+)?$/.test(record.costUsd),
      'PREDECESSOR_USAGE_INVALID',
    );
    const price = new Decimal(u.inputTokens)
      .times('0.30')
      .plus(new Decimal(u.outputTokens + u.thinkingTokens).times('2.50'))
      .div(1e6);
    requireBinding(price.eq(record.costUsd), 'PREDECESSOR_PRICE_MISMATCH');
    charged = charged.plus(price);
  }
  requireBinding(
    charged.eq(PREDECESSOR.chargedUsd) &&
      manifest.model === PROTOCOL.model &&
      new Decimal(manifest.ceilingUsd).eq('0.10') &&
      manifest.maxAttempts === 20 &&
      new Decimal(manifest.inputUsdPerMillion).eq('0.30') &&
      new Decimal(manifest.outputUsdPerMillion).eq('2.50') &&
      manifest.maxOutputTokens === 4000 &&
      manifest.maxRequestBytes === PROTOCOL.maximumRequestBytes &&
      /^[a-f0-9]{64}$/.test(manifest.expectedKeySha256),
    'PREDECESSOR_BUDGET_MISMATCH',
  );
  requireBinding(
    summary.complete === true &&
      summary.failure === null &&
      summary.phase === 'development' &&
      summary.runId === PREDECESSOR.runId &&
      summary.sourceCommit === PREDECESSOR.sourceCommit &&
      summary.sourceHash === PREDECESSOR.sourceHash &&
      summary.finalSourceHash === PREDECESSOR.sourceHash &&
      summary.plannedExecutions === 8 &&
      summary.attemptedExecutions === 8 &&
      summary.completedExecutions === 8 &&
      canonical(summary.initialFingerprint) === canonical(summary.finalFingerprint) &&
      summary.initialFingerprint?.sha256 &&
      summary.budget?.state === 'closed' &&
      summary.budget.attempts === PREDECESSOR.attempts &&
      summary.budget.pending === 0 &&
      summary.budget.activeTrial === null &&
      summary.budget.haltReason === null &&
      summary.budget.unknownReservedUsd === '0' &&
      new Decimal(summary.budget.knownUsd).eq(charged) &&
      new Decimal(summary.budget.chargedUsd).eq(charged),
    'PREDECESSOR_SUMMARY_MISMATCH',
  );
  requireBinding(
    charged.plus(PROTOCOL.phases.holdout.ceilingUsd).lte(PROTOCOL.totalCeilingUsd) &&
      PREDECESSOR.attempts + PROTOCOL.phases.holdout.maxAttempts <= PROTOCOL.totalMaxAttempts,
    'CUMULATIVE_ALLOWANCE_EXCEEDED',
  );
}

export function assertCalibrationBinding(
  calibration: Json,
  results: Json,
  predecessor: Json,
  hashes: { predecessor: string; scorer: string; results: string },
) {
  requireBinding(
    calibration.version === 'adaptive-development-calibration-v2' &&
      calibration.cohort === PROTOCOL.cohort &&
      calibration.developmentRun === PREDECESSOR.runId &&
      calibration.sourceCommit === PREDECESSOR.sourceCommit &&
      calibration.sourceHash === PREDECESSOR.sourceHash &&
      calibration.predecessorManifestSha256 === hashes.predecessor &&
      calibration.scorer?.version === 'v2' &&
      calibration.scorer.path === PREDECESSOR.scorerPath &&
      calibration.scorer.sha256 === hashes.scorer &&
      calibration.results?.path === PREDECESSOR.resultsPath &&
      calibration.results.sha256 === hashes.results &&
      calibration.results.executions === 8 &&
      calibration.providerCalls === 0 &&
      calibration.runtimeAndFixtureUnchanged === true,
    'CALIBRATION_BINDING_MISMATCH',
  );
  const required = [
    'run.json',
    'summary.json',
    'fixture.json',
    'transport/ledger.json',
    'transport/manifest.json',
    ...[1, 2, 3, 4].flatMap((n) => PROTOCOL.routes.map((r) => `trials/D0${n}-${r}/outcome.json`)),
  ];
  requireBinding(
    calibration.inputHashes &&
      required.every((path) => calibration.inputHashes[path] === predecessor.artifactHashes[path]) &&
      Object.entries(calibration.inputHashes).every(
        ([path, hash]) => hash === predecessor.artifactHashes[path],
      ),
    'CALIBRATION_INPUT_MISMATCH',
  );
  const expected = pairedSchedule(
    [1, 2, 3, 4].map((n) => ({ id: `D0${n}`, split: 'development' as const })),
    'development',
  ).map(({ item, route }) => ({ caseId: item.id, route }));
  requireBinding(
    Array.isArray(results.trials) &&
      canonical(results.trials.map((t: Json) => ({ caseId: t.caseId, route: t.route }))) ===
        canonical(expected),
    'CALIBRATION_INVENTORY',
  );
}

export type DevelopmentCarry = {
  version: 'adaptive-development-carry-v2';
  runId: string;
  sourceCommit: string;
  sourceHash: string;
  chargedUsd: string;
  attempts: number;
  unknownReservedUsd: '0';
  calibrationSha256: string;
  predecessorManifestSha256: string;
  runtimeHash: string;
  expectedKeySha256: string;
};

/** Validate the downloaded original GitHub artifact before a new holdout-only allowance.
 * The returned key fingerprint belongs only in private authorization state. */
export function validatePredecessorEvidence(
  directory = '.tools/adaptive-evaluation-predecessor',
): DevelopmentCarry {
  try {
    const bound = (path: string) => {
      requireBinding(
        lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(),
        'PREDECESSOR_FILE_INVALID',
      );
      const bytes = readFileSync(path);
      return { value: JSON.parse(bytes.toString('utf8')), hash: sha256(bytes) };
    };
    const predecessor = bound(PREDECESSOR.manifestPath);
    requireBinding(predecessor.hash === PREDECESSOR.manifestSha256, 'PREDECESSOR_MANIFEST_CHANGED');
    const p = predecessor.value;
    requireBinding(
      p.runId === PREDECESSOR.runId &&
        p.sourceCommit === PREDECESSOR.sourceCommit &&
        p.source.hash === PREDECESSOR.sourceHash &&
        sha256(JSON.stringify(p.source.files)) === PREDECESSOR.sourceHash,
      'PREDECESSOR_SOURCE_MISMATCH',
    );
    const artifacts = new Map<string, Json>();
    const root = resolve(directory);
    for (const [name, expected] of Object.entries(p.artifactHashes)) {
      const path = resolve(root, name),
        rel = relative(root, path);
      requireBinding(Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel), 'PREDECESSOR_FILE_INVALID');
      const file = bound(path);
      requireBinding(file.hash === expected, 'PREDECESSOR_ARTIFACT_CHANGED');
      artifacts.set(name, file.value);
    }
    const manifest = artifacts.get('transport/manifest.json')!;
    assertClosedDevelopment(
      artifacts.get('transport/ledger.json')!,
      artifacts.get('summary.json')!,
      manifest,
    );
    const runtimeHash = assertUnchangedInference(p.source.files, evaluationSource().files);
    const calibration = bound(PREDECESSOR.calibrationPath),
      results = bound(PREDECESSOR.resultsPath);
    assertCalibrationBinding(calibration.value, results.value, p, {
      predecessor: predecessor.hash,
      scorer: sha256(readFileSync(PREDECESSOR.scorerPath)),
      results: results.hash,
    });
    return {
      version: 'adaptive-development-carry-v2',
      runId: PREDECESSOR.runId,
      sourceCommit: PREDECESSOR.sourceCommit,
      sourceHash: PREDECESSOR.sourceHash,
      chargedUsd: PREDECESSOR.chargedUsd,
      attempts: PREDECESSOR.attempts,
      unknownReservedUsd: '0',
      calibrationSha256: calibration.hash,
      predecessorManifestSha256: predecessor.hash,
      runtimeHash,
      expectedKeySha256: manifest.expectedKeySha256,
    };
  } catch (error) {
    if (error instanceof Error && /^EVALUATION_[A-Z_]+$/.test(error.message)) throw error;
    throw Error('EVALUATION_PREDECESSOR_INVALID');
  }
}

/** Alternate which route runs first; retain every paired case regardless of its result. */
export function pairedSchedule<T extends { id: string; split: EvaluationPhase }>(
  cases: T[],
  phase: EvaluationPhase,
) {
  const selected = cases.filter((item) => item.split === phase).sort((a, b) => a.id.localeCompare(b.id));
  if (
    selected.length !== PROTOCOL.phases[phase].cases ||
    new Set(cases.map((item) => item.id)).size !== cases.length
  )
    throw Error('EVALUATION_CASE_INVENTORY');
  return selected.flatMap((item, index) => {
    const routes = index % 2 ? [...PROTOCOL.routes].reverse() : [...PROTOCOL.routes];
    return routes.map((route) => ({ item, route }));
  });
}
