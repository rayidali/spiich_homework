/** Offline recalibration of the one closed development artifact. Never imports the provider or database. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
import { loadCases } from './fixtures';
import { aggregatePairedScores, type ScoringContext } from './scoring';
import { scoreAdaptiveResponseV2 } from './scoring-v2';

const publicDirectory = 'docs/evidence/adaptive-runs/development-v1';
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const protectedPath = (path: string) =>
  /^(server\/|shared\/|db\/migrations\/|scripts\/adaptive-evaluation\/fixtures)/.test(path) ||
  [
    'scripts/adaptive-evaluation/scoring.ts',
    'scripts/adaptive-evaluation/transport.ts',
    'scripts/migrate.ts',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'docs/research/ADAPTIVE_EVALUATION.md',
  ].includes(path);

export async function calibrateDevelopment(directory: string) {
  const manifestPath = join(publicDirectory, 'predecessor.json');
  const predecessor = read(manifestPath);
  for (const [path, expected] of Object.entries(predecessor.artifactHashes)) {
    if (hash(readFileSync(join(directory, path))) !== expected) throw Error('CALIBRATION_INPUT_CHANGED');
  }
  const protectedFiles = Object.entries(predecessor.source.files).filter(([path]) => protectedPath(path));
  for (const [path, expected] of protectedFiles) {
    if (hash(readFileSync(path)) !== expected) throw Error('CALIBRATION_RUNTIME_CHANGED');
  }
  function inventory(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw Error('CALIBRATION_RUNTIME_SYMLINK');
      return entry.isDirectory() ? inventory(path) : /\.(ts|sql|json)$/.test(path) ? [path] : [];
    });
  }
  for (const path of ['server', 'shared', 'db/migrations', 'scripts/adaptive-evaluation/fixtures'].flatMap(
    inventory,
  )) {
    if (!(path in predecessor.source.files)) throw Error('CALIBRATION_RUNTIME_ADDED');
  }
  const run = read(join(directory, 'run.json'));
  const fixture = read(join(directory, 'fixture.json'));
  const context: ScoringContext = {
    organizationId: fixture.orgId,
    chart: fixture.chart,
    counterparties: fixture.counterparties,
  };
  const cases = loadCases('development');
  const trials = run.schedule.map(
    ({ caseId, route }: { caseId: string; route: 'composable' | 'adaptive' }) => {
      const item = cases.find((entry) => entry.id === caseId);
      if (!item) throw Error('CALIBRATION_CASE_MISSING');
      const saved = read(join(directory, 'trials', `${caseId}-${route}`, 'outcome.json'));
      if (saved.caseId !== caseId || saved.route !== route) throw Error('CALIBRATION_OUTCOME_MISMATCH');
      return { caseId, route, score: scoreAdaptiveResponseV2(item, saved.outcome, context) };
    },
  );
  if (
    trials.length !== 8 ||
    new Set(trials.map((trial: { caseId: string; route: string }) => `${trial.caseId}/${trial.route}`))
      .size !== 8
  )
    throw Error('CALIBRATION_INVENTORY');
  const resultsPath = join(publicDirectory, 'scores-v2.json');
  const resultsText = await format(
    JSON.stringify({
      version: 'adaptive-development-scores-v2',
      developmentRun: predecessor.runId,
      providerCalls: 0,
      trials,
      aggregate: aggregatePairedScores(cases, trials, 'development'),
      limitations: [
        'Post-development grader calibration on existing outputs; not new independent model evidence.',
      ],
    }),
    { parser: 'json', printWidth: 110 },
  );
  const scorerPath = 'scripts/adaptive-evaluation/scoring-v2.ts';
  const receipt = {
    version: 'adaptive-development-calibration-v2',
    cohort: predecessor.cohort,
    developmentRun: predecessor.runId,
    sourceCommit: predecessor.sourceCommit,
    sourceHash: predecessor.source.hash,
    predecessorManifestSha256: hash(readFileSync(manifestPath)),
    scorer: { version: 'v2', path: scorerPath, sha256: hash(readFileSync(scorerPath)) },
    results: { path: resultsPath, sha256: hash(resultsText), executions: trials.length },
    inputHashes: predecessor.artifactHashes,
    providerCalls: 0,
    runtimeAndFixtureUnchanged: true,
  };
  const receiptText = await format(JSON.stringify(receipt), { parser: 'json', printWidth: 110 });
  // Existing calibration receipts are never overwritten by a repeat invocation.
  writeFileSync(resultsPath, resultsText, { flag: 'wx' });
  writeFileSync(join(publicDirectory, 'calibration-v2.json'), receiptText, { flag: 'wx' });
  return {
    executions: trials.length,
    providerCalls: 0,
    resultsSha256: hash(resultsText),
    receiptSha256: hash(receiptText),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2];
  if (!directory) throw Error('Usage: calibrate.ts <retained-v1-development-artifact-directory>');
  console.log(JSON.stringify(await calibrateDevelopment(directory)));
}
