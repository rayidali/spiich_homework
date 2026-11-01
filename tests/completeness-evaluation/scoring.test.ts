import { describe, expect, it } from 'vitest';
import { scoreCompletenessResponse } from '../../scripts/completeness-evaluation/scoring';
import type {
  CompletenessCase,
  ExpectedClaim,
  ExpectedScope,
  ScoringContext,
} from '../../scripts/completeness-evaluation/types';
import {
  executeFinancialAnalysis,
  type AnalysisAccount,
  type FinancialQuery,
} from '../../server/financial-analysis';
import { evaluateFinancialScenario, type FinancialScenario } from '../../server/financial-calculation';
import type { Db } from '../../server/db';
import { Decimal } from '../../shared/money';

const org = '00000000-0000-4000-8000-000000000001';
const chart: AnalysisAccount[] = [
  {
    id: '00000000-0000-4000-8000-000000000002',
    code: '5030',
    name: 'Office supplies',
    type: 'EXPENSE',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    is_cash: false,
    archived: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    code: '5040',
    name: 'Rent',
    type: 'EXPENSE',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    is_cash: false,
    archived: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    code: '1010',
    name: 'Bank',
    type: 'ASSET',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    is_cash: true,
    archived: false,
  },
];
const scope = (change: Partial<ExpectedScope> = {}): ExpectedScope => ({
  from: '2026-01-01',
  to: '2026-01-31',
  asOf: null,
  status: 'POSTED',
  accountCodes: ['5030'],
  counterparty: { mode: 'any', value: '' },
  currencyMode: 'base',
  currency: null,
  cooccurringAccountCodes: [],
  descriptionSearch: '',
  minimumAmount: null,
  maximumAmount: null,
  ...change,
});
const ledger = (id = 'office', value = '240', s = scope()): ExpectedClaim => ({
  id,
  kind: 'ledger',
  metric: 'net_expense',
  value,
  unit: 'USD',
  scope: s,
});
const item = (
  required: ExpectedClaim[] = [ledger()],
  supporting: ExpectedClaim[] = [],
): CompletenessCase => ({
  id: 'synthetic',
  split: 'development',
  family: 'common',
  messages: [
    {
      role: 'user',
      content: 'Show Office supplies for January and February, their difference and relative change.',
    },
  ],
  expected: { behavior: 'ANSWER', required, supporting },
});
const query = (id = 'q', change: Partial<FinancialQuery> = {}): FinancialQuery => ({
  id,
  metric: 'net_expense',
  aggregation: 'sum',
  from: '2026-01-01',
  to: '2026-01-31',
  status: 'POSTED',
  currencyMode: 'base',
  currency: null,
  groupBy: 'total',
  accountCodes: ['5030'],
  cooccurringAccountCodes: [],
  counterparty: { mode: 'any', value: '' },
  descriptionSearch: '',
  minimumAmount: null,
  maximumAmount: null,
  order: 'label_asc',
  limit: 50,
  ...change,
});
type Raw = {
  row_id: string;
  label: string;
  value: string;
  entry_count: string;
  period_from?: string;
  period_to?: string;
};
const total = (value = '240'): Raw => ({ row_id: 'total', label: 'Total', value, entry_count: '2' });
async function answer(queries: FinancialQuery[] = [query()], rows: Raw[][] = [[total()]]) {
  let index = 0;
  const db = {
    query: async (sql: string) => {
      if (sql.startsWith('SET LOCAL')) return { rows: [] };
      if (sql.startsWith('SELECT id,code,name,type,currency')) return { rows: chart };
      if (sql.startsWith('WITH typed_input')) return { rows: rows[index++] };
      throw new Error('unexpected offline SQL');
    },
  } as unknown as Db;
  const result = await executeFinancialAnalysis(org, { queries }, db);
  return { ...result, query: { name: 'financial_analysis', args: { queries } } };
}
const context: ScoringContext = {
  organizationId: org,
  chart,
  counterparties: ['Acme', 'acme', ''],
  referenceLedgerClaim(c) {
    if (
      c.scope.currencyMode !== 'base' ||
      c.scope.descriptionSearch ||
      c.scope.minimumAmount !== null ||
      c.scope.maximumAmount !== null
    )
      return { status: 'unsupported', reason: 'TEST_ORACLE_SCOPE' };
    let value: string;
    if (c.metric === 'cash_balance') value = '500';
    else if (c.metric === 'journal_total' && c.scope.entryId === 'entry-1')
      return new Decimal(c.value).eq(40)
        ? { status: 'verified', value: '40', entry: { date: '2026-01-20', description: 'Printer paper' } }
        : { status: 'incorrect', value: '40' };
    else if (c.metric === 'net_revenue') value = c.scope.from === '2026-02-01' ? '1000' : '600';
    else if (c.metric === 'net_profit') value = c.scope.from === '2026-02-01' ? '670' : '120';
    else if (c.metric === 'net_expense') {
      const month = c.scope.from === '2026-02-01' ? 'feb' : 'jan';
      const selected = c.scope.accountCodes.length ? c.scope.accountCodes : ['5030', '5040'];
      value = selected
        .reduce(
          (n, code) => n.plus(code === '5030' ? (month === 'feb' ? '90' : '240') : '240'),
          new Decimal(0),
        )
        .toString();
      if (c.scope.counterparty.mode !== 'any')
        value =
          c.scope.counterparty.value === 'Acme' ? '140' : c.scope.counterparty.value === 'acme' ? '100' : '0';
    } else return { status: 'unsupported', reason: 'TEST_ORACLE_METRIC' };
    return new Decimal(c.value).eq(value) ? { status: 'verified', value } : { status: 'incorrect', value };
  },
};
const grade = (value: unknown, expected = item(), ctx = context) =>
  scoreCompletenessResponse(expected, { response: value }, ctx);
