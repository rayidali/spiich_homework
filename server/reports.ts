import { query, transaction, type Db } from './db';
import { z } from 'zod';
import { accounts } from './ledger';
import { Decimal, sum, money } from '../shared/money';
import { required, AppError } from './errors';

export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const monthStart = (date = today()) => `${date.slice(0, 7)}-01`;
export const addMonths = (date: string, n: number) =>
  new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + n, 1))
    .toISOString()
    .slice(0, 10);
export async function reportSnapshot<T>(fn: (db: Db) => Promise<T>) {
  return transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return fn(db);
  });
}
export async function incomeStatement(org: string, from: string, to: string, db?: Db) {
  const rows = await query<{ id: string; code: string; name: string; type: string; amount: string }>(
    `SELECT a.id,a.code,a.name,a.type,
    sum(CASE WHEN a.type='REVENUE' THEN l.base_credit-l.base_debit ELSE l.base_debit-l.base_credit END)::text AS amount
    FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id
    WHERE e.organization_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3 AND a.type IN ('REVENUE','EXPENSE')
    GROUP BY a.id ORDER BY a.code`,
    [org, from, to],
    db,
  );
  const revenue = rows.filter((r) => r.type === 'REVENUE'),
    expenses = rows.filter((r) => r.type === 'EXPENSE');
  const totalRevenue = sum(revenue.map((r) => r.amount)),
    totalExpenses = sum(expenses.map((r) => r.amount));
  return {
    from,
    to,
    currency: 'USD',
    revenue,
    expenses,
    totalRevenue: money(totalRevenue),
    totalExpenses: money(totalExpenses),
    netIncome: money(totalRevenue.minus(totalExpenses)),
  };
}
export type ExpenseAccount = {
  id: string;
  code: string;
  name: string;
  currency: string;
  parent_id: string | null;
  is_group: boolean;
  archived: boolean;
};

/** Historical reporting needs archived accounts too. No balances enter model context. */
export async function expenseAccountChart(org: string, db?: Db): Promise<ExpenseAccount[]> {
  const chart = await query<ExpenseAccount>(
    `SELECT id,code,name,currency,parent_id,is_group,archived FROM accounts
     WHERE organization_id=$1 AND type='EXPENSE' ORDER BY code,id LIMIT 251`,
    [org],
    db,
  );
  if (chart.length > 250)
    throw new AppError(
      422,
      'CHART_TOO_LARGE',
      'Expense questions currently support up to 250 expense accounts. Select an account in Reports instead.',
    );
  return chart;
}

export type ExpenseAccountSummary = {
  from: string;
  to: string;
  currency: 'USD';
  account: ExpenseAccount;
  totalExpenses: string;
  expenses: { id: string; code: string; name: string; amount: string }[];
};

/** Net posted expense, using recorded USD base amounts and each entry's own date.
 * A reversal belongs to its posting period; its original remains in earlier periods. */
