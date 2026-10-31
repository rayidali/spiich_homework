import { describe, expect, it } from 'vitest';
import {
  publicFinancialQuerySchema,
  type AnalysisFacts,
  type FinancialQuery,
} from '../server/financial-analysis';
import {
  evaluateFinancialScenario,
  financialScenarioTool,
  type FinancialScenario,
} from '../server/financial-calculation';
import { inspectFinancialDataTool, inspectionArgsSchemas } from '../server/financial-inspection';

const messages = [{ role: 'user' as const, content: 'Compare the discovered supplier across periods.' }];
function query(id: string, changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id,
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-01-01',
    to: '2026-01-31',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: 'counterparty',
    accountCodes: [],
    cooccurringAccountCodes: [],
    counterparty: { mode: 'any', value: '' },
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
    order: 'value_desc',
    limit: 50,
    ...changes,
  };
}
function fact(plan: FinancialQuery, rows: AnalysisFacts['rows']): AnalysisFacts {
  return {
    queryId: plan.id,
    metric: plan.metric,
    aggregation: plan.aggregation,
    grain: plan.groupBy,
    unit: 'USD',
    currency: 'USD',
    truncated: false,
    rows,
    scope: {
      organizationId: 'org',
      plan: structuredClone(plan),
      resolvedAccountIds: ['supplies-id'],
      cooccurringAccountIds: [],
      statusMeaning: 'booked',
      amountBasis: 'selected_base_lines',
    },
  };
}
function fixture(key = 'Acme', compound = false) {
  const discovery = query('discovery', { groupBy: compound ? ['month', 'counterparty'] : 'counterparty' });
  const dimension = [
    { kind: 'month' as const, key: '2026-01', label: 'January' },
    { kind: 'counterparty' as const, key, label: 'Misleading displayed label' },
  ];
  const sourceRowId = compound
    ? `compound:${JSON.stringify([
        ['month', '2026-01'],
        ['counterparty', key],
      ])}`
    : `counterparty:${encodeURIComponent(key)}`;
  const source = fact(discovery, [
    {
      rowId: sourceRowId,
      label: 'Label is never an identity',
      value: '240.00',
      entryCount: '2',
      from: discovery.from,
      to: discovery.to,
      ...(compound ? { dimensions: dimension } : {}),
    },
  ]);
  if (compound) {
    source.scope.groupingAccounts = [];
    source.scope.compoundGrouping = {
      dimensions: ['month', 'counterparty'],
      zeroFill: 'observed_qualified_tuples',
      maximumCells: 30000,
    };
  }
  // Discovery may be truncated while the referenced row is present. It is not
  // used as an arithmetic operand; the later detail query must be complete.
  source.truncated = true;
  const detail = query('detail', {
    groupBy: 'total',
    from: '2026-02-01',
    to: '2026-02-28',
    counterparty: { mode: 'identity', value: key },
  });
  const target = fact(detail, [
    {
      rowId: 'total:total',
      label: 'Total',
      value: '90.00',
      entryCount: '1',
      from: detail.from,
      to: detail.to,
    },
  ]);
  target.scope.counterpartyIdentity = { queryId: discovery.id, rowId: sourceRowId, key };
  const plan: FinancialScenario = {
    queries: [discovery, detail],
    assumptions: [],
    calculations: [
      {
        id: 'difference',
        operation: 'subtract',
        operands: [
          { source: 'query', id: 'detail', rowId: 'total:total', field: 'value' },
          { source: 'query', id: 'detail', rowId: 'total:total', field: 'value' },
        ],
      },
    ],
  };
  return { plan, facts: [source, target], source, target };
}
const evaluate = (test: ReturnType<typeof fixture>) =>
  evaluateFinancialScenario(test.plan, test.facts, messages);

