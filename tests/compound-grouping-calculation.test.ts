import { describe, expect, it } from 'vitest';
import type { AnalysisFacts, FinancialQuery } from '../server/financial-analysis';
import type { GroupDimension } from '../server/financial-grouping';
import {
  evaluateFinancialScenario,
  parseFinancialScenario,
  type FinancialScenario,
  type ScenarioCalculationFact,
  type ScenarioReference,
} from '../server/financial-calculation';

const messages = [{ role: 'user' as const, content: 'Compare the recorded groups, then calculate 50%.' }];
const bank = {
  id: 'bank-id',
  code: '1010',
  type: 'ASSET' as const,
  currency: 'USD' as const,
  is_cash: true,
  is_group: false,
  archived: false,
};
const oldBank = { ...bank, id: 'old-bank-id', code: '1020', archived: true };
const supplies = { id: 'supplies-id', code: '5030' };
const printing = { id: 'printing-id', code: '5040' };
const account = (item = supplies): GroupDimension => ({
  kind: 'account',
  key: item.code,
  label: 'Account label is not identity',
  accountId: item.id,
});
const party = (key = 'Acme'): GroupDimension => ({
  kind: 'counterparty',
  key,
  label: key || '(No counterparty)',
});
const month = (key = '2026-01'): GroupDimension => ({ kind: 'month', key, label: key });
const quarter = (key = '2026-Q1'): GroupDimension => ({ kind: 'quarter', key, label: key });
// Literal contract construction is independent of the production ID helper.
const rowId = (dimensions: GroupDimension[]) =>
  `compound:${JSON.stringify(dimensions.map((d) => [d.kind, d.key]))}`;
