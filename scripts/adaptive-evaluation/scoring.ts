import { Decimal } from '../../shared/money';
import type { AnalysisAccount, AnalysisFacts } from '../../server/financial-analysis';
import type { ScenarioCalculationFact } from '../../server/financial-calculation';
import type { ModelMessages } from '../../server/ai-provider';

export type ExpectedScope = {
  from: string | null;
  to: string | null;
  asOf: string | null;
  status: 'POSTED' | 'DRAFT';
  accountCodes: string[];
  counterparty: { mode: 'any' | 'exact' | 'contains' | 'identity'; value: string };
  currencyMode: 'base' | 'native';
  currency: string | null;
  cooccurringAccountCodes: string[];
  descriptionSearch: string;
  minimumAmount: string | null;
  maximumAmount: string | null;
  entryId?: string;
  averageDenominator?: string;
};
export type Formula =
  | { claim: string }
  | { assumption: { value: string; unit: string; sourceText: string } }
  | { operation: 'add' | 'subtract' | 'multiply' | 'divide'; operands: [Formula, Formula] };
type ClaimBase = { id: string; value: string; unit: string };
export type ExpectedClaim =
  | (ClaimBase & { kind: 'ledger'; metric: string; scope: ExpectedScope })
  | (ClaimBase & {
      kind: 'calculation';
      formula: Formula;
      source: 'posted' | 'draft' | 'scenario';
      exact?: { numerator: string; denominator: string };
    });
