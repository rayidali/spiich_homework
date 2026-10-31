import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../server/db';
import {
  compileFinancialQuery,
  executeFinancialAnalysis,
  financialAnalysisSchema,
  financialAnalysisTool,
  type AnalysisAccount,
  type FinancialQuery,
} from '../server/financial-analysis';

const org = '00000000-0000-4000-8000-000000000001';
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
function account(index: number, change: Partial<AnalysisAccount>): AnalysisAccount {
  return {
    id: id(index),
    code: String(1000 + index),
    name: `Account ${index}`,
    type: 'ASSET',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    archived: false,
    is_cash: false,
    ...change,
  };
}
const chart: AnalysisAccount[] = [
  account(10, { code: '1010', name: 'Operating bank', is_cash: true }),
  account(20, { code: '1020', name: 'Closed bank', is_cash: true, archived: true }),
  account(30, { code: '1030', name: 'Euro bank', is_cash: true, currency: 'EUR' }),
  account(40, { code: '1100', name: 'Cash', is_cash: false }),
  account(50, { code: '1200', name: 'Accounts receivable' }),
  account(60, { code: '1500', name: 'Equipment' }),
  account(70, { code: '1000', name: 'Assets', is_group: true, is_cash: true }),
  account(80, { code: '2000', name: 'Credit card', type: 'LIABILITY', is_cash: true }),
  account(90, { code: '5030', name: 'Office supplies', type: 'EXPENSE' }),
];
function plan(change: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id: 'cash_change',
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
    ...change,
  };
}

