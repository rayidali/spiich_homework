import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { evaluationSource, PROTOCOL, validateRunEnvironment } from './protocol';

type Run = {
  id: number;
  display_title: string;
  head_sha: string;
  run_attempt: number;
  status: string;
  conclusion: string | null;
  event: string;
};
export function assertNoPreviousRun(runs: Run[], runId: string, phase: string) {
  const title = `adaptive-evaluation/${PROTOCOL.cohort}/${phase}`;
  if (runs.some((run) => run.display_title === title && String(run.id) !== runId))
    throw Error('EVALUATION_COHORT_ALREADY_DISPATCHED');
}
export function assertDevelopmentRun(run: Run, sourceCommit: string) {
  if (
    run.display_title !== `adaptive-evaluation/${PROTOCOL.cohort}/development` ||
    run.head_sha !== sourceCommit ||
    run.run_attempt !== 1 ||
    run.event !== 'workflow_dispatch' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  )
    throw Error('EVALUATION_DEVELOPMENT_NOT_COMPLETE');
}
export async function authorizeEvaluation() {
  const binding = validateRunEnvironment();
  const source = evaluationSource();
  if (source.hash !== process.env.EVALUATION_SOURCE_HASH) throw Error('EVALUATION_SOURCE_DRIFT');
  const token = process.env.GH_TOKEN;
  if (!token) throw Error('EVALUATION_GITHUB_AUTH_MISSING');
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
    if (!response.ok) throw Error('EVALUATION_GITHUB_CHECK_FAILED');
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw Error('EVALUATION_GITHUB_RESPONSE_TOO_LARGE');
    return JSON.parse(raw);
  }
  let complete = false;
  let observedCurrent = false;
  let observedDevelopment = false;
  for (let page = 1; page <= 20; page++) {
    const data = await get(
      `/workflows/${PROTOCOL.workflow}/runs?event=workflow_dispatch&per_page=100&page=${page}`,
    );
    if (!Array.isArray(data.workflow_runs)) throw Error('EVALUATION_GITHUB_RESPONSE_INVALID');
    assertNoPreviousRun(data.workflow_runs, binding.runId, binding.phase);
    const current = (data.workflow_runs as Run[]).find((run) => String(run.id) === binding.runId);
    if (
      (data.workflow_runs as Run[]).some((run) => String(run.id) === process.env.EVALUATION_DEVELOPMENT_RUN)
    )
      observedDevelopment = true;
    if (current) {
      if (
        current.head_sha !== binding.sourceCommit ||
        current.run_attempt !== 1 ||
        current.event !== 'workflow_dispatch' ||
        current.display_title !== `adaptive-evaluation/${PROTOCOL.cohort}/${binding.phase}`
      )
        throw Error('EVALUATION_CURRENT_RUN_MISMATCH');
      observedCurrent = true;
    }
    if (data.workflow_runs.length < 100) {
      complete = true;
      break;
    }
  }
  if (!complete || !observedCurrent) throw Error('EVALUATION_RUN_HISTORY_INCOMPLETE');
  if (binding.phase === 'holdout') {
    if (!observedDevelopment) throw Error('EVALUATION_DEVELOPMENT_WORKFLOW_MISMATCH');
    assertDevelopmentRun(await get(`/runs/${process.env.EVALUATION_DEVELOPMENT_RUN}`), binding.sourceCommit);
  }
  mkdirSync('.tools/adaptive-evaluation-output', { recursive: true, mode: 0o700 });
  writeFileSync(
    '.tools/adaptive-evaluation-output/authorization.json',
    JSON.stringify(
      {
        ...binding,
        sourceHash: source.hash,
        cohort: PROTOCOL.cohort,
        developmentRun: process.env.EVALUATION_DEVELOPMENT_RUN || null,
        recordedAt: new Date().toISOString(),
        providerCalls: 0,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    JSON.stringify({ authorized: true, phase: binding.phase, runId: binding.runId, sourceHash: source.hash }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  authorizeEvaluation().catch((error: unknown) => {
    const code =
      error instanceof Error && /^EVALUATION_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'EVALUATION_AUTHORIZATION_FAILED';
    console.error(JSON.stringify({ error: code }));
    process.exitCode = 1;
  });
}
