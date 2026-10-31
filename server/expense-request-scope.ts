import type { ModelMessages } from './ai-provider';
import type { ExpenseAccount } from './reports';
import { dateSchema } from '../shared/schema';

type Span = { start: number; end: number };
type AccountIdentity = Pick<ExpenseAccount, 'id' | 'code' | 'name'>;
type RequestedPeriod = { from: string; to: string; fromSpan: Span; toSpan: Span };
type CheckedField =
  | 'accountScope'
  | 'metric'
  | 'aggregation'
  | 'status'
  | 'currencyMode'
  | 'currency'
  | 'grouping'
  | 'counterparty'
  | 'descriptionSearch'
  | 'cooccurringAccounts'
  | 'amountBounds'
  | 'from'
  | 'to';

export type ExpenseScopeProof = {
  rule: 'explicit_expense_scope_v1';
  userMessageIndex: number;
  accountSpan: Span;
  requestedAccount: AccountIdentity;
  resolvedPostingAccountIds: string[];
  period: { requested: RequestedPeriod | null; executed: { from: string; to: string } };
  checkedFields: CheckedField[];
};
export type ExpenseScopeConflictReason =
  | 'ambiguous_account'
  | 'unknown_account'
  | 'invalid_period'
  | 'unsupported_plan'
  | 'account_scope'
  | 'period_scope'
  | 'extra_filters'
  | 'grouping';
export type ExpenseScopeAssessment =
  | { status: 'unassessed'; reason: 'unrecognized_syntax' | 'unknown_account' }
  | {
      status: 'conflict';
      reason: ExpenseScopeConflictReason;
      userMessageIndex: number;
      requestedAccount?: AccountIdentity;
    }
  | { status: 'verified'; proof: ExpenseScopeProof };

type RecognizedRequest = {
  userMessageIndex: number;
  accountSpan: Span;
  target: { kind: 'code' | 'name'; value: string };
  period: RequestedPeriod | null;
  wholeSubject: string;
  nounSubject: string | null;
};

// A whole-question grammar, not a search for an account name inside prose.
// Additional clauses, quoted text, comparisons and all later user turns decline
// assessment. A new complete-looking question does not erase earlier constraints.
// Explicit account codes remain available for unusual account names.
const periodSuffix = String.raw`(?:[ \t]+from[ \t]+(?<from>\d{4}-\d{2}-\d{2})[ \t]+(?:to|through)[ \t]+(?<to>\d{4}-\d{2}-\d{2}))?[ \t]*[?.!]?\s*$`;
const question = new RegExp(
  String.raw`^\s*(?:(?:how[ \t]+much[ \t]+(?:do|did)[ \t]+we[ \t]+spend|how[ \t]+much[ \t]+have[ \t]+we[ \t]+spent)[ \t]+on|what[ \t]+(?:are|were)[ \t]+(?:our|the)[ \t]+(?:total[ \t]+)?expenses[ \t]+(?:for|on)|(?:show[ \t]+(?:me[ \t]+)?|give[ \t]+me[ \t]+)?(?:the[ \t]+)?total[ \t]+expenses[ \t]+(?:for|on))[ \t]+(?<account>.+?)${periodSuffix}`,
  'id',
);
const nounQuestion = new RegExp(
  String.raw`^\s*(?<nounSubject>(?<account>.+?)[ \t]+expenses)${periodSuffix}`,
  'id',
);
const clauseWords =
  /\b(?:and|or|but|not|no|never|except|excluding|without|instead|versus|vs|compare|comparison|relative|more|less|than|over|under|at|from|to|through|with|within|vendor|merchant|counterparty|description|containing|contains|named|matching|paid|payment|cash|bank|posted|drafts?|native|currency|convert|conversion|USD|EUR|GBP|CAD|JPY|last|this|next|year|month|quarter|week|daily|monthly|quarterly|between|before|after|since|all|only|total|average|median|percent|include|including|ignore|select|drop|delete|show|tell|please|instructions?)\b/i;
const normalizedName = (value: string) =>
  value
    .trim()
    .replace(/[ \t]+/g, ' ')
    .toLowerCase();
