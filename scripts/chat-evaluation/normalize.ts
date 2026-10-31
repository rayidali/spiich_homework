import type { AnalysisFacts } from '../../server/financial-analysis';
import type { Fixture } from './types';
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
            p.metric === 'account_balance'
              ? null
              : ['month', 'quarter'].includes(p.groupBy)
                ? r.from
                : p.from,
          to: p.metric === 'account_balance' ? null : ['month', 'quarter'].includes(p.groupBy) ? r.to : p.to,
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
