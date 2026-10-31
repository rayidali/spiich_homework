import type { AnalysisFacts } from '../../server/financial-analysis';
import type { Fixture } from './types';
import type { ScenarioCalculationFact } from '../../server/financial-calculation';
import type { ScoredFact } from './scoring';
/** Evidence comes from the compiler/executor; never from model-provided numeric labels. */
export function normalizeAnalysis(groups: AnalysisFacts[], fixture: Fixture): ScoredFact[] {
  const accounts = fixture.accounts.filter((a) => a.organization_id === fixture.primaryOrganizationId);
  const cash = accounts
    .filter((a) => a.is_cash && !a.is_group)
    .map((a) => a.code)
    .sort();
  return groups.flatMap((g) => {
    const p = g.scope.plan;
    // This frozen study's rubric defines scalar groups only. A later product
    // capability needs its own evaluation rather than inheriting old scores.
    if (Array.isArray(p.groupBy))
      throw new Error('The scalar study normalizer cannot score compound groupings.');
    const groupBy = p.groupBy;
    return g.rows
      .filter((r) => r.value !== null)
      .map((r, index) => {
        let codes = [...p.accountCodes].sort();
        if (p.groupBy === 'account') {
          const id = decodeURIComponent(r.rowId.slice('account:'.length));
          const a = accounts.find((a) => a.id === id || a.code === id || a.name === r.label);
          if (a) codes = [a.code];
        }
        const isCash = p.metric === 'account_balance' && JSON.stringify(codes) === JSON.stringify(cash);
        const rowIdentity = decodeURIComponent(r.rowId.slice(r.rowId.indexOf(':') + 1));
        const counterpart = p.groupBy === 'counterparty' ? { mode: 'exact', value: r.label } : p.counterparty;
        const scope: Record<string, unknown> = {
          from:
            p.metric === 'account_balance' ? null : ['month', 'quarter'].includes(groupBy) ? r.from : p.from,
          to: p.metric === 'account_balance' ? null : ['month', 'quarter'].includes(groupBy) ? r.to : p.to,
          asOf: p.metric === 'account_balance' ? r.to : null,
          status: p.status,
          accountCodes: isCash ? [] : codes,
          counterparty: counterpart,
          currencyMode: p.currencyMode,
          cooccurringAccountCodes: p.cooccurringAccountCodes,
          descriptionSearch: p.descriptionSearch,
          minimumAmount: p.minimumAmount,
          maximumAmount: p.maximumAmount,
          groupBy: p.groupBy,
          order: p.order,
          limit: p.limit,
          ...(p.groupBy === 'month' ? { month: r.to!.slice(0, 7) } : {}),
          ...(p.groupBy === 'entry' ? { entryId: rowIdentity } : {}),
          ...(p.order === 'value_desc' || p.order === 'value_asc' ? { rank: index + 1 } : {}),
          ...(p.aggregation === 'average_per_entry' ? { denominator: Number(r.entryCount) } : {}),
        };
        return {
          metric: isCash
            ? 'cash_balance'
            : p.aggregation === 'average_per_entry'
              ? `${p.metric}_average_per_entry`
              : p.metric,
          value: r.value!,
          unit: g.unit,
          scope,
          proof: { queryId: g.queryId, rowId: r.rowId, entryCount: r.entryCount, plan: p },
        };
      });
  });
}

/** A direct difference between two proven like-for-like query rows has machine-readable scope. */
export function normalizeCalculations(
  calculations: ScenarioCalculationFact[],
  queryFacts: ScoredFact[],
): ScoredFact[] {
  return calculations.flatMap((c) => {
    if (
      c.operation !== 'subtract' ||
      c.assumptions.length ||
      c.operands.length !== 2 ||
      c.operands.some((o) => o.source !== 'query' || o.field !== 'value')
    )
      return [];
    const operands = c.operands.map((o) =>
      queryFacts.find((f) => f.proof.queryId === o.id && f.proof.rowId === o.rowId),
    );
    const [left, right] = operands;
    if (!left || !right || left.metric !== right.metric || left.unit !== right.unit || left.unit !== c.unit)
      return [];
    const { from: lf, to: lt, ...ls } = left.scope,
      { from: rf, to: rt, ...rs } = right.scope;
    // Plan presentation limits/order do not change a scalar total; grain/filters/identities do.
    for (const p of [ls, rs]) {
      delete p.order;
      delete p.limit;
      delete p.rank;
    }
    if (
      JSON.stringify(ls) !== JSON.stringify(rs) ||
      typeof lf !== 'string' ||
      typeof lt !== 'string' ||
      typeof rf !== 'string' ||
      typeof rt !== 'string'
    )
      return [];
    return [
      {
        metric: 'difference',
        value: c.value,
        unit: c.unit,
        scope: { ...left.scope, previousFrom: rf, previousTo: rt },
        proof: { calculation: c },
      },
    ];
  });
}