const span = (indices: [number, number]): Span => ({ start: indices[0], end: indices[1] });

function recognize(messages: ModelMessages): RecognizedRequest | undefined {
  const userMessageIndex = messages.length - 1;
  const message = messages[userMessageIndex];
  if (!message || message.role !== 'user' || message.content.length > 4000) return undefined;
  if (messages.slice(0, userMessageIndex).some((earlier) => earlier.role === 'user')) return undefined;
  if (/[\r\n]/.test(message.content.trim())) return undefined;
  const match = question.exec(message.content) ?? nounQuestion.exec(message.content);
  const indices = match?.indices?.groups;
  if (!match?.groups || !indices?.account) return undefined;
  const rawAccount = match.groups.account;
  const value = rawAccount.trim();
  const start = indices.account[0] + rawAccount.indexOf(value);
  const accountSpan = { start, end: start + value.length };
  const code = /^(?:expense[ \t]+)?account[ \t]*(\d{3,8})$/i.exec(value);
  if (!code && (value.length > 100 || !/^[\p{L}\p{M}\p{So} &\t-]+$/u.test(value) || clauseWords.test(value)))
    return undefined;
  const period =
    match.groups.from && match.groups.to && indices.from && indices.to
      ? {
          from: match.groups.from,
          to: match.groups.to,
          fromSpan: span(indices.from),
          toSpan: span(indices.to),
        }
      : null;
  return {
    userMessageIndex,
    accountSpan,
    target: code ? { kind: 'code', value: code[1] } : { kind: 'name', value: normalizedName(value) },
    period,
    wholeSubject: message.content.slice(start, period?.toSpan.end ?? accountSpan.end),
    nounSubject: match.groups.nounSubject ?? null,
  };
}

/** Cheap preflight only: identity resolution must use the execution snapshot. */
export function recognizesExpenseRequest(messages: ModelMessages): boolean {
  return recognize(messages) !== undefined;
}

const identity = ({ id, code, name }: ExpenseAccount): AccountIdentity => ({ id, code, name });
function descendants(roots: readonly ExpenseAccount[], chart: readonly ExpenseAccount[]): string[] {
  const selected = new Set<string>();
  const pending = roots.map((account) => account.id);
  while (pending.length) {
    const id = pending.pop()!;
    if (selected.has(id)) continue;
    selected.add(id);
    pending.push(...chart.filter((account) => account.parent_id === id).map((account) => account.id));
  }
  return chart
    .filter((account) => selected.has(account.id) && !account.is_group)
    .map((a) => a.id)
    .sort();
}
const sameIds = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const validPeriod = (from: unknown, to: unknown): from is string =>
  dateSchema.safeParse(from).success && dateSchema.safeParse(to).success && String(from) <= String(to);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Pure check of an already schema-validated call. The caller supplies the exact
 * expense chart used by its repeatable-read financial execution snapshot.
 * Verified means only checkedFields; an omitted date is explicitly unproved.
 * This never rewrites a plan, queries data, reads amounts or calls a provider.
 */
