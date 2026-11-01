/** Disclosed post-development scoring revision. The frozen v1 scorer and all
 * original outcomes stay unchanged. V2 adds only (1) additive expense-set
 * equivalence and (2) independent truth checks for bounded fixture ledger rows.
 * It does not generate a missing answer, infer a formula from equal dollars,
 * or treat an unverified extra row as a demonstrated numerical error. */
import { z } from 'zod';
import {
  equivalentScope,
  scoreAdaptiveResponse,
  type AdaptiveEvaluationCase,
  type AdaptiveOutcome,
  type AdaptiveScore,
  type ExpectedClaim,
  type ExpectedScope,
  type Formula,
  type ScoringContext,
} from './scoring';
import {
  counterparties,
  loadLedger,
  referenceLedgerValue,
  verifyLedger,
  type FixtureLedger,
} from './fixtures';
import type { AnalysisFacts } from '../../server/financial-analysis';

type Ledger = Extract<ExpectedClaim, { kind: 'ledger' }>;
type RowCheck = {
  queryId: string;
  rowId: string;
  result: 'verified-true' | 'incorrect-value' | 'unverifiable';
  extra: boolean;
  reason: string;
};
export type AdaptiveScoreV2 = AdaptiveScore & {
  revision: {
    version: 'adaptive-scoring-v2';
    originalV1: AdaptiveScore;
    expenseUnionAlternatives: { requiredClaimId: string; accountCodes: string[]; matched: boolean }[];
    verifiedTrueExtraRows: number;
    incorrectExtraRows: number;
    unverifiableExtraRows: number;
    rowChecks: RowCheck[];
    limitation: 'bounded_fixture_oracle_not_general_semantic_or_prose_judgment';
  };
};
const sorted = (values: string[]) => [...new Set(values)].sort();
const stable = (value: unknown): string =>
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
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
function cents(text: string): bigint {
  check(/^-?\d+(?:\.\d{1,2})?$/.test(text), 'UNSUPPORTED_DECIMAL');
  const negative = text.startsWith('-'),
    [whole, fractional = ''] = text.replace(/^-/, '').split('.');
  return BigInt(whole + fractional.padEnd(2, '0')) * (negative ? -1n : 1n);
}
const sameAmount = (a: string, b: string) => {
  try {
    return cents(a) === cents(b);
  } catch {
    return false;
  }
};
function effectiveCodes(
  metric: string,
  codes: string[],
  context: ScoringContext,
  currencyMode: string,
  currency: string | null,
) {
  const type =
    metric === 'net_expense'
      ? ['EXPENSE']
      : metric === 'net_revenue'
        ? ['REVENUE']
        : metric === 'net_profit'
          ? ['EXPENSE', 'REVENUE']
          : null;
  check(
    Array.isArray(codes) && codes.every((code) => context.chart.some((a) => a.code === code)),
    'UNKNOWN_ACCOUNT',
  );
  const roots = new Set(codes.map((code) => context.chart.find((a) => a.code === code)!.id));
  return sorted(
    context.chart
      .filter((a) => {
        if (
          a.is_group ||
          (type && !type.includes(a.type)) ||
          (currencyMode === 'native' && a.currency !== currency)
        )
          return false;
        if (['cash_balance', 'net_cash_movement'].includes(metric) && (!a.is_cash || a.type !== 'ASSET'))
          return false;
        if (!roots.size) return true;
        let ancestor = a;
        const seen = new Set<string>();
        for (;;) {
          if (roots.has(ancestor.id)) return true;
          if (!ancestor.parent_id || seen.has(ancestor.id)) return false;
          seen.add(ancestor.id);
          const parent = context.chart.find((item) => item.id === ancestor.parent_id);
          if (!parent) return false;
          ancestor = parent;
        }
      })
      .map((a) => a.code),
  );
}
function scopeWithoutAccounts(scope: ExpectedScope) {
  const { accountCodes: _accountCodes, ...rest } = scope;
  return stable(rest);
}
function leaves(formula: Formula, catalog: ExpectedClaim[], visiting = new Set<string>()): Ledger[] | null {
  if ('assumption' in formula) return null;
  if ('claim' in formula) {
    if (visiting.has(formula.claim)) return null;
    const claim = catalog.find((item) => item.id === formula.claim);
    if (!claim) return null;
    return claim.kind === 'ledger'
      ? [claim]
      : leaves(claim.formula, catalog, new Set([...visiting, claim.id]));
  }
  if (formula.operation !== 'add') return null;
  const left = leaves(formula.operands[0], catalog, visiting),
    right = leaves(formula.operands[1], catalog, visiting);
  return left && right ? [...left, ...right] : null;
}
function expenseUnion(
  claim: ExpectedClaim,
  catalog: ExpectedClaim[],
  context: ScoringContext,
  id: string,
): Ledger | null {
  if (claim.kind !== 'calculation') return null;
  const terms = leaves(claim.formula, catalog, new Set([claim.id]));
  if (!terms || terms.length < 2 || terms.length > 8) return null;
  const first = terms[0],
    selected: string[] = [];
  let sum = 0n;
  for (const term of terms) {
    // Per-entry amount thresholds are not additive across account partitions:
    // two40-dollar lines could qualify as80 only after their union. Refuse them.
    if (
      term.metric !== 'net_expense' ||
      term.unit !== first.unit ||
      scopeWithoutAccounts(term.scope) !== scopeWithoutAccounts(first.scope) ||
      term.scope.minimumAmount !== null ||
      term.scope.maximumAmount !== null ||
      term.scope.entryId !== undefined ||
      term.scope.averageDenominator !== undefined ||
      term.scope.asOf !== null ||
      term.scope.from === null ||
      term.scope.to === null
    )
      return null;
    const codes = effectiveCodes(
      term.metric,
      term.scope.accountCodes,
      context,
      term.scope.currencyMode,
      term.scope.currency,
    );
    if (!codes.length || codes.some((code) => selected.includes(code))) return null;
    selected.push(...codes);
    sum += cents(term.value);
  }
  if (
    claim.unit !== first.unit ||
    claim.source !== (first.scope.status === 'POSTED' ? 'posted' : 'draft') ||
    cents(claim.value) !== sum
  )
    return null;
  return {
    id,
    kind: 'ledger',
    metric: 'net_expense',
    value: claim.value,
    unit: claim.unit,
    scope: { ...structuredClone(first.scope), accountCodes: sorted(selected) },
  };
}
function checkOracleContext(ledger: FixtureLedger, context: ScoringContext) {
  verifyLedger(ledger);
  check(
    context.chart.length === ledger.accounts.length &&
      new Set(context.chart.map((a) => a.code)).size === ledger.accounts.length,
    'FIXTURE_CHART_MISMATCH',
  );
  for (const expected of ledger.accounts) {
    const actual = context.chart.find((a) => a.code === expected.code);
    check(
      actual &&
        actual.type === expected.type &&
        actual.name === expected.name &&
        actual.currency === expected.currency &&
        actual.is_group === expected.isGroup &&
        actual.is_cash === expected.isCash &&
        actual.archived === expected.archived &&
        (actual.parent_id ? context.chart.find((a) => a.id === actual.parent_id)?.code : null) ===
          expected.parentCode,
      'FIXTURE_CHART_MISMATCH',
    );
  }
  check(
    stable(sorted(context.counterparties)) === stable(counterparties(ledger)),
    'FIXTURE_COUNTERPARTY_MISMATCH',
  );
}
function ledgerRow(
  group: AnalysisFacts,
  row: AnalysisFacts['rows'][number],
  context: ScoringContext,
  id: string,
): Ledger {
  const plan = group.scope.plan;
  check(group.aggregation === 'sum' && plan.aggregation === 'sum', 'UNSUPPORTED_AGGREGATION');
  check(
    [
      'net_expense',
      'net_revenue',
      'net_profit',
      'account_balance',
      'cash_balance',
      'net_cash_movement',
    ].includes(group.metric),
    'UNSUPPORTED_METRIC',
  );
  check(group.unit === (plan.currencyMode === 'native' ? plan.currency : 'USD'), 'UNSUPPORTED_CURRENCY');
  check(
    plan.currencyMode === 'base' ? plan.currency === null : ['USD', 'EUR'].includes(plan.currency!),
    'UNSUPPORTED_CURRENCY',
  );
  check(
    plan.counterparty && ['any', 'identity', 'exact', 'contains'].includes(plan.counterparty.mode),
    'UNSUPPORTED_COUNTERPARTY',
  );
  check(
    plan.cooccurringAccountCodes.length === 0 &&
      plan.descriptionSearch === '' &&
      plan.minimumAmount === null &&
      plan.maximumAmount === null,
    'UNSUPPORTED_FILTER',
  );
  check(
    z.iso.date().safeParse(plan.to).success &&
      (plan.from === null || z.iso.date().safeParse(plan.from).success),
    'UNSUPPORTED_PERIOD',
  );
  check(plan.from === null || plan.from <= plan.to, 'UNSUPPORTED_PERIOD');
  check(row.value !== null, 'NULL_RESULT');
  const stock = ['cash_balance', 'account_balance'].includes(group.metric);
  const dimensions = Array.isArray(group.grain) ? group.grain : [group.grain];
  check(
    dimensions.length <= 3 &&
      dimensions.every((dim) => ['total', 'account', 'counterparty', 'month', 'quarter'].includes(dim)),
    'UNSUPPORTED_GRAIN',
  );
  check(
    row.to !== null &&
      z.iso.date().safeParse(row.to).success &&
      (stock || (row.from !== null && z.iso.date().safeParse(row.from).success)),
    'UNSUPPORTED_PERIOD',
  );
  const scope: ExpectedScope = {
    from: stock ? null : row.from,
    to: row.to,
    asOf: stock ? row.balanceAsOf! : null,
    status: plan.status,
    accountCodes: effectiveCodes(group.metric, plan.accountCodes, context, plan.currencyMode, plan.currency),
    counterparty: structuredClone(plan.counterparty),
    currencyMode: plan.currencyMode,
    currency: plan.currency,
    cooccurringAccountCodes: [],
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
  };
  check(scope.accountCodes.length > 0, 'EMPTY_ACCOUNT_SCOPE');
  if (dimensions.includes('account')) {
    const dimension = row.dimensions?.find((d) => d.kind === 'account');
    const accountId = dimension
      ? dimension.accountId
      : decodeURIComponent(row.rowId.slice('account:'.length));
    const account = context.chart.find((a) => a.id === accountId);
    check(
      account && (!dimension || dimension.key === account.code) && scope.accountCodes.includes(account.code),
      'UNSUPPORTED_ACCOUNT_ROW',
    );
    scope.accountCodes = [account.code];
  }
  if (dimensions.includes('counterparty')) {
    const dimension = row.dimensions?.find((d) => d.kind === 'counterparty');
    const key = dimension ? dimension.key : decodeURIComponent(row.rowId.slice('counterparty:'.length));
    check(context.counterparties.includes(key), 'UNSUPPORTED_COUNTERPARTY_ROW');
    scope.counterparty = { mode: 'identity', value: key };
  }
  return { id, kind: 'ledger', metric: group.metric, unit: group.unit, value: row.value!, scope };
}
function sameClaim(a: Ledger, b: Ledger, context: ScoringContext) {
  try {
    return (
      a.metric === b.metric &&
      a.unit === b.unit &&
      sameAmount(a.value, b.value) &&
      equivalentScope(a.metric, a.scope, b.scope, context)
    );
  } catch {
    return false;
  }
}
/** V1 still performs every metadata, source, formula, scope and display check.
 * The fixture oracle may add truthful support; it never changes required scope.
 * No inputs, outcomes, original scores or frozen files are mutated. */
