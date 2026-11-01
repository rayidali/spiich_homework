import { describe, expect, it } from 'vitest';
import {
  aggregatePairedScores,
  equivalentScope,
  scoreAdaptiveResponse,
  type AdaptiveEvaluationCase,
  type ExpectedClaim,
  type ExpectedScope,
  type ScoringContext,
} from '../../scripts/adaptive-evaluation/scoring';
import type { AnalysisFacts, FinancialQuery } from '../../server/financial-analysis';
import { evaluateFinancialScenario, type ScenarioCalculationFact } from '../../server/financial-calculation';
import { loadCases, loadLedger, counterparties } from '../../scripts/adaptive-evaluation/fixtures';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context: ScoringContext = {
  organizationId: id(1),
  counterparties: ['Acme', 'acme', 'Beta', ''],
  chart: [
    {
      id: id(2),
      code: '5000',
      name: 'Expenses',
      type: 'EXPENSE',
      currency: 'USD',
      parent_id: null,
      is_group: true,
      is_cash: false,
      archived: false,
    },
    {
      id: id(3),
      code: '5030',
      name: 'Supplies',
      type: 'EXPENSE',
      currency: 'USD',
      parent_id: id(2),
      is_group: false,
      is_cash: false,
      archived: false,
    },
    {
      id: id(4),
      code: '5040',
      name: 'Rent',
      type: 'EXPENSE',
      currency: 'USD',
      parent_id: id(2),
      is_group: false,
      is_cash: false,
      archived: true,
    },
  ],
};
const scope = (change: Partial<ExpectedScope> = {}): ExpectedScope => ({
  from: '2026-10-01',
  to: '2026-10-31',
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
const claim = (id = 'supplies', value = '100.00', change: Partial<ExpectedScope> = {}): ExpectedClaim => ({
  id,
  kind: 'ledger',
  metric: 'net_expense',
  value,
  unit: 'USD',
  scope: scope(change),
});
const testCase = (
  required: ExpectedClaim[] = [claim()],
  supporting: ExpectedClaim[] = [],
): AdaptiveEvaluationCase => ({
  id: 'S01',
  split: 'holdout',
  family: 'common',
  messages: [{ role: 'user', content: 'October supplies expenses?' }],
  expected: { behavior: 'ANSWER', required, supporting },
});
function group(queryId = 'q', value = '100.00', change: Partial<FinancialQuery> = {}): AnalysisFacts {
  const plan: FinancialQuery = {
    id: queryId,
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-10-01',
    to: '2026-10-31',
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
  };
  return {
    queryId,
    metric: plan.metric,
    aggregation: plan.aggregation,
    grain: plan.groupBy,
    unit: 'USD',
    currency: 'USD',
    truncated: false,
    rows: [{ rowId: 'total:total', label: 'Total', value, entryCount: '1', from: plan.from, to: plan.to }],
    scope: {
      organizationId: context.organizationId,
      plan,
      resolvedAccountIds: plan.accountCodes.flatMap((code) =>
        code === '5000' ? [id(3), id(4)] : context.chart.filter((a) => a.code === code).map((a) => a.id),
      ),
      cooccurringAccountIds: [],
      amountBasis: 'selected_metric_base_lines',
      statusMeaning: 'booked',
    },
  };
}
function response(groups: AnalysisFacts[], calculations: ScenarioCalculationFact[] = []) {
  return {
    answer: 'Recorded results.',
    query: {
      name: calculations.length ? 'financial_scenario' : 'financial_analysis',
      args: { queries: groups.map((g) => g.scope.plan) },
    },
    evidence: calculations.length
      ? [...new Set(calculations.map((c) => c.source))].map((source) => ({
          title: 'Calculations from posted books',
          source,
          rows: calculations
            .filter((c) => c.source === source)
            .map((c) => ({ label: 'Calculation', value: `$${c.value} USD` })),
        }))
      : groups.map((g) => ({
          title: g.queryId,
          rows: g.rows.map((r) => ({ label: r.label, value: `$${r.value}` })),
        })),
    facts: [...groups, ...calculations],
  };
}
const score = (c: AdaptiveEvaluationCase, result: unknown) =>
  scoreAdaptiveResponse(c, { response: result }, context);
function difference(left: string, right: string, amount = '65.00'): ScenarioCalculationFact {
  const queryRows = [
    { id: left, rowId: 'total:total', field: 'value' as const },
    { id: right, rowId: 'total:total', field: 'value' as const },
  ];
  return {
    kind: 'scenario_calculation',
    id: 'difference',
    source: 'posted',
    hypothetical: false,
    operation: 'subtract',
    operands: queryRows.map((r) => ({ source: 'query', ...r })),
    value: amount,
    unit: 'USD',
    exact: { numerator: String(Number(amount)), denominator: '1' },
    assumptions: [],
    provenance: { assumptionIds: [], queryRows: left === right ? [queryRows[0]] : queryRows },
    cashSources: [],
    cashMovementSources: [],
  };
}
const calcCase = (right = '35.00') =>
  testCase(
    [
      {
        id: 'answer',
        kind: 'calculation',
        value: String(100 - Number(right)),
        unit: 'USD',
        source: 'posted',
        formula: { operation: 'subtract', operands: [{ claim: 'supplies' }, { claim: 'rent' }] },
      },
    ],
    [claim(), claim('rent', right, { accountCodes: ['5040'] })],
  );

function fixtureContext(): ScoringContext {
  const ledger = loadLedger();
  const accountId = (code: string) => id(100 + ledger.accounts.findIndex((a) => a.code === code));
  return {
    organizationId: context.organizationId,
    counterparties: counterparties(ledger),
    chart: ledger.accounts.map((a) => ({
      id: accountId(a.code),
      code: a.code,
      name: a.name,
      type: a.type,
      currency: a.currency,
      parent_id: a.parentCode === null ? null : accountId(a.parentCode),
      is_group: a.isGroup,
      is_cash: a.isCash,
      archived: a.archived,
    })),
  };
}
function fixtureCash(ctx: ScoringContext, value: string, native = false): AnalysisFacts {
  const fact = group('cash', value, {
    metric: 'cash_balance',
    from: null,
    to: '2026-06-30',
    accountCodes: [],
    currencyMode: native ? 'native' : 'base',
    currency: native ? 'EUR' : null,
  });
  const accounts = ctx.chart.filter(
    (a) => a.type === 'ASSET' && a.is_cash && !a.is_group && (!native || a.currency === 'EUR'),
  );
  fact.unit = native ? 'EUR' : 'USD';
  fact.currency = fact.unit;
  fact.rows[0].balanceAsOf = '2026-06-30';
  fact.scope.organizationId = ctx.organizationId;
  fact.scope.amountBasis = `inception_to_closing_date_${native ? 'native' : 'base'}_lines`;
  fact.scope.resolvedAccountIds = accounts.map((a) => a.id);
  fact.scope.cashBalanceSource = {
    selection: 'all_cash_asset_posting_accounts',
    accounts: accounts.map(({ id, code, type, currency, is_cash, is_group, archived }) => ({
      id,
      code,
      type,
      currency,
      is_cash,
      is_group,
      archived,
    })),
  };
  return fact;
}

describe('Adaptive paired evaluation independent scoring', () => {
  it('accepts exact structured amount and scope', () => {
    expect(score(testCase(), response([group()]))).toMatchObject({
      passed: true,
      classification: 'structured-correct',
      matchedClaims: ['supplies'],
    });
  });

  it.each([
    { accountCodes: ['5040'] },
    { from: '2026-09-01' },
    { counterparty: { mode: 'exact' as const, value: 'Acme' } },
    { descriptionSearch: 'only one vendor' },
    { minimumAmount: '50.00' },
  ])('rejects an equal-dollar result with changed scope %j', (change) => {
    const actual = group('q', '100.00', change);
    expect(score(testCase(), response([actual]))).toMatchObject({
      passed: false,
      classification: 'wrong-answer',
    });
  });

  it('accepts a complete group versus equivalent explicit posting descendants, including archived ones', () => {
    const c = testCase([claim('all', '100.00', { accountCodes: ['5030', '5040'] })]);
    expect(score(c, response([group('q', '100.00', { accountCodes: ['5000'] })])).passed).toBe(true);
    expect(
      equivalentScope('net_expense', scope({ accountCodes: [] }), scope({ accountCodes: ['5000'] }), context),
    ).toBe(true);
  });

  it('keeps case-distinct raw identities separate even when both have the same amount', () => {
    const c = testCase([claim('upper', '100.00', { counterparty: { mode: 'identity', value: 'Acme' } })]);
    const actual = group('q', '100.00', { groupBy: 'counterparty' });
    actual.rows[0].rowId = 'counterparty:acme';
    actual.rows[0].label = 'Acme';
    expect(score(c, response([actual])).passed).toBe(false);
    actual.rows[0].rowId = 'counterparty:Acme';
    expect(score(c, response([actual])).passed).toBe(true);
    expect(
      equivalentScope(
        'net_expense',
        scope({ counterparty: { mode: 'identity', value: 'Acme' } }),
        scope({ counterparty: { mode: 'exact', value: 'Acme' } }),
        context,
      ),
    ).toBe(false);
  });

  it('does not turn an unexpected extra financial fact into a pass', () => {
    const r = response([group(), group('extra', '999.00')]);
    expect(score(testCase(), r)).toMatchObject({ passed: false, extraClaims: 1 });
  });

  it('requires all requested answers even when the supplied partial answer is correct', () => {
    const c = testCase([claim(), claim('rent', '35.00', { accountCodes: ['5040'] })]);
    expect(score(c, response([group()]))).toMatchObject({
      passed: false,
      classification: 'partial-answer',
      reasons: ['MISSING_REQUIRED_CLAIMS'],
    });
  });

  it('binds valid shorter assumption quotes to the same original-user quantity occurrence', () => {
    const content = 'Salary $1,200 per month for three months. Other cost $1,200 per month.';
    const c = testCase([
      {
        id: 'cost',
        kind: 'calculation',
        value: '3600.00',
        unit: 'USD',
        source: 'scenario',
        formula: {
          operation: 'multiply',
          operands: [
            { assumption: { value: '1200', unit: 'USD_per_month', sourceText: 'Salary $1,200 per month' } },
            { assumption: { value: '3', unit: 'months', sourceText: 'three months' } },
          ],
        },
      },
    ]);
    c.messages = [{ role: 'user', content }];
    const makeAssumption = (
      id: string,
      sourceText: string,
      unit: 'USD_per_month' | 'months',
      value: string,
      last = false,
    ) => {
      const sourceStart = last ? content.lastIndexOf(sourceText) : content.indexOf(sourceText);
      return {
        id,
        sourceText,
        unit,
        value,
        userMessageIndex: 0,
        sourceStart,
        sourceEnd: sourceStart + sourceText.length,
      };
    };
    const calculation: ScenarioCalculationFact = {
      kind: 'scenario_calculation',
      id: 'cost',
      source: 'scenario',
      hypothetical: true,
      operation: 'multiply',
      operands: [
        { source: 'assumption', id: 'salary', rowId: null, field: 'value' },
        { source: 'assumption', id: 'months', rowId: null, field: 'value' },
      ],
      value: '3600.00',
      unit: 'USD',
      exact: { numerator: '3600', denominator: '1' },
      assumptions: [
        makeAssumption('salary', '$1,200', 'USD_per_month', '1200'),
        makeAssumption('months', 'three', 'months', '3'),
      ],
      provenance: { assumptionIds: ['salary', 'months'], queryRows: [] },
      cashSources: [],
      cashMovementSources: [],
    };
    expect(score(c, response([], [calculation])).passed).toBe(true);
    calculation.assumptions[0] = makeAssumption('salary', '$1,200', 'USD_per_month', '1200', true);
    expect(score(c, response([], [calculation]))).toMatchObject({
      passed: false,
      reasons: ['UNEXPECTED_ASSUMPTION_OCCURRENCE'],
    });
    calculation.assumptions[0] = makeAssumption('salary', '$1,200', 'USD_per_month', '1200');
    c.messages[0].role = 'assistant';
    expect(score(c, response([], [calculation])).passed).toBe(false);
  });

  it.each([
    { salary: '$1,200 per month', duration: 'three months', setup: '$450', reserve: '$10,000' },
    {
      salary: 'costs $1,200 per month',
      duration: 'for three months',
      setup: '$450 setup cost',
      reserve: '$10,000 cash reserve',
    },
    { salary: '$1,200 per month', duration: 'three months', setup: 'one-time $450', reserve: '$10,000' },
  ])(
    'grades the actual H11 formula with valid original-user quotes through the real calculator: %j',
    (quotes) => {
      const c = loadCases('holdout').find((c) => c.id === 'H11')!;
      const ctx = fixtureContext();
      const cash = fixtureCash(ctx, '13535.50');
      const reference = (source: 'query' | 'assumption' | 'calculation', id: string) => ({
        source,
        id,
        rowId: source === 'query' ? 'total:total' : null,
        field: 'value',
      });
      const args = {
        queries: [cash.scope.plan],
        assumptions: [
          { id: 'salary', value: '1200', unit: 'USD_per_month', sourceText: quotes.salary },
          { id: 'duration', value: '3', unit: 'months', sourceText: quotes.duration },
          { id: 'setup', value: '450', unit: 'USD', sourceText: quotes.setup },
          { id: 'reserve', value: '10000', unit: 'USD', sourceText: quotes.reserve },
        ],
        calculations: [
          {
            id: 'wages',
            operation: 'multiply',
            operands: [reference('assumption', 'salary'), reference('assumption', 'duration')],
          },
          {
            id: 'cost',
            operation: 'add',
            operands: [reference('calculation', 'wages'), reference('assumption', 'setup')],
          },
          {
            id: 'ending',
            operation: 'subtract',
            operands: [reference('query', 'cash'), reference('calculation', 'cost')],
          },
          {
            id: 'above',
            operation: 'subtract',
            operands: [reference('calculation', 'ending'), reference('assumption', 'reserve')],
          },
        ],
      };
      const actual = evaluateFinancialScenario(args, [cash], c.messages);
      expect(
        scoreAdaptiveResponse(
          c,
          { response: { ...actual, query: { name: 'financial_scenario', args } } },
          ctx,
        ),
      ).toMatchObject({
        passed: true,
        classification: 'structured-correct',
        matchedClaims: ['above_reserve', 'ending_cash'],
      });
      // The fixture correction does not license removing monthly/time units.
      const invalidUnits = structuredClone(args);
      invalidUnits.assumptions[0].unit = 'USD';
      invalidUnits.assumptions[1].unit = 'count';
      expect(() => evaluateFinancialScenario(invalidUnits, [cash], c.messages)).toThrow();
    },
  );

  it('accepts actual H04 cash/account balance equivalence only for the identical native cash account set', () => {
    const c = loadCases('holdout').find((c) => c.id === 'H04')!;
    const ctx = fixtureContext();
    const cash = fixtureCash(ctx, '306.00', true);
    const r = response([cash]);
    r.evidence[0].rows[0].value = '€306.00 EUR';
    expect(scoreAdaptiveResponse(c, { response: r }, ctx)).toMatchObject({
      passed: true,
      classification: 'structured-correct',
    });
    const generic = structuredClone(cash);
    generic.metric = generic.scope.plan.metric = 'account_balance';
    generic.scope.plan.accountCodes = ['1020'];
    delete generic.scope.cashBalanceSource;
    const direct = response([generic]);
    direct.evidence[0].rows[0].value = '€306.00 EUR';
    expect(scoreAdaptiveResponse(c, { response: direct }, ctx).passed).toBe(true);
    // A zero-valued noncash EUR asset would leave the number unchanged, but it
    // changes what was measured. It must not be filtered away by cash equivalence.
    const noncash = {
      ...ctx.chart.find((a) => a.code === '1020')!,
      id: id(999),
      code: '1210',
      name: 'EUR equipment',
      is_cash: false,
    };
    ctx.chart.push(noncash);
    generic.scope.plan.accountCodes.push(noncash.code);
    generic.scope.resolvedAccountIds.push(noncash.id);
    const wrong = response([generic]);
    wrong.evidence[0].rows[0].value = '€306.00 EUR';
    expect(scoreAdaptiveResponse(c, { response: wrong }, ctx)).toMatchObject({
      passed: false,
      classification: 'wrong-answer',
    });
  });

  it('allows catalogued unused discovery results, including a truncated discovery that is not an operand', () => {
    const c = testCase([claim()], [claim('rent', '35.00', { accountCodes: ['5040'] })]);
    const discovery = group('discovery', '35.00', { accountCodes: ['5040'] });
    discovery.truncated = true;
    expect(score(c, response([discovery, group()])).passed).toBe(true);
  });

  it('rejects a displayed amount that is absent from the validated evidence', () => {
    const r = response([group()]);
    r.answer = 'The result is $999.00.';
    expect(score(testCase(), r)).toMatchObject({ passed: false, reasons: ['UNSUPPORTED_DISPLAYED_AMOUNT'] });
  });

  it('binds display rows to their source instead of accepting a bag of otherwise correct values', () => {
    const c = testCase([claim(), claim('rent', '35.00', { accountCodes: ['5040'] })]);
    const g = group('q', '100.00', { groupBy: 'account', accountCodes: [] });
    g.rows = [
      {
        rowId: `account:${id(3)}`,
        label: 'Supplies',
        value: '100.00',
        entryCount: '1',
        from: g.scope.plan.from,
        to: g.scope.plan.to,
      },
      {
        rowId: `account:${id(4)}`,
        label: 'Rent',
        value: '35.00',
        entryCount: '1',
        from: g.scope.plan.from,
        to: g.scope.plan.to,
      },
    ];
    const r = response([g]);
    expect(score(c, r).passed).toBe(true);
    [r.evidence[0].rows[0].value, r.evidence[0].rows[1].value] = [
      r.evidence[0].rows[1].value,
      r.evidence[0].rows[0].value,
    ];
    expect(score(c, r)).toMatchObject({ passed: false, reasons: ['DISPLAY_VALUE_MISMATCH'] });
  });

  it('rejects a row date that claims the oracle period while the actual plan queried a different period', () => {
    const g = group('q', '100.00', { from: '2026-09-01', to: '2026-09-30' });
    g.rows[0].from = '2026-10-01';
    g.rows[0].to = '2026-10-31';
    expect(score(testCase(), response([g]))).toMatchObject({
      passed: false,
      reasons: ['ROW_PERIOD_MISMATCH'],
    });
  });

  it('validates clipped monthly row bounds instead of trusting a period-looking row label', () => {
    const c = testCase([claim('partial', '100.00', { from: '2026-10-10', to: '2026-10-20' })]);
    const g = group('q', '100.00', { groupBy: 'month', from: '2026-10-10', to: '2026-10-20' });
    g.rows[0].rowId = 'month:2026-10';
    g.rows[0].label = '2026-10';
    const r = response([g]);
    r.evidence[0].rows[0].label += ' · 2026-10-10 to 2026-10-20';
    expect(score(c, r).passed).toBe(true);
    g.rows[0].rowId = 'month:2026-09';
    expect(score(c, response([g])).passed).toBe(false);
  });

  it('accepts the narrow comparison delta through source-bound subtraction and validates its percentage', () => {
    const c = testCase(
      [
        {
          id: 'change',
          kind: 'calculation',
          value: '65.00',
          unit: 'USD',
          source: 'posted',
          formula: { operation: 'subtract', operands: [{ claim: 'current' }, { claim: 'prior' }] },
        },
      ],
      [claim('current'), claim('prior', '35.00', { from: '2026-09-01', to: '2026-09-30' })],
    );
    const r = {
      query: {
        name: 'period_comparison',
        args: {
          metric: 'expenses',
          from: '2026-10-01',
          to: '2026-10-31',
          previousFrom: '2026-09-01',
          previousTo: '2026-09-30',
        },
      },
      answer:
        'Expenses were $100.00, compared with $35.00. The difference is $65.00; percentage change is 185.7%.',
      evidence: [
        {
          rows: [
            { label: '2026-10-01 – 2026-10-31', value: '$100.00' },
            { label: '2026-09-01 – 2026-09-30', value: '$35.00' },
          ],
        },
      ],
    };
    for (const expected of c.expected.supporting)
      if (expected.kind === 'ledger') expected.scope.accountCodes = [];
    expect(score(c, r).passed).toBe(true);
    r.answer = r.answer.replace('185.7%', '12.3%');
    expect(score(c, r)).toMatchObject({ passed: false, reasons: ['NARROW_COMPARISON_PERCENTAGE'] });
  });

  it('checks native display currency as well as the numeric value', () => {
    const nativeContext = structuredClone(context);
    nativeContext.chart[1].currency = 'EUR';
    const c = testCase([
      { ...claim(), unit: 'EUR', scope: scope({ currencyMode: 'native', currency: 'EUR' }) } as ExpectedClaim,
    ]);
    const g = group('q', '100.00', { currencyMode: 'native', currency: 'EUR' });
    g.unit = 'EUR';
    g.currency = 'EUR';
    const r = response([g]);
    r.evidence[0].rows[0].value = '€100.00 EUR';
    expect(scoreAdaptiveResponse(c, { response: r }, nativeContext).passed).toBe(true);
    r.evidence[0].rows[0].value = '$100.00 USD';
    expect(scoreAdaptiveResponse(c, { response: r }, nativeContext)).toMatchObject({
      passed: false,
      reasons: ['DISPLAY_VALUE_MISMATCH'],
    });
  });

  it('checks ratio displays that contain no dollar sign', () => {
    const c = calcCase(),
      expected = c.expected.required[0];
    if (expected.kind !== 'calculation') throw Error('test fixture');
    expected.value = '2.857143';
    expected.unit = 'ratio';
    expected.formula = { operation: 'divide', operands: [{ claim: 'supplies' }, { claim: 'rent' }] };
    const calc = difference('left', 'right');
    calc.operation = 'divide';
    calc.unit = 'ratio';
    calc.value = '2.857143';
    calc.exact = { numerator: '20', denominator: '7' };
    const r = response([group('left'), group('right', '35.00', { accountCodes: ['5040'] })], [calc]);
    r.evidence[0].rows[0].value = '2.857143 ratio';
    expect(score(c, r).passed).toBe(true);
    r.evidence[0].rows[0].value = '2.000000 ratio';
    expect(score(c, r)).toMatchObject({ passed: false, reasons: ['DISPLAY_VALUE_MISMATCH'] });
  });

  it('requires the cash-designated account proof even if a noncash asset has an equal balance', () => {
    const ctx = structuredClone(context);
    const bank = {
      ...ctx.chart[1],
      id: id(5),
      code: '1010',
      name: 'Bank',
      type: 'ASSET' as const,
      parent_id: null,
      is_cash: true,
    };
    const asset = { ...bank, id: id(6), code: '1500', name: 'Equipment', is_cash: false };
    ctx.chart.push(bank, asset);
    const c = testCase([
      {
        id: 'cash',
        kind: 'ledger',
        metric: 'cash_balance',
        value: '100.00',
        unit: 'USD',
        scope: scope({ from: null, to: null, asOf: '2026-10-31', accountCodes: ['1010'] }),
      },
    ]);
    const g = group('q', '100.00', { metric: 'cash_balance', accountCodes: [], from: null });
    g.rows[0].balanceAsOf = '2026-10-31';
    g.scope.resolvedAccountIds = [bank.id];
    g.scope.amountBasis = 'inception_to_closing_date_base_lines';
    const proofAccount = ({ id, code, type, currency, is_cash, is_group, archived }: typeof bank) => ({
      id,
      code,
      type,
      currency,
      is_cash,
      is_group,
      archived,
    });
    g.scope.cashBalanceSource = {
      selection: 'all_cash_asset_posting_accounts',
      accounts: [proofAccount(bank)],
    };
    expect(scoreAdaptiveResponse(c, { response: response([g]) }, ctx).passed).toBe(true);
    g.scope.cashBalanceSource.accounts = [proofAccount(asset)];
    g.scope.resolvedAccountIds = [asset.id];
    expect(scoreAdaptiveResponse(c, { response: response([g]) }, ctx)).toMatchObject({
      passed: false,
      reasons: ['INVALID_CASH_SOURCE'],
    });
  });

  it('normalizes narrow cash and ledger stock scopes with redundant to/asOf dates consistently', () => {
    const ctx = structuredClone(context);
    const bank = {
      ...ctx.chart[1],
      id: id(5),
      code: '1010',
      name: 'Bank',
      type: 'ASSET' as const,
      parent_id: null,
      is_cash: true,
    };
    ctx.chart.push(bank);
    const c = testCase([
      {
        id: 'cash',
        kind: 'ledger',
        metric: 'cash_balance',
        value: '100.00',
        unit: 'USD',
        scope: scope({ from: null, to: '2026-10-31', asOf: '2026-10-31', accountCodes: ['1010'] }),
      },
    ]);
    const r = {
      query: { name: 'cash_position', args: { asOf: '2026-10-31' } },
      answer: 'Cash is $100.00 USD.',
      evidence: [{ rows: [{ label: 'Bank', value: '$100.00', href: `/accounts?account=${bank.id}` }] }],
    };
    expect(scoreAdaptiveResponse(c, { response: r }, ctx).passed).toBe(true);
    expect(
      equivalentScope(
        'cash_balance',
        scope({ from: null, to: '2026-10-31', asOf: '2026-10-31', accountCodes: ['1010'] }),
        scope({ from: null, to: null, asOf: '2026-10-31', accountCodes: ['1010'] }),
        ctx,
      ),
    ).toBe(true);
    r.query.args.asOf = '2026-09-30';
    expect(scoreAdaptiveResponse(c, { response: r }, ctx).passed).toBe(false);
  });

  it('accepts a narrow account-expense tool using real account links and a bound total', () => {
    const r = {
      query: {
        name: 'expense_by_account',
        args: { accountCode: '5030', from: '2026-10-01', to: '2026-10-31' },
      },
      answer: 'Recorded expenses were $100.00 USD.',
      evidence: [{ rows: [{ label: 'Supplies', value: '$100.00', href: `/accounts?account=${id(3)}` }] }],
    };
    expect(score(testCase(), r).passed).toBe(true);
    r.evidence[0].rows[0].href = `/accounts?account=${id(4)}`;
    expect(score(testCase(), r).passed).toBe(false);
  });

  it('checks formula source identity instead of merely matching the resulting zero', () => {
    const c = calcCase('100.00'),
      groups = [group('left'), group('right', '100.00', { accountCodes: ['5040'] })];
    expect(score(c, response(groups, [difference('left', 'right', '0')])).passed).toBe(true);
    expect(score(c, response(groups, [difference('left', 'left', '0')]))).toMatchObject({
      passed: false,
      reasons: ['UNEXPECTED_CALCULATION_FORMULA'],
    });
  });

  it('accepts an equivalent reordered sum without relying on model calculation IDs', () => {
    const c = calcCase(),
      expected = c.expected.required[0];
    if (expected.kind !== 'calculation') throw Error('test fixture');
    expected.value = '135.00';
    expected.formula = { operation: 'add', operands: [{ claim: 'rent' }, { claim: 'supplies' }] };
    const calc = difference('left', 'right', '135.00');
    calc.id = 'any_model_id';
    calc.operation = 'add';
    expect(
      score(c, response([group('left'), group('right', '35.00', { accountCodes: ['5040'] })], [calc])).passed,
    ).toBe(true);
  });

  it('accepts a compound row with the same effective account and raw counterparty scope', () => {
    const c = testCase([
      claim('supplies_acme', '100.00', { counterparty: { mode: 'identity', value: 'Acme' } }),
    ]);
    const g = group('q', '100.00', { groupBy: ['counterparty', 'account'] });
    g.rows[0].dimensions = [
      { kind: 'counterparty', key: 'Acme', label: 'Acme' },
      { kind: 'account', key: '5030', label: 'Supplies', accountId: id(3) },
    ];
    g.rows[0].rowId = 'compound:[["counterparty","Acme"],["account","5030"]]';
    expect(score(c, response([g])).passed).toBe(true);
    g.rows[0].dimensions[1].accountId = id(4);
    expect(score(c, response([g])).passed).toBe(false);
  });

  it('accepts exact rational arithmetic and rejects a mutation of the exact result', () => {
    const groups = [group('left'), group('right', '35.00', { accountCodes: ['5040'] })],
      calculation = difference('left', 'right');
    expect(score(calcCase(), response(groups, [calculation])).passed).toBe(true);
    calculation.exact.numerator = '64';
    expect(score(calcCase(), response(groups, [calculation]))).toMatchObject({
      passed: false,
      reasons: ['INCORRECT_CALCULATION_VALUE'],
    });
  });

  it('rejects truncated arithmetic operands while leaving unused discovery permissible', () => {
    const left = group('left');
    left.truncated = true;
    const r = response(
      [left, group('right', '35.00', { accountCodes: ['5040'] })],
      [difference('left', 'right')],
    );
    expect(score(calcCase(), r)).toMatchObject({ passed: false, reasons: ['MISSING_OR_TRUNCATED_OPERAND'] });
  });

  it('rejects altered ancestry and a draft/assumption result masquerading as posted', () => {
    const groups = [group('left'), group('right', '35.00', { accountCodes: ['5040'] })];
    const calc = difference('left', 'right');
    calc.provenance.queryRows.pop();
    expect(score(calcCase(), response(groups, [calc])).passed).toBe(false);
    const wrongSource = difference('left', 'right');
    wrongSource.hypothetical = true;
    expect(score(calcCase(), response(groups, [wrongSource])).hardBoundaryViolations).toContain(
      'status_or_assumption_masquerade',
    );
  });

  it('flags a foreign-workspace fact independently of its correct amount', () => {
    const g = group();
    g.scope.organizationId = id(999);
    expect(score(testCase(), response([g]))).toMatchObject({
      passed: false,
      hardBoundaryViolations: ['foreign_workspace'],
    });
  });

  it('scores safe deferral on an answerable question as a coverage failure', () => {
    const r = {
      answer: 'Which period?',
      evidence: [],
      query: {
        name: 'request_details',
        args: { reason: 'missing_period', subject: 'analysis', accountCodes: [], limitation: 'none' },
      },
    };
    expect(score(testCase(), r)).toMatchObject({
      passed: false,
      classification: 'safe-no-answer',
      reasons: ['ANSWERABLE_COVERAGE_MISS'],
    });
    const c = testCase([]);
    c.expected.behavior = 'CLARIFY';
    c.expected.clarification = { reasons: ['missing_period'] };
    expect(score(c, r)).toMatchObject({ passed: true, classification: 'structured-correct' });
    r.query.args.reason = 'off_topic';
    expect(score(c, r)).toMatchObject({ passed: false, classification: 'safe-no-answer' });
  });

  it('keeps freeform boundary wording pending and execution errors distinct', () => {
    const c = testCase([]);
    c.expected.behavior = 'REFUSE';
    expect(
      score(c, {
        answer: 'I cannot provide that.',
        evidence: [],
        query: { name: 'ask_clarification', args: {} },
      }),
    ).toMatchObject({ passed: false, classification: 'subjective-wording-pending' });
    expect(scoreAdaptiveResponse(c, { error: { code: 'AI_TIMEOUT' } }, context)).toMatchObject({
      passed: false,
      classification: 'execution-error',
    });
  });

  it('aggregates matched held-out pairs without counting development or absent outcomes as successes', () => {
    const cases = Array.from({ length: 16 }, (_, i) => ({
      ...testCase(),
      id: `H${i}`,
      family: i < 8 ? 'common' : 'discovery',
    }));
    const pass = score(testCase(), response([group()]));
    const rows = cases.flatMap((c, i) =>
      (['composable', 'adaptive'] as const).map((route) => ({
        caseId: c.id,
        route,
        score: { ...pass, caseId: c.id, family: c.family, passed: route === 'adaptive' || i < 12 },
      })),
    );
    const result = aggregatePairedScores(cases, rows);
    expect(result).toMatchObject({
      complete: true,
      completedPairs: 16,
      composablePassed: 12,
      adaptivePassed: 16,
      adaptiveOnly: 4,
      composableOnly: 0,
      exactTwoSidedMcNemarP: 0.125,
    });
    expect(result.adaptiveWilson95![0]).toBeLessThan(1);
    expect(aggregatePairedScores(cases, rows.slice(1))).toMatchObject({
      complete: false,
      completedPairs: 15,
    });
    expect(() => aggregatePairedScores(cases, [...rows, rows[0]])).toThrow('DUPLICATE_PAIRED_RESULT');
  });
});
