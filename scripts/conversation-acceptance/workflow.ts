import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  decryptArtifact,
  encryptArtifact,
  type ArtifactBinding,
} from '../completion-repair-evaluation/encrypted-artifact';
import {
  approvalSchema,
  requireCondition,
  safeCode,
  sha256,
  sourceBinding,
  verifyCommittedSource,
} from './protocol';
import { privateJson } from './runner';

const repository = 'rayidali/spiich_homework';
const workflow = 'conversation-acceptance.yml';
const privateDirectory = '.tools/conversation-workflow-private';
export type WorkflowBinding = {
  runId: string;
  cohort: string;
  sourceCommit: string;
  sourceHash: string;
  approvalHash: string;
  runName: string;
};
export function workflowBinding(env: NodeJS.ProcessEnv = process.env): WorkflowBinding {
  requireCondition(
    env.GITHUB_ACTIONS === 'true' &&
      env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      env.GITHUB_REPOSITORY === repository &&
      env.GITHUB_REF === 'refs/heads/main' &&
      env.GITHUB_WORKFLOW_REF === `${repository}/.github/workflows/${workflow}@refs/heads/main` &&
      env.GITHUB_RUN_ATTEMPT === '1' &&
      /^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') &&
      /^[a-f0-9]{40}$/.test(env.CONVERSATION_SOURCE_COMMIT ?? '') &&
      env.GITHUB_SHA === env.CONVERSATION_SOURCE_COMMIT &&
      /^[a-f0-9]{64}$/.test(env.CONVERSATION_SOURCE_HASH ?? '') &&
      /^[a-f0-9]{64}$/.test(env.CONVERSATION_APPROVAL_SHA256 ?? '') &&
      /^conversation-[a-z0-9-]{8,64}$/.test(env.CONVERSATION_COHORT ?? ''),
    'WORKFLOW_BINDING',
  );
  return {
    runId: env.GITHUB_RUN_ID!,
    cohort: env.CONVERSATION_COHORT!,
    sourceCommit: env.CONVERSATION_SOURCE_COMMIT!,
    sourceHash: env.CONVERSATION_SOURCE_HASH!,
    approvalHash: env.CONVERSATION_APPROVAL_SHA256!,
    runName: `conversation-acceptance/${env.CONVERSATION_COHORT}`,
  };
}
type WorkflowRun = {
  id: number;
  display_title: string;
  run_attempt: number;
  event: string;
  head_sha: string;
  head_branch: string;
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function runShape(value: unknown): value is WorkflowRun {
  return (
    object(value) &&
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    typeof value.display_title === 'string' &&
    typeof value.run_attempt === 'number' &&
    Number.isSafeInteger(value.run_attempt) &&
    value.run_attempt > 0 &&
    typeof value.event === 'string' &&
    typeof value.head_sha === 'string' &&
    typeof value.head_branch === 'string'
  );
}
export function assertEarliestRun(runs: unknown[], binding: WorkflowBinding) {
  requireCondition(
    runs.every(runShape) && new Set(runs.map((r) => (r as WorkflowRun).id)).size === runs.length,
    'HISTORY_SHAPE',
  );
  const matching = (runs as WorkflowRun[]).filter((run) => run.display_title === binding.runName);
  const current = matching.find((run) => String(run.id) === binding.runId);
  requireCondition(
    current &&
      current.run_attempt === 1 &&
      current.event === 'workflow_dispatch' &&
      current.head_sha === binding.sourceCommit &&
      current.head_branch === 'main',
    'CURRENT_RUN_MISMATCH',
  );
  requireCondition(
    matching.every((run) => BigInt(run.id) >= BigInt(binding.runId)),
    'COHORT_ALREADY_DISPATCHED',
  );
  return { matchingRuns: matching.length, earliestRunId: binding.runId };
}

async function boundedGitHubJson(response: Response) {
  requireCondition(response.ok, 'GITHUB_HTTP');
  const limit = 2 * 1024 * 1024;
  requireCondition(Number(response.headers.get('content-length') ?? 0) <= limit, 'GITHUB_BODY_LIMIT');
  const reader = response.body?.getReader();
  requireCondition(reader, 'GITHUB_BODY');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      requireCondition(total <= limit, 'GITHUB_BODY_LIMIT');
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
export async function fetchWorkflowHistory(
  token: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
) {
  requireCondition(token.length > 0 && !/[\r\n\0]/.test(token), 'GITHUB_TOKEN');
  let total: number | undefined;
  const runs: WorkflowRun[] = [];
  const seen = new Set<number>();
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
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      },
    );
    const data = await boundedGitHubJson(response);
    requireCondition(
      object(data) &&
        Number.isSafeInteger(data.total_count) &&
        Number(data.total_count) >= 0 &&
        Number(data.total_count) <= 1000 &&
        Array.isArray(data.workflow_runs) &&
        data.workflow_runs.length <= 100 &&
        data.workflow_runs.every(runShape),
      'HISTORY_SHAPE',
    );
    if (total === undefined) total = Number(data.total_count);
    requireCondition(total === data.total_count, 'HISTORY_CHANGED');
    for (const run of data.workflow_runs as WorkflowRun[]) {
      requireCondition(!seen.has(run.id), 'HISTORY_DUPLICATE');
      seen.add(run.id);
      runs.push(run);
    }
    if (data.workflow_runs.length < 100) {
      requireCondition(
        runs.length === total && !(response.headers.get('link') ?? '').includes('rel="next"'),
        'HISTORY_TRUNCATED',
      );
      return runs;
    }
  }
  throw new Error('CONVERSATION_ACCEPTANCE_HISTORY_TRUNCATED');
}

