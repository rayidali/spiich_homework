import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyBudget, type UsageRecord } from '../research/budget';
import { atomicJson } from '../research/io';
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
async function fixture(
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

describe('external one-shot transport recovery', () => {
  it('binds only fixture-local helpers and never falls back to private repository tooling', async () => {
    const f = await fixture();
    const permit = await prepareTransportRecovery(f.input);
    expect(permit.bindings.filter((item) => /(?:pump-support|launch-config)\.py$/.test(item.path))).toEqual(
      ['pump-support.py', 'launch-config.py'].map((name) => ({
        path: join(f.root, name),
        sha256: sha(join(f.root, name)),
      })),
    );
    unlinkSync(join(f.root, 'launch-config.py'));
    await expect(prepareTransportRecovery(f.input)).rejects.toThrow('BINDING_MISSING');
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('matches frozen reservation and price without a production calculator or provider call', async () => {
    const path = join(directory(), 'calculator.json');
    const budget = new StudyBudget(path);
    await budget.wrap(async () => response())(request);
    expect(transportProbeQuote(request)).toBe(budget.records[0].reserveUsd);
    expect(budget.records[0].estimatedUsd).toBeCloseTo((14 * 0.3 + 5 * 2.5) / 1e6, 15);
    expect(() => transportProbeQuote({ ...request, timeoutMs: 26000 })).toThrow('WRONG_REQUEST');
  });
  it('consumes before one request, preserves old history/policies and opens only on verified success', async () => {
    const f = await fixture();
    const p = await prepareTransportRecovery(f.input);
    f.activate(p);
    f.transport.mockImplementationOnce(async () => {
      expect(journal(f.path).map((r) => r.event)).toEqual(['consumed', 'reserved']);
      expect(loadRecords(f.path).at(-1)?.estimatedUsd).toBeNull();
      expect(existsSync(`${f.path}.lock`)).toBe(true);
      expect(existsSync(join(f.root, 'runner.lock'))).toBe(true);
      f.complete();
      return response();
    });
    const receipt = await executeTransportRecovery({
      permit: p,
      request,
      transport: f.transport,
      now: () => now,
    });
    expect(receipt).toMatchObject({
      outcome: 'RECOVERED',
      previousUsageCount: 7,
      preservedUnknownRecords: 3,
      studyResumed: false,
    });
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(loadRecords(f.path).slice(0, 7)).toEqual(f.records);
    expect(journal(f.path).map((r) => r.event)).toEqual([
      'consumed',
      'reserved',
      'verified-success',
      'ledger-committed',
    ]);
    for (const [suffix, original] of Object.entries(f.oldFiles))
      expect(readFileSync(f.path + suffix, 'utf8')).toBe(original);
    expect(JSON.stringify(receipt)).not.toMatch(
      /synthetic-only-transport-key|requestHash|credentialFingerprint|evidenceReference/,
    );
    expect(loadRecords(f.path).at(-1)?.episode).toBe(`transport-recovery-probe:${p.id}`);
    await expect(new StudyBudget(f.path).wrap(async () => response())(request)).resolves.toMatchObject({
      status: 200,
    });
  });
  it.each(['false', 'missing', 'http', 'throw', 'overrun'] as const)(
    'keeps a %s probe charged and circuit-blocked',
    async (kind) => {
      const f = await fixture();
      const p = await prepareTransportRecovery(f.input);
      f.activate(p);
      f.transport.mockImplementationOnce(async () => {
        f.complete();
        if (kind === 'throw') throw new Error('private provider text never copied');
        const r = response();
        if (kind === 'false') (r.json as any).candidates[0].content.parts[0].text = '{"ok":false}';
        if (kind === 'missing') delete (r.json as any).usageMetadata;
        if (kind === 'http') r.status = 503;
        if (kind === 'overrun')
          (r.json as any).usageMetadata = {
            promptTokenCount: 1000000,
            candidatesTokenCount: 5,
            totalTokenCount: 1000005,
          };
        return r;
      });
      const receipt = await executeTransportRecovery({
        permit: p,
        request,
        transport: f.transport,
        now: () => now,
      });
      expect(receipt.outcome).not.toBe('RECOVERED');
      const after = loadRecords(f.path);
      expect(after).toHaveLength(8);
      expect(after.slice(0, 7)).toEqual(f.records);
      expect(after.at(-1)?.estimatedUsd).toBeNull();
      expect(after.at(-1)!.reserveUsd).toBeGreaterThanOrEqual(transportProbeQuote(request));
      if (kind === 'overrun') expect(after.at(-1)!.reserveUsd).toBeCloseTo(0.3000125, 10);
      const forbidden = vi.fn(async () => response());
      await expect(new StudyBudget(f.path).wrap(forbidden)(request)).rejects.toThrow('PROVIDER_CIRCUIT_OPEN');
      expect(forbidden).not.toHaveBeenCalled();
      await expect(prepareTransportRecovery(f.input)).rejects.toThrow('IN_USE'); // Sole owner is still active.
      unlinkSync(join(f.root, 'pump-owner.lock'));
      await expect(prepareTransportRecovery(f.input)).rejects.toThrow('ALREADY_CONSUMED');
      expect(f.transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['consumed', 'reserved', 'verified', 'ledger-completed'] as const)(
    'is crash-closed at %s until fully validated evidence exists',
    async (point) => {
      const f = await fixture();
      const p = await prepareTransportRecovery(f.input);
      f.activate(p);
      await expect(
        executeTransportRecovery({
          permit: p,
          request,
          transport: f.transport,
          now: () => now,
          checkpoint: (at) => {
            if (at === point) throw new Error('simulated crash');
          },
        }),
      ).rejects.toThrow('simulated crash');
      expect(loadRecords(f.path).slice(0, 7)).toEqual(f.records);
      const normal = vi.fn(async () => response());
      if (point === 'ledger-completed') {
        expect(journal(f.path).at(-1).event).toBe('verified-success');
        await expect(new StudyBudget(f.path).wrap(normal)(request)).resolves.toMatchObject({ status: 200 });
      } else {
        await expect(new StudyBudget(f.path).wrap(normal)(request)).rejects.toThrow('PROVIDER_CIRCUIT_OPEN');
        expect(normal).not.toHaveBeenCalled();
      }
      await expect(
        executeTransportRecovery({ permit: p, request, transport: f.transport, now: () => now }),
      ).rejects.toThrow();
      expect(f.transport.mock.calls.length).toBe(point === 'consumed' || point === 'reserved' ? 0 : 1);
    },
  );
  it.each(['usage.json.lock', 'runner.lock', 'pump-owner.lock'])(
    'rejects prepare with existing %s without removing it',
    async (name) => {
      const f = await fixture();
      const lock = join(f.root, name);
      writeFileSync(lock, 'existing owner');
      await expect(prepareTransportRecovery(f.input)).rejects.toThrow('IN_USE');
      expect(readFileSync(lock, 'utf8')).toBe('existing owner');
    },
  );
  it.each(['ready', 'claimed'])('rejects outstanding %s work without touching history', async (suffix) => {
    const f = await fixture();
    mkdirSync(join(f.root, 'queue'));
    writeFileSync(join(f.root, 'queue', `pending.${suffix}`), '{}');
    await expect(prepareTransportRecovery(f.input)).rejects.toThrow('OUTSTANDING_WORK');
    expect(loadRecords(f.path)).toEqual(f.records);
    expect(existsSync(`${f.path}.lock`)).toBe(false);
  });
  it.each(['missing', 'wrong', 'already-used'] as const)(
    'requires the exact fresh dispatcher: %s',
    async (kind) => {
      const f = await fixture();
      const p = await prepareTransportRecovery(f.input);
      if (kind !== 'missing') f.activate(p);
      if (kind === 'wrong') writeFileSync(join(f.root, 'pump-owner.lock'), 'another-dispatcher');
      if (kind === 'already-used') f.complete();
      await expect(
        executeTransportRecovery({ permit: p, request, transport: f.transport, now: () => now }),
      ).rejects.toThrow('DISPATCHER');
      expect(f.transport).not.toHaveBeenCalled();
      expect(loadRecords(f.path)).toEqual(f.records);
    },
  );
  it('withholds success if dispatcher ownership changes during the request', async () => {
    const f = await fixture();
    const p = await prepareTransportRecovery(f.input);
    f.activate(p);
    f.transport.mockImplementationOnce(async () => {
      f.complete();
      writeFileSync(join(f.root, 'pump-owner.lock'), 'wrong');
      return response();
    });
    await expect(
      executeTransportRecovery({ permit: p, request, transport: f.transport, now: () => now }),
    ).rejects.toThrow('DISPATCHER_MISMATCH');
    expect(loadRecords(f.path).at(-1)?.estimatedUsd).toBeNull();
    await expect(new StudyBudget(f.path).wrap(async () => response())(request)).rejects.toThrow(
      'CIRCUIT_OPEN',
    );
  });
  it('permits only one concurrent executor', async () => {
    const f = await fixture();
    const p = await prepareTransportRecovery(f.input);
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
    const first = executeTransportRecovery({ permit: p, request, transport: f.transport, now: () => now });
    await started;
    await expect(
      executeTransportRecovery({ permit: p, request, transport: f.transport, now: () => now }),
    ).rejects.toThrow('IN_USE');
    release();
    await first;
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each(['usage', 'policy', 'marker', 'quota-journal'] as const)(
    'fails closed on corrupt %s',
    async (kind) => {
      const f = await fixture();
      const path =
        kind === 'usage'
          ? f.path
          : f.path +
            (
              {
                policy: '.study-policy.json',
                marker: '.study-policy-required.json',
                'quota-journal': '.recovery.json',
              } as const
            )[kind];
      writeFileSync(path, '{broken');
      await expect(prepareTransportRecovery(f.input)).rejects.toThrow(/RESEARCH_/);
      expect(readFileSync(path, 'utf8')).toBe('{broken');
      expect(f.transport).not.toHaveBeenCalled();
    },
  );
  it('rejects changed key, request, history and expired permission before any transport', async () => {
    const f = await fixture();
    await expect(
      prepareTransportRecovery({ ...f.input, request: quotaProbeRequest('wrong-key') }),
    ).rejects.toThrow('KEY_MISMATCH');
    const p = await prepareTransportRecovery(f.input);
    f.activate(p);
    await expect(
      executeTransportRecovery({
        permit: p,
        request: quotaProbeRequest('wrong-key'),
        transport: f.transport,
        now: () => now,
      }),
    ).rejects.toThrow('REQUEST_CHANGED');
    await expect(
      executeTransportRecovery({ permit: p, request, transport: f.transport, now: () => now + 3600000 }),
    ).rejects.toThrow('AUTHORIZATION_TIME');
    atomicJson(f.path, [...f.records, { ...f.records[0], id: randomUUID() }]);
    await expect(
      executeTransportRecovery({ permit: p, request, transport: f.transport, now: () => now }),
    ).rejects.toThrow('HISTORY_CHANGED');
    expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([{ gemini: 0.03 }, { attempts: 3 }])('enforces existing additional limits %j', async (options) => {
    const f = await fixture(options);
    await expect(prepareTransportRecovery(f.input)).rejects.toThrow('EXHAUSTED');
    expect(f.transport).not.toHaveBeenCalled();
    expect(loadRecords(f.path)).toEqual(f.records);
  });
  it('enforces the original global ceiling even when the additional allowance remains', async () => {
    const f = await fixture({ priorCost: 9.96, suffixCost: 0.003 });
    await expect(prepareTransportRecovery(f.input)).rejects.toThrow('GLOBAL_ALLOWANCE');
    expect(loadRecords(f.path)).toEqual(f.records);
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('refuses missing usage without recreating history', async () => {
    const f = await fixture();
    unlinkSync(f.path);
    await expect(prepareTransportRecovery(f.input)).rejects.toThrow('STATE_MISSING');
    expect(existsSync(f.path)).toBe(false);
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('binds the frozen artifacts and does not accept changed episode evidence', async () => {
    const f = await fixture();
    const p = await prepareTransportRecovery(f.input);
    f.activate(p);
    writeFileSync(join(f.runDirectory, 'episodes.jsonl'), '\n');
    await expect(
      executeTransportRecovery({ permit: p, request, transport: f.transport, now: () => now }),
    ).rejects.toThrow('BINDING_CHANGED');
    expect(f.transport).not.toHaveBeenCalled();
    expect(loadRecords(f.path)).toEqual(f.records);
  });
  it('rechecks the complete runtime source after transport before publishing success', async () => {
    const f = await fixture();
    const p = await prepareTransportRecovery(f.input);
    f.activate(p);
    const original = sourceManifest();
    vi.spyOn(manifestModule, 'sourceManifest')
      .mockReturnValueOnce(original)
      .mockReturnValueOnce({ ...original, hash: '0'.repeat(64) });
    await expect(
      executeTransportRecovery({ permit: p, request, transport: f.transport, now: () => now }),
    ).rejects.toThrow('FROZEN_SOURCE_CHANGED');
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(loadRecords(f.path).at(-1)?.estimatedUsd).toBeNull();
    expect(journal(f.path).map((r) => r.event)).toEqual(['consumed', 'reserved']);
  });
  it('treats a partial completion footer as outstanding work', async () => {
    const f = await fixture();
    mkdirSync(join(f.root, 'queue'));
    writeFileSync(join(f.root, 'queue', 'partial.claimed'), '{}');
    writeFileSync(join(f.root, 'queue', 'partial.done'), '200 0.1 0');
    await expect(prepareTransportRecovery(f.input)).rejects.toThrow('OUTSTANDING_WORK');
    expect(loadRecords(f.path)).toEqual(f.records);
  });
  it('does not accept quota or model failures as a transport-stall incident', async () => {
    const f = await fixture();
    const changed = structuredClone(f.records);
    changed.at(-1)!.status = 429;
    atomicJson(f.path, changed);
    await expect(prepareTransportRecovery(f.input)).rejects.toThrow('INCIDENT_MISMATCH');
    atomicJson(f.path, f.records);
    writeFileSync(
      join(f.runDirectory, 'episodes.jsonl'),
      f.records
        .slice(-3)
        .map((r) => JSON.stringify({ id: r.episode, status: 'error', error: 'MODEL_UNAVAILABLE' }))
        .join('\n'),
    );
    await expect(prepareTransportRecovery(f.input)).rejects.toThrow('TIMEOUT_NOT_RECORDED');
  });
});
