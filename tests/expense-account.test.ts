import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { accounts, createEntry, reverseEntry } from '../server/ledger';
import { expenseAccountChart, expenseAccountSummary, reportSnapshot } from '../server/reports';
import { seedChart } from '../scripts/seed';
import type { EntryInput } from '../shared/schema';

// Real PostgreSQL assertions. Never run against the hosted demo or a model API.
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
    if (!local && !compose) throw new Error('Expense-account tests require disposable local/CI PostgreSQL.');
  }
  await admin.connect();
});
beforeEach(async () => {
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Scoped expense test')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
});
afterAll(async () => {
  await admin.end();
  await pool.end();
});

function entry(debit: string, credit: string, amount: string, date = '2026-03-15'): EntryInput {
  return {
    date,
    description: 'Synthetic expense scope regression',
    counterparty: '',
    reference: '',
    source: 'MANUAL',
    lines: [
      { accountId: ids[debit], debit: amount, credit: '0', exchangeRate: '1', memo: '' },
      { accountId: ids[credit], debit: '0', credit: amount, exchangeRate: '1', memo: '' },
    ],
  };
}
const post = (debit: string, credit: string, amount: string, date?: string) =>
  createEntry(org, entry(debit, credit, amount, date), randomUUID(), { post: true });
const march = (code: string) => expenseAccountSummary(org, code, '2026-03-01', '2026-03-31');
async function addAccount(
  code: string,
  name: string,
  options: { parent?: string; group?: boolean; currency?: string; organization?: string } = {},
) {
  const rows = await query<{ id: string }>(
    `INSERT INTO accounts(organization_id,code,name,type,currency,parent_id,is_group)
     VALUES($1,$2,$3,'EXPENSE',$4,$5,$6) RETURNING id`,
    [
      options.organization ?? org,
      code,
      name,
      options.currency ?? 'USD',
      options.parent ? ids[options.parent] : null,
      options.group ?? false,
    ],
  );
  if (!options.organization) ids[code] = rows[0].id;
  return rows[0].id;
}

