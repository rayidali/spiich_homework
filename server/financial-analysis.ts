import { z } from 'zod';
import { query, type Db } from './db';
import { reportSnapshot } from './reports';
import { AppError } from './errors';
import { Decimal, money, formatCurrency } from '../shared/money';
import { accountSchema, currencyCodes, dateSchema, type Account } from '../shared/schema';
import type { FinancialTool } from './ai-provider';
import type { InsightEvidence } from './ai';
import { ALL_HISTORY_START, recordedPeriod } from './date-scope';
import {
  groupingSchema,
  groupingDimensions,
  groupingPeriod,
  compileCompoundGrouping,
  compoundRowId,
  MAX_COMPOUND_CELLS,
  type GroupDimension,
  type CompoundDimension,
} from './financial-grouping';

const signedAmount = z.string().regex(/^-?\d{1,16}(?:\.\d{1,2})?$/);
export const financialQuerySchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  metric: z.enum([
    'net_expense',
    'net_revenue',
    'net_profit',
    'account_balance',
    'cash_balance',
    'net_cash_movement',
    'journal_total',
    'journal_count',
  ]),
  aggregation: z.enum(['sum', 'average_per_entry']),
  from: dateSchema.nullable(),
  to: dateSchema,
  status: z.enum(['POSTED', 'DRAFT']),
  currencyMode: z.enum(['base', 'native']).default('base'),
  currency: z.enum(currencyCodes).nullable().default(null),
  groupBy: groupingSchema,
  accountCodes: z.array(accountSchema.shape.code).max(20),
  cooccurringAccountCodes: z.array(accountSchema.shape.code).max(20),
  counterparty: z.strictObject({
    mode: z.enum(['any', 'exact', 'contains']),
    value: z.string().trim().max(100),
  }),
  descriptionSearch: z.string().trim().max(200),
  minimumAmount: signedAmount.nullable(),
  maximumAmount: signedAmount.nullable(),
  order: z.enum(['value_desc', 'value_asc', 'label_asc']),
  limit: z.number().int().min(1).max(50),
});
export type FinancialQuery = z.infer<typeof financialQuerySchema>;
export const financialAnalysisSchema = z.strictObject({
  queries: z.array(financialQuerySchema).min(1).max(4),
});
// Defaults preserve old server callers. Provider arguments must still state the
// currency basis explicitly, including null for the USD base view.
const parameters = z.toJSONSchema(
  z.strictObject({
    queries: z
      .array(
        financialQuerySchema.extend({
          currencyMode: z.enum(['base', 'native']),
          currency: z.enum(currencyCodes).nullable(),
        }),
      )
      .min(1)
      .max(4),
  }),
);
delete parameters.$schema;
export const financialAnalysisTool: FinancialTool = {
  type: 'function',
  name: 'financial_analysis',
  strict: true,
  description: `Compose up to four bounded ledger queries. Never supply SQL.
currencyMode:'base',currency:null uses recorded USD base values. currencyMode:'native' requires one explicit USD/EUR/GBP/CAD/JPY currency and measures only accounts and saved lines in that currency, without conversion. Groups include only descendants in that currency. Explicit posting accounts must match it. Native journal_total/count are not supported: a mixed-currency full journal cannot be partially counted as a native total.
net_expense/net_revenue/net_profit measure matching lines; accountCodes restrict those lines, expanding groups.
groupBy accepts a single dimension as before, or an ordered array of two or three unique dimensions from account,counterparty,month,quarter, with at most one time grain. Example ['month','account'] answers monthly spending by account; ['month','account','counterparty'] separates actual account/person combinations. All dimensions must be requested; never silently replace a compound grouping with one dimension. Journal totals/counts still cannot include account. Compound book balances support only account plus month/quarter and retain each account's full history through the row's closing date; different account types remain separate. For account+time, every scoped posting account gets every period, including archived/quiet accounts. Counterparty combinations use only actual tuples observed after all filters and entry amount thresholds; fill their missing periods, never invent unrelated account/vendor combinations. Named counterparties display as quoted text, distinct from the empty-name placeholder; grouping preserves exact case-sensitive header identities, without entity resolution. Empty sums/counts are zero; empty averages are null. The complete compound grid is capped at30000 cells; a larger scope requires narrowing, never a partial tuple universe. The final limit1..50 is GLOBAL across all grouped rows, not a per-account/per-vendor limit. Composite fact rows include ordered typed dimensions and IDs of the form compound:[["month","2026-03"],["account","5030"]]; use account codes as keys, with actual account IDs retained separately in evidence.
journal_total is the FULL journal debit total, not cash or revenue; journal_count counts DISTINCT entries. For these two metrics accountCodes select entries having any listed account, without trimming their lines. Neither supports account grouping.
cooccurringAccountCodes is only an entry-has-ANY-listed-account filter; it NEVER establishes allocated payment or which expense a funding line paid.
counterparty exact is case-insensitive exact header text; contains and descriptionSearch are literal substrings, not entity resolution.
minimumAmount/maximumAmount filter each entry's selected metric total BEFORE grouping; journal_count uses full journal debit totals for these thresholds.
average_per_entry divides a group's net amount by its DISTINCT matching entries, including refunds and zero-net entries; it is not a monthly average. For one average across all matching transactions use groupBy:'total'. Use account/month/quarter/counterparty only when the question explicitly requests a separate average for each such group. Never combine average_per_entry with groupBy:'entry': each group then contains only one transaction, so it cannot answer an average across transactions. Counts and balances require sum.
account_balance requires explicit accountCodes, POSTED and no amount, counterparty, description or co-occurrence filter. Grouping total/account requires from:null and includes all history through to. Grouping month/quarter requires a display from date and one account type; each row is the CLOSING balance including ALL earlier history through that clipped period end, never that month's movement. Total balances also require one account type. Filtered activity is not a full balance. Other metrics require from/to inclusive.
cash_balance uses the same balance date/grouping rules but REQUIRES accountCodes:[]: the server selects every cash-designated ASSET posting account, including archived history. Never substitute an Assets group, accounts receivable, equipment, an account name or a model-chosen subset for cash. Native mode selects all cash accounts in that one currency. Cash is a book balance, not a reconciled bank statement or available credit.
net_cash_movement measures the signed change in recorded cash during an inclusive from/to period: cash debits minus cash credits, positive for increases and negative for decreases. It REQUIRES accountCodes:[], status:'POSTED', aggregation:'sum'. The server selects all cash-designated ASSET posting accounts, including archived history. Internal transfers cancel when both cash sides are in the measured scope; native-currency or account-grouped rows can show only one side. Saved-rate base values may include a recorded currency-transfer difference. Optional activity filters restrict matching transactions and must remain explicit. Amount bounds apply to each entry's NET cash movement, never its gross receipts or payments. This is neither revenue, profit, opening/closing cash nor a formal operating/investing/financing cash-flow statement. Never infer a gross payment allocation from co-occurring accounts. For the complete cash change use no activity filters, total grouping and base currency; compare periods with separate queries.
Monthly/quarterly series include periods without activity, clip partial boundaries, and allow at most120 calendar buckets. limit is1..50; truncated results are explicitly marked. Base balances are historical carrying amounts at saved rates, not current exchange-rate revaluation. Native balances do not convert currencies. Money is presented in currency minor units; per-entry averages may be rounded.
DRAFT values are hypothetical unposted amounts, never book balances. Allocation, forecasts and scenario calculations are not supported by this tool. Clarify unsupported meanings or missing material inputs rather than silently dropping filters.
Use empty account arrays, counterparty {mode:'any',value:''}, descriptionSearch:'', and null amount bounds when unfiltered. Order is explicit.`,
  parameters,
};

