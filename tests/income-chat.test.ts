import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../server/config';
import { pool } from '../server/db';
import { runInsightTool } from '../server/ai';
import { accounts, createEntry, reverseEntry } from '../server/ledger';
import { seedChart } from '../scripts/seed';
import type { EntryInput } from '../shared/schema';

// Exact journal-backed tool tests, not model accuracy tests. Hosted DBs are forbidden.
const admin = new pg.Client({ connectionString: config.migrationUrl });
let org: string;
let ids: Record<string, string>;
beforeAll(async () => {
  for (const value of [config.databaseUrl, config.migrationUrl]) {
    const parsed = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    const compose =
      process.env.NODE_ENV === 'test' &&
      parsed.hostname === 'db' &&
      parsed.port === '5432' &&
      parsed.pathname === '/spiich';
    if (!local && !compose) throw new Error('Income-chat tests require disposable local/CI PostgreSQL.');
  }
  await admin.connect();
});
beforeEach(async () => {
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Income tool test')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
});
afterAll(async () => {
  await admin.end();
  await pool.end();
});

type Metric = 'revenue' | 'expenses' | 'profit';
const metrics: Metric[] = ['revenue', 'expenses', 'profit'];
const labels = { revenue: 'revenue', expenses: 'expenses', profit: 'net profit' };
const current = { from: '2026-03-01', to: '2026-03-31' };
const comparison = { ...current, previousFrom: '2026-02-01', previousTo: '2026-02-28' };
function entry(debit: string, credit: string, amount: string, date: string): EntryInput {
  return {
    date,
    description: 'Synthetic income tool regression',
    counterparty: '',
    reference: '',
    source: 'MANUAL',
    lines: [
      { accountId: ids[debit], debit: amount, credit: '0', exchangeRate: '1', memo: '' },
      { accountId: ids[credit], debit: '0', credit: amount, exchangeRate: '1', memo: '' },
    ],
  };
}
const post = (debit: string, credit: string, amount: string, date: string) =>
  createEntry(org, entry(debit, credit, amount, date), randomUUID(), { post: true });
async function twoPeriods() {
  // Accrual revenue is earned despite no cash receipt. Expected totals are literal
  // independent arithmetic below; no report function generates the oracle.
  await post('1100', '4010', '1000', '2026-02-28');
  await post('5010', '1010', '400', '2026-02-01');
  await post('1100', '4010', '1500', '2026-03-01');
  await post('5030', '2100', '700', '2026-03-31');
  await createEntry(org, entry('1100', '4010', '9000', '2026-03-15'), randomUUID());
  await createEntry(org, entry('5030', '2100', '8000', '2026-03-15'), randomUUID());
  await post('1100', '4010', '9999', '2026-01-31');
  await post('5010', '1010', '7777', '2026-04-01');
}