export function assessExpenseRequestScope(
  messages: ModelMessages,
  call: { name: string; args: Record<string, unknown> },
  chart: readonly ExpenseAccount[],
): ExpenseScopeAssessment {
  const request = recognize(messages);
  if (!request) return { status: 'unassessed', reason: 'unrecognized_syntax' };
  const matching = chart.filter((account) =>
    request.target.kind === 'code'
      ? account.code === request.target.value
      : normalizedName(account.name) === request.target.value,
  );
  const conflict = (reason: ExpenseScopeConflictReason): ExpenseScopeAssessment => ({
    status: 'conflict',
    reason,
    userMessageIndex: request.userMessageIndex,
    ...(matching.length === 1 ? { requestedAccount: identity(matching[0]) } : {}),
  });
  if (matching.length > 1) return conflict('ambiguous_account');
  // In shorthand, "Office supplies expenses" can also be the literal name
  // of a different account. Require clarification rather than silently
  // removing its final word. A full prefixed question has no such ambiguity.
  if (
    request.nounSubject &&
    chart.some((account) => normalizedName(account.name) === normalizedName(request.nounSubject!))
  )
    return conflict('ambiguous_account');
  if (matching.length === 0)
    return request.target.kind === 'code'
      ? conflict('unknown_account')
      : { status: 'unassessed', reason: 'unknown_account' };
  // A literal chart label that includes the entire date-looking suffix makes
  // the interpretation uncertain; do not crop it into a different account.
  if (
    request.period &&
    chart.some((account) => normalizedName(account.name) === normalizedName(request.wholeSubject))
  )
    return conflict('ambiguous_account');
  if (request.period && !validPeriod(request.period.from, request.period.to))
    return conflict('invalid_period');

  const requested = matching[0];
  const requestedIds = descendants([requested], chart);
  let accountCodes: string[];
  let from: unknown;
  let to: unknown;
  let groupedByAccount = false;
  if (call.name === 'expense_by_account') {
    if (typeof call.args.accountCode !== 'string') return conflict('unsupported_plan');
    accountCodes = [call.args.accountCode];
    from = call.args.from;
    to = call.args.to;
  } else if (call.name === 'financial_analysis') {
    if (!Array.isArray(call.args.queries) || call.args.queries.length !== 1 || !object(call.args.queries[0]))
      return conflict('unsupported_plan');
    const query = call.args.queries[0];
    if (query.metric !== 'net_expense' || query.aggregation !== 'sum') return conflict('unsupported_plan');
    if (
      query.status !== 'POSTED' ||
      query.currencyMode !== 'base' ||
      query.currency !== null ||
      !object(query.counterparty) ||
      query.counterparty.mode !== 'any' ||
      query.counterparty.value !== '' ||
      query.descriptionSearch !== '' ||
      !Array.isArray(query.cooccurringAccountCodes) ||
      query.cooccurringAccountCodes.length !== 0 ||
      query.minimumAmount !== null ||
      query.maximumAmount !== null
    )
      return conflict('extra_filters');
    if (!['total', 'account'].includes(String(query.groupBy))) return conflict('grouping');
    groupedByAccount = query.groupBy === 'account';
    if (!Array.isArray(query.accountCodes) || query.accountCodes.some((code) => typeof code !== 'string'))
      return conflict('unsupported_plan');
    accountCodes = query.accountCodes as string[];
    from = query.from;
    to = query.to;
  } else return conflict('unsupported_plan');

  const selected = accountCodes.map((code) => chart.find((account) => account.code === code));
  if (selected.some((account) => !account)) return conflict('account_scope');
  const roots = selected as ExpenseAccount[];
  const selectedIds = accountCodes.length
    ? descendants(roots, chart)
    : chart
        .filter((account) => !account.is_group)
        .map((account) => account.id)
        .sort();
  if (!sameIds(requestedIds, selectedIds)) return conflict('account_scope');
  // Empty descendant sets carry no identity proof. Only the identical explicit
  // requested account may prove an empty group; another empty group cannot.
  if (!requestedIds.length && (!roots.length || roots.some((account) => account.id !== requested.id)))
    return conflict('account_scope');
  if (groupedByAccount && requestedIds.length !== 1) return conflict('grouping');
  if (!validPeriod(from, to)) return conflict('invalid_period');
  if (request.period && (from !== request.period.from || to !== request.period.to))
    return conflict('period_scope');

  const checkedFields: CheckedField[] = [
    'accountScope',
    'metric',
    'aggregation',
    'status',
    'currencyMode',
    'currency',
    'grouping',
    'counterparty',
    'descriptionSearch',
    'cooccurringAccounts',
    'amountBounds',
  ];
  if (request.period) checkedFields.push('from', 'to');
  return {
    status: 'verified',
    proof: {
      rule: 'explicit_expense_scope_v1',
      userMessageIndex: request.userMessageIndex,
      accountSpan: request.accountSpan,
      requestedAccount: identity(requested),
      resolvedPostingAccountIds: requestedIds,
      period: { requested: request.period, executed: { from, to: String(to) } },
      checkedFields,
    },
  };
}
