import { query, transaction, type Db } from './db';
import { getEntry } from './ledger';
import { Decimal, money } from '../shared/money';
import type { Entry } from '../shared/schema';
import { diagnostic } from './diagnostics';
import { databaseCode } from './errors';

const refreshBatchSize = 50;
type AnalysisJob = {
  id: string;
  organization_id: string;
  entry_id: string;
  lease_token: string;
  anomaly_refresh_cursor: string | null;
  anomaly_refresh_complete: boolean;
  refresh_entry_id: string | null;
};

async function resolveAlerts(
  db: Db,
  org: string,
  entryId: string,
  activeRules: string[],
  reason: 'ENTRY_REVERSED' | 'NO_LONGER_MATCHES',
  reversalId: string | null,
) {
  await query(
    `UPDATE alerts SET status=CASE WHEN status='OPEN' THEN 'RESOLVED' ELSE status END,
      resolved_at=now(),resolution_reason=$4,resolution_entry_id=$5
    WHERE organization_id=$1 AND entry_id=$2 AND NOT(rule=ANY($3::text[])) AND resolved_at IS NULL`,
    [org, entryId, activeRules, reason, reversalId],
    db,
  );
}

async function reconcileEntry(db: Db, org: string, id: string, refreshEntryId: string | null = null) {
  // All analysis of an entry uses the same lock and commits its complete alert set together.
  await query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':alerts:' || $2,0))", [org, id], db);
  const entry = await getEntry(org, id, db);
  if (entry.status !== 'POSTED' || entry.source === 'REVERSAL') return;
  if (entry.reversal_id) {
    await resolveAlerts(db, org, id, [], 'ENTRY_REVERSED', entry.reversal_id);
    return;
  }
  const activeRules: string[] = [];
  async function alert(
    rule: string,
    severity: string,
    title: string,
    explanation: string,
    evidence: unknown,
  ) {
    activeRules.push(rule);
    await query(
      `INSERT INTO alerts(organization_id,entry_id,rule,severity,title,explanation,evidence) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(entry_id,rule) DO UPDATE SET title=EXCLUDED.title,explanation=EXCLUDED.explanation,
      severity=EXCLUDED.severity,evidence=EXCLUDED.evidence,
      status=CASE WHEN alerts.status='RESOLVED' THEN 'OPEN' ELSE alerts.status END,
      resolved_at=NULL,resolution_reason=NULL,resolution_entry_id=NULL`,
      [org, id, rule, severity, title, explanation, JSON.stringify(evidence)],
      db,
    );
  }
  const duplicates = await query(
    `SELECT e.id,e.number,e.date FROM journal_entries e WHERE e.organization_id=$1 AND e.status='POSTED'
    AND e.id<>$2 AND e.source<>'REVERSAL' AND lower(e.counterparty)=lower($3) AND e.date BETWEEN $4::date-3 AND $4::date+3
    AND NOT EXISTS(SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id=e.id AND r.status='POSTED')
    AND (SELECT sum(base_debit) FROM journal_lines WHERE entry_id=e.id)=$5::numeric
    AND (SELECT array_agg(account_id ORDER BY account_id) FROM journal_lines WHERE entry_id=e.id)=(SELECT array_agg(account_id ORDER BY account_id) FROM journal_lines WHERE entry_id=$2)
    ORDER BY e.date,e.id LIMIT 3`,
    [org, id, entry.counterparty, entry.date, entry.total],
    db,
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
    db,
  );
  for (const line of expenseLines) {
    if (new Decimal(line.amount).lte(0)) continue;
    const samples = await query<{ amount: string }>(
      `SELECT sum(l.debit-l.credit)::text AS amount FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
      WHERE l.organization_id=$1 AND l.account_id=$2 AND e.status='POSTED' AND e.date<$3 AND e.date>=$3::date-365
      AND e.source<>'REVERSAL' AND lower(e.counterparty)=lower($4)
      AND NOT EXISTS(SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id=e.id AND r.status='POSTED')
      GROUP BY e.id ORDER BY e.date DESC,e.id DESC LIMIT 24`,
      [org, line.account_id, entry.date, entry.counterparty],
      db,
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
      AND NOT EXISTS(SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id=e.id AND r.status='POSTED')
      GROUP BY a.id ORDER BY count(DISTINCT e.id) DESC,a.id LIMIT 1`,
      [org, entry.date, entry.counterparty],
      db,
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
  await resolveAlerts(db, org, id, activeRules, 'NO_LONGER_MATCHES', refreshEntryId);
}

export async function analyzeEntry(org: string, id: string) {
  await transaction((db) => reconcileEntry(db, org, id));
}

async function refreshAfterReversal(db: Db, job: AnalysisJob, reversal: Entry) {
  if (!reversal.reverses_entry_id) return true;
  const original = await getEntry(job.organization_id, reversal.reverses_entry_id, db);
  if (job.anomaly_refresh_complete) {
    await reconcileEntry(db, job.organization_id, original.id);
    return true;
  }
  // Duplicate comparisons look three days either way; historical rules look back 365 days.
  // New entries posted during the scan have their own outbox job and see the reversal.
  const candidates = await query<{ id: string }>(
    `SELECT e.id FROM journal_entries e WHERE e.organization_id=$1 AND e.status='POSTED'
      AND e.source<>'REVERSAL' AND e.id<>$2 AND lower(e.counterparty)=lower($3)
      AND e.date BETWEEN $4::date-3 AND $4::date+365
      AND ($5::uuid IS NULL OR e.id>$5::uuid)
      AND NOT EXISTS(SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id=e.id AND r.status='POSTED')
      ORDER BY e.id LIMIT $6`,
    [
      job.organization_id,
      original.id,
      original.counterparty,
      original.date,
      job.anomaly_refresh_cursor,
      refreshBatchSize + 1,
    ],
    db,
  );
  const page = candidates.slice(0, refreshBatchSize);
  if (page.length)
    await query(
      `INSERT INTO jobs(organization_id,entry_id,refresh_entry_id)
       SELECT $1,x.id,$3 FROM unnest($2::uuid[]) AS x(id) ORDER BY x.id
       ON CONFLICT(entry_id,kind) DO UPDATE SET status='PENDING',attempts=0,run_after=now(),
         locked_at=NULL,lease_token=NULL,last_error=NULL,refresh_entry_id=EXCLUDED.refresh_entry_id`,
      [job.organization_id, page.map((entry) => entry.id), reversal.id],
      db,
    );
  const complete = candidates.length <= refreshBatchSize;
  await query(
    'UPDATE jobs SET anomaly_refresh_cursor=$2,anomaly_refresh_complete=$3 WHERE id=$1',
    [job.id, page.at(-1)?.id ?? job.anomaly_refresh_cursor, complete],
    db,
  );
  // Acquire dependent job rows before the original's alert lock, matching workers' job→alert order.
  await reconcileEntry(db, job.organization_id, original.id);
  return complete;
}

// Exported for worker-level integration tests: a stale claim cannot write alerts or acknowledge new work.
export async function processClaimedAnalysisJob(claim: Pick<AnalysisJob, 'id' | 'lease_token'>) {
  return transaction(async (db) => {
    const job = (
      await query<AnalysisJob>(
        "SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 AND status='RUNNING' FOR UPDATE",
        [claim.id, claim.lease_token],
        db,
      )
    )[0];
    if (!job) return false;
    const entry = await getEntry(job.organization_id, job.entry_id, db);
    const complete =
      entry.source === 'REVERSAL'
        ? await refreshAfterReversal(db, job, entry)
        : (await reconcileEntry(db, job.organization_id, job.entry_id, job.refresh_entry_id), true);
    await query(
      `UPDATE jobs SET status=$3,locked_at=NULL,lease_token=NULL,last_error=NULL,
         attempts=CASE WHEN $3='PENDING' THEN 0 ELSE attempts END,run_after=now()
       WHERE id=$1 AND lease_token=$2`,
      [job.id, job.lease_token, complete ? 'DONE' : 'PENDING'],
      db,
    );
    return true;
  });
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
    return query<AnalysisJob>(
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
          diagnostic('worker_error', {
            code: 'WORKER_ERROR',
            stage: 'background',
            operation: 'anomaly_heartbeat',
            jobId: String(job.id),
            databaseCode: databaseCode(error),
          }),
        );
      }, 30000);
      try {
        await processClaimedAnalysisJob(job);
      } catch (error) {
        const safeCode = databaseCode(error);
        diagnostic('worker_error', {
          code: 'WORKER_ERROR',
          stage: 'background',
          operation: 'anomaly_analysis',
          jobId: String(job.id),
          databaseCode: safeCode,
        });
        await query(
          `UPDATE jobs SET status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,
        run_after=now()+interval '10 seconds'*power(2,least(attempts,5)),last_error=$3,locked_at=NULL,
        lease_token=NULL WHERE id=$1 AND lease_token=$2 AND status='RUNNING'`,
          [
            job.id,
            job.lease_token,
            `Entry analysis failed${safeCode ? ` (${safeCode})` : ''}. See worker diagnostics.`,
          ],
        );
      } finally {
        clearInterval(heartbeat);
      }
    }),
  );
  return jobs.length;
}
