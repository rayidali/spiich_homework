import { z } from 'zod';
import { createHash } from 'node:crypto';
import { Decimal } from '../shared/money';
import type { ResearchDatabase } from './database';
import { accounts } from './dataset';
import { nextDay, type RowScope } from './scope';

export const querySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    metric: z.enum([
      'cash_balance',
      'revenue',
      'expenses',
      'net_income',
      'receivables',
      'payables',
      'liabilities',
      'assets',
      'equity',
      'net_cash_flow',
      'transaction_count',
      'transactions',
      'account_balance',
      'native_account_balance',
    ]),
    from: z.string().date().nullable(),
    to: z.string().date(),
    groupBy: z.enum(['none', 'month', 'account', 'vendor']),
    accountCodes: z.array(z.string().regex(/^[0-9]{3,8}$/)).max(20),
    search: z.string().max(200),
    limit: z.number().int().min(1).max(100),
    order: z.enum(['value_desc', 'value_asc', 'label_asc']),
  })
  .strict();
export type AnalyticalQuery = z.infer<typeof querySchema>;
export interface ToolEvidence {
  id: string;
  plan: unknown;
  sqlHash: string;
  rows: Record<string, unknown>[];
  snapshot: string;
  rowScope?: RowScope;
}
export function customRowScope(q: AnalyticalQuery): RowScope {
  return {
    provenance: 'compiled-scope-v1',
    supported: true,
    from: q.from,
    toExclusive: nextDay(q.to),
    ...(q.metric === 'transactions'
      ? {
          periodColumn: { name: 'date', kind: 'date' as const },
          identityColumns: { entryId: 'entry_id', vendor: 'vendor' },
        }
      : q.groupBy === 'month'
        ? { periodColumn: { name: 'label', kind: 'month' as const } }
        : q.groupBy === 'account'
          ? { identityColumns: { accountCode: '__scope_account_code', accountName: '__scope_account_name' } }
          : q.groupBy === 'vendor'
            ? { identityColumns: { vendor: 'label' } }
            : {}),
    ...(q.accountCodes.length === 1 ? { fixedIdentity: { accountCode: q.accountCodes[0] } } : {}),
  };
}
const groups = {
  none: "'total'",
  month: "to_char(date,'YYYY-MM')",
  account: "account_code || ' ' || account_name",
  vendor: 'vendor',
};
const metrics: Record<
  Exclude<AnalyticalQuery['metric'], 'transactions' | 'transaction_count'>,
  { expression: string; where: string }
> = {
  cash_balance: { expression: 'base_debit-base_credit', where: 'is_cash' },
  net_cash_flow: { expression: 'base_debit-base_credit', where: 'is_cash' },
  revenue: { expression: 'base_credit-base_debit', where: "account_type='REVENUE'" },
  expenses: { expression: 'base_debit-base_credit', where: "account_type='EXPENSE'" },
  net_income: { expression: 'base_credit-base_debit', where: "account_type IN ('REVENUE','EXPENSE')" },
  receivables: { expression: 'base_debit-base_credit', where: "account_code='1100'" },
  payables: { expression: 'base_credit-base_debit', where: "account_code='2000'" },
  liabilities: { expression: 'base_credit-base_debit', where: "account_type='LIABILITY'" },
  assets: { expression: 'base_debit-base_credit', where: "account_type='ASSET'" },
  equity: { expression: 'base_credit-base_debit', where: "account_type IN ('EQUITY','REVENUE','EXPENSE')" },
  account_balance: {
    expression:
      "CASE WHEN account_type IN ('ASSET','EXPENSE') THEN base_debit-base_credit ELSE base_credit-base_debit END",
    where: 'true',
  },
  native_account_balance: {
    expression: "CASE WHEN account_type IN ('ASSET','EXPENSE') THEN debit-credit ELSE credit-debit END",
    where: 'true',
  },
};
export function compileQuery(input: unknown) {
  const q = querySchema.parse(input);
  if (q.from && q.from > q.to) throw new Error('RESEARCH_INVALID_PERIOD');
  if (q.accountCodes.some((code) => !accounts.some((account) => account.code === code)))
    throw new Error('RESEARCH_UNKNOWN_ACCOUNT');
  if (
    q.from &&
    [
      'cash_balance',
      'account_balance',
      'native_account_balance',
      'receivables',
      'payables',
      'assets',
      'liabilities',
      'equity',
    ].includes(q.metric)
  )
    throw new Error('RESEARCH_BALANCE_REQUIRES_INCEPTION');
  if (
    q.groupBy === 'month' &&
    [
      'cash_balance',
      'account_balance',
      'native_account_balance',
      'receivables',
      'payables',
      'assets',
      'liabilities',
      'equity',
    ].includes(q.metric)
  )
    throw new Error('RESEARCH_BALANCE_MONTH_GROUP_REQUIRES_CUMULATIVE_QUERY');
  if (q.metric === 'native_account_balance' && q.accountCodes.length !== 1)
    throw new Error('RESEARCH_NATIVE_CURRENCY_SCOPE');
  const params: unknown[] = [q.to];
  const filters = ["status='POSTED'", 'date <= $1::date'];
  if (q.from) {
    params.push(q.from);
    filters.push(`date >= $${params.length}::date`);
  }
  if (q.accountCodes.length) {
    params.push(q.accountCodes);
    filters.push(`account_code = ANY($${params.length}::text[])`);
  }
  if (q.search) {
    params.push(q.search);
    filters.push(
      `(position(lower($${params.length}) in lower(description)) > 0 OR position(lower($${params.length}) in lower(vendor)) > 0)`,
    );
  }
  const where = filters.join(' AND ');
  let sql: string;
  if (q.metric === 'transactions') {
    sql = `SELECT entry_id,date::text,description,vendor,sum(base_debit)::text AS value FROM research.scoped_ledger WHERE ${where} GROUP BY entry_id,date,description,vendor ORDER BY date,entry_id LIMIT ${q.limit}`;
  } else {
    const label = groups[q.groupBy];
    const metric = q.metric === 'transaction_count' ? null : metrics[q.metric];
    const value = metric ? `coalesce(sum(${metric.expression}),0)` : 'count(DISTINCT entry_id)';
    const aggregate = q.groupBy === 'none' ? '' : ` GROUP BY ${label}`;
    const ordering =
      q.order === 'label_asc'
        ? 'label ASC'
        : `${value} ${q.order === 'value_desc' ? 'DESC' : 'ASC'},label ASC`;
    sql = `SELECT ${label} AS label,${value}::text AS value FROM research.scoped_ledger WHERE ${where}${metric ? ` AND ${metric.where}` : ''}${aggregate} ORDER BY ${ordering} LIMIT ${q.limit}`;
  }
  return { query: sql, params, plan: q };
}
export async function runQueries(
  db: ResearchDatabase,
  plans: AnalyticalQuery[],
  snapshot: string,
): Promise<ToolEvidence[]> {
  if (plans.length > 8 || new Set(plans.map((p) => p.id)).size !== plans.length)
    throw new Error('RESEARCH_QUERY_BUDGET');
  if (!plans.length) return [];
  const compiled = plans.map(compileQuery);
  const results = await db.batch(compiled);
  return results.map((result, i) => ({
    id: `query:${plans[i].id}`,
    plan: plans[i],
    sqlHash: createHash('sha256').update(compiled[i].query).digest('hex'),
    rows: result.rows,
    snapshot,
    rowScope: customRowScope(compiled[i].plan),
  }));
}

