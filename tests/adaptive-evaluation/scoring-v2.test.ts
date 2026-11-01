import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { counterparties, loadCases, loadLedger } from '../../scripts/adaptive-evaluation/fixtures';
import { scoreAdaptiveResponse, type ScoringContext } from '../../scripts/adaptive-evaluation/scoring';
import { scoreAdaptiveResponseV2 } from '../../scripts/adaptive-evaluation/scoring-v2';
import { evaluateFinancialScenario } from '../../server/financial-calculation';
import type { AnalysisFacts, FinancialQuery } from '../../server/financial-analysis';

const fixture = loadLedger();
const id = (code: string) => `00000000-0000-4000-8000-${code.padStart(12, '0')}`;
const context: ScoringContext = {
  organizationId: id('999'),
  counterparties: counterparties(fixture),
  chart: fixture.accounts.map((a) => ({
    id: id(a.code),
    code: a.code,
    name: a.name,
    type: a.type,
    currency: a.currency,
    parent_id: a.parentCode ? id(a.parentCode) : null,
    is_group: a.isGroup,
    is_cash: a.isCash,
    archived: a.archived,
  })),
};
const d03 = () => structuredClone(loadCases('development').find((item) => item.id === 'D03')!);
function group(
  queryId: string,
  value: string,
  accountCodes: string[],
  change: Partial<FinancialQuery> = {},
  ctx = context,
): AnalysisFacts {
  const plan: FinancialQuery = {
    id: queryId,
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-05-01',
    to: '2026-05-31',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: 'total',
    accountCodes,
    cooccurringAccountCodes: [],
    counterparty: { mode: 'any', value: '' },
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
    order: 'label_asc',
    limit: 50,
    ...change,
  };
  const cash = ctx.chart.filter(
    (a) =>
      a.is_cash &&
      a.type === 'ASSET' &&
      !a.is_group &&
      (plan.currencyMode === 'base' || a.currency === plan.currency),
  );
  const cashMetric = ['cash_balance', 'net_cash_movement'].includes(plan.metric);
  const selected = cashMetric
    ? cash
    : plan.accountCodes.flatMap((code) => ctx.chart.filter((a) => a.code === code));
  return {
    queryId,
    metric: plan.metric,
    aggregation: plan.aggregation,
    grain: plan.groupBy,
    unit: plan.currencyMode === 'native' ? plan.currency! : 'USD',
    currency: plan.currencyMode === 'native' ? plan.currency! : 'USD',
    truncated: false,
    rows: [{ rowId: 'total:total', label: 'Total', value, entryCount: '1', from: plan.from, to: plan.to }],
    scope: {
      organizationId: ctx.organizationId,
      plan,
      resolvedAccountIds: selected.map((a) => a.id),
      cooccurringAccountIds: [],
      amountBasis: cashMetric
        ? `net_cash_movement_${plan.currencyMode}_lines`
        : `selected_metric_${plan.currencyMode}_lines`,
      statusMeaning: plan.status === 'POSTED' ? 'booked' : 'unposted_projection',
      ...(plan.metric === 'net_cash_movement'
        ? {
            cashMovementSource: {
              selection: 'all_cash_asset_posting_accounts' as const,
              accounts: cash.map(({ id, code, type, currency, is_cash, is_group, archived }) => ({
                id,
                code,
                type,
                currency,
                is_cash,
                is_group,
                archived,
              })),
            },
          }
        : {}),
    },
  };
}
function response(groups: AnalysisFacts[]) {
  return {
    answer: 'Recorded results.',
    query: { name: 'financial_analysis', args: { queries: groups.map((g) => g.scope.plan) } },
    facts: groups,
    evidence: groups.map((g) => ({
      title: g.queryId,
      source: g.scope.plan.status === 'POSTED' ? 'posted' : 'draft',
      rows: g.rows.map((r) => ({
        label: r.label,
        value: `${r.value?.startsWith('-') ? '-' : ''}${g.unit === 'EUR' ? '€' : '$'}${r.value?.replace(/^-/, '')} ${g.unit}`,
      })),
    })),
  };
}
const separate = () => [group('supplies', '675.00', ['5030']), group('marketing', '80.00', ['5040'])];
const combined = () => [...separate(), group('combined', '755.00', ['5030', '5040'])];
const run = (item = d03(), groups = combined(), ctx = context) =>
  scoreAdaptiveResponseV2(item, { response: response(groups) }, ctx);