const ref = (id: string, rowId: string): ScenarioReference => ({
  source: 'query',
  id,
  rowId,
  field: 'value',
});
const calc = (id: string): ScenarioReference => ({ source: 'calculation', id, rowId: null, field: 'value' });
function query(id = 'expenses', changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id,
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-01-01',
    to: '2026-02-28',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: ['account', 'counterparty', 'month'],
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
function row(dimensions: GroupDimension[], value: string, from = '2026-01-01', to = '2026-01-31') {
  return {
    rowId: rowId(dimensions),
    dimensions,
    label: 'Display labels are not parsed',
    value,
    entryCount: value === '0' ? '0' : '1',
    from,
    to,
  };
}
function fact(plan: FinancialQuery, rows: AnalysisFacts['rows']): AnalysisFacts {
  const cash = ['cash_balance', 'net_cash_movement'].includes(plan.metric);
  const stocks = plan.metric === 'cash_balance';
  const hasAccount = Array.isArray(plan.groupBy) && plan.groupBy.includes('account');
  const groupingAccounts = hasAccount
    ? cash
      ? [bank, oldBank].map(({ id, code }) => ({ id, code }))
      : [supplies, printing].map((item) => ({ ...item }))
    : [];
  return {
    queryId: plan.id,
    metric: plan.metric,
    aggregation: plan.aggregation,
    grain: structuredClone(plan.groupBy),
    unit: plan.metric === 'journal_count' ? 'count' : 'USD',
    currency: plan.metric === 'journal_count' ? null : 'USD',
    truncated: false,
    rows: stocks ? rows.map((r) => ({ ...r, balanceAsOf: r.to! })) : rows,
    scope: {
      organizationId: 'org',
      plan: structuredClone(plan),
      resolvedAccountIds: cash ? [bank.id, oldBank.id] : [supplies.id, printing.id],
      cooccurringAccountIds: [],
      statusMeaning: plan.status === 'POSTED' ? 'booked' : 'unposted',
      amountBasis: `${stocks ? 'inception_to_closing_date' : cash ? 'net_cash_movement' : 'selected'}_base_lines`,
      ...(Array.isArray(plan.groupBy)
        ? {
            groupingAccounts,
            compoundGrouping: {
              dimensions: [...plan.groupBy],
              zeroFill:
                hasAccount && !plan.groupBy.includes('counterparty')
                  ? ('all_scoped_accounts' as const)
                  : ('observed_qualified_tuples' as const),
              maximumCells: 30000,
            },
          }
        : {}),
      ...(cash
        ? {
            [stocks ? 'cashBalanceSource' : 'cashMovementSource']: {
              selection: 'all_cash_asset_posting_accounts',
              accounts: [bank, oldBank],
            },
          }
        : {}),
    },
  };
}
function planFor(plan: FinancialQuery, rows: AnalysisFacts['rows']): FinancialScenario {
  return {
    queries: [plan],
    assumptions: [],
    calculations: [
      {
        id: 'result',
        operation: 'add',
        operands: [ref(plan.id, rows[0].rowId), ref(plan.id, rows[1]?.rowId ?? rows[0].rowId)],
      },
    ],
  };
}
const calculated = (result: ReturnType<typeof evaluateFinancialScenario>) =>
  result.facts.filter(
    (item): item is ScenarioCalculationFact => 'kind' in item && item.kind === 'scenario_calculation',
  );
function evaluate(plan: FinancialScenario, facts: AnalysisFacts[]) {
  return calculated(evaluateFinancialScenario(plan, facts, messages));
}
function calendar(): { plan: FinancialQuery; fact: AnalysisFacts } {
  const p = query('calendar', { groupBy: 'month' });
  const f = fact(p, [
    {
      rowId: 'month:2026-01',
      label: 'Jan',
      value: '0',
      entryCount: '0',
      from: '2026-01-01',
      to: '2026-01-31',
    },
    {
      rowId: 'month:2026-02',
      label: 'Feb',
      value: '0',
      entryCount: '0',
      from: '2026-02-01',
      to: '2026-02-28',
    },
  ]);
  return { plan: p, fact: f };
}
function average(p: FinancialQuery, rows: AnalysisFacts['rows']) {
  const c = calendar();
  const plan = planFor(p, rows);
  plan.queries.push(c.plan);
  for (let i = 2; i < rows.length; i++)
    plan.calculations.push({
      id: `sum${i}`,
      operation: 'add',
      operands: [calc(plan.calculations.at(-1)!.id), ref(p.id, rows[i].rowId)],
    });
  plan.calculations.push({
    id: 'monthly',
    operation: 'divide',
    operands: [
      calc(plan.calculations.at(-1)!.id),
      { source: 'query', id: 'calendar', rowId: null, field: 'month_count' },
    ],
  });
  return { plan, facts: [fact(p, rows), c.fact] };
}

describe('Compound grouping calculator: exact row and source contracts (offline)', () => {
  it('uses ordered dimensions and actual row IDs after independently deserialized array grains', () => {
    const p = query();
    const rows = [
      row([account(), party(), month()], '10'),
      row([account(), party(), month('2026-02')], '20', '2026-02-01', '2026-02-28'),
    ];
    const f = fact(p, rows);
    const [result] = evaluate(planFor(p, rows), [f]);
    expect(f.grain).not.toBe(p.groupBy);
    expect(result).toMatchObject({ value: '30.00', unit: 'USD', source: 'posted', hypothetical: false });
    expect(result.provenance.queryRows).toEqual(
      rows.map((r) => ({ id: p.id, rowId: r.rowId, field: 'value' })),
    );
  });
  it('supports non-time compound rows without inferring amounts from labels', () => {
    const p = query('expenses', { groupBy: ['counterparty', 'account'] });
    const rows = [
      row([party('Acme | ["account","5040"]'), account()], '7', p.from!, p.to),
      row([party(''), account(printing)], '3', p.from!, p.to),
    ];
    expect(evaluate(planFor(p, rows), [fact(p, rows)])[0].value).toBe('10.00');
  });
  it('preserves blank versus literal placeholder counterparties as different exact rows', () => {
    const p = query('expenses', { groupBy: ['account', 'counterparty'] });
    const rows = [
      row([account(), party('')], '2', p.from!, p.to),
      row([account(), party('(No counterparty)')], '5', p.from!, p.to),
    ];
    expect(rows[0].rowId).not.toBe(rows[1].rowId);
    expect(evaluate(planFor(p, rows), [fact(p, rows)])[0].value).toBe('7.00');
  });
  it('keeps draft ancestry hypothetical through compound arithmetic', () => {
    const p = query('drafts', { status: 'DRAFT' });
    const rows = [row([account(), party(), month()], '9')];
    expect(evaluate(planFor(p, rows), [fact(p, rows)])[0]).toMatchObject({
      value: '18.00',
      source: 'draft',
      hypothetical: true,
    });
  });
  it('carries distinct stock as-of and movement period lineage for exact account rows', () => {
    const stock = query('opening', {
      metric: 'cash_balance',
      groupBy: ['account', 'month'],
      to: '2026-01-31',
    });
    const movement = query('movement', {
      metric: 'net_cash_movement',
      groupBy: ['month', 'account'],
      from: '2026-02-01',
    });
    const sr = row([account(bank), month()], '100');
    const mr = row([month('2026-02'), account(oldBank)], '15', '2026-02-01', '2026-02-28');
    const plan = planFor(stock, [sr]);
    plan.queries.push(movement);
    plan.calculations[0].operands = [ref(stock.id, sr.rowId), ref(movement.id, mr.rowId)];
    const [result] = evaluate(plan, [fact(stock, [sr]), fact(movement, [mr])]);
    expect(result.value).toBe('115.00');
    expect(result.cashSources).toEqual([
      { queryId: 'opening', rowId: sr.rowId, asOf: '2026-01-31', accountIds: [bank.id] },
    ]);
    expect(result.cashMovementSources).toEqual([
      {
        queryId: 'movement',
        rowId: mr.rowId,
        from: '2026-02-01',
        to: '2026-02-28',
        accountIds: [oldBank.id],
      },
    ]);
  });
  it('preserves filtered movement scope and transitive singleton lineage', () => {
    const p = query('movement', {
      metric: 'net_cash_movement',
      counterparty: { mode: 'exact', value: 'Acme' },
    });
    const r = row([account(bank), party(), month()], '-10');
    const plan = planFor(p, [r]);
    plan.assumptions = [{ id: 'half', value: '0.5', unit: 'ratio', sourceText: '50%' }];
    plan.calculations.push({
      id: 'scaled',
      operation: 'multiply',
      operands: [calc('result'), { source: 'assumption', id: 'half', rowId: null, field: 'value' }],
    });
    const results = evaluate(plan, [fact(p, [r])]);
    expect(results[1]).toMatchObject({ value: '-10.00', source: 'scenario', cashSources: [] });
    expect(results[1].cashMovementSources).toEqual(results[0].cashMovementSources);
    expect(results[1].cashMovementSources?.[0].accountIds).toEqual([bank.id]);
  });
  it('retains all cash source accounts when a counterparty/time row has no account dimension', () => {
    const p = query('movement', {
      metric: 'net_cash_movement',
      groupBy: ['counterparty', 'quarter'],
      to: '2026-03-15',
    });
    const r = row([party(), quarter()], '-9', p.from!, p.to);
    expect(evaluate(planFor(p, [r]), [fact(p, [r])])[0].cashMovementSources?.[0]).toMatchObject({
      from: p.from,
      to: p.to,
      accountIds: [bank.id, oldBank.id],
    });
  });
  it('allows compound journal counts without an account dimension', () => {
    const p = query('count', { metric: 'journal_count', groupBy: ['counterparty', 'month'] });
    const rows = [
      row([party(), month()], '2'),
      row([party(), month('2026-02')], '3', '2026-02-01', '2026-02-28'),
    ];
    expect(evaluate(planFor(p, rows), [fact(p, rows)])[0]).toMatchObject({ value: '5', unit: 'count' });
  });

  it.each([
    [
      'dimension order',
      (f: AnalysisFacts) => {
        f.rows[0].dimensions!.reverse();
      },
    ],
    [
      'dimension kind',
      (f: AnalysisFacts) => {
        f.rows[0].dimensions![1].kind = 'quarter';
      },
    ],
    [
      'missing dimensions',
      (f: AnalysisFacts) => {
        delete f.rows[0].dimensions;
      },
    ],
    [
      'extra dimension',
      (f: AnalysisFacts) => {
        f.rows[0].dimensions!.push(party('Extra'));
      },
    ],
    [
      'missing account ID',
      (f: AnalysisFacts) => {
        delete f.rows[0].dimensions![0].accountId;
      },
    ],
    [
      'wrong account ID with same dollars',
      (f: AnalysisFacts) => {
        f.rows[0].dimensions![0].accountId = printing.id;
      },
    ],
    [
      'wrong account code',
      (f: AnalysisFacts) => {
        f.rows[0].dimensions![0].key = printing.code;
      },
    ],
    [
      'account ID on vendor',
      (f: AnalysisFacts) => {
        f.rows[0].dimensions![1].accountId = supplies.id;
      },
    ],
    [
      'ID inconsistent with dimensions',
      (f: AnalysisFacts) => {
        f.rows[0].rowId += 'x';
      },
    ],
    [
      'wrong month bounds',
      (f: AnalysisFacts) => {
        f.rows[0].to = '2026-02-28';
      },
    ],
    [
      'forged stock date on flow',
      (f: AnalysisFacts) => {
        f.rows[0].balanceAsOf = f.rows[0].to!;
      },
    ],
    [
      'missing grouping scope',
      (f: AnalysisFacts) => {
        delete f.scope.compoundGrouping;
      },
    ],
    [
      'different grouping scope order',
      (f: AnalysisFacts) => {
        f.scope.compoundGrouping!.dimensions.reverse();
      },
    ],
    [
      'missing account scope',
      (f: AnalysisFacts) => {
        delete f.scope.groupingAccounts;
      },
    ],
    [
      'duplicate source code',
      (f: AnalysisFacts) => {
        f.scope.groupingAccounts![1].code = supplies.code;
      },
    ],
    [
      'duplicate source ID',
      (f: AnalysisFacts) => {
        f.scope.groupingAccounts![1].id = supplies.id;
      },
    ],
    [
      'duplicate rows',
      (f: AnalysisFacts) => {
        f.rows.push(structuredClone(f.rows[0]));
      },
    ],
    [
      'grain order',
      (f: AnalysisFacts) => {
        (f.grain as string[]).reverse();
      },
    ],
    [
      'truncation',
      (f: AnalysisFacts) => {
        f.truncated = true;
      },
    ],
  ])('rejects incompatible evidence: %s', (_label, mutate) => {
    const p = query();
    const rows = [row([account(), party(), month()], '10')];
    const f = fact(p, rows);
    const plan = planFor(p, rows);
    mutate(f);
    expect(() => evaluate(plan, [f])).toThrow();
  });
  it('rejects an account/code pair substituted together outside the verified cash source', () => {
    const p = query('movement', { metric: 'net_cash_movement' });
    const r = row([account(supplies), party(), month()], '100');
    const f = fact(p, [r]);
    f.scope.groupingAccounts = [supplies];
    expect(() => evaluate(planFor(p, [r]), [f])).toThrow(/cash row/);
  });
  it('rejects stock dimensions whose closing date is not their actual bucket end', () => {
    const p = query('stock', { metric: 'cash_balance', groupBy: ['month', 'account'] });
    const r = row([month(), account(bank)], '100');
    const f = fact(p, [r]);
    f.rows[0].balanceAsOf = '2026-02-28';
    expect(() => evaluate(planFor(p, [r]), [f])).toThrow();
  });

  it('averages complete separate account/vendor series without counting their repeated months twice', () => {
    const p = query();
    const rows = [
      row([account(), party(), month()], '10'),
      row([account(), party(), month('2026-02')], '20', '2026-02-01', '2026-02-28'),
      row([account(printing), party('Beta'), month()], '30'),
      row([account(printing), party('Beta'), month('2026-02')], '40', '2026-02-01', '2026-02-28'),
    ];
    const input = average(p, rows);
    expect(evaluate(input.plan, input.facts).at(-1)).toMatchObject({ value: '50.00', unit: 'USD_per_month' });
  });
  it('does not combine different partial vendor series into a supposedly complete average', () => {
    const p = query();
    const input = average(p, [
      row([account(), party(), month()], '10'),
      row([account(), party('Beta'), month('2026-02')], '20', '2026-02-01', '2026-02-28'),
    ]);
    expect(() => evaluate(input.plan, input.facts)).toThrow(/every selected/);
  });
  it('does not accept a compound row count as the month-count denominator', () => {
    const p = query();
    const rows = [row([account(), party(), month()], '10')];
    const plan = planFor(p, rows);
    plan.calculations[0] = {
      id: 'average',
      operation: 'divide',
      operands: [ref(p.id, rows[0].rowId), { source: 'query', id: p.id, rowId: null, field: 'month_count' }],
    };
    expect(() => evaluate(plan, [fact(p, rows)])).toThrow(/calendar-month count/);
  });
  it('allows full-period compound totals divided by a separate proven monthly calendar', () => {
    const p = query('expenses', { groupBy: ['account', 'counterparty'] });
    const input = average(p, [
      row([account(), party()], '30', p.from!, p.to),
      row([account(printing), party()], '70', p.from!, p.to),
    ]);
    expect(evaluate(input.plan, input.facts).at(-1)).toMatchObject({ value: '50.00', unit: 'USD_per_month' });
  });
  it('retains generic balance and non-USD monetary restrictions', () => {
    const p = query('stock', {
      metric: 'account_balance',
      groupBy: ['account', 'month'],
      accountCodes: ['1010'],
    });
    const r = row([account(bank), month()], '100');
    expect(() => evaluate(planFor(p, [r]), [fact(p, [r])])).toThrow(/generic account balances/);
    const eur = query('eur', { currencyMode: 'native', currency: 'EUR' });
    const rows = [row([account(), party(), month()], '10')];
    expect(() => evaluate(planFor(eur, rows), [fact(eur, rows)])).toThrow(/must be in USD/);
  });
  it('accepts escaped row reference strings up to the new bound in both aliases', () => {
    const p = query('stock', { metric: 'cash_balance', groupBy: ['account', 'month'] });
    const plan = planFor(p, [{ ...row([account(bank), month()], '1'), rowId: 'x'.repeat(700) }]);
    expect(parseFinancialScenario(plan).calculations[0].operands[0].rowId).toHaveLength(700);
    const aliased = structuredClone(plan) as unknown as { calculations: { operands: { field: string }[] }[] };
    aliased.calculations[0].operands[0].field = 'balance';
    expect(parseFinancialScenario(aliased).calculations[0].operands[0].field).toBe('value');
    plan.calculations[0].operands[0].rowId = 'x'.repeat(1025);
    expect(() => parseFinancialScenario(plan)).toThrow();
  });
});