const comparison = () => {
  const jan = ledger('jan'),
    feb = ledger('feb', '90', scope({ from: '2026-02-01', to: '2026-02-28' }));
  const delta: ExpectedClaim = {
    id: 'delta',
    kind: 'calculation',
    value: '-150',
    unit: 'USD',
    source: 'posted',
    formula: { operation: 'subtract', operands: [{ claim: 'feb' }, { claim: 'jan' }] },
  };
  const relative: ExpectedClaim = {
    id: 'relative',
    kind: 'calculation',
    value: '-0.625',
    unit: 'ratio',
    source: 'posted',
    exact: { numerator: '-5', denominator: '8' },
    formula: { operation: 'divide', operands: [{ claim: 'delta' }, { claim: 'jan' }] },
  };
  return item([jan, feb, delta, relative]);
};
async function calculated() {
  const queries = [query('jan'), query('feb', { from: '2026-02-01', to: '2026-02-28' })];
  const base = await answer(queries, [[total('240')], [total('90')]]);
  const ref = (id: string) => ({
    source: 'query' as const,
    id,
    rowId: 'total:total',
    field: 'value' as const,
  });
  const plan: FinancialScenario = {
    queries,
    assumptions: [],
    calculations: [
      { id: 'delta', operation: 'subtract', operands: [ref('feb'), ref('jan')] },
      {
        id: 'relative',
        operation: 'divide',
        operands: [{ source: 'calculation', id: 'delta', rowId: null, field: 'value' }, ref('jan')],
      },
    ],
  };
  const result = evaluateFinancialScenario(plan, base.facts, comparison().messages);
  return {
    ...result,
    evidence: [...result.evidence, ...base.evidence],
    query: { name: 'financial_scenario', args: plan },
  };
}

