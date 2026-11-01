import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const PROTOCOL = {
  version: 'daybook-adaptive-comparison-v1',
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
  if (phase === 'holdout' && !/^[1-9]\d*$/.test(env.EVALUATION_DEVELOPMENT_RUN ?? ''))
    throw Error('EVALUATION_DEVELOPMENT_REQUIRED');
  return { phase, sourceCommit: env.GITHUB_SHA!, runId: env.GITHUB_RUN_ID! };
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
