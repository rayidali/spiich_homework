import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Decimal } from '../../shared/money';
import {
  evaluationSource,
  PROTOCOL,
  validateCoreFreeze,
  validateDevelopmentSummary,
  validatePermit,
  validateRunEnvironment,
  sha256,
} from './protocol';
import { jsonFile, safeErrorCode, verifyArtifacts, writeEvidence } from './artifacts';
import { loadCases } from './fixtures';
import type { EvaluationSplit } from './types';

export type WorkflowRun = {
  id: number;
  display_title: string;
  head_sha: string;
  run_attempt: number;
  status: string;
  conclusion: string | null;
  event: string;
};
export const outputDirectory = '.tools/completeness-evaluation-output';
export const predecessorDirectory = '.tools/completeness-evaluation-predecessor';
export function assertNoPreviousRun(runs: WorkflowRun[], runId: string, phase: EvaluationSplit) {
  const title = `completeness-evaluation/${PROTOCOL.cohort}/${phase}`;
  if (runs.some((run) => run.display_title === title && String(run.id) !== runId))
    throw Error('COMPLETENESS_COHORT_ALREADY_DISPATCHED');
}
export function assertDevelopmentRun(run: WorkflowRun, expected: { runId: string; sourceCommit: string }) {
  if (
    String(run.id) !== expected.runId ||
    run.head_sha !== expected.sourceCommit ||
    run.display_title !== `completeness-evaluation/${PROTOCOL.cohort}/development` ||
    run.run_attempt !== 1 ||
    run.event !== 'workflow_dispatch' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  )
    throw Error('COMPLETENESS_DEVELOPMENT_NOT_COMPLETE');
}
export function verifyDevelopmentArtifact(
  directory: string,
  expected: {
    runId: string;
    sourceCommit: string;
    sourceHash: string;
    approvalSha256: string;
    freezeSha256: string;
    keySha256: string;
  },
) {
  const manifest = verifyArtifacts(directory);
  const summary = validateDevelopmentSummary(jsonFile(join(directory, 'summary.json')), expected);
  const rawTransportManifest = readFileSync(join(directory, 'transport/manifest.json'));
  const transportManifest = jsonFile(join(directory, 'transport/manifest.json')) as Record<string, unknown>;
  if (
    summary.freezeSha256 !== expected.freezeSha256 ||
    transportManifest.version !== 'completeness-evaluation-v1' ||
    transportManifest.model !== PROTOCOL.model ||
    transportManifest.expectedKeySha256 !== expected.keySha256 ||
    transportManifest.ceilingUsd !== '0.2' ||
    transportManifest.maxAttempts !== 32 ||
    transportManifest.inputUsdPerMillion !== PROTOCOL.prices.inputUsdPerMillion ||
    transportManifest.outputUsdPerMillion !== PROTOCOL.prices.outputUsdPerMillion ||
    transportManifest.maxOutputTokens !== PROTOCOL.maximumOutputTokens ||
    transportManifest.maxRequestBytes !== PROTOCOL.maximumRequestBytes ||
    transportManifest.maxResponseBytes !== 256 * 1024
  )
    throw Error('COMPLETENESS_DEVELOPMENT_MANIFEST_INVALID');
  const ledger = jsonFile(join(directory, 'transport/ledger.json')) as {
    version?: string;
    manifestSha256?: string;
    state?: string;
    haltReason?: string | null;
    trials?: Record<string, { state: string; route: string; caseId: string; maxAttempts: number }>;
    records?: { id: string; trial: string; state: string; costUsd: string | null }[];
  };
  if (
    ledger.version !== 'completeness-evaluation-v1' ||
    ledger.manifestSha256 !== sha256(rawTransportManifest) ||
    ledger.state !== 'closed' ||
    ledger.haltReason !== null ||
    !Array.isArray(ledger.records) ||
    !ledger.trials ||
    ledger.records.length !== summary.budget.attempts ||
    new Set(ledger.records.map((item) => item.id)).size !== ledger.records.length ||
    ledger.records.some((item) => item.state !== 'known' || !/^\d+(?:\.\d+)?$/.test(item.costUsd ?? ''))
  )
    throw Error('COMPLETENESS_DEVELOPMENT_LEDGER_INVALID');
  const cost = ledger.records.reduce((total, item) => total.plus(item.costUsd!), new Decimal(0));
  if (!cost.eq(summary.budget.chargedUsd)) throw Error('COMPLETENESS_DEVELOPMENT_COST_MISMATCH');
  const expectedTrials = loadCases('development').flatMap((item) =>
    PROTOCOL.routes.map((route) => ({ caseId: item.id, route, key: `${route}/${item.id}` })),
  );
  if (
    Object.keys(ledger.trials).length !== expectedTrials.length ||
    ledger.records.some((record) => !expectedTrials.some((item) => item.key === record.trial))
  )
    throw Error('COMPLETENESS_DEVELOPMENT_TRIALS_INVALID');
  for (const item of expectedTrials) {
    const trial = ledger.trials[item.key],
      records = ledger.records.filter((row) => row.trial === item.key);
    if (
      !trial ||
      trial.state !== 'finished' ||
      trial.caseId !== item.caseId ||
      trial.route !== item.route ||
      trial.maxAttempts !== (item.route === 'composable' ? 2 : 3) ||
      records.length > trial.maxAttempts
    )
      throw Error('COMPLETENESS_DEVELOPMENT_TRIALS_INVALID');
    const path = join(directory, 'trials', `${item.caseId}-${item.route}`);
    const outcome = jsonFile(join(path, 'outcome.json')) as { caseId?: string; route?: string };
    const score = jsonFile(join(path, 'score.json')) as { caseId?: string; split?: string };
    const before = jsonFile(join(path, 'before.json')) as { sha256?: string };
    const after = jsonFile(join(path, 'after.json')) as { sha256?: string };
    if (
      outcome.caseId !== item.caseId ||
      outcome.route !== item.route ||
      score.caseId !== item.caseId ||
      score.split !== 'development' ||
      before.sha256 !== summary.initialFingerprint.sha256 ||
      after.sha256 !== summary.initialFingerprint.sha256
    )
      throw Error('COMPLETENESS_DEVELOPMENT_TRIAL_BINDING');
  }
  return {
    runId: expected.runId,
    chargedUsd: cost.toString(),
    attempts: ledger.records.length,
    artifactSha256: manifest.sha256,
  };
}

