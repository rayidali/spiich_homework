import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyBudget, type UsageRecord } from '../research/budget';
import { atomicJson } from '../research/io';
import { sourceManifest } from '../research/manifest';
import * as manifestModule from '../research/manifest';
import {
  createQuotaRecoveryPermit,
  credentialFingerprint,
  quotaProbeRequest,
  recoveryHash,
} from '../research/recovery';
import type { ResearchResponse } from '../research/providers/transport';
import { transportProbeQuote, type TransportRecoveryPermit } from '../scripts/recover-study-transport';

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
  installOperatorRecovery,
  admitOperatorRecovery,
  executeOperatorRecovery,
} from '../scripts/operator-recovery';

async function fixture(options: Parameters<typeof baseFixture>[0] = {}) {
  const f = await baseFixture(options);
  const padding = Array.from({ length: 3121 - f.records.length }, () => ({
    ...f.records[0],
    id: randomUUID(),
    episode: 'synthetic-setup',
    kind: 'file-poll',
    model: 'file-search',
    estimatedUsd: 0,
    reserveUsd: 0,
    status: 200,
  }));
  const records = [...f.records.slice(0, -3), ...padding, ...f.records.slice(-3)];
  atomicJson(f.path, records);
  const originalPath = `${f.path}.transport-recovery.jsonl`,
    continuationPath = `${f.path}.prelaunch-continuation.jsonl`;
  const priorFailureReceiptPath = join(f.root, 'prior-failure.json');
  const priorReceipt = {
    reason: 'proven_prelaunch_rejection_continuation',
    outcome: 'TRANSPORT_ERROR',
    previousUsageCount: 3120,
    previousUsageHash: recoveryHash(records.slice(0, 3120)),
    sourceHash: sourceManifest().hash,
    countedUsd: records[3120].reserveUsd,
    priorRecordsUnchanged: true,
    originalJournalUnchanged: true,
    studyResumed: false,
  };
  atomicJson(priorFailureReceiptPath, priorReceipt);
  writeFileSync(
    originalPath,
    ['consumed', 'reserved'].map((event) => JSON.stringify({ event })).join('\n') + '\n',
  );
  writeFileSync(
    continuationPath,
    [
      { event: 'consumed' },
      { event: 'reserved' },
      { event: 'failed', recordId: records[3120].id, receipt: priorReceipt },
      { event: 'ledger-committed', usageHash: recoveryHash(records) },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n') + '\n',
  );
  atomicJson(join(f.runDirectory, 'manifest.json'), {
    runId: 'holdout-v1',
    sourceHash: sourceManifest().hash,
    protocolHash: sha('docs/PLAN.md'),
  });
  atomicJson(join(f.root, 'index-state.json'), { authorizedDocuments: 39 });
  const historicalSources = ['old-original.ts', 'old-continuation.ts'].map((name) => {
    const path = join(f.root, name);
    writeFileSync(path, `// Historical synthetic source ${name}\n`);
    return path;
  });
  const connectivity = join(f.root, 'connectivity.json');
  atomicJson(connectivity, { status: 404, authenticated: false, path: 'plain curl' });
  const auth = (time: number) => ({
    reason: 'operator_reviewed_transport_recovery' as const,
    confirmedAt: new Date(time).toISOString(),
    expiresAt: new Date(time + 1800000).toISOString(),
    evidenceReference: 'synthetic existing user instruction and operator diagnosis',
  });
  const review = (index: number, time: number) => {
    const path = join(f.root, `review-${index}.json`);
    atomicJson(path, {
      schemaVersion: 1,
      kind: 'operator_transport_review',
      incidentId: 'holdout-v1-interruption-01',
      reviewedAt: new Date(time).toISOString(),
      diagnosis: `Synthetic diagnosis ${index}`,
      remediation: `Reviewed plain curl repair ${index}`,
      transportMode: 'approved_plain_curl_config',
      connectivityEvidence: { path: connectivity, sha256: sha(connectivity) },
      incidentEvidence: { path: f.incidentPath, sha256: sha(f.incidentPath) },
    });
    return path;
  };
  const diagnosisPath = review(0, now);
  const install = {
    usagePath: f.path,
    runDirectory: f.runDirectory,
    request,
    authorization: auth(now),
    diagnosisPath,
    priorFailureReceiptPath,
    historicalSources,
    dispatcherFiles: ['pump-support.py', 'launch-config.py'].map((name) => join(f.root, name)),
    now,
  };
  const activate = (admission: { dispatcherId: string }, time = now) => {
    writeFileSync(join(f.root, 'pump-owner.lock'), admission.dispatcherId + '\n');
    atomicJson(join(f.root, 'pump-controller.json'), {
      runId: admission.dispatcherId,
      phase: 'waiting',
      pending: null,
      startedAt: new Date(time).toISOString(),
      requests: 0,
      googleRequests: 0,
    });
  };
  const transport = vi.fn(async () => {
    f.complete();
    return response();
  });
  const admit = async (index = 1, time = now) =>
    admitOperatorRecovery({
      usagePath: f.path,
      request,
      authorization: auth(time),
      reviewPath: review(index, time),
      now: time,
    });
  const stop = () => {
    if (existsSync(join(f.root, 'pump-owner.lock'))) unlinkSync(join(f.root, 'pump-owner.lock'));
  };
  return {
    ...f,
    records,
    originalPath,
    continuationPath,
    install,
    activate,
    transport,
    auth,
    review,
    admit,
    stop,
  };
}
describe('finite operator recovery registry', () => {
  it('preserves the full baseline and old journals, consumes one admitted probe, then permanently closes', async () => {
    const f = await fixture();
    const journals = [f.originalPath, f.continuationPath].map((p) => readFileSync(p, 'utf8'));
    await installOperatorRecovery(f.install);
    const a = await f.admit();
    f.activate(a);
    f.transport.mockImplementationOnce(async () => {
      expect(loadRecords(f.path)).toHaveLength(3122);
      expect(loadRecords(f.path).at(-1)?.estimatedUsd).toBeNull();
      f.complete();
      return response();
    });
    const result = await executeOperatorRecovery({
      usagePath: f.path,
      admissionId: a.admissionId,
      request,
      transport: f.transport,
      now: () => now,
    });
    expect(result).toMatchObject({
      outcome: 'RECOVERED',
      cohortClosed: true,
      attemptsConsumed: 1,
      cumulativeReservationUsd: transportProbeQuote(request),
      baselinePreserved: true,
    });
    expect(loadRecords(f.path).slice(0, 3121)).toEqual(f.records);
    expect([f.originalPath, f.continuationPath].map((p) => readFileSync(p, 'utf8'))).toEqual(journals);
    f.stop();
    await expect(f.admit(2, now + 1000)).rejects.toThrow('COHORT_CLOSED');
    await expect(installOperatorRecovery(f.install)).rejects.toThrow('ALREADY_INSTALLED');
    expect(f.transport).toHaveBeenCalledTimes(1);
    await expect(new StudyBudget(f.path).wrap(async () => response())(request)).resolves.toMatchObject({
      status: 200,
    });
  });
  it('counts all three consumed reservations without releasing cheap reported usage and refuses a fourth', async () => {
    const f = await fixture();
    await installOperatorRecovery(f.install);
    for (let i = 1; i <= 3; i++) {
      const time = now + i * 1000,
        a = await f.admit(i, time);
      f.activate(a, time);
      f.transport.mockImplementationOnce(async () => {
        f.complete();
        const r = response();
        (r.json as any).candidates[0].content.parts[0].text = '{"ok":false}';
        return r;
      });
      const result = await executeOperatorRecovery({
        usagePath: f.path,
        admissionId: a.admissionId,
        request,
        transport: f.transport,
        now: () => time,
      });
      expect(result.outcome).toBe('INVALID_OUTPUT');
      expect(result.cumulativeReservationUsd).toBeCloseTo(i * transportProbeQuote(request), 15);
      expect(loadRecords(f.path).at(-1)?.estimatedUsd).toBeNull();
      f.stop();
    }
    await expect(f.admit(4, now + 4000)).rejects.toThrow('COHORT_EXHAUSTED');
    expect(f.transport).toHaveBeenCalledTimes(3);
    const forbidden = vi.fn(async () => response());
    await expect(new StudyBudget(f.path).wrap(forbidden)(request)).rejects.toThrow('CIRCUIT_OPEN');
    expect(forbidden).not.toHaveBeenCalled();
  });
  it('requires a fresh reviewed diagnosis after a failed request and never retries automatically', async () => {
    const f = await fixture();
    await installOperatorRecovery(f.install);
    const a = await f.admit();
    f.activate(a);
    f.transport.mockImplementationOnce(async () => {
      f.complete();
      throw new Error('synthetic DNS failure');
    });
    await executeOperatorRecovery({
      usagePath: f.path,
      admissionId: a.admissionId,
      request,
      transport: f.transport,
      now: () => now,
    });
    f.stop();
    await expect(f.admit(1, now)).rejects.toThrow('REVIEW_REUSED');
    await expect(f.admit(2, now)).rejects.toThrow('REVIEW_PREDATES_FAILURE');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('permits a reviewed helper repair only after a completed failure and binds it to the next admission', async () => {
    const f = await fixture();
    await installOperatorRecovery(f.install);
    const first = await f.admit();
    f.activate(first);
    f.transport.mockImplementationOnce(async () => {
      f.complete();
      throw new Error('synthetic path failure');
    });
    await executeOperatorRecovery({
      usagePath: f.path,
      admissionId: first.admissionId,
      request,
      transport: f.transport,
      now: () => now,
    });
    f.stop();
    writeFileSync(join(f.root, 'launch-config.py'), '# Newly reviewed synthetic repair');
    const second = await f.admit(2, now + 1000);
    f.activate(second, now + 1000);
    const result = await executeOperatorRecovery({
      usagePath: f.path,
      admissionId: second.admissionId,
      request,
      transport: f.transport,
      now: () => now + 1000,
    });
    expect(result).toMatchObject({ outcome: 'RECOVERED', attemptsConsumed: 2 });
    expect(f.transport).toHaveBeenCalledTimes(2);
  });
  it.each(['after-admission', 'during-request'] as const)(
    'rejects an unreviewed helper change %s',
    async (point) => {
      const f = await fixture();
      await installOperatorRecovery(f.install);
      const a = await f.admit();
      f.activate(a);
      const mutate = () => writeFileSync(join(f.root, 'launch-config.py'), '# changed without a new review');
      if (point === 'after-admission') mutate();
      else
        f.transport.mockImplementationOnce(async () => {
          f.complete();
          mutate();
          return response();
        });
      await expect(
        executeOperatorRecovery({
          usagePath: f.path,
          admissionId: a.admissionId,
          request,
          transport: f.transport,
          now: () => now,
        }),
      ).rejects.toThrow('BINDING_CHANGED');
      expect(f.transport.mock.calls.length).toBe(point === 'after-admission' ? 0 : 1);
      expect(loadRecords(f.path).slice(0, 3121)).toEqual(f.records);
      if (point === 'during-request') expect(loadRecords(f.path).at(-1)?.estimatedUsd).toBeNull();
    },
  );
  it('binds the777-outcome evidence file and requires the recorded prior failed receipt', async () => {
    const f = await fixture();
    const failure = JSON.parse(readFileSync(f.install.priorFailureReceiptPath, 'utf8'));
    atomicJson(f.install.priorFailureReceiptPath, { ...failure, previousUsageHash: '0'.repeat(64) });
    await expect(installOperatorRecovery(f.install)).rejects.toThrow('PRIOR_FAILURE_CHANGED');
    atomicJson(f.install.priorFailureReceiptPath, failure);
    await installOperatorRecovery(f.install);
    writeFileSync(join(f.runDirectory, 'episodes.jsonl'), '\n');
    await expect(f.admit()).rejects.toThrow('BINDING_CHANGED');
    expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['consumed', 'reserved', 'verified', 'ledger-completed'] as const)(
    'does not renew after crash at %s',
    async (point) => {
      const f = await fixture();
      await installOperatorRecovery(f.install);
      const a = await f.admit();
      f.activate(a);
      await expect(
        executeOperatorRecovery({
          usagePath: f.path,
          admissionId: a.admissionId,
          request,
          transport: f.transport,
          now: () => now,
          checkpoint: (at) => {
            if (at === point) throw new Error('crash');
          },
        }),
      ).rejects.toThrow('crash');
      f.stop();
      await expect(f.admit(2, now + 1000)).rejects.toThrow(/ATTEMPT_PENDING|COHORT_CLOSED/);
      const normal = vi.fn(async () => response());
      if (point === 'ledger-completed')
        await expect(new StudyBudget(f.path).wrap(normal)(request)).resolves.toMatchObject({ status: 200 });
      else {
        await expect(new StudyBudget(f.path).wrap(normal)(request)).rejects.toThrow('CIRCUIT_OPEN');
        expect(normal).not.toHaveBeenCalled();
      }
      expect(loadRecords(f.path).slice(0, 3121)).toEqual(f.records);
    },
  );
  it.each([
    'marker-missing',
    'journal-missing',
    'corrupt',
    'prefix',
    'policy',
    'old-journal',
    'helper',
    'key',
  ] as const)('rejects changed %s', async (kind) => {
    const f = await fixture();
    await installOperatorRecovery(f.install);
    if (kind === 'marker-missing') unlinkSync(`${f.path}.operator-recovery-required.json`);
    if (kind === 'journal-missing') unlinkSync(`${f.path}.operator-recovery.jsonl`);
    if (kind === 'corrupt') writeFileSync(`${f.path}.operator-recovery.jsonl`, '{partial');
    if (kind === 'prefix') {
      const rows = loadRecords(f.path);
      rows[5].reserveUsd = 4;
      atomicJson(f.path, rows);
    }
    if (kind === 'policy') writeFileSync(`${f.path}.study-policy.json`, '{}');
    if (kind === 'old-journal') writeFileSync(f.originalPath, '{}');
    if (kind === 'helper') writeFileSync(join(f.root, 'launch-config.py'), '# changed');
    await expect(
      admitOperatorRecovery({
        usagePath: f.path,
        request: kind === 'key' ? quotaProbeRequest('wrong') : request,
        authorization: f.auth(now),
        reviewPath: f.review(1, now),
        now,
      }),
    ).rejects.toThrow();
    expect(f.transport).not.toHaveBeenCalled();
    if (kind === 'marker-missing' || kind === 'journal-missing')
      await expect(installOperatorRecovery(f.install)).rejects.toThrow('ALREADY_INSTALLED');
  });
  it('blocks reinstallation if both registry files were removed after a consumed attempt', async () => {
    const f = await fixture();
    await installOperatorRecovery(f.install);
    const a = await f.admit();
    f.activate(a);
    await expect(
      executeOperatorRecovery({
        usagePath: f.path,
        admissionId: a.admissionId,
        request,
        transport: f.transport,
        now: () => now,
        checkpoint: (at) => {
          if (at === 'reserved') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');
    f.stop();
    unlinkSync(`${f.path}.operator-recovery.jsonl`);
    unlinkSync(`${f.path}.operator-recovery-required.json`);
    await expect(installOperatorRecovery(f.install)).rejects.toThrow('BASELINE_CHANGED');
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('retains a reported overrun and stops the cumulative reservation budget', async () => {
    const f = await fixture();
    await installOperatorRecovery(f.install);
    const a = await f.admit();
    f.activate(a);
    f.transport.mockImplementationOnce(async () => {
      f.complete();
      const r = response();
      (r.json as any).usageMetadata = {
        promptTokenCount: 1000000,
        candidatesTokenCount: 5,
        totalTokenCount: 1000005,
      };
      return r;
    });
    const result = await executeOperatorRecovery({
      usagePath: f.path,
      admissionId: a.admissionId,
      request,
      transport: f.transport,
      now: () => now,
    });
    expect(result.outcome).toBe('USAGE_EXCEEDS_RESERVATION');
    expect(result.cumulativeReservationUsd).toBeGreaterThan(0.005);
    expect(loadRecords(f.path).at(-1)?.estimatedUsd).toBeNull();
    f.stop();
    await expect(f.admit(2, now + 1000)).rejects.toThrow('COHORT_EXHAUSTED');
  });
  it.each([{ gemini: 0.03 }, { attempts: 3117 }, { priorCost: 9.939 }])(
    'retains parent caps %j',
    async (options) => {
      const f = await fixture(options);
      await expect(installOperatorRecovery(f.install)).rejects.toThrow('EXHAUSTED');
      expect(f.transport).not.toHaveBeenCalled();
    },
  );
  it('rechecks complete source after transport before closing or opening the circuit', async () => {
    const f = await fixture();
    await installOperatorRecovery(f.install);
    const a = await f.admit();
    f.activate(a);
    const source = sourceManifest();
    vi.spyOn(manifestModule, 'sourceManifest')
      .mockReturnValueOnce(source)
      .mockReturnValueOnce({ ...source, hash: '0'.repeat(64) });
    await expect(
      executeOperatorRecovery({
        usagePath: f.path,
        admissionId: a.admissionId,
        request,
        transport: f.transport,
        now: () => now,
      }),
    ).rejects.toThrow('FROZEN_SOURCE_CHANGED');
    expect(loadRecords(f.path).at(-1)?.estimatedUsd).toBeNull();
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('uses the shared budget lock to prevent concurrent execution', async () => {
    const f = await fixture();
    await installOperatorRecovery(f.install);
    const a = await f.admit();
    f.activate(a);
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
    const first = executeOperatorRecovery({
      usagePath: f.path,
      admissionId: a.admissionId,
      request,
      transport: f.transport,
      now: () => now,
    });
    await started;
    await expect(
      executeOperatorRecovery({
        usagePath: f.path,
        admissionId: a.admissionId,
        request,
        transport: f.transport,
        now: () => now,
      }),
    ).rejects.toThrow('IN_USE');
    release();
    await first;
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
});