describe('Expense-account reports use the requested ledger scope', () => {
  it('returns supplies340 separately from rent2400 and all-expenses2740', async () => {
    await post('5030', '2100', '340');
    await post('5010', '1010', '2400');
    const supplies = await march('5030');
    expect(supplies).toMatchObject({
      from: '2026-03-01',
      to: '2026-03-31',
      currency: 'USD',
      account: { code: '5030', is_group: false },
      totalExpenses: '340.00',
    });
    expect(supplies.expenses).toEqual([
      { id: ids['5030'], code: '5030', name: 'Office supplies', amount: '340.00' },
    ]);
    expect((await march('5010')).totalExpenses).toBe('2400.00');
    expect((await march('5000')).totalExpenses).toBe('2740.00');
  });

  it('does not lose a requested category outside the largest five', async () => {
    for (const [index, code] of ['5010', '5020', '5040', '5050', '5060', '5090'].entries())
      await post(code, '1010', String(1000 + index));
    await post('5030', '2100', '0.01');
    expect((await march('5030')).totalExpenses).toBe('0.01');
    expect((await march('5030')).expenses).toHaveLength(1);
  });

  it('includes nested descendants once while excluding siblings and unrelated roots', async () => {
    await addAccount('5100', 'Office costs', { parent: '5000', group: true });
    await addAccount('5110', 'Printing', { parent: '5100', group: true });
    await addAccount('5111', 'Paper', { parent: '5110' });
    await addAccount('5112', 'Ink', { parent: '5110' });
    await addAccount('5120', 'Postage', { parent: '5100' });
    await addAccount('6000', 'Unrelated root');
    await post('5111', '1010', '10');
    await post('5112', '1010', '20');
    await post('5120', '1010', '30');
    await post('5010', '1010', '2400');
    await post('6000', '1010', '90');
    const office = await march('5100');
    expect(office.totalExpenses).toBe('60.00');
    expect(office.expenses.map((row) => [row.code, row.amount])).toEqual([
      ['5111', '10.00'],
      ['5112', '20.00'],
      ['5120', '30.00'],
    ]);
    expect(new Set(office.expenses.map((row) => row.id)).size).toBe(3);
    expect((await march('5110')).totalExpenses).toBe('30.00');
    expect((await march('5000')).totalExpenses).toBe('2460.00');
  });

  it('refuses unknown, non-expense and foreign-only account codes without a global fallback', async () => {
    await post('5010', '1010', '2400');
    const foreign = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Other expense workspace')", [foreign]);
    await addAccount('7777', 'Foreign only', { organization: foreign });
    for (const code of ['9999', '1010', '4010', '7777', "5030' OR true--"])
      await expect(march(code)).rejects.toMatchObject({ code: 'INVALID_EXPENSE_ACCOUNT', status: 422 });
  });

  it('keeps equal account codes in another organization out of the result', async () => {
    await post('5030', '2100', '340');
    const foreign = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Foreign identical chart')", [foreign]);
    await seedChart(foreign);
    const foreignIds = Object.fromEntries(
      (await accounts(foreign)).map((account) => [account.code, account.id]),
    );
    const input = entry('5030', '2100', '9999');
    input.lines[0].accountId = foreignIds['5030'];
    input.lines[1].accountId = foreignIds['2100'];
    await createEntry(foreign, input, randomUUID(), { post: true });
    expect((await march('5030')).totalExpenses).toBe('340.00');
    expect(
      (await expenseAccountChart(org)).every((account) => !Object.values(foreignIds).includes(account.id)),
    ).toBe(true);
  });

  it('returns explicit zero for a known unused leaf and an empty group', async () => {
    const leaf = await march('5030');
    expect(leaf.totalExpenses).toBe('0.00');
    expect(leaf.expenses).toEqual([
      { id: ids['5030'], code: '5030', name: 'Office supplies', amount: '0.00' },
    ]);
    await addAccount('5100', 'Empty expense group', { parent: '5000', group: true });
    expect(await march('5100')).toMatchObject({
      account: { code: '5100', is_group: true },
      totalExpenses: '0.00',
      expenses: [],
    });
  });

  it('retains archived historical expense accounts and exposes metadata without balances', async () => {
    await post('5030', '2100', '340');
    await query('UPDATE accounts SET archived=true WHERE organization_id=$1 AND id=$2', [org, ids['5030']]);
    const chart = await expenseAccountChart(org);
    const supplies = chart.find((account) => account.code === '5030')!;
    expect(supplies.archived).toBe(true);
    expect(Object.keys(supplies).sort()).toEqual([
      'archived',
      'code',
      'currency',
      'id',
      'is_group',
      'name',
      'parent_id',
    ]);
    expect(chart.some((account) => account.code === '5000' && account.is_group)).toBe(true);
    expect(chart.some((account) => account.code === '1010')).toBe(false);
    expect((await march('5030')).totalExpenses).toBe('340.00');
    expect((await march('5000')).totalExpenses).toBe('340.00');
  });

  it('uses inclusive dates, excludes drafts, and nets credit refunds exactly', async () => {
    await post('5030', '2100', '100', '2026-03-01');
    await post('5030', '2100', '0.10', '2026-03-31');
    await post('5030', '2100', '0.20', '2026-03-31');
    await post('2100', '5030', '40', '2026-03-15');
    await post('5030', '2100', '9000', '2026-02-28');
    await post('5030', '2100', '8000', '2026-04-01');
    await createEntry(org, entry('5030', '2100', '7000'), randomUUID());
    expect((await march('5030')).totalExpenses).toBe('60.30');
    expect((await expenseAccountSummary(org, '5030', '2026-03-15', '2026-03-15')).totalExpenses).toBe(
      '-40.00',
    );
  });

  it('uses stored per-line base rounding for foreign expenses, not current rates or native totals', async () => {
    await addAccount('5070', 'Euro supplies', { parent: '5000', currency: 'EUR' });
    const input = entry('5070', '1010', '10.01');
    input.lines[0].exchangeRate = '1.2345';
    input.lines[1].credit = '12.36';
    await createEntry(org, input, randomUUID(), { post: true });
    const report = await march('5070');
    expect(report.currency).toBe('USD');
    expect(report.account.currency).toBe('EUR');
    expect(report.totalExpenses).toBe('12.36');
    expect(report.expenses[0].amount).toBe('12.36');
  });

  it('keeps a March original in March and its April reversal in April', async () => {
    const original = await post('5030', '2100', '340', '2026-03-31');
    await reverseEntry(org, original.id, '2026-04-01', randomUUID());
    expect((await march('5030')).totalExpenses).toBe('340.00');
    expect((await expenseAccountSummary(org, '5030', '2026-04-01', '2026-04-30')).totalExpenses).toBe(
      '-340.00',
    );
    expect((await expenseAccountSummary(org, '5030', '2026-03-01', '2026-04-30')).totalExpenses).toBe('0.00');
  });

  it('runs both reads inside a read-only repeatable-read transaction without changing books', async () => {
    await post('5030', '2100', '340');
    const state = () =>
      query<{ state: unknown }>(
        `SELECT jsonb_build_object(
      'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM journal_entries e WHERE organization_id=$1),
      'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM journal_lines l WHERE organization_id=$1),
      'accounts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM accounts a WHERE organization_id=$1)
    ) AS state`,
        [org],
      );
    const before = await state();
    await reportSnapshot(async (db) => {
      expect((await db.query('SHOW transaction_read_only')).rows[0].transaction_read_only).toBe('on');
      expect((await db.query('SHOW transaction_isolation')).rows[0].transaction_isolation).toBe(
        'repeatable read',
      );
      expect(await expenseAccountChart(org, db)).toHaveLength(8);
      expect((await expenseAccountSummary(org, '5030', '2026-03-01', '2026-03-31', db)).totalExpenses).toBe(
        '340.00',
      );
    });
    expect(await state()).toEqual(before);
  });

  it('rejects an oversized chart instead of silently hiding accounts and rejects invalid periods', async () => {
    await query(
      `INSERT INTO accounts(organization_id,code,name,type,currency)
      SELECT $1,(700000+n)::text,'Synthetic bounded account','EXPENSE','USD' FROM generate_series(1,242) n`,
      [org],
    );
    expect(await expenseAccountChart(org)).toHaveLength(250);
    await addAccount('799999', 'Over limit');
    await expect(expenseAccountChart(org)).rejects.toMatchObject({ code: 'CHART_TOO_LARGE', status: 422 });
    await expect(march('5030')).rejects.toMatchObject({ code: 'CHART_TOO_LARGE' });
    await expect(expenseAccountSummary(org, '5030', '2026-03-31', '2026-03-01')).rejects.toThrow(
      'start date',
    );
    await expect(expenseAccountSummary(org, '5030', '2026-02-30', '2026-03-01')).rejects.toThrow();
  });
});
