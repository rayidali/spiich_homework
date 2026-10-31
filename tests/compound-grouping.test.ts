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
import {
  compoundRowId,
  groupingDimensions,
  groupingPeriod,
  groupingSchema,
  MAX_COMPOUND_CELLS,
  type GroupDimension,
} from '../server/financial-grouping';

const org = '00000000-0000-4000-8000-000000000001';
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
function account(index: number, change: Partial<AnalysisAccount>): AnalysisAccount {
  return {
    id: id(index),
    code: String(5000 + index),
    name: `Account ${index}`,
    type: 'EXPENSE',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    archived: false,
    is_cash: false,
    ...change,
  };
}
const chart: AnalysisAccount[] = [
  account(1, { code: '5000', name: 'Operating expenses', is_group: true }),
  account(2, { code: '5030', name: 'Office supplies', parent_id: id(1) }),
  account(3, { code: '5040', name: 'Archived rent', parent_id: id(1), archived: true }),
  account(4, { code: '5050', name: 'Euro supplies', parent_id: id(1), currency: 'EUR' }),
  account(5, { code: '1010', name: 'Bank', type: 'ASSET', is_cash: true }),
  account(6, { code: '2010', name: 'Payables', type: 'LIABILITY' }),
  account(7, { code: '4010', name: 'Sales', type: 'REVENUE' }),
];
function plan(change: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id: 'compound',
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-01-15',
    to: '2026-03-12',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: ['month', 'account'],
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
const compile = (change: Partial<FinancialQuery> = {}, accounts = chart) =>
  compileFinancialQuery(org, plan(change), accounts);
const sqlText = (sql: string) => sql.replace(/\s+/g, ' ');

describe('Compound grouping input and planner contract (offline)', () => {
  it('preserves the requested dimension order and keeps scalar plans backward compatible', () => {
    const requested = ['counterparty', 'quarter', 'account'] as const;
    const parsed = financialAnalysisSchema.parse({ queries: [plan({ groupBy: [...requested] })] });
    expect(parsed.queries[0].groupBy).toEqual(requested);
    expect(groupingDimensions(parsed.queries[0].groupBy)).toEqual(requested);
    expect(groupingPeriod(parsed.queries[0].groupBy)).toBe('quarter');
    for (const groupBy of ['total', 'account', 'month', 'quarter', 'counterparty', 'entry'] as const) {
      expect(groupingSchema.parse(groupBy)).toBe(groupBy);
      expect(groupingDimensions(groupBy)).toEqual([groupBy]);
    }
    expect(groupingPeriod('total')).toBeUndefined();
  });

  it.each([
    { label: 'empty dimensions', value: [] },
    { label: 'one array dimension', value: ['account'] },
    { label: 'four dimensions', value: ['account', 'counterparty', 'month', 'quarter'] },
    { label: 'duplicate dimensions', value: ['account', 'account'] },
    { label: 'two time grains', value: ['month', 'quarter'] },
    { label: 'total as a compound dimension', value: ['total', 'account'] },
    { label: 'entry as a compound dimension', value: ['entry', 'month'] },
    { label: 'unknown SQL-shaped dimension', value: ['account', 'counterparty; SELECT 1'] },
    { label: 'an object instead of a dimension', value: ['month', { field: 'account' }] },
  ])('rejects $label', ({ value }) => {
    expect(() => financialAnalysisSchema.parse({ queries: [{ ...plan(), groupBy: value }] })).toThrow();
  });

  it('exposes arrays in the actual provider schema and explains identity, limits and requested grouping', () => {
    const parameters = financialAnalysisTool.parameters as {
      properties: { queries: { items: { properties: { groupBy: { anyOf: unknown[] } } } } };
    };
    expect(parameters.properties.queries.items.properties.groupBy.anyOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'string' }),
        expect.objectContaining({
          type: 'array',
          minItems: 2,
          maxItems: 3,
          items: expect.objectContaining({ enum: ['account', 'counterparty', 'month', 'quarter'] }),
        }),
      ]),
    );
    expect(financialAnalysisTool.description).toMatch(/never silently replace a compound grouping/i);
    expect(financialAnalysisTool.description).toMatch(/GLOBAL/);
    expect(financialAnalysisTool.description).toContain('compound:[["month","2026-03"],["account","5030"]]');
    expect(financialAnalysisTool.description).toMatch(
      /observed after all filters and entry amount thresholds/i,
    );
    expect(financialAnalysisTool.description).toMatch(/case-sensitive/);
    expect(financialAnalysisTool.description).toMatch(/empty averages are null/i);
  });

  it('allows each ordered valid flow combination without collapsing dimensions', () => {
    for (const groupBy of [
      ['account', 'counterparty'],
      ['counterparty', 'account'],
      ['account', 'month'],
      ['month', 'account'],
      ['counterparty', 'quarter'],
      ['quarter', 'counterparty'],
      ['month', 'account', 'counterparty'],
      ['counterparty', 'account', 'quarter'],
    ] satisfies FinancialQuery['groupBy'][]) {
      const compiled = compile({ groupBy });
      expect(compiled.plan.groupBy).toEqual(groupBy);
      expect(compiled.sql).toContain('jsonb_build_array(');
      expect(compiled.sql).toContain('e.date >= $2::date');
    }
  });

  it.each(['journal_total', 'journal_count'] as const)(
    'keeps %s at entry grain before its counterparty/time aggregation and refuses account allocation',
    (metric) => {
      const compiled = compile({ metric, groupBy: ['quarter', 'counterparty'], accountCodes: ['5030'] });
      expect(compiled.sql).toContain('chosen.entry_id=e.id AND chosen.account_id=ANY($5::uuid[])');
      const metricLines = compiled.sql.split('metric_lines AS (')[1]!.split('entry_values AS (')[0]!;
      expect(metricLines).not.toContain('a.id=ANY($5::uuid[])');
      expect(compiled.sql).toContain('count(DISTINCT m.entry_id)');
      for (const groupBy of [
        ['account', 'month'],
        ['counterparty', 'account'],
      ] as const) {
        expect(() => compile({ metric, groupBy: [...groupBy] })).toThrow(/cannot be allocated/);
      }
    },
  );
});