describe('Net cash movement compiler (offline)', () => {
  it('advertises the distinct metric and accepts its complete structured plan', () => {
    expect(financialAnalysisSchema.parse({ queries: [plan()] }).queries[0].metric).toBe('net_cash_movement');
    expect(JSON.stringify(financialAnalysisTool.parameters)).toContain('"net_cash_movement"');
  });

  it('selects all cash-designated asset posting accounts, including archived and foreign-currency accounts', () => {
    const result = compileFinancialQuery(org, plan(), chart);
    expect(result.selected.map((a) => a.id)).toEqual([id(10), id(20), id(30)]);
    expect(result.params).toContainEqual([id(10), id(20), id(30)]);
    expect(result.params).toContainEqual(['ASSET']);
    expect(result.sql).toContain('a.is_cash');
    expect(result.sql).toContain('NOT a.is_group');
    expect(result.sql).toContain('a.id=ANY($5::uuid[])');
    expect(result.sql).toContain('a.organization_id=$1');
    expect(result.sql).toContain('l.organization_id=$1');
    expect(result.sql).toContain('e.organization_id=$1');
    expect(result.sql).not.toContain('NOT a.archived');
    expect(result.sql).not.toContain('a.archived=false');
  });

  it('keeps an empty cash selection constrained rather than falling back to all assets', () => {
    for (const accounts of [[], chart.filter((a) => !['1010', '1020', '1030'].includes(a.code))]) {
      const result = compileFinancialQuery(org, plan(), accounts);
      expect(result.selected).toEqual([]);
      expect(result.params[4]).toEqual([]);
      expect(result.sql).toContain('a.is_cash');
      expect(result.sql).toContain('a.id=ANY($5::uuid[])');
      expect(result.sql).toContain('coalesce(sum(m.amount),0)');
    }
  });

  it('measures the inclusive period signed movement at saved base amounts, never an inception balance or full-journal debit total', () => {
    const result = compileFinancialQuery(org, plan(), chart);
    expect(result.params.slice(0, 4)).toEqual([org, '2026-03-01', '2026-03-31', 'POSTED']);
    expect(result.sql).toContain('e.date >= $2::date');
    expect(result.sql).toContain('e.date <= $3::date');
    expect(result.sql).toContain('(l.base_debit-l.base_credit) AS amount');
    expect(result.sql).not.toContain('(l.base_debit) AS amount');
    expect(result.sql).not.toContain('CROSS JOIN LATERAL');
    expect(result.sql).not.toContain('exchange_rate');
  });

  it('selects only one explicit native currency and binds both account and saved line currency', () => {
    const result = compileFinancialQuery(org, plan({ currencyMode: 'native', currency: 'EUR' }), chart);
    expect(result.selected.map((a) => a.id)).toEqual([id(30)]);
    expect(result.params[12]).toBe('EUR');
    expect(result.sql).toContain('(l.debit-l.credit) AS amount');
    expect(result.sql).toContain('a.currency=$13 AND l.currency=$13');
    expect(result.sql).not.toContain('(l.base_debit-l.base_credit) AS amount');
    const absent = compileFinancialQuery(org, plan({ currencyMode: 'native', currency: 'JPY' }), chart);
    expect(absent.selected).toEqual([]);
    expect(absent.params[4]).toEqual([]);
    expect(absent.sql).toContain('a.id=ANY($5::uuid[])');
  });

  it.each([
    { label: 'a model-selected cash subset', change: { accountCodes: ['1010'] } },
    { label: 'a generic Assets group', change: { accountCodes: ['1000'] } },
    { label: 'a noncash asset', change: { accountCodes: ['1200'] } },
    { label: 'draft values', change: { status: 'DRAFT' } },
    { label: 'per-entry averaging', change: { aggregation: 'average_per_entry' } },
    { label: 'an omitted lower date', change: { from: null } },
    { label: 'reversed dates', change: { from: '2026-04-01' } },
    { label: 'base mode with a native currency', change: { currency: 'EUR' } },
    { label: 'native mode without its currency', change: { currencyMode: 'native' } },
  ] satisfies { label: string; change: Partial<FinancialQuery> }[])(
    'rejects $label instead of broadening or changing the measure',
    ({ change }) => {
      expect(() => compileFinancialQuery(org, plan(change), chart)).toThrow();
    },
  );

  it('binds activity filters and limits as data while keeping the measured cash accounts fixed', () => {
    const hostile = "Acme %_'); DROP TABLE journal_entries; --";
    const result = compileFinancialQuery(
      org,
      plan({
        cooccurringAccountCodes: ['5030'],
        counterparty: { mode: 'contains', value: hostile },
        descriptionSearch: hostile,
        minimumAmount: '-300.00',
        maximumAmount: '400.00',
        groupBy: 'counterparty',
        limit: 3,
      }),
      chart,
    );
    expect(result.selected.map((a) => a.id)).toEqual([id(10), id(20), id(30)]);
    expect(result.cooccurring.map((a) => a.id)).toEqual([id(90)]);
    expect(result.sql).not.toContain(hostile);
    expect(result.sql).not.toContain('-300.00');
    expect(result.sql).not.toContain('400.00');
    expect(result.params).toContain(hostile);
    expect(result.params).toContain('-300.00');
    expect(result.params).toContain('400.00');
    expect(result.params[10]).toBe(4);
    expect(result.sql).toContain('co.organization_id=$1');
    expect(result.sql).toContain('co.account_id=ANY($6::uuid[])');
    expect(result.sql).toContain('entry_values AS (SELECT entry_id,sum(amount) AS amount');
    expect(result.sql).toContain('amount >= $9::numeric');
    expect(result.sql).toContain('amount <= $10::numeric');
    expect(result.sql).toContain('position(lower($7) IN lower(e.counterparty))>0');
  });

  it.each(['total', 'account', 'month', 'quarter', 'counterparty', 'entry'] as const)(
    'permits the supported %s grouping without turning a movement series into closing balances',
    (groupBy) => {
      const result = compileFinancialQuery(org, plan({ groupBy }), chart);
      expect(result.plan.groupBy).toBe(groupBy);
      expect(result.sql).toContain('e.date >= $2::date');
      expect(result.sql).not.toContain('CROSS JOIN LATERAL');
      if (groupBy === 'month' || groupBy === 'quarter') {
        expect(result.sql).toContain('generate_series');
        expect(result.sql).toContain('LEFT JOIN grouped');
      }
    },
  );

  it('retains strict input boundaries and refuses raw SQL or a foreign co-occurring account', () => {
    expect(() => financialAnalysisSchema.parse({ queries: [{ ...plan(), sql: 'SELECT 1' }] })).toThrow();
    expect(() => financialAnalysisSchema.parse({ queries: [plan()], organizationId: 'other' })).toThrow();
    expect(() => compileFinancialQuery(org, plan({ cooccurringAccountCodes: ['9999'] }), chart)).toThrow(
      'workspace',
    );
  });
});

type OutputRow = {
  row_id: string;
  label: string;
  value: string;
  entry_count: string;
  period_from: string | null;
  period_to: string | null;
};

// Output-only checks use explicitly stubbed query rows. Real arithmetic and
// PostgreSQL execution are covered by the separate cash-movement DB suite.
async function output(
  query: FinancialQuery,
  rows: OutputRow[] = [
    {
      row_id: 'total',
      label: 'Total',
      value: '-240.00',
      entry_count: '2',
      period_from: null,
      period_to: null,
    },
  ],
  accounts = chart,
) {
  const execute = vi.fn(async (sql: string) => {
    if (sql.startsWith('SET LOCAL')) return { rows: [] };
    if (sql.startsWith('SELECT id,code,name,type,currency,parent_id,is_group,archived,is_cash'))
      return { rows: accounts };
    if (sql.startsWith('WITH typed_input')) return { rows };
    throw new Error('Unexpected offline query');
  });
  const result = await executeFinancialAnalysis(org, { queries: [query] }, {
    query: execute,
  } as unknown as Db);
  return { result, execute };
}