export type AnalysisAccount = Pick<
  Account,
  'id' | 'code' | 'name' | 'type' | 'currency' | 'parent_id' | 'is_group' | 'archived' | 'is_cash'
>;
export async function financialAnalysisChart(org: string, db?: Db): Promise<AnalysisAccount[]> {
  const chart = await query<AnalysisAccount>(
    'SELECT id,code,name,type,currency,parent_id,is_group,archived,is_cash FROM accounts WHERE organization_id=$1 ORDER BY code,id LIMIT 251',
    [org],
    db,
  );
  if (chart.length > 250)
    throw new AppError(
      422,
      'CHART_TOO_LARGE',
      'Financial analysis supports up to 250 accounts in its account context.',
    );
  return chart;
}

function unsupported(message: string): never {
  throw new AppError(422, 'INVALID_ANALYSIS_SCOPE', message);
}
function expandAccounts(codes: string[], chart: AnalysisAccount[]) {
  const selected = new Set<string>();
  const pending = codes.map((code) => {
    const account = chart.find((item) => item.code === code);
    if (!account)
      throw new AppError(422, 'INVALID_ANALYSIS_ACCOUNT', 'Choose an account from this workspace.');
    return account.id;
  });
  while (pending.length) {
    const id = pending.pop()!;
    if (selected.has(id)) continue;
    selected.add(id);
    pending.push(...chart.filter((item) => item.parent_id === id).map((item) => item.id));
  }
  return chart.filter((item) => selected.has(item.id) && !item.is_group);
}
const allowedTypes: Record<FinancialQuery['metric'], readonly Account['type'][]> = {
  net_expense: ['EXPENSE'],
  net_revenue: ['REVENUE'],
  net_profit: ['REVENUE', 'EXPENSE'],
  account_balance: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'],
  cash_balance: ['ASSET'],
  net_cash_movement: ['ASSET'],
  journal_total: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'],
  journal_count: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'],
};
const expressions: Record<FinancialQuery['metric'], string> = {
  net_expense: 'l.base_debit-l.base_credit',
  net_revenue: 'l.base_credit-l.base_debit',
  net_profit: 'l.base_credit-l.base_debit',
  account_balance:
    "CASE WHEN a.type IN ('ASSET','EXPENSE') THEN l.base_debit-l.base_credit ELSE l.base_credit-l.base_debit END",
  cash_balance: 'l.base_debit-l.base_credit',
  net_cash_movement: 'l.base_debit-l.base_credit',
  journal_total: 'l.base_debit',
  journal_count: 'l.base_debit',
};

