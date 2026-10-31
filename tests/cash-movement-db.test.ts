import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { accounts, createEntry, reverseEntry } from '../server/ledger';
import { executeFinancialAnalysis, type FinancialQuery } from '../server/financial-analysis';
import { executeFinancialScenario } from '../server/financial-calculation';
import { seedChart } from '../scripts/seed';
import type { EntryInput } from '../shared/schema';

// Actual PostgreSQL, posting constraints and report queries; no model callback.
// Expected amounts below are hand-calculated from these synthetic journal lines,
// not obtained from the financial-analysis compiler or another report query.
const admin = new pg.Client({ connectionString: config.migrationUrl });
let connected = false;
let org: string;
let ids: Record<string, string>;

beforeAll(async () => {
  for (const value of [config.databaseUrl, config.migrationUrl]) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const compose =
      process.env.NODE_ENV === 'test' &&
      url.hostname === 'db' &&
      url.port === '5432' &&
      url.pathname === '/spiich';
    if (!local && !compose) throw new Error('Cash movement tests require isolated local/CI PostgreSQL.');
  }
  await admin.connect();
  connected = true;
});
beforeEach(async () => {
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Cash movement fixture')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
  await addCash('1030', 'Petty cash', 'USD');
});
afterAll(async () => {
  if (connected) await admin.end();
  await pool.end();
});

async function addCash(code: string, name: string, currency: 'USD' | 'JPY') {
  const [account] = await query<{ id: string }>(
    `INSERT INTO accounts(organization_id,code,name,type,currency,parent_id,is_cash)
     VALUES($1,$2,$3,'ASSET',$4,$5,true) RETURNING id`,
    [org, code, name, currency, ids['1000']],
  );
  ids[code] = account.id;
}
function line(code: string, debit: string, credit: string, exchangeRate = '1'): EntryInput['lines'][number] {
  return { accountId: ids[code], debit, credit, exchangeRate, memo: '' };
}
function entry(
  debit: string,
  credit: string,
  amount: string,
  date = '2026-03-15',
  changes: Partial<EntryInput> = {},
): EntryInput {
  return {
    date,
    description: 'Synthetic cash movement',
    counterparty: 'Synthetic counterparty',
    reference: '',
    source: 'MANUAL',
    lines: [line(debit, amount, '0'), line(credit, '0', amount)],
    ...changes,
  };
}
const post = (value: EntryInput) => createEntry(org, value, randomUUID(), { post: true });
function plan(changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id: 'movement',
    metric: 'net_cash_movement',
    aggregation: 'sum',
    from: '2026-03-01',
    to: '2026-03-31',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: 'total',
    accountCodes: [],
    cooccurringAccountCodes: [],
    counterparty: { mode: 'any', value: '' },
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
    order: 'label_asc',
    limit: 50,
    ...changes,
  };
}
async function fingerprint() {
  const [row] = await query<{ snapshot: unknown }>(
    `SELECT jsonb_build_object(
      'entries',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM journal_entries e WHERE organization_id=$1),'[]'::jsonb),
      'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM journal_lines l WHERE organization_id=$1),'[]'::jsonb),
      'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM accounts a WHERE organization_id=$1),'[]'::jsonb)) AS snapshot`,
    [org],
  );
  return createHash('sha256').update(JSON.stringify(row.snapshot)).digest('hex');
}
async function run(...queries: FinancialQuery[]) {
  const before = await fingerprint();
  const result = await executeFinancialAnalysis(org, { queries });
  expect(await fingerprint()).toBe(before);
  return result;
}
type Result = Awaited<ReturnType<typeof run>>;
const values = (result: Result) => result.facts.map((fact) => fact.rows[0]?.value);
const accountValues = (result: Result, index: number) =>
  Object.fromEntries(result.facts[index].rows.map((row) => [row.rowId, row.value]));