describe('Disclosed v2 expense-set equivalence preserves frozen v1 and exact scope', () => {
  it('retains the frozen v1 scorer byte for byte', () => {
    expect(
      createHash('sha256')
        .update(readFileSync(new URL('../../scripts/adaptive-evaluation/scoring.ts', import.meta.url)))
        .digest('hex'),
    ).toBe('61b923127a59438ce5c799181d77dbc2bfe034261e87ba5ff9e7fb2bdaffa753');
  });
  it('accepts the development D03 direct union total without generating a missing total', () => {
    const item = d03(),
      outcome = { response: response(combined()) };
    const before = JSON.stringify({ item, outcome, context });
    expect(scoreAdaptiveResponse(item, outcome, context).classification).toBe('wrong-answer');
    const result = scoreAdaptiveResponseV2(item, outcome, context);
    expect(result).toMatchObject({
      passed: true,
      classification: 'structured-correct',
      matchedClaims: ['combined', 'marketing', 'supplies'],
      revision: {
        version: 'adaptive-scoring-v2',
        originalV1: { passed: false },
        expenseUnionAlternatives: [
          { requiredClaimId: 'combined', accountCodes: ['5030', '5040'], matched: true },
        ],
      },
    });
    expect(JSON.stringify({ item, outcome, context })).toBe(before);
    expect(run(item, separate())).toMatchObject({
      passed: false,
      classification: 'partial-answer',
      matchedClaims: ['marketing', 'supplies'],
    });
  });
  it('continues to accept an actual calculator addition without replacing its lineage', () => {
    const groups = separate();
    const actual = evaluateFinancialScenario(
      {
        queries: groups.map((g) => g.scope.plan),
        assumptions: [],
        calculations: [
          {
            id: 'sum',
            operation: 'add',
            operands: groups.map((g) => ({
              source: 'query',
              id: g.queryId,
              rowId: 'total:total',
              field: 'value',
            })),
          },
        ],
      },
      groups,
      d03().messages,
    );
    const outcome = { response: { ...actual, query: { name: 'financial_scenario' } } };
    expect(scoreAdaptiveResponseV2(d03(), outcome, context)).toMatchObject({
      passed: true,
      revision: { originalV1: { passed: true } },
    });
  });
  it('requires the actual combined total in addition to the separate requested categories', () => {
    const onlyTotal = [group('combined', '755.00', ['5030', '5040'])];
    expect(run(d03(), onlyTotal)).toMatchObject({
      passed: false,
      classification: 'partial-answer',
      matchedClaims: ['combined'],
    });
  });
  it('rejects a wrong union amount and retains its independent numerical diagnosis', () => {
    const groups = combined();
    groups[2].rows[0].value = '754.00';
    expect(run(d03(), groups)).toMatchObject({
      passed: false,
      classification: 'wrong-answer',
      revision: { incorrectExtraRows: 1 },
    });
  });
  it('refuses overlapping account sets even when an apparent total has the expected dollars', () => {
    const item = d03();
    const marketing = item.expected.required[1];
    if (marketing.kind !== 'ledger') throw new Error('Fixture shape');
    marketing.scope.accountCodes = ['5030'];
    marketing.value = '675.00';
    item.expected.required[2].value = '1350.00';
    const groups = [
      group('one', '675.00', ['5030']),
      group('two', '675.00', ['5030']),
      group('fake_total', '1350.00', ['5030']),
    ];
    expect(run(item, groups)).toMatchObject({ passed: false, revision: { expenseUnionAlternatives: [] } });
  });
  it.each(['from', 'status', 'counterparty', 'currency', 'threshold'] as const)(
    'does not union partitions with incompatible %s scope',
    (dimension) => {
      const item = d03(),
        leaf = item.expected.required[1];
      if (leaf.kind !== 'ledger') throw new Error('Fixture shape');
      if (dimension === 'from') leaf.scope.from = '2026-05-02';
      if (dimension === 'status') leaf.scope.status = 'DRAFT';
      if (dimension === 'counterparty') leaf.scope.counterparty = { mode: 'identity', value: 'Harbor Ads' };
      if (dimension === 'currency') {
        leaf.scope.currencyMode = 'native';
        leaf.scope.currency = 'USD';
      }
      if (dimension === 'threshold')
        for (const claim of item.expected.required)
          if (claim.kind === 'ledger') claim.scope.minimumAmount = '50';
      expect(run(item)).toMatchObject({ passed: false, revision: { expenseUnionAlternatives: [] } });
    },
  );
  it('does not apply sum equivalence to subtraction or average-per-entry', () => {
    const subtraction = d03(),
      formula = subtraction.expected.required[2];
    if (formula.kind !== 'calculation' || !('operation' in formula.formula)) throw new Error('Fixture shape');
    formula.formula.operation = 'subtract';
    formula.value = '595.00';
    expect(run(subtraction)).toMatchObject({ passed: false, revision: { expenseUnionAlternatives: [] } });
    const average = d03();
    for (const claim of average.expected.required)
      if (claim.kind === 'ledger') {
        claim.metric = 'net_expense_average_per_entry';
        claim.scope.averageDenominator = '1';
      }
    expect(run(average)).toMatchObject({ passed: false, revision: { expenseUnionAlternatives: [] } });
  });
  it('keeps native EUR equivalence separate from identical-looking base USD scope', () => {
    const ctx = structuredClone(context);
    ctx.chart.push({
      ...ctx.chart.find((a) => a.code === '5061')!,
      id: id('5062'),
      code: '5062',
      name: 'Second EUR expense',
    });
    const item = d03();
    for (const [index, code] of ['5061', '5062'].entries()) {
      const claim = item.expected.required[index];
      if (claim.kind !== 'ledger') throw new Error('Fixture shape');
      claim.value = index ? '10.00' : '24.00';
      claim.unit = 'EUR';
      claim.scope.accountCodes = [code];
      claim.scope.currencyMode = 'native';
      claim.scope.currency = 'EUR';
    }
    item.expected.required[2].value = '34.00';
    item.expected.required[2].unit = 'EUR';
    const groups = [
      group('a', '24.00', ['5061'], { currencyMode: 'native', currency: 'EUR' }, ctx),
      group('b', '10.00', ['5062'], { currencyMode: 'native', currency: 'EUR' }, ctx),
      group('sum', '34.00', ['5061', '5062'], { currencyMode: 'native', currency: 'EUR' }, ctx),
    ];
    expect(run(item, groups, ctx).passed).toBe(true);
    groups[2].scope.plan.currencyMode = 'base';
    groups[2].scope.plan.currency = null;
    groups[2].unit = groups[2].currency = 'USD';
    expect(run(item, groups, ctx).passed).toBe(false);
  });
});

