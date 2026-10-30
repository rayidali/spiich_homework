import { query, transaction } from './db';
import { getEntry } from './ledger';
import { Decimal, money } from '../shared/money';

export async function analyzeEntry(org: string, id: string) {
  const entry = await getEntry(org, id);
  if (entry.status !== 'POSTED' || entry.source === 'REVERSAL' || entry.reversal_id) return;
  async function alert(
    rule: string,
    severity: string,
    title: string,
    explanation: string,
    evidence: unknown,
  ) {
    await query(
      `INSERT INTO alerts(organization_id,entry_id,rule,severity,title,explanation,evidence) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(entry_id,rule) DO UPDATE SET title=EXCLUDED.title,explanation=EXCLUDED.explanation,evidence=EXCLUDED.evidence`,
      [org, id, rule, severity, title, explanation, JSON.stringify(evidence)],
    );
  }
  const duplicates = await query(
    `SELECT e.id,e.number,e.date FROM journal_entries e WHERE e.organization_id=$1 AND e.status='POSTED'
    AND e.id<>$2 AND e.source<>'REVERSAL' AND lower(e.counterparty)=lower($3) AND e.date BETWEEN $4::date-3 AND $4::date+3
    AND NOT EXISTS(SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id=e.id AND r.status='POSTED')
    AND (SELECT sum(base_debit) FROM journal_lines WHERE entry_id=e.id)=$5::numeric
    AND (SELECT array_agg(account_id ORDER BY account_id) FROM journal_lines WHERE entry_id=e.id)=(SELECT array_agg(account_id ORDER BY account_id) FROM journal_lines WHERE entry_id=$2)
    ORDER BY e.date LIMIT 3`,
    [org, id, entry.counterparty, entry.date, entry.total],
  );
  if (entry.counterparty && duplicates.length)
    await alert(
      'POSSIBLE_DUPLICATE',
      'WARNING',
      'This payment looks familiar',
      `${entry.counterparty} has another entry for $${money(entry.total)} within three days. Review both records before deciding whether this is a duplicate.`,
      { relatedEntries: duplicates, amount: money(entry.total), windowDays: 3 },
    );
  const expenseLines = await query<{ account_id: string; name: string; amount: string; currency: string }>(
    `SELECT a.id AS account_id,a.name,l.currency,sum(l.debit-l.credit)::text AS amount
    FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=$1 AND a.type='EXPENSE' GROUP BY a.id,l.currency`,
    [id],
  );
  for (const line of expenseLines) {
    if (new Decimal(line.amount).lte(0)) continue;
    const samples = await query<{ amount: string }>(
      `SELECT sum(l.debit-l.credit)::text AS amount FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
      WHERE l.organization_id=$1 AND l.account_id=$2 AND e.status='POSTED' AND e.date<$3 AND e.date>=$3::date-365
      AND e.source<>'REVERSAL' AND lower(e.counterparty)=lower($4)
      AND NOT EXISTS(SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id=e.id AND r.status='POSTED')
      GROUP BY e.id ORDER BY e.date DESC LIMIT 24`,
      [org, line.account_id, entry.date, entry.counterparty],
    );
    const values = samples
      .map((s) => new Decimal(s.amount))
      .filter((s) => s.gt(0))
      .sort((a, b) => a.cmp(b));
    if (values.length >= 4) {
      const middle = Math.floor(values.length / 2),
        median = values.length % 2 ? values[middle] : values[middle - 1].plus(values[middle]).div(2);
      const amount = new Decimal(line.amount),
        ratio = amount.div(median);
      if (ratio.gte('1.75') && amount.minus(median).gte(50))
        await alert(
          `UNUSUAL_AMOUNT:${line.account_id}`,
          'HIGH',
          `${line.name} is above its usual range`,
          `${entry.counterparty || line.name} is ${ratio.toFixed(1)}× its typical amount: ${line.currency} ${money(amount)} compared with a median of ${money(median)} across ${values.length} previous entries.`,
          {
            accountId: line.account_id,
            currency: line.currency,
            observed: money(amount),
            median: money(median),
            sampleCount: values.length,
            ratio: ratio.toFixed(2),
          },
        );
    }
  }
  if (entry.counterparty) {
    const unusual = await query<{ account_id: string; name: string; n: string }>(
      `SELECT a.id AS account_id,a.name,count(DISTINCT e.id)::text AS n
      FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
      WHERE e.organization_id=$1 AND e.status='POSTED' AND e.date<$2 AND e.date>=$2::date-365
      AND lower(e.counterparty)=lower($3) AND a.type='EXPENSE' AND e.source<>'REVERSAL'
      GROUP BY a.id ORDER BY count(DISTINCT e.id) DESC LIMIT 1`,
      [org, entry.date, entry.counterparty],
    );
    const typical = unusual[0];
    if (
      typical &&
      Number(typical.n) >= 4 &&
      expenseLines.length &&
      !expenseLines.some((l) => l.account_id === typical.account_id)
    )
      await alert(
        'UNUSUAL_CATEGORY',
        'INFO',
        'A different category than usual',
        `${entry.counterparty} used ${typical.name} in ${typical.n} earlier entries. This entry uses a different expense account.`,
        { typicalAccountId: typical.account_id, sampleCount: Number(typical.n) },
      );
  }
}

export async function processJobs(organizationId?: string) {
  const values = organizationId ? [organizationId] : [],
    scope = organizationId ? ' AND organization_id=$1' : '';
  const jobs = await transaction(async (db) => {
    await query(
      `UPDATE jobs SET status='FAILED',last_error='Worker lease expired after the final attempt',locked_at=NULL
      WHERE status='RUNNING' AND locked_at<now()-interval '2 minutes' AND attempts>=5 ${scope}`,
      values,
      db,
    );
    return query(
      `WITH candidates AS (
      SELECT id FROM jobs WHERE ((status='PENDING' AND run_after<=now()) OR (status='RUNNING' AND locked_at<now()-interval '2 minutes')) ${scope}
      ORDER BY id LIMIT 4 FOR UPDATE SKIP LOCKED)
    UPDATE jobs j SET status='RUNNING',locked_at=now(),lease_token=gen_random_uuid(),attempts=attempts+1
    FROM candidates c WHERE j.id=c.id RETURNING j.*`,
      values,
      db,
    );
  });
  await Promise.all(
    jobs.map(async (job) => {
      // Slow analysis retains its lease. If the process dies, another worker can
      // reclaim it; unique alert keys make repeated analysis safe.
      const heartbeat = setInterval(() => {
        void query("UPDATE jobs SET locked_at=now() WHERE id=$1 AND lease_token=$2 AND status='RUNNING'", [
          job.id,
          job.lease_token,
        ]).catch((error) =>
          console.error(
            JSON.stringify({
              event: 'job_heartbeat_failed',
              jobId: job.id,
              message: error instanceof Error ? error.message : String(error),
            }),
          ),
        );
      }, 30000);
      try {
        await analyzeEntry(job.organization_id, job.entry_id);
        await query("UPDATE jobs SET status='DONE',locked_at=NULL WHERE id=$1 AND lease_token=$2", [
          job.id,
          job.lease_token,
        ]);
      } catch (error) {
        await query(
          `UPDATE jobs SET status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,
        run_after=now()+interval '10 seconds'*power(2,least(attempts,5)),last_error=$3,locked_at=NULL WHERE id=$1 AND lease_token=$2`,
          [
            job.id,
            job.lease_token,
            error instanceof Error ? error.message.slice(0, 500) : 'Unknown job failure',
          ],
        );
      } finally {
        clearInterval(heartbeat);
      }
    }),
  );
  return jobs.length;
}
