import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyBudget, type UsageRecord } from '../research/budget';
import { atomicJson, queuedHttp } from '../research/io';
import { sourceManifest } from '../research/manifest';
import * as manifestModule from '../research/manifest';
import { createQuotaRecoveryPermit, credentialFingerprint, quotaProbeRequest } from '../research/recovery';
import type { ResearchResponse } from '../research/providers/transport';
import {
  executeTransportRecovery,
  prepareTransportRecovery,
  transportProbeQuote,
  type TransportRecoveryPermit,
} from '../scripts/recover-study-transport';

const directories: string[] = [];
const now = Date.parse('2026-10-31T07:07:00Z');
const request = quotaProbeRequest('synthetic-only-transport-key');
const response = (): ResearchResponse => ({
  status: 200,
  elapsedMs: 12,
  json: {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }],
    usageMetadata: { promptTokenCount: 14, candidatesTokenCount: 5, totalTokenCount: 19 },
  },
});
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const loadRecords = (path: string): UsageRecord[] => JSON.parse(readFileSync(path, 'utf8'));
const journal = (path: string) =>
  readFileSync(`${path}.transport-recovery.jsonl`, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'daybook-transport-recovery-'));
  directories.push(path);
  return path;
}
async function baseFixture(
  options: { gemini?: number; attempts?: number; suffixCost?: number; priorCost?: number } = {},
) {
  const root = directory(),
    path = join(root, 'usage.json');
  for (const helper of ['pump-support.py', 'launch-config.py'])
    writeFileSync(join(root, helper), `# Synthetic fixture only: ${helper}; never executed.\n`);
  const old: UsageRecord[] = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(),
    episode: `prior-pilot:R${index}:q:0`,
    provider: 'gemini',
    kind: 'generate',
    model: 'gemini-3.5-flash-lite',
    at: `2026-10-30T22:46:${40 + index}Z`,
    reserveUsd: 0.01,
    estimatedUsd: null,
    status: 429,
    inputTokens: null,
    outputTokens: null,
    durationMs: 100,
  }));
  if (options.priorCost !== undefined)
    old.unshift({
      ...old[0],
      id: randomUUID(),
      episode: 'old-setup',
      kind: 'embed',
      estimatedUsd: options.priorCost,
      reserveUsd: options.priorCost,
      status: 200,
    });
  atomicJson(path, old);
  const budget = new StudyBudget(path);
  const parent = await budget.installKeyCheckPolicy(
    'synthetic previous key-check authorization',
    now - 100000,
  );
  const quotaEvidence = {
    runId: 'prior-pilot',
    recordedAt: '2026-10-30T22:48:00Z',
    quota: {
      httpStatus: 429,
      providerStatus: 'RESOURCE_EXHAUSTED',
      quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
      quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
      quotaValue: 500,
      responsesObserved: 3,
    },
  };
  const authorization = {
    reason: 'user_configured_key_change' as const,
    confirmedAt: '2026-10-31T07:00:00Z',
    notBefore: '2026-10-31T07:00:00Z',
    expiresAt: '2026-10-31T07:30:00Z',
    evidenceReference: 'synthetic previous checked-key authorization',
    keyChange: {
      observedAt: '2026-10-31T07:00:00Z',
      previousFingerprint: credentialFingerprint('old-key'),
      currentFingerprint: credentialFingerprint(request.headers['x-goog-api-key']),
    },
  };
  const permit = createQuotaRecoveryPermit({
    records: old,
    request,
    quotaEvidence,
    authorization,
    limits: budget.limits,
    now,
    policy: parent,
  });
  await budget.recoverQuota({
    permit,
    request,
    quotaEvidence,
    authorization,
    now: () => now,
    transport: async () => response(),
  });
  await budget.installStudyAllowance(
    {
      authorizationReference: 'synthetic existing funded user continuation',
      credentialFingerprint: credentialFingerprint(request.headers['x-goog-api-key']),
      additionalAllowanceUsd: { gemini: options.gemini ?? 6.4, jev: 0.1 },
      maximumAdditionalAttempts: options.attempts ?? 7000,
    },
    now,
  );
  const timedOut: UsageRecord[] = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(),
    episode: `synthetic-heldout:R${index}:q:0`,
    provider: 'gemini',
    kind: 'generate',
    model: 'gemini-3.5-flash-lite',
    at: `2026-10-31T07:01:0${index}Z`,
    reserveUsd: options.suffixCost ?? 0.01,
    estimatedUsd: null,
    status: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
  }));
  const records = [...budget.records, ...timedOut];
  atomicJson(path, records);
  const runDirectory = join(root, 'run');
  mkdirSync(runDirectory);
  const source = sourceManifest();
  atomicJson(join(runDirectory, 'source-manifest.json'), source);
  atomicJson(join(runDirectory, 'manifest.json'), {
    runId: 'synthetic-heldout',
    sourceHash: source.hash,
    protocolHash: sha('docs/PLAN.md'),
  });
  atomicJson(join(runDirectory, 'before.json'), { fingerprint: 'synthetic' });
  writeFileSync(
    join(runDirectory, 'episodes.jsonl'),
    timedOut
      .map((r) => JSON.stringify({ id: r.episode, status: 'error', error: 'RESEARCH_HTTP_TIMEOUT' }))
      .join('\n') + '\n',
  );
  const audit = join(root, 'dispatch-audit.json');
  atomicJson(audit, { gapMs: 116000, allHttpStatuses: 200 });
  const incidentPath = join(root, 'incident.json');
  atomicJson(incidentPath, {
    schemaVersion: 1,
    reason: 'dispatcher_completion_stall',
    runId: 'synthetic-heldout',
    recordedAt: '2026-10-31T07:05:00Z',
    timeoutRecordIds: timedOut.map((r) => r.id),
    dispatchAudit: { path: audit, sha256: sha(audit) },
  });
  const input = {
    usagePath: path,
    runDirectory,
    incidentPath,
    request,
    now,
    authorization: {
      reason: 'user_authorized_transport_stall_recovery' as const,
      confirmedAt: '2026-10-31T07:06:00Z',
      expiresAt: '2026-10-31T07:36:00Z',
      evidenceReference: 'synthetic existing keep-going instruction; no quota or billing claim',
    },
  };
  const oldFiles = Object.fromEntries(
    [
      '.policy.json',
      '.policy-required.json',
      '.study-policy.json',
      '.study-policy-required.json',
      '.recovery.json',
    ].map((suffix) => [suffix, readFileSync(path + suffix, 'utf8')]),
  );
  const activate = (p: TransportRecoveryPermit) => {
    writeFileSync(join(root, 'pump-owner.lock'), p.dispatcherId + '\n');
    atomicJson(join(root, 'pump-controller.json'), {
      runId: p.dispatcherId,
      phase: 'waiting',
      pending: null,
      startedAt: new Date(now).toISOString(),
      requests: 0,
      googleRequests: 0,
    });
  };
  const complete = () => {
    const controller = JSON.parse(readFileSync(join(root, 'pump-controller.json'), 'utf8'));
    atomicJson(join(root, 'pump-controller.json'), { ...controller, requests: 1, googleRequests: 1 });
  };
  const transport = vi.fn(async () => {
    complete();
    return response();
  });
  return { root, path, records, runDirectory, incidentPath, input, oldFiles, activate, complete, transport };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

