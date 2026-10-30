import { createHash } from 'node:crypto';
import { z } from 'zod';
import { query, transaction, type Db } from './db';
import { AppError, required } from './errors';
import { Decimal, baseAmount, sum } from '../shared/money';
import { type Account, type Entry, type EntryInput, type LineInput } from '../shared/schema';

const lineJson = `jsonb_build_object('id',l.id,'account_id',l.account_id,'account_name',a.name,'account_code',a.code,
  'currency',l.currency,'debit',l.debit::text,'credit',l.credit::text,'exchange_rate',l.exchange_rate::text,
  'base_debit',l.base_debit::text,'base_credit',l.base_credit::text,'memo',l.memo)`;
const entrySelect = `SELECT e.*,
  coalesce((SELECT sum(base_debit)::text FROM journal_lines WHERE entry_id=e.id),'0') AS total,
  (SELECT id FROM journal_entries WHERE reverses_entry_id=e.id AND status='POSTED') AS reversal_id,
  coalesce((SELECT jsonb_agg(${lineJson} ORDER BY l.position) FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=e.id),'[]') AS lines
  FROM journal_entries e`;

export async function getEntry(org: string, id: string, db?: Db) {
  return required(
    (await query<Entry>(`${entrySelect} WHERE e.organization_id=$1 AND e.id=$2`, [org, id], db))[0],
    'Journal entry not found',
  );
}
export async function accounts(org: string, asOf = '9999-12-31', db?: Db) {
  return query<Account>(
    `SELECT a.*,coalesce(b.balance,0)::text AS balance,coalesce(b.native_balance,0)::text AS native_balance
    FROM accounts a LEFT JOIN (
      SELECT l.account_id,sum(l.base_debit-l.base_credit) AS balance,sum(l.debit-l.credit) AS native_balance
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
      WHERE e.organization_id=$1 AND e.status='POSTED' AND e.date<=$2 GROUP BY l.account_id
    ) b ON b.account_id=a.id WHERE a.organization_id=$1 ORDER BY a.code`,
    [org, asOf],
    db,
  );
}

export async function validateLines(org: string, lines: LineInput[], db?: Db, allowArchived = false) {
  const accountRows = await query<Account>(
    'SELECT * FROM accounts WHERE organization_id=$1 AND id=ANY($2::uuid[])',
    [org, lines.map((l) => l.accountId)],
    db,
  );
  const byId = new Map(accountRows.map((a) => [a.id, a]));
  return lines.map((line, i) => {
    const a = byId.get(line.accountId);
    if (!a || a.is_group || (a.archived && !allowArchived))
      throw new AppError(422, 'INVALID_ACCOUNT', `Line ${i + 1}: choose an active posting account`);
    const debit = new Decimal(line.debit),
      credit = new Decimal(line.credit),
      rate = new Decimal(line.exchangeRate);
    if (!((debit.gt(0) && credit.eq(0)) || (credit.gt(0) && debit.eq(0))))
      throw new AppError(
        422,
        'INVALID_AMOUNT',
        `Line ${i + 1}: enter either a positive debit or a positive credit`,
      );
    if (debit.gte('100000000000000') || credit.gte('100000000000000') || rate.lte(0) || rate.gte(1000000))
      throw new AppError(422, 'INVALID_AMOUNT', 'Amount or exchange rate is outside the supported range');
    const places = a.currency === 'JPY' ? 0 : 2;
    if (debit.decimalPlaces() > places || credit.decimalPlaces() > places)
      throw new AppError(
        422,
        'CURRENCY_PRECISION',
        `${a.currency} amounts require at most ${places} decimal places`,
      );
    if (a.currency === 'USD' && !rate.eq(1))
      throw new AppError(422, 'INVALID_EXCHANGE_RATE', 'USD accounts must use an exchange rate of 1');
    const baseDebit = baseAmount(line.debit, line.exchangeRate),
      baseCredit = baseAmount(line.credit, line.exchangeRate);
    if (new Decimal(baseDebit).plus(baseCredit).eq(0))
      throw new AppError(422, 'AMOUNT_TOO_SMALL', 'A line must have a nonzero base-currency value');
    return { ...line, currency: a.currency, baseDebit, baseCredit };
  });
}
export function assertBalanced(lines: { baseDebit: string; baseCredit: string }[]) {
  const debits = sum(lines.map((l) => l.baseDebit)),
    credits = sum(lines.map((l) => l.baseCredit));
  if (!debits.eq(credits))
    throw new AppError(
      422,
      'UNBALANCED_ENTRY',
      `Debits are $${debits.toFixed(2)} and credits are $${credits.toFixed(2)}. Difference: $${debits.minus(credits).abs().toFixed(2)}.`,
      { debits: debits.toFixed(2), credits: credits.toFixed(2) },
    );
}

