/** Independent visible-answer grading for the new comparison. No fixture loads,
 * provider calls, production execution or use of model-declared completion. */
import { Decimal, formatCurrency } from '../../shared/money';
import type { AnalysisFacts, AnalysisAccount } from '../../server/financial-analysis';
import type { ScenarioCalculationFact } from '../../server/financial-calculation';
import { scenarioAssumptionQuantityEvidence } from '../../server/financial-calculation';
import { parseInsightArgs } from '../../server/ai';
import { clarificationAnswer } from '../../server/chat-clarification';
import type { ModelMessages } from '../../server/ai-provider';
import type {
  CompletenessCase,
  CompletenessOutcome,
  CompletenessScore,
  ExpectedClaim,
  ExpectedScope,
  Formula,
  ScoringContext,
  ExpectedTable,
} from './types';

type LedgerClaim = Extract<ExpectedClaim, { kind: 'ledger' }> & {
  queryId: string;
  rowId: string;
  truncated: boolean;
};
type Json = Record<string, any>;
class InvalidEvidence extends Error {}
function requireEvidence(value: unknown, code: string): asserts value {
  if (!value) throw new InvalidEvidence(code);
}
function object(value: unknown): Json {
  requireEvidence(value && typeof value === 'object' && !Array.isArray(value), 'MALFORMED_RESPONSE');
  return value as Json;
}
const sorted = (values: string[]) => [...new Set(values)].sort();
const canonical = (value: unknown): string =>
  JSON.stringify(
    (function order(item: unknown): unknown {
      if (Array.isArray(item)) return item.map(order);
      if (item && typeof item === 'object')
        return Object.fromEntries(
          Object.entries(item)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, next]) => [key, order(next)]),
        );
      return item;
    })(value),
  );
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function decimal(value: unknown): Decimal {
  requireEvidence(typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value), 'INVALID_DECIMAL');
  return new Decimal(value);
}
function sameNumber(a: unknown, b: unknown) {
  try {
    return decimal(a).eq(decimal(b));
  } catch {
    return false;
  }
}
const baseMetric = (metric: string) => metric.replace(/_average_per_entry$/, '');
function accountsFor(metric: string, scope: ExpectedScope, ctx: ScoringContext): string[] {
  const types =
    baseMetric(metric) === 'net_expense'
      ? ['EXPENSE']
      : baseMetric(metric) === 'net_revenue'
        ? ['REVENUE']
        : baseMetric(metric) === 'net_profit'
          ? ['REVENUE', 'EXPENSE']
          : null;
  const cash = ['cash_balance', 'net_cash_movement'].includes(baseMetric(metric));
  const codes = scope.accountCodes;
  requireEvidence(
    Array.isArray(codes) && codes.every((code) => ctx.chart.some((a) => a.code === code)),
    'UNKNOWN_ACCOUNT',
  );
  const roots = new Set(codes.map((code) => ctx.chart.find((a) => a.code === code)!.id));
  const selected = ctx.chart
    .filter((account) => {
      if (
        account.is_group ||
        (types && !types.includes(account.type)) ||
        (cash && (account.type !== 'ASSET' || !account.is_cash))
      )
        return false;
      if (scope.currencyMode === 'native' && account.currency !== scope.currency) return false;
      if (!roots.size) return true;
      let parent: AnalysisAccount | undefined = account;
      const seen = new Set<string>();
      while (parent && !seen.has(parent.id)) {
        if (roots.has(parent.id)) return true;
        seen.add(parent.id);
        parent = ctx.chart.find((a) => a.id === parent!.parent_id);
      }
      return false;
    })
    .map((a) => a.code);
  // Distinct empty chart branches are not equivalent just because both total zero.
  return selected.length
    ? sorted(selected)
    : codes.length
      ? sorted(codes).map((code) => `empty:${code}`)
      : [];
}
function counterparties(scope: ExpectedScope, ctx: ScoringContext): string[] {
  const { mode, value } = scope.counterparty;
  const keys = ctx.counterparties.filter(
    (key) =>
      mode === 'any' ||
      (mode === 'identity'
        ? key === value
        : mode === 'exact'
          ? key.toLowerCase() === value.toLowerCase()
          : mode === 'contains'
            ? key.toLowerCase().includes(value.toLowerCase())
            : false),
  );
  return keys.length ? sorted(keys) : mode === 'any' ? [] : [`empty:${mode}:${value}`];
}
function canonicalScope(metric: string, scope: ExpectedScope, ctx: ScoringContext) {
  requireEvidence(scope && ['POSTED', 'DRAFT'].includes(scope.status), 'UNKNOWN_STATUS');
  requireEvidence(['base', 'native'].includes(scope.currencyMode), 'UNKNOWN_CURRENCY_BASIS');
  requireEvidence(
    scope.currencyMode === 'base' ? scope.currency === null : typeof scope.currency === 'string',
    'UNKNOWN_CURRENCY',
  );
  requireEvidence(
    scope.counterparty && ['any', 'exact', 'contains', 'identity'].includes(scope.counterparty.mode),
    'UNKNOWN_COUNTERPARTY_FILTER',
  );
  const stock = ['cash_balance', 'account_balance'].includes(baseMetric(metric));
  if (stock)
    requireEvidence(
      scope.from === null && typeof scope.asOf === 'string' && (scope.to === null || scope.to === scope.asOf),
      'INCONSISTENT_STOCK_DATE',
    );
  return {
    from: scope.from,
    to: stock ? null : scope.to,
    asOf: scope.asOf,
    status: scope.status,
    accountCodes: accountsFor(metric, scope, ctx),
    counterparties: counterparties(scope, ctx),
    currencyMode: scope.currencyMode,
    currency: scope.currency,
    cooccurringAccountCodes: scope.cooccurringAccountCodes.length
      ? accountsFor(
          'journal_count',
          { ...scope, accountCodes: scope.cooccurringAccountCodes, currencyMode: 'base', currency: null },
          ctx,
        )
      : [],
    descriptionSearch: scope.descriptionSearch.toLowerCase(),
    minimumAmount: scope.minimumAmount === null ? null : decimal(scope.minimumAmount).toString(),
    maximumAmount: scope.maximumAmount === null ? null : decimal(scope.maximumAmount).toString(),
    entryId: scope.entryId ?? null,
    amountThresholdAccountCodes:
      scope.minimumAmount !== null || scope.maximumAmount !== null
        ? accountsFor(
            metric,
            { ...scope, accountCodes: scope.amountThresholdAccountCodes ?? scope.accountCodes },
            ctx,
          )
        : null,
    searchText: scope.searchText?.toLowerCase() ?? null,
    averageDenominator:
      scope.averageDenominator === undefined ? null : decimal(scope.averageDenominator).toString(),
  };
}
export function equivalentScope(
  metric: string,
  expected: ExpectedScope,
  actual: ExpectedScope,
  context: ScoringContext,
) {
  return equal(canonicalScope(metric, expected, context), canonicalScope(metric, actual, context));
}
function economicMetric(metric: string, scope: ExpectedScope, context: ScoringContext) {
  if (metric !== 'account_balance') return metric;
  const codes = accountsFor(metric, scope, context);
  return codes.length > 0 &&
    codes.every((code) =>
      context.chart.some((a) => a.code === code && a.type === 'ASSET' && a.is_cash && !a.is_group),
    )
    ? 'cash_balance'
    : metric;
}
function defaultScope(from: string | null, to: string | null): ExpectedScope {
  return {
    from,
    to,
    asOf: null,
    status: 'POSTED',
    accountCodes: [],
    counterparty: { mode: 'any', value: '' },
    currencyMode: 'base',
    currency: null,
    cooccurringAccountCodes: [],
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
  };
}
function rawCounterparty(group: AnalysisFacts, row: AnalysisFacts['rows'][number]): string {
  if (group.grain === 'counterparty') {
    requireEvidence(row.rowId.startsWith('counterparty:'), 'INVALID_COUNTERPARTY_ID');
    const encoded = row.rowId.slice('counterparty:'.length),
      key = decodeURIComponent(encoded);
    requireEvidence(encodeURIComponent(key) === encoded, 'INVALID_COUNTERPARTY_ID');
    return key;
  }
  const dimension = row.dimensions?.find((d) => d.kind === 'counterparty');
  requireEvidence(dimension, 'MISSING_COUNTERPARTY_DIMENSION');
  return dimension.key;
}
function validateRowPeriod(group: AnalysisFacts, row: AnalysisFacts['rows'][number]) {
  const plan = group.scope.plan,
    dimensions = Array.isArray(plan.groupBy) ? plan.groupBy : [plan.groupBy];
  const period = dimensions.find((d) => d === 'month' || d === 'quarter');
  if (!period) {
    // Current entry rows retain the query range; their explicit entry ID supplies event identity.
    requireEvidence(row.from === plan.from && row.to === plan.to, 'ROW_PERIOD_MISMATCH');
    return;
  }
  requireEvidence(plan.from !== null && row.from !== null && row.to !== null, 'ROW_PERIOD_MISMATCH');
  const key = Array.isArray(plan.groupBy)
    ? row.dimensions?.find((d) => d.kind === period)?.key
    : decodeURIComponent(row.rowId.slice(period.length + 1));
  const matched =
    typeof key === 'string' && (period === 'month' ? /^(\d{4})-(\d{2})$/ : /^(\d{4})-Q([1-4])$/).exec(key);
  requireEvidence(matched, 'INVALID_PERIOD_KEY');
  const year = Number(matched[1]),
    month = period === 'month' ? Number(matched[2]) : (Number(matched[2]) - 1) * 3 + 1;
  requireEvidence(month >= 1 && month <= 12, 'INVALID_PERIOD_KEY');
  const start = `${matched[1]}-${String(month).padStart(2, '0')}-01`;
  const end = new Date(0);
  end.setUTCFullYear(year, month - 1 + (period === 'month' ? 1 : 3), 0);
  end.setUTCHours(0, 0, 0, 0);
  const finish = end.toISOString().slice(0, 10);
  requireEvidence(
    start <= plan.to &&
      finish >= plan.from &&
      row.from === (start > plan.from ? start : plan.from) &&
      row.to === (finish < plan.to ? finish : plan.to),
    'ROW_PERIOD_MISMATCH',
  );
}
function normalizeGroups(groups: AnalysisFacts[], context: ScoringContext): LedgerClaim[] {
  requireEvidence(new Set(groups.map((g) => g.queryId)).size === groups.length, 'DUPLICATE_QUERY_ID');
  return groups.flatMap((group) => {
    requireEvidence(group.scope?.organizationId === context.organizationId, 'FOREIGN_WORKSPACE');
    const plan = group.scope.plan;
    requireEvidence(
      plan &&
        plan.id === group.queryId &&
        plan.metric === group.metric &&
        plan.aggregation === group.aggregation &&
        equal(plan.groupBy, group.grain),
      'PLAN_FACT_MISMATCH',
    );
    requireEvidence(
      group.scope.statusMeaning === (plan.status === 'DRAFT' ? 'unposted_projection' : 'booked'),
      'STATUS_PROVENANCE_MISMATCH',
    );
    requireEvidence(
      group.unit ===
        (plan.metric === 'journal_count' ? 'count' : plan.currencyMode === 'native' ? plan.currency : 'USD'),
      'UNIT_MISMATCH',
    );
    requireEvidence(new Set(group.rows.map((r) => r.rowId)).size === group.rows.length, 'DUPLICATE_ROW_ID');
    if (!['cash_balance', 'net_cash_movement'].includes(plan.metric)) {
      const selectedScope = {
        ...defaultScope(plan.from, plan.to),
        accountCodes: plan.accountCodes,
        currencyMode: plan.currencyMode,
        currency: plan.currency,
      };
      const ids = plan.accountCodes.length
        ? accountsFor(plan.metric, selectedScope, context).flatMap((code) =>
            context.chart.filter((a) => a.code === code).map((a) => a.id),
          )
        : [];
      requireEvidence(
        equal(sorted(group.scope.resolvedAccountIds), sorted(ids)),
        'ACCOUNT_RESOLUTION_MISMATCH',
      );
    }
    const cooccurringIds = plan.cooccurringAccountCodes.length
      ? accountsFor(
          'journal_count',
          {
            ...defaultScope(null, null),
            accountCodes: plan.cooccurringAccountCodes,
          },
          context,
        ).flatMap((code) => context.chart.filter((a) => a.code === code).map((a) => a.id))
      : [];
    requireEvidence(
      equal(sorted(group.scope.cooccurringAccountIds), sorted(cooccurringIds)),
      'COOCCURRENCE_RESOLUTION_MISMATCH',
    );
    if (['cash_balance', 'net_cash_movement'].includes(plan.metric)) {
      const cashScope = {
        ...defaultScope(plan.from, plan.to),
        currencyMode: plan.currencyMode,
        currency: plan.currency,
      };
      const accounts = accountsFor(plan.metric, cashScope, context).map(
        (code) => context.chart.find((a) => a.code === code)!,
      );
      const proof =
        plan.metric === 'cash_balance' ? group.scope.cashBalanceSource : group.scope.cashMovementSource;
      const expectedBasis =
        plan.metric === 'cash_balance'
          ? `inception_to_closing_date_${plan.currencyMode}_lines`
          : `net_cash_movement_${plan.currencyMode}_lines`;
      requireEvidence(
        plan.accountCodes.length === 0 &&
          plan.status === 'POSTED' &&
          plan.aggregation === 'sum' &&
          proof?.selection === 'all_cash_asset_posting_accounts' &&
          group.scope.amountBasis === expectedBasis &&
          equal(sorted(group.scope.resolvedAccountIds), sorted(accounts.map((a) => a.id))) &&
          equal(proof.accounts.map((a) => a.id).sort(), accounts.map((a) => a.id).sort()) &&
          proof.accounts.every((a) => {
            const current = accounts.find((candidate) => candidate.id === a.id);
            return (
              current &&
              a.code === current.code &&
              a.type === 'ASSET' &&
              a.is_cash === true &&
              a.is_group === false &&
              a.currency === current.currency &&
              a.archived === current.archived
            );
          }),
        'INVALID_CASH_SOURCE',
      );
    }
    if (plan.counterparty.mode === 'identity') {
      const proof = group.scope.counterpartyIdentity;
      const sourceIndex = groups.findIndex((g) => g.queryId === proof?.queryId);
      requireEvidence(
        proof &&
          proof.key === plan.counterparty.value &&
          sourceIndex >= 0 &&
          sourceIndex < groups.indexOf(group),
        'INVALID_IDENTITY_PROOF',
      );
      const source = groups[sourceIndex],
        rows = source.rows.filter((r) => r.rowId === proof.rowId);
      requireEvidence(
        rows.length === 1 && rawCounterparty(source, rows[0]) === proof.key,
        'INVALID_IDENTITY_PROOF',
      );
    } else requireEvidence(!group.scope.counterpartyIdentity, 'UNEXPECTED_IDENTITY_PROOF');
    return group.rows.map((row) => {
      validateRowPeriod(group, row);
      if (row.value === null) throw new UngradableEvidence('NULL_FINANCIAL_RESULT');
      decimal(row.value);
      const balance = ['cash_balance', 'account_balance'].includes(plan.metric);
      if (balance) requireEvidence(row.balanceAsOf === row.to, 'INVALID_BALANCE_DATE');
      const scope: ExpectedScope = {
        ...defaultScope(balance ? null : row.from, balance ? null : row.to),
        asOf: balance ? row.balanceAsOf! : null,
        status: plan.status,
        accountCodes: plan.accountCodes,
        counterparty: plan.counterparty,
        currencyMode: plan.currencyMode,
        currency: plan.currency,
        cooccurringAccountCodes: plan.cooccurringAccountCodes,
        descriptionSearch: plan.descriptionSearch,
        minimumAmount: plan.minimumAmount,
        maximumAmount: plan.maximumAmount,
        ...(plan.aggregation === 'average_per_entry' ? { averageDenominator: row.entryCount } : {}),
        ...(plan.minimumAmount !== null || plan.maximumAmount !== null
          ? {
              amountThresholdAccountCodes: accountsFor(
                plan.metric,
                {
                  ...defaultScope(plan.from, plan.to),
                  accountCodes: plan.accountCodes,
                  currencyMode: plan.currencyMode,
                  currency: plan.currency,
                },
                context,
              ),
            }
          : {}),
      };
      const dimensions = Array.isArray(plan.groupBy) ? plan.groupBy : [plan.groupBy];
      if (Array.isArray(plan.groupBy)) {
        requireEvidence(
          row.dimensions?.length === plan.groupBy.length &&
            row.dimensions.every((d, i) => d.kind === plan.groupBy[i]) &&
            row.rowId === `compound:${JSON.stringify(row.dimensions.map((d) => [d.kind, d.key]))}`,
          'INVALID_COMPOUND_ID',
        );
      }
      if (dimensions.includes('account')) {
        const d = row.dimensions?.find((d) => d.kind === 'account');
        const id = d ? d.accountId : decodeURIComponent(row.rowId.slice('account:'.length));
        const account = context.chart.find((a) => a.id === id);
        requireEvidence(account && !account.is_group && (!d || d.key === account.code), 'INVALID_ACCOUNT_ID');
        requireEvidence(
          accountsFor(plan.metric, scope, context).includes(account.code),
          'ACCOUNT_OUTSIDE_QUERY',
        );
        scope.accountCodes = [account.code];
      }
      if (dimensions.includes('counterparty')) {
        const key = rawCounterparty(group, row);
        requireEvidence(counterparties(scope, context).includes(key), 'COUNTERPARTY_OUTSIDE_QUERY');
        scope.counterparty = { mode: 'identity', value: key };
      }
      if (plan.groupBy === 'entry') scope.entryId = decodeURIComponent(row.rowId.slice('entry:'.length));
      return {
        id: `${group.queryId}/${row.rowId}`,
        kind: 'ledger' as const,
        metric: plan.metric + (plan.aggregation === 'average_per_entry' ? '_average_per_entry' : ''),
        value: row.value!,
        unit: group.unit,
        scope,
        queryId: group.queryId,
        rowId: row.rowId,
        truncated: group.truncated,
      };
    });
  });
}
function moneyValues(text: string): string[] {
  return [...text.matchAll(/-?\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g)].map(([value]) =>
    value.replace(/[$,]/g, ''),
  );
}
function evidenceMoney(value: unknown): string {
  requireEvidence(typeof value === 'string', 'MISSING_DISPLAY_VALUE');
  const amounts = moneyValues(value);
  requireEvidence(amounts.length === 1, 'UNRECOGNIZED_DISPLAY_VALUE');
  displayValue(value, 'USD', amounts[0]);
  return amounts[0];
}
type Fraction = { n: bigint; d: bigint };
function fraction(n: bigint, d = 1n): Fraction {
  requireEvidence(d !== 0n, 'ZERO_DIVISOR');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let x = n < 0n ? -n : n,
    y = d;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return { n: n / x, d: d / x };
}
function numberFraction(value: string) {
  decimal(value);
  const [whole, places = ''] = value.replace('-', '').split('.');
  return fraction(BigInt(whole + places) * (value.startsWith('-') ? -1n : 1n), 10n ** BigInt(places.length));
}
function arithmetic(op: FormulaOperation, a: Fraction, b: Fraction) {
  if (op === 'add' || op === 'subtract')
    return fraction(a.n * b.d + (op === 'add' ? 1n : -1n) * b.n * a.d, a.d * b.d);
  return op === 'multiply' ? fraction(a.n * b.n, a.d * b.d) : fraction(a.n * b.d, a.d * b.n);
}
type FormulaOperation = 'add' | 'subtract' | 'multiply' | 'divide';
type Polynomial = Map<string, bigint>;
type Symbolic = { n: Polynomial; d: Polynomial };
const one = () => new Map([['[]', 1n]]);
const symbol = (key: string): Symbolic => ({ n: new Map([[JSON.stringify([key]), 1n]]), d: one() });
function plus(a: Polynomial, b: Polynomial, sign = 1n) {
  const out = new Map(a);
  for (const [key, value] of b) out.set(key, (out.get(key) ?? 0n) + sign * value);
  return new Map([...out].filter(([, value]) => value !== 0n));
}
function times(a: Polynomial, b: Polynomial) {
  requireEvidence(a.size * b.size <= 4096, 'FORMULA_TOO_LARGE');
  const out: Polynomial = new Map();
  for (const [ak, av] of a)
    for (const [bk, bv] of b) {
      const key = JSON.stringify([...JSON.parse(ak), ...JSON.parse(bk)].sort());
      out.set(key, (out.get(key) ?? 0n) + av * bv);
    }
  return new Map([...out].filter(([, value]) => value !== 0n));
}
function symbolic(op: FormulaOperation, a: Symbolic, b: Symbolic): Symbolic {
  if (op === 'add' || op === 'subtract')
    return { n: plus(times(a.n, b.d), times(b.n, a.d), op === 'add' ? 1n : -1n), d: times(a.d, b.d) };
  return op === 'multiply'
    ? { n: times(a.n, b.n), d: times(a.d, b.d) }
    : { n: times(a.n, b.d), d: times(a.d, b.n) };
}
const polySignature = (p: Polynomial) =>
  JSON.stringify([...p].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, String(v)]));