export function encryptionPreflight(key: string, keyHash: string, binding: ArtifactBinding) {
  requireCondition(/^[a-f0-9]{64}$/.test(key) && sha256(key) === keyHash, 'ARTIFACT_KEY');
  const files = [
    {
      path: 'preflight.txt',
      data: Buffer.from('conversation-artifact-check').toString('base64'),
      sha256: sha256('conversation-artifact-check'),
    },
  ];
  requireCondition(
    JSON.stringify(decryptArtifact(encryptArtifact(files, key, binding), key, binding)) ===
      JSON.stringify(files),
    'ENCRYPTION_ROUNDTRIP',
  );
  return { passed: true, algorithm: 'AES-256-GCM', binding };
}
type ArchiveFile = { path: string; data: string; sha256: string };
function collect(directory: string) {
  const files: ArchiveFile[] = [];
  let size = 0;
  requireCondition(
    lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(),
    'ARCHIVE_DIRECTORY',
  );
  function walk(relative: string) {
    for (const name of readdirSync(join(directory, relative)).sort()) {
      requireCondition(/^[A-Za-z0-9_.-]+$/.test(name) && !['.', '..'].includes(name), 'ARCHIVE_PATH');
      const path = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(join(directory, path));
      requireCondition(!stat.isSymbolicLink(), 'ARCHIVE_SYMLINK');
      if (stat.isDirectory()) walk(path);
      else {
        requireCondition(stat.isFile(), 'ARCHIVE_FILE');
        const data = readFileSync(join(directory, path));
        size += data.length;
        requireCondition(size <= 128 * 1024 * 1024 && files.length < 9998, 'ARCHIVE_LIMIT');
        files.push({ path, data: data.toString('base64'), sha256: sha256(data) });
      }
    }
  }
  walk('');
  return files;
}
export function encryptedArchive(
  sourceDirectory: string,
  outputDirectory: string,
  key: string,
  keyHash: string,
  binding: ArtifactBinding,
  wrapperMetadata: Record<string, unknown>,
) {
  encryptionPreflight(key, keyHash, binding);
  const files = collect(sourceDirectory);
  const wrapper = Buffer.from(
    JSON.stringify({
      version: 'conversation-encrypted-wrapper-v1',
      codecReuse:
        'Unchanged AES256GCM codec; phase development is encoding metadata, not a reopened historical cohort.',
      ...wrapperMetadata,
    }),
  );
  requireCondition(
    !files.some((f) => f.path === 'conversation-wrapper-receipt.json'),
    'ARCHIVE_WRAPPER_COLLISION',
  );
  files.push({
    path: 'conversation-wrapper-receipt.json',
    data: wrapper.toString('base64'),
    sha256: sha256(wrapper),
  });
  const envelope = encryptArtifact(files, key, binding);
  requireCondition(
    JSON.stringify(decryptArtifact(envelope, key, binding)) === JSON.stringify(files),
    'ENCRYPTION_ROUNDTRIP',
  );
  const bytes = Buffer.from(JSON.stringify(envelope) + '\n');
  mkdirSync(outputDirectory, { mode: 0o700 });
  writeFileSync(join(outputDirectory, 'artifact.json'), bytes, { mode: 0o600, flag: 'wx' });
  const receipt = {
    version: 'conversation-encrypted-receipt-v1',
    encrypted: true,
    algorithm: 'AES-256-GCM',
    ...binding,
    archiveSha256: sha256(bytes),
    archiveBytes: bytes.length,
  };
  privateJson(join(outputDirectory, 'receipt.json'), receipt);
  return receipt;
}

