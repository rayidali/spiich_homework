import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertEarliestRun,
  encryptionPreflight,
  encryptedArchive,
  fetchWorkflowHistory,
  workflowBinding,
  validateWorkflowPermit,
} from '../scripts/conversation-acceptance/workflow';
import { sha256 } from '../scripts/conversation-acceptance/protocol';
import { decryptArtifact, encryptArtifact } from '../scripts/completion-repair-evaluation/encrypted-artifact';

const sourceCommit = 'c'.repeat(40);
const sourceHash = 'a'.repeat(64);
const approvalHash = 'b'.repeat(64);
const cohort = 'conversation-workflow-offline-tests';
const runName = `conversation-acceptance/${cohort}`;
const token = 'synthetic-not-a-github-token';
const key = 'ab'.repeat(32);
const now = Date.parse('2026-11-01T13:00:00Z');
const permit = () => ({
  version: 'conversation-acceptance-approval-v1',
  authorization: 'explicit_user_approval_recorded_by_operator',
  cohort,
  sourceCommit,
  sourceHash,
  keySha256: 'e'.repeat(64),
  artifactKeySha256: sha256(key),
  databaseName: 'daybook_conversation_live',
  approvedAt: '2026-11-01T12:00:00Z',
  expiresAt: '2026-11-02T12:00:00Z',
  model: 'gemini-3.5-flash-lite',
  route: 'composable',
  businessDate: '2026-11-01',
  maxRequests: 35,
  maxAttempts: 70,
  maxRequestBytes: 256 * 1024,
  maxOutputTokens: 4000,
  ceilingUsd: '0.20',
  inputUsdPerMillion: '0.30',
  outputUsdPerMillion: '2.50',
});
const env = (): NodeJS.ProcessEnv => ({
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'rayidali/spiich_homework',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: sourceCommit,
  GITHUB_WORKFLOW_REF:
    'rayidali/spiich_homework/.github/workflows/conversation-acceptance.yml@refs/heads/main',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_RUN_ID: '900',
  CONVERSATION_COHORT: cohort,
  CONVERSATION_SOURCE_COMMIT: sourceCommit,
  CONVERSATION_SOURCE_HASH: sourceHash,
  CONVERSATION_APPROVAL_SHA256: approvalHash,
});
const run = (id = 900, overrides: Record<string, unknown> = {}) => ({
  id,
  display_title: runName,
  run_attempt: 1,
  event: 'workflow_dispatch',
  head_sha: sourceCommit,
  head_branch: 'main',
  status: 'completed',
  conclusion: 'success',
  ...overrides,
});
const response = (total: number, runs: ReturnType<typeof run>[]) =>
  new Response(JSON.stringify({ total_count: total, workflow_runs: runs }), {
    headers: { 'content-type': 'application/json' },
  });

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});
function archiveFixture() {
  const root = mkdtempSync(join(tmpdir(), 'daybook-conversation-workflow-test-'));
  directories.push(root);
  const source = join(root, 'raw'),
    output = join(root, 'encrypted');
  mkdirSync(source);
  mkdirSync(join(source, 'outcomes'));
  const body = '{"answer":"private synthetic financial answer","provider":"private synthetic error"}';
  writeFileSync(join(source, 'outcomes', 'C01-1.json'), body);
  return { root, source, output, body };
}