export const calculationSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    operation: z.enum([
      'sum',
      'difference',
      'product',
      'ratio',
      'percentage_change',
      'percentage_of',
      'percentage_share',
      'runway',
    ]),
    operands: z
      .array(z.string().regex(/^-?\d+(?:\.\d{1,8})?$/))
      .min(2)
      .max(12),
    evidenceIds: z.array(z.string().max(160)).min(1).max(20),
    scale: z.number().int().min(0).max(6),
    unit: z.enum(['USD', 'EUR', 'percent', 'days', 'months', 'count']),
    operandUnits: z
      .array(z.enum(['USD', 'EUR', 'percent', 'days', 'months', 'count']))
      .min(2)
      .max(12),
  })
  .strict();
export function calculate(input: unknown): string {
  const c = calculationSchema.parse(input),
    x = c.operands.map((v) => new Decimal(v));
  if (c.operandUnits.length !== x.length) throw new Error('RESEARCH_UNIT_ARITY');
  const units = c.operandUnits;
  const same = units.every((u) => u === units[0]);
  if (['sum', 'difference'].includes(c.operation) && (!same || c.unit !== units[0]))
    throw new Error('RESEARCH_UNIT_MISMATCH');
  if (
    c.operation === 'product' &&
    (units.filter((u) => u !== 'count').length > 1 ||
      c.unit !== (units.find((u) => u !== 'count') ?? 'count'))
  )
    throw new Error('RESEARCH_UNIT_MISMATCH');
  if (c.operation === 'percentage_change' && (!same || c.unit !== 'percent'))
    throw new Error('RESEARCH_UNIT_MISMATCH');
  if (c.operation === 'percentage_of' && (units[1] !== 'percent' || c.unit !== units[0]))
    throw new Error('RESEARCH_UNIT_MISMATCH');
  if (c.operation === 'percentage_share' && (!same || c.unit !== 'percent'))
    throw new Error('RESEARCH_UNIT_MISMATCH');
  if (c.operation === 'runway' && (!same || !['USD', 'EUR'].includes(units[0]) || c.unit !== 'months'))
    throw new Error('RESEARCH_UNIT_MISMATCH');
  if (
    c.operation === 'ratio' &&
    !((same && c.unit === 'count') || (units[1] === 'count' && c.unit === units[0]))
  )
    throw new Error('RESEARCH_UNIT_MISMATCH');
  if (c.operation !== 'sum' && c.operation !== 'product' && x.length !== 2) throw new Error('RESEARCH_ARITY');
  let value: Decimal;
  switch (c.operation) {
    case 'sum':
      value = x.reduce((a, b) => a.plus(b), new Decimal(0));
      break;
    case 'product':
      value = x.reduce((a, b) => a.times(b), new Decimal(1));
      break;
    case 'difference':
      value = x[0].minus(x[1]);
      break;
    case 'percentage_change':
      if (x[1].isZero()) throw new Error('RESEARCH_ZERO_BASE');
      value = x[0].minus(x[1]).div(x[1].abs()).times(100);
      break;
    case 'percentage_of':
      value = x[0].times(x[1]).div(100);
      break;
    case 'percentage_share':
      if (x[1].isZero()) throw new Error('RESEARCH_ZERO_BASE');
      value = x[0].div(x[1]).times(100);
      break;
    case 'runway':
      if (!x[1].gt(0)) throw new Error('RESEARCH_NO_POSITIVE_BURN');
      value = x[0].div(x[1]);
      break;
    case 'ratio':
      if (x[1].isZero()) throw new Error('RESEARCH_ZERO_BASE');
      value = x[0].div(x[1]);
      break;
  }
  return value.toFixed(c.scale, Decimal.ROUND_HALF_UP);
}