export function scoreAdaptiveResponseV2(
  testCase: AdaptiveEvaluationCase,
  outcome: AdaptiveOutcome,
  context: ScoringContext,
): AdaptiveScoreV2 {
  const originalV1 = scoreAdaptiveResponse(testCase, outcome, context);
  const revision: AdaptiveScoreV2['revision'] = {
    version: 'adaptive-scoring-v2',
    originalV1,
    expenseUnionAlternatives: [],
    verifiedTrueExtraRows: 0,
    incorrectExtraRows: 0,
    unverifiableExtraRows: 0,
    rowChecks: [],
    limitation: 'bounded_fixture_oracle_not_general_semantic_or_prose_judgment',
  };
  if (originalV1.passed || outcome.error || !outcome.response || testCase.expected.behavior !== 'ANSWER')
    return { ...originalV1, revision };
  if (
    originalV1.classification !== 'partial-answer' &&
    !originalV1.reasons.includes('UNEXPECTED_OR_INCORRECT_FINANCIAL_CLAIMS')
  )
    return { ...originalV1, revision };
  const augmented = structuredClone(testCase),
    catalog = [...testCase.expected.required, ...testCase.expected.supporting];
  const used = new Set(catalog.map((item) => item.id));
  let sequence = 0;
  const newId = () => {
    let id: string;
    do {
      id = `v2_verified_${++sequence}`;
    } while (used.has(id));
    used.add(id);
    return id;
  };
  const alternatives = new Map<string, { requiredId: string; claim: Ledger }>();
  try {
    for (const required of testCase.expected.required) {
      const union = expenseUnion(required, catalog, context, newId());
      if (union) {
        augmented.expected.required.push(union);
        alternatives.set(union.id, { requiredId: required.id, claim: union });
      }
    }
  } catch {
    /* Unsupported oracle algebra cannot supply an equivalence. */
  }
  const ledger = loadLedger();
  let oracleReady = false;
  try {
    checkOracleContext(ledger, context);
    oracleReady = true;
  } catch {
    /* No guessed fixture identity. */
  }
  const response = outcome.response as { facts?: AnalysisFacts[] };
  const groups = Array.isArray(response.facts)
    ? response.facts.filter((g) => g && typeof g === 'object' && !('kind' in g))
    : [];
  const known = [...augmented.expected.required, ...augmented.expected.supporting].filter(
    (claim): claim is Ledger => claim.kind === 'ledger',
  );
  for (const group of groups.slice(0, 4)) {
    if (!Array.isArray(group.rows)) continue;
    for (const row of group.rows.slice(0, 50)) {
      let actual: Ledger | undefined;
      try {
        actual = ledgerRow(group, row, context, newId());
        const extra = !known.some((claim) => sameClaim(actual!, claim, context));
        if (!extra) continue;
        check(oracleReady, 'FIXTURE_CONTEXT_UNVERIFIED');
        const expectedValue = referenceLedgerValue(actual, ledger);
        const correct = sameAmount(actual.value, expectedValue);
        const expected = { ...actual, value: expectedValue };
        augmented.expected.supporting.push(expected);
        known.push(expected);
        revision.rowChecks.push({
          queryId: group.queryId,
          rowId: row.rowId,
          result: correct ? 'verified-true' : 'incorrect-value',
          extra: true,
          reason: 'INDEPENDENT_INTEGER_LEDGER_ORACLE',
        });
        if (correct) revision.verifiedTrueExtraRows++;
        else revision.incorrectExtraRows++;
      } catch (error) {
        revision.rowChecks.push({
          queryId: group.queryId,
          rowId: row.rowId,
          result: 'unverifiable',
          extra: true,
          reason:
            error instanceof Error && /^[A-Z_]+$/.test(error.message)
              ? error.message
              : 'UNSUPPORTED_ROW_SCOPE',
        });
        revision.unverifiableExtraRows++;
      }
    }
  }
  const checked = scoreAdaptiveResponse(augmented, outcome, context);
  const matched = new Set(
    checked.matchedClaims.filter((id) => testCase.expected.required.some((claim) => claim.id === id)),
  );
  for (const [id, alternative] of alternatives) {
    const present = checked.matchedClaims.includes(id);
    revision.expenseUnionAlternatives.push({
      requiredClaimId: alternative.requiredId,
      accountCodes: alternative.claim.scope.accountCodes,
      matched: present,
    });
    if (present) matched.add(alternative.requiredId);
  }
  if (checked.classification === 'structured-correct' || checked.classification === 'partial-answer') {
    const complete = testCase.expected.required.every((claim) => matched.has(claim.id));
    return {
      ...checked,
      passed: complete,
      classification: complete ? 'structured-correct' : 'partial-answer',
      requiredClaims: testCase.expected.required.length,
      matchedClaims: [...matched].sort(),
      numericCorrect: complete || checked.numericCorrect,
      scopeCorrect: complete || checked.scopeCorrect,
      reasons: [
        complete ? 'V2_EXACT_CLAIMS_WITH_DISCLOSED_EQUIVALENCES' : 'MISSING_REQUIRED_CLAIMS',
        ...(revision.verifiedTrueExtraRows ? ['EXTRA_ROWS_INDEPENDENTLY_VERIFIED_TRUE'] : []),
      ],
      revision,
    };
  }
  const hasCalculations =
    Array.isArray(response.facts) && response.facts.some((fact) => fact && 'kind' in fact);
  const boundedOriginalLabels = catalog.every(
    (claim) =>
      claim.kind === 'calculation' ||
      ([
        'net_expense',
        'net_revenue',
        'net_profit',
        'account_balance',
        'cash_balance',
        'net_cash_movement',
      ].includes(claim.metric) &&
        claim.scope.cooccurringAccountCodes.length === 0 &&
        claim.scope.descriptionSearch === '' &&
        claim.scope.minimumAmount === null &&
        claim.scope.maximumAmount === null &&
        claim.scope.entryId === undefined &&
        claim.scope.averageDenominator === undefined),
  );
  if (
    checked.reasons.includes('UNEXPECTED_OR_INCORRECT_FINANCIAL_CLAIMS') &&
    revision.unverifiableExtraRows > 0 &&
    revision.incorrectExtraRows === 0 &&
    checked.extraClaims === revision.unverifiableExtraRows &&
    !hasCalculations &&
    boundedOriginalLabels &&
    checked.hardBoundaryViolations.length === 0
  )
    return {
      ...checked,
      passed: false,
      classification: 'subjective-wording-pending',
      requiredClaims: testCase.expected.required.length,
      matchedClaims: [...matched].sort(),
      reasons: ['EXTRA_ROWS_UNVERIFIABLE_BY_BOUNDED_ORACLE'],
      revision,
    };
  return {
    ...checked,
    requiredClaims: testCase.expected.required.length,
    matchedClaims: [...matched].sort(),
    revision,
  };
}