describe('manual conversation workflow binding and first-run control (offline)', () => {
  it('binds the exact manual workflow, commit, cohort and approval digest', () => {
    expect(workflowBinding(env())).toEqual({
      runId: '900',
      cohort,
      sourceCommit,
      sourceHash,
      approvalHash,
      runName,
    });
  });

  it.each([
    ['GITHUB_ACTIONS', 'false'],
    ['GITHUB_EVENT_NAME', 'push'],
    ['GITHUB_REPOSITORY', 'someone/else'],
    ['GITHUB_REF', 'refs/heads/feature'],
    ['GITHUB_SHA', 'd'.repeat(40)],
    ['GITHUB_WORKFLOW_REF', 'rayidali/spiich_homework/.github/workflows/other.yml@refs/heads/main'],
    ['GITHUB_RUN_ATTEMPT', '2'],
    ['GITHUB_RUN_ID', 'not-a-run'],
    ['GITHUB_RUN_ID', '0'],
    ['CONVERSATION_COHORT', '../previous-cohort'],
    ['CONVERSATION_SOURCE_COMMIT', 'short'],
    ['CONVERSATION_SOURCE_HASH', 'short'],
    ['CONVERSATION_APPROVAL_SHA256', ''],
  ])('refuses mismatched or incomplete %s', (name, value) => {
    expect(() => workflowBinding({ ...env(), [name]: value })).toThrow();
  });

  it('permits the current earliest dispatch and ignores other cohorts', () => {
    expect(() =>
      assertEarliestRun(
        [run(10, { display_title: 'conversation-acceptance/another-cohort' }), run(901), run(900)],
        workflowBinding(env()),
      ),
    ).not.toThrow();
  });

  it.each(['success', 'failure', 'cancelled', null])(
    'an earlier same-cohort dispatch blocks a new run even with conclusion=%s',
    (conclusion) => {
      expect(() => assertEarliestRun([run(899, { conclusion }), run(900)], workflowBinding(env()))).toThrow();
    },
  );

  it.each([
    { run_attempt: 2 },
    { event: 'push' },
    { head_sha: 'd'.repeat(40) },
    { head_branch: 'other' },
    { display_title: 'conversation-acceptance/other' },
  ])('refuses a mismatched current history record %j', (change) => {
    expect(() => assertEarliestRun([run(900, change)], workflowBinding(env()))).toThrow();
  });

  it('fails closed when history lacks the current dispatch', () => {
    expect(() => assertEarliestRun([], workflowBinding(env()))).toThrow();
    expect(() => assertEarliestRun([run(899)], workflowBinding(env()))).toThrow();
  });
  it.each([900.5, -1, Number.MAX_SAFE_INTEGER + 1, '900'])(
    'rejects an unsafe or nonnumeric history run identity %s',
    (id) => {
      expect(() => assertEarliestRun([run(900, { id })], workflowBinding(env()))).toThrow();
    },
  );
});

describe('private approval binds the manual workflow inputs', () => {
  it('accepts the exact source, cohort, disposable database and valid approval digest', () => {
    const value = permit(),
      raw = JSON.stringify(value);
    const binding = { ...workflowBinding(env()), approvalHash: sha256(raw) };
    expect(validateWorkflowPermit(raw, binding, now)).toEqual(value);
  });
  it.each([
    { sourceCommit: 'd'.repeat(40) },
    { sourceHash: 'd'.repeat(64) },
    { cohort: 'conversation-another-cohort' },
    { databaseName: 'daybook_conversation_another' },
  ])('rejects a correctly hashed but differently scoped approval %j', (change) => {
    const raw = JSON.stringify({ ...permit(), ...change });
    const binding = { ...workflowBinding(env()), approvalHash: sha256(raw) };
    expect(() => validateWorkflowPermit(raw, binding, now)).toThrow('PERMIT_WORKFLOW_MISMATCH');
  });
  it('rejects a changed approval digest, expiration or not-yet-valid approval', () => {
    const raw = JSON.stringify(permit());
    const binding = { ...workflowBinding(env()), approvalHash: sha256(raw) };
    expect(() => validateWorkflowPermit(raw, { ...binding, approvalHash: '0'.repeat(64) }, now)).toThrow(
      'APPROVAL_HASH',
    );
    expect(() => validateWorkflowPermit(raw, binding, now + 3 * 86400000)).toThrow('APPROVAL_TIME');
    expect(() => validateWorkflowPermit(raw, binding, now - 2 * 3600000)).toThrow('APPROVAL_TIME');
  });
  it('requires an artifact key digest before a workflow can be authorized', () => {
    const value: Record<string, unknown> = permit();
    delete value.artifactKeySha256;
    const raw = JSON.stringify(value);
    expect(() =>
      validateWorkflowPermit(raw, { ...workflowBinding(env()), approvalHash: sha256(raw) }, now),
    ).toThrow();
  });
});

