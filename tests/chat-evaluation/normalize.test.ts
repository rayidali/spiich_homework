import { describe, expect, it } from 'vitest';
import { normalizeAnalysis, normalizeCalculations } from '../../scripts/chat-evaluation/normalize';
import type { AnalysisFacts, FinancialQuery } from '../../server/financial-analysis';
import type { ScenarioCalculationFact } from '../../server/financial-calculation';
import type { Fixture } from '../../scripts/chat-evaluation/types';
const fixture: Fixture = {
  version: 'test',
  today: '2026-07-15',
  timezone: 'America/New_York',
  primaryOrganizationId: 'org',
  foreignOrganizationId: 'other',
  organizations: [],
  entries: [],
  accounts: [
    {
      id: 'bank1',
      organization_id: 'org',
      code: '1010',
      name: 'Bank',
      type: 'ASSET',
      currency: 'USD',
      is_cash: true,
      is_group: false,
      archived: false,
      parent_id: null,
    },
    {
      id: 'bank2',
      organization_id: 'org',
      code: '1020',
      name: 'Petty cash',
      type: 'ASSET',
      currency: 'USD',
      is_cash: true,
      is_group: false,
      archived: false,
      parent_id: null,
    },
  ],
};
function fact(change: Partial<FinancialQuery> = {}): AnalysisFacts {
  const plan: FinancialQuery = {
    id: 'q',
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-04-01',
    to: '2026-06-30',
    status: 'POSTED',
    groupBy: 'month',
    accountCodes: [],
    cooccurringAccountCodes: [],
    counterparty: { mode: 'any', value: '' },
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
    order: 'label_asc',
    limit: 50,
    currencyMode: 'base',
    currency: null,
    ...change,
  };
  return {
    queryId: plan.id,
    metric: plan.metric,
    aggregation: plan.aggregation,
    grain: plan.groupBy,
    unit: 'USD',
    currency: 'USD',
    rows: [
      {
        rowId: 'month:2026-04',
        label: 'April',
        value: '100.00',
        entryCount: '2',
        from: '2026-04-01',
        to: '2026-04-30',
      },
    ],
    truncated: false,
    scope: {
      organizationId: 'org',
      plan,
      resolvedAccountIds: [],
      cooccurringAccountIds: [],
      amountBasis: 'base',
      statusMeaning: 'posted',
    },
  };
}
describe('database-derived scope normalization', () => {
  it('refuses to award the frozen scalar-study score to a later compound grouping', () => {
    expect(() => normalizeAnalysis([fact({ groupBy: ['month', 'account'] })], fixture)).toThrow(
      'scalar study normalizer cannot score compound',
    );
  });
  it('uses the actual month row bounds, not the full query window', () => {
    const [r] = normalizeAnalysis([fact()], fixture);
    expect(r.scope).toMatchObject({ from: '2026-04-01', to: '2026-04-30', asOf: null, month: '2026-04' });
  });
  it('proves closing stock from actual balance row end and does not call a partial bank selection total cash', () => {
    const [all] = normalizeAnalysis(
      [fact({ metric: 'account_balance', accountCodes: ['1010', '1020'] })],
      fixture,
    );
    expect(all.metric).toBe('cash_balance');
    expect(all.scope).toMatchObject({ from: null, to: null, asOf: '2026-04-30' });
    const [part] = normalizeAnalysis([fact({ metric: 'account_balance', accountCodes: ['1010'] })], fixture);
    expect(part.metric).toBe('account_balance');
    expect(part.scope.accountCodes).toEqual(['1010']);
  });
  it('retains hidden filters, native units and average denominator in proof', () => {
    const f = fact({
      aggregation: 'average_per_entry',
      currencyMode: 'native',
      currency: 'EUR',
      descriptionSearch: 'selected only',
      cooccurringAccountCodes: ['1010'],
    });
    f.unit = 'EUR';
    f.currency = 'EUR';
    const [r] = normalizeAnalysis([f], fixture);
    expect(r.unit).toBe('EUR');
    expect(r.scope).toMatchObject({
      denominator: 2,
      currencyMode: 'native',
      descriptionSearch: 'selected only',
      cooccurringAccountCodes: ['1010'],
    });
  });
  it('accepts a direct proven period difference but refuses incompatible vendor scope', () => {
    const a = fact({ id: 'a', groupBy: 'total', from: '2026-04-01', to: '2026-04-30' }),
      b = fact({ id: 'b', groupBy: 'total', from: '2026-05-01', to: '2026-05-31' });
    a.rows[0].rowId = 'total:total';
    b.rows[0].rowId = 'total:total';
    b.rows[0].value = '70.00';
    const c: ScenarioCalculationFact = {
      kind: 'scenario_calculation',
      id: 'difference',
      hypothetical: false,
      source: 'posted',
      operation: 'subtract',
      operands: [
        { source: 'query', id: 'a', rowId: 'total:total', field: 'value' },
        { source: 'query', id: 'b', rowId: 'total:total', field: 'value' },
      ],
      value: '30.00',
      unit: 'USD',
      exact: { numerator: '30', denominator: '1' },
      assumptions: [],
      provenance: { assumptionIds: [], queryRows: [] },
    };
    expect(normalizeCalculations([c], normalizeAnalysis([a, b], fixture))).toHaveLength(1);
    b.scope.plan.counterparty = { mode: 'exact', value: 'Different vendor' };
    expect(normalizeCalculations([c], normalizeAnalysis([a, b], fixture))).toHaveLength(0);
  });
});
