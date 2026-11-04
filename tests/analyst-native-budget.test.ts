import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileBudget, decodeBudgetSeed, nanoUsd } from '../scripts/analyst-workspace-evaluation/budget';
import { hash } from '../scripts/analyst-workspace-evaluation/references';
import {
  assertNativeRuntimeUrl,
  nativeWorkflowPermitSchema,
} from '../scripts/analyst-workspace-evaluation/workflow';
import type { AnalystModelAttempt, AnalystModelReceipt } from '../server/analyst-model';

const dirs: string[] = [];
describe('predeclared native workflow case sets', () => {
  const permit = {
    version: 1,
    scopeId: 'daybook-analyst-product-20261103',
    cohort: 'native-initial-test',
    sourceCommit: 'a'.repeat(40),
    modelId: 'gemini-3.8-flash',
    databaseName: 'daybook_analyst_acceptance_20261104',
    hostname: 'ep-fictional-123.us-east-2.aws.neon.tech',
    seedLedgerSha256: 'b'.repeat(64),
    artifactKeySha256: 'c'.repeat(64),
    fixtureFingerprint: 'd'.repeat(64),
    approvedAt: '2026-11-04T00:00:00.000Z',
    expiresAt: '2026-11-05T00:00:00.000Z',
  };
  it('keeps existing permits matched and accepts only an explicitly selected extension', () => {
    expect(nativeWorkflowPermitSchema.parse(permit).caseSet).toBe('matched');
    expect(nativeWorkflowPermitSchema.parse({ ...permit, caseSet: 'matched' }).caseSet).toBe('matched');
    expect(nativeWorkflowPermitSchema.parse({ ...permit, caseSet: 'extended' }).caseSet).toBe('extended');
  });
  it('rejects unknown sets and arbitrary caller-supplied case lists', () => {
    for (const caseSet of ['all', 'Matched', '', null, [], {}])
      expect(() => nativeWorkflowPermitSchema.parse({ ...permit, caseSet })).toThrow();
    expect(() => nativeWorkflowPermitSchema.parse({ ...permit, caseIds: ['A02'] })).toThrow();
  });
});
describe.each([
  ['gzip-base64:', gzipSync],
  ['brotli-base64:', brotliCompressSync],
] as const)('complete prior budget ledger transport: %s', (prefix, compress) => {
  it('restores every prior attempt byte-for-byte rather than resetting or rolling up spending', () => {
    const seed = JSON.stringify(
      {
        limitUsd: '5.00',
        knownEstimatedUsd: '0.451608750',
        unknownReservedUsd: '0',
        attempts: Array.from({ length: 150 }, (_, index) => ({
          attemptId: `previous-${index}`,
          receipt: { detail: 'preserved evidence '.repeat(50) },
        })),
      },
      null,
      2,
    );
    expect(Buffer.byteLength(seed)).toBeGreaterThan(48 * 1024);
    const transport = `${prefix}${compress(seed).toString('base64')}`;
    expect(Buffer.byteLength(transport)).toBeLessThan(48 * 1024);
    expect(decodeBudgetSeed(transport)).toBe(seed);
    expect(hash(decodeBudgetSeed(transport))).toBe(hash(seed));
    expect(decodeBudgetSeed(seed)).toBe(seed);
  });
  it('rejects corrupt compressed data and bounded-decompression overflow', () => {
    for (const encoded of [
      `${prefix}!`,
      `${prefix}YWJj`,
      `${prefix}${compress('x'.repeat(2 * 1024 * 1024 + 1)).toString('base64')}`,
    ]) {
      expect(() => decodeBudgetSeed(encoded)).toThrow();
    }
  });
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(known = '0', unknown = '0') {
  const dir = mkdtempSync(join(tmpdir(), 'daybook-native-budget-'));
  dirs.push(dir);
  const seed = JSON.stringify({
    limitUsd: '5.00',
    knownEstimatedUsd: known,
    unknownReservedUsd: unknown,
    attempts: [
      {
        id: 'querio-hosted',
        provider: 'querio',
        observedCompletedModelResponses: 13,
        knownIncrementalUsd: 0,
      },
    ],
    querioIncludedCredits: { remainingAtReport: 396, newTaskModelCallsObserved: 13 },
  });
  const path = join(dir, 'usage.json');
  return {
    path,
    seed,
    budget: createFileBudget({
      seed,
      seedSha256: hash(seed),
      path,
      scopeId: 'shared',
      cohort: 'native-initial-test',
    }),
    read: () =>
      JSON.parse(readFileSync(path, 'utf8')) as {
        knownEstimatedUsd: string;
        unknownReservedUsd: string;
        attempts: unknown[];
        querioIncludedCredits: unknown;
      },
  };
}
function attempt(reservationNanoUsd = 100_000_000): AnalystModelAttempt {
  return {
    attemptId: randomUUID(),
    modelId: 'gemini-3.8-flash',
    requestBytes: 1000,
    requestSha256: 'a'.repeat(64),
    continuationCarryTokens: 0,
    inputTokenReservation: 3048,
    outputTokenReservation: 4096,
    reservationNanoUsd,
    reservationUsd: '0.100000000',
  };
}
const known = (a: AnalystModelAttempt, costNanoUsd = 10_000_000): AnalystModelReceipt => ({
  ...a,
  kind: 'known',
  httpStatus: 200,
  usage: { promptTokenCount: 100, totalTokenCount: 200 },
  inputTokens: 100,
  outputTokens: 100,
  unclassifiedOutputTokens: 100,
  costNanoUsd,
  costUsd: '0.010000000',
});

describe('shared native evaluation budget', () => {
  it('retains prior Querio evidence and charges preserved unknown reservations before new HTTP admission', async () => {
    const f = fixture('1.1', '0.3'),
      a = attempt();
    await f.budget.beforeDispatch(a);
    expect(f.read().unknownReservedUsd).toBe('0.400000000');
    expect(f.read().attempts).toHaveLength(2);
    expect(f.read().querioIncludedCredits).toEqual({ remainingAtReport: 396, newTaskModelCallsObserved: 13 });
    expect((await f.budget.snapshot()).consumedNanoUsd).toBe(1_500_000_000);
    await f.budget.afterResponse({ ...a, kind: 'unknown', reason: 'transport-error' });
    expect((await f.budget.snapshot()).consumedNanoUsd).toBe(1_500_000_000);
  });
  it('settles known usage exactly once and rejects conflicting receipts or reused attempts', async () => {
    const f = fixture(),
      a = attempt();
    await f.budget.beforeDispatch(a);
    await f.budget.afterResponse(known(a));
    await f.budget.afterResponse(known(a));
    expect(f.read().knownEstimatedUsd).toBe('0.010000000');
    expect(f.read().unknownReservedUsd).toBe('0.000000000');
    await expect(f.budget.afterResponse(known(a, 20_000_000))).rejects.toMatchObject({
      code: 'BUDGET_CONFLICTING_RECEIPT',
    });
    await expect(f.budget.beforeDispatch(a)).rejects.toMatchObject({ code: 'BUDGET_DUPLICATE_ATTEMPT' });
  });
  it('refuses a reservation above the shared cap before recording or dispatching it', async () => {
    const f = fixture('4.95');
    await expect(f.budget.beforeDispatch(attempt())).rejects.toMatchObject({
      code: 'GLOBAL_ANALYST_BUDGET_EXHAUSTED',
    });
    expect(f.read().attempts).toHaveLength(1);
    expect((await f.budget.snapshot()).consumedNanoUsd).toBe(4_950_000_000);
  });
  it('a later cohort must carry the entire final ledger, including unknown amounts', async () => {
    const f = fixture('0.25'),
      a = attempt();
    await f.budget.beforeDispatch(a);
    const seed = readFileSync(f.path, 'utf8');
    const path = join(dirs[0], 'next.json');
    const next = createFileBudget({
      seed,
      seedSha256: hash(seed),
      path,
      scopeId: 'shared',
      cohort: 'native-initial-next',
    });
    expect((await next.snapshot()).consumedNanoUsd).toBe(350_000_000);
    await expect(next.beforeDispatch(a)).rejects.toMatchObject({ code: 'BUDGET_DUPLICATE_ATTEMPT' });
    expect(() =>
      createFileBudget({
        seed,
        seedSha256: '0'.repeat(64),
        path: join(dirs[0], 'bad.json'),
        scopeId: 'shared',
        cohort: 'bad',
      }),
    ).toThrow();
  });
  it('records an unexpectedly larger known charge rather than hiding it or reducing it to the reservation', async () => {
    const f = fixture('4.85'),
      a = attempt();
    await f.budget.beforeDispatch(a);
    await f.budget.afterResponse(known(a, 200_000_000));
    expect((await f.budget.snapshot()).consumedNanoUsd).toBe(5_050_000_000);
    await expect(f.budget.beforeDispatch(attempt(1))).rejects.toMatchObject({
      code: 'GLOBAL_ANALYST_BUDGET_EXHAUSTED',
    });
  });
  it('parses decimal dollar strings exactly and refuses malformed or imprecise values', () => {
    expect(nanoUsd('0.000000001')).toBe(1);
    expect(nanoUsd('5.00')).toBe(5_000_000_000);
    for (const value of ['-1', '1e-3', '0.0000000001', 0.1]) expect(() => nanoUsd(value)).toThrow();
  });
});
describe('paid runtime target pin', () => {
  const host = 'ep-fictional-123.us-east-2.aws.neon.tech';
  const url = `postgresql://spiich_app:fictional@${host}/daybook_analyst_acceptance_20261104?sslmode=require`;
  it('accepts the exact application role, named fixture and equivalent pooled endpoint', () => {
    expect(() => assertNativeRuntimeUrl(url, host)).not.toThrow();
    expect(() =>
      assertNativeRuntimeUrl(url.replace('ep-fictional-123.', 'ep-fictional-123-pooler.'), host),
    ).not.toThrow();
  });
  it('refuses owner/other database/other endpoint and query-string session overrides', () => {
    for (const candidate of [
      url.replace('spiich_app', 'neondb_owner'),
      url.replace('daybook_analyst_acceptance_20261104', 'neondb'),
      url.replace('ep-fictional-123.', 'ep-another-456.'),
      url + '&options=-csearch_path=public',
      url.replace('?sslmode=require', ''),
    ])
      expect(() => assertNativeRuntimeUrl(candidate, host)).toThrow();
  });
});