describe('complete bounded GitHub workflow history (synthetic fetch only)', () => {
  it('collects every page and uses only the fixed GitHub API endpoint', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => run(1000 + i));
    const page2 = Array.from({ length: 3 }, (_, i) => run(2000 + i));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(103, page1))
      .mockResolvedValueOnce(response(103, page2));
    const result = await fetchWorkflowHistory(token, fetch);
    expect(result).toEqual([...page1, ...page2]);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [index, call] of fetch.mock.calls.entries()) {
      const url = new URL(String(call[0]));
      expect(url.origin).toBe('https://api.github.com');
      expect(url.pathname).toBe(
        '/repos/rayidali/spiich_homework/actions/workflows/conversation-acceptance.yml/runs',
      );
      expect(url.searchParams.get('per_page')).toBe('100');
      expect(url.searchParams.get('page')).toBe(String(index + 1));
      expect(url.searchParams.has('event')).toBe(false);
      expect(new Headers(call[1]?.headers).get('authorization')).toContain(token);
    }
  });

  it('refuses a changing total_count instead of treating partial pages as complete', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(
          101,
          Array.from({ length: 100 }, (_, i) => run(1000 + i)),
        ),
      )
      .mockResolvedValueOnce(response(102, [run(2000)]));
    await expect(fetchWorkflowHistory(token, fetch)).rejects.toThrow();
  });

  it('refuses an empty final page when declared records are still missing', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(
          101,
          Array.from({ length: 100 }, (_, i) => run(1000 + i)),
        ),
      )
      .mockResolvedValueOnce(response(101, []));
    await expect(fetchWorkflowHistory(token, fetch)).rejects.toThrow();
  });

  it('refuses history that cannot fit within the ten-page boundary', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
      response(
        1001,
        Array.from({ length: 100 }, (_, i) => run(1000 + i)),
      ),
    );
    await expect(fetchWorkflowHistory(token, fetch)).rejects.toThrow();
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(10);
  });
  it('rejects a full tenth page even when GitHub reports exactly one thousand runs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
      const page = Number(new URL(String(input)).searchParams.get('page'));
      return response(
        1000,
        Array.from({ length: 100 }, (_, i) => run(page * 1000 + i)),
      );
    });
    await expect(fetchWorkflowHistory(token, fetch)).rejects.toThrow();
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(10);
  });
  it('rejects duplicate entries across pages rather than declaring complete history', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(
          101,
          Array.from({ length: 100 }, (_, i) => run(1000 + i)),
        ),
      )
      .mockResolvedValueOnce(response(101, [run(1000)]));
    await expect(fetchWorkflowHistory(token, fetch)).rejects.toThrow();
  });

  it.each([401, 403, 429, 500])(
    'fails closed on HTTP%s without including the private response body',
    async (status) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(`private ${token}`, { status }));
      let failure: unknown;
      try {
        await fetchWorkflowHistory(token, fetch);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain(token);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects malformed JSON and absent count metadata', async () => {
    for (const body of ['not-json', JSON.stringify({ workflow_runs: [run()] })]) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body));
      await expect(fetchWorkflowHistory(token, fetch)).rejects.toThrow();
    }
  });

  it('bounds the body even when content-length is absent', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('x'.repeat(8 * 1024 * 1024)));
    await expect(fetchWorkflowHistory(token, fetch)).rejects.toThrow();
  });
});