const sameFormula = (a: Symbolic, b: Symbolic) =>
  polySignature(times(a.n, b.d)) === polySignature(times(b.n, a.d));
function ledgerSymbol(claim: Extract<ExpectedClaim, { kind: 'ledger' }>, ctx: ScoringContext): Symbolic {
  const scope = canonicalScope(claim.metric, claim.scope, ctx);
  const metric = economicMetric(claim.metric, claim.scope, ctx);
  const additive =
    [
      'net_expense',
      'net_revenue',
      'net_profit',
      'cash_balance',
      'account_balance',
      'net_cash_movement',
    ].includes(metric) &&
    scope.minimumAmount === null &&
    scope.maximumAmount === null &&
    !scope.entryId &&
    !scope.averageDenominator;
  if (additive && scope.accountCodes.length > 1) {
    return scope.accountCodes
      .map((code) =>
        symbol(JSON.stringify({ metric, unit: claim.unit, scope: { ...scope, accountCodes: [code] } })),
      )
      .reduce((a, b) => symbolic('add', a, b));
  }
  return symbol(JSON.stringify({ metric, unit: claim.unit, scope }));
}
type Assumption = { value: string; unit: string; sourceText: string };
function assumptionSymbol(a: Assumption, messages: ModelMessages) {
  const proof = scenarioAssumptionQuantityEvidence({ id: 'oracle_assumption', ...a }, messages);
  return symbol(
    JSON.stringify({
      assumption: {
        value: decimal(a.value).toString(),
        unit: a.unit,
        messageIndex: proof.userMessageIndex,
        quantityStart: proof.quantityStart,
        quantityEnd: proof.quantityEnd,
      },
    }),
  );
}
function atomsOf(
  expr: Formula,
  catalog: ExpectedClaim[],
  ctx: ScoringContext,
  messages: ModelMessages,
  seen = new Set<string>(),
): string[] {
  if ('claim' in expr) {
    const c = catalog.find((x) => x.id === expr.claim);
    requireEvidence(c && !seen.has(c.id), 'INVALID_ORACLE_FORMULA');
    return c.kind === 'ledger'
      ? atomKeys(ledgerSymbol(c, ctx))
      : atomsOf(c.formula, catalog, ctx, messages, new Set([...seen, c.id]));
  }
  if ('operation' in expr)
    return sorted(expr.operands.flatMap((x) => atomsOf(x, catalog, ctx, messages, seen)));
  return atomKeys(expectedFormula(expr, catalog, ctx, messages));
}
function atomKeys(expression: Symbolic): string[] {
  return sorted([...expression.n.keys(), ...expression.d.keys()].flatMap((k) => JSON.parse(k) as string[]));
}
function expectedFormula(
  expr: Formula,
  catalog: ExpectedClaim[],
  ctx: ScoringContext,
  messages: ModelMessages,
  stack = new Set<string>(),
): Symbolic {
  if ('claim' in expr) {
    const claim = catalog.find((c) => c.id === expr.claim);
    requireEvidence(claim && !stack.has(claim.id), 'INVALID_ORACLE_FORMULA');
    return claim.kind === 'ledger'
      ? ledgerSymbol(claim, ctx)
      : expectedFormula(claim.formula, catalog, ctx, messages, new Set([...stack, claim.id]));
  }
  if ('assumption' in expr) return assumptionSymbol(expr.assumption, messages);
  if ('calendarMonths' in expr)
    return symbol(
      JSON.stringify({
        calendarMonths: canonicalScope(expr.calendarMonths.metric, expr.calendarMonths.scope, ctx),
        metric: expr.calendarMonths.metric,
      }),
    );
  return symbolic(
    expr.operation,
    expectedFormula(expr.operands[0], catalog, ctx, messages, stack),
    expectedFormula(expr.operands[1], catalog, ctx, messages, stack),
  );
}
type Computed = {
  exact: Fraction;
  expression: Symbolic;
  source: 'posted' | 'draft' | 'scenario';
  unit: string;
  queryRefs: { id: string; rowId: string | null; field: string }[];
  assumptionIds: string[];
  atoms: string[];
};
const uniqueRefs = <T>(rows: T[]) => [...new Map(rows.map((row) => [JSON.stringify(row), row])).values()];
const setEqual = (a: unknown[], b: unknown[]) => equal(a.map(canonical).sort(), b.map(canonical).sort());
function computedUnit(op: FormulaOperation, a: string, b: string) {
  if (op === 'add' || op === 'subtract') {
    requireEvidence(a === b, 'CALCULATION_UNIT_MISMATCH');
    return a;
  }
  if (op === 'multiply') {
    if (a === 'ratio') return b;
    if (b === 'ratio') return a;
    if ((a === 'USD_per_month' && b === 'months') || (b === 'USD_per_month' && a === 'months')) return 'USD';
    if (a === 'count' && ['USD', 'USD_per_month', 'months'].includes(b)) return b;
    if (b === 'count' && ['USD', 'USD_per_month', 'months'].includes(a)) return a;
  } else {
    if (a === b) return 'ratio';
    if (b === 'ratio') return a;
    if (a === 'USD' && b === 'months') return 'USD_per_month';
    if (a === 'USD' && b === 'USD_per_month') return 'months';
  }
  throw new InvalidEvidence('CALCULATION_UNIT_MISMATCH');
}
function rounded(value: Fraction, unit: string) {
  const digits = ['USD', 'USD_per_month'].includes(unit) ? 2 : 6;
  const sign = value.n < 0n ? -1n : 1n,
    numerator = value.n * sign * 10n ** BigInt(digits);
  const whole = numerator / value.d + ((numerator % value.d) * 2n >= value.d ? 1n : 0n);
  const text = whole.toString().padStart(digits + 1, '0');
  return `${sign < 0n ? '-' : ''}${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

class UngradableEvidence extends Error {}
function referenceChecked(claim: LedgerClaim, ctx: ScoringContext) {
  const scope = claim.scope;
  const normalized: LedgerClaim = {
    ...claim,
    scope: {
      ...scope,
      accountCodes: accountsFor(claim.metric, scope, ctx),
      cooccurringAccountCodes: scope.cooccurringAccountCodes.length
        ? accountsFor(
            'journal_count',
            { ...scope, accountCodes: scope.cooccurringAccountCodes, currencyMode: 'base', currency: null },
            ctx,
          )
        : [],
      ...(scope.minimumAmount !== null || scope.maximumAmount !== null
        ? {
            amountThresholdAccountCodes: accountsFor(
              claim.metric,
              { ...scope, accountCodes: scope.amountThresholdAccountCodes ?? scope.accountCodes },
              ctx,
            ),
          }
        : {}),
    },
  };
  const result = ctx.referenceLedgerClaim(normalized);
  if (result.status === 'unsupported') throw new UngradableEvidence('ORACLE_UNSUPPORTED_SCOPE');
  requireEvidence(
    result.status === 'verified' && sameNumber(result.value, claim.value),
    'INCORRECT_LEDGER_VALUE',
  );
  return result;
}
function calendarValue(group: AnalysisFacts) {
  const p = group.scope.plan;
  requireEvidence(
    group.grain === 'month' &&
      !group.truncated &&
      p.aggregation === 'sum' &&
      ['net_expense', 'net_revenue', 'net_profit', 'net_cash_movement'].includes(p.metric) &&
      p.from?.endsWith('-01'),
    'INVALID_CALENDAR_SERIES',
  );
  const end = new Date(`${p.to}T00:00:00Z`);
  const after = new Date(end);
  after.setUTCDate(after.getUTCDate() + 1);
  requireEvidence(after.getUTCDate() === 1, 'INCOMPLETE_CALENDAR_SERIES');
  const months: string[] = [];
  const cursor = new Date(`${p.from}T00:00:00Z`);
  while (cursor <= end && months.length <= 120) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  requireEvidence(
    months.length > 0 &&
      months.length <= 120 &&
      equal(sorted(group.rows.map((r) => r.rowId)), months.map((m) => `month:${m}`).sort()),
    'INCOMPLETE_CALENDAR_SERIES',
  );
  return String(months.length);
}
function verifyCalculations(
  calculations: ScenarioCalculationFact[],
  claims: LedgerClaim[],
  groups: AnalysisFacts[],
  item: CompletenessCase,
  ctx: ScoringContext,
) {
  const computed = new Map<string, Computed>();
  const assumptionProofs = new Map<string, string>();
  for (const c of calculations) {
    requireEvidence(!computed.has(c.id) && c.operands.length === 2, 'DUPLICATE_OR_INVALID_CALCULATION');
    const operands = c.operands.map((ref): Computed => {
      if (ref.source === 'calculation') {
        const prior = computed.get(ref.id);
        requireEvidence(prior && ref.rowId === null && ref.field === 'value', 'INVALID_CALCULATION_ORDER');
        return prior;
      }
      if (ref.source === 'assumption') {
        const matching = c.assumptions.filter((a) => a.id === ref.id);
        requireEvidence(
          matching.length === 1 && ref.rowId === null && ref.field === 'value',
          'INVALID_ASSUMPTION_REFERENCE',
        );
        const a = matching[0];
        let proof: ReturnType<typeof scenarioAssumptionQuantityEvidence>;
        try {
          proof = scenarioAssumptionQuantityEvidence(
            { id: a.id, value: a.value, unit: a.unit, sourceText: a.sourceText },
            item.messages,
          );
        } catch {
          throw new InvalidEvidence('UNSOURCED_ASSUMPTION');
        }
        requireEvidence(
          proof.userMessageIndex === a.userMessageIndex &&
            proof.sourceStart === a.sourceStart &&
            proof.sourceEnd === a.sourceEnd &&
            proof.sourceText === a.sourceText,
          'UNSOURCED_ASSUMPTION',
        );
        const previous = assumptionProofs.get(a.id);
        requireEvidence(
          previous === undefined || previous === canonical(a),
          'INCONSISTENT_ASSUMPTION_EVIDENCE',
        );
        assumptionProofs.set(a.id, canonical(a));
        const expression = assumptionSymbol(a, item.messages);
        return {
          exact: numberFraction(a.value),
          expression,
          source: 'scenario',
          unit: a.unit,
          queryRefs: [],
          assumptionIds: [a.id],
          atoms: atomKeys(expression),
        };
      }
      const group = groups.find((g) => g.queryId === ref.id);
      if (ref.field === 'month_count') {
        requireEvidence(group && ref.rowId === null, 'INVALID_CALENDAR_REFERENCE');
        const value = calendarValue(group);
        const scope = {
          ...defaultScope(group.scope.plan.from, group.scope.plan.to),
          ...group.scope.plan,
          asOf: null,
        };
        const expression = symbol(
          JSON.stringify({ calendarMonths: canonicalScope(group.metric, scope, ctx), metric: group.metric }),
        );
        return {
          exact: numberFraction(value),
          expression,
          source: group.scope.plan.status === 'DRAFT' ? 'draft' : 'posted',
          unit: 'months',
          queryRefs: [{ id: ref.id, rowId: null, field: 'month_count' }],
          assumptionIds: [],
          atoms: atomKeys(expression),
        };
      }
      requireEvidence(ref.field === 'value', 'UNKNOWN_OPERAND_FIELD');
      const claim = claims.find((v) => v.queryId === ref.id && v.rowId === ref.rowId);
      requireEvidence(claim && !claim.truncated, 'MISSING_OR_TRUNCATED_OPERAND');
      referenceChecked(claim, ctx);
      requireEvidence(
        !claim.metric.endsWith('_average_per_entry') &&
          claim.metric !== 'account_balance' &&
          ['USD', 'count'].includes(claim.unit),
        'UNSUPPORTED_CALCULATION_OPERAND',
      );
      const expression = ledgerSymbol(claim, ctx);
      return {
        exact: numberFraction(claim.value),
        expression,
        source: claim.scope.status === 'DRAFT' ? 'draft' : 'posted',
        unit: claim.unit,
        queryRefs: [{ id: ref.id, rowId: ref.rowId, field: 'value' }],
        assumptionIds: [],
        atoms: atomKeys(expression),
      };
    });
    const [a, b] = operands,
      exact = arithmetic(c.operation, a.exact, b.exact),
      expression = symbolic(c.operation, a.expression, b.expression),
      unit = computedUnit(c.operation, a.unit, b.unit);
    const source =
      a.source === 'scenario' || b.source === 'scenario'
        ? 'scenario'
        : a.source === 'draft' || b.source === 'draft'
          ? 'draft'
          : 'posted';
    const queryRefs = uniqueRefs([...a.queryRefs, ...b.queryRefs]),
      assumptionIds = sorted([...a.assumptionIds, ...b.assumptionIds]);
    requireEvidence(
      c.unit === unit && c.source === source && c.hypothetical === (source !== 'posted'),
      'CALCULATION_SOURCE_MISMATCH',
    );
    requireEvidence(
      BigInt(c.exact.numerator) * exact.d === exact.n * BigInt(c.exact.denominator) &&
        BigInt(c.exact.denominator) > 0n &&
        sameNumber(c.value, rounded(exact, unit)),
      'INCORRECT_CALCULATION_VALUE',
    );
    requireEvidence(
      setEqual(c.provenance.queryRows, queryRefs) && equal(sorted(c.provenance.assumptionIds), assumptionIds),
      'CALCULATION_ANCESTRY_MISMATCH',
    );
    requireEvidence(
      c.assumptions.length === assumptionIds.length &&
        equal(sorted(c.assumptions.map((v) => v.id)), assumptionIds) &&
        c.assumptions.every((v) => assumptionProofs.get(v.id) === canonical(v)),
      'INCONSISTENT_ASSUMPTION_EVIDENCE',
    );
    for (const [metric, field] of [
      ['cash_balance', 'cashSources'],
      ['net_cash_movement', 'cashMovementSources'],
    ] as const) {
      const expected = queryRefs.flatMap((ref) => {
        const claim = claims.find((v) => v.queryId === ref.id && v.rowId === ref.rowId);
        if (claim?.metric !== metric) return [];
        return [
          {
            queryId: ref.id,
            rowId: ref.rowId,
            ...(metric === 'cash_balance'
              ? { asOf: claim.scope.asOf }
              : { from: claim.scope.from, to: claim.scope.to }),
            accountIds: accountsFor(metric, claim.scope, ctx)
              .map((code) => ctx.chart.find((v) => v.code === code)!.id)
              .sort(),
          },
        ];
      });
      requireEvidence(
        c[field] &&
          setEqual(
            c[field].map((v) => ({ ...v, accountIds: [...v.accountIds].sort() })),
            expected,
          ),
        'CASH_ANCESTRY_MISMATCH',
      );
    }
    computed.set(c.id, {
      exact,
      expression,
      source,
      unit,
      queryRefs,
      assumptionIds,
      atoms: sorted([...a.atoms, ...b.atoms]),
    });
  }
  return computed;
}
function displayValue(text: unknown, unit: string, value: string) {
  requireEvidence(typeof text === 'string', 'MISSING_DISPLAY_VALUE');
  if (['count', 'ratio', 'months'].includes(unit)) {
    const m = new RegExp(`^(-?\\d+(?:\\.\\d+)?)(?: ${unit})?$`).exec(text);
    requireEvidence(m && sameNumber(m[1], value), 'DISPLAY_VALUE_MISMATCH');
    return;
  }
  const currency = unit.replace('_per_month', '');
  requireEvidence(['USD', 'EUR', 'GBP', 'CAD', 'JPY'].includes(currency), 'DISPLAY_CURRENCY_UNRECOGNIZED');
  const rendered = formatCurrency(value, currency);
  const permitted = unit === 'USD_per_month' ? [`${rendered}/month`] : [rendered, `${rendered} ${currency}`];
  requireEvidence(permitted.includes(text), 'DISPLAY_VALUE_MISMATCH');
}
type VisibleTable = { keys: string[]; complete: boolean; order: string; limit: number; tableIndex: number };
type Visibility = { ledger: Set<string>; calculations: Set<string>; tables: VisibleTable[] };
const claimKey = (c: Pick<LedgerClaim, 'queryId' | 'rowId'>) => JSON.stringify([c.queryId, c.rowId]);
function rowLabel(group: AnalysisFacts, row: AnalysisFacts['rows'][number]) {
  const dims = Array.isArray(group.grain) ? group.grain : [group.grain];
  const period = dims.includes('month') || dims.includes('quarter');
  const stock = ['cash_balance', 'account_balance'].includes(group.metric);
  return (
    row.label +
    (row.from && period
      ? stock
        ? ` · closing balance as of ${row.to}`
        : ` · ${row.from} to ${row.to}`
      : '') +
    (group.aggregation === 'average_per_entry' ? ` · ${row.entryCount} matching transactions` : '')
  );
}
function visibleReferences(
  response: Json,
  groups: AnalysisFacts[],
  calculations: ScenarioCalculationFact[],
  claims: LedgerClaim[],
  item: CompletenessCase,
): Visibility {
  const visible: Visibility = { ledger: new Set(), calculations: new Set(), tables: [] };
  for (const [tableIndex, table] of (response.evidence as Json[]).entries()) {
    requireEvidence(Array.isArray(table.rows), 'MALFORMED_EVIDENCE_TABLE');
    const keys: string[] = [];
    if (table.factSource) {
      const g = groups.find((g) => g.queryId === table.factSource.queryId);
      requireEvidence(
        g && table.factSource.kind === 'query_result' && table.factSource.truncated === g.truncated,
        'INVALID_TABLE_REFERENCE',
      );
    }
    for (const row of table.rows) {
      if (!row.factRef) throw new UngradableEvidence('UNLINKED_FINANCIAL_ROW');
      const ref = row.factRef;
      if (ref.kind === 'query_row') {
        const group = groups.find((g) => g.queryId === ref.queryId),
          claim = claims.find((c) => c.queryId === ref.queryId && c.rowId === ref.rowId),
          sourceRow = group?.rows.find((r) => r.rowId === ref.rowId);
        requireEvidence(group && claim && sourceRow, 'INVALID_VISIBLE_QUERY_REFERENCE');
        requireEvidence(
          !table.factSource || table.factSource.queryId === ref.queryId,
          'TABLE_ROW_REFERENCE_MISMATCH',
        );
        requireEvidence(
          table.source === (group.scope.plan.status === 'DRAFT' ? 'draft' : 'posted'),
          'DISPLAY_STATUS_MISMATCH',
        );
        requireEvidence(row.label === rowLabel(group, sourceRow), 'DISPLAY_ROW_SCOPE_MISMATCH');
        displayValue(row.value, claim.unit, claim.value);
        const key = claimKey(claim);
        visible.ledger.add(key);
        keys.push(key);
      } else if (ref.kind === 'calculation') {
        const c = calculations.find((c) => c.id === ref.calculationId);
        requireEvidence(c, 'INVALID_VISIBLE_CALCULATION_REFERENCE');
        requireEvidence(table.source === c.source, 'DISPLAY_STATUS_MISMATCH');
        displayValue(row.value, c.unit, c.value);
        visible.calculations.add(c.id);
      } else if (ref.kind === 'assumption') {
        const possibilities = calculations.flatMap((c) =>
          c.assumptions.filter((a) => a.id === ref.assumptionId),
        );
        const raw =
          possibilities[0] ?? response.query?.args?.assumptions?.find((v: Json) => v.id === ref.assumptionId);
        if (!raw) throw new UngradableEvidence('UNLINKED_UNUSED_ASSUMPTION');
        let proof: ReturnType<typeof scenarioAssumptionQuantityEvidence>;
        try {
          proof = scenarioAssumptionQuantityEvidence(
            { id: raw.id, value: raw.value, unit: raw.unit, sourceText: raw.sourceText },
            item.messages,
          );
        } catch {
          throw new InvalidEvidence('UNSOURCED_ASSUMPTION');
        }
        requireEvidence(
          possibilities.every((v) => equal(v, possibilities[0])) && table.source === 'scenario',
          'DISPLAY_ASSUMPTION_MISMATCH',
        );
        requireEvidence(
          new RegExp('^Assumption [1-9]\\d*: ').test(row.label) &&
            row.label.endsWith(`: “${proof.sourceText}”`),
          'DISPLAY_ASSUMPTION_QUOTE',
        );
        displayValue(row.value, raw.unit, raw.value);
      } else throw new UngradableEvidence('UNKNOWN_EVIDENCE_REFERENCE');
    }
    if (table.factSource) {
      const group = groups.find((g) => g.queryId === table.factSource.queryId)!;
      const all = group.rows.map((r) => JSON.stringify([group.queryId, r.rowId]));
      visible.tables.push({
        keys,
        complete: !group.truncated && setEqual(keys, all),
        order: group.scope.plan.order,
        limit: group.scope.plan.limit,
        tableIndex,
      });
    }
  }
  return visible;
}

type NormalizedAnswer = {
  groups: AnalysisFacts[];
  claims: LedgerClaim[];
  calculations: ScenarioCalculationFact[];
  visibility: Visibility;
  headlineKeys: string[];
  headlineCalculations: string[];
};
function narrowAnswer(response: Json, ctx: ScoringContext): NormalizedAnswer {
  const name = response.query?.name;
  if (
    ![
      'income_summary',
      'expense_summary',
      'expense_by_account',
      'cash_position',
      'period_comparison',
      'revenue_comparison',
      'find_transactions',
    ].includes(name)
  )
    throw new UngradableEvidence('UNSUPPORTED_LEGACY_TOOL');
  const args = object(parseInsightArgs(name, response.query.args));
  if (name === 'expense_summary' && args.view === undefined) args.view = 'top';
  requireEvidence(
    Array.isArray(response.evidence) &&
      response.evidence.length === 1 &&
      Array.isArray(response.evidence[0].rows),
    'LEGACY_EVIDENCE_SHAPE',
  );
  const table = response.evidence[0],
    rows = table.rows as Json[],
    claims: LedgerClaim[] = [],
    calculations: ScenarioCalculationFact[] = [],
    visibility: Visibility = { ledger: new Set(), calculations: new Set(), tables: [] },
    headlineKeys: string[] = [],
    headlineCalculations: string[] = [];
  const scope = defaultScope(args.from ?? null, args.to ?? null);
  const add = (metric: string, value: string, s: ExpectedScope, rowId: string) => {
    const c: LedgerClaim = {
      id: rowId,
      kind: 'ledger',
      metric,
      value,
      unit: 'USD',
      scope: structuredClone(s),
      queryId: 'legacy',
      rowId,
      truncated: false,
    };
    claims.push(c);
    visibility.ledger.add(claimKey(c));
    return c;
  };
  const period =
    scope.from === '0001-01-01' ? `All recorded history through ${scope.to}` : `${scope.from} → ${scope.to}`;
  const labels: Record<string, string> = { revenue: 'Revenue', expenses: 'Expenses', profit: 'Net profit' };
  if (name === 'income_summary' || (name === 'expense_summary' && args.view === 'total')) {
    const label = name === 'expense_summary' ? 'Net recorded expenses (USD)' : labels[args.metric];
    requireEvidence(
      rows.length === 1 && rows[0].label === label && table.period === period,
      'LEGACY_LABEL_SCOPE_MISMATCH',
    );
    const c = add(
      name === 'expense_summary'
        ? 'net_expense'
        : `net_${args.metric === 'expenses' ? 'expense' : args.metric}`,
      evidenceMoney(rows[0].value),
      scope,
      'total',
    );
    const money = moneyValues(response.answer);
    requireEvidence(money.length === 1 && sameNumber(money[0], c.value), 'LEGACY_HEADLINE_VALUE');
    headlineKeys.push(claimKey(c));
  } else if (['cash_position', 'expense_by_account', 'expense_summary'].includes(name)) {
    const metric = name === 'cash_position' ? 'cash_balance' : 'net_expense';
    if (metric === 'cash_balance') {
      scope.from = null;
      scope.to = null;
      scope.asOf = args.asOf;
    }
    if (name === 'expense_by_account') scope.accountCodes = [args.accountCode];
    const money = moneyValues(response.answer);
    requireEvidence(money.length === 1, 'LEGACY_HEADLINE_VALUE');
    const total = add(metric, money[0], scope, 'total');
    headlineKeys.push(claimKey(total));
    requireEvidence(
      table.period === (metric === 'cash_balance' ? `As of ${args.asOf}` : period),
      'LEGACY_PERIOD_MISMATCH',
    );
    const rowKeys: string[] = [];
    const accountIds = new Set<string>();
    for (const row of rows) {
      const url = new URL(row.href, 'https://fixture.invalid'),
        id = url.searchParams.get('account'),
        account = ctx.chart.find((a) => a.id === id);
      requireEvidence(
        account &&
          !accountIds.has(account.id) &&
          accountsFor(metric, scope, ctx).includes(account.code) &&
          row.label === account.name,
        'LEGACY_ACCOUNT_SCOPE',
      );
      accountIds.add(account.id);
      requireEvidence(
        url.searchParams.get('from') === (metric === 'cash_balance' ? '0001-01-01' : scope.from) &&
          url.searchParams.get('to') === (metric === 'cash_balance' ? args.asOf : scope.to),
        'LEGACY_LINK_PERIOD',
      );
      rowKeys.push(
        claimKey(
          add(
            metric,
            evidenceMoney(row.value),
            { ...scope, accountCodes: [account.code] },
            `account:${account.id}`,
          ),
        ),
      );
    }
    const all = name !== 'expense_summary' || args.view === 'all';
    if (all)
      requireEvidence(
        new Decimal(0)
          .plus(claims.slice(1).reduce((n, c) => n.plus(c.value), new Decimal(0)))
          .eq(total.value),
        'LEGACY_TOTAL_MISMATCH',
      );
    visibility.tables.push({
      keys: rowKeys,
      complete: all,
      order: args.view === 'top' ? 'value_desc' : 'label_asc',
      limit: args.view === 'top' ? (args.limit ?? 5) : rows.length,
      tableIndex: 0,
    });
  } else if (name === 'find_transactions') {
    requireEvidence(table.period === period && rows.length <= 20, 'LEGACY_SEARCH_SCOPE');
    const keys: string[] = [];
    for (const row of rows) {
      const url = new URL(row.href, 'https://fixture.invalid'),
        id = url.searchParams.get('entry');
      requireEvidence(id && url.pathname === '/transactions', 'LEGACY_ENTRY_ID');
      const c = add(
        'journal_total',
        evidenceMoney(row.value),
        { ...scope, entryId: id, searchText: args.search },
        `entry:${id}`,
      );
      const proof = referenceChecked(c, ctx);
      if (!proof.entry) throw new UngradableEvidence('LEGACY_ENTRY_LABEL_UNPROVEN');
      requireEvidence(row.label === `${proof.entry.date} · ${proof.entry.description}`, 'LEGACY_ENTRY_LABEL');
      keys.push(claimKey(c));
    }
    const expected = rows.length
      ? `I found ${rows.length}${response.answer.includes(' or more') ? ' or more' : ''} posted entries matching “${args.search}” in this period. The amounts below are journal totals, not necessarily revenue or cash movements.`
      : `No posted entries match “${args.search}” in this period.`;
    requireEvidence(response.answer === expected, 'LEGACY_SEARCH_HEADLINE');
    visibility.tables.push({
      keys,
      complete: !response.answer.includes(' or more'),
      order: 'label_asc',
      limit: 20,
      tableIndex: 0,
    });
  } else {
    requireEvidence(rows.length === 2, 'LEGACY_COMPARISON_SHAPE');
    const metric =
      name === 'revenue_comparison'
        ? 'net_revenue'
        : `net_${args.metric === 'expenses' ? 'expense' : args.metric}`;
    const current = rows.find((r) => r.label === `${args.from} – ${args.to}`),
      prior = rows.find((r) => r.label === `${args.previousFrom} – ${args.previousTo}`);
    requireEvidence(current && prior && current !== prior, 'LEGACY_COMPARISON_PERIODS');
    const now = add(metric, evidenceMoney(current.value), scope, 'current'),
      before = add(
        metric,
        evidenceMoney(prior.value),
        { ...scope, from: args.previousFrom, to: args.previousTo },
        'previous',
      );
    const money = moneyValues(response.answer);
    requireEvidence(
      money.length === 3 && sameNumber(money[0], now.value) && sameNumber(money[1], before.value),
      'LEGACY_COMPARISON_HEADLINE',
    );
    const delta = arithmetic('subtract', numberFraction(now.value), numberFraction(before.value));
    requireEvidence(sameNumber(money[2], rounded(delta, 'USD')), 'LEGACY_COMPARISON_DIFFERENCE');
    const refs = [now, before].map((c) => ({
      source: 'query' as const,
      id: 'legacy',
      rowId: c.rowId,
      field: 'value' as const,
    }));
    calculations.push({
      kind: 'scenario_calculation',
      id: 'legacy_delta',
      operation: 'subtract',
      operands: refs,
      value: rounded(delta, 'USD'),
      unit: 'USD',
      hypothetical: false,
      source: 'posted',
      exact: { numerator: String(delta.n), denominator: String(delta.d) },
      assumptions: [],
      provenance: {
        assumptionIds: [],
        queryRows: refs.map(({ id, rowId, field }) => ({ id, rowId, field })),
      },
      cashSources: [],
      cashMovementSources: [],
    });
    visibility.calculations.add('legacy_delta');
    const percent = [...response.answer.matchAll(/(-?\d+(?:\.\d+)?)%/g)];
    if (decimal(before.value).gt(0)) {
      requireEvidence(
        percent.length === 1 &&
          sameNumber(
            percent[0][1],
            decimal(now.value).minus(before.value).div(before.value).times(100).toFixed(1),
          ),
        'LEGACY_COMPARISON_PERCENT',
      );
      const ratio = arithmetic('divide', delta, numberFraction(before.value));
      calculations.push({
        kind: 'scenario_calculation',
        id: 'legacy_relative',
        operation: 'divide',
        operands: [{ source: 'calculation', id: 'legacy_delta', rowId: null, field: 'value' }, refs[1]],
        value: rounded(ratio, 'ratio'),
        unit: 'ratio',
        hypothetical: false,
        source: 'posted',
        exact: { numerator: String(ratio.n), denominator: String(ratio.d) },
        assumptions: [],
        provenance: {
          assumptionIds: [],
          queryRows: refs.map(({ id, rowId, field }) => ({ id, rowId, field })),
        },
        cashSources: [],
        cashMovementSources: [],
      });
      visibility.calculations.add('legacy_relative');
    } else requireEvidence(percent.length === 0, 'LEGACY_COMPARISON_PERCENT');
    headlineKeys.push(claimKey(now));
  }
  if (name !== 'find_transactions') {
    const range =
      args.from === '0001-01-01'
        ? `across all recorded history through ${args.to}`
        : `from ${args.from} to ${args.to}`;
    const first = claims[0];
    let expected: string;
    const totalExpenses = `Your net recorded expenses ${range} were ${formatCurrency(first.value)} USD. Posted credits and reversals are included in this total.`;
    if (name === 'income_summary')
      expected = `Recorded ${labels[args.metric].toLowerCase()} ${range} totaled ${formatCurrency(first.value)} USD.`;
    else if (name === 'expense_summary')
      expected =
        args.view === 'total'
          ? totalExpenses
          : `${totalExpenses} ${args.view === 'all' ? 'Here are all expense posting accounts, including zero balances and archived accounts.' : rows.length ? `Here are the ${rows.length} largest expense categories with posted activity.` : 'There are no posted expenses in this period.'}`;
    else if (name === 'cash_position')
      expected = `Your cash and bank book balance as of ${args.asOf} is ${formatCurrency(first.value)} USD. Foreign balances use the exchange rates recorded in your journal.`;
    else if (name === 'expense_by_account') {
      const account = ctx.chart.find((a) => a.code === args.accountCode);
      requireEvidence(account, 'LEGACY_ACCOUNT_SCOPE');
      expected = `You recorded ${formatCurrency(first.value)} USD in ${account.name} expenses${account.is_group ? ' (including its subaccounts)' : ''} ${range}. Posted credits and reversals are included in this total.`;
    } else {
      const current = claims.find((c) => c.rowId === 'current')!,
        previous = claims.find((c) => c.rowId === 'previous')!,
        metric = name === 'revenue_comparison' ? 'revenue' : args.metric,
        label = labels[metric],
        delta = decimal(current.value).minus(previous.value),
        baseline = decimal(previous.value);
      const change = baseline.gt(0)
        ? `${delta.div(baseline).times(100).toFixed(1)}%`
        : `not meaningful because prior ${label.toLowerCase()} is zero or negative`;
      expected = `${label} was ${formatCurrency(current.value)}, compared with ${formatCurrency(previous.value)} in the prior period. The difference is ${formatCurrency(delta.toFixed(2))}; percentage change is ${change}.`;
    }
    if (response.answer !== expected) throw new UngradableEvidence('UNKNOWN_LEGACY_PROSE_TEMPLATE');
  }
  if (!visibility.tables.length)
    visibility.tables.push({
      keys: claims.map(claimKey),
      complete: true,
      order: 'label_asc',
      limit: rows.length,
      tableIndex: 0,
    });
  return { groups: [], claims, calculations, visibility, headlineKeys, headlineCalculations };
}

function presentation(exact: Fraction, unit: string) {
  const value = rounded(exact, unit);
  const normalized = ['USD', 'USD_per_month'].includes(unit) ? value : value.replace(/\.?0+$/, '');
  return unit === 'USD'
    ? `${formatCurrency(value)} USD`
    : unit === 'USD_per_month'
      ? `${formatCurrency(value)}/month`
      : `${normalized} ${unit}`;
}
function originalAnalysisAnswer(groups: AnalysisFacts[], ctx: ScoringContext) {
  const metrics: Record<string, string> = {
    net_expense: 'Net expenses',
    net_revenue: 'Net revenue',
    net_profit: 'Net profit',
    account_balance: 'Account balance',
    cash_balance: 'Cash and bank book balance',
    net_cash_movement: 'Net cash and bank movement',
    journal_total: 'Transaction totals',
    journal_count: 'Number of transactions',
  };
  return groups
    .map((group) => {
      const plan = group.scope.plan,
        grain = Array.isArray(plan.groupBy) ? plan.groupBy : [plan.groupBy],
        period = grain.includes('month') || grain.includes('quarter'),
        stock = ['cash_balance', 'account_balance'].includes(plan.metric),
        currency = plan.currencyMode === 'native' ? plan.currency! : 'USD';
      const heading = `${stock && period ? (plan.metric === 'cash_balance' ? 'Closing cash and bank balances' : 'Closing account balances') : metrics[plan.metric]}${plan.aggregation === 'average_per_entry' ? ' (average per transaction)' : ''}${plan.status === 'DRAFT' ? ' (drafts only)' : ''}${plan.currencyMode === 'native' ? ` (${currency}, without conversion)` : ''}`;
      const names = plan.accountCodes.map((code) => ctx.chart.find((a) => a.code === code)!.name),
        scope = [
          names.length
            ? `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` (+${names.length - 2} accounts)` : ''}`
            : '',
          plan.counterparty.mode !== 'any'
            ? `Counterparty ${plan.counterparty.mode === 'contains' ? 'containing ' : ''}${JSON.stringify(plan.counterparty.value)}`
            : '',
        ]
          .filter(Boolean)
          .join(' · ');
      const title = scope ? `${heading} · ${scope}` : heading,
        row = group.rows[0];
      const amount =
        !row || row.value === null
          ? 'No matching transactions'
          : plan.metric === 'journal_count'
            ? row.value
            : `${formatCurrency(row.value, currency)}${currency !== 'USD' ? ` ${currency}` : ''}`;
      const dates = plan.from
        ? plan.from === '0001-01-01'
          ? `All recorded history through ${plan.to}`
          : `${plan.from} to ${plan.to}`
        : `As of ${plan.to}`;
      return `${title}${plan.groupBy === 'total' ? `: ${amount}` : ''}. ${dates}. ${group.truncated ? `Showing ${plan.limit} results. There are more; these are not the complete results.` : `All ${group.rows.length} results are shown.`}`;
    })
    .join('\n\n');
}
function primaryFocus(response: Json, answer: NormalizedAnswer, ctx: ScoringContext) {
  if (response.answer === 'Here are the results, with their accounts, dates and sources.') return;
  if (
    response.answer.startsWith('I could only complete part of this request.') ||
    response.answer.startsWith("I couldn't verify")
  )
    return;
  if (!answer.groups.length && !answer.calculations.length) return;
  if (['period_comparison', 'revenue_comparison'].includes(response.query?.name)) return;
  if (answer.calculations.length) {
    const final = answer.calculations.at(-1)!,
      value = presentation(
        { n: BigInt(final.exact.numerator), d: BigInt(final.exact.denominator) },
        final.unit,
      );
    const expected =
      final.source === 'posted'
        ? `From the posted books, the calculated result is ${value}. This uses recorded amounts for the shown scopes.`
        : final.source === 'draft'
          ? `Using unposted drafts, the calculated result is ${value}. This is hypothetical and is not a posted book total.`
          : `Using these assumptions, the calculated result is ${value}. This is hypothetical, not a forecast or an affordability decision.`;
    if (response.answer !== expected) throw new UngradableEvidence('UNKNOWN_ANSWER_PROSE_TEMPLATE');
    answer.headlineCalculations.push(final.id);
    return;
  }
  if (response.answer !== originalAnalysisAnswer(answer.groups, ctx))
    throw new UngradableEvidence('UNKNOWN_ANSWER_PROSE_TEMPLATE');
  for (const group of answer.groups)
    if (group.grain === 'total' && group.rows[0])
      answer.headlineKeys.push(JSON.stringify([group.queryId, group.rows[0].rowId]));
}
function validateCalculationRows(response: Json, answer: NormalizedAnswer, computed: Map<string, Computed>) {
  if (['period_comparison', 'revenue_comparison'].includes(response.query?.name)) return;
  for (const table of response.evidence)
    for (const row of table.rows) {
      if (row.factRef?.kind !== 'calculation') continue;
      const c = answer.calculations.find((c) => c.id === row.factRef.calculationId)!;
      const operands = c.operands.map((ref) => {
        if (ref.source === 'calculation') {
          const v = computed.get(ref.id)!;
          return presentation(v.exact, v.unit);
        }
        if (ref.source === 'assumption') {
          const a = c.assumptions.find((a) => a.id === ref.id)!;
          return presentation(numberFraction(a.value), a.unit);
        }
        if (ref.field === 'month_count')
          return presentation(
            numberFraction(calendarValue(answer.groups.find((g) => g.queryId === ref.id)!)),
            'months',
          );
        const claim = answer.claims.find((c) => c.queryId === ref.id && c.rowId === ref.rowId)!;
        return presentation(numberFraction(claim.value), claim.unit);
      });
      const label = /^Calculation [1-9]\d*: (.*)$/.exec(row.label);
      requireEvidence(
        label &&
          label[1] ===
            `${operands[0]} ${{ add: '+', subtract: '−', multiply: '×', divide: '÷' }[c.operation]} ${operands[1]}`,
        'DISPLAY_CALCULATION_OPERANDS',
      );
    }
}
function formulaMatch(
  expected: ExpectedClaim,
  computed: Computed,
  catalog: ExpectedClaim[],
  item: CompletenessCase,
  ctx: ScoringContext,
  value: string,
) {
  const expression =
    expected.kind === 'ledger'
      ? ledgerSymbol(expected, ctx)
      : expectedFormula(expected.formula, catalog, ctx, item.messages);
  const atoms =
    expected.kind === 'ledger'
      ? atomKeys(expression)
      : atomsOf(expected.formula, catalog, ctx, item.messages);
  return (
    expected.unit === computed.unit &&
    sameNumber(expected.value, value) &&
    sameFormula(expression, computed.expression) &&
    equal(sorted(atoms), sorted(computed.atoms)) &&
    (expected.kind === 'ledger'
      ? computed.source === (expected.scope.status === 'DRAFT' ? 'draft' : 'posted')
      : computed.source === expected.source &&
        (!expected.exact ||
          BigInt(expected.exact.numerator) * computed.exact.d ===
            computed.exact.n * BigInt(expected.exact.denominator)))
  );
}
function tableMatches(
  expected: ExpectedTable,
  table: VisibleTable,
  matches: Map<string, string[]>,
  claims: LedgerClaim[],
) {
  const choices = [expected.claimIds, ...(expected.alternativeClaimIds ?? [])];
  const actual = table.keys.map((key) => matches.get(key) ?? []);
  if (expected.coverage === 'all' && !table.complete) return false;
  if (expected.coverage === 'top' && (table.limit !== expected.limit || table.order !== expected.order))
    return false;
  if (expected.order !== 'any') {
    const values = table.keys.map((key) => claims.find((c) => claimKey(c) === key)?.value);
    if (values.some((v) => v === undefined)) return false;
    for (let i = 1; i < values.length; i++)
      if (
        expected.order === 'value_desc'
          ? decimal(values[i - 1]!).lt(values[i]!)
          : decimal(values[i - 1]!).gt(values[i]!)
      )
        return false;
  }
  return choices.some(
    (ids) =>
      (expected.coverage === 'leading'
        ? ids.length <= actual.length && ids.every((id, i) => actual[i].includes(id))
        : ids.length === actual.length &&
          ids.every((id) => actual.some((accepted) => accepted.includes(id)))) &&
      new Set(table.keys).size === table.keys.length,
  );
}
/** Grades original-question requirements. Model-authored contracts/status are deliberately unused. */
export function scoreCompletenessResponse(
  item: CompletenessCase,
  outcome: CompletenessOutcome,
  context: ScoringContext,
): CompletenessScore {
  const score: CompletenessScore = {
    caseId: item.id,
    split: item.split,
    family: item.family,
    classification: 'execution-error',
    passed: false,
    reasons: [],
    requiredClaims: item.expected.required.length,
    matchedClaims: [],
    matchedTables: [],
    focusCorrect: false,
    primaryMatched: [],
    verifiedExtraClaims: 0,
    unverifiableExtraClaims: 0,
    wrongFinancialClaims: [],
    hardBoundaryViolations: [],
    modelCompletionIgnored: true,
    wordingReview: 'not_model_judged',
  };
  if (outcome.error || !outcome.response) {
    score.reasons = [outcome.error?.code ?? 'MISSING_RESPONSE'];
    return score;
  }
  try {
    const catalog = [...item.expected.required, ...item.expected.supporting];
    requireEvidence(new Set(catalog.map((c) => c.id)).size === catalog.length, 'DUPLICATE_ORACLE_CLAIM');
    const primary = item.expected.primaryClaimIds ?? item.expected.required.map((c) => c.id);
    requireEvidence(
      primary.every((id) => catalog.some((c) => c.id === id)),
      'INVALID_PRIMARY_ORACLE',
    );
    const response = object(outcome.response);
    requireEvidence(
      typeof response.answer === 'string' && Array.isArray(response.evidence),
      'MALFORMED_RESPONSE',
    );
    if (
      Array.isArray(response.facts) &&
      response.facts.some(
        (f: Json) =>
          f.scope?.organizationId !== undefined && f.scope.organizationId !== context.organizationId,
      )
    )
      score.hardBoundaryViolations.push('foreign_workspace');
    const name = response.query?.name,
      clarify = ['request_details', 'ask_clarification'].includes(name),
      hasData = response.evidence.some((t: Json) => t.rows?.length);
    if (clarify || (response.limitation && !hasData)) {
      requireEvidence(!hasData && !response.facts?.length, 'BOUNDARY_WITH_FINANCIAL_CLAIMS');
      score.classification = 'safe-no-answer';
      if (item.expected.behavior === 'ANSWER') {
        score.reasons = ['ANSWERABLE_COVERAGE_MISS'];
        return score;
      }
      const expected = item.expected.clarification;
      if (name !== 'request_details' || !expected) {
        score.classification = 'ungradable';
        score.reasons = ['BOUNDARY_PROSE_REQUIRES_REVIEW'];
        return score;
      }
      const args = object(parseInsightArgs(name, response.query.args));
      if (response.answer !== clarificationAnswer(args, context.chart))
        throw new UngradableEvidence('UNKNOWN_BOUNDARY_PROSE');
      if (name === 'expense_summary' && args.view === undefined) args.view = 'top';
      const correct =
        expected.reasons.includes(args.reason) &&
        (expected.subject === undefined || args.subject === expected.subject) &&
        (expected.limitation === undefined || args.limitation === expected.limitation) &&
        (expected.accountCodes === undefined ||
          equal(sorted(args.accountCodes ?? []), sorted(expected.accountCodes)));
      score.passed = correct;
      score.focusCorrect = correct;
      score.classification = correct ? 'structured-correct' : 'safe-no-answer';
      score.reasons = [correct ? 'STRUCTURED_BOUNDARY_MATCH' : 'WRONG_CLARIFICATION_SCOPE'];
      return score;
    }
    if (item.expected.behavior !== 'ANSWER') {
      score.classification = 'wrong-answer';
      score.reasons = ['ANSWERED_WITHOUT_REQUIRED_CLARIFICATION'];
      return score;
    }
    const raw = Array.isArray(response.facts) ? response.facts : [],
      groups = raw.filter((f: Json) => f.kind !== 'scenario_calculation') as AnalysisFacts[],
      allCalculations = raw.filter(
        (f: Json) => f.kind === 'scenario_calculation',
      ) as ScenarioCalculationFact[];
    let answer: NormalizedAnswer;
    if (groups.length || allCalculations.length) {
      const claims = normalizeGroups(groups, context);
      answer = {
        groups,
        claims,
        calculations: allCalculations,
        visibility: visibleReferences(response, groups, allCalculations, claims, item),
        headlineKeys: [],
        headlineCalculations: [],
      };
    } else answer = narrowAnswer(response, context);
    primaryFocus(response, answer, context);
    answer.headlineKeys.forEach((key) => answer.visibility.ledger.add(key));
    answer.headlineCalculations.forEach((id) => answer.visibility.calculations.add(id));
    const used = new Set(answer.visibility.calculations);
    answer.headlineCalculations.forEach((id) => used.add(id));
    function ancestors(id: string, trail = new Set<string>()) {
      requireEvidence(!trail.has(id), 'CYCLIC_CALCULATION');
      const c = answer.calculations.find((c) => c.id === id);
      requireEvidence(c, 'UNKNOWN_CALCULATION');
      for (const r of c.operands)
        if (r.source === 'calculation') {
          used.add(r.id);
          ancestors(r.id, new Set([...trail, id]));
        }
    }
    [...used].forEach((id) => ancestors(id));
    const calculations = answer.calculations.filter((c) => used.has(c.id)),
      computed = verifyCalculations(calculations, answer.claims, answer.groups, item, context);
    validateCalculationRows(response, answer, computed);
    const matches = new Map<string, string[]>(),
      visibleIds = new Set<string>();
    for (const c of answer.claims) {
      const key = claimKey(c);
      if (!answer.visibility.ledger.has(key)) continue;
      referenceChecked(c, context);
      const asComputed: Computed = {
        exact: numberFraction(c.value),
        expression: ledgerSymbol(c, context),
        source: c.scope.status === 'DRAFT' ? 'draft' : 'posted',
        unit: c.unit,
        queryRefs: [],
        assumptionIds: [],
        atoms: atomKeys(ledgerSymbol(c, context)),
      };
      const ids = catalog
        .filter((e) => formulaMatch(e, asComputed, catalog, item, context, c.value))
        .map((e) => e.id);
      matches.set(key, ids);
      ids.forEach((id) => visibleIds.add(id));
      if (!ids.length) score.verifiedExtraClaims++;
    }
    const calculationMatches = new Map<string, string[]>();
    for (const id of answer.visibility.calculations) {
      const c = answer.calculations.find((c) => c.id === id)!,
        value = computed.get(id)!;
      const ids = catalog
        .filter((e) => formulaMatch(e, value, catalog, item, context, c.value))
        .map((e) => e.id);
      calculationMatches.set(id, ids);
      ids.forEach((id) => visibleIds.add(id));
      if (!ids.length) score.verifiedExtraClaims++;
    }
    score.matchedClaims = item.expected.required.filter((c) => visibleIds.has(c.id)).map((c) => c.id);
    score.matchedTables = (item.expected.tables ?? [])
      .filter((table) =>
        answer.visibility.tables.some((actual) => tableMatches(table, actual, matches, answer.claims)),
      )
      .map((table) => table.id);
    const lead = answer.headlineKeys.length
      ? answer.headlineKeys.slice(0, 1).flatMap((k) => matches.get(k) ?? [])
      : answer.headlineCalculations.length
        ? answer.headlineCalculations.flatMap((k) => calculationMatches.get(k) ?? [])
        : (() => {
            for (const t of response.evidence)
              for (const row of t.rows) {
                const ref = row.factRef;
                if (ref?.kind === 'assumption') continue;
                if (ref?.kind === 'query_row')
                  return matches.get(JSON.stringify([ref.queryId, ref.rowId])) ?? [];
                if (ref?.kind === 'calculation') return calculationMatches.get(ref.calculationId) ?? [];
                return answer.visibility.tables[0]?.keys.flatMap((k) => matches.get(k) ?? []) ?? [];
              }
            return [];
          })();
    score.primaryMatched = sorted(lead.filter((id) => primary.includes(id)));
    score.focusCorrect =
      score.primaryMatched.length > 0 ||
      (primary.length === 0 &&
        (item.expected.tables?.length ?? 0) > 0 &&
        score.matchedTables.length === item.expected.tables!.length);
    const limited =
      Boolean(response.limitation) ||
      response.answer.startsWith('I could only complete part of this request.') ||
      response.answer.startsWith("I couldn't verify");
    const complete =
      score.matchedClaims.length === item.expected.required.length &&
      score.matchedTables.length === (item.expected.tables?.length ?? 0) &&
      score.focusCorrect &&
      !limited;
    score.passed = complete;
    score.classification = complete ? 'structured-correct' : 'partial-answer';
    score.reasons = complete
      ? ['EXTERNAL_REQUIREMENTS_VISIBLE_AND_FOCUSED']
      : [
          ...(score.matchedClaims.length < item.expected.required.length ? ['MISSING_REQUIRED_CLAIMS'] : []),
          ...(score.matchedTables.length < (item.expected.tables?.length ?? 0)
            ? ['MISSING_REQUIRED_TABLE_COVERAGE']
            : []),
          ...(!score.focusCorrect ? ['WRONG_ANSWER_FOCUS'] : []),
          ...(limited ? ['EXPLICITLY_PARTIAL_OR_WITHHELD'] : []),
        ];
    return score;
  } catch (error) {
    const reason =
      error instanceof InvalidEvidence || error instanceof UngradableEvidence
        ? error.message
        : 'UNRECOGNIZED_EVIDENCE';
    const ungradable = error instanceof UngradableEvidence || !(error instanceof InvalidEvidence);
    score.classification = ungradable ? 'ungradable' : 'wrong-answer';
    score.reasons = [reason];
    if (ungradable) score.unverifiableExtraClaims++;
    else score.wrongFinancialClaims.push(reason);
    if (reason === 'FOREIGN_WORKSPACE' && !score.hardBoundaryViolations.includes('foreign_workspace'))
      score.hardBoundaryViolations.push('foreign_workspace');
    if (
      ['DISPLAY_STATUS_MISMATCH', 'CALCULATION_SOURCE_MISMATCH', 'STATUS_PROVENANCE_MISMATCH'].includes(
        reason,
      )
    )
      score.hardBoundaryViolations.push('status_or_assumption_masquerade');
    return score;
  }
}