export function validateWorkflowPermit(raw: string, binding: WorkflowBinding, now = Date.now()) {
  requireCondition(Buffer.byteLength(raw) <= 8192 && sha256(raw) === binding.approvalHash, 'APPROVAL_HASH');
  const permit = approvalSchema.parse(JSON.parse(raw));
  requireCondition(
    permit.sourceCommit === binding.sourceCommit &&
      permit.sourceHash === binding.sourceHash &&
      permit.cohort === binding.cohort &&
      permit.databaseName === 'daybook_conversation_live',
    'PERMIT_WORKFLOW_MISMATCH',
  );
  const start = Date.parse(permit.approvedAt),
    end = Date.parse(permit.expiresAt);
  requireCondition(start <= now && now < end && end - start <= 48 * 3600000, 'APPROVAL_TIME');
  return permit;
}
export async function workflowCommand(command: string) {
  const binding = workflowBinding();
  const raw = process.env.CONVERSATION_PRIVATE_APPROVAL ?? '';
  // Encryption must still preserve failures after approval expires; it sends no model request.
  const permit = validateWorkflowPermit(
    raw,
    binding,
    command === 'encrypt' ? Date.parse(JSON.parse(raw).approvedAt) : Date.now(),
  );
  const artifactBinding: ArtifactBinding = {
    sourceCommit: binding.sourceCommit,
    runId: binding.runId,
    phase: 'development',
  };
  if (command === 'encrypt') {
    const source = join('.tools/conversation-acceptance-runs', binding.cohort);
    if (!existsSync(source)) return;
    // Carry the provider-free run and encryption checks inside the same private
    // envelope; the upload directory never receives these plaintext records.
    for (const name of ['preflight.json', 'authorization.json']) {
      const path = join(privateDirectory, name);
      if (existsSync(path)) {
        requireCondition(
          lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && lstatSync(path).size <= 32768,
          'WORKFLOW_RECEIPT',
        );
        privateJson(join(source, `workflow-${name}`), JSON.parse(readFileSync(path, 'utf8')));
      }
    }
    const receipt = encryptedArchive(
      source,
      '.tools/conversation-encrypted',
      process.env.CONVERSATION_ARTIFACT_KEY ?? '',
      permit.artifactKeySha256,
      artifactBinding,
      { binding, approvalHash: binding.approvalHash, sourceHash: binding.sourceHash, cohort: binding.cohort },
    );
    console.log(JSON.stringify(receipt));
    return;
  }
  const source = sourceBinding();
  requireCondition(source.hash === binding.sourceHash, 'SOURCE_DRIFT');
  verifyCommittedSource(process.cwd(), binding.sourceCommit, source);
  mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  requireCondition(!lstatSync(privateDirectory).isSymbolicLink(), 'PRIVATE_DIRECTORY');
  if (command === 'preflight') {
    const result = encryptionPreflight(
      process.env.CONVERSATION_ARTIFACT_KEY ?? '',
      permit.artifactKeySha256,
      artifactBinding,
    );
    privateJson(join(privateDirectory, 'preflight.json'), {
      ...result,
      binding,
      artifactKeySha256: permit.artifactKeySha256,
    });
    console.log(JSON.stringify({ encryptionPreflightPassed: true }));
    return;
  }
  const preflight = JSON.parse(readFileSync(join(privateDirectory, 'preflight.json'), 'utf8'));
  requireCondition(
    preflight.passed === true &&
      preflight.artifactKeySha256 === permit.artifactKeySha256 &&
      JSON.stringify(preflight.binding) === JSON.stringify(binding),
    'PREFLIGHT_BINDING',
  );
  if (command === 'authorize') {
    const runs = await fetchWorkflowHistory(process.env.GH_TOKEN ?? '');
    const result = assertEarliestRun(runs, binding);
    privateJson(join(privateDirectory, 'authorization.json'), { binding, historyRuns: runs.length, result });
    writeFileSync(join(privateDirectory, 'approval.json'), raw, { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ unusedCohortVerified: true, runId: binding.runId }));
    return;
  }
  requireCondition(command === 'run', 'WORKFLOW_COMMAND');
  const authorization = JSON.parse(readFileSync(join(privateDirectory, 'authorization.json'), 'utf8'));
  requireCondition(
    JSON.stringify(authorization.binding) === JSON.stringify(binding) &&
      authorization.result?.earliestRunId === binding.runId,
    'AUTHORIZATION_BINDING',
  );
  const { execute } = await import('./cli');
  const result = await execute(join(privateDirectory, 'approval.json'), binding.approvalHash);
  console.log(JSON.stringify(result));
  if (result.failure || !result.result?.executionComplete) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  workflowCommand(process.argv[2]).catch((error) => {
    console.error(safeCode(error));
    process.exitCode = 1;
  });