describe('conversation artifact encryption prerequisite (no upload)', () => {
  const binding = { sourceCommit, runId: '900', phase: 'development' as const };
  it('preflights the exact artifact key and source/run binding', () => {
    expect(encryptionPreflight(key, sha256(key), binding)).toEqual({
      passed: true,
      algorithm: 'AES-256-GCM',
      binding,
    });
    expect(() => encryptionPreflight(key, '0'.repeat(64), binding)).toThrow();
    expect(() => encryptionPreflight('', sha256(''), binding)).toThrow();
    expect(() => encryptionPreflight('cd'.repeat(32), sha256(key), binding)).toThrow();
    expect(() => encryptionPreflight('g'.repeat(64), sha256('g'.repeat(64)), binding)).toThrow();
    expect(() => encryptionPreflight(key, sha256(key), { ...binding, sourceCommit: 'invalid' })).toThrow();
  });

  it('authenticates ciphertext and its intended source/run, preserving exact raw bytes', () => {
    const text = '{"answer":"synthetic private response","error":"retained failure"}';
    const files = [
      { path: 'outcomes/C01-1.json', data: Buffer.from(text).toString('base64'), sha256: sha256(text) },
    ];
    const envelope = encryptArtifact(files, key, binding);
    expect(decryptArtifact(envelope, key, binding)).toEqual(files);
    expect(JSON.stringify(envelope)).not.toContain('synthetic private response');
    expect(() => decryptArtifact(envelope, key, { ...binding, sourceCommit: 'd'.repeat(40) })).toThrow();
    expect(() => decryptArtifact(envelope, key, { ...binding, runId: '901' })).toThrow();
    expect(() => decryptArtifact({ ...envelope, tag: '00'.repeat(16) }, key, binding)).toThrow();
    const bytes = Buffer.from(envelope.ciphertext, 'base64');
    bytes[0] ^= 1;
    expect(() =>
      decryptArtifact({ ...envelope, ciphertext: bytes.toString('base64') }, key, binding),
    ).toThrow();
  });
  it('creates an upload directory containing only ciphertext and a safe receipt', () => {
    const fixture = archiveFixture();
    const wrapper = { cohort, sourceHash, approvalHash, privateDiagnostic: 'encrypted wrapper only' };
    const receipt = encryptedArchive(fixture.source, fixture.output, key, sha256(key), binding, wrapper);
    expect(readdirSync(fixture.output).sort()).toEqual(['artifact.json', 'receipt.json']);
    const archiveBytes = readFileSync(join(fixture.output, 'artifact.json'));
    const storedReceipt = JSON.parse(readFileSync(join(fixture.output, 'receipt.json'), 'utf8'));
    expect(storedReceipt).toEqual(receipt);
    expect(receipt).toMatchObject({
      encrypted: true,
      algorithm: 'AES-256-GCM',
      ...binding,
      archiveSha256: sha256(archiveBytes),
      archiveBytes: archiveBytes.length,
    });
    expect(Object.keys(storedReceipt).sort()).toEqual(
      [
        'version',
        'encrypted',
        'algorithm',
        'sourceCommit',
        'runId',
        'phase',
        'archiveSha256',
        'archiveBytes',
      ].sort(),
    );
    expect(archiveBytes.toString()).not.toContain(fixture.body);
    expect(archiveBytes.toString()).not.toContain('private synthetic');
    expect(JSON.stringify(storedReceipt)).not.toContain('privateDiagnostic');
    const files = decryptArtifact(JSON.parse(archiveBytes.toString()), key, binding);
    const outcome = files.find((file) => file.path === 'outcomes/C01-1.json')!;
    expect(Buffer.from(outcome.data, 'base64').toString()).toBe(fixture.body);
    expect(outcome.sha256).toBe(sha256(fixture.body));
    const wrapperFile = files.find((file) => file.path === 'conversation-wrapper-receipt.json')!;
    expect(JSON.parse(Buffer.from(wrapperFile.data, 'base64').toString())).toMatchObject(wrapper);
  });

  it('refuses a mismatched artifact key digest before creating upload files', () => {
    const fixture = archiveFixture();
    expect(() =>
      encryptedArchive(fixture.source, fixture.output, key, '0'.repeat(64), binding, {}),
    ).toThrow();
    expect(readdirSync(fixture.root)).toEqual(['raw']);
  });

  it('refuses symlinked raw files and symlinked source directories', () => {
    const fixture = archiveFixture();
    symlinkSync(join(fixture.source, 'outcomes', 'C01-1.json'), join(fixture.source, 'shortcut.json'));
    expect(() => encryptedArchive(fixture.source, fixture.output, key, sha256(key), binding, {})).toThrow();
    rmSync(join(fixture.source, 'shortcut.json'));
    const alias = join(fixture.root, 'source-alias');
    symlinkSync(fixture.source, alias);
    expect(() => encryptedArchive(alias, fixture.output, key, sha256(key), binding, {})).toThrow();
  });

  it('never overwrites an existing upload directory or archived wrapper receipt', () => {
    const fixture = archiveFixture();
    encryptedArchive(fixture.source, fixture.output, key, sha256(key), binding, {});
    const first = readFileSync(join(fixture.output, 'artifact.json'));
    expect(() => encryptedArchive(fixture.source, fixture.output, key, sha256(key), binding, {})).toThrow();
    expect(readFileSync(join(fixture.output, 'artifact.json'))).toEqual(first);
    writeFileSync(join(fixture.source, 'conversation-wrapper-receipt.json'), '{}');
    expect(() =>
      encryptedArchive(fixture.source, join(fixture.root, 'other-output'), key, sha256(key), binding, {}),
    ).toThrow();
  });

  it('rejects a tampered contained-file digest even inside an authenticated envelope', () => {
    const files = [
      {
        path: 'outcomes/C01-1.json',
        data: Buffer.from('actual bytes').toString('base64'),
        sha256: sha256('different bytes'),
      },
    ];
    expect(() => decryptArtifact(encryptArtifact(files, key, binding), key, binding)).toThrow();
  });
});