describe('Compound grouping SQL boundaries (offline compilation)', () => {
  it('fills every scoped posting account across time, including archived and quiet accounts', () => {
    const compiled = compile({ accountCodes: ['5000'] });
    expect(compiled.groupingAccounts).toEqual([
      { id: id(2), code: '5030' },
      { id: id(3), code: '5040' },
      { id: id(4), code: '5050' },
    ]);
    expect(sqlText(compiled.sql)).toMatch(/tuples AS \(SELECT DISTINCT .* FROM account_scope a LIMIT/);
    expect(compiled.sql).toContain('CROSS JOIN periods p');
    expect(compiled.sql).toContain('LEFT JOIN grouped');
    expect(compiled.sql).not.toContain('NOT a.archived');
    expect(compiled.sql).not.toContain('a.archived=false');
    expect(compiled.sql).toContain('NOT a.is_group');
  });

  it('publishes effective unfiltered account identities without including groups or other account types', () => {
    expect(compile().selected).toEqual([]);
    expect(compile().groupingAccounts).toEqual([
      { id: id(2), code: '5030' },
      { id: id(3), code: '5040' },
      { id: id(4), code: '5050' },
    ]);
    expect(compile({ currencyMode: 'native', currency: 'EUR' }).groupingAccounts).toEqual([
      { id: id(4), code: '5050' },
    ]);
    expect(compile({}, []).groupingAccounts).toEqual([]);
  });

  it('takes account/counterparty tuples only from jointly observed qualified lines, never separate universes', () => {
    const compiled = compile({
      groupBy: ['month', 'account', 'counterparty'],
      minimumAmount: '40.00',
      maximumAmount: '100.00',
    });
    const sql = sqlText(compiled.sql);
    expect(sql).toContain(
      'qualified_lines AS (SELECT m.* FROM metric_lines m JOIN qualified_entries q ON q.entry_id=m.entry_id)',
    );
    expect(sql).toMatch(
      /tuples AS \(SELECT DISTINCT .*m.account_id::text.*m.counterparty.* FROM qualified_lines m LIMIT/,
    );
    expect(sql).toContain('FROM tuples t CROSS JOIN periods p');
    expect(sql).not.toMatch(/CROSS JOIN (?:accounts|account_scope|vendors|counterparties)/);
    expect(sql.indexOf('amount >= $9::numeric')).toBeLessThan(sql.indexOf('qualified_lines AS'));
    expect(sql).not.toMatch(/HAVING.*(?:sum\(.*\)(?:\s*[!<>]=?\s*0))/);
  });

  it('does not generate time buckets or fabricated pairs for account/counterparty grouping alone', () => {
    const compiled = compile({ groupBy: ['account', 'counterparty'] });
    expect(compiled.sql).toContain('FROM qualified_lines m LIMIT 30001');
    expect(compiled.sql).not.toContain('generate_series');
    expect(compiled.sql).toContain('NULL::date AS period_from,NULL::date AS period_to');
  });

  it('retains blank, literal-placeholder and case-distinct counterparty identities', () => {
    const compiled = compile({ groupBy: ['counterparty', 'month'] });
    expect(compiled.sql).toContain(
      "CASE WHEN m.counterparty='' THEN '(No counterparty)' ELSE to_jsonb(m.counterparty)::text END",
    );
    expect(compiled.sql).toContain('m.counterparty AS k0,m.counterparty AS key0');
    expect(compiled.sql).toContain('GROUP BY m.counterparty,');
    expect(compiled.sql).not.toContain('lower(m.counterparty)');
  });

  it('keeps dates, vendor text, description, amount thresholds and row limit parameterized', () => {
    const hostile = "A %_'); DROP TABLE accounts; --";
    const compiled = compile({
      groupBy: ['counterparty', 'account', 'month'],
      counterparty: { mode: 'contains', value: hostile },
      descriptionSearch: hostile,
      cooccurringAccountCodes: ['1010'],
      minimumAmount: '-50.00',
      maximumAmount: '300.00',
      limit: 3,
    });
    expect(compiled.sql).not.toContain(hostile);
    expect(compiled.sql).not.toContain('2026-01-15');
    expect(compiled.params.slice(0, 4)).toEqual([org, '2026-01-15', '2026-03-12', 'POSTED']);
    expect(compiled.params.slice(5, 11)).toEqual([[id(5)], hostile, hostile, '-50.00', '300.00', 4]);
    expect(compiled.sql).toContain('e.organization_id=$1');
    expect(compiled.sql).toContain('l.organization_id=$1');
    expect(compiled.sql).toContain('a.organization_id=$1');
    expect(compiled.sql).toContain('co.organization_id=$1');
    expect(compiled.sql).toContain('position(lower($7) IN lower(e.counterparty))>0');
  });

  it('bounds the full grid before returning globally ordered results, instead of silently limiting its tuple universe', () => {
    expect(MAX_COMPOUND_CELLS).toBe(30_000);
    const compiled = compile({ groupBy: ['counterparty', 'month'], limit: 2, order: 'value_desc' });
    expect(compiled.sql).toContain('FROM qualified_lines m LIMIT 10001');
    expect(compiled.sql).toContain('count(*)>10000 AS scope_overflow');
    expect(compiled.sql).toContain('WHERE NOT capacity.scope_overflow');
    expect(compiled.sql).toContain('UNION ALL');
    expect(compiled.sql).toMatch(/NULL::jsonb,true FROM tuple_capacity WHERE scope_overflow/);
    expect(compiled.sql).toMatch(
      /FROM output ORDER BY result_value DESC NULLS LAST,label ASC,dimensions::text ASC LIMIT \$11\s*$/,
    );
    expect(compiled.params[10]).toBe(3);
    expect(compiled.sql).not.toMatch(/row_number|PARTITION BY/i);
  });

  it('allows exactly 120 periods while independently sizing the compound tuple capacity', () => {
    const compiled = compile({ from: '2017-01-01', to: '2026-12-31', groupBy: ['account', 'month'] });
    expect(compiled.sql).toContain('FROM account_scope a LIMIT 251');
    expect(compiled.sql).toContain('count(*)>250 AS scope_overflow');
    expect(() => compile({ from: '2016-12-01', to: '2026-12-31' })).toThrow(/120 calendar periods/);
    expect(() => compile({ from: '1997-01-01', to: '2027-03-31', groupBy: ['account', 'quarter'] })).toThrow(
      /120 calendar periods/,
    );
  });

  it('clips both partial boundary buckets and averages each cell over distinct matching entries', () => {
    const compiled = compile({ aggregation: 'average_per_entry' });
    expect(compiled.sql).toContain('greatest(bucket::date,$2::date) AS period_from');
    expect(compiled.sql).toContain(
      "least((bucket+interval '1 month'-interval '1 day')::date,$3::date) AS period_to",
    );
    expect(compiled.sql).toContain('count(DISTINCT m.entry_id)::numeric AS entry_count');
    expect(compiled.sql).toContain('CASE WHEN g.entry_count=0 THEN NULL ELSE g.value/g.entry_count END');
    expect(compiled.sql).not.toContain('avg(m.amount)');
  });

  it('keeps native account and line currency filters rather than converting grouped values', () => {
    const compiled = compile({ currencyMode: 'native', currency: 'EUR' });
    expect(compiled.params[12]).toBe('EUR');
    expect(compiled.sql).toContain('(l.debit-l.credit) AS amount');
    expect(compiled.sql).toContain('a.currency=$13 AND l.currency=$13');
    expect(compiled.sql).not.toContain('exchange_rate');
  });

  it('supports mixed normal-balance account types only in separate account/time cells and includes inception history', () => {
    const compiled = compile({
      metric: 'account_balance',
      accountCodes: ['1010', '2010'],
      groupBy: ['quarter', 'account'],
    });
    expect(compiled.groupingAccounts).toEqual([
      { id: id(5), code: '1010' },
      { id: id(6), code: '2010' },
    ]);
    expect(compiled.sql).toContain(
      "CASE WHEN a.type IN ('ASSET','EXPENSE') THEN l.base_debit-l.base_credit ELSE l.base_credit-l.base_debit END",
    );
    expect(compiled.sql).not.toContain('e.date >= $2::date');
    expect(compiled.sql).toContain('CROSS JOIN LATERAL');
    expect(compiled.sql).toContain('m.account_id::text=g.k0 AND m.date<=g.period_to');
    expect(() =>
      compile({ metric: 'account_balance', accountCodes: ['1010', '2010'], groupBy: 'quarter' }),
    ).toThrow(/one account type/);
  });

  it('keeps compound cash balances and movement tied to server-selected cash accounts, with different time scopes', () => {
    for (const metric of ['cash_balance', 'net_cash_movement'] as const) {
      const compiled = compile({ metric });
      expect(compiled.selected.map((item) => item.id)).toEqual([id(5)]);
      expect(compiled.groupingAccounts).toEqual([{ id: id(5), code: '1010' }]);
      expect(compiled.sql).toContain('a.is_cash');
      expect(compiled.sql).toContain('a.id=ANY($5::uuid[])');
      expect(compiled.sql.includes('e.date >= $2::date')).toBe(metric === 'net_cash_movement');
      expect(compiled.sql.includes('CROSS JOIN LATERAL')).toBe(metric === 'cash_balance');
      expect(() => compile({ metric, accountCodes: ['1010'] })).toThrow();
    }
  });

  it.each([
    { label: 'counterparty without a date', change: { groupBy: ['account', 'counterparty'] } },
    { label: 'a three-dimensional balance', change: { groupBy: ['account', 'counterparty', 'month'] } },
    { label: 'a missing display start', change: { from: null } },
    { label: 'unposted amounts', change: { status: 'DRAFT' } },
    { label: 'amount filtering', change: { minimumAmount: '1.00' } },
    { label: 'vendor filtering', change: { counterparty: { mode: 'exact', value: 'Acme' } } },
    { label: 'description filtering', change: { descriptionSearch: 'rent' } },
    { label: 'cooccurrence filtering', change: { cooccurringAccountCodes: ['2010'] } },
    { label: 'per-entry average', change: { aggregation: 'average_per_entry' } },
  ] satisfies { label: string; change: Partial<FinancialQuery> }[])(
    'refuses $label for compound book balances',
    ({ change }) => {
      expect(() => compile({ metric: 'account_balance', accountCodes: ['1010'], ...change })).toThrow();
    },
  );
});

describe('Compound identity helper', () => {
  it('uses exact ordered typed keys rather than display labels, account UUIDs or URI encoding', () => {
    const dimensions: GroupDimension[] = [
      { kind: 'month', key: '2026-01', label: 'January' },
      { kind: 'account', key: '5030', label: 'Office supplies', accountId: id(2) },
      { kind: 'counterparty', key: 'A/B · "雪"', label: 'A different display label' },
    ];
    expect(compoundRowId(dimensions)).toBe(
      String.raw`compound:[["month","2026-01"],["account","5030"],["counterparty","A/B · \"雪\""]]`,
    );
    expect(JSON.parse(compoundRowId(dimensions).slice('compound:'.length))).toEqual([
      ['month', '2026-01'],
      ['account', '5030'],
      ['counterparty', 'A/B · "雪"'],
    ]);
    expect(compoundRowId(dimensions.map((dimension) => ({ ...dimension, label: 'Changed' })))).toBe(
      compoundRowId(dimensions),
    );
    expect(compoundRowId([...dimensions].reverse())).not.toBe(compoundRowId(dimensions));
  });

  it('does not collide on delimiter-shaped names, blanks or literal placeholder names', () => {
    const groups: GroupDimension[][] = [
      [
        { kind: 'account', key: '5030', label: '' },
        { kind: 'counterparty', key: '', label: '' },
      ],
      [
        { kind: 'account', key: '5030', label: '' },
        { kind: 'counterparty', key: '(No counterparty)', label: '' },
      ],
      [
        { kind: 'account', key: '5030', label: '' },
        { kind: 'counterparty', key: 'a","month","2026-01', label: '' },
      ],
      [
        { kind: 'account', key: '5030', label: '' },
        { kind: 'counterparty', key: 'Acme', label: '' },
      ],
      [
        { kind: 'account', key: '5030', label: '' },
        { kind: 'counterparty', key: 'acme', label: '' },
      ],
    ];
    expect(new Set(groups.map(compoundRowId)).size).toBe(groups.length);
  });
});

type RawOutput = {
  row_id: string;
  label: string;
  value: string | null;
  entry_count: string;
  period_from: string | null;
  period_to: string | null;
  dimensions?: GroupDimension[];
  scope_overflow?: boolean;
};
const row = (change: Partial<RawOutput> = {}): RawOutput => ({
  row_id: 'ignored-placeholder',
  label: '2026-01 · 5030 · Office supplies',
  value: '100.00',
  entry_count: '2',
  period_from: '2026-01-15',
  period_to: '2026-01-31',
  dimensions: [
    { kind: 'month', key: '2026-01', label: '2026-01' },
    { kind: 'account', key: '5030', label: '5030 · Office supplies', accountId: id(2) },
  ],
  scope_overflow: false,
  ...change,
});

// These tests verify rendering/provenance of explicitly stubbed SQL results.
// The separate PostgreSQL suite proves aggregation, zero-fill and arithmetic.
async function output(query: FinancialQuery, rows: RawOutput[], accounts = chart) {
  const execute = vi.fn(async (sql: string) => {
    if (sql.startsWith('SET LOCAL')) return { rows: [] };
    if (sql.startsWith('SELECT id,code,name,type,currency,parent_id,is_group,archived,is_cash'))
      return { rows: accounts };
    if (sql.startsWith('WITH typed_input')) return { rows };
    throw new Error('Unexpected offline query');
  });
  return executeFinancialAnalysis(org, { queries: [query] }, { query: execute } as unknown as Db);
}

describe('Compound financial facts and presentation (stubbed database)', () => {
  it('computes row IDs from typed dimensions, exposes actual account identities and clips each flow row', async () => {
    const raw = row();
    const result = await output(plan(), [raw]);
    const fact = result.facts[0]!;
    expect(fact.rows[0]).toMatchObject({
      rowId: 'compound:[["month","2026-01"],["account","5030"]]',
      dimensions: raw.dimensions,
      value: '100.00',
      entryCount: '2',
      from: '2026-01-15',
      to: '2026-01-31',
    });
    expect(fact.rows[0]).not.toHaveProperty('balanceAsOf');
    expect(fact.grain).toEqual(['month', 'account']);
    expect(fact.scope.groupingAccounts).toEqual(compile().groupingAccounts);
    expect(fact.scope.compoundGrouping).toEqual({
      dimensions: ['month', 'account'],
      zeroFill: 'all_scoped_accounts',
      maximumCells: 30_000,
    });
    expect(result.evidence[0]!.rows[0]!.label).toContain('2026-01-15 to 2026-01-31');
    expect(result.evidence[0]!.scope).not.toContain('undefined');
  });

  it('labels compound stock rows as closing balances and retains their actual as-of dates', async () => {
    const raw = row({
      dimensions: [
        { kind: 'month', key: '2026-01', label: '2026-01' },
        { kind: 'account', key: '1010', label: '1010 · Bank', accountId: id(5) },
      ],
    });
    const result = await output(plan({ metric: 'account_balance', accountCodes: ['1010'] }), [raw]);
    expect(result.facts[0]!.rows[0]).toMatchObject({
      from: '2026-01-15',
      to: '2026-01-31',
      balanceAsOf: '2026-01-31',
    });
    expect(result.evidence[0]!.title).toContain('Closing');
    expect(result.evidence[0]!.scope).toMatch(/all earlier history/i);
    expect(result.evidence[0]!.rows[0]!.label).toContain('closing balance as of 2026-01-31');
  });

  it('preserves null empty-cell averages and does not present them as zero spending', async () => {
    const result = await output(plan({ aggregation: 'average_per_entry' }), [
      row({ value: null, entry_count: '0' }),
    ]);
    expect(result.facts[0]!.rows[0]).toMatchObject({ value: null, entryCount: '0' });
    expect(result.evidence[0]!.rows[0]!.value).toBe('No matching transactions');
    expect(result.evidence[0]!.scope).toMatch(/no average/i);
  });

  it('keeps empty and literal-placeholder counterparties visually and structurally distinct', async () => {
    const raw = (key: string, label: string) =>
      row({
        label: `${label} · 2026-01`,
        dimensions: [
          { kind: 'counterparty', key, label },
          { kind: 'month', key: '2026-01', label: '2026-01' },
        ],
      });
    const result = await output(plan({ groupBy: ['counterparty', 'month'] }), [
      raw('', '(No counterparty)'),
      raw('(No counterparty)', '"(No counterparty)"'),
    ]);
    expect(new Set(result.facts[0]!.rows.map((item) => item.rowId)).size).toBe(2);
    expect(result.evidence[0]!.rows[0]!.label).not.toEqual(result.evidence[0]!.rows[1]!.label);
    expect(result.facts[0]!.scope.compoundGrouping?.zeroFill).toBe('observed_qualified_tuples');
  });

  it('returns no fabricated counterparty rows when there are no qualifying observations', async () => {
    const result = await output(plan({ groupBy: ['counterparty', 'month'] }), []);
    expect(result.facts[0]!.rows).toEqual([]);
    expect(result.facts[0]!.truncated).toBe(false);
    expect(result.evidence[0]!.rows).toEqual([]);
    expect(result.answer).toContain('All 0 results');
  });

  it('marks a global truncated set and retains the zero-fill policy instead of suggesting a complete series', async () => {
    const result = await output(plan({ limit: 1 }), [row(), row({ label: 'Second account' })]);
    expect(result.facts[0]!.rows).toHaveLength(1);
    expect(result.facts[0]!.truncated).toBe(true);
    expect(result.answer).toContain('not the complete results');
    expect(result.facts[0]!.scope.compoundGrouping?.maximumCells).toBe(30_000);
  });

  it('withholds the whole response on the capacity sentinel, even if it appears after ordinary rows or the visible limit', async () => {
    const overflow = row({ value: null, dimensions: undefined, scope_overflow: true });
    for (const rows of [[overflow], [row(), overflow]]) {
      await expect(output(plan({ limit: 1 }), rows)).rejects.toMatchObject({
        code: 'INVALID_ANALYSIS_SCOPE',
      });
    }
  });

  it('does not add compound metadata or change row IDs for an existing scalar query', async () => {
    const result = await output(plan({ groupBy: 'counterparty' }), [
      row({
        row_id: 'A/B · "雪"',
        dimensions: undefined,
        scope_overflow: undefined,
        period_from: null,
        period_to: null,
      }),
    ]);
    expect(result.facts[0]!.rows[0]!.rowId).toBe(`counterparty:${encodeURIComponent('A/B · "雪"')}`);
    expect(result.facts[0]!.rows[0]).not.toHaveProperty('dimensions');
    expect(result.facts[0]!.scope).not.toHaveProperty('compoundGrouping');
    expect(result.facts[0]!.scope).not.toHaveProperty('groupingAccounts');
  });
});