/** Only enums select SQL syntax. All identities, text, dates, bounds and limits are parameters. */
export function compileFinancialQuery(org: string, input: unknown, chart: AnalysisAccount[]) {
  const plan = financialQuerySchema.parse(input);
  if (plan.counterparty.mode === 'any' ? plan.counterparty.value !== '' : !plan.counterparty.value)
    unsupported(
      'An exact or contains counterparty filter requires text; an unfiltered counterparty requires empty text.',
    );
  if (plan.from && plan.from > plan.to) unsupported('The start date must not follow the end date.');
  if (
    plan.minimumAmount !== null &&
    plan.maximumAmount !== null &&
    new Decimal(plan.minimumAmount).gt(plan.maximumAmount)
  )
    unsupported('The minimum amount must not exceed the maximum.');
  const isJournal = plan.metric === 'journal_total' || plan.metric === 'journal_count';
  const isCashMovement = plan.metric === 'net_cash_movement';
  const isCash = plan.metric === 'cash_balance' || isCashMovement;
  const isBalance = isBalanceMetric(plan);
  const dimensions = groupingDimensions(plan.groupBy);
  const period = groupingPeriod(plan.groupBy);
  const isSeries = !!period;
  const compound = Array.isArray(plan.groupBy);
  let periodCount = 1;
  if (plan.currencyMode === 'base' ? plan.currency !== null : plan.currency === null)
    unsupported(
      'The base view requires currency:null; a native view requires one explicit supported currency.',
    );
  if (plan.currencyMode === 'native' && isJournal)
    unsupported('Native currency cannot represent a complete journal total or count. Use the base view.');
  if (
    isCashMovement &&
    (plan.accountCodes.length !== 0 || plan.status !== 'POSTED' || plan.aggregation !== 'sum')
  )
    unsupported(
      'Net cash movement requires empty accountCodes (all server-selected cash accounts), POSTED and sum. It measures signed cash change, not draft activity or gross payments.',
    );
  if (isBalance) {
    if (
      (isSeries ? plan.from === null : plan.from !== null) ||
      (isCash ? plan.accountCodes.length !== 0 : !plan.accountCodes.length) ||
      plan.status !== 'POSTED' ||
      (compound
        ? !(dimensions.length === 2 && dimensions.includes('account') && isSeries)
        : !['total', 'account', 'month', 'quarter'].includes(plan.groupBy as string)) ||
      plan.minimumAmount !== null ||
      plan.maximumAmount !== null ||
      plan.counterparty.mode !== 'any' ||
      plan.descriptionSearch !== '' ||
      plan.cooccurringAccountCodes.length > 0
    )
      unsupported(
        `A book balance requires ${isCash ? 'cash_balance with empty accountCodes (all server-selected cash accounts)' : 'explicit accounts'}, POSTED, total/account grouping with from:null or month/quarter grouping with a display start, and no activity filters. Every balance includes all history through its as-of date.`,
      );
  } else if (plan.from === null)
    unsupported('A flow or transaction query requires an explicit inclusive start date.');
  if (plan.aggregation === 'average_per_entry' && (isBalance || plan.metric === 'journal_count'))
    unsupported('Counts and balances cannot be averaged per entry.');
  if (plan.aggregation === 'average_per_entry' && plan.groupBy === 'entry')
    unsupported(
      'An average across transactions requires total or a requested account, period or counterparty grouping, not one group per transaction.',
    );
  if (isJournal && dimensions.includes('account'))
    unsupported(
      'Journal totals and counts cannot be allocated to account groups. Choose entry, time or counterparty grouping.',
    );
  if (isSeries) {
    const months =
      (Number(plan.to.slice(0, 4)) - Number(plan.from!.slice(0, 4))) * 12 +
      Number(plan.to.slice(5, 7)) -
      Number(plan.from!.slice(5, 7)) +
      1;
    const buckets =
      period === 'month'
        ? months
        : Math.floor((Number(plan.to.slice(0, 4)) * 12 + Number(plan.to.slice(5, 7)) - 1) / 3) -
          Math.floor((Number(plan.from!.slice(0, 4)) * 12 + Number(plan.from!.slice(5, 7)) - 1) / 3) +
          1;
    if (buckets > 120)
      unsupported(
        'A time series is limited to 120 calendar periods. Choose a shorter range or quarterly grouping.',
      );
    periodCount = buckets;
  }
  const expanded = isCash
    ? chart.filter((account) => account.type === 'ASSET' && account.is_cash && !account.is_group)
    : expandAccounts(plan.accountCodes, chart);
  const selected = expanded.filter(
    (account) => plan.currencyMode === 'base' || account.currency === plan.currency,
  );
  const cooccurring = expandAccounts(plan.cooccurringAccountCodes, chart);
  const types = allowedTypes[plan.metric];
  // Empty groups still have accounting meaning. Expanding only to posting leaves
  // must not turn an incompatible selected root into an apparently valid zero.
  const requestedRoots = chart.filter((account) => plan.accountCodes.includes(account.code));
  if (
    plan.currencyMode === 'native' &&
    requestedRoots.some((account) => !account.is_group && account.currency !== plan.currency)
  )
    unsupported('Every explicitly selected posting account must use the requested native currency.');
  const selectedTypes = new Set([...requestedRoots, ...expanded].map((account) => account.type));
  if (!isJournal && [...requestedRoots, ...expanded].some((account) => !types.includes(account.type)))
    unsupported('The selected accounts do not match the requested financial metric.');
  if (
    isBalance &&
    (plan.groupBy === 'total' || (isSeries && !dimensions.includes('account'))) &&
    selectedTypes.size > 1
  )
    unsupported(
      'A total or time-series balance requires one account type. Group by account to keep different normal balances separate.',
    );
  const params: unknown[] = [
    org,
    plan.from,
    plan.to,
    plan.status,
    selected.map((a) => a.id),
    cooccurring.map((a) => a.id),
    plan.counterparty.value,
    plan.descriptionSearch,
    plan.minimumAmount,
    plan.maximumAmount,
    plan.limit + 1,
    types,
    plan.currencyMode === 'native' ? plan.currency : null,
  ];
  const accountFilter = isCash || plan.accountCodes.length > 0;
  const counterpart =
    plan.counterparty.mode === 'any'
      ? 'true'
      : plan.counterparty.mode === 'exact'
        ? 'lower(e.counterparty)=lower($7)'
        : 'position(lower($7) IN lower(e.counterparty))>0';
  const entryFilters = [
    'e.organization_id=$1',
    'e.status=$4',
    ...(isBalance ? [] : ['e.date >= $2::date']),
    'e.date <= $3::date',
    counterpart,
    "($8='' OR position(lower($8) IN lower(e.description))>0)",
    ...(plan.cooccurringAccountCodes.length
      ? [
          'EXISTS(SELECT 1 FROM journal_lines co WHERE co.organization_id=$1 AND co.entry_id=e.id AND co.account_id=ANY($6::uuid[]))',
        ]
      : []),
    ...(isJournal && accountFilter
      ? [
          'EXISTS(SELECT 1 FROM journal_lines chosen WHERE chosen.organization_id=$1 AND chosen.entry_id=e.id AND chosen.account_id=ANY($5::uuid[]))',
        ]
      : []),
  ];
  const scalarDimensions = {
    total: ["'total'", "'Total'"],
    account: ['m.account_id::text', "m.account_code || ' · ' || m.account_name"],
    month: ["to_char(m.date,'YYYY-MM')", "to_char(m.date,'YYYY-MM')"],
    quarter: [
      "to_char(m.date,'YYYY') || '-Q' || to_char(m.date,'Q')",
      "to_char(m.date,'YYYY') || '-Q' || to_char(m.date,'Q')",
    ],
    counterparty: [
      'm.counterparty',
      "CASE WHEN m.counterparty='' THEN '(No counterparty)' ELSE m.counterparty END",
    ],
    entry: ['m.entry_id::text', "m.date::text || ' · ' || m.description"],
  }[compound ? 'total' : (plan.groupBy as Exclude<FinancialQuery['groupBy'], unknown[]>)];
  const totalExpression =
    plan.metric === 'journal_count' ? 'count(DISTINCT m.entry_id)::numeric' : 'coalesce(sum(m.amount),0)';
  const groupBy = plan.groupBy === 'total' ? '' : `GROUP BY ${scalarDimensions[0]},${scalarDimensions[1]}`;
  let complete =
    'SELECT row_id,label,value,entry_count,NULL::date AS period_from,NULL::date AS period_to FROM grouped';
  if (plan.groupBy === 'account') {
    complete = `SELECT a.id::text AS row_id,a.code || ' · ' || a.name AS label,coalesce(g.value,0) AS value,coalesce(g.entry_count,0) AS entry_count,NULL::date AS period_from,NULL::date AS period_to
      FROM account_scope a LEFT JOIN grouped g ON g.row_id=a.id::text`;
  } else if (plan.groupBy === 'month' || plan.groupBy === 'quarter') {
    const period = plan.groupBy,
      interval = period === 'month' ? '1 month' : '3 months';
    const label =
      period === 'month'
        ? "to_char(bucket,'YYYY-MM')"
        : "to_char(bucket,'YYYY') || '-Q' || to_char(bucket,'Q')";
    const periodEnd = `least((bucket+interval '${interval}'-interval '1 day')::date,$3::date)`;
    complete = isBalance
      ? `SELECT ${label} AS row_id,${label} AS label,g.value,g.entry_count,
      greatest(bucket::date,$2::date) AS period_from,${periodEnd} AS period_to
      FROM generate_series(date_trunc('${period}',$2::date),date_trunc('${period}',$3::date),interval '${interval}') bucket
      CROSS JOIN LATERAL (SELECT coalesce(sum(m.amount),0) AS value,count(DISTINCT m.entry_id)::numeric AS entry_count
        FROM metric_lines m WHERE m.date <= ${periodEnd}) g`
      : `SELECT ${label} AS row_id,${label} AS label,coalesce(g.value,0) AS value,coalesce(g.entry_count,0) AS entry_count,
      greatest(bucket::date,$2::date) AS period_from,least((bucket+interval '${interval}'-interval '1 day')::date,$3::date) AS period_to
      FROM generate_series(date_trunc('${period}',$2::date),date_trunc('${period}',$3::date),interval '${interval}') bucket
      LEFT JOIN grouped g ON g.row_id=(${label})`;
  }
  const finalValue =
    plan.aggregation === 'average_per_entry'
      ? 'CASE WHEN entry_count=0 THEN NULL ELSE value/entry_count END'
      : 'value';
  const order =
    plan.order === 'label_asc'
      ? 'label ASC,row_id ASC'
      : `result_value ${plan.order === 'value_desc' ? 'DESC' : 'ASC'} NULLS LAST,label ASC,row_id ASC`;
  // Type even inactive filters: PostgreSQL must resolve every numbered bind slot.
  const expression =
    plan.currencyMode === 'native'
      ? expressions[plan.metric].replaceAll('l.base_debit', 'l.debit').replaceAll('l.base_credit', 'l.credit')
      : expressions[plan.metric];
  const prefix = `WITH typed_input AS (SELECT $1::uuid,$2::date,$3::date,$4::text,$5::uuid[],$6::uuid[],$7::text,$8::text,$9::numeric,$10::numeric,$11::integer,$12::text[],$13::text),
    entry_scope AS (SELECT e.id,e.date,e.description,e.counterparty FROM journal_entries e WHERE ${entryFilters.join(' AND ')}),
    account_scope AS (SELECT a.id,a.code,a.name FROM accounts a WHERE a.organization_id=$1 AND NOT a.is_group AND a.type=ANY($12::text[]) AND ($13::text IS NULL OR a.currency=$13)${isCash ? ' AND a.is_cash' : ''}${accountFilter ? ' AND a.id=ANY($5::uuid[])' : ''}),
    metric_lines AS (SELECT e.id AS entry_id,e.date,e.description,e.counterparty,a.id AS account_id,a.code AS account_code,a.name AS account_name,(${expression}) AS amount
      FROM entry_scope e JOIN journal_lines l ON l.entry_id=e.id AND l.organization_id=$1 JOIN accounts a ON a.id=l.account_id AND a.organization_id=$1
      WHERE a.type=ANY($12::text[]) AND ($13::text IS NULL OR (a.currency=$13 AND l.currency=$13))${isCash ? ' AND a.is_cash AND NOT a.is_group' : ''}${!isJournal && accountFilter ? ' AND a.id=ANY($5::uuid[])' : ''}),
    entry_values AS (SELECT entry_id,sum(amount) AS amount FROM metric_lines GROUP BY entry_id),
    qualified_entries AS (SELECT entry_id FROM entry_values WHERE ($9::numeric IS NULL OR amount >= $9::numeric) AND ($10::numeric IS NULL OR amount <= $10::numeric))`;
  const sql = compound
    ? compileCompoundGrouping(prefix, plan, isBalance, periodCount)
    : `${prefix},
    grouped AS (SELECT ${scalarDimensions[0]} AS row_id,${scalarDimensions[1]} AS label,${totalExpression} AS value,count(DISTINCT m.entry_id)::numeric AS entry_count
      FROM metric_lines m JOIN qualified_entries q ON q.entry_id=m.entry_id ${groupBy}),
    complete AS (${complete}),
    results AS (SELECT row_id,label,${finalValue} AS result_value,entry_count,period_from,period_to FROM complete)
    SELECT row_id,label,result_value::text AS value,entry_count::text,period_from::text,period_to::text FROM results ORDER BY ${order} LIMIT $11`;
  const groupingAccounts =
    compound && dimensions.includes('account')
      ? (accountFilter
          ? selected
          : chart.filter(
              (account) =>
                !account.is_group &&
                types.includes(account.type) &&
                (plan.currencyMode === 'base' || account.currency === plan.currency),
            )
        ).map(({ id, code }) => ({ id, code }))
      : [];
  return { sql, params, plan, selected, cooccurring, groupingAccounts };
}

