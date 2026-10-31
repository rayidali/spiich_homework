import { describe, expect, it } from 'vitest';
import {
  compileFinancialQuery,
  type AnalysisAccount,
  type AnalysisFacts,
  type FinancialQuery,
} from '../server/financial-analysis';
import {
  evaluateFinancialScenario,
  type FinancialScenario,
  type ScenarioCalculationFact,
  type ScenarioReference,
} from '../server/financial-calculation';
import type { ModelMessages } from '../server/ai-provider';

const org = '00000000-0000-4000-8000-000000000001';
const chart: AnalysisAccount[] = [
  {
    id: 'bank',
    code: '1010',
    name: 'Bank',
    type: 'ASSET',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    archived: false,
    is_cash: true,
  },
  {
    id: 'old-bank',
    code: '1020',
    name: 'Old bank',
    type: 'ASSET',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    archived: true,
    is_cash: true,
  },
  {
    id: 'eur-bank',
    code: '1030',
    name: 'Euro bank',
    type: 'ASSET',
    currency: 'EUR',
    parent_id: null,
    is_group: false,
    archived: false,
    is_cash: true,
  },
  {
    id: 'receivables',
    code: '1100',
    name: 'Cash awaiting payment',
    type: 'ASSET',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    archived: false,
    is_cash: false,
  },
  {
    id: 'supplies',
    code: '5030',
    name: 'Supplies',
    type: 'EXPENSE',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    archived: false,
    is_cash: false,
  },
];
const messages: ModelMessages = [
  { role: 'user', content: 'Compare the recorded movements; then calculate 50% of the difference.' },
];
const ref = (id: string, rowId = 'total:total'): ScenarioReference => ({
  source: 'query',
  id,
  rowId,
  field: 'value',
});
const calc = (id: string): ScenarioReference => ({ source: 'calculation', id, rowId: null, field: 'value' });
function query(id = 'movement', changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id,
    metric: 'net_cash_movement',
    aggregation: 'sum',
    from: '2026-01-01',
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
function fact(plan: FinancialQuery, value = '-90.00'): AnalysisFacts {
  // The test's cash identity metadata comes from the actual compiler selection,
  // independently of the calculator's source validator. No database is called.
  const compiled = compileFinancialQuery(org, plan, chart);
  const accounts = compiled.selected.map(({ id, code, type, currency, is_cash, is_group, archived }) => ({
    id,
    code,
    type,
    currency,
    is_cash,
    is_group,
    archived,
  }));
  const stock = plan.metric === 'cash_balance';
  const currency = plan.currencyMode === 'native' ? plan.currency! : 'USD';
  return {
    queryId: plan.id,
    metric: plan.metric,
    aggregation: plan.aggregation,
    grain: plan.groupBy,
    unit: currency,
    currency,
    truncated: false,
    rows: [
      {
        rowId: 'total:total',
        label: 'Total',
        value,
        entryCount: '2',
        from: plan.from,
        to: plan.to,
        ...(stock ? { balanceAsOf: plan.to } : {}),
      },
    ],
    scope: {
      organizationId: org,
      plan,
      resolvedAccountIds: compiled.selected.map((a) => a.id),
      cooccurringAccountIds: compiled.cooccurring.map((a) => a.id),
      statusMeaning: 'booked',
      amountBasis: `${stock ? 'inception_to_closing_date' : 'net_cash_movement'}_${plan.currencyMode}_lines`,
      ...(stock
        ? { cashBalanceSource: { selection: 'all_cash_asset_posting_accounts' as const, accounts } }
        : { cashMovementSource: { selection: 'all_cash_asset_posting_accounts' as const, accounts } }),
    },
  };
}
function planFor(...queries: FinancialQuery[]): FinancialScenario {
  return {
    queries,
    assumptions: [],
    calculations: [{ id: 'result', operation: 'add', operands: [ref(queries[0].id), ref(queries[0].id)] }],
  };
}
const results = (answer: ReturnType<typeof evaluateFinancialScenario>) =>
  answer.facts.filter(
    (item): item is ScenarioCalculationFact => 'kind' in item && item.kind === 'scenario_calculation',
  );

describe('Cash movement arithmetic preserves flow meaning and source identity (offline)', () => {
  it('compares filtered recorded periods and carries the actual movement ancestry through later arithmetic', () => {
    const current = query('current', {
      counterparty: { mode: 'exact', value: 'Acme' },
      cooccurringAccountCodes: ['5030'],
      minimumAmount: '-500',
      descriptionSearch: 'settlement',
    });
    const previous = query('previous', {
      from: '2025-10-01',
      to: '2025-12-31',
      counterparty: current.counterparty,
    });
    const plan = planFor(current, previous);
    plan.assumptions = [{ id: 'half', unit: 'ratio', value: '0.5', sourceText: '50%' }];
    plan.calculations = [
      { id: 'difference', operation: 'subtract', operands: [ref('current'), ref('previous')] },
      {
        id: 'scaled',
        operation: 'multiply',
        operands: [calc('difference'), { source: 'assumption', id: 'half', rowId: null, field: 'value' }],
      },
    ];
    const output = evaluateFinancialScenario(plan, [fact(current), fact(previous, '-120.00')], messages);
    const [difference, scaled] = results(output);
    expect(difference).toMatchObject({
      value: '30.00',
      source: 'posted',
      hypothetical: false,
      cashSources: [],
    });
    expect(scaled).toMatchObject({ value: '15.00', source: 'scenario', hypothetical: true, cashSources: [] });
    expect(difference.cashMovementSources).toEqual([
      {
        queryId: 'current',
        rowId: 'total:total',
        from: '2026-01-01',
        to: '2026-03-31',
        accountIds: ['bank', 'old-bank', 'eur-bank'],
      },
      {
        queryId: 'previous',
        rowId: 'total:total',
        from: '2025-10-01',
        to: '2025-12-31',
        accountIds: ['bank', 'old-bank', 'eur-bank'],
      },
    ]);
    expect(scaled.cashMovementSources).toEqual(difference.cashMovementSources);
    expect(output.facts[0]).toMatchObject({ scope: { plan: current, cooccurringAccountIds: ['supplies'] } });
    expect(output.answer).toContain('not a forecast or an affordability decision');
  });

  it('keeps opening cash stock and subsequent movement in separate lineage fields', () => {
    const opening = query('opening', { metric: 'cash_balance', from: null, to: '2025-12-31' });
    const movement = query();
    const plan = planFor(opening, movement);
    plan.calculations[0].operands = [ref('opening'), ref('movement')];
    const [result] = results(
      evaluateFinancialScenario(plan, [fact(opening, '1000.00'), fact(movement)], messages),
    );
    expect(result.value).toBe('910.00');
    expect(result.cashSources).toEqual([
      {
        queryId: 'opening',
        rowId: 'total:total',
        asOf: '2025-12-31',
        accountIds: ['bank', 'old-bank', 'eur-bank'],
      },
    ]);
    expect(result.cashMovementSources).toEqual([
      {
        queryId: 'movement',
        rowId: 'total:total',
        from: '2026-01-01',
        to: '2026-03-31',
        accountIds: ['bank', 'old-bank', 'eur-bank'],
      },
    ]);
    expect(result.cashMovementSources![0]).not.toHaveProperty('asOf');
  });

  it('records only the referenced account row while preserving the all-cash selection in query evidence', () => {
    const q = query('movement', { groupBy: 'account' });
    const f = fact(q);
    f.rows = f.scope.resolvedAccountIds.map((id, index) => ({
      ...f.rows[0],
      rowId: `account:${id}`,
      label: id,
      value: String(index - 1),
    }));
    const plan = planFor(q);
    plan.calculations[0].operands = [ref(q.id, 'account:old-bank'), ref(q.id, 'account:old-bank')];
    const [result] = results(evaluateFinancialScenario(plan, [f], messages));
    expect(result.value).toBe('0.00');
    expect(result.cashMovementSources).toEqual([
      { queryId: q.id, rowId: 'account:old-bank', from: q.from, to: q.to, accountIds: ['old-bank'] },
    ]);
    expect(f.scope.resolvedAccountIds).toEqual(['bank', 'old-bank', 'eur-bank']);
  });

  it.each(['counterparty', 'entry'] as const)(
    'keeps %s filtered group scope without implying a balance',
    (groupBy) => {
      const q = query('movement', { groupBy, counterparty: { mode: 'contains', value: 'Acme' } });
      const f = fact(q);
      f.rows[0].rowId = `${groupBy}:${groupBy === 'entry' ? org : 'Acme'}`;
      const plan = planFor(q);
      plan.calculations[0].operands = [ref(q.id, f.rows[0].rowId), ref(q.id, f.rows[0].rowId)];
      const [result] = results(evaluateFinancialScenario(plan, [f], messages));
      expect(result.cashMovementSources![0]).toMatchObject({
        rowId: f.rows[0].rowId,
        from: q.from,
        to: q.to,
      });
      expect(result.cashSources).toEqual([]);
    },
  );

  it('derives a monthly rate from complete zero-filled movement periods and the matching total', () => {
    const total = query('total'),
      monthly = query('monthly', { groupBy: 'month' });
    const series = fact(monthly);
    series.rows = [
      ['2026-01', '2026-01-01', '2026-01-31', '-30.00', '1'],
      ['2026-02', '2026-02-01', '2026-02-28', '0.00', '0'],
      ['2026-03', '2026-03-01', '2026-03-31', '-60.00', '1'],
    ].map(([label, from, to, value, entryCount]) => ({
      rowId: `month:${label}`,
      label,
      from,
      to,
      value,
      entryCount,
    }));
    const plan = planFor(total, monthly);
    plan.calculations[0] = {
      id: 'average',
      operation: 'divide',
      operands: [ref(total.id), { source: 'query', id: monthly.id, rowId: null, field: 'month_count' }],
    };
    const [result] = results(evaluateFinancialScenario(plan, [fact(total), series], messages));
    expect(result).toMatchObject({ value: '-30.00', unit: 'USD_per_month', source: 'posted' });
    expect(result.cashMovementSources).toHaveLength(1);
    expect(result.provenance.queryRows).toContainEqual({ id: 'monthly', rowId: null, field: 'month_count' });
    for (const failure of ['partial', 'missing', 'truncated'] as const) {
      const broken = structuredClone(series);
      if (failure === 'partial') broken.rows[0].from = '2026-01-02';
      if (failure === 'missing') broken.rows.splice(1, 1);
      if (failure === 'truncated') broken.truncated = true;
      expect(() => evaluateFinancialScenario(plan, [fact(total), broken], messages)).toThrow();
    }
  });

  it('accepts a clipped quarter as a flow period without manufacturing a closing balance', () => {
    const q = query('movement', { groupBy: 'quarter', from: '2026-02-10', to: '2026-03-20' });
    const f = fact(q);
    f.rows[0].rowId = 'quarter:2026-Q1';
    const plan = planFor(q);
    plan.calculations[0].operands = [ref(q.id, f.rows[0].rowId), ref(q.id, f.rows[0].rowId)];
    expect(results(evaluateFinancialScenario(plan, [f], messages))[0].cashMovementSources![0]).toMatchObject({
      from: q.from,
      to: q.to,
    });
    f.rows[0].rowId = 'quarter:2026-Q2';
    expect(() => evaluateFinancialScenario(plan, [f], messages)).toThrow();
  });

  it('accepts native USD arithmetic but never casts native EUR movement into dollars', () => {
    const usd = query('usd', { currencyMode: 'native', currency: 'USD' });
    expect(
      results(evaluateFinancialScenario(planFor(usd), [fact(usd)], messages))[0].cashMovementSources![0]
        .accountIds,
    ).toEqual(['bank', 'old-bank']);
    const eur = query('eur', { currencyMode: 'native', currency: 'EUR' });
    expect(() => evaluateFinancialScenario(planFor(eur), [fact(eur)], messages)).toThrow('must be in USD');
  });

  it.each([
    [
      'missing source',
      (f: AnalysisFacts) => {
        delete f.scope.cashMovementSource;
      },
    ],
    [
      'wrong selection',
      (f: AnalysisFacts) => {
        Object.assign(f.scope.cashMovementSource!, { selection: 'some_cash_accounts' });
      },
    ],
    [
      'missing declared member',
      (f: AnalysisFacts) => {
        f.scope.cashMovementSource!.accounts.pop();
      },
    ],
    [
      'missing resolved member',
      (f: AnalysisFacts) => {
        f.scope.resolvedAccountIds.pop();
      },
    ],
    [
      'duplicate identity',
      (f: AnalysisFacts) => {
        f.scope.cashMovementSource!.accounts.push(f.scope.cashMovementSource!.accounts[0]);
        f.scope.resolvedAccountIds.push('bank');
      },
    ],
    [
      'noncash asset',
      (f: AnalysisFacts) => {
        f.scope.cashMovementSource!.accounts[0].is_cash = false;
      },
    ],
    [
      'wrong account type',
      (f: AnalysisFacts) => {
        f.scope.cashMovementSource!.accounts[0].type = 'EXPENSE';
      },
    ],
    [
      'group identity',
      (f: AnalysisFacts) => {
        f.scope.cashMovementSource!.accounts[0].is_group = true;
      },
    ],
    [
      'invalid currency',
      (f: AnalysisFacts) => {
        Object.assign(f.scope.cashMovementSource!.accounts[0], { currency: 'XYZ' });
      },
    ],
    [
      'balance carrying basis',
      (f: AnalysisFacts) => {
        f.scope.amountBasis = 'inception_to_closing_date_base_lines';
      },
    ],
    [
      'unposted source',
      (f: AnalysisFacts) => {
        f.scope.statusMeaning = 'unposted_projection';
      },
    ],
    [
      'balance date',
      (f: AnalysisFacts) => {
        f.rows[0].balanceAsOf = f.scope.plan.to;
      },
    ],
    [
      'narrowed row start',
      (f: AnalysisFacts) => {
        f.rows[0].from = '2026-02-01';
      },
    ],
    [
      'widened row end',
      (f: AnalysisFacts) => {
        f.rows[0].to = '2026-04-01';
      },
    ],
    [
      'wrong row identity',
      (f: AnalysisFacts) => {
        f.rows[0].rowId = 'total:cash';
      },
    ],
    [
      'extra stock proof',
      (f: AnalysisFacts) => {
        f.scope.cashBalanceSource = f.scope.cashMovementSource;
      },
    ],
    [
      'invented co-occurrence',
      (f: AnalysisFacts) => {
        f.scope.cooccurringAccountIds.push('supplies');
      },
    ],
  ] as const)('rejects incompatible movement evidence: %s', (_name, mutate) => {
    const q = query(),
      f = fact(q);
    mutate(f);
    expect(() => evaluateFinancialScenario(planFor(q), [f], messages)).toThrow();
  });

  it.each([
    ['draft', { status: 'DRAFT' }],
    ['missing lower bound', { from: null }],
    ['selected subset', { accountCodes: ['1010'] }],
    ['average', { aggregation: 'average_per_entry' }],
  ] as const)('rejects an internally consistent but invalid movement plan: %s', (_name, override) => {
    const q = query(),
      f = fact(q);
    Object.assign(q, override);
    f.scope.plan = q;
    f.aggregation = q.aggregation;
    expect(() => evaluateFinancialScenario(planFor(q), [f], messages)).toThrow();
  });

  it('retains the existing prohibition on generic balance operands even alongside valid movement', () => {
    const movement = query(),
      generic = query('generic', { metric: 'account_balance', from: null, accountCodes: ['1100'] });
    const plan = planFor(movement, generic);
    expect(() => evaluateFinancialScenario(plan, [], messages)).toThrow('not generic account balances');
  });
});
