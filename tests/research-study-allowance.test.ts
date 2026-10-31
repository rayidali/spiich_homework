import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyBudget, type UsageRecord } from '../research/budget';
import {
  assertStudyAllowanceReservation,
  createKeyCheckPolicy,
  createStudyAllowancePolicy,
  type StudyAllowanceOptions,
} from '../research/budget-policy';
import { atomicJson } from '../research/io';
import {
  createQuotaRecoveryPermit,
  credentialFingerprint,
  quotaProbeRequest,
  recoveryHash,
  type RecoveryAuthorization,
} from '../research/recovery';
import type { ResearchRequest, ResearchResponse } from '../research/providers/transport';

const directories: string[] = [];
const now = Date.parse('2026-10-30T23:05:00Z');
const key = 'synthetic-tested-key';
const request = quotaProbeRequest(key);
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
  evidenceReference: 'synthetic authorized key check',
  keyChange: {
    observedAt: '2026-10-30T23:01:00Z',
    previousFingerprint: credentialFingerprint('synthetic-old-key'),
    currentFingerprint: credentialFingerprint(key),
  },
};
const options = (overrides: Partial<StudyAllowanceOptions> = {}): StudyAllowanceOptions => ({
  authorizationReference: 'synthetic explicit user approval to resume with bounded study spending',
  credentialFingerprint: credentialFingerprint(key),
  additionalAllowanceUsd: { gemini: 6.4, jev: 0.1 },
  maximumAdditionalAttempts: 7000,
  ...overrides,
});
const response = (): ResearchResponse => ({
  status: 200,
  elapsedMs: 10,
  json: {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }],
    usageMetadata: { promptTokenCount: 14, candidatesTokenCount: 5, totalTokenCount: 19 },
  },
});
const reserve = ((Buffer.byteLength(JSON.stringify(request.body)) + 2048) * 0.3 + 128 * 2.5) / 1e6;
async function fixture(state: 'success' | 'pending' | 'failed' | 'unconsumed' = 'success') {
  const directory = mkdtempSync(join(tmpdir(), 'daybook-study-allowance-'));
  directories.push(directory);
  const path = join(directory, 'usage.json');
  const initial: UsageRecord[] = Array.from({ length: 3 }, (_, index) => ({
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
  atomicJson(path, initial);
  const budget = new StudyBudget(path);
  const parent = await budget.installKeyCheckPolicy(authorization.evidenceReference, now);
  const permit = createQuotaRecoveryPermit({
    records: initial,
    request,
    quotaEvidence: evidence,
    authorization,
    limits: budget.limits,
    policy: parent,
    now,
  });
  if (state === 'pending')
    atomicJson(`${path}.recovery.json`, [
      { permit, recordId: randomUUID(), state: 'pending', consumedAt: new Date(now).toISOString() },
    ]);
  else if (state !== 'unconsumed')
    await budget.recoverQuota({
      permit,
      request,
      quotaEvidence: evidence,
      authorization,
      now: () => now,
      transport: async () => {
        if (state === 'failed') throw new Error('synthetic timeout');
        return response();
      },
    });
  const transport = vi.fn(async () => response());
  return { directory, path, budget, parent, transport, before: structuredClone(budget.records) };
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('audited allowance after the consumed fixed key check', () => {
  it('retains every original artifact and enables bounded study calls across restarts', async () => {
    const f = await fixture();
    const historical = Object.fromEntries(
      ['', '.policy.json', '.policy-required.json', '.recovery.json'].map((suffix) => [
        suffix,
        readFileSync(`${f.path}${suffix}`, 'utf8'),
      ]),
    );
    const policy = await f.budget.installStudyAllowance(options(), now);
    expect(policy).toMatchObject({
      baselineCount: 4,
      baselineHash: recoveryHash(f.before),
      parentPolicyHash: recoveryHash(f.parent),
      additionalAllowanceUsd: { gemini: 6.4, jev: 0.1 },
      maximumAdditionalAttempts: 7000,
      globalCeilingUsd: { gemini: 10, jev: 4 },
      mode: 'bounded-study-allowance',
    });
    for (const [suffix, bytes] of Object.entries(historical))
      expect(readFileSync(`${f.path}${suffix}`, 'utf8')).toBe(bytes);
    expect(f.transport).not.toHaveBeenCalled();
    const restarted = new StudyBudget(f.path);
    expect(restarted.studyAllowancePolicy()).toEqual(policy);
    await expect(restarted.wrap(f.transport)(request)).resolves.toMatchObject({ status: 200 });
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(restarted.records.slice(0, policy.baselineCount)).toEqual(f.before);
    await expect(restarted.installStudyAllowance(options(), now)).rejects.toThrow('ALREADY_INSTALLED');
    for (const suffix of ['.policy.json', '.policy-required.json', '.recovery.json'])
      expect(readFileSync(`${f.path}${suffix}`, 'utf8')).toBe(historical[suffix]);
  });
  it.each(['pending', 'failed', 'unconsumed'] as const)(
    'refuses transition from %s key-check state',
    async (state) => {
      const f = await fixture(state);
      await expect(f.budget.installStudyAllowance(options(), now)).rejects.toThrow(
        /RECOVERY_NOT_RELEASED|INVALID_TRANSITION/,
      );
      expect(existsSync(`${f.path}.study-policy.json`)).toBe(false);
      expect(f.transport).not.toHaveBeenCalled();
    },
  );
  it('requires the successfully checked key and refuses an active runner', async () => {
    const f = await fixture();
    await expect(
      f.budget.installStudyAllowance(
        options({ credentialFingerprint: credentialFingerprint('untested-key') }),
        now,
      ),
    ).rejects.toThrow('KEY_MISMATCH');
    writeFileSync(join(f.directory, 'runner.lock'), String(process.pid));
    await expect(f.budget.installStudyAllowance(options(), now)).rejects.toThrow('RUNNER_ACTIVE');
    expect(existsSync(`${f.path}.study-policy.json`)).toBe(false);
  });
  it.each([
    'generate',
    'critic',
    'embed',
    'file-search-query',
    'file-store',
    'file-index',
    'file-poll',
  ] as const)('checks the credential on every Gemini %s call before transport', async (kind) => {
    const f = await fixture();
    await f.budget.installStudyAllowance(options(), now);
    const altered = {
      ...request,
      kind,
      headers: { ...request.headers, 'x-goog-api-key': 'wrong-synthetic-key' },
    };
    await expect(new StudyBudget(f.path).wrap(f.transport)(altered)).rejects.toThrow('KEY_MISMATCH');
    expect(f.transport).not.toHaveBeenCalled();
    expect(new StudyBudget(f.path).records).toEqual(f.before);
  });
  it('preserves model restrictions, including the pinned Jev version', async () => {
    const f = await fixture();
    await f.budget.installStudyAllowance(options(), now);
    await expect(f.budget.wrap(f.transport)({ ...request, model: 'unpriced-model' })).rejects.toThrow(
      'UNPRICED_MODEL',
    );
    await expect(
      f.budget.wrap(f.transport)({
        ...request,
        provider: 'jev',
        model: 'jev-unapproved',
        kind: 'jev-verify',
      }),
    ).rejects.toThrow('MODEL_FORBIDDEN');
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('stops at the new attempt cap with a runner-compatible budget error', async () => {
    const f = await fixture();
    await f.budget.installStudyAllowance(options({ maximumAdditionalAttempts: 1 }), now);
    await f.budget.wrap(f.transport)(request);
    await expect(new StudyBudget(f.path).wrap(f.transport)(request)).rejects.toThrow(
      'RESEARCH_BUDGET_EXHAUSTED_STUDY_ATTEMPTS',
    );
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('keeps unknown usage reserved and counts it against the additional monetary ceiling', async () => {
    const f = await fixture();
    await f.budget.installStudyAllowance(
      options({ additionalAllowanceUsd: { gemini: reserve * 1.5, jev: 0.1 } }),
      now,
    );
    f.transport.mockRejectedValue(new Error('synthetic timeout'));
    await expect(f.budget.wrap(f.transport)(request)).rejects.toThrow('synthetic timeout');
    const restarted = new StudyBudget(f.path);
    expect(restarted.records.at(-1)?.estimatedUsd).toBeNull();
    expect(restarted.records.at(-1)?.reserveUsd).toBeCloseTo(reserve, 12);
    await expect(restarted.wrap(f.transport)(request)).rejects.toThrow(
      'RESEARCH_BUDGET_EXHAUSTED_STUDY_ALLOWANCE',
    );
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(restarted.records.slice(0, 4)).toEqual(f.before);
  });
  it('retains the unknown-use circuit even with a larger study allowance', async () => {
    const f = await fixture();
    await f.budget.installStudyAllowance(options(), now);
    f.transport.mockRejectedValue(new Error('synthetic timeout'));
    for (let i = 0; i < 3; i++)
      await expect(f.budget.wrap(f.transport)(request)).rejects.toThrow('synthetic timeout');
    await expect(new StudyBudget(f.path).wrap(f.transport)(request)).rejects.toThrow(
      'RESEARCH_PROVIDER_CIRCUIT_OPEN',
    );
    expect(f.transport).toHaveBeenCalledTimes(3);
  });
  it('honors Jev-specific allowance without spending the Gemini allowance', async () => {
    const f = await fixture();
    await f.budget.installStudyAllowance(
      options({ additionalAllowanceUsd: { gemini: 6.4, jev: 0.00000001 } }),
      now,
    );
    const jev: ResearchRequest = { ...request, provider: 'jev', model: 'jev-1.14.0', kind: 'jev-verify' };
    await expect(f.budget.wrap(f.transport)(jev)).rejects.toThrow('BUDGET_EXHAUSTED_STUDY_ALLOWANCE');
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('keeps the original global ceiling even if a caller supplies a larger constructor limit', () => {
    const previous = {
      id: randomUUID(),
      episode: 'prior',
      provider: 'gemini',
      kind: 'generate',
      model: 'gemini-3.5-flash-lite',
      at: new Date(now).toISOString(),
      reserveUsd: 9.99,
      estimatedUsd: null,
      status: 429,
      inputTokens: null,
      outputTokens: null,
      durationMs: 10,
    } as UsageRecord;
    const parent = createKeyCheckPolicy([previous], 'synthetic', now);
    const records = [
      previous,
      {
        ...previous,
        id: randomUUID(),
        reserveUsd: 0.001,
        estimatedUsd: 0.0000167,
        status: 200,
        inputTokens: 14,
        outputTokens: 5,
      },
    ];
    const policy = createStudyAllowancePolicy(records, parent, options(), now);
    expect(() =>
      assertStudyAllowanceReservation({ policy, parent, records, request, reserveUsd: 0.02 }),
    ).toThrow('BUDGET_EXHAUSTED_GLOBAL_ALLOWANCE');
  });
});

describe('persistent policy corruption and incomplete writes fail closed', () => {
  it.each([
    'policy_only',
    'marker_only',
    'wrong_marker',
    'corrupt_policy',
    'missing_parent',
    'corrupt_parent',
    'changed_history',
    'truncated_history',
    'corrupt_recovery',
  ])('rejects %s without a provider call or allowance reset', async (failure) => {
    const f = await fixture();
    await f.budget.installStudyAllowance(options(), now);
    if (failure === 'policy_only') unlinkSync(`${f.path}.study-policy-required.json`);
    if (failure === 'marker_only') unlinkSync(`${f.path}.study-policy.json`);
    if (failure === 'wrong_marker')
      atomicJson(`${f.path}.study-policy-required.json`, {
        schemaVersion: 1,
        policyId: randomUUID(),
        policyHash: '0'.repeat(64),
        parentPolicyHash: '0'.repeat(64),
      });
    if (failure === 'corrupt_policy') writeFileSync(`${f.path}.study-policy.json`, '{private-corruption');
    if (failure === 'missing_parent') unlinkSync(`${f.path}.policy.json`);
    if (failure === 'corrupt_parent') writeFileSync(`${f.path}.policy.json`, '{private-corruption');
    if (failure === 'changed_history')
      atomicJson(
        f.path,
        f.before.map((row, i) => (i === 0 ? { ...row, reserveUsd: 0 } : row)),
      );
    if (failure === 'truncated_history') atomicJson(f.path, f.before.slice(0, -1));
    if (failure === 'corrupt_recovery') writeFileSync(`${f.path}.recovery.json`, '{private-corruption');
    await expect(new StudyBudget(f.path).wrap(f.transport)(request)).rejects.toThrow(
      /RESEARCH_(POLICY|STUDY_POLICY|RECOVERY)_/,
    );
    expect(f.transport).not.toHaveBeenCalled();
    await expect(f.budget.installStudyAllowance(options(), now)).rejects.toThrow('ALREADY_INSTALLED');
  });
  it('falls back to the old blocking policy if both new artifacts disappear', async () => {
    const f = await fixture();
    await f.budget.installStudyAllowance(options(), now);
    unlinkSync(`${f.path}.study-policy.json`);
    unlinkSync(`${f.path}.study-policy-required.json`);
    await expect(new StudyBudget(f.path).wrap(f.transport)(request)).rejects.toThrow('PROBE_ONLY');
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('does not recreate missing or corrupt usage history from an older snapshot', async () => {
    const f = await fixture();
    await f.budget.installStudyAllowance(options(), now);
    unlinkSync(f.path);
    expect(() => new StudyBudget(f.path)).toThrow('BUDGET_STATE_MISSING');
    await expect(f.budget.wrap(f.transport)(request)).rejects.toThrow('BUDGET_STATE_MISSING');
    expect(existsSync(f.path)).toBe(false);
    writeFileSync(f.path, '{private-history-corruption');
    await expect(f.budget.wrap(f.transport)(request)).rejects.toThrow('BUDGET_STATE_INVALID');
    expect(readFileSync(f.path, 'utf8')).toBe('{private-history-corruption');
    expect(f.transport).not.toHaveBeenCalled();
  });
});