type RawRow = {
  row_id: string;
  label: string;
  value: string | null;
  entry_count: string;
  period_from: string | null;
  period_to: string | null;
  dimensions?: GroupDimension[];
  scope_overflow?: boolean;
};
export type AnalysisFactRow = {
  rowId: string;
  label: string;
  value: string | null;
  entryCount: string;
  from: string | null;
  to: string | null;
  balanceAsOf?: string;
  dimensions?: GroupDimension[];
};
type CashAccountSource = {
  selection: 'all_cash_asset_posting_accounts';
  accounts: Pick<
    AnalysisAccount,
    'id' | 'code' | 'type' | 'currency' | 'is_cash' | 'is_group' | 'archived'
  >[];
};
export type AnalysisFacts = {
  queryId: string;
  metric: FinancialQuery['metric'];
  aggregation: FinancialQuery['aggregation'];
  grain: FinancialQuery['groupBy'];
  unit: (typeof currencyCodes)[number] | 'count';
  currency: (typeof currencyCodes)[number] | null;
  rows: AnalysisFactRow[];
  truncated: boolean;
  scope: {
    organizationId: string;
    plan: FinancialQuery;
    resolvedAccountIds: string[];
    cooccurringAccountIds: string[];
    amountBasis: string;
    statusMeaning: string;
    cashBalanceSource?: CashAccountSource;
    cashMovementSource?: CashAccountSource;
    groupingAccounts?: { id: string; code: string }[];
    compoundGrouping?: {
      dimensions: CompoundDimension[];
      zeroFill: 'all_scoped_accounts' | 'observed_qualified_tuples' | 'none';
      maximumCells: number;
    };
  };
};
const metricLabels: Record<FinancialQuery['metric'], string> = {
  net_expense: 'Net expenses',
  net_revenue: 'Net revenue',
  net_profit: 'Net profit',
  account_balance: 'Account balance',
  cash_balance: 'Cash and bank book balance',
  net_cash_movement: 'Net cash and bank movement',
  journal_total: 'Transaction totals',
  journal_count: 'Number of transactions',
};
function scopeDescription(plan: FinancialQuery, chart: AnalysisAccount[]) {
  const currency = plan.currencyMode === 'native' ? plan.currency! : 'USD';
  const isBalanceSeries = isBalanceMetric(plan) && !!groupingPeriod(plan.groupBy);
  const names = (codes: string[]) =>
    codes
      .map((code) => {
        const a = chart.find((item) => item.code === code)!;
        return `${a.code} ${a.name}${a.is_group ? ' (including subaccounts)' : ''}`;
      })
      .join(', ');
  return [
    isBalanceSeries
      ? `Closing balances for ${plan.from} to ${plan.to}; every row includes all earlier history through its displayed closing date, not just activity during that period`
      : plan.from
        ? plan.from === ALL_HISTORY_START
          ? `All recorded history through ${plan.to}; no lower date cutoff`
          : `${plan.from} to ${plan.to}, including both dates`
        : `As of ${plan.to}, including all earlier records`,
    plan.status === 'POSTED'
      ? 'Recorded transactions; corrections count on their own dates'
      : 'Drafts only; these amounts have not been added to your books',
    plan.metric === 'cash_balance' || plan.metric === 'net_cash_movement'
      ? 'All cash-designated asset posting accounts, including archived accounts; receivables, equipment and other noncash assets are excluded'
      : plan.accountCodes.length
        ? `${plan.metric.startsWith('journal_') ? 'Transactions using any of these accounts' : 'Accounts'}: ${names(plan.accountCodes)}`
        : 'All accounts relevant to this question',
    ...(plan.counterparty.mode !== 'any'
      ? [
          `Person or business name ${plan.counterparty.mode === 'exact' ? 'matches' : 'includes'} ${JSON.stringify(plan.counterparty.value)}${plan.counterparty.mode === 'exact' ? ' exactly' : ''}, ignoring capitalization`,
        ]
      : []),
    ...(plan.descriptionSearch ? [`Description includes ${JSON.stringify(plan.descriptionSearch)}`] : []),
    ...(plan.cooccurringAccountCodes.length
      ? [
          `Also uses at least one of these accounts: ${names(plan.cooccurringAccountCodes)}; this does not show how the payment was split`,
        ]
      : []),
    ...(plan.minimumAmount !== null || plan.maximumAmount !== null
      ? [
          `Only transactions whose ${plan.metric.startsWith('journal_') ? 'full transaction total' : 'amount for the selected accounts'} is ${plan.minimumAmount !== null ? `at least ${formatCurrency(plan.minimumAmount, currency)} ${currency}` : ''}${plan.minimumAmount !== null && plan.maximumAmount !== null ? ' and ' : ''}${plan.maximumAmount !== null ? `at most ${formatCurrency(plan.maximumAmount, currency)} ${currency}` : ''}`,
        ]
      : []),
    `${groupingDimensions(plan.groupBy)
      .map(
        (dimension) =>
          ({
            total: 'One total',
            account: 'By account',
            month: 'By month',
            quarter: 'By quarter',
            counterparty: 'By person or business',
            entry: 'Each transaction',
          })[dimension],
      )
      .join(
        ' and ',
      )}; ${{ value_desc: 'largest values first', value_asc: 'smallest values first', label_asc: 'in name or date order' }[plan.order]}`,
    ...(Array.isArray(plan.groupBy)
      ? [
          groupingPeriod(plan.groupBy)
            ? plan.groupBy.includes('counterparty')
              ? 'Missing periods are filled only for account/person combinations observed in matching transactions after the entry amount filters; unrelated combinations are not invented'
              : 'Every scoped posting account is included in every displayed period, including accounts without activity'
            : 'Only combinations observed in matching transactions after the entry amount filters are included',
          `The ${plan.limit}-row limit applies to the complete grouped result, not separately to each account or person. Named counterparties are quoted and retain their exact header spelling; blank names are separate`,
        ]
      : []),
    plan.aggregation === 'average_per_entry'
      ? 'Average per matching transaction, including refunds and transactions with a net amount of zero, rounded to the currency minor unit. A period with no transactions has no average'
      : plan.metric === 'journal_count'
        ? 'Each transaction is counted once in each row'
        : 'Amounts are added together',
    ...(plan.metric === 'journal_total'
      ? [
          'Each transaction total includes all its debit amounts; this is not necessarily spending or a cash payment',
        ]
      : []),
    ...(plan.metric === 'net_cash_movement'
      ? [
          'Cash debits minus cash credits: positive means an increase and negative means a decrease. This is the net movement, not the closing balance, revenue, profit or gross receipts/payments',
          'Transfers cancel across cash accounts included in the same total; individual account or native-currency results can contain only one side. Saved-rate currency transfers can include a recorded carrying-value difference',
        ]
      : []),
    plan.metric === 'journal_count'
      ? 'Values are transaction counts'
      : plan.currencyMode === 'native'
        ? `Amounts are in ${currency}, only for accounts and saved lines in that currency; no currency conversion or current-rate revaluation is applied`
        : 'Amounts are in USD, using the exchange rates saved with each transaction; these are recorded carrying amounts, not current-rate revaluation',
  ].join('. ');
}