function cashDiscovery(month: 'may' | 'june'): AnalysisFacts {
  const rows =
    month === 'may'
      ? [
          ['Cedar Properties', '-900.00'],
          ['Acme', '-385.00'],
          ['acme', '-360.00'],
          ['Paper Ferry', '-310.00'],
          ['Orbit Tools', '-140.00'],
        ]
      : [
          ['Cedar Properties', '-970.00'],
          ['acme', '-615.00'],
          ['Device Wharf', '-500.00'],
          ['Cobalt Contractors', '-475.00'],
          ['Funding Bank', '-300.00'],
        ];
  const g = group(month, '0', [], {
    metric: 'net_cash_movement',
    groupBy: 'counterparty',
    from: month === 'may' ? '2026-05-01' : '2026-06-01',
    to: month === 'may' ? '2026-05-31' : '2026-06-30',
    order: 'value_asc',
    limit: 5,
  });
  g.truncated = true;
  g.rows = rows.map(([label, value]) => ({
    rowId: `counterparty:${encodeURIComponent(label)}`,
    label,
    value,
    entryCount: '1',
    from: g.scope.plan.from,
    to: g.scope.plan.to,
  }));
  return g;
}
describe('Independent fixture checks distinguish true extra rows from numerical errors', () => {
  it('marks the captured D02 pattern as incomplete with truthful extras, not invented dollars', () => {
    const item = loadCases('development').find((c) => c.id === 'D02')!;
    const result = run(item, [cashDiscovery('may'), cashDiscovery('june')]);
    expect(result).toMatchObject({
      passed: false,
      classification: 'partial-answer',
      matchedClaims: ['selected_june', 'selected_may'],
      revision: { verifiedTrueExtraRows: 4, incorrectExtraRows: 0 },
    });
    expect(result.reasons).toContain('MISSING_REQUIRED_CLAIMS');
  });
  it('does not change a true but wrong-period result into an answer to the requested period', () => {
    const item = d03();
    item.expected.required = [item.expected.required[0]];
    const groups = [group('june', '809.50', ['5030'], { from: '2026-06-01', to: '2026-06-30' })];
    expect(run(item, groups)).toMatchObject({
      passed: false,
      classification: 'partial-answer',
      matchedClaims: [],
      revision: { verifiedTrueExtraRows: 1 },
    });
  });
  it('never matches required scope merely because another category has equal dollars', () => {
    // This deliberately changed question has a wrong reference amount, so a
    // truthful675 supplies answer must never satisfy a Rent scope for675.
    const item = d03();
    item.expected.required = [item.expected.required[0]];
    const claim = item.expected.required[0];
    if (claim.kind !== 'ledger') throw new Error('Fixture shape');
    claim.scope.accountCodes = ['5010'];
    expect(run(item, [group('supplies', '675.00', ['5030'])])).toMatchObject({
      passed: false,
      classification: 'partial-answer',
      matchedClaims: [],
      revision: { verifiedTrueExtraRows: 1 },
    });
  });
  it('still rejects wrong extra amounts even when all requested facts are present', () => {
    const groups = combined();
    groups.push(group('rent', '1381.00', ['5010']));
    expect(run(d03(), groups)).toMatchObject({
      passed: false,
      classification: 'wrong-answer',
      revision: { incorrectExtraRows: 1 },
    });
  });
  it('keeps unsupported extra-filter truth unresolved instead of guessing a numerical error', () => {
    const groups = combined();
    groups.push(group('filtered', '675.00', ['5030'], { descriptionSearch: 'unknown text' }));
    expect(run(d03(), groups)).toMatchObject({
      passed: false,
      classification: 'subjective-wording-pending',
      revision: { unverifiableExtraRows: 1 },
    });
  });
  it('cannot use one unverifiable row to hide a different independently wrong amount', () => {
    const groups = combined();
    groups[2].rows[0].value = '754.00';
    groups.push(group('filtered', '675.00', ['5030'], { descriptionSearch: 'unknown text' }));
    expect(run(d03(), groups)).toMatchObject({
      passed: false,
      classification: 'wrong-answer',
      revision: { incorrectExtraRows: 1, unverifiableExtraRows: 1 },
    });
  });
  it('cannot use an unverifiable row to downgrade an incorrect calculation to pending', () => {
    const groups = separate();
    const actual = evaluateFinancialScenario(
      {
        queries: groups.map((g) => g.scope.plan),
        assumptions: [],
        calculations: [
          {
            id: 'wrong_intent',
            operation: 'subtract',
            operands: groups.map((g) => ({
              source: 'query',
              id: g.queryId,
              rowId: 'total:total',
              field: 'value',
            })),
          },
        ],
      },
      groups,
      d03().messages,
    );
    actual.facts.push(group('filtered', '675.00', ['5030'], { descriptionSearch: 'unknown text' }));
    expect(
      scoreAdaptiveResponseV2(
        d03(),
        { response: { ...actual, query: { name: 'financial_scenario' } } },
        context,
      ),
    ).toMatchObject({
      passed: false,
      classification: 'wrong-answer',
      revision: { unverifiableExtraRows: 1 },
    });
  });
  it.each(['organization', 'status', 'display'] as const)('does not weaken v1 %s validation', (field) => {
    const result = response(combined());
    if (field === 'organization') result.facts[2].scope.organizationId = id('777');
    if (field === 'status') result.facts[2].scope.statusMeaning = 'unposted_projection';
    if (field === 'display') result.evidence[2].rows[0].value = '$756.00 USD';
    expect(scoreAdaptiveResponseV2(d03(), { response: result }, context).passed).toBe(false);
  });
  it('preserves execution errors and clarification outcomes without a scoring retry', () => {
    const outcome = { error: { code: 'AI_TIMEOUT' } };
    expect(scoreAdaptiveResponseV2(d03(), outcome, context)).toMatchObject({
      passed: false,
      classification: 'execution-error',
      revision: { originalV1: { reasons: ['AI_TIMEOUT'] } },
    });
  });
});
