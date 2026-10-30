import { createHash, randomUUID } from 'node:crypto';
import { query, transaction } from './db';
import { insertEntry, validateLines, assertBalanced } from './ledger';
import { today } from './reports';
import { AppError, required } from './errors';
import type { RecurringInput, RecurringTemplate } from '../shared/schema';

// Keep the original calendar anchor: Jan 31 -> Feb 28 -> Mar 31.
export function nextOccurrence(current: string, anchor: string, frequency: string) {
  const [year, month, day] = current.split('-').map(Number),
    [, anchorMonth, anchorDay] = anchor.split('-').map(Number);
  if (frequency === 'WEEKLY') return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  const targetYear = frequency === 'YEARLY' ? year + 1 : month === 12 ? year + 1 : year;
  const targetMonth = frequency === 'YEARLY' ? anchorMonth : month === 12 ? 1 : month + 1;
  const last = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth - 1, Math.min(anchorDay, last)))
    .toISOString()
    .slice(0, 10);
}

function validateDates(input: RecurringInput) {
  if (input.endDate && input.endDate < input.anchorDate)
    throw new AppError(422, 'INVALID_SCHEDULE', 'End date must not precede the first occurrence');
}

export async function createRecurring(org: string, input: RecurringInput, key: string = randomUUID()) {
  validateDates(input);
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return transaction(async (db) => {
    // Bound the management surface and serialize quota checks for this organization.
    await query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':recurring',0))", [org], db);
    const existing = (
      await query<RecurringTemplate & { request_hash: string }>(
        'SELECT * FROM recurring_templates WHERE organization_id=$1 AND request_key=$2',
        [org, key],
        db,
      )
    )[0];
    if (existing) {
      if (existing.request_hash !== hash)
        throw new AppError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This request key was already used with different contents',
        );
      return existing;
    }
    if (
      Number(
        (await query('SELECT count(*) AS n FROM recurring_templates WHERE organization_id=$1', [org], db))[0]
          .n,
      ) >= 200
    )
      throw new AppError(422, 'SCHEDULE_LIMIT', 'This workspace supports up to 200 schedules');
    assertBalanced(await validateLines(org, input.lines, db));
    return (
      await query<RecurringTemplate>(
        `INSERT INTO recurring_templates(organization_id,name,description,counterparty,frequency,anchor_date,next_date,end_date,lines,request_key,request_hash)
      VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10) RETURNING *`,
        [
          org,
          input.name,
          input.description,
          input.counterparty,
          input.frequency,
          input.anchorDate,
          input.endDate,
          JSON.stringify(input.lines),
          key,
          hash,
        ],
        db,
      )
    )[0];
  });
}

export async function updateRecurring(
  org: string,
  id: string,
  input: RecurringInput,
  expectedRevision: number,
) {
  validateDates(input);
  return transaction(async (db) => {
    const previous = required(
      (
        await query<RecurringTemplate>(
          'SELECT * FROM recurring_templates WHERE organization_id=$1 AND id=$2 FOR UPDATE',
          [org, id],
          db,
        )
      )[0],
    );
    if (previous.revision !== expectedRevision)
      throw new AppError(
        409,
        'STALE_SCHEDULE',
        'This schedule changed. Reload it before saving your changes.',
      );
    if (previous.anchor_date !== input.anchorDate || previous.frequency !== input.frequency)
      throw new AppError(
        422,
        'SCHEDULE_ANCHOR_FIXED',
        'Create a new schedule to change its frequency or original calendar anchor',
      );
    assertBalanced(await validateLines(org, input.lines, db));
    return (
      await query<RecurringTemplate>(
        `UPDATE recurring_templates SET name=$3,description=$4,counterparty=$5,end_date=$6,lines=$7,last_error=NULL,
      active=active AND ($6::date IS NULL OR next_date<=$6::date) WHERE organization_id=$1 AND id=$2 RETURNING *`,
        [
          org,
          id,
          input.name,
          input.description,
          input.counterparty,
          input.endDate,
          JSON.stringify(input.lines),
        ],
        db,
      )
    )[0];
  });
}

export async function generateRecurring(org: string, asOf = today()) {
  return transaction(async (db) => {
    const templates = await query<RecurringTemplate>(
      `SELECT * FROM recurring_templates WHERE organization_id=$1 AND active AND next_date<=$2
      ORDER BY next_date,id LIMIT 20 FOR UPDATE SKIP LOCKED`,
      [org, asOf],
      db,
    );
    let generated = 0,
      failed = 0;
    for (const t of templates) {
      if (generated >= 50) break;
      await query('SAVEPOINT occurrence_batch', [], db);
      let date = t.next_date,
        templateCount = 0;
      try {
        // Limits keep long catch-ups from monopolizing workers.
        while (
          date <= asOf &&
          generated + templateCount < 50 &&
          templateCount < 10 &&
          (!t.end_date || date <= t.end_date)
        ) {
          await insertEntry(
            db,
            org,
            {
              date,
              description: t.description,
              counterparty: t.counterparty,
              reference: '',
              source: 'MANUAL',
              lines: t.lines,
            },
            `recurring:${t.id}:${date}`,
            { source: 'RECURRING', templateId: t.id, occurrenceDate: date },
          );
          templateCount++;
          date = nextOccurrence(date, t.anchor_date, t.frequency);
        }
        await query(
          'UPDATE recurring_templates SET next_date=$2,active=$3,last_error=NULL WHERE id=$1',
          [t.id, date, !t.end_date || date <= t.end_date],
          db,
        );
        await query('RELEASE SAVEPOINT occurrence_batch', [], db);
        generated += templateCount;
      } catch (error) {
        await query('ROLLBACK TO SAVEPOINT occurrence_batch', [], db);
        await query('RELEASE SAVEPOINT occurrence_batch', [], db);
        // Only this template pauses; its partial entries and date advances roll back.
        const message =
          error instanceof AppError
            ? error.message
            : 'Could not generate this schedule. Review the template and resume it to retry.';
        await query(
          'UPDATE recurring_templates SET active=false,last_error=$2 WHERE id=$1',
          [t.id, message.slice(0, 500)],
          db,
        );
        console.error(
          JSON.stringify({
            event: 'recurring_generation_failed',
            organizationId: org,
            templateId: t.id,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        failed++;
      }
    }
    return { generated, failed };
  });
}