describe('inspected counterparty identity in exact arithmetic', () => {
  it.each(['Acme', 'acme', ' Acme ', '', '(No counterparty)', 'Äcme', 'A%20B'])(
    'retains the exact raw identity %j without parsing its display label',
    (key) => {
      const test = fixture(key);
      const result = evaluate(test);
      expect(result.answer).toContain('$0.00');
      expect((result.facts[1] as AnalysisFacts).scope.counterpartyIdentity).toEqual({
        queryId: 'discovery',
        rowId: `counterparty:${encodeURIComponent(key)}`,
        key,
      });
      expect(test.target.scope.plan.counterparty.value).toBe(key);
    },
  );

  it('accepts a compound source row by its raw typed dimension', () => {
    const test = fixture('Acme', true);
    expect(evaluate(test).answer).toContain('$0.00');
  });

  it.each([
    [
      'missing proof',
      (test: ReturnType<typeof fixture>) => {
        delete test.target.scope.counterpartyIdentity;
      },
    ],
    [
      'case-folded key',
      (test: ReturnType<typeof fixture>) => {
        test.target.scope.counterpartyIdentity!.key = 'acme';
      },
    ],
    [
      'same-dollar other source',
      (test: ReturnType<typeof fixture>) => {
        test.source.rows.push({ ...test.source.rows[0], rowId: 'counterparty:acme' });
        test.target.scope.counterpartyIdentity!.rowId = 'counterparty:acme';
      },
    ],
    [
      'unknown source',
      (test: ReturnType<typeof fixture>) => {
        test.target.scope.counterpartyIdentity!.queryId = 'absent';
      },
    ],
    [
      'unknown row',
      (test: ReturnType<typeof fixture>) => {
        test.target.scope.counterpartyIdentity!.rowId = 'counterparty:Absent';
      },
    ],
    [
      'self source',
      (test: ReturnType<typeof fixture>) => {
        test.target.scope.counterpartyIdentity!.queryId = 'detail';
      },
    ],
    [
      'later source',
      (test: ReturnType<typeof fixture>) => {
        test.plan.queries.reverse();
      },
    ],
    [
      'foreign source',
      (test: ReturnType<typeof fixture>) => {
        test.source.scope.organizationId = 'other-org';
      },
    ],
    [
      'duplicate row',
      (test: ReturnType<typeof fixture>) => {
        test.source.rows.push({ ...test.source.rows[0] });
      },
    ],
    [
      'ordinary exact with proof',
      (test: ReturnType<typeof fixture>) => {
        test.plan.queries[1].counterparty.mode = 'exact';
        test.target.scope.plan.counterparty.mode = 'exact';
      },
    ],
    [
      'extra proof field',
      (test: ReturnType<typeof fixture>) => {
        Object.assign(test.target.scope.counterpartyIdentity!, { label: 'Acme' });
      },
    ],
  ] as const)('rejects %s before calculation', (_name, mutate) => {
    const test = fixture();
    mutate(test);
    expect(() => evaluate(test)).toThrow();
  });

  it('rejects a non-counterparty discovery grain even when its displayed label matches', () => {
    const test = fixture();
    test.plan.queries[0].groupBy = 'total';
    test.source.scope.plan.groupBy = 'total';
    test.source.grain = 'total';
    test.source.rows[0].rowId = 'total:total';
    test.target.scope.counterpartyIdentity!.rowId = 'total:total';
    expect(() => evaluate(test)).toThrow();
  });

  it('rejects a mutated compound key even if the proof and displayed amount are unchanged', () => {
    const test = fixture('Acme', true);
    test.source.rows[0].dimensions![1].key = 'acme';
    expect(() => evaluate(test)).toThrow();
  });

  it('still refuses a truncated detail operand', () => {
    const test = fixture();
    test.target.truncated = true;
    expect(() => evaluate(test)).toThrow(/complete query result/i);
  });
});

describe('public versus inspected query grammar', () => {
  it('does not advertise or accept identity as a model-authored query mode', () => {
    const internal = fixture().plan.queries[1];
    expect(publicFinancialQuerySchema.safeParse(internal).success).toBe(false);
    expect(inspectionArgsSchemas.inspect_financial_data.safeParse({ queries: [internal] }).success).toBe(
      false,
    );
    expect(JSON.stringify(financialScenarioTool.parameters)).not.toContain('"identity"');
    expect(JSON.stringify(inspectFinancialDataTool.parameters)).not.toContain('"identity"');
  });

  it('requires source or null in provider grammar but defaults old server input to null', () => {
    const input = inspectionArgsSchemas.inspect_financial_data.parse({ queries: [query('first')] });
    expect(input.queries[0].counterpartySource).toBeNull();
    const schema = inspectFinancialDataTool.parameters as {
      properties: { queries: { items: { required: string[] } } };
    };
    expect(schema.properties.queries.items.required).toContain('counterpartySource');
  });
});