export async function expenseAccountSummary(
  org: string,
  accountCode: string,
  from: string,
  to: string,
  db?: Db,
): Promise<ExpenseAccountSummary> {
  z.object({ from: z.iso.date(), to: z.iso.date() })
    .refine((range) => range.from <= range.to, 'The start date must not follow the end date')
    .parse({ from, to });
  if (!db) return reportSnapshot((snapshot) => expenseAccountSummary(org, accountCode, from, to, snapshot));
  const chart = await expenseAccountChart(org, db);
  const account = chart.find((item) => item.code === accountCode);
  if (!account)
    throw new AppError(
      422,
      'INVALID_EXPENSE_ACCOUNT',
      'Choose an expense account from this workspace. No broader expense total was substituted.',
    );

  const children = new Map<string, ExpenseAccount[]>();
  for (const item of chart) {
    if (!item.parent_id) continue;
    const siblings = children.get(item.parent_id) ?? [];
    siblings.push(item);
    children.set(item.parent_id, siblings);
  }
  const selected = new Set([account.id]);
  const pending = [account.id];
  while (pending.length) {
    for (const child of children.get(pending.pop()!) ?? []) {
      if (selected.has(child.id)) continue;
      selected.add(child.id);
      pending.push(child.id);
    }
  }
  // Reuse the accounting engine, without its UI's top-five presentation limit.
  const statement = await incomeStatement(org, from, to, db);
  const amounts = new Map(statement.expenses.map((row) => [row.id, row.amount]));
  const expenses = chart
    .filter((item) => selected.has(item.id) && !item.is_group)
    .map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      amount: money(amounts.get(item.id) ?? '0'),
    }));
  return {
    from,
    to,
    currency: 'USD',
    account,
    totalExpenses: money(sum(expenses.map((row) => row.amount))),
    expenses,
  };
}
export async function trialBalance(org: string, from: string, to: string, db?: Db) {
  const rows = await query<{
    id: string;
    code: string;
    name: string;
    type: string;
    currency: string;
    opening: string;
    debits: string;
    credits: string;
    balance: string;
  }>(
    `SELECT a.id,a.code,a.name,a.type,a.currency,
    coalesce(sum(l.base_debit-l.base_credit) FILTER(WHERE e.date<$2),0)::text AS opening,
    coalesce(sum(l.base_debit) FILTER(WHERE e.date BETWEEN $2 AND $3),0)::text AS debits,
    coalesce(sum(l.base_credit) FILTER(WHERE e.date BETWEEN $2 AND $3),0)::text AS credits,
    coalesce(sum(l.base_debit-l.base_credit),0)::text AS balance
    FROM accounts a LEFT JOIN (journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.status='POSTED' AND e.date<=$3)
      ON l.account_id=a.id WHERE a.organization_id=$1 AND NOT a.is_group GROUP BY a.id ORDER BY a.code`,
    [org, from, to],
    db,
  );
  const items = rows.map((r) => ({
    ...r,
    debitBalance: new Decimal(r.balance).gt(0) ? money(r.balance) : '0.00',
    creditBalance: new Decimal(r.balance).lt(0) ? money(new Decimal(r.balance).negated()) : '0.00',
  }));
  const debits = sum(items.map((r) => r.debitBalance)),
    credits = sum(items.map((r) => r.creditBalance));
  return {
    from,
    to,
    currency: 'USD',
    items,
    totalDebits: money(debits),
    totalCredits: money(credits),
    difference: money(debits.minus(credits)),
    balanced: debits.eq(credits),
  };
}
export async function balanceSheet(org: string, asOf: string, db?: Db) {
  const all = await accounts(org, asOf, db);
  const items = all
    .filter((a) => !a.is_group)
    .map((a) => ({
      ...a,
      amount: money(['ASSET', 'EXPENSE'].includes(a.type) ? a.balance : new Decimal(a.balance).negated()),
    }));
  const assets = items.filter((a) => a.type === 'ASSET'),
    liabilities = items.filter((a) => a.type === 'LIABILITY'),
    equity = items.filter((a) => a.type === 'EQUITY');
  const totalAssets = sum(assets.map((a) => a.amount)),
    totalLiabilities = sum(liabilities.map((a) => a.amount));
  // All unclosed earnings through the as-of date belong in equity, including earlier years.
  const earnings = sum(items.filter((a) => a.type === 'REVENUE').map((a) => a.amount)).minus(
    sum(items.filter((a) => a.type === 'EXPENSE').map((a) => a.amount)),
  );
  const totalEquity = sum(equity.map((a) => a.amount)).plus(earnings);
  return {
    asOf,
    currency: 'USD',
    assets,
    liabilities,
    equity,
    earnings: money(earnings),
    totalAssets: money(totalAssets),
    totalLiabilities: money(totalLiabilities),
    totalEquity: money(totalEquity),
    difference: money(totalAssets.minus(totalLiabilities).minus(totalEquity)),
    balanced: totalAssets.eq(totalLiabilities.plus(totalEquity)),
  };
}
export async function cashPosition(org: string, asOf: string, db?: Db) {
  const rows = (await accounts(org, asOf, db)).filter((a) => a.is_cash);
  return {
    asOf,
    currency: 'USD',
    valuation: 'Recorded exchange rates',
    accounts: rows,
    total: money(sum(rows.map((a) => a.balance))),
  };
}
export async function accountLedger(org: string, id: string, from: string, to: string, cursor?: string) {
  return reportSnapshot(async (db) => {
    const account = required(
      (await query('SELECT * FROM accounts WHERE organization_id=$1 AND id=$2', [org, id], db))[0],
      'Account not found',
    );
    if (account.is_group)
      throw new AppError(422, 'GROUP_LEDGER', 'Select a posting account to view its ledger');
    const totals = required(
      (
        await query<{ opening: string; closing: string }>(
          `SELECT coalesce(sum(l.base_debit-l.base_credit) FILTER (WHERE e.date<$3),0)::text AS opening,
      coalesce(sum(l.base_debit-l.base_credit),0)::text AS closing FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
      WHERE l.organization_id=$1 AND l.account_id=$2 AND e.status='POSTED' AND e.date<=$4`,
          [org, id, from, to],
          db,
        )
      )[0],
    );
    const values: unknown[] = [org, id, from, to, totals.opening];
    let filter = '';
    if (cursor) {
      try {
        const c = z
          .tuple([z.iso.date(), z.uuid(), z.uuid()])
          .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
        values.push(...c);
        filter = 'WHERE (date,entry_id,line_id)>($6::date,$7::uuid,$8::uuid)';
      } catch {
        throw new AppError(400, 'INVALID_CURSOR', 'Invalid ledger cursor');
      }
    }
    const rows = await query(
      `WITH movements AS (SELECT e.id AS entry_id,l.id AS line_id,e.number,e.date,e.description,e.counterparty,
      l.debit::text,l.credit::text,l.base_debit::text,l.base_credit::text,l.exchange_rate::text,l.currency,
      ($5::numeric+sum(l.base_debit-l.base_credit) OVER(ORDER BY e.date,e.id,l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::text AS running_balance
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.organization_id=$1 AND l.account_id=$2
      AND e.status='POSTED' AND e.date BETWEEN $3 AND $4) SELECT * FROM movements ${filter} ORDER BY date,entry_id,line_id LIMIT 51`,
      values,
      db,
    );
    const items = rows.slice(0, 50),
      last = items.at(-1);
    return {
      account,
      from,
      to,
      ...totals,
      items,
      nextCursor:
        rows.length > 50 && last
          ? Buffer.from(JSON.stringify([last.date, last.entry_id, last.line_id])).toString('base64url')
          : null,
    };
  });
}
export async function dashboard(org: string, from: string, to: string) {
  return reportSnapshot(async (db) => {
    const income = await incomeStatement(org, from, to, db),
      cash = await cashPosition(org, to, db);
    const trend = await query(
      `SELECT to_char(m,'Mon') AS label,to_char(m,'YYYY-MM') AS month,
      coalesce(sum(l.base_credit-l.base_debit) FILTER(WHERE a.type='REVENUE'),0)::text AS revenue,
      coalesce(sum(l.base_debit-l.base_credit) FILTER(WHERE a.type='EXPENSE'),0)::text AS expenses
      FROM generate_series(date_trunc('month',$2::date)-interval '5 months',date_trunc('month',$2::date),interval '1 month') m
      LEFT JOIN journal_entries e ON e.organization_id=$1 AND e.status='POSTED' AND e.date>=m AND e.date<m+interval '1 month' AND e.date<=$2
      LEFT JOIN journal_lines l ON l.entry_id=e.id LEFT JOIN accounts a ON a.id=l.account_id
      GROUP BY m ORDER BY m`,
      [org, to],
      db,
    );
    const counts = required(
      (
        await query(
          `SELECT count(*) FILTER(WHERE status='POSTED')::integer AS posted,count(*) FILTER(WHERE status='DRAFT')::integer AS drafts FROM journal_entries WHERE organization_id=$1`,
          [org],
          db,
        )
      )[0],
    );
    const alertCount = Number(
      (
        await query("SELECT count(*) AS n FROM alerts WHERE organization_id=$1 AND status='OPEN'", [org], db)
      )[0].n,
    );
    return { from, to, income, cash, trend, counts, alertCount };
  });
}