describe('Independent source-linked visible completeness grading', () => {
  it('accepts the actual query executor output against external exact scope', async () =>
    expect(grade(await answer())).toMatchObject({
      passed: true,
      focusCorrect: true,
      matchedClaims: ['office'],
    }));
  it('ignores model completion status and declared requirements', async () => {
    const response = {
      ...(await answer()),
      completion: { status: 'fulfilled' },
      answerContract: { contract: { outputs: [] } },
    };
    expect(
      grade(
        response,
        item([ledger(), ledger('missing', '90', scope({ from: '2026-02-01', to: '2026-02-28' }))]),
      ),
    ).toMatchObject({ passed: false, classification: 'partial-answer', matchedClaims: ['office'] });
  });
  it('does not count a hidden correct fact as delivered', async () => {
    const value = await answer();
    value.evidence[0].rows = [];
    value.answer = 'Here are the results, with their accounts, dates and sources.';
    expect(grade(value)).toMatchObject({ passed: false, matchedClaims: [] });
  });
  it('accepts reordered/duplicated linked tables and rows without table-count assumptions', async () => {
    const value = await calculated();
    expect(grade(value, comparison()).passed).toBe(true);
    value.evidence.reverse();
    for (const table of value.evidence) table.rows.reverse();
    value.evidence.push(structuredClone(value.evidence[0]));
    expect(grade(value, comparison())).toMatchObject({
      passed: true,
      matchedClaims: ['jan', 'feb', 'delta', 'relative'],
    });
  });
  it('does not infer an omitted arithmetic result from the two visible inputs', async () => {
    const value = await answer(
      [query('jan'), query('feb', { from: '2026-02-01', to: '2026-02-28' })],
      [[total('240')], [total('90')]],
    );
    expect(grade(value, comparison())).toMatchObject({
      passed: false,
      classification: 'partial-answer',
      matchedClaims: ['jan', 'feb'],
      wrongFinancialClaims: [],
    });
  });
  it('does not pass hidden calculations even if all raw nodes exist', async () => {
    const value = await calculated();
    value.evidence = value.evidence.filter((t) => !t.rows.some((r) => r.factRef?.kind === 'calculation'));
    expect(grade(value, comparison()).passed).toBe(false);
  });
  it('rejects a displayed false amount with an otherwise correct reference', async () => {
    const value = await answer();
    value.evidence[0].rows[0].value = '$241.00';
    expect(grade(value)).toMatchObject({
      passed: false,
      classification: 'wrong-answer',
      wrongFinancialClaims: ['DISPLAY_VALUE_MISMATCH'],
    });
  });
  it('rejects a false fact and matching false display via independent fixture arithmetic', async () => {
    expect(grade(await answer([query()], [[total('241')]]))).toMatchObject({
      passed: false,
      classification: 'wrong-answer',
      wrongFinancialClaims: ['INCORRECT_LEDGER_VALUE'],
    });
  });
  it('does not accept equal dollars from the wrong account', async () => {
    const result = grade(await answer([query('q', { accountCodes: ['5040'] })]));
    expect(result.passed).toBe(false);
    expect(result.matchedClaims).toEqual([]);
  });
  it('rejects a foreign workspace and draft-masquerading-as-posted', async () => {
    const value = await answer();
    value.facts[0].scope.organizationId = 'foreign';
    expect(grade(value).hardBoundaryViolations).toEqual(['foreign_workspace']);
    const draft = await answer([query('q', { status: 'DRAFT' })]);
    draft.evidence[0].source = 'posted';
    expect(grade(draft).hardBoundaryViolations).toEqual(['status_or_assumption_masquerade']);
  });
  it('preserves case-distinct raw identity despite equal numeric mutations', async () => {
    const expected = item([
      ledger('acme', '140', scope({ counterparty: { mode: 'identity', value: 'Acme' } })),
    ]);
    const value = await answer(
      [query('q', { groupBy: 'counterparty' })],
      [
        [
          { row_id: 'Acme', label: 'Acme', value: '140', entry_count: '1' },
          { row_id: 'acme', label: 'acme', value: '100', entry_count: '1' },
        ],
      ],
    );
    expect(grade(value, expected).matchedClaims).toContain('acme');
    value.facts[0].rows[0].rowId = 'counterparty:acme';
    expect(grade(value, expected).passed).toBe(false);
  });
  it('allows a disjoint combined query to fulfill an independently specified sum', async () => {
    const a = ledger('a'),
      b = ledger('b', '240', scope({ accountCodes: ['5040'] }));
    const expected = item(
      [
        {
          id: 'both',
          kind: 'calculation',
          value: '480',
          unit: 'USD',
          source: 'posted',
          formula: { operation: 'add', operands: [{ claim: 'a' }, { claim: 'b' }] },
        },
      ],
      [a, b],
    );
    expect(
      grade(await answer([query('q', { accountCodes: ['5030', '5040'] })], [[total('480')]]), expected)
        .passed,
    ).toBe(true);
  });
  it('rejects wrong requested algebra even when the dollars coincide', async () => {
    const value = await calculated();
    const expected = comparison();
    const wrong = expected.expected.required.find((c) => c.id === 'relative');
    if (wrong?.kind === 'calculation')
      wrong.formula = { operation: 'divide', operands: [{ claim: 'delta' }, { claim: 'feb' }] };
    expect(grade(value, expected).passed).toBe(false);
  });
  it('reports unknown evidence variants as ungradable, not incorrect money', () => {
    expect(
      grade({ answer: 'Unknown format', evidence: [], query: { name: 'unknown', args: {} } }),
    ).toMatchObject({ passed: false, classification: 'ungradable', wrongFinancialClaims: [] });
  });
  it('separates execution errors and answerable safe limitations', () => {
    expect(scoreCompletenessResponse(item(), { error: { code: 'AI_TIMEOUT' } }, context).classification).toBe(
      'execution-error',
    );
    expect(
      grade({
        answer: 'More information is required.',
        evidence: [],
        limitation: { code: 'BOUND' },
        facts: [],
      }),
    ).toMatchObject({ classification: 'safe-no-answer', passed: false });
  });
});