export async function executeFinancialAnalysis(
  org: string,
  input: unknown,
  snapshot?: Db,
  options: { deadline?: number } = {},
): Promise<{ answer: string; evidence: InsightEvidence[]; facts: AnalysisFacts[] }> {
  const request = financialAnalysisSchema.parse(input);
  if (new Set(request.queries.map((item) => item.id)).size !== request.queries.length)
    unsupported('Every query requires a unique ID.');
  // A caller checking original-user scope can supply the same read-only
  // repeatable-read snapshot used to resolve the requested account identities.
  const execute = async (db: Db) => {
    const boundStatement = async () => {
      if (options.deadline === undefined) return;
      const remaining = Math.floor(options.deadline - performance.now());
      if (!Number.isFinite(remaining) || remaining < 1)
        throw new AppError(
          422,
          'INSPECTION_LIMIT',
          'The analysis reached its time limit before its next database read.',
        );
      await db.query("SELECT set_config('statement_timeout', $1, true)", [`${Math.min(3000, remaining)}ms`]);
    };
    await db.query("SET LOCAL statement_timeout='3s'");
    await db.query("SET LOCAL lock_timeout='1s'");
    await boundStatement();
    const chart = await financialAnalysisChart(org, db);
    const compiled = request.queries.map((plan) => compileFinancialQuery(org, plan, chart));
    const facts: AnalysisFacts[] = [],
      evidence: InsightEvidence[] = [],
      answers: string[] = [];
    for (const item of compiled) {
      await boundStatement();
      const result = await query<RawRow>(item.sql, item.params, db),
        plan = item.plan;
      if (result.some((row) => row.scope_overflow))
        unsupported(
          `This compound grouping would exceed ${MAX_COMPOUND_CELLS} result cells before display limits. Narrow the date range or filters; no partial combination set has been substituted.`,
        );
      const currency = plan.currencyMode === 'native' ? plan.currency! : 'USD';
      const truncated = result.length > plan.limit;
      const rows = result.slice(0, plan.limit).map((row) => ({
        rowId: Array.isArray(plan.groupBy)
          ? compoundRowId(row.dimensions!)
          : `${plan.groupBy}:${encodeURIComponent(row.row_id)}`,
        label: row.label,
        value:
          row.value === null
            ? null
            : plan.metric === 'journal_count'
              ? new Decimal(row.value).toFixed(0)
              : currency === 'JPY'
                ? new Decimal(row.value).toFixed(0)
                : money(row.value),
        entryCount: new Decimal(row.entry_count).toFixed(0),
        from: row.period_from ?? plan.from,
        to: row.period_to ?? plan.to,
        ...(isBalanceMetric(plan) ? { balanceAsOf: row.period_to ?? plan.to } : {}),
        ...(Array.isArray(plan.groupBy) ? { dimensions: row.dimensions! } : {}),
      }));
      const scope = scopeDescription(plan, chart);
      const tableRows = rows.map((row) => ({
        label: `${row.label}${row.from && groupingPeriod(plan.groupBy) ? (isBalanceMetric(plan) ? ` · closing balance as of ${row.to}` : ` · ${row.from} to ${row.to}`) : ''}${plan.aggregation === 'average_per_entry' ? ` · ${row.entryCount} matching transactions` : ''}`,
        value:
          row.value === null
            ? 'No matching transactions'
            : plan.metric === 'journal_count'
              ? row.value
              : `${formatCurrency(row.value, currency)}${currency !== 'USD' ? ` ${currency}` : ''}`,
        ...(plan.groupBy === 'entry'
          ? {
              href: `/transactions?entry=${encodeURIComponent(decodeURIComponent(row.rowId.slice('entry:'.length)))}`,
            }
          : {}),
      }));
      const suffix = truncated
        ? `Showing ${plan.limit} results. There are more; these are not the complete results.`
        : `All ${rows.length} results are shown.`;
      const metricHeading = `${isBalanceMetric(plan) && groupingPeriod(plan.groupBy) ? (plan.metric === 'cash_balance' ? 'Closing cash and bank balances' : 'Closing account balances') : metricLabels[plan.metric]}${plan.aggregation === 'average_per_entry' ? ' (average per transaction)' : ''}${plan.status === 'DRAFT' ? ' (drafts only)' : ''}${plan.currencyMode === 'native' ? ` (${currency}, without conversion)` : ''}`;
      const accountNames = plan.accountCodes.map(
        (code) => chart.find((account) => account.code === code)!.name,
      );
      const visibleScope = [
        accountNames.length
          ? `${accountNames.slice(0, 2).join(', ')}${accountNames.length > 2 ? ` (+${accountNames.length - 2} accounts)` : ''}`
          : '',
        plan.counterparty.mode !== 'any'
          ? `Counterparty ${plan.counterparty.mode === 'exact' ? '' : 'containing '}${JSON.stringify(plan.counterparty.value)}`
          : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const heading = visibleScope ? `${metricHeading} · ${visibleScope}` : metricHeading;
      answers.push(
        `${heading}${plan.groupBy === 'total' ? `: ${tableRows[0]?.value ?? 'No matching transactions'}` : ''}. ${plan.from ? (plan.from === ALL_HISTORY_START ? recordedPeriod(plan.from, plan.to) : `${plan.from} to ${plan.to}`) : `As of ${plan.to}`}. ${suffix}`,
      );
      evidence.push({
        title: heading,
        period: plan.from ? recordedPeriod(plan.from, plan.to) : `As of ${plan.to}`,
        source: plan.status === 'DRAFT' ? 'draft' : 'posted',
        scope,
        rows: tableRows,
        href: `/reports?${plan.from ? `from=${plan.from}&` : ''}to=${plan.to}`,
      });
      facts.push({
        queryId: plan.id,
        metric: plan.metric,
        aggregation: plan.aggregation,
        grain: plan.groupBy,
        unit: plan.metric === 'journal_count' ? 'count' : currency,
        currency: plan.metric === 'journal_count' ? null : currency,
        rows,
        truncated,
        scope: {
          organizationId: org,
          plan,
          resolvedAccountIds: item.selected.map((account) => account.id),
          cooccurringAccountIds: item.cooccurring.map((account) => account.id),
          amountBasis:
            plan.metric === 'journal_count'
              ? 'full_journal_debit_total_for_amount_filter'
              : isFullJournal(plan)
                ? 'full_journal_debit_total'
                : plan.metric === 'net_cash_movement'
                  ? `net_cash_movement_${plan.currencyMode}_lines`
                  : isBalanceMetric(plan)
                    ? `inception_to_closing_date_${plan.currencyMode}_lines`
                    : `selected_metric_${plan.currencyMode}_lines`,
          statusMeaning: plan.status === 'POSTED' ? 'booked' : 'unposted_projection',
          ...(Array.isArray(plan.groupBy)
            ? {
                groupingAccounts: item.groupingAccounts,
                compoundGrouping: {
                  dimensions: plan.groupBy,
                  zeroFill: (groupingPeriod(plan.groupBy)
                    ? plan.groupBy.includes('counterparty')
                      ? 'observed_qualified_tuples'
                      : 'all_scoped_accounts'
                    : 'none') as 'all_scoped_accounts' | 'observed_qualified_tuples' | 'none',
                  maximumCells: MAX_COMPOUND_CELLS,
                },
              }
            : {}),
          ...(plan.metric === 'cash_balance' || plan.metric === 'net_cash_movement'
            ? {
                [plan.metric === 'cash_balance' ? 'cashBalanceSource' : 'cashMovementSource']: {
                  selection: 'all_cash_asset_posting_accounts' as const,
                  accounts: item.selected.map(
                    ({ id, code, type, currency, is_cash, is_group, archived }) => ({
                      id,
                      code,
                      type,
                      currency,
                      is_cash,
                      is_group,
                      archived,
                    }),
                  ),
                },
              }
            : {}),
        },
      });
    }
    return { answer: answers.join('\n\n'), evidence, facts };
  };
  return snapshot ? execute(snapshot) : reportSnapshot(execute);
}
const isFullJournal = (plan: FinancialQuery) => plan.metric === 'journal_total';
const isBalanceMetric = (plan: FinancialQuery) => ['account_balance', 'cash_balance'].includes(plan.metric);