import {
  preparePrelaunchContinuation,
  executePrelaunchContinuation,
  type PrelaunchPermit,
} from '../scripts/continue-unlaunched-probe';

const legacy = `# Synthetic prior helper control-flow fixture; never executed.
ensure('\\n' not in value, 'INVALID_DIRECTIVE_VALUE')
google = validated_config(config, stem)
write_exclusive(stem.with_suffix('.launch.json'), event)
sys.stdout.write(prepare_launch(ROOT, args.run_id))
`;
const continuedAt = now + 180000;
async function fixture(options: Parameters<typeof baseFixture>[0] = {}) {
  const f = await baseFixture(options);
  writeFileSync(join(f.root, 'launch-config.py'), legacy);
  const padding = Array.from({ length: 3119 - f.records.length }, () => ({
    ...f.records[0],
    id: randomUUID(),
    episode: 'synthetic-setup',
    kind: 'file-poll',
    model: 'file-search',
    reserveUsd: 0,
    estimatedUsd: 0,
    status: 200,
  }));
  const records = [...f.records.slice(0, -3), ...padding, ...f.records.slice(-3)];
  expect(records).toHaveLength(3119);
  atomicJson(f.path, records);
  const originalPermit = await prepareTransportRecovery(f.input);
  f.activate(originalPermit);
  await expect(
    executeTransportRecovery({
      permit: originalPermit,
      request,
      transport: f.transport,
      now: () => now,
      checkpoint: (point) => {
        if (point === 'reserved') throw new Error('synthetic guard rejection before network');
      },
    }),
  ).rejects.toThrow('synthetic guard rejection');
  unlinkSync(join(f.root, 'pump-owner.lock'));
  const originalRecords = loadRecords(f.path),
    originalJournal = readFileSync(`${f.path}.transport-recovery.jsonl`, 'utf8');
  expect(originalRecords).toHaveLength(3120);
  const queue = join(f.root, 'queue');
  mkdirSync(queue);
  // Actual frozen producer, fake clock and no dispatcher: this creates local
  // files only and reproduces the real JSON newline representation.
  vi.useFakeTimers();
  vi.setSystemTime(now);
  let queueError: unknown;
  const pending = queuedHttp(queue)(request).catch((error) => {
    queueError = error;
  });
  const names = (await import('node:fs')).readdirSync(queue);
  const stemName = names.find((name) => name.endsWith('.ready'))!.slice(0, -6);
  const stem = join(queue, stemName);
  (await import('node:fs')).renameSync(stem + '.ready', stem + '.claimed');
  await vi.advanceTimersByTimeAsync(25000);
  await pending;
  vi.useRealTimers();
  expect(queueError).toBeInstanceOf(Error);
  const archiveRoot = join(f.root, 'archive'),
    archiveQueue = join(archiveRoot, 'queue'),
    proofDirectory = join(archiveRoot, 'proof');
  mkdirSync(archiveQueue, { recursive: true });
  mkdirSync(proofDirectory);
  const archiveFiles = ['body', 'claimed', 'curl'].map((suffix) => {
    const originalPath = stem + '.' + suffix,
      archivePath = join(archiveQueue, stemName + '.' + suffix);
    const bytes = readFileSync(originalPath);
    writeFileSync(archivePath, bytes);
    unlinkSync(originalPath);
    return {
      name: stemName + '.' + suffix,
      bytes: bytes.length,
      sha256: sha(archivePath),
      originalPath,
      archivePath,
    };
  });
  for (const name of ['runner.lock', 'usage.json.lock']) {
    const archivePath = join(archiveRoot, name);
    writeFileSync(archivePath, 'synthetic exited PID');
    archiveFiles.push({
      name,
      bytes: readFileSync(archivePath).length,
      sha256: sha(archivePath),
      originalPath: join(f.root, name),
      archivePath,
    });
  }
  writeFileSync(join(proofDirectory, 'launcher-v1.py'), legacy);
  writeFileSync(join(proofDirectory, 'consumed-journal.jsonl'), originalJournal);
  writeFileSync(join(proofDirectory, 'reserved-usage.json'), readFileSync(f.path));
  atomicJson(join(proofDirectory, 'stopped-controller.json'), {
    runId: originalPermit.dispatcherId,
    phase: 'stopped',
    requests: 1,
    googleRequests: 1,
    pending: null,
    statuses: { None: 1 },
  });
  writeFileSync(
    join(proofDirectory, 'pump-metrics.jsonl'),
    JSON.stringify({
      runId: originalPermit.dispatcherId,
      google: true,
      completeFooter: false,
      status: null,
      durationMs: null,
      exitCode: 2,
    }) + '\n',
  );
  const archiveManifestPath = join(archiveRoot, 'manifest.json');
  atomicJson(archiveManifestPath, {
    schemaVersion: 1,
    dispatcherId: originalPermit.dispatcherId,
    permitId: originalPermit.id,
    pidExited: true,
    files: archiveFiles,
    ledgerAndJournal: { ledgerSha256: sha(f.path), journalSha256: sha(`${f.path}.transport-recovery.jsonl`) },
    absentOutputs: { '.launch.json': true, '.done': true, '.response': true, '.headers': true },
  });
  const evidencePath = join(f.root, 'rejection.json');
  const evidence = {
    schemaVersion: 1,
    kind: 'transport_recovery_probe_local_rejection',
    at: new Date(now + 60000).toISOString(),
    permitId: originalPermit.id,
    dispatcherId: originalPermit.dispatcherId,
    reason: 'INVALID_DIRECTIVE_VALUE',
    curlProcessExitCode: 2,
    configurationEmitted: false,
    networkRequestDispatched: false,
    launchReceiptPresent: false,
    responseFilePresent: false,
    headersFilePresent: false,
    completionFooterPresent: false,
    originalRequestBodyPresent: true,
    studyResumed: false,
    preservedUsageRecords: 3120,
    ledgerSha256: sha(f.path),
    journalSha256: sha(`${f.path}.transport-recovery.jsonl`),
    privateArchiveManifestSha256: sha(archiveManifestPath),
    claimedMetadataSha256: sha(join(archiveQueue, stemName + '.claimed')),
    curlConfigurationSha256: sha(join(archiveQueue, stemName + '.curl')),
    requestBodySha256: sha(join(archiveQueue, stemName + '.body')),
    stoppedControllerSha256: sha(join(proofDirectory, 'stopped-controller.json')),
    metricsSha256: sha(join(proofDirectory, 'pump-metrics.jsonl')),
    launcherV1Sha256: sha(join(proofDirectory, 'launcher-v1.py')),
    archivedRequestFiles: 3,
    archivedStaleLocks: 2,
    staleOwnerPidExited: true,
    readyCount: 0,
    claimedWithoutDone: 0,
    retryPerformed: false,
    reservationReduced: false,
  };
  atomicJson(evidencePath, evidence);
  writeFileSync(
    join(f.root, 'launch-config.py'),
    '# Corrected synthetic helper: exact write-out newline allowed.\n',
  );
  const input = {
    usagePath: f.path,
    evidencePath,
    archiveManifestPath,
    proofDirectory,
    request,
    now: continuedAt,
    authorization: {
      reason: 'continue_authorized_call_after_proven_prelaunch_rejection' as const,
      confirmedAt: new Date(now + 120000).toISOString(),
      expiresAt: new Date(now + 1800000).toISOString(),
      evidenceReference:
        'synthetic existing keep-going authorization, no new provider call beyond original intent',
    },
  };
  const activate = (permit: PrelaunchPermit) => {
    writeFileSync(join(f.root, 'pump-owner.lock'), permit.dispatcherId + '\n');
    atomicJson(join(f.root, 'pump-controller.json'), {
      runId: permit.dispatcherId,
      phase: 'waiting',
      pending: null,
      startedAt: new Date(continuedAt).toISOString(),
      requests: 0,
      googleRequests: 0,
    });
  };
  const transport = vi.fn(async () => {
    f.complete();
    return response();
  });
  return {
    ...f,
    input,
    evidence,
    evidencePath,
    archiveManifestPath,
    archiveQueue,
    stem,
    stemName,
    proofDirectory,
    originalPermit,
    originalRecords,
    originalJournal,
    activate,
    transport,
  };
}
describe('proven pre-launch rejection continuation', () => {
  it('preserves all 3120 records and original journal, then reserves one measured operational call', async () => {
    const f = await fixture();
    const p = await preparePrelaunchContinuation(f.input);
    f.activate(p);
    expect(p.originalJournalSha256).toBe(sha(`${f.path}.transport-recovery.jsonl`));
    const originalQuote = transportProbeQuote(request);
    f.transport.mockImplementationOnce(async () => {
      expect(loadRecords(f.path)).toHaveLength(3121);
      expect(loadRecords(f.path).at(-1)?.estimatedUsd).toBeNull();
      expect(readFileSync(`${f.path}.transport-recovery.jsonl`, 'utf8')).toBe(f.originalJournal);
      expect(existsSync(`${f.path}.lock`)).toBe(true);
      f.complete();
      return response();
    });
    const result = await executePrelaunchContinuation({
      permit: p,
      request,
      transport: f.transport,
      now: () => continuedAt,
    });
    expect(result).toMatchObject({
      outcome: 'RECOVERED',
      previousUsageCount: 3120,
      originalJournalUnchanged: true,
      originalRejectedProbeReservationUsd: originalQuote,
    });
    expect(loadRecords(f.path).slice(0, 3120)).toEqual(f.originalRecords);
    expect(loadRecords(f.path)[3119].estimatedUsd).toBeNull();
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(
      /requestHash|synthetic-only-transport-key|credentialFingerprint/,
    );
    expect(journal(f.path).map((e) => e.event)).toEqual(['consumed', 'reserved']);
    await expect(new StudyBudget(f.path).wrap(async () => response())(request)).resolves.toMatchObject({
      status: 200,
    });
  });
  it.each([
    'launch',
    'response',
    'ready',
    'true-network',
    'wrong-exit',
    'missing-proof',
    'modified-config',
  ] as const)('refuses %s evidence with zero calls', async (kind) => {
    const f = await fixture();
    if (kind === 'launch') writeFileSync(join(f.archiveQueue, f.stemName + '.launch.json'), '{}');
    if (kind === 'response') writeFileSync(f.stem + '.response', '{}');
    if (kind === 'ready') writeFileSync(f.stem + '.ready', '{}');
    if (kind === 'true-network')
      atomicJson(f.evidencePath, { ...f.evidence, networkRequestDispatched: true });
    if (kind === 'wrong-exit') atomicJson(f.evidencePath, { ...f.evidence, curlProcessExitCode: 28 });
    if (kind === 'missing-proof') unlinkSync(join(f.proofDirectory, 'launcher-v1.py'));
    if (kind === 'modified-config')
      writeFileSync(join(f.archiveQueue, f.stemName + '.curl'), 'url = "https://example.invalid"');
    await expect(preparePrelaunchContinuation(f.input)).rejects.toThrow();
    expect(f.transport).not.toHaveBeenCalled();
    expect(loadRecords(f.path)).toEqual(f.originalRecords);
  });
  it.each(['journal-event', 'known-original', 'short-history', 'missing-policy', 'failed-quota'] as const)(
    'refuses unsafe original state: %s',
    async (kind) => {
      const f = await fixture();
      if (kind === 'journal-event')
        writeFileSync(`${f.path}.transport-recovery.jsonl`, f.originalJournal + '{"event":"failed"}\n');
      if (kind === 'known-original') {
        const rows = loadRecords(f.path);
        rows.at(-1)!.status = 200;
        atomicJson(f.path, rows);
      }
      if (kind === 'short-history') atomicJson(f.path, f.originalRecords.slice(0, -1));
      if (kind === 'missing-policy') unlinkSync(`${f.path}.study-policy.json`);
      if (kind === 'failed-quota') {
        const j = JSON.parse(readFileSync(`${f.path}.recovery.json`, 'utf8'));
        j.at(-1).state = 'failed';
        atomicJson(`${f.path}.recovery.json`, j);
      }
      await expect(preparePrelaunchContinuation(f.input)).rejects.toThrow();
      expect(f.transport).not.toHaveBeenCalled();
    },
  );
  it.each(['helper', 'policy', 'history', 'key', 'owner', 'expired'] as const)(
    'rejects changed %s after preparation',
    async (kind) => {
      const f = await fixture();
      const p = await preparePrelaunchContinuation(f.input);
      f.activate(p);
      if (kind === 'helper') writeFileSync(join(f.root, 'launch-config.py'), '# changedagain');
      if (kind === 'policy') writeFileSync(`${f.path}.study-policy.json`, '{}');
      if (kind === 'history') {
        const r = loadRecords(f.path);
        r[200].reserveUsd = 1;
        atomicJson(f.path, r);
      }
      if (kind === 'owner') writeFileSync(join(f.root, 'pump-owner.lock'), 'wrong');
      await expect(
        executePrelaunchContinuation({
          permit: p,
          request: kind === 'key' ? quotaProbeRequest('wrong') : request,
          transport: f.transport,
          now: () => (kind === 'expired' ? continuedAt + 3600000 : continuedAt),
        }),
      ).rejects.toThrow();
      expect(f.transport).not.toHaveBeenCalled();
    },
  );
  it.each(['false', 'throw', 'overrun'] as const)(
    'keeps failed %s continuation unknown, charged and non-replayable',
    async (kind) => {
      const f = await fixture();
      const p = await preparePrelaunchContinuation(f.input);
      f.activate(p);
      f.transport.mockImplementationOnce(async () => {
        f.complete();
        if (kind === 'throw') throw new Error('private transport failure');
        const r = response();
        if (kind === 'false') (r.json as any).candidates[0].content.parts[0].text = '{"ok":false}';
        if (kind === 'overrun')
          (r.json as any).usageMetadata = {
            promptTokenCount: 1000000,
            candidatesTokenCount: 5,
            totalTokenCount: 1000005,
          };
        return r;
      });
      const result = await executePrelaunchContinuation({
        permit: p,
        request,
        transport: f.transport,
        now: () => continuedAt,
      });
      expect(result.outcome).not.toBe('RECOVERED');
      expect(loadRecords(f.path).at(-1)?.estimatedUsd).toBeNull();
      expect(loadRecords(f.path).slice(0, 3120)).toEqual(f.originalRecords);
      const forbidden = vi.fn(async () => response());
      await expect(new StudyBudget(f.path).wrap(forbidden)(request)).rejects.toThrow('CIRCUIT_OPEN');
      expect(forbidden).not.toHaveBeenCalled();
      await expect(
        executePrelaunchContinuation({ permit: p, request, transport: f.transport, now: () => continuedAt }),
      ).rejects.toThrow('ALREADY_CONSUMED');
      if (kind === 'overrun') expect(loadRecords(f.path).at(-1)!.reserveUsd).toBeCloseTo(0.3000125, 10);
      expect(f.transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['consumed', 'reserved', 'verified', 'ledger-completed'] as const)(
    'is crash-closed before verified evidence at %s',
    async (point) => {
      const f = await fixture();
      const p = await preparePrelaunchContinuation(f.input);
      f.activate(p);
      await expect(
        executePrelaunchContinuation({
          permit: p,
          request,
          transport: f.transport,
          now: () => continuedAt,
          checkpoint: (at) => {
            if (at === point) throw new Error('synthetic crash');
          },
        }),
      ).rejects.toThrow('synthetic crash');
      expect(loadRecords(f.path).slice(0, 3120)).toEqual(f.originalRecords);
      const normal = vi.fn(async () => response());
      if (point === 'ledger-completed')
        await expect(new StudyBudget(f.path).wrap(normal)(request)).resolves.toMatchObject({ status: 200 });
      else {
        await expect(new StudyBudget(f.path).wrap(normal)(request)).rejects.toThrow('CIRCUIT_OPEN');
        expect(normal).not.toHaveBeenCalled();
      }
      await expect(
        executePrelaunchContinuation({ permit: p, request, transport: f.transport, now: () => continuedAt }),
      ).rejects.toThrow('ALREADY_CONSUMED');
    },
  );
  it('rechecks full frozen source after the request', async () => {
    const f = await fixture();
    const p = await preparePrelaunchContinuation(f.input);
    f.activate(p);
    const original = sourceManifest();
    vi.spyOn(manifestModule, 'sourceManifest')
      .mockReturnValueOnce(original)
      .mockReturnValueOnce(original)
      .mockReturnValueOnce({ ...original, hash: '0'.repeat(64) });
    await expect(
      executePrelaunchContinuation({ permit: p, request, transport: f.transport, now: () => continuedAt }),
    ).rejects.toThrow('FROZEN_SOURCE_CHANGED');
    expect(loadRecords(f.path).at(-1)?.estimatedUsd).toBeNull();
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each([{ gemini: 0.03109 }, { attempts: 3116 }, { priorCost: 9.9385 }])(
    'preserves existing caps %j without a provider call',
    async (options) => {
      const f = await fixture(options);
      await expect(preparePrelaunchContinuation(f.input)).rejects.toThrow('EXHAUSTED');
      expect(f.transport).not.toHaveBeenCalled();
      expect(loadRecords(f.path)).toEqual(f.originalRecords);
    },
  );
  it('allows only one concurrent continuation executor', async () => {
    const f = await fixture();
    const p = await preparePrelaunchContinuation(f.input);
    f.activate(p);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    f.transport.mockImplementationOnce(async () => {
      entered();
      await new Promise<void>((r) => {
        release = r;
      });
      f.complete();
      return response();
    });
    const first = executePrelaunchContinuation({
      permit: p,
      request,
      transport: f.transport,
      now: () => continuedAt,
    });
    await started;
    await expect(
      executePrelaunchContinuation({ permit: p, request, transport: f.transport, now: () => continuedAt }),
    ).rejects.toThrow('IN_USE');
    release();
    await first;
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
});