describe('Legacy route parity and independent answer focus', () => {
  const expenseSummary = (view: 'top' | 'all' = 'top') => ({
    answer: `Your net recorded expenses from 2026-01-01 to 2026-01-31 were $480.00 USD. Posted credits and reversals are included in this total. ${view === 'all' ? 'Here are all expense posting accounts, including zero balances and archived accounts.' : 'Here are the 2 largest expense categories with posted activity.'}`,
    evidence: [
      {
        title: 'Top expenses',
        period: '2026-01-01 → 2026-01-31',
        href: '/reports',
        rows: chart.slice(0, 2).map((a) => ({
          label: a.name,
          value: '$240.00',
          href: `/accounts?account=${a.id}&from=2026-01-01&to=2026-01-31`,
        })),
      },
    ],
    query: {
      name: 'expense_summary',
      args: { from: '2026-01-01', to: '2026-01-31', view, limit: view === 'top' ? 5 : null },
    },
  });
  it('fails the original Office-only question when its amount is buried under a truthful global headline', () => {
    expect(grade(expenseSummary())).toMatchObject({
      passed: false,
      classification: 'partial-answer',
      focusCorrect: false,
      matchedClaims: ['office'],
      wrongFinancialClaims: [],
    });
  });
  it('accepts generic requested-first linked evidence without a model completion claim', async () => {
    const value = await answer();
    value.answer = 'Here are the results, with their accounts, dates and sources.';
    expect(grade(value)).toMatchObject({ passed: true, focusCorrect: true });
  });
  it('accepts explicit externally permitted overall summary focus for an all-category request', () => {
    const expected = item(
      [ledger(), ledger('rent', '240', scope({ accountCodes: ['5040'] }))],
      [ledger('total', '480', scope({ accountCodes: [] }))],
    );
    expected.expected.primaryClaimIds = ['total'];
    expected.expected.tables = [
      { id: 'all', claimIds: ['office', 'rent'], coverage: 'all', order: 'any', limit: null },
    ];
    expect(grade(expenseSummary('all'), expected).passed).toBe(true);
  });
  it('accepts a strictly bound cash_position total and account row', () => {
    const value = {
      answer:
        'Your cash and bank book balance as of 2026-01-31 is $500.00 USD. Foreign balances use the exchange rates recorded in your journal.',
      query: { name: 'cash_position', args: { asOf: '2026-01-31' } },
      evidence: [
        {
          title: 'Cash position',
          period: 'As of 2026-01-31',
          href: '/reports',
          rows: [
            {
              label: 'Bank',
              value: '$500.00',
              href: `/accounts?account=${chart[2].id}&from=0001-01-01&to=2026-01-31`,
            },
          ],
        },
      ],
    };
    const expected = item([
      {
        id: 'cash',
        kind: 'ledger',
        metric: 'cash_balance',
        value: '500',
        unit: 'USD',
        scope: scope({ accountCodes: ['1010'], from: null, to: null, asOf: '2026-01-31' }),
      },
    ]);
    expect(grade(value, expected).passed).toBe(true);
  });
  it('accepts a legacy income summary without factRefs', () => {
    const value = {
      answer: 'Recorded revenue from 2026-01-01 to 2026-01-31 totaled $600.00 USD.',
      query: { name: 'income_summary', args: { metric: 'revenue', from: '2026-01-01', to: '2026-01-31' } },
      evidence: [
        {
          title: 'Revenue',
          period: '2026-01-01 → 2026-01-31',
          href: '/reports',
          rows: [{ label: 'Revenue', value: '$600.00' }],
        },
      ],
    };
    expect(
      grade(
        value,
        item([
          {
            id: 'revenue',
            kind: 'ledger',
            metric: 'net_revenue',
            value: '600',
            unit: 'USD',
            scope: scope({ accountCodes: [] }),
          },
        ]),
      ).passed,
    ).toBe(true);
  });
  it('accepts a legacy period comparison with reordered period rows and visible difference/percentage', () => {
    const value = {
      answer:
        'Expenses was $330.00, compared with $480.00 in the prior period. The difference is -$150.00; percentage change is -31.3%.',
      query: {
        name: 'period_comparison',
        args: {
          metric: 'expenses',
          from: '2026-02-01',
          to: '2026-02-28',
          previousFrom: '2026-01-01',
          previousTo: '2026-01-31',
        },
      },
      evidence: [
        {
          title: 'Expenses comparison',
          period: '2026-02-01 → 2026-02-28',
          href: '/reports',
          rows: [
            { label: '2026-01-01 – 2026-01-31', value: '$480.00' },
            { label: '2026-02-01 – 2026-02-28', value: '$330.00' },
          ],
        },
      ],
    };
    const expected = item([
      ledger('current', '330', scope({ from: '2026-02-01', to: '2026-02-28', accountCodes: [] })),
      ledger('previous', '480', scope({ accountCodes: [] })),
      {
        id: 'difference',
        kind: 'calculation',
        value: '-150',
        unit: 'USD',
        source: 'posted',
        formula: { operation: 'subtract', operands: [{ claim: 'current' }, { claim: 'previous' }] },
      },
    ]);
    expect(grade(value, expected).passed).toBe(true);
  });
  it('accepts literal transaction search with independent entry identity and labels', () => {
    const value = {
      answer:
        'I found 1 posted entries matching “paper” in this period. The amounts below are journal totals, not necessarily revenue or cash movements.',
      query: { name: 'find_transactions', args: { search: 'paper', from: '2026-01-01', to: '2026-01-31' } },
      evidence: [
        {
          title: 'Transactions · paper',
          period: '2026-01-01 → 2026-01-31',
          href: '/transactions',
          rows: [
            { label: '2026-01-20 · Printer paper', value: '$40.00', href: '/transactions?entry=entry-1' },
          ],
        },
      ],
    };
    const expected = item([
      {
        id: 'entry',
        kind: 'ledger',
        metric: 'journal_total',
        value: '40',
        unit: 'USD',
        scope: scope({ accountCodes: [], entryId: 'entry-1', searchText: 'paper' }),
      },
    ]);
    expect(grade(value, expected).passed).toBe(true);
  });
  it('keeps a partial headline failed even when supporting rows contain all requested facts', async () => {
    const value = { ...(await answer()), limitation: { code: 'ANSWER_INCOMPLETE' } };
    value.answer = 'I could only complete part of this request. Still unresolved: “Office supplies”.';
    expect(grade(value)).toMatchObject({ passed: false, classification: 'partial-answer' });
  });
});