describe('Net cash movement uses real posted cash lines without inventing gross cash flows', () => {
  it('nets an internal transfer once even with repeated cash lines, while preserving opposite account effects', async () => {
    const transfer = await post(
      entry('1030', '1010', '150', '2026-03-15', {
        lines: [line('1030', '100', '0'), line('1030', '50', '0'), line('1010', '0', '150')],
      }),
    );
    const result = await run(
      plan(),
      plan({ id: 'accounts', groupBy: 'account' }),
      plan({ id: 'entries', groupBy: 'entry' }),
      plan({ id: 'journal', metric: 'journal_total' }),
    );
    expect(values(result)[0]).toBe('0.00');
    expect(result.facts[0].rows[0].entryCount).toBe('1');
    expect(accountValues(result, 1)).toEqual({
      [`account:${ids['1010']}`]: '-150.00',
      [`account:${ids['1020']}`]: '0.00',
      [`account:${ids['1030']}`]: '150.00',
    });
    expect(result.facts[2].rows).toMatchObject([
      { rowId: `entry:${transfer.id}`, value: '0.00', entryCount: '1' },
    ]);
    expect(result.facts[3].rows[0].value).toBe('150.00');
    expect(result.facts[0].rows[0]).not.toHaveProperty('balanceAsOf');
  });

  it('includes receipts, refunds, borrowing, equity and archived cash while excluding noncash assets', async () => {
    await post(entry('1010', '3010', '1000', '1899-12-31'));
    await post(entry('1010', '4010', '2500'));
    await post(entry('5010', '1010', '300'));
    await post(entry('1010', '5010', '40'));
    await post(entry('1010', '2010', '700'));
    await post(entry('1010', '3010', '200'));
    await post(entry('1030', '1010', '125'));
    await post(entry('1030', '3010', '75'));
    await post(entry('1100', '4010', '5000'));
    await post(entry('1200', '2010', '1000'));
    await createEntry(org, entry('1010', '3010', '9999'), randomUUID());
    await query('UPDATE accounts SET archived=true WHERE organization_id=$1 AND id=$2', [org, ids['1030']]);
    await query("UPDATE accounts SET name='Cash' WHERE organization_id=$1 AND id=$2", [org, ids['1100']]);

    const result = await run(plan(), plan({ id: 'accounts', groupBy: 'account' }));
    // 2500 - 300 + 40 + 700 + 200 + 75; the 125 transfer contributes zero.
    expect(result.facts[0].rows[0]).toMatchObject({ value: '3215.00', entryCount: '7' });
    expect(accountValues(result, 1)).toEqual({
      [`account:${ids['1010']}`]: '3015.00',
      [`account:${ids['1020']}`]: '0.00',
      [`account:${ids['1030']}`]: '200.00',
    });
    expect(result.facts[0].scope).toMatchObject({
      organizationId: org,
      amountBasis: 'net_cash_movement_base_lines',
      cashMovementSource: { selection: 'all_cash_asset_posting_accounts' },
    });
    expect(new Set(result.facts[0].scope.resolvedAccountIds)).toEqual(
      new Set([ids['1010'], ids['1020'], ids['1030']]),
    );
    expect(result.facts[0].scope.cashMovementSource?.accounts).toContainEqual({
      id: ids['1030'],
      code: '1030',
      type: 'ASSET',
      currency: 'USD',
      is_cash: true,
      is_group: false,
      archived: true,
    });
    expect(result.evidence[0].title).toContain('Net cash and bank movement');
    expect(result.evidence[0].source).toBe('posted');
  });

  it('includes both date boundaries and excludes other dates, drafts and another workspace with identical account codes', async () => {
    await post(entry('1010', '3010', '100', '2026-02-28'));
    await post(entry('1010', '4010', '10', '2026-03-01'));
    await post(entry('5030', '1010', '3', '2026-03-31'));
    await post(entry('1010', '3010', '1000', '2026-04-01'));
    await createEntry(org, entry('1010', '4010', '500'), randomUUID());
    const otherOrg = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Other cash movement fixture')", [
      otherOrg,
    ]);
    await seedChart(otherOrg);
    const foreign = Object.fromEntries(
      (await accounts(otherOrg)).map((account) => [account.code, account.id]),
    );
    const otherEntry = entry('1010', '4010', '7777');
    otherEntry.lines[0].accountId = foreign['1010'];
    otherEntry.lines[1].accountId = foreign['4010'];
    await createEntry(otherOrg, otherEntry, randomUUID(), { post: true });
    const result = await run(
      plan(),
      plan({ id: 'last_day', from: '2026-03-31' }),
      plan({ id: 'empty', from: '2026-01-01', to: '2026-01-31' }),
    );
    expect(values(result)).toEqual(['7.00', '-3.00', '0.00']);
    expect(result.facts.map((fact) => fact.rows[0].entryCount)).toEqual(['2', '1', '0']);
  });

  it('keeps native movements separate from saved base rates and cross-currency transfer effects', async () => {
    await post(
      entry('1020', '3010', '100', '2026-02-28', {
        lines: [line('1020', '100', '0', '1.1'), line('3010', '0', '110')],
      }),
    );
    await post(
      entry('1020', '4010', '20.01', '2026-03-10', {
        lines: [line('1020', '20.01', '0', '1.2345'), line('4010', '0', '24.70')],
      }),
    );
    await post(
      entry('5030', '1020', '6.01', '2026-03-11', {
        lines: [line('5030', '6.01', '0'), line('1020', '0', '5.01', '1.2')],
      }),
    );
    await post(
      entry('1020', '1010', '10', '2026-03-12', {
        lines: [line('1020', '10', '0', '1.3'), line('1010', '0', '13')],
      }),
    );
    const result = await run(
      plan(),
      plan({ id: 'eur', currencyMode: 'native', currency: 'EUR' }),
      plan({ id: 'usd', currencyMode: 'native', currency: 'USD' }),
      plan({ id: 'accounts', groupBy: 'account' }),
    );
    // Base:24.70 -6.01 +13 -13 =18.69; nativeEUR:20.01 -5.01 +10 =25.
    expect(values(result).slice(0, 3)).toEqual(['18.69', '25.00', '-13.00']);
    expect(result.facts[1]).toMatchObject({
      currency: 'EUR',
      unit: 'EUR',
      scope: {
        amountBasis: 'net_cash_movement_native_lines',
        resolvedAccountIds: [ids['1020']],
      },
    });
    expect(accountValues(result, 3)[`account:${ids['1020']}`]).toBe('31.69');
    expect(result.evidence[1].rows[0].value).toBe('€25.00 EUR');
    expect(result.evidence[1].scope).toContain('no currency conversion');
  });

  it('preserves native yen precision and returns explicit zero for a currency with no cash accounts', async () => {
    await addCash('1040', 'Yen wallet', 'JPY');
    await post(
      entry('1040', '4010', '300', '2026-03-10', {
        lines: [line('1040', '300', '0', '0.01'), line('4010', '0', '3')],
      }),
    );
    await post(
      entry('5030', '1040', '1', '2026-03-11', {
        lines: [line('5030', '1', '0'), line('1040', '0', '100', '0.01')],
      }),
    );
    const result = await run(
      plan(),
      plan({ id: 'yen', currencyMode: 'native', currency: 'JPY' }),
      plan({ id: 'cad', currencyMode: 'native', currency: 'CAD' }),
    );
    expect(values(result)).toEqual(['2.00', '200', '0.00']);
    expect(result.evidence[1].rows[0].value).toBe('¥200 JPY');
    expect(result.facts[2].scope.resolvedAccountIds).toEqual([]);
    expect(result.facts[2].rows[0].entryCount).toBe('0');
  });

  it('places the original and reversal on their own dates and zero-fills clipped monthly and quarterly flows', async () => {
    const original = await post(entry('5030', '1010', '50', '2026-03-31'));
    await reverseEntry(org, original.id, '2026-04-01', randomUUID());
    await post(entry('1010', '4010', '20', '2026-06-15'));
    await post(entry('1010', '4010', '99', '2026-06-16'));
    const range = { from: '2026-03-10', to: '2026-06-15' };
    const result = await run(
      plan({ ...range, groupBy: 'month' }),
      plan({ ...range, id: 'quarter', groupBy: 'quarter' }),
      plan({ id: 'reversal_only', from: '2026-04-01', to: '2026-04-30' }),
      plan({ ...range, id: 'truncated', groupBy: 'month', limit: 2 }),
    );
    expect(result.facts[0].rows.map((row) => [row.value, row.from, row.to, row.entryCount])).toEqual([
      ['-50.00', '2026-03-10', '2026-03-31', '1'],
      ['50.00', '2026-04-01', '2026-04-30', '1'],
      ['0.00', '2026-05-01', '2026-05-31', '0'],
      ['20.00', '2026-06-01', '2026-06-15', '1'],
    ]);
    expect(result.facts[1].rows.map((row) => [row.value, row.from, row.to])).toEqual([
      ['-50.00', '2026-03-10', '2026-03-31'],
      ['70.00', '2026-04-01', '2026-06-15'],
    ]);
    expect(result.facts[2].rows[0]).toMatchObject({ value: '50.00', entryCount: '1' });
    expect(result.facts[0].rows.every((row) => !('balanceAsOf' in row))).toBe(true);
    expect(result.facts[3]).toMatchObject({ truncated: true });
    expect(result.facts[3].rows).toHaveLength(2);
    expect(result.answer).toContain('not the complete results');
  });

  it('applies literal activity filters and signed entry totals without allocating a mixed payment to one expense', async () => {
    await post(
      entry('5030', '1010', '150', '2026-03-15', {
        description: 'Mixed paper %_ and equipment',
        counterparty: "O'Reilly %_",
        lines: [
          line('5030', '40', '0'),
          line('1200', '110', '0'),
          line('1010', '0', '70'),
          line('1010', '0', '30'),
          line('1030', '0', '50'),
        ],
      }),
    );
    await post(entry('5010', '1010', '90', '2026-03-15', { counterparty: 'Other merchant' }));
    await post(entry('1030', '1010', '20', '2026-03-15', { counterparty: 'Internal transfer' }));
    const result = await run(
      plan({
        cooccurringAccountCodes: ['5030'],
        counterparty: { mode: 'exact', value: "o'reilly %_" },
        descriptionSearch: 'paper %_',
      }),
      plan({ id: 'threshold', minimumAmount: '-150', maximumAmount: '-150' }),
      plan({ id: 'zero_entry', minimumAmount: '0', maximumAmount: '0' }),
      plan({ id: 'parties', groupBy: 'counterparty' }),
    );
    expect(values(result).slice(0, 3)).toEqual(['-150.00', '-150.00', '0.00']);
    expect(result.facts.slice(0, 3).map((fact) => fact.rows[0].entryCount)).toEqual(['1', '1', '1']);
    expect(result.facts[3].rows.map((row) => [row.label, row.value])).toEqual([
      ['Internal transfer', '0.00'],
      ["O'Reilly %_", '-150.00'],
      ['Other merchant', '-90.00'],
    ]);
    expect(result.facts[0].scope.cooccurringAccountIds).toEqual([ids['5030']]);
    expect(result.evidence[0].scope).toContain('does not show how the payment was split');
  });

  it.each(['base', 'native'] as const)(
    'reconciles opening plus period movement to closing in %s currency mode',
    async (currencyMode) => {
      const euro = currencyMode === 'native';
      const cash = euro ? '1020' : '1010';
      const rate = euro ? '1.2' : '1';
      async function deposit(amount: string, baseAmount: string, date: string) {
        await post(
          entry(cash, '3010', amount, date, {
            lines: [line(cash, amount, '0', rate), line('3010', '0', baseAmount)],
          }),
        );
      }
      await deposit('100', euro ? '120' : '100', '1899-12-31');
      await deposit('10', euro ? '12' : '10', '2026-03-01');
      const original = await post(
        entry('5030', cash, '25', '2026-03-31', {
          lines: [line('5030', euro ? '30' : '25', '0'), line(cash, '0', '25', rate)],
        }),
      );
      await reverseEntry(org, original.id, '2026-04-01', randomUUID());
      const basis = { currencyMode, currency: euro ? ('EUR' as const) : null };
      const result = await run(
        plan({ ...basis, id: 'opening', metric: 'cash_balance', from: null, to: '2026-02-28' }),
        plan({ ...basis, id: 'movement' }),
        plan({ ...basis, id: 'closing', metric: 'cash_balance', from: null }),
        plan({ ...basis, id: 'april', from: '2026-04-01', to: '2026-04-30' }),
      );
      expect(values(result)).toEqual(['100.00', '-15.00', '85.00', '25.00']);
      // Integer cents independent of Decimal and query SQL:10000 -1500 =8500.
      const cents = (value: string | null | undefined) => BigInt(value!.replace('.', ''));
      expect(cents(values(result)[0]) + cents(values(result)[1])).toBe(cents(values(result)[2]));
      expect(result.facts[0].scope).toHaveProperty('cashBalanceSource');
      expect(result.facts[1].scope).toHaveProperty('cashMovementSource');
      expect(result.facts[1].scope).not.toHaveProperty('cashBalanceSource');
    },
  );

  it('returns zero when no account is designated cash, even if noncash assets have the same names and balances', async () => {
    // Cash classification is immutable after an account is used. Establish this
    // fixture before posting, without weakening the production database guard.
    await query('UPDATE accounts SET is_cash=false WHERE organization_id=$1', [org]);
    await post(entry('1010', '3010', '100'));
    await post(entry('1100', '4010', '900'));
    const result = await run(plan(), plan({ id: 'accounts', groupBy: 'account' }));
    expect(result.facts[0].rows[0]).toMatchObject({ value: '0.00', entryCount: '0' });
    expect(result.facts[0].scope.resolvedAccountIds).toEqual([]);
    expect(result.facts[0].scope.cashMovementSource?.accounts).toEqual([]);
    expect(result.facts[1].rows).toEqual([]);
  });

  it('executes posted opening cash plus movement through the real scenario calculator with distinct source lineage', async () => {
    await post(entry('1010', '3010', '100', '1899-12-31'));
    await post(entry('1010', '4010', '10', '2026-03-01'));
    await post(entry('5030', '1010', '25', '2026-03-31'));
    // These noncash assets must not enter either cash operand, even when both
    // references participate in one calculation rather than standalone reports.
    await post(entry('1100', '4010', '900', '2026-03-01'));
    await post(entry('1200', '2010', '600', '2026-03-01'));
    const before = await fingerprint();
    const result = await executeFinancialScenario(
      org,
      {
        queries: [
          plan({ id: 'opening', metric: 'cash_balance', from: null, to: '2026-02-28' }),
          plan({ id: 'movement' }),
        ],
        assumptions: [],
        calculations: [
          {
            id: 'reconciled_cash',
            operation: 'add',
            operands: [
              { source: 'query', id: 'opening', rowId: 'total:total', field: 'value' },
              { source: 'query', id: 'movement', rowId: 'total:total', field: 'value' },
            ],
          },
        ],
      },
      [
        {
          role: 'user',
          content: 'Add opening cash on February 28, 2026 to the net cash movement during March 2026.',
        },
      ],
    );
    expect(await fingerprint()).toBe(before);
    expect(result.answer).toContain('$85.00');
    expect(result.facts.at(-1)).toMatchObject({
      kind: 'scenario_calculation',
      id: 'reconciled_cash',
      value: '85.00',
      unit: 'USD',
      exact: { numerator: '85', denominator: '1' },
      source: 'posted',
      hypothetical: false,
      assumptions: [],
      cashSources: [
        {
          queryId: 'opening',
          rowId: 'total:total',
          asOf: '2026-02-28',
          accountIds: [ids['1010'], ids['1020'], ids['1030']],
        },
      ],
      cashMovementSources: [
        {
          queryId: 'movement',
          rowId: 'total:total',
          from: '2026-03-01',
          to: '2026-03-31',
          accountIds: [ids['1010'], ids['1020'], ids['1030']],
        },
      ],
    });
    expect(result.evidence.every((evidence) => evidence.source === 'posted')).toBe(true);
  });

  it('rejects draft movement, model-selected cash subsets, missing dates and per-entry averages without changing books', async () => {
    await post(entry('1010', '4010', '100'));
    const before = await fingerprint();
    for (const changes of [
      { status: 'DRAFT' as const },
      { accountCodes: ['1000'] },
      { accountCodes: ['1010'] },
      { from: null },
      { aggregation: 'average_per_entry' as const },
    ]) {
      await expect(executeFinancialAnalysis(org, { queries: [plan(changes)] })).rejects.toMatchObject({
        code: 'INVALID_ANALYSIS_SCOPE',
      });
    }
    expect(await fingerprint()).toBe(before);
  });
});
