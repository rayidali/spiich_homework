import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyBudget, type UsageRecord } from '../research/budget';
import { assertKeyCheckReservation, createKeyCheckPolicy } from '../research/budget-policy';
import { atomicJson } from '../research/io';
import {
  createQuotaRecoveryPermit,
  credentialFingerprint,
  quotaProbeRequest,
  recoveryHash,
  type RecoveryAuthorization,
} from '../research/recovery';
import type { ResearchResponse } from '../research/providers/transport';

const directories: string[] = [];
const now = Date.parse('2026-10-30T23:05:00Z');
const request = quotaProbeRequest('synthetic-new-key');
const evidence = {
  runId: 'synthetic-pilot',
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
const authorization: RecoveryAuthorization = {
  reason: 'user_configured_key_change',
  confirmedAt: '2026-10-30T23:00:00Z',
  notBefore: '2026-10-30T23:00:00Z',
  expiresAt: '2026-10-30T23:30:00Z',
  evidenceReference: 'synthetic user asks to check their changed key',
  keyChange: {
    observedAt: '2026-10-30T23:01:00Z',
    previousFingerprint: credentialFingerprint('synthetic-old-key'),
    currentFingerprint: credentialFingerprint('synthetic-new-key'),
  },
};
const response = (): ResearchResponse => ({
  status: 200,
  elapsedMs: 10,
  json: {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4, totalTokenCount: 15 },
  },
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'daybook-key-check-'));
  directories.push(directory);
  const path = join(directory, 'usage.json');
  const records: UsageRecord[] = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(),
    episode: `synthetic-pilot:R${index}:q:0`,
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
  atomicJson(path, records);
  const budget = new StudyBudget(path);
  const transport = vi.fn(async () => response());
  return { directory, path, records, budget, transport };
}
async function prepared() {
  const f = fixture();
  const policy = await f.budget.installKeyCheckPolicy(authorization.evidenceReference, now);
  const permit = createQuotaRecoveryPermit({
    records: f.records,
    request,
    quotaEvidence: evidence,
    authorization,
    limits: f.budget.limits,
    policy,
    now,
  });
  return {
    ...f,
    policy,
    permit,
    input: {
      permit,
      request,
      quotaEvidence: evidence,
      authorization,
      transport: f.transport,
      now: () => now,
    },
  };
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('one-request, one-cent changed-key check', () => {
  it('installs a fixed persistent restriction without changing history or making a request', async () => {
    const f = fixture();
    const before = readFileSync(f.path, 'utf8');
    const policy = await f.budget.installKeyCheckPolicy(authorization.evidenceReference, now);
    expect(policy).toMatchObject({
      mode: 'fixed-key-probe-only',
      baselineCount: 3,
      baselineHash: recoveryHash(f.records),
      baselineSpendUsd: { gemini: 0.03, jev: 0 },
      additionalAllowanceUsd: { gemini: 0.01, jev: 0 },
      maximumAdditionalAttempts: 1,
    });
    expect(readFileSync(f.path, 'utf8')).toBe(before);
    expect(new StudyBudget(f.path).keyCheckPolicy()).toEqual(policy);
    expect(f.transport).not.toHaveBeenCalled();
    await expect(f.budget.installKeyCheckPolicy('another call', now)).rejects.toThrow('ALREADY_INSTALLED');
  });
  it('allows only the fixed probe before the old quota reset and blocks ordinary calls after success', async () => {
    const f = await prepared();
    const receipt = await f.budget.recoverQuota(f.input);
    expect(receipt).toMatchObject({
      outcome: 'RECOVERED',
      authorizationReason: 'user_configured_key_change',
      preservedUnknownRecords: 3,
    });
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.budget.records.slice(0, 3)).toEqual(f.records);
    expect(f.budget.spend('gemini')).toBeGreaterThan(0.03);
    expect(f.budget.records[3].reserveUsd).toBeLessThanOrEqual(0.01);
    const restarted = new StudyBudget(f.path); // Default legacy $10 limit cannot bypass installed policy.
    expect(restarted.limits.gemini).toBe(10);
    await expect(restarted.wrap(f.transport)(request)).rejects.toThrow('PROBE_ONLY');
    await expect(restarted.recoverQuota(f.input)).rejects.toThrow('ALREADY_CONSUMED');
    await expect(
      restarted.wrap(f.transport)({ ...request, provider: 'jev', model: 'jev-1.14.0', kind: 'jev-verify' }),
    ).rejects.toThrow('PROBE_ONLY');
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(receipt)).not.toContain('Fingerprint');
    expect(JSON.stringify(receipt)).not.toContain('policyHash');
    expect(JSON.stringify(receipt)).not.toContain('synthetic-new-key');
  });
  it('retains an unknown probe reservation and consumes the only permitted attempt', async () => {
    const f = await prepared();
    f.transport.mockRejectedValue(new Error('synthetic timeout'));
    const receipt = await f.budget.recoverQuota(f.input);
    expect(receipt.outcome).toBe('TRANSPORT_ERROR');
    const restarted = new StudyBudget(f.path);
    expect(restarted.records[3].estimatedUsd).toBeNull();
    expect(restarted.spend('gemini')).toBeCloseTo(0.03 + restarted.records[3].reserveUsd, 12);
    expect(() =>
      assertKeyCheckReservation({
        policy: f.policy,
        records: restarted.records,
        provider: 'gemini',
        kind: 'generate',
        reserveUsd: 0.00001,
        isProbe: true,
      }),
    ).toThrow('ATTEMPTS_EXHAUSTED');
    await expect(restarted.wrap(f.transport)(request)).rejects.toThrow('NOT_RELEASED');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('does not lift smaller original monetary caps', async () => {
    const f = fixture();
    const budget = new StudyBudget(f.path, { gemini: 0.030001, jev: 4, attempts: 10000 });
    const policy = await budget.installKeyCheckPolicy(authorization.evidenceReference, now);
    const permit = createQuotaRecoveryPermit({
      records: f.records,
      request,
      quotaEvidence: evidence,
      authorization,
      limits: budget.limits,
      policy,
      now,
    });
    await expect(
      budget.recoverQuota({
        permit,
        request,
        quotaEvidence: evidence,
        authorization,
        transport: f.transport,
        now: () => now,
      }),
    ).rejects.toThrow('BUDGET_EXHAUSTED');
    expect(f.transport).not.toHaveBeenCalled();
    expect(existsSync(`${f.path}.recovery.json`)).toBe(false);
  });
  it('refuses a reservation beyond one cent and rejects non-probe providers and kinds', () => {
    const f = fixture();
    const policy = createKeyCheckPolicy(f.records, authorization.evidenceReference, now);
    expect(() =>
      assertKeyCheckReservation({
        policy,
        records: f.records,
        provider: 'gemini',
        kind: 'generate',
        reserveUsd: 0.010001,
        isProbe: true,
      }),
    ).toThrow('ALLOWANCE_EXHAUSTED');
    for (const options of [
      { provider: 'gemini' as const, kind: 'embed', isProbe: true },
      { provider: 'jev' as const, kind: 'jev-verify', isProbe: true },
      { provider: 'gemini' as const, kind: 'generate', isProbe: false },
    ])
      expect(() =>
        assertKeyCheckReservation({ policy, records: f.records, reserveUsd: 0, ...options }),
      ).toThrow('PROBE_ONLY');
  });
  it.each(['missing_policy', 'missing_marker', 'malformed_policy', 'changed_marker', 'changed_baseline'])(
    'fails closed on %s across process reconstruction',
    async (failure) => {
      const f = await prepared();
      if (failure === 'missing_policy') unlinkSync(`${f.path}.policy.json`);
      if (failure === 'missing_marker') unlinkSync(`${f.path}.policy-required.json`);
      if (failure === 'malformed_policy') writeFileSync(`${f.path}.policy.json`, '{broken');
      if (failure === 'changed_marker')
        atomicJson(`${f.path}.policy-required.json`, {
          schemaVersion: 1,
          policyId: randomUUID(),
          policyHash: '0'.repeat(64),
        });
      if (failure === 'changed_baseline')
        atomicJson(
          f.path,
          f.records.map((record, i) => (i === 0 ? { ...record, estimatedUsd: 0 } : record)),
        );
      await expect(new StudyBudget(f.path).recoverQuota(f.input)).rejects.toThrow();
      expect(f.transport).not.toHaveBeenCalled();
    },
  );
  it('uses the recovery journal anchor if both policy files disappear after a successful check', async () => {
    const f = await prepared();
    await f.budget.recoverQuota(f.input);
    unlinkSync(`${f.path}.policy.json`);
    unlinkSync(`${f.path}.policy-required.json`);
    await expect(new StudyBudget(f.path).wrap(f.transport)(request)).rejects.toThrow('POLICY_MISSING');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
});

describe('truthful key-change evidence', () => {
  it.each([
    'no_evidence',
    'same_key',
    'wrong_current_key',
    'future_observation',
    'stale_observation',
    'no_policy',
  ])('refuses %s with no provider call', async (failure) => {
    const f = await prepared();
    const auth = structuredClone(authorization);
    if (failure === 'no_evidence') delete auth.keyChange;
    if (failure === 'same_key') auth.keyChange!.previousFingerprint = auth.keyChange!.currentFingerprint;
    if (failure === 'wrong_current_key')
      auth.keyChange!.currentFingerprint = credentialFingerprint('different-synthetic-key');
    if (failure === 'future_observation') auth.keyChange!.observedAt = '2026-10-31T23:00:00Z';
    if (failure === 'stale_observation') auth.keyChange!.observedAt = '2026-10-30T22:00:00Z';
    expect(() =>
      createQuotaRecoveryPermit({
        records: f.records,
        request,
        quotaEvidence: evidence,
        authorization: auth,
        limits: f.budget.limits,
        policy: failure === 'no_policy' ? undefined : f.policy,
        now,
      }),
    ).toThrow(/KEY_CHANGE_UNVERIFIED|RESTRICTIVE_POLICY_REQUIRED/);
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('binds the private policy as well as the existing request and historical evidence', async () => {
    const f = await prepared();
    const changed = { ...f.permit, policyHash: '0'.repeat(64) };
    await expect(f.budget.recoverQuota({ ...f.input, permit: changed })).rejects.toThrow('POLICY_CHANGED');
    expect(f.transport).not.toHaveBeenCalled();
    expect(existsSync(`${f.path}.recovery.json`)).toBe(false);
  });
});