type CreateOptions = {
  post?: boolean;
  source?: string;
  reversesId?: string;
  templateId?: string;
  occurrenceDate?: string;
  allowArchived?: boolean;
};
export async function insertEntry(
  db: Db,
  org: string,
  input: EntryInput,
  key: string,
  options: CreateOptions = {},
) {
  const requestHash = createHash('sha256').update(JSON.stringify({ input, options })).digest('hex');
  const rows = await query<{ id: string }>(
    `INSERT INTO journal_entries(organization_id,date,description,counterparty,reference,source,idempotency_key,request_hash,reverses_entry_id,recurring_template_id,occurrence_date)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(organization_id,idempotency_key) DO NOTHING RETURNING id`,
    [
      org,
      input.date,
      input.description,
      input.counterparty,
      input.reference,
      options.source ?? input.source,
      key,
      requestHash,
      options.reversesId ?? null,
      options.templateId ?? null,
      options.occurrenceDate ?? null,
    ],
    db,
  );
  if (!rows[0]) {
    const existing = required(
      (
        await query<{ id: string; request_hash: string }>(
          'SELECT id,request_hash FROM journal_entries WHERE organization_id=$1 AND idempotency_key=$2',
          [org, key],
          db,
        )
      )[0],
    );
    if (existing.request_hash !== requestHash)
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This request key was already used with different contents',
      );
    return existing.id;
  }
  const id = rows[0].id;
  const lines = await validateLines(org, input.lines, db, options.allowArchived);
  if (options.post) assertBalanced(lines);
  for (const [i, line] of lines.entries())
    await query(
      `INSERT INTO journal_lines(organization_id,entry_id,account_id,position,currency,debit,credit,exchange_rate,memo)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [org, id, line.accountId, i, line.currency, line.debit, line.credit, line.exchangeRate, line.memo],
      db,
    );
  if (options.post)
    await query("UPDATE journal_entries SET status='POSTED',posted_at=now() WHERE id=$1", [id], db);
  return id;
}
export async function createEntry(org: string, input: EntryInput, key: string, options: CreateOptions = {}) {
  const id = await transaction((db) => insertEntry(db, org, input, key, options));
  return getEntry(org, id);
}
export async function postEntry(
  org: string,
  id: string,
  expectedRevision?: number,
  exchangeRatesConfirmed = false,
) {
  await transaction(async (db) => {
    const entry = required(
      (
        await query<{ status: string; revision: number }>(
          'SELECT status,revision FROM journal_entries WHERE organization_id=$1 AND id=$2 FOR UPDATE',
          [org, id],
          db,
        )
      )[0],
    );
    if (entry.status === 'POSTED') return;
    if (expectedRevision !== undefined && entry.revision !== expectedRevision)
      throw new AppError(
        409,
        'STALE_DRAFT',
        'This draft changed after you opened it. Reload and review the latest version before posting.',
      );
    const draft = await getEntry(org, id, db);
    if (
      draft.source === 'RECURRING' &&
      draft.lines.some((line) => line.currency !== 'USD') &&
      !exchangeRatesConfirmed
    )
      throw new AppError(
        422,
        'CONFIRM_EXCHANGE_RATES',
        'Review and confirm the exchange rates for this recurring occurrence before posting',
      );
    const lines = await validateLines(
      org,
      draft.lines.map((l) => ({
        accountId: l.account_id,
        debit: l.debit,
        credit: l.credit,
        exchangeRate: l.exchange_rate,
        memo: l.memo,
      })),
      db,
    );
    assertBalanced(lines);
    await query(
      "UPDATE journal_entries SET status='POSTED',posted_at=now() WHERE organization_id=$1 AND id=$2",
      [org, id],
      db,
    );
  });
  return getEntry(org, id);
}
export async function updateDraft(org: string, id: string, input: EntryInput, expectedRevision: number) {
  await transaction(async (db) => {
    const entry = required(
      (
        await query<{ status: string; revision: number }>(
          'SELECT status,revision FROM journal_entries WHERE organization_id=$1 AND id=$2 FOR UPDATE',
          [org, id],
          db,
        )
      )[0],
    );
    if (entry.status !== 'DRAFT')
      throw new AppError(409, 'IMMUTABLE_ENTRY', 'Posted entries can only be corrected through a reversal');
    if (entry.revision !== expectedRevision)
      throw new AppError(
        409,
        'STALE_DRAFT',
        'This draft was changed in another session. Reload it before saving your changes.',
      );
    const lines = await validateLines(org, input.lines, db);
    await query('DELETE FROM journal_lines WHERE organization_id=$1 AND entry_id=$2', [org, id], db);
    await query(
      'UPDATE journal_entries SET date=$3,description=$4,counterparty=$5,reference=$6 WHERE organization_id=$1 AND id=$2',
      [org, id, input.date, input.description, input.counterparty, input.reference],
      db,
    );
    for (const [i, line] of lines.entries())
      await query(
        `INSERT INTO journal_lines(organization_id,entry_id,account_id,position,currency,debit,credit,exchange_rate,memo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [org, id, line.accountId, i, line.currency, line.debit, line.credit, line.exchangeRate, line.memo],
        db,
      );
  });
  return getEntry(org, id);
}
export async function reverseEntry(org: string, id: string, date: string, key: string) {
  const original = await getEntry(org, id);
  if (original.status !== 'POSTED')
    throw new AppError(422, 'NOT_POSTED', 'Only posted entries can be reversed');
  if (date < original.date)
    throw new AppError(422, 'INVALID_REVERSAL_DATE', 'Reversal date cannot precede the original entry');
  const input: EntryInput = {
    date,
    description: `Reversal: ${original.description}`.slice(0, 500),
    counterparty: original.counterparty,
    reference: original.reference,
    source: 'MANUAL',
    lines: original.lines.map((l) => ({
      accountId: l.account_id,
      debit: l.credit,
      credit: l.debit,
      exchangeRate: l.exchange_rate,
      memo: l.memo,
    })),
  };
  return createEntry(org, input, key, {
    post: true,
    source: 'REVERSAL',
    reversesId: id,
    allowArchived: true,
  });
}

