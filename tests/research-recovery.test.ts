import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyBudget, type UsageRecord } from '../research/budget';
import { atomicJson } from '../research/io';
import {
  createQuotaRecoveryPermit,
  documentedQuotaResetAfter,
  quotaProbeRequest,
  recoveryHash,
  type RecoveryAuthorization,
  type RecoveryJournalEntry,
} from '../research/recovery';
import type { ResearchResponse } from '../research/providers/transport';

const directories: string[] = [];
const now = Date.parse('2026-10-31T07:05:00Z');
const request = quotaProbeRequest('synthetic-private-key');
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
  reason: 'documented_daily_quota_reset',
  confirmedAt: '2026-10-30T23:00:00Z',
  notBefore: '2026-10-31T07:01:00Z',
  expiresAt: '2026-10-31T07:31:00Z',
  evidenceReference: 'synthetic explicit operator decision after documented reset',
};
const response = (): ResearchResponse => ({
  status: 200,
  elapsedMs: 12,
  json: {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }] } }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4, totalTokenCount: 15 },
  },
});
function fixture(limits = { gemini: 10, jev: 4, attempts: 10000 }) {
  const directory = mkdtempSync(join(tmpdir(), 'daybook-recovery-'));
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
  const budget = new StudyBudget(path, limits);
  const permit = createQuotaRecoveryPermit({
    records,
    request,
    quotaEvidence: evidence,
    authorization,
    limits,
    now,
  });
  const transport = vi.fn(async () => response());
  const input = { permit, request, quotaEvidence: evidence, authorization, transport, now: () => now };
  return { directory, path, records, budget, permit, transport, input };
}
function journal(path: string): RecoveryJournalEntry[] {
  return JSON.parse(readFileSync(`${path}.recovery.json`, 'utf8'));
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('explicit one-shot quota recovery', () => {
  it('reserves under the lock after consuming the permit and preserves all historical costs', async () => {
    const f = fixture();
    const original = recoveryHash(f.records);
    f.transport.mockImplementationOnce(async () => {
      expect(journal(f.path)[0].state).toBe('pending');
      expect(existsSync(`${f.path}.lock`)).toBe(true);
      const records = JSON.parse(readFileSync(f.path, 'utf8')) as UsageRecord[];
      expect(records).toHaveLength(4);
      expect(records[3].estimatedUsd).toBeNull();
      expect(records[3].reserveUsd).toBeGreaterThan(0);
      expect(recoveryHash(records.slice(0, 3))).toBe(original);
      return response();
    });
    const receipt = await f.budget.recoverQuota(f.input);
    expect(receipt).toMatchObject({
      outcome: 'RECOVERED',
      status: 200,
      inputTokens: 11,
      outputTokens: 4,
      preservedUnknownRecords: 3,
    });
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(recoveryHash(f.budget.records.slice(0, 3))).toBe(original);
    expect(f.budget.spend('gemini')).toBeGreaterThan(0.03);
    expect(journal(f.path)[0].state).toBe('succeeded');
    expect(JSON.stringify(receipt)).not.toContain('synthetic-private-key');
    expect(JSON.stringify(receipt)).not.toContain('requestHash');
    expect(JSON.stringify(receipt)).not.toContain('evidenceReference');
    await expect(f.budget.wrap(f.transport)(request)).resolves.toMatchObject({ status: 200 });
    expect(f.transport).toHaveBeenCalledTimes(2);
  });
  it('keeps the original open circuit closed until explicit recovery', async () => {
    const f = fixture();
    await expect(f.budget.wrap(f.transport)(request)).rejects.toThrow('RESEARCH_PROVIDER_CIRCUIT_OPEN');
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('accepts benign provider signatures and thought metadata but requires exact final output', async () => {
    const f = fixture();
    f.transport.mockResolvedValue({
      ...response(),
      json: {
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                { text: 'private internal provider reasoning', thought: true },
                { text: '{"ok":true}', thoughtSignature: 'synthetic-signature' },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 11,
          candidatesTokenCount: 4,
          thoughtsTokenCount: 2,
          totalTokenCount: 17,
        },
      },
    });
    const receipt = await f.budget.recoverQuota(f.input);
    expect(receipt.outcome).toBe('RECOVERED');
    expect(receipt.outputTokens).toBe(6);
    expect(JSON.stringify(receipt)).not.toContain('reasoning');
    expect(JSON.stringify(receipt)).not.toContain('signature');
    const config = (request.body as { generationConfig: Record<string, unknown> }).generationConfig;
    expect(config.responseFormat).toMatchObject({ text: { mimeType: 'APPLICATION_JSON' } });
    expect(config).not.toHaveProperty('responseMimeType');
    expect(config).not.toHaveProperty('responseJsonSchema');
  });
  it.each(['model', 'body', 'key'] as const)('rejects a changed %s with zero calls', async (field) => {
    const f = fixture();
    const altered = structuredClone(request);
    if (field === 'model') altered.model = 'gemini-3.1-flash-lite';
    if (field === 'body') altered.body = { contents: [] };
    if (field === 'key') altered.headers['x-goog-api-key'] = 'another-key';
    await expect(f.budget.recoverQuota({ ...f.input, request: altered })).rejects.toThrow('WRONG_REQUEST');
    expect(f.transport).not.toHaveBeenCalled();
    expect(existsSync(`${f.path}.recovery.json`)).toBe(false);
  });
  it('rejects early or expired execution without consuming the permit', async () => {
    const f = fixture();
    await expect(
      f.budget.recoverQuota({ ...f.input, now: () => Date.parse('2026-10-31T07:00:00Z') }),
    ).rejects.toThrow('TOO_EARLY');
    await expect(
      f.budget.recoverQuota({ ...f.input, now: () => Date.parse('2026-10-31T07:31:00Z') }),
    ).rejects.toThrow('INVALID_TIME');
    expect(f.transport).not.toHaveBeenCalled();
    expect(existsSync(`${f.path}.recovery.json`)).toBe(false);
  });
  it('rejects a changed or intervening usage row, evidence or authorization', async () => {
    const f = fixture();
    const added = [...f.records, { ...f.records[0], id: randomUUID() }];
    atomicJson(f.path, added);
    await expect(f.budget.recoverQuota(f.input)).rejects.toThrow('SNAPSHOT_CHANGED');
    atomicJson(f.path, f.records);
    await expect(
      f.budget.recoverQuota({ ...f.input, quotaEvidence: { ...evidence, added: true } }),
    ).rejects.toThrow('EVIDENCE_CHANGED');
    await expect(
      f.budget.recoverQuota({
        ...f.input,
        authorization: { ...authorization, evidenceReference: 'changed' },
      }),
    ).rejects.toThrow('EVIDENCE_CHANGED');
    expect(f.transport).not.toHaveBeenCalled();
  });
  it.each(['runner.lock', 'usage.json.lock'])(
    'refuses an active %s with zero transport calls',
    async (lock) => {
      const f = fixture();
      writeFileSync(join(f.directory, lock), String(process.pid));
      await expect(f.budget.recoverQuota(f.input)).rejects.toThrow(/RUNNER_ACTIVE|BUDGET_IN_USE/);
      expect(f.transport).not.toHaveBeenCalled();
    },
  );
  it('never removes a stale budget lock, preventing competing stale-lock takeovers', async () => {
    const f = fixture();
    const lock = `${f.path}.lock`;
    writeFileSync(lock, '2147483647');
    await expect(f.budget.recoverQuota(f.input)).rejects.toThrow('BUDGET_IN_USE');
    await expect(new StudyBudget(f.path).recoverQuota(f.input)).rejects.toThrow('BUDGET_IN_USE');
    await expect(f.budget.wrap(f.transport)(request)).rejects.toThrow('BUDGET_IN_USE');
    expect(readFileSync(lock, 'utf8')).toBe('2147483647');
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('does not overwrite a corrupted on-disk ledger with an older in-memory snapshot', async () => {
    const f = fixture();
    writeFileSync(f.path, '{interrupted-ledger-write');
    await expect(f.budget.recoverQuota(f.input)).rejects.toThrow();
    expect(readFileSync(f.path, 'utf8')).toBe('{interrupted-ledger-write');
    expect(f.transport).not.toHaveBeenCalled();
    expect(existsSync(`${f.path}.recovery.json`)).toBe(false);
  });
  it.each([
    { gemini: 0.030001, jev: 4, attempts: 10000 },
    { gemini: 10, jev: 4, attempts: 3 },
  ])('retains monetary and attempt caps: %j', async (limits) => {
    const f = fixture(limits);
    await expect(f.budget.recoverQuota(f.input)).rejects.toThrow('BUDGET_EXHAUSTED');
    expect(f.transport).not.toHaveBeenCalled();
    expect(existsSync(`${f.path}.recovery.json`)).toBe(false);
    expect(f.budget.records).toEqual(f.records);
  });
  it('prevents concurrent and repeated use of the same permit', async () => {
    const f = fixture();
    let release!: () => void;
    f.transport.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(response());
        }),
    );
    const first = f.budget.recoverQuota(f.input);
    await expect(new StudyBudget(f.path).recoverQuota(f.input)).rejects.toThrow('BUDGET_IN_USE');
    release();
    await first;
    await expect(f.budget.recoverQuota(f.input)).rejects.toThrow('ALREADY_CONSUMED');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('fails closed after a crash between consumption and reservation', async () => {
    const f = fixture();
    atomicJson(`${f.path}.recovery.json`, [
      { permit: f.permit, recordId: randomUUID(), state: 'pending', consumedAt: new Date(now).toISOString() },
    ]);
    await expect(f.budget.recoverQuota(f.input)).rejects.toThrow('ALREADY_CONSUMED');
    const other = createQuotaRecoveryPermit({
      records: f.records,
      request,
      quotaEvidence: evidence,
      authorization,
      limits: f.budget.limits,
      now,
    });
    await expect(f.budget.recoverQuota({ ...f.input, permit: other })).rejects.toThrow('PENDING');
    await expect(f.budget.wrap(f.transport)(request)).rejects.toThrow('NOT_RELEASED');
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.budget.records).toEqual(f.records);
  });
  it.each(['429', '503', 'timeout', 'missing_usage', 'malformed', 'wrong_value', 'invalid_counts'])(
    'keeps a failed %s probe blocked without retry',
    async (failure) => {
      const f = fixture();
      f.transport.mockImplementation(async () => {
        if (failure === 'timeout') throw new Error('private-key-must-never-escape');
        if (['429', '503'].includes(failure))
          return { status: Number(failure), elapsedMs: 2, json: { error: 'private-provider-body' } };
        const r = response();
        const body = r.json as {
          candidates: { content: { parts: { text: string }[] } }[];
          usageMetadata?: { totalTokenCount: number };
        };
        if (failure === 'missing_usage') delete body.usageMetadata;
        if (failure === 'malformed') body.candidates[0].content.parts[0].text = 'not-json';
        if (failure === 'wrong_value') body.candidates[0].content.parts[0].text = '{"ok":false}';
        if (failure === 'invalid_counts') body.usageMetadata!.totalTokenCount = 500;
        return r;
      });
      const receipt = await f.budget.recoverQuota(f.input);
      expect(receipt.outcome).not.toBe('RECOVERED');
      expect(f.transport).toHaveBeenCalledTimes(1);
      expect(journal(f.path)[0].state).toBe('failed');
      expect(f.budget.records.slice(0, 3)).toEqual(f.records);
      if (['429', '503', 'timeout', 'missing_usage'].includes(failure)) {
        expect(f.budget.records[3].estimatedUsd).toBeNull();
        expect(f.budget.spend('gemini')).toBeGreaterThan(0.03);
      }
      await expect(f.budget.wrap(f.transport)(request)).rejects.toThrow('NOT_RELEASED');
      expect(f.transport).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(receipt)).not.toContain('private-');
      expect(() =>
        createQuotaRecoveryPermit({
          records: f.budget.records,
          request,
          quotaEvidence: evidence,
          authorization,
          limits: f.budget.limits,
          now,
        }),
      ).toThrow('NOT_DAILY_QUOTA');
    },
  );
  it('does not trust a success receipt if historical costs were later rewritten', async () => {
    const f = fixture();
    await f.budget.recoverQuota(f.input);
    const modified = structuredClone(f.budget.records);
    modified[0].estimatedUsd = 0;
    atomicJson(f.path, modified);
    await expect(f.budget.wrap(f.transport)(request)).rejects.toThrow('JOURNAL_MISMATCH');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
});

describe('prerequisites before permit creation', () => {
  it('prepares a private CLI permit without dispatching or modifying the usage ledger', () => {
    const f = fixture();
    const privateDir = join(f.directory, '.tools/research');
    mkdirSync(privateDir, { recursive: true });
    const stamp = new Date(Date.now() - 60000).toISOString();
    const records = f.records.map((record) => ({ ...record, at: stamp }));
    const source = { ...evidence, recordedAt: new Date().toISOString() };
    const reset = documentedQuotaResetAfter(stamp);
    atomicJson(join(privateDir, 'usage.json'), records);
    atomicJson(join(privateDir, 'authorization.json'), {
      ...authorization,
      confirmedAt: stamp,
      notBefore: new Date(reset).toISOString(),
      expiresAt: new Date(reset + 1800000).toISOString(),
    });
    atomicJson(join(f.directory, 'evidence.json'), source);
    const script = fileURLToPath(new URL('../scripts/research/recover-quota.ts', import.meta.url));
    const output = execFileSync(
      process.execPath,
      [
        '--import',
        resolve('node_modules/tsx/dist/loader.mjs'),
        script,
        'prepare',
        '--authorization',
        '.tools/research/authorization.json',
        '--quota-evidence',
        'evidence.json',
        '--permit',
        '.tools/research/permit.json',
      ],
      {
        cwd: f.directory,
        env: { ...process.env, GEMINI_API_KEY: 'synthetic-cli-key', RESEARCH_TRANSPORT: 'queue' },
        encoding: 'utf8',
      },
    );
    expect(JSON.parse(output)).toMatchObject({ prepared: true, providerCalls: 0 });
    expect(existsSync(join(privateDir, 'permit.json'))).toBe(true);
    expect(existsSync(join(privateDir, 'queue'))).toBe(false);
    expect(existsSync(join(privateDir, 'usage.json.recovery.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(privateDir, 'usage.json'), 'utf8'))).toEqual(records);
    expect(output).not.toContain('synthetic-cli-key');
  });
  it('uses Pacific midnight with daylight-saving-aware conversion', () => {
    expect(new Date(documentedQuotaResetAfter('2026-10-30T22:46:00Z')).toISOString()).toBe(
      '2026-10-31T07:01:00.000Z',
    );
    expect(new Date(documentedQuotaResetAfter('2026-12-01T22:46:00Z')).toISOString()).toBe(
      '2026-12-02T08:01:00.000Z',
    );
    expect(new Date(documentedQuotaResetAfter('2026-12-31T22:46:00Z')).toISOString()).toBe(
      '2027-01-01T08:01:00.000Z',
    );
  });
  it('rejects a mixed outage/429 history or absent daily-quota evidence', () => {
    const f = fixture();
    const modified = structuredClone(f.records);
    modified[1].status = 504;
    const create = (records: UsageRecord[], quotaEvidence: unknown) =>
      createQuotaRecoveryPermit({
        records,
        request,
        quotaEvidence,
        authorization,
        limits: f.budget.limits,
        now,
      });
    expect(() => create(modified, evidence)).toThrow('NOT_DAILY_QUOTA');
    expect(() => create(f.records, { ...evidence, quota: undefined })).toThrow('INVALID_ARTIFACT');
  });
  it('rejects an earlier reset window and stale or missing billing authorization', () => {
    const f = fixture();
    const create = (auth: unknown) =>
      createQuotaRecoveryPermit({
        records: f.records,
        request,
        quotaEvidence: evidence,
        authorization: auth,
        limits: f.budget.limits,
        now,
      });
    expect(() => create({ ...authorization, notBefore: '2026-10-31T07:00:00Z' })).toThrow('BEFORE_RESET');
    expect(() =>
      create({
        ...authorization,
        reason: 'user_confirmed_billing_change',
        confirmedAt: '2026-10-30T21:00:00Z',
      }),
    ).toThrow('STALE_AUTHORIZATION');
    expect(() => create({ ...authorization, evidenceReference: '' })).toThrow('INVALID_ARTIFACT');
  });
});