describe('Financial chat totals and period comparisons use actual posted income', () => {
  it.each([
    ['revenue', '$1,500.00'],
    ['expenses', '$700.00'],
    ['profit', '$800.00'],
  ] as const)(
    'reports %s for the exact inclusive range instead of a different metric',
    async (metric, value) => {
      await twoPeriods();
      const result = await runInsightTool(org, 'income_summary', { metric, ...current });
      expect(result.answer).toBe(
        `Recorded ${labels[metric]} from 2026-03-01 to 2026-03-31 totaled ${value} USD.`,
      );
      expect(result.evidence.period).toBe('2026-03-01 → 2026-03-31');
      expect(result.evidence.rows.map((row) => row.value)).toEqual([value]);
      expect(result.evidence.rows[0].label.toLowerCase()).toBe(labels[metric]);
      expect(result.evidence.href).toBe('/reports?from=2026-03-01&to=2026-03-31');
    },
  );

  it('compares each requested metric and retains the legacy revenue comparison', async () => {
    await twoPeriods();
    const expected = [
      { metric: 'revenue', now: '$1,500.00', before: '$1,000.00', delta: '$500.00', percent: '50.0%' },
      { metric: 'expenses', now: '$700.00', before: '$400.00', delta: '$300.00', percent: '75.0%' },
      { metric: 'profit', now: '$800.00', before: '$600.00', delta: '$200.00', percent: '33.3%' },
    ];
    for (const row of expected) {
      const result = await runInsightTool(org, 'period_comparison', { metric: row.metric, ...comparison });
      expect(result.evidence.period).toBe('2026-03-01 → 2026-03-31');
      expect(result.evidence.rows).toEqual([
        { label: '2026-03-01 – 2026-03-31', value: row.now },
        { label: '2026-02-01 – 2026-02-28', value: row.before },
      ]);
      expect(result.answer).toContain(`The difference is ${row.delta}; percentage change is ${row.percent}.`);
      expect(result.answer.toLowerCase()).toContain(labels[row.metric as Metric]);
    }
    const legacy = await runInsightTool(org, 'revenue_comparison', comparison);
    expect(legacy.answer).toBe(
      'Revenue was $1,500.00, compared with $1,000.00 in the prior period. The difference is $500.00; percentage change is 50.0%.',
    );
    expect(legacy.evidence.rows).toEqual([
      { label: '2026-03-01 – 2026-03-31', value: '$1,500.00' },
      { label: '2026-02-01 – 2026-02-28', value: '$1,000.00' },
    ]);
  });

  it('shows zero and negative prior values without inventing a meaningful percentage', async () => {
    // May has no activity. July contains a revenue credit-note and expense refund.
    await post('1100', '4010', '200', '2026-06-15');
    await post('5030', '2100', '50', '2026-06-15');
    await post('4010', '1100', '100', '2026-07-15');
    await post('2100', '5030', '40', '2026-07-15');
    await post('1100', '4010', '100', '2026-08-15');
    await post('5030', '2100', '20', '2026-08-15');
    const expected = {
      revenue: { june: '$200.00', august: '$100.00', july: '-$100.00', delta: '$200.00' },
      expenses: { june: '$50.00', august: '$20.00', july: '-$40.00', delta: '$60.00' },
      profit: { june: '$150.00', august: '$80.00', july: '-$60.00', delta: '$140.00' },
    };
    for (const metric of metrics) {
      const zero = await runInsightTool(org, 'period_comparison', {
        metric,
        from: '2026-06-01',
        to: '2026-06-30',
        previousFrom: '2026-05-01',
        previousTo: '2026-05-31',
      });
      expect(zero.evidence.rows.map((row) => row.value)).toEqual([expected[metric].june, '$0.00']);
      expect(zero.answer).toContain('percentage change is not meaningful');
      expect(zero.answer).not.toContain('%');
      const negative = await runInsightTool(org, 'period_comparison', {
        metric,
        from: '2026-08-01',
        to: '2026-08-31',
        previousFrom: '2026-07-01',
        previousTo: '2026-07-31',
      });
      expect(negative.evidence.rows.map((row) => row.value)).toEqual([
        expected[metric].august,
        expected[metric].july,
      ]);
      expect(negative.answer).toContain(`The difference is ${expected[metric].delta};`);
      expect(negative.answer).toContain('percentage change is not meaningful');
      expect(negative.answer).not.toContain('%');
    }
  });

  it('keeps tenant, draft and day boundaries while assigning reversals to their own dates', async () => {
    const earned = await post('1100', '4010', '1500', '2026-03-31');
    const spent = await post('5030', '2100', '700', '2026-03-31');
    await reverseEntry(org, earned.id, '2026-04-01', randomUUID());
    await reverseEntry(org, spent.id, '2026-04-01', randomUUID());
    await post('1100', '4010', '9999', '2026-03-30');
    await post('5010', '1010', '8888', '2026-04-02');
    await createEntry(org, entry('1100', '4010', '7777', '2026-03-31'), randomUUID());
    const foreign = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Other income workspace')", [foreign]);
    await seedChart(foreign);
    const foreignIds = Object.fromEntries(
      (await accounts(foreign)).map((account) => [account.code, account.id]),
    );
    const foreignEntry = entry('1100', '4010', '99999', '2026-03-31');
    foreignEntry.lines[0].accountId = foreignIds['1100'];
    foreignEntry.lines[1].accountId = foreignIds['4010'];
    await createEntry(foreign, foreignEntry, randomUUID(), { post: true });
    const expected = {
      revenue: ['$1,500.00', '-$1,500.00'],
      expenses: ['$700.00', '-$700.00'],
      profit: ['$800.00', '-$800.00'],
    };
    for (const metric of metrics) {
      for (const [index, date] of ['2026-03-31', '2026-04-01'].entries()) {
        const result = await runInsightTool(org, 'income_summary', { metric, from: date, to: date });
        expect(result.evidence.rows.map((row) => row.value)).toEqual([expected[metric][index]]);
        expect(result.evidence.period).toBe(`${date} → ${date}`);
      }
    }
  });

  it('rejects invalid metrics, dates, ranges and extra arguments before opening a report transaction', async () => {
    const connection = vi.spyOn(pool, 'connect');
    try {
      for (const [name, args] of [
        ['income_summary', { metric: 'cash', ...current }],
        ['income_summary', { metric: 'profit', from: '2026-02-30', to: current.to }],
        ['income_summary', { metric: 'expenses', from: current.to, to: current.from }],
        ['income_summary', { metric: 'revenue', ...current, accountCode: '5030' }],
        [
          'period_comparison',
          { metric: 'revenue', ...comparison, previousFrom: '2026-02-28', previousTo: '2026-02-01' },
        ],
        ['period_comparison', { metric: 'profit', ...comparison, previousTo: '2026-02-30' }],
      ] as const) {
        await expect(runInsightTool(org, name, args)).rejects.toMatchObject({ name: 'ZodError' });
      }
      expect(connection).not.toHaveBeenCalled();
    } finally {
      connection.mockRestore();
    }
  });
});