describe('Adversarial presentation and provenance mutations', () => {
  it('grades every monetary headline even when a later evidence table is absent', async () => {
    const value = await answer(
      [query('office'), query('all', { accountCodes: [] })],
      [[total('240')], [total('999')]],
    );
    value.evidence.pop();
    expect(grade(value)).toMatchObject({
      passed: false,
      classification: 'wrong-answer',
      wrongFinancialClaims: ['INCORRECT_LEDGER_VALUE'],
    });
  });
  it('does not pass an unsupported extra headline with no table', async () => {
    const value = await answer(
      [query('office'), query('filtered', { descriptionSearch: 'receipt' })],
      [[total('240')], [total('1')]],
    );
    value.evidence.pop();
    expect(grade(value)).toMatchObject({
      passed: false,
      classification: 'ungradable',
      wrongFinancialClaims: [],
    });
  });
  it('does not let a later requested headline repair an unrelated leading total', async () => {
    const value = await answer(
      [query('all', { accountCodes: [] }), query('office')],
      [[total('480')], [total('240')]],
    );
    expect(grade(value)).toMatchObject({
      passed: false,
      focusCorrect: false,
      matchedClaims: ['office'],
      wrongFinancialClaims: [],
    });
  });
  it('rejects a contradictory currency symbol and suffix', async () => {
    const value = await answer();
    value.evidence[0].rows[0].value = '€240.00 USD';
    expect(grade(value)).toMatchObject({ passed: false, wrongFinancialClaims: ['DISPLAY_VALUE_MISMATCH'] });
  });
  it('rejects an incorrect displayed operation despite a correct bound result', async () => {
    const value = await calculated();
    const row = value.evidence.flatMap((t) => t.rows).find((r) => r.factRef?.kind === 'calculation')!;
    row.label = row.label.replace('−', '+');
    expect(grade(value, comparison())).toMatchObject({
      passed: false,
      wrongFinancialClaims: ['DISPLAY_CALCULATION_OPERANDS'],
    });
  });
  it('does not equate broad per-entry thresholds with an account-only threshold cell', async () => {
    const value = await answer(
      [query('q', { accountCodes: ['5030', '5040'], groupBy: 'account', minimumAmount: '50' })],
      [[{ row_id: chart[0].id, label: '5030 · Office supplies', value: '240', entry_count: '1' }]],
    );
    const expected = item([ledger('office', '240', scope({ minimumAmount: '50' }))]);
    const ctx: ScoringContext = {
      ...context,
      referenceLedgerClaim: () => ({ status: 'verified', value: '240' }),
    };
    expect(grade(value, expected, ctx)).toMatchObject({ passed: false, matchedClaims: [] });
  });
  it('accepts a requested leader at the front of a complete ranking without forcing top1 layout', async () => {
    const value = await answer(
      [query('q', { groupBy: 'counterparty', order: 'value_desc' })],
      [
        [
          { row_id: 'Acme', label: 'Acme', value: '140', entry_count: '1' },
          { row_id: 'acme', label: 'acme', value: '100', entry_count: '1' },
        ],
      ],
    );
    const expected = item([
      ledger('leader', '140', scope({ counterparty: { mode: 'identity', value: 'Acme' } })),
    ]);
    expected.expected.tables = [
      { id: 'leader_identity', claimIds: ['leader'], coverage: 'leading', order: 'value_desc', limit: null },
    ];
    expect(grade(value, expected)).toMatchObject({ passed: true, matchedTables: ['leader_identity'] });
    value.evidence[0].rows.reverse();
    expect(grade(value, expected)).toMatchObject({ passed: false, matchedTables: [] });
  });
  it('checks a false extra calculation even when requested calculations are correct', async () => {
    const value = await calculated();
    const last = value.facts.at(-1)!;
    if ('kind' in last) {
      last.value = '0.7';
      last.exact = { numerator: '7', denominator: '10' };
    }
    const row = value.evidence
      .flatMap((t) => t.rows)
      .find((r) => r.factRef?.kind === 'calculation' && r.factRef.calculationId === 'relative')!;
    row.value = '0.7 ratio';
    value.answer = 'Here are the results, with their accounts, dates and sources.';
    expect(grade(value, comparison())).toMatchObject({
      passed: false,
      wrongFinancialClaims: ['INCORRECT_CALCULATION_VALUE'],
    });
  });
  it('grades unrecognized free prose separately rather than assume a correct bag of dollar values', async () => {
    const value = await answer();
    value.answer = 'Rent cost $240.00.';
    expect(grade(value)).toMatchObject({
      passed: false,
      classification: 'ungradable',
      wrongFinancialClaims: [],
    });
  });
});