export async function authorizeEvaluation() {
  const binding = validateRunEnvironment(),
    source = evaluationSource(),
    freeze = validateCoreFreeze();
  if (source.hash !== process.env.COMPLETENESS_SOURCE_HASH) throw Error('COMPLETENESS_SOURCE_DRIFT');
  const approvalSha256 = process.env.COMPLETENESS_APPROVAL_SHA256!;
  const permit = validatePermit(process.env.COMPLETENESS_PRIVATE_APPROVAL, {
    approvalSha256,
    sourceCommit: binding.sourceCommit,
    sourceHash: source.hash,
    freezeSha256: freeze.freezeSha256,
  });
  const token = process.env.GH_TOKEN;
  if (!token) throw Error('COMPLETENESS_GITHUB_AUTH_MISSING');
  const base = `https://api.github.com/repos/${PROTOCOL.repository}/actions`;
  async function get(path: string) {
    const response = await fetch(`${base}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('COMPLETENESS_GITHUB_CHECK_FAILED');
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw Error('COMPLETENESS_GITHUB_RESPONSE_TOO_LARGE');
    return JSON.parse(raw);
  }
  let complete = false,
    observedCurrent = false,
    observedDevelopment = false;
  for (let page = 1; page <= 20; page++) {
    const data = await get(
      `/workflows/${PROTOCOL.workflow}/runs?event=workflow_dispatch&per_page=100&page=${page}`,
    );
    if (!Array.isArray(data.workflow_runs)) throw Error('COMPLETENESS_GITHUB_RESPONSE_INVALID');
    const runs = data.workflow_runs as WorkflowRun[];
    assertNoPreviousRun(runs, binding.runId, binding.phase);
    const current = runs.find((run) => String(run.id) === binding.runId);
    if (runs.some((run) => String(run.id) === process.env.COMPLETENESS_DEVELOPMENT_RUN))
      observedDevelopment = true;
    if (current) {
      if (
        current.head_sha !== binding.sourceCommit ||
        current.run_attempt !== 1 ||
        current.event !== 'workflow_dispatch' ||
        current.display_title !== `completeness-evaluation/${PROTOCOL.cohort}/${binding.phase}`
      )
        throw Error('COMPLETENESS_CURRENT_RUN_MISMATCH');
      observedCurrent = true;
    }
    if (runs.length < 100) {
      complete = true;
      break;
    }
  }
  if (!complete || !observedCurrent) throw Error('COMPLETENESS_RUN_HISTORY_INCOMPLETE');
  let predecessor: ReturnType<typeof verifyDevelopmentArtifact> | null = null;
  if (binding.phase === 'holdout') {
    if (!observedDevelopment) throw Error('COMPLETENESS_DEVELOPMENT_WORKFLOW_MISMATCH');
    const expected = {
      runId: process.env.COMPLETENESS_DEVELOPMENT_RUN!,
      sourceCommit: binding.sourceCommit,
      sourceHash: source.hash,
      approvalSha256,
      freezeSha256: freeze.freezeSha256,
      keySha256: permit.keySha256,
    };
    assertDevelopmentRun(await get(`/runs/${expected.runId}`), expected);
    predecessor = verifyDevelopmentArtifact(predecessorDirectory, expected);
  }
  writeEvidence(join(outputDirectory, 'authorization.json'), {
    ...binding,
    sourceHash: source.hash,
    freezeSha256: freeze.freezeSha256,
    approvalSha256,
    cohort: PROTOCOL.cohort,
    predecessor,
    recordedAt: new Date().toISOString(),
    providerCalls: 0,
  });
  console.log(
    JSON.stringify({ authorized: true, phase: binding.phase, runId: binding.runId, sourceHash: source.hash }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  authorizeEvaluation().catch((error: unknown) => {
    console.error(JSON.stringify({ error: safeErrorCode(error) }));
    process.exitCode = 1;
  });
}