describe('Net cash movement presentation and provenance (stubbed database)', () => {
  it('labels signed period activity and cash provenance without claiming a closing balance or gross payments', async () => {
    const { result } = await output(plan());
    expect(result.answer).toContain('Net cash and bank movement');
    expect(result.evidence[0]).toMatchObject({
      source: 'posted',
      rows: [{ label: 'Total', value: '-$240.00' }],
    });
    expect(result.evidence[0].period).toContain('2026-03-01');
    expect(result.evidence[0].period).toContain('2026-03-31');
    const scope = result.evidence[0].scope!;
    expect(scope).toMatch(/positive.*increase/i);
    expect(scope).toMatch(/negative.*decrease/i);
    expect(scope).toMatch(/transfers.*cancel/i);
    expect(scope).toMatch(/gross/i);
    expect(scope).toMatch(/receipts|payments/i);
    expect(scope).toMatch(/saved.*transaction|rates saved/i);
    expect(result.answer).not.toMatch(/closing|as of/i);
    const fact = result.facts[0];
    expect(fact).toMatchObject({
      metric: 'net_cash_movement',
      unit: 'USD',
      currency: 'USD',
      rows: [{ value: '-240.00', from: '2026-03-01', to: '2026-03-31' }],
      scope: {
        resolvedAccountIds: [id(10), id(20), id(30)],
        amountBasis: 'net_cash_movement_base_lines',
        statusMeaning: 'booked',
        cashMovementSource: { selection: 'all_cash_asset_posting_accounts' },
      },
    });
    expect(fact.rows[0]).not.toHaveProperty('balanceAsOf');
    expect(fact.scope).not.toHaveProperty('cashBalanceSource');
    expect(fact.scope.cashMovementSource?.accounts).toEqual(
      chart.slice(0, 3).map(({ id, code, type, currency, is_cash, is_group, archived }) => ({
        id,
        code,
        type,
        currency,
        is_cash,
        is_group,
        archived,
      })),
    );
  });

  it('exposes the native currency restriction and its cross-currency transfer limitation', async () => {
    const { result } = await output(plan({ currencyMode: 'native', currency: 'EUR' }));
    expect(result.answer).toContain('EUR');
    expect(result.evidence[0].scope).toMatch(/no currency conversion/i);
    expect(result.evidence[0].scope).toMatch(/native.currency.*only one side/i);
    expect(result.facts[0]).toMatchObject({
      unit: 'EUR',
      currency: 'EUR',
      scope: {
        resolvedAccountIds: [id(30)],
        amountBasis: 'net_cash_movement_native_lines',
        cashMovementSource: { accounts: [{ id: id(30), currency: 'EUR' }] },
      },
    });
    expect(result.facts[0].scope.cashMovementSource?.accounts).toHaveLength(1);
  });

  it('keeps monthly values as period flows and marks truncated rows rather than implying complete totals', async () => {
    const { result } = await output(plan({ groupBy: 'month', limit: 1, to: '2026-04-30' }), [
      {
        row_id: '2026-03',
        label: '2026-03',
        value: '10.00',
        entry_count: '1',
        period_from: '2026-03-01',
        period_to: '2026-03-31',
      },
      {
        row_id: '2026-04',
        label: '2026-04',
        value: '20.00',
        entry_count: '1',
        period_from: '2026-04-01',
        period_to: '2026-04-30',
      },
    ]);
    expect(result.facts[0].truncated).toBe(true);
    expect(result.facts[0].rows).toHaveLength(1);
    expect(result.facts[0].rows[0]).toMatchObject({ from: '2026-03-01', to: '2026-03-31' });
    expect(result.facts[0].rows[0]).not.toHaveProperty('balanceAsOf');
    expect(result.evidence[0].rows[0].label).toContain('2026-03-01 to 2026-03-31');
    expect(result.evidence[0].rows[0].label).not.toContain('closing');
    expect(result.answer).toContain('not the complete results');
  });

  it('preserves empty source provenance for a zero result instead of inventing cash accounts', async () => {
    const { result } = await output(
      plan(),
      [
        {
          row_id: 'total',
          label: 'Total',
          value: '0.00',
          entry_count: '0',
          period_from: null,
          period_to: null,
        },
      ],
      [],
    );
    expect(result.facts[0]).toMatchObject({
      rows: [{ value: '0.00', entryCount: '0' }],
      scope: { resolvedAccountIds: [], cashMovementSource: { accounts: [] } },
    });
    expect(result.answer).toContain('$0.00');
    expect(result.evidence[0].scope).toMatch(/cash.designated/i);
  });
});