describe('Explicit boundary and legacy display integrity', () => {
  it('does not accept invented euro debt behind correct off-topic args', () => {
    const expected = item([]);
    expected.expected.behavior = 'REFUSE';
    expected.expected.clarification = { reasons: ['off_topic'] };
    expect(
      grade(
        {
          answer: 'You owe €999.00.',
          evidence: [],
          facts: [],
          query: {
            name: 'request_details',
            args: { reason: 'off_topic', subject: 'analysis', accountCodes: [], limitation: 'none' },
          },
        },
        expected,
      ),
    ).toMatchObject({ passed: false, classification: 'ungradable' });
  });
  it('accepts the exact code-composed boundary and reports focus independently', () => {
    const expected = item([]);
    expected.expected.behavior = 'REFUSE';
    expected.expected.clarification = { reasons: ['off_topic'] };
    expect(
      grade(
        {
          answer:
            'I can help with your recorded business finances and clearly labeled financial scenarios. Ask about spending, revenue, balances or transactions.',
          evidence: [],
          query: {
            name: 'request_details',
            args: { reason: 'off_topic', subject: 'analysis', accountCodes: [], limitation: 'none' },
          },
        },
        expected,
      ),
    ).toMatchObject({ passed: true, focusCorrect: true, classification: 'structured-correct' });
  });
  it('retains foreign-workspace flags even when the question required a refusal', async () => {
    const value = await answer();
    value.facts[0].scope.organizationId = 'foreign';
    const expected = item([]);
    expected.expected.behavior = 'REFUSE';
    expect(grade(value, expected)).toMatchObject({
      passed: false,
      hardBoundaryViolations: ['foreign_workspace'],
    });
  });
  it.each(['$600.00 EUR', '$600.00 plus another invented financial claim'])(
    'rejects malformed legacy USD evidence %s',
    (value) => {
      const response = {
        answer: 'Recorded revenue from 2026-01-01 to 2026-01-31 totaled $600.00 USD.',
        query: { name: 'income_summary', args: { metric: 'revenue', from: '2026-01-01', to: '2026-01-31' } },
        evidence: [
          {
            title: 'Revenue',
            period: '2026-01-01 → 2026-01-31',
            href: '/reports',
            rows: [{ label: 'Revenue', value }],
          },
        ],
      };
      expect(grade(response)).toMatchObject({ passed: false, classification: 'wrong-answer' });
    },
  );
});