export type AdaptiveEvaluationCase = {
  id: string;
  split: 'development' | 'holdout';
  family: string;
  messages: ModelMessages;
  expected: {
    behavior: 'ANSWER' | 'CLARIFY' | 'REFUSE';
    required: ExpectedClaim[];
    supporting: ExpectedClaim[];
    clarification?: { reasons: string[]; subject?: string; accountCodes?: string[]; limitation?: string };
  };
};
export type ScoringContext = {
  organizationId: string;
  chart: AnalysisAccount[];
  /** Complete distinct raw counterparty keys in the isolated fixture, including ''. */
  counterparties: string[];
};
export type AdaptiveOutcome = {
  response?: unknown;
  error?: { code: string };
  attempts?: unknown[];
};
export type AdaptiveScore = {
  caseId: string;
  split: AdaptiveEvaluationCase['split'];
  family: string;
  classification:
    | 'structured-correct'
    | 'wrong-answer'
    | 'partial-answer'
    | 'safe-no-answer'
    | 'execution-error'
    | 'subjective-wording-pending';
  passed: boolean;
  reasons: string[];
  requiredClaims: number;
  matchedClaims: string[];
  extraClaims: number;
  numericCorrect: boolean;
  scopeCorrect: boolean;
  hardBoundaryViolations: string[];
  wordingReview: 'not_model_judged';
};

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
function sameLedgerScope(
  expected: Pick<LedgerClaim, 'metric' | 'scope'>,
  actual: Pick<LedgerClaim, 'metric' | 'scope'>,
  context: ScoringContext,
) {
  // Resolve each metric independently: using the cash predicate to resolve an
  // Assets query would conceal noncash accounts, even when their balances are zero.
  return (
    economicMetric(expected.metric, expected.scope, context) ===
      economicMetric(actual.metric, actual.scope, context) &&
    equal(
      canonicalScope(expected.metric, expected.scope, context),
      canonicalScope(actual.metric, actual.scope, context),
    )
  );
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
      requireEvidence(row.value !== null, 'NULL_FINANCIAL_RESULT');
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
  return amounts[0];
}
function narrowClaims(response: Json, context: ScoringContext): LedgerClaim[] {
  const query = object(response.query),
    args = object(query.args),
    tables = response.evidence;
  requireEvidence(
    Array.isArray(tables) && tables.length === 1 && Array.isArray(tables[0].rows),
    'NARROW_EVIDENCE_MISSING',
  );
  const rows = tables[0].rows as Json[],
    claims: LedgerClaim[] = [];
  const add = (metric: string, value: string, scope: ExpectedScope, rowId: string) => {
    claims.push({
      id: rowId,
      kind: 'ledger',
      metric,
      value,
      unit: 'USD',
      scope,
      queryId: 'narrow',
      rowId,
      truncated: false,
    });
  };
  const scope = defaultScope(args.from ?? null, args.to ?? null);
  if (query.name === 'income_summary' || (query.name === 'expense_summary' && args.view === 'total')) {
    requireEvidence(rows.length === 1, 'NARROW_ROW_COUNT');
    add(
      query.name === 'expense_summary'
        ? 'net_expense'
        : `net_${args.metric === 'expenses' ? 'expense' : args.metric}`,
      evidenceMoney(rows[0].value),
      scope,
      'total',
    );
  } else if (
    query.name === 'cash_position' ||
    query.name === 'expense_by_account' ||
    query.name === 'expense_summary'
  ) {
    const metric = query.name === 'cash_position' ? 'cash_balance' : 'net_expense';
    if (metric === 'cash_balance') {
      scope.from = null;
      scope.to = null;
      scope.asOf = args.asOf;
    }
    if (query.name === 'expense_by_account') scope.accountCodes = [args.accountCode];
    const amounts = moneyValues(String(response.answer));
    requireEvidence(amounts.length === 1, 'NARROW_TOTAL_NOT_BOUND');
    add(metric, amounts[0], { ...scope }, 'total');
    for (const [i, row] of rows.entries()) {
      const href = new URL(String(row.href), 'https://local.invalid'),
        id = href.searchParams.get('account');
      const account = context.chart.find((a) => a.id === id);
      requireEvidence(
        account && accountsFor(metric, scope, context).includes(account.code),
        'NARROW_ACCOUNT_IDENTITY',
      );
      add(metric, evidenceMoney(row.value), { ...scope, accountCodes: [account.code] }, `account:${i}`);
    }
    if (query.name !== 'expense_summary' || args.view === 'all')
      requireEvidence(
        new Decimal(0)
          .plus(claims.slice(1).reduce((sum, claim) => sum.plus(claim.value), new Decimal(0)))
          .eq(amounts[0]),
        'NARROW_TOTAL_MISMATCH',
      );
  } else if (['period_comparison', 'revenue_comparison'].includes(query.name)) {
    requireEvidence(rows.length === 2, 'NARROW_ROW_COUNT');
    const metric =
      query.name === 'revenue_comparison'
        ? 'net_revenue'
        : `net_${args.metric === 'expenses' ? 'expense' : args.metric}`;
    add(metric, evidenceMoney(rows[0].value), scope, 'current');
    add(
      metric,
      evidenceMoney(rows[1].value),
      { ...scope, from: args.previousFrom, to: args.previousTo },
      'previous',
    );
    requireEvidence(
      rows[0].label === `${args.from} – ${args.to}` &&
        rows[1].label === `${args.previousFrom} – ${args.previousTo}`,
      'NARROW_PERIOD_LABEL',
    );
  } else throw new InvalidEvidence('UNSUPPORTED_RESPONSE_VARIANT');
  return claims;
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
function ledgerSymbol(claim: Extract<ExpectedClaim, { kind: 'ledger' }>, ctx: ScoringContext) {
  return symbol(
    JSON.stringify({
      metric: economicMetric(claim.metric, claim.scope, ctx),
      unit: claim.unit,
      scope: canonicalScope(claim.metric, claim.scope, ctx),
    }),
  );
}
type Assumption = { value: string; unit: string; sourceText: string };
function quantity(text: string) {
  const small = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
  ];
  const tens = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const matches: { start: number; end: number; value: string }[] = [];
  for (const m of text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g))
    matches.push({
      start: m.index!,
      end: m.index! + m[0].length,
      value: decimal(m[0].replaceAll(',', '')).toString(),
    });
  const regex = new RegExp(
    `\\b(?:${tens.join('|')})(?:[- ](?:${small.slice(1, 10).join('|')}))?\\b|\\b(?:${small.join('|')})\\b`,
    'gi',
  );
  for (const m of text.matchAll(regex)) {
    if (/^-time\b/i.test(text.slice(m.index! + m[0].length))) continue;
    const parts = m[0].toLowerCase().split(/[- ]/);
    const value = tens.includes(parts[0])
      ? (tens.indexOf(parts[0]) + 2) * 10 + (parts[1] ? small.indexOf(parts[1]) : 0)
      : small.indexOf(parts[0]);
    matches.push({ start: m.index!, end: m.index! + m[0].length, value: String(value) });
  }
  requireEvidence(matches.length === 1, 'AMBIGUOUS_ASSUMPTION_QUANTITY');
  return matches[0];
}
function assumptionOccurrence(a: Assumption, messages: ModelMessages) {
  const found: {
    messageIndex: number;
    start: number;
    end: number;
    quantityStart: number;
    quantityEnd: number;
    rawValue: string;
  }[] = [];
  const q = quantity(a.sourceText);
  const semantic =
    a.unit === 'ratio' && /%|\bpercent\b/i.test(a.sourceText) ? decimal(q.value).div(100) : decimal(q.value);
  requireEvidence(semantic.eq(a.value), 'ORACLE_ASSUMPTION_QUANTITY_MISMATCH');
  for (const [messageIndex, message] of messages.entries())
    if (message.role === 'user') {
      let start = message.content.indexOf(a.sourceText);
      while (start >= 0) {
        found.push({
          messageIndex,
          start,
          end: start + a.sourceText.length,
          quantityStart: start + q.start,
          quantityEnd: start + q.end,
          rawValue: q.value,
        });
        start = message.content.indexOf(a.sourceText, start + 1);
      }
    }
  requireEvidence(found.length === 1, 'AMBIGUOUS_OR_UNSOURCED_ORACLE_ASSUMPTION');
  return found[0];
}
function assumptionSymbol(a: Assumption, messages: ModelMessages) {
  const occurrence = assumptionOccurrence(a, messages);
  return symbol(
    JSON.stringify({
      assumption: {
        value: decimal(a.value).toString(),
        unit: a.unit,
        messageIndex: occurrence.messageIndex,
        quantityStart: occurrence.quantityStart,
        quantityEnd: occurrence.quantityEnd,
      },
    }),
  );
}
function formulaAssumptions(expr: Formula): Assumption[] {
  return 'assumption' in expr
    ? [expr.assumption]
    : 'operation' in expr
      ? expr.operands.flatMap(formulaAssumptions)
      : [];
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
  return symbolic(
    expr.operation,
    expectedFormula(expr.operands[0], catalog, ctx, messages, stack),
    expectedFormula(expr.operands[1], catalog, ctx, messages, stack),
  );
}
function formulaSubtrees(
  expr: Formula,
  catalog: ExpectedClaim[],
  ctx: ScoringContext,
  messages: ModelMessages,
): Symbolic[] {
  return [
    expectedFormula(expr, catalog, ctx, messages),
    ...('operation' in expr
      ? expr.operands.flatMap((part) => formulaSubtrees(part, catalog, ctx, messages))
      : []),
  ];
}
type Computed = {
  exact: Fraction;
  expression: Symbolic;
  source: 'posted' | 'draft' | 'scenario';
  unit: string;
  queryRefs: { id: string; rowId: string | null; field: string }[];
  assumptionIds: string[];
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
    if (a === 'count') return b;
    if (b === 'count') return a;
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
function scoreCalculations(
  calculations: ScenarioCalculationFact[],
  claims: LedgerClaim[],
  groups: AnalysisFacts[],
  catalog: ExpectedClaim[],
  testCase: AdaptiveEvaluationCase,
  ctx: ScoringContext,
) {
  const computed = new Map<string, Computed>(),
    matched: string[] = [];
  const verifiedAssumptions = new Map<string, string>();
  const allowed = catalog.filter(
    (c): c is Extract<ExpectedClaim, { kind: 'calculation' }> => c.kind === 'calculation',
  );
  const allowedSubtrees = allowed.flatMap((claim) =>
    formulaSubtrees(claim.formula, catalog, ctx, testCase.messages),
  );
  const allowedAssumptions = allowed.flatMap((claim) => formulaAssumptions(claim.formula));
  const lookup = (id: string, rowId: string | null) =>
    claims.find((c) => c.queryId === id && c.rowId === rowId);
  for (const calculation of calculations) {
    requireEvidence(
      !computed.has(calculation.id) && calculation.operands.length === 2,
      'DUPLICATE_OR_INVALID_CALCULATION',
    );
    const operands = calculation.operands.map((reference): Computed => {
      if (reference.source === 'calculation') {
        const prior = computed.get(reference.id);
        requireEvidence(prior, 'INVALID_CALCULATION_ORDER');
        return prior;
      }
      if (reference.source === 'assumption') {
        const matches = calculation.assumptions.filter((a) => a.id === reference.id);
        requireEvidence(matches.length === 1, 'INVALID_ASSUMPTION_REFERENCE');
        const a = matches[0],
          message = testCase.messages[a.userMessageIndex];
        requireEvidence(
          message?.role === 'user' &&
            Number.isInteger(a.sourceStart) &&
            Number.isInteger(a.sourceEnd) &&
            a.sourceStart! >= 0 &&
            a.sourceEnd! > a.sourceStart! &&
            a.sourceEnd! <= message.content.length &&
            message.content.slice(a.sourceStart, a.sourceEnd) === a.sourceText,
          'UNSOURCED_ASSUMPTION',
        );
        const quotedQuantity = quantity(a.sourceText);
        const matchingExpected = allowedAssumptions.filter((expected) => {
          if (expected.unit !== a.unit || !sameNumber(expected.value, a.value)) return false;
          const occurrence = assumptionOccurrence(expected, testCase.messages);
          return (
            occurrence.messageIndex === a.userMessageIndex &&
            occurrence.quantityStart === a.sourceStart! + quotedQuantity.start &&
            occurrence.quantityEnd === a.sourceStart! + quotedQuantity.end &&
            sameNumber(occurrence.rawValue, quotedQuantity.value)
          );
        });
        requireEvidence(matchingExpected.length > 0, 'UNEXPECTED_ASSUMPTION_OCCURRENCE');
        const expression = assumptionSymbol(matchingExpected[0], testCase.messages);
        const prior = verifiedAssumptions.get(a.id);
        requireEvidence(prior === undefined || prior === canonical(a), 'INCONSISTENT_ASSUMPTION_EVIDENCE');
        verifiedAssumptions.set(a.id, canonical(a));
        requireEvidence(
          allowedSubtrees.some((s) => sameFormula(s, expression)),
          'UNEXPECTED_ASSUMPTION',
        );
        return {
          exact: numberFraction(a.value),
          expression,
          unit: a.unit,
          source: 'scenario',
          queryRefs: [],
          assumptionIds: [a.id],
        };
      }
      requireEvidence(reference.field === 'value', 'UNSUPPORTED_CALENDAR_COUNT_FORMULA');
      const claim = lookup(reference.id, reference.rowId);
      requireEvidence(claim && !claim.truncated, 'MISSING_OR_TRUNCATED_OPERAND');
      const expected = catalog.find(
        (c): c is Extract<ExpectedClaim, { kind: 'ledger' }> =>
          c.kind === 'ledger' &&
          c.unit === claim.unit &&
          sameNumber(c.value, claim.value) &&
          sameLedgerScope(c, claim, ctx),
      );
      requireEvidence(expected, 'UNPROVEN_CALCULATION_OPERAND');
      return {
        exact: numberFraction(claim.value),
        expression: ledgerSymbol(expected, ctx),
        unit: claim.unit,
        source: claim.scope.status === 'DRAFT' ? 'draft' : 'posted',
        queryRefs: [{ id: reference.id, rowId: reference.rowId, field: 'value' }],
        assumptionIds: [],
      };
    });
    const [a, b] = operands,
      exact = arithmetic(calculation.operation, a.exact, b.exact);
    const expression = symbolic(calculation.operation, a.expression, b.expression);
    const source =
      a.source === 'scenario' || b.source === 'scenario'
        ? 'scenario'
        : a.source === 'draft' || b.source === 'draft'
          ? 'draft'
          : 'posted';
    const unit = computedUnit(calculation.operation, a.unit, b.unit);
    const queryRefs = uniqueRefs([...a.queryRefs, ...b.queryRefs]);
    const assumptionIds = sorted([...a.assumptionIds, ...b.assumptionIds]);
    requireEvidence(
      calculation.unit === unit &&
        calculation.source === source &&
        calculation.hypothetical === (source !== 'posted'),
      'CALCULATION_SOURCE_MISMATCH',
    );
    requireEvidence(
      BigInt(calculation.exact.numerator) * exact.d === exact.n * BigInt(calculation.exact.denominator) &&
        BigInt(calculation.exact.denominator) > 0n &&
        sameNumber(calculation.value, rounded(exact, unit)),
      'INCORRECT_CALCULATION_VALUE',
    );
    requireEvidence(
      setEqual(calculation.provenance.queryRows, queryRefs) &&
        equal(sorted(calculation.provenance.assumptionIds), assumptionIds),
      'CALCULATION_ANCESTRY_MISMATCH',
    );
    requireEvidence(
      calculation.assumptions.length === assumptionIds.length &&
        equal(sorted(calculation.assumptions.map((a) => a.id)), assumptionIds) &&
        calculation.assumptions.every((a) => verifiedAssumptions.get(a.id) === canonical(a)),
      'INCONSISTENT_ASSUMPTION_EVIDENCE',
    );
    for (const [metric, field] of [
      ['cash_balance', 'cashSources'],
      ['net_cash_movement', 'cashMovementSources'],
    ] as const) {
      const expectedSources = queryRefs.flatMap((ref) => {
        const group = groups.find((g) => g.queryId === ref.id),
          claim = lookup(ref.id, ref.rowId);
        if (group?.metric !== metric || !claim) return [];
        const accountIds = accountsFor(metric, claim.scope, ctx)
          .map((code) => ctx.chart.find((a) => a.code === code)!.id)
          .sort();
        return [
          {
            queryId: ref.id,
            rowId: ref.rowId,
            ...(metric === 'cash_balance'
              ? { asOf: claim.scope.asOf }
              : { from: claim.scope.from, to: claim.scope.to }),
            accountIds,
          },
        ];
      });
      const actualSources = calculation[field]?.map((row) => ({
        ...row,
        accountIds: [...row.accountIds].sort(),
      }));
      requireEvidence(actualSources && setEqual(actualSources, expectedSources), 'CASH_ANCESTRY_MISMATCH');
    }
    requireEvidence(
      allowedSubtrees.some((s) => sameFormula(s, expression)),
      'UNEXPECTED_CALCULATION_FORMULA',
    );
    computed.set(calculation.id, { exact, expression, source, unit, queryRefs, assumptionIds });
    for (const expected of allowed)
      if (
        expected.unit === unit &&
        expected.source === source &&
        sameNumber(expected.value, calculation.value) &&
        sameFormula(expectedFormula(expected.formula, catalog, ctx, testCase.messages), expression) &&
        (!expected.exact ||
          BigInt(expected.exact.numerator) * exact.d === exact.n * BigInt(expected.exact.denominator))
      )
        matched.push(expected.id);
  }
  return matched;
}

function narrowComparison(response: Json, claims: LedgerClaim[]): ScenarioCalculationFact[] {
  if (!['period_comparison', 'revenue_comparison'].includes(response.query?.name)) return [];
  requireEvidence(claims.length === 2, 'NARROW_COMPARISON_MISSING');
  const amounts = moneyValues(response.answer),
    [current, previous] = claims;
  requireEvidence(
    amounts.length === 3 && sameNumber(amounts[0], current.value) && sameNumber(amounts[1], previous.value),
    'NARROW_COMPARISON_DISPLAY',
  );
  const exact = arithmetic('subtract', numberFraction(current.value), numberFraction(previous.value));
  requireEvidence(sameNumber(amounts[2], rounded(exact, 'USD')), 'NARROW_COMPARISON_DELTA');
  const percentages = [...response.answer.matchAll(/(-?\d+(?:\.\d+)?)%/g)].map((m: RegExpMatchArray) => m[1]);
  if (decimal(previous.value).gt(0))
    requireEvidence(
      percentages.length === 1 &&
        sameNumber(
          percentages[0],
          decimal(current.value).minus(previous.value).div(previous.value).times(100).toFixed(1),
        ),
      'NARROW_COMPARISON_PERCENTAGE',
    );
  else requireEvidence(percentages.length === 0, 'NARROW_COMPARISON_PERCENTAGE');
  const refs = claims.map((claim) => ({ id: claim.queryId, rowId: claim.rowId, field: 'value' as const }));
  return [
    {
      kind: 'scenario_calculation',
      id: 'narrow_delta',
      hypothetical: false,
      source: 'posted',
      operation: 'subtract',
      operands: refs.map((ref) => ({ source: 'query', ...ref })),
      value: amounts[2],
      unit: 'USD',
      exact: { numerator: String(exact.n), denominator: String(exact.d) },
      assumptions: [],
      provenance: { assumptionIds: [], queryRows: refs },
      cashSources: [],
      cashMovementSources: [],
    },
  ];
}
function displayValue(text: unknown, unit: string, value: string) {
  requireEvidence(typeof text === 'string', 'MISSING_DISPLAY_VALUE');
  if (['count', 'ratio', 'months'].includes(unit)) {
    const match = new RegExp(`^(-?\\d+(?:\\.\\d+)?)(?: ${unit})?$`).exec(text);
    requireEvidence(match && sameNumber(match[1], value), 'DISPLAY_VALUE_MISMATCH');
    return;
  }
  const match = /^(-?)([$€£¥])([\d,]+(?:\.\d+)?)(?:\s+(USD|EUR|GBP|CAD|JPY))?(\/month)?$/.exec(text);
  requireEvidence(match, 'DISPLAY_CURRENCY_UNRECOGNIZED');
  const currency =
    match[4] ?? ({ $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' } as Record<string, string>)[match[2]];
  requireEvidence(
    currency === unit.replace('_per_month', '') &&
      Boolean(match[5]) === (unit === 'USD_per_month') &&
      sameNumber(match[1] + match[3].replaceAll(',', ''), value),
    'DISPLAY_VALUE_MISMATCH',
  );
}
function bindDisplayTables(response: Json, groups: AnalysisFacts[], calculations: ScenarioCalculationFact[]) {
  const tables: Json[] = response.evidence;
  let ledgerCount = 0;
  if (groups.length && response.query?.name !== 'financial_scenario') {
    requireEvidence(tables.length >= groups.length, 'MISSING_LEDGER_TABLES');
    const ledgerTables = tables.slice(-groups.length);
    ledgerCount = groups.length;
    groups.forEach((group, index) => {
      const table = ledgerTables[index];
      requireEvidence(
        Array.isArray(table.rows) && table.rows.length === group.rows.length,
        'LEDGER_TABLE_LENGTH',
      );
      requireEvidence(
        table.source === undefined ||
          table.source === (group.scope.plan.status === 'DRAFT' ? 'draft' : 'posted'),
        'DISPLAY_STATUS_MISMATCH',
      );
      group.rows.forEach((row, i) => {
        const dims = Array.isArray(group.grain) ? group.grain : [group.grain];
        const period = dims.includes('month') || dims.includes('quarter');
        const balance = ['cash_balance', 'account_balance'].includes(group.metric);
        const expectedLabel =
          row.label +
          (row.from && period
            ? balance
              ? ` · closing balance as of ${row.to}`
              : ` · ${row.from} to ${row.to}`
            : '') +
          (group.aggregation === 'average_per_entry' ? ` · ${row.entryCount} matching transactions` : '');
        requireEvidence(table.rows[i].label === expectedLabel, 'DISPLAY_ROW_SCOPE_MISMATCH');
        displayValue(table.rows[i].value, group.unit, row.value!);
      });
    });
  }
  if (calculations.length && !['period_comparison', 'revenue_comparison'].includes(response.query?.name)) {
    const preceding = ledgerCount ? tables.slice(0, -ledgerCount) : tables;
    const sources = [...new Set(calculations.map((c) => c.source))];
    const calcTables = preceding.filter((table) => table.title !== 'User assumptions · HYPOTHETICAL');
    requireEvidence(calcTables.length === sources.length, 'CALCULATION_TABLE_LENGTH');
    sources.forEach((source, index) => {
      const expected = calculations.filter((c) => c.source === source),
        table = calcTables[index];
      requireEvidence(
        table.source === source && table.rows.length === expected.length,
        'CALCULATION_TABLE_SOURCE',
      );
      expected.forEach((calculation, i) =>
        displayValue(table.rows[i].value, calculation.unit, calculation.value),
      );
    });
  }
}

/** Grades actual application output; never sends reference labels to a model. */
export function scoreAdaptiveResponse(
  testCase: AdaptiveEvaluationCase,
  outcome: AdaptiveOutcome,
  context: ScoringContext,
): AdaptiveScore {
  const score: AdaptiveScore = {
    caseId: testCase.id,
    split: testCase.split,
    family: testCase.family,
    classification: 'execution-error',
    passed: false,
    reasons: [],
    requiredClaims: testCase.expected.required.length,
    matchedClaims: [],
    extraClaims: 0,
    numericCorrect: false,
    scopeCorrect: false,
    hardBoundaryViolations: [],
    wordingReview: 'not_model_judged',
  };
  if (outcome.error || !outcome.response) {
    score.reasons = [outcome.error?.code ?? 'MISSING_RESPONSE'];
    return score;
  }
  const catalog = [...testCase.expected.required, ...testCase.expected.supporting];
  requireEvidence(
    new Set(catalog.map((claim) => claim.id)).size === catalog.length,
    'DUPLICATE_ORACLE_CLAIM',
  );
  const expectedLedger = catalog.filter(
    (c): c is Extract<ExpectedClaim, { kind: 'ledger' }> => c.kind === 'ledger',
  );
  const matches = (
    claim: LedgerClaim,
    expected: Extract<ExpectedClaim, { kind: 'ledger' }>,
    values = true,
    scope = true,
  ) =>
    economicMetric(claim.metric, claim.scope, context) ===
      economicMetric(expected.metric, expected.scope, context) &&
    claim.unit === expected.unit &&
    (!values || sameNumber(claim.value, expected.value)) &&
    (!scope || sameLedgerScope(expected, claim, context));
  try {
    const response = object(outcome.response);
    requireEvidence(
      typeof response.answer === 'string' && Array.isArray(response.evidence),
      'MALFORMED_RESPONSE',
    );
    const name = response.query?.name;
    const clarification = ['request_details', 'ask_clarification'].includes(name);
    const hasData = Boolean(
      response.facts?.length || response.evidence.some((table: Json) => table.rows?.length),
    );
    if (clarification || (response.limitation && !hasData)) {
      requireEvidence(
        !hasData && moneyValues(response.answer).length === 0,
        'BOUNDARY_WITH_FINANCIAL_CLAIMS',
      );
      score.classification = 'safe-no-answer';
      if (testCase.expected.behavior === 'ANSWER') {
        score.reasons = ['ANSWERABLE_COVERAGE_MISS'];
        return score;
      }
      if (!clarification || name === 'ask_clarification' || !testCase.expected.clarification) {
        score.classification = 'subjective-wording-pending';
        score.reasons = ['BOUNDARY_WORDING_REQUIRES_REVIEW'];
        return score;
      }
      const expected = testCase.expected.clarification,
        args = object(response.query.args);
      const correct =
        expected.reasons.includes(args.reason) &&
        (expected.subject === undefined || expected.subject === args.subject) &&
        (expected.limitation === undefined || expected.limitation === args.limitation) &&
        (expected.accountCodes === undefined ||
          equal(sorted(expected.accountCodes), sorted(args.accountCodes ?? [])));
      score.classification = correct ? 'structured-correct' : 'safe-no-answer';
      score.passed = correct;
      score.reasons = [correct ? 'STRUCTURED_BOUNDARY_MATCH' : 'WRONG_CLARIFICATION_SCOPE'];
      return score;
    }
    if (testCase.expected.behavior !== 'ANSWER') {
      score.classification = 'wrong-answer';
      score.reasons = ['ANSWERED_WITHOUT_REQUIRED_CLARIFICATION'];
      return score;
    }
    const rawFacts: Json[] = Array.isArray(response.facts) ? response.facts : [];
    const groups = rawFacts.filter((fact) => fact.kind !== 'scenario_calculation') as AnalysisFacts[];
    let calculations = rawFacts.filter(
      (fact) => fact.kind === 'scenario_calculation',
    ) as ScenarioCalculationFact[];
    const claims = groups.length
      ? normalizeGroups(groups, context)
      : calculations.length
        ? []
        : narrowClaims(response, context);
    if (!groups.length && !calculations.length) calculations = narrowComparison(response, claims);
    const requiredLedger = testCase.expected.required.filter(
      (c): c is Extract<ExpectedClaim, { kind: 'ledger' }> => c.kind === 'ledger',
    );
    score.numericCorrect = requiredLedger.every((expected) =>
      claims.some((claim) => matches(claim, expected, true, false)),
    );
    score.scopeCorrect = requiredLedger.every((expected) =>
      claims.some((claim) => matches(claim, expected, false, true)),
    );
    score.matchedClaims = requiredLedger
      .filter((expected) => claims.some((claim) => matches(claim, expected)))
      .map((claim) => claim.id);
    const extra = claims.filter((claim) => !expectedLedger.some((expected) => matches(claim, expected)));
    score.extraClaims = extra.length;
    if (extra.length) {
      score.classification = 'wrong-answer';
      score.reasons = ['UNEXPECTED_OR_INCORRECT_FINANCIAL_CLAIMS'];
      return score;
    }
    const calculationMatches = scoreCalculations(calculations, claims, groups, catalog, testCase, context);
    bindDisplayTables(response, groups, calculations);
    score.matchedClaims.push(
      ...calculationMatches.filter((id) => testCase.expected.required.some((claim) => claim.id === id)),
    );
    score.matchedClaims = sorted(score.matchedClaims);
    // Application-produced amounts in the visible answer/tables must agree with
    // the validated structured evidence. Labels are not numeric claims.
    const permittedValues = [...claims, ...calculations].map((claim) => claim.value);
    for (const calculation of calculations)
      for (const assumption of calculation.assumptions) permittedValues.push(assumption.value);
    const display = [
      response.answer,
      ...response.evidence.flatMap((table: Json) => {
        requireEvidence(Array.isArray(table.rows), 'MALFORMED_EVIDENCE_TABLE');
        return table.rows.map((row: Json) => String(row.value));
      }),
    ];
    requireEvidence(
      display
        .flatMap((text) => moneyValues(text))
        .every((value) => permittedValues.some((permitted) => sameNumber(value, permitted))),
      'UNSUPPORTED_DISPLAYED_AMOUNT',
    );
    const complete = testCase.expected.required.every((claim) => score.matchedClaims.includes(claim.id));
    score.classification = complete ? 'structured-correct' : 'partial-answer';
    score.passed = complete;
    score.numericCorrect = complete || score.numericCorrect;
    score.scopeCorrect = complete || score.scopeCorrect;
    score.reasons = [complete ? 'EXACT_CLAIMS_SCOPE_AND_FORMULAS' : 'MISSING_REQUIRED_CLAIMS'];
    return score;
  } catch (error) {
    const reason = error instanceof InvalidEvidence ? error.message : 'MALFORMED_EVIDENCE';
    score.classification = ['UNSUPPORTED_RESPONSE_VARIANT', 'UNSUPPORTED_CALENDAR_COUNT_FORMULA'].includes(
      reason,
    )
      ? 'subjective-wording-pending'
      : 'wrong-answer';
    score.reasons = [reason];
    if (reason === 'FOREIGN_WORKSPACE') score.hardBoundaryViolations.push('foreign_workspace');
    if (
      ['STATUS_PROVENANCE_MISMATCH', 'CALCULATION_SOURCE_MISMATCH', 'DISPLAY_STATUS_MISMATCH'].includes(
        reason,
      )
    )
      score.hardBoundaryViolations.push('status_or_assumption_masquerade');
    return score;
  }
}

function wilson(successes: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.959963984540054,
    p = successes / n,
    denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
function exactMcNemar(aOnly: number, bOnly: number) {
  const n = aOnly + bOnly;
  if (!n) return 1;
  let coefficient = 1n,
    sum = 1n;
  for (let k = 1; k <= Math.min(aOnly, bOnly); k++) {
    coefficient = (coefficient * BigInt(n - k + 1)) / BigInt(k);
    sum += coefficient;
  }
  return Math.min(1, Number(2n * sum) / Number(2n ** BigInt(n)));
}
export type PairedScore = { caseId: string; route: 'composable' | 'adaptive'; score: AdaptiveScore };
/** Descriptive paired results; not a population accuracy or superiority claim. */
export function aggregatePairedScores(
  cases: AdaptiveEvaluationCase[],
  rows: PairedScore[],
  split: 'development' | 'holdout' = 'holdout',
) {
  const selected = cases.filter((c) => c.split === split);
  requireEvidence(new Set(selected.map((c) => c.id)).size === selected.length, 'DUPLICATE_CASE_ID');
  const relevant = rows.filter((row) => selected.some((c) => c.id === row.caseId));
  requireEvidence(
    new Set(relevant.map((r) => `${r.route}/${r.caseId}`)).size === relevant.length,
    'DUPLICATE_PAIRED_RESULT',
  );
  for (const row of relevant)
    requireEvidence(row.score.caseId === row.caseId && row.score.split === split, 'RESULT_IDENTITY_MISMATCH');
  const paired = selected.flatMap((c) => {
    const a = relevant.find((r) => r.caseId === c.id && r.route === 'composable');
    const b = relevant.find((r) => r.caseId === c.id && r.route === 'adaptive');
    return a && b
      ? [
          {
            caseId: c.id,
            family: c.family,
            composable: a.score.passed,
            adaptive: b.score.passed,
            composableClassification: a.score.classification,
            adaptiveClassification: b.score.classification,
          },
        ]
      : [];
  });
  const count = (a: boolean, b: boolean) =>
    paired.filter((r) => r.composable === a && r.adaptive === b).length;
  const aOnly = count(true, false),
    bOnly = count(false, true),
    bothPass = count(true, true),
    bothFail = count(false, false);
  const n = paired.length;
  return {
    split,
    plannedPairs: selected.length,
    completedPairs: n,
    complete: n === selected.length,
    expectedDesignPairs: split === 'holdout' ? 16 : 4,
    designCountMatches: selected.length === (split === 'holdout' ? 16 : 4),
    composablePassed: bothPass + aOnly,
    adaptivePassed: bothPass + bOnly,
    bothPass,
    bothFail,
    composableOnly: aOnly,
    adaptiveOnly: bOnly,
    pairedDifference: n ? (bOnly - aOnly) / n : null,
    exactTwoSidedMcNemarP: n ? exactMcNemar(aOnly, bOnly) : null,
    composableWilson95: wilson(bothPass + aOnly, n),
    adaptiveWilson95: wilson(bothPass + bOnly, n),
    adaptiveWinAmongDiscordantWilson95: wilson(bOnly, aOnly + bOnly),
    families: sorted(selected.map((c) => c.family)).map((family) => ({
      family,
      planned: selected.filter((c) => c.family === family).length,
      paired: paired.filter((r) => r.family === family).length,
      composablePassed: paired.filter((r) => r.family === family && r.composable).length,
      adaptivePassed: paired.filter((r) => r.family === family && r.adaptive).length,
    })),
    pairs: paired,
    interpretation:
      'Small purpose-built paired set, one outcome per route and question. Exact McNemar is descriptive; Wilson intervals are not paired-effect intervals. No universal accuracy or causal superiority claim.',
  };
}
