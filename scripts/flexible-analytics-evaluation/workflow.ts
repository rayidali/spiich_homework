import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertEarliestRun,
  encryptionPreflight,
  encryptedArchive,
  type WorkflowBinding,
} from '../conversation-acceptance/workflow';
import { privateJson } from '../conversation-acceptance/runner';
import { safeCode } from '../conversation-acceptance/protocol';
import {
  approvalSchema,
  preparation,
  sourceBinding,
  verifyCommittedSource,
  requireCondition,
  sha256,
} from './protocol';
const repository = 'rayidali/spiich_homework',
  workflow = 'flexible-analytics-evaluation.yml',
  privateBase = '.tools/flexible-workflow-private';
export function workflowBinding(env: NodeJS.ProcessEnv = process.env): WorkflowBinding {
  requireCondition(
    env.CI === 'true' &&
      env.GITHUB_ACTIONS === 'true' &&
      env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      env.GITHUB_REPOSITORY === repository &&
      env.GITHUB_REF === 'refs/heads/main' &&
      env.GITHUB_WORKFLOW_REF === `${repository}/.github/workflows/${workflow}@refs/heads/main` &&
      env.GITHUB_RUN_ATTEMPT === '1' &&
      /^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') &&
      /^[a-f0-9]{40}$/.test(env.FLEXIBLE_SOURCE_COMMIT ?? '') &&
      env.GITHUB_SHA === env.FLEXIBLE_SOURCE_COMMIT &&
      /^[a-f0-9]{64}$/.test(env.FLEXIBLE_SOURCE_HASH ?? '') &&
      /^[a-f0-9]{64}$/.test(env.FLEXIBLE_APPROVAL_SHA256 ?? '') &&
      /^flexible-[a-z0-9-]{8,64}$/.test(env.FLEXIBLE_COHORT ?? ''),
    'WORKFLOW_BINDING',
  );
  return {
    runId: env.GITHUB_RUN_ID!,
    cohort: env.FLEXIBLE_COHORT!,
    sourceCommit: env.FLEXIBLE_SOURCE_COMMIT!,
    sourceHash: env.FLEXIBLE_SOURCE_HASH!,
    approvalHash: env.FLEXIBLE_APPROVAL_SHA256!,
    runName: `flexible-analytics/${env.FLEXIBLE_COHORT}`,
  };
}
export async function history(fetchImpl: typeof fetch, token: string) {
  requireCondition(token.length > 0 && !/[\r\n\0]/.test(token), 'GITHUB_TOKEN');
  const runs: unknown[] = [];
  let total: number | undefined;
  for (let page = 1; page <= 10; page++) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs?per_page=100&page=${page}`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      },
    );
    requireCondition(response.ok, 'GITHUB_HTTP');
    const reader = response.body?.getReader();
    requireCondition(reader, 'GITHUB_BODY');
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        requireCondition(size <= 2 * 1024 * 1024, 'GITHUB_BODY_LIMIT');
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requireCondition(
      Number.isSafeInteger(data.total_count) &&
        data.total_count >= 0 &&
        data.total_count <= 1000 &&
        Array.isArray(data.workflow_runs) &&
        data.workflow_runs.length <= 100,
      'HISTORY_SHAPE',
    );
    total ??= data.total_count;
    requireCondition(total === data.total_count, 'HISTORY_CHANGED');
    runs.push(...data.workflow_runs);
    if (data.workflow_runs.length < 100) {
      requireCondition(
        runs.length === total && !(response.headers.get('link') ?? '').includes('rel="next"'),
        'HISTORY_TRUNCATED',
      );
      return runs;
    }
  }
  throw Error('CONVERSATION_ACCEPTANCE_HISTORY_TRUNCATED');
}
export async function command(name: string) {
  if (name === 'prepare') {
    console.log(JSON.stringify(preparation(), null, 2));
    return;
  }
  if (name === 'check-db') {
    requireCondition(process.env.NODE_ENV === 'test' && process.env.CI === 'true', 'CI_REQUIRED');
    const { seedDatabase } = await import('./database');
    const db = await seedDatabase(
      process.env.FLEXIBLE_OWNER_DATABASE_URL ?? '',
      process.env.FLEXIBLE_DATABASE_URL ?? '',
      'daybook_flexible_live',
    );
    try {
      console.log(
        JSON.stringify({
          storedLineChecks: db.storedLineChecks,
          oracleChecks: db.oracleChecks,
          booksUnchanged: (await db.fingerprint()).hash === db.before.hash,
        }),
      );
    } finally {
      await db.close();
    }
    return;
  }
  const binding = workflowBinding(),
    raw = process.env.FLEXIBLE_PRIVATE_APPROVAL ?? '';
  requireCondition(Buffer.byteLength(raw) <= 8192 && sha256(raw) === binding.approvalHash, 'APPROVAL_HASH');
  const permit = approvalSchema.parse(JSON.parse(raw));
  requireCondition(
    permit.sourceCommit === binding.sourceCommit &&
      permit.sourceHash === binding.sourceHash &&
      permit.cohort === binding.cohort,
    'PERMIT_WORKFLOW_MISMATCH',
  );
  const artifactBinding = {
    sourceCommit: binding.sourceCommit,
    runId: binding.runId,
    phase: 'development' as const,
  };
  if (name === 'encrypt') {
    const source = join('.tools/flexible-analytics-runs', binding.cohort);
    if (!existsSync(source)) return;
    for (const file of ['preflight.json', 'authorization.json']) {
      const path = join(privateBase, file);
      if (existsSync(path)) {
        requireCondition(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'WORKFLOW_RECEIPT');
        privateJson(join(source, `workflow-${file}`), JSON.parse(readFileSync(path, 'utf8')));
      }
    }
    console.log(
      JSON.stringify(
        encryptedArchive(
          source,
          '.tools/flexible-analytics-encrypted',
          process.env.FLEXIBLE_ARTIFACT_KEY ?? '',
          permit.artifactKeySha256,
          artifactBinding,
          {
            evaluation: 'flexible-analytics-v1',
            binding,
            approvalHash: binding.approvalHash,
            sourceHash: binding.sourceHash,
            cohort: binding.cohort,
          },
        ),
      ),
    );
    return;
  }
  const now = Date.now(),
    from = Date.parse(permit.approvedAt),
    to = Date.parse(permit.expiresAt);
  requireCondition(from <= now && now < to && to - from <= 48 * 3600000, 'APPROVAL_TIME');
  const source = sourceBinding();
  requireCondition(source.hash === binding.sourceHash, 'SOURCE_DRIFT');
  verifyCommittedSource(process.cwd(), binding.sourceCommit, source);
  mkdirSync(privateBase, { recursive: true, mode: 0o700 });
  requireCondition(!lstatSync(privateBase).isSymbolicLink(), 'PRIVATE_DIRECTORY');
  if (name === 'preflight') {
    const result = encryptionPreflight(
      process.env.FLEXIBLE_ARTIFACT_KEY ?? '',
      permit.artifactKeySha256,
      artifactBinding,
    );
    privateJson(join(privateBase, 'preflight.json'), {
      ...result,
      binding,
      artifactKeySha256: permit.artifactKeySha256,
    });
    console.log(JSON.stringify({ encryptionPreflightPassed: true }));
    return;
  }
  const preflight = JSON.parse(readFileSync(join(privateBase, 'preflight.json'), 'utf8'));
  requireCondition(
    preflight.passed === true &&
      preflight.artifactKeySha256 === permit.artifactKeySha256 &&
      JSON.stringify(preflight.binding) === JSON.stringify(binding),
    'PREFLIGHT_BINDING',
  );
  if (name === 'authorize') {
    const runs = await history(globalThis.fetch.bind(globalThis), process.env.GH_TOKEN ?? '');
    const result = assertEarliestRun(runs, binding);
    privateJson(join(privateBase, 'authorization.json'), { binding, result, historyRuns: runs.length });
    writeFileSync(join(privateBase, 'approval.json'), raw, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ unusedCohortVerified: true, runId: binding.runId }));
    return;
  }
  requireCondition(name === 'run', 'WORKFLOW_COMMAND');
  const authorization = JSON.parse(readFileSync(join(privateBase, 'authorization.json'), 'utf8'));
  requireCondition(
    JSON.stringify(authorization.binding) === JSON.stringify(binding) &&
      authorization.result.earliestRunId === binding.runId,
    'AUTHORIZATION_BINDING',
  );
  // Keep the exact approved bytes and their original hash identity.
  const privatePermit = join(privateBase, 'approval.json');
  requireCondition(
    JSON.stringify(JSON.parse(readFileSync(privatePermit, 'utf8'))) === JSON.stringify(permit),
    'PERMIT_CHANGED',
  );
  const { execute } = await import('./runner');
  const result = await execute(privatePermit, binding.approvalHash);
  console.log(JSON.stringify(result));
  if (result.status === 'STOPPED_INCOMPLETE') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  command(process.argv[2]).catch((error) => {
    console.error(safeCode(error));
    process.exitCode = 1;
  });