describe('Remaining authored report contract parity', () => {
  it('accepts an exact expense-by-account answer and refuses its period mutation', () => {
    const response = {
      answer:
        'You recorded $240.00 USD in Office supplies expenses from 2026-01-01 to 2026-01-31. Posted credits and reversals are included in this total.',
      query: {
        name: 'expense_by_account',
        args: { accountCode: '5030', from: '2026-01-01', to: '2026-01-31' },
      },
      evidence: [
        {
          title: 'Expenses · Office supplies',
          period: '2026-01-01 → 2026-01-31',
          href: '/reports',
          rows: [
            {
              label: 'Office supplies',
              value: '$240.00',
              href: `/accounts?account=${chart[0].id}&from=2026-01-01&to=2026-01-31`,
            },
          ],
        },
      ],
    };
    expect(grade(response).passed).toBe(true);
    response.evidence[0].rows[0].href = response.evidence[0].rows[0].href.replace(
      'from=2026-01-01',
      'from=2025-01-01',
    );
    expect(grade(response).passed).toBe(false);
  });
  it('accepts total-only expense_summary without requiring account rows', () => {
    const response = {
      answer:
        'Your net recorded expenses from 2026-01-01 to 2026-01-31 were $480.00 USD. Posted credits and reversals are included in this total.',
      query: {
        name: 'expense_summary',
        args: { from: '2026-01-01', to: '2026-01-31', view: 'total', limit: null },
      },
      evidence: [
        {
          title: 'Total expenses',
          period: '2026-01-01 → 2026-01-31',
          href: '/reports',
          rows: [{ label: 'Net recorded expenses (USD)', value: '$480.00' }],
        },
      ],
    };
    expect(grade(response, item([ledger('total', '480', scope({ accountCodes: [] }))])).passed).toBe(true);
  });
});
