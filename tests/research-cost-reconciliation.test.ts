import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyCostEpisode,
  exportCostSnapshot,
  reconcileUsage,
  sanitizeUsage,
  type CostOptions,
} from '../scripts/reconcile-research-costs';
import type { UsageRecord } from '../research/budget';

const options: CostOptions = { baselineCount: 1, mainRunId: 'holdout-v1', reviewerRunId: 'verifiers-v1' };
const u = '00000000-0000-0000-0000-000000000001';
function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: randomUUID(),
    episode: 'setup',
    provider: 'gemini',
    kind: 'generate',
    model: 'gemini-3.5-flash-lite',
    at: '2026-10-31T01:00:00.000Z',
    reserveUsd: 0.3,
    estimatedUsd: 0.1,
    status: 200,
    inputTokens: 10,
    outputTokens: 2,
    durationMs: 25,
    ...overrides,
  };
}
const directories: string[] = [];
function fixture(records: unknown = [record()]) {
  const dir = mkdtempSync(join(tmpdir(), 'daybook-costs-'));
  directories.push(dir);
  const ledger = join(dir, 'usage.json'),
    output = join(dir, 'export');
  writeFileSync(ledger, JSON.stringify(records));
  return { dir, ledger, output };
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('exact research cost accounting', () => {
  it('adds serialized decimal values exactly and preserves known zero versus unknown reserve', () => {
    const { report } = reconcileUsage(
      [
        record({ estimatedUsd: 0.1 }),
        record({ estimatedUsd: 0.2 }),
        record({
          estimatedUsd: null,
          reserveUsd: 0.07,
          inputTokens: null,
          outputTokens: null,
          kind: 'embed',
          model: 'gemini-embedding-001',
        }),
        record({ estimatedUsd: 0, reserveUsd: 0, kind: 'file-poll', inputTokens: null, outputTokens: null }),
      ],
      options,
    );
    expect(report.total.reportedEstimateUsd).toBe('0.3');
    expect(report.total.unknownCostReservationUsd).toBe('0.07');
    expect(report.total.countedUsd).toBe('0.37');
    expect(report.total.allReservationsUsd).toBe('0.67');
    expect(report.total.knownCostRecords).toBe(3);
    expect(report.total.unknownCostRecords).toBe(1);
    expect(report.details.find((r) => r.kind === 'embed')).toMatchObject({
      httpOutcome: 'http_2xx',
      totals: { unknownCostRecords: 1, countedUsd: '0.07' },
    });
  });
  it('does not silently round away existing Number arithmetic artifacts', () => {
    const { report } = reconcileUsage(
      [record({ estimatedUsd: 0.1 + 0.2 }), record({ estimatedUsd: 0.1 })],
      options,
    );
    expect(report.total.countedUsd).toBe('0.40000000000000004');
  });
  it('keeps over-reservation known costs and unobserved failed reservations without inferring network success', () => {
    const { report } = reconcileUsage(
      [
        record({ estimatedUsd: 0.5, reserveUsd: 0.1 }),
        record({ estimatedUsd: null, status: null, durationMs: null }),
      ],
      options,
    );
    expect(report.total.countedUsd).toBe('0.8');
    expect(report.total.knownCostAboveReservationRecords).toBe(1);
    expect(report.total.unobservedHttpRecords).toBe(1);
  });
  it('partitions the ledger position boundary and each requested phase without double counting', () => {
    const episodes = [
      'holdout-v1:R3:documents-01-1:0',
      'verifiers-v1:holdout:llm:review-001',
      'verifiers-v1:development:jev:review-002',
      'pilot-v2:R1:financial-01-1:0',
      'index:files',
      `recovery-probe:${u}`,
      `transport-recovery-probe:${u}`,
      `prelaunch-continuation-probe:${u}`,
      `operator-probe:${u}:${u}`,
    ];
    const { report } = reconcileUsage(
      episodes.map((episode, i) =>
        record({
          episode,
          estimatedUsd: 0.01,
          ...(i === 2 ? { provider: 'jev', kind: 'jev-verify', model: 'jev-1.14.0' } : {}),
        }),
      ),
      { ...options, baselineCount: 3 },
    );
    expect(report.byPhase.map((p) => p.totals.records)).toEqual(Array(9).fill(1));
    expect(report.byPeriod.map((p) => p.totals.countedUsd)).toEqual(['0.03', '0.06']);
    expect(report.byProvider.map((p) => p.totals.countedUsd)).toEqual(['0.08', '0.01']);
    expect(report.total.countedUsd).toBe('0.09');
    expect(report.partitionChecks).toEqual({ phase: true, provider: true, period: true, detail: true });
  });
  it.each([
    'setup',
    'index:vectors',
    'provider-smoke-v1',
    'retrieval-smoke-v1',
    'route-preflight-R8-financial-01-1-1793400000000',
    'current-key-index-access:1793400000000',
  ])('classifies explicit setup/preflight ID %s', (episode) => {
    expect(classifyCostEpisode(episode, options)).toBe('indexing_preflight');
  });
  it.each([
    'unknown-job',
    'holdout-v1:R9:financial-01-1:0',
    'verifiers-v1:unknown:llm:review-1',
    'operator-probe:missing-cohort',
    'holdout-v2:R0:financial-01-1:0',
  ])('rejects unknown or malformed classification %s', (episode) => {
    expect(() => reconcileUsage([record({ episode })], options)).toThrow('UNCLASSIFIED_EPISODE');
  });
  it('rejects overlapping configured main/development classification', () => {
    expect(() =>
      reconcileUsage([record({ episode: 'pilot-v1:R0:financial-01-1:0' })], {
        ...options,
        mainRunId: 'pilot-v1',
      }),
    ).toThrow('OVERLAPPING_CLASSIFICATIONS');
  });
  it('allows explicit setup classifications but refuses overriding built-ins, reserved prefixes, duplicates or unused labels', () => {
    const rows = [record({ episode: 'offline-setup-01' })];
    const extra = { episode: 'offline-setup-01', phase: 'indexing_preflight' as const };
    expect(
      reconcileUsage(rows, { ...options, extraClassifications: [extra] }).report.byPhase.find(
        (p) => p.phase === 'indexing_preflight',
      )!.totals.records,
    ).toBe(1);
    for (const extras of [
      [extra, extra],
      [{ ...extra, episode: 'setup' }],
      [{ ...extra, episode: 'holdout-v1:malformed' }],
      [{ ...extra, episode: 'not-present' }],
      [{ ...extra, secret: 'private' }],
    ]) {
      expect(() => reconcileUsage(rows, { ...options, extraClassifications: extras })).toThrow(
        'INVALID_CLASSIFICATIONS',
      );
    }
  });
  it('uses only allowlisted fields, not arbitrary private nested data', () => {
    const input = {
      ...record(),
      headers: { authorization: 'SECRET' },
      url: 'https://secret.invalid',
      key: 'SECRET',
      privatePolicy: { secret: 'SECRET' },
    };
    const clean = sanitizeUsage([input]);
    expect(Object.keys(clean[0])).toEqual([
      'id',
      'episode',
      'provider',
      'kind',
      'model',
      'at',
      'reserveUsd',
      'estimatedUsd',
      'status',
      'inputTokens',
      'outputTokens',
      'durationMs',
    ]);
    expect(JSON.stringify(clean)).not.toMatch(/SECRET|secret\.invalid|privatePolicy/);
  });
  it.each([
    { reserveUsd: -1 },
    { estimatedUsd: Number.NaN },
    { reserveUsd: Infinity },
    { reserveUsd: '0.1' },
    { estimatedUsd: undefined },
    { inputTokens: 0.5 },
    { outputTokens: Number.MAX_SAFE_INTEGER + 1 },
    { durationMs: -1 },
    { status: 0 },
    { at: '2026-02-31T00:00:00.000Z' },
    { model: 'https://private/key' },
    { provider: 'jev' },
    { kind: 'unknown' },
    { id: 'private\nheader' },
  ])('rejects invalid costs/usage without exposing the record', (override) => {
    expect(() => sanitizeUsage([{ ...record(), ...override, secret: 'private-key-value' }])).toThrow(
      /^COST_RECONCILIATION_INVALID_RECORD$/,
    );
  });
  it('rejects duplicate record IDs and invalid boundary options', () => {
    const r = record();
    expect(() => reconcileUsage([r, r], options)).toThrow('INVALID_RECORD');
    for (const baselineCount of [-1, 2, 0.5, NaN])
      expect(() => reconcileUsage([r], { ...options, baselineCount })).toThrow('INVALID_OPTIONS');
  });
});

describe('provider-free snapshot export', () => {
  it('exports sanitized rows, exact partitions and hashes without changing its source', () => {
    const f = fixture([{ ...record(), secret: 'private-key-value' }]);
    const before = readFileSync(f.ledger);
    const result = exportCostSnapshot(f.ledger, f.output, options);
    expect(readFileSync(f.ledger)).toEqual(before);
    expect(result.ledgerSha256).toBe(createHash('sha256').update(before).digest('hex'));
    const files = readdirSync(f.output);
    expect(files).toHaveLength(4);
    for (const file of files)
      expect(readFileSync(join(f.output, file), 'utf8')).not.toContain('private-key-value');
    expect(result.usageSha256).toBe(
      createHash('sha256')
        .update(readFileSync(join(f.output, 'all-study-usage.json')))
        .digest('hex'),
    );
    expect(result.reportSha256).toBe(
      createHash('sha256')
        .update(readFileSync(join(f.output, 'cost-reconciliation.json')))
        .digest('hex'),
    );
    expect(() => exportCostSnapshot(f.ledger, f.output, options)).toThrow('OUTPUT_EXISTS');
  });
  it.each(['usage.json.lock', 'runner.lock', 'pump-owner.lock'])(
    'refuses an active or stale %s without exporting',
    (lock) => {
      const f = fixture();
      writeFileSync(join(f.dir, lock), 'synthetic-lock');
      expect(() => exportCostSnapshot(f.ledger, f.output, options)).toThrow('ACTIVE_OR_STALE_LOCK');
      expect(readdirSync(f.dir)).not.toContain('export');
    },
  );
  it.each(['ready', 'claimed'])('refuses an outstanding %s request', (extension) => {
    const f = fixture();
    mkdirSync(join(f.dir, 'queue'));
    writeFileSync(join(f.dir, 'queue', `synthetic.${extension}`), 'private request not read');
    expect(() => exportCostSnapshot(f.ledger, f.output, options)).toThrow('OUTSTANDING_REQUEST');
  });
  it('allows completed framed requests but rejects partial completion files', () => {
    const f = fixture();
    mkdirSync(join(f.dir, 'queue'));
    writeFileSync(join(f.dir, 'queue', 'synthetic.claimed'), 'private request not read');
    writeFileSync(join(f.dir, 'queue', 'synthetic.done'), '200 0.5');
    expect(() => exportCostSnapshot(f.ledger, f.output, options)).toThrow('OUTSTANDING_REQUEST');
    writeFileSync(join(f.dir, 'queue', 'synthetic.done'), '200 0.500 0 DAYBOOK_HTTP_DONE_V1\n');
    expect(exportCostSnapshot(f.ledger, f.output, options).recordCount).toBe(1);
  });
  it('rejects malformed private JSON with a sanitized error', () => {
    const f = fixture();
    writeFileSync(f.ledger, '{private-key-value');
    expect(() => exportCostSnapshot(f.ledger, f.output, options)).toThrow(
      /^COST_RECONCILIATION_UNREADABLE_LEDGER$/,
    );
  });
});