export type EntryFilter = {
  from?: string;
  to?: string;
  search?: string;
  status?: string;
  accountId?: string;
  currency?: string;
  cursor?: string;
  limit?: number;
};
export async function listEntries(org: string, filter: EntryFilter = {}) {
  const values: unknown[] = [org],
    conditions = ['e.organization_id=$1'];
  const where = (sql: string, value: unknown) => {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  };
  if (filter.from) where('e.date>=?::date', filter.from);
  if (filter.to) where('e.date<=?::date', filter.to);
  if (filter.status) where('e.status=?', filter.status);
  if (filter.search)
    where(
      "(e.description || ' ' || e.counterparty || ' ' || e.reference) ILIKE ?",
      `%${filter.search.replace(/[\\%_]/g, '\\$&')}%`,
    );
  if (filter.accountId)
    where(
      'EXISTS(SELECT 1 FROM journal_lines x WHERE x.entry_id=e.id AND x.account_id=?::uuid)',
      filter.accountId,
    );
  if (filter.currency)
    where('EXISTS(SELECT 1 FROM journal_lines x WHERE x.entry_id=e.id AND x.currency=?)', filter.currency);
  if (filter.cursor) {
    try {
      const [date, id] = z
        .tuple([z.iso.date(), z.uuid()])
        .parse(JSON.parse(Buffer.from(filter.cursor, 'base64url').toString()));
      values.push(date, id);
      conditions.push(`(e.date,e.id)<($${values.length - 1}::date,$${values.length}::uuid)`);
    } catch {
      throw new AppError(400, 'INVALID_CURSOR', 'The page cursor is invalid');
    }
  }
  const limit = Math.min(filter.limit ?? 25, 100);
  values.push(limit + 1);
  const rows = await query<Entry>(
    `${entrySelect} WHERE ${conditions.join(' AND ')} ORDER BY e.date DESC,e.id DESC LIMIT $${values.length}`,
    values,
  );
  const hasMore = rows.length > limit,
    items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items,
    nextCursor:
      hasMore && last ? Buffer.from(JSON.stringify([last.date, last.id])).toString('base64url') : null,
  };
}
