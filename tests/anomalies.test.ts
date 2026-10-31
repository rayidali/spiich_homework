import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { config } from '../server/config';
import * as database from '../server/db';
import { query, pool, type Db } from '../server/db';
import { seedChart } from '../scripts/seed';
import { accounts, createEntry, getEntry, reverseEntry } from '../server/ledger';
import { analyzeEntry, processClaimedAnalysisJob, processJobs } from '../server/anomalies';

// Real PostgreSQL integration tests; each case owns its own synthetic workspace.
const admin = new pg.Client({ connectionString: config.migrationUrl });
let org: string, ids: Record<string, string>;
beforeAll(() => admin.connect());
beforeEach(async () => {
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Anomaly lifecycle test')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await admin.end();
  await pool.end();
});

async function post(code: string, amount: string, date: string, vendor = 'Lifecycle merchant') {
  return createEntry(
    org,
    {
      date,
      description: 'Synthetic lifecycle purchase',
      counterparty: vendor,
      reference: '',
      source: 'MANUAL',
      lines: [
        { accountId: ids[code], debit: amount, credit: '0', exchangeRate: '1', memo: '' },
        { accountId: ids['1010'], debit: '0', credit: amount, exchangeRate: '1', memo: '' },
      ],
    },
    randomUUID(),
    { post: true },
  );
}
async function history(count = 4, code = '5010', amount = '1000') {
  const entries = [];
  for (let month = 1; month <= count; month++)
    entries.push(await post(code, amount, `2026-${String(month).padStart(2, '0')}-01`));
  return entries;
}
async function alerts(entryId: string) {
  return query('SELECT * FROM alerts WHERE organization_id=$1 AND entry_id=$2 ORDER BY rule', [org, entryId]);
}
async function finishExistingJobs() {
  // Establish the pre-reversal fixture state without asking the worker to rerun setup entries.
  await query("UPDATE jobs SET status='DONE',locked_at=NULL,lease_token=NULL WHERE organization_id=$1", [
    org,
  ]);
}
async function claim(entryId: string) {
  return (
    await query<{ id: string; lease_token: string }>(
      `UPDATE jobs SET status='RUNNING',lease_token=$3,locked_at=now(),attempts=attempts+1
       WHERE organization_id=$1 AND entry_id=$2 RETURNING id,lease_token`,
      [org, entryId, randomUUID()],
    )
  )[0];
}
async function drain() {
  for (let attempt = 0; attempt < 80; attempt++) {
    const unfinished = await query("SELECT status FROM jobs WHERE organization_id=$1 AND status<>'DONE'", [
      org,
    ]);
    expect(unfinished.some((job) => job.status === 'FAILED')).toBe(false);
    if (!unfinished.length) return;
    await processJobs(org);
  }
  throw new Error('Synthetic anomaly queue did not drain');
}

describe('Reversal-aware anomaly histories', () => {
  it('excludes reversed category examples while retaining valid older examples', async () => {
    const reversed = await history();
    for (const entry of reversed) await reverseEntry(org, entry.id, '2026-05-01', randomUUID());
    const candidate = await post('5020', '1000', '2026-06-01');
    await analyzeEntry(org, candidate.id);
    expect((await alerts(candidate.id)).some((alert) => alert.rule === 'UNUSUAL_CATEGORY')).toBe(false);

    for (const day of ['01', '08', '15', '22']) await post('5030', '1000', `2025-12-${day}`);
    await analyzeEntry(org, candidate.id);
    const category = (await alerts(candidate.id)).find((alert) => alert.rule === 'UNUSUAL_CATEGORY');
    expect(category?.evidence).toEqual({ typicalAccountId: ids['5030'], sampleCount: 4 });
  });

  it('resolves alerts on a reversed entry without discarding evidence or a manual dismissal', async () => {
    await history();
    const open = await post('5010', '2000', '2026-05-01');
    const dismissed = await post('5010', '2000', '2026-06-01');
    await analyzeEntry(org, open.id);
    await analyzeEntry(org, dismissed.id);
    await query("UPDATE alerts SET status='DISMISSED' WHERE entry_id=$1", [dismissed.id]);
    const beforeOpen = (await alerts(open.id))[0];
    const beforeDismissed = (await alerts(dismissed.id))[0];
    await finishExistingJobs();
    const reversal = await reverseEntry(org, open.id, '2026-07-01', randomUUID());
    const dismissedReversal = await reverseEntry(org, dismissed.id, '2026-07-01', randomUUID());
    await drain();
    for (const [entry, previous, reversing, status] of [
      [open, beforeOpen, reversal, 'RESOLVED'],
      [dismissed, beforeDismissed, dismissedReversal, 'DISMISSED'],
    ] as const) {
      const current = (await alerts(entry.id))[0];
      expect(current).toMatchObject({
        id: previous.id,
        status,
        evidence: previous.evidence,
        explanation: previous.explanation,
        resolution_reason: 'ENTRY_REVERSED',
        resolution_entry_id: reversing.id,
      });
      expect(current.resolved_at).not.toBeNull();
      expect((await getEntry(org, entry.id)).lines).toEqual(entry.lines);
    }
    const firstResolution = (await alerts(open.id))[0];
    await processClaimedAnalysisJob(await claim(reversal.id));
    expect((await alerts(open.id))[0]).toEqual(firstResolution);
  });

  it('rechecks a duplicate peer and resolves its signal when the other entry is reversed', async () => {
    const first = await post('5020', '89', '2026-05-01');
    const second = await post('5020', '89', '2026-05-02');
    await analyzeEntry(org, first.id);
    await analyzeEntry(org, second.id);
    const before = (await alerts(second.id))[0];
    await finishExistingJobs();
    const reversal = await reverseEntry(org, first.id, '2026-06-01', randomUUID());
    await drain();
    expect((await alerts(second.id))[0]).toMatchObject({
      id: before.id,
      status: 'RESOLVED',
      resolution_reason: 'NO_LONGER_MATCHES',
      resolution_entry_id: reversal.id,
      evidence: before.evidence,
    });
    await post('5020', '89', '2026-05-03');
    await analyzeEntry(org, second.id);
    expect((await alerts(second.id))[0]).toMatchObject({
      id: before.id,
      status: 'OPEN',
      resolved_at: null,
      resolution_reason: null,
      resolution_entry_id: null,
    });
  });

  it('retains a supported outlier then resolves it when reversal removes the fourth valid sample', async () => {
    const samples = await history(5);
    const candidate = await post('5010', '2000', '2026-06-01');
    await analyzeEntry(org, candidate.id);
    const originalAlert = (await alerts(candidate.id))[0];
    await finishExistingJobs();
    await reverseEntry(org, samples[0].id, '2026-07-01', randomUUID());
    await drain();
    expect((await alerts(candidate.id))[0]).toMatchObject({
      id: originalAlert.id,
      status: 'OPEN',
      evidence: { sampleCount: 4, median: '1000.00' },
    });
    const reversal = await reverseEntry(org, samples[1].id, '2026-07-01', randomUUID());
    await drain();
    expect((await alerts(candidate.id))[0]).toMatchObject({
      id: originalAlert.id,
      status: 'RESOLVED',
      resolution_reason: 'NO_LONGER_MATCHES',
      resolution_entry_id: reversal.id,
    });
  });

  it('resolves a category-change signal when its historical category loses minimum support', async () => {
    const samples = await history();
    const candidate = await post('5030', '100', '2026-06-01');
    await analyzeEntry(org, candidate.id);
    expect((await alerts(candidate.id))[0]).toMatchObject({ rule: 'UNUSUAL_CATEGORY', status: 'OPEN' });
    await finishExistingJobs();
    await reverseEntry(org, samples[0].id, '2026-07-01', randomUUID());
    await drain();
    expect((await alerts(candidate.id))[0]).toMatchObject({
      rule: 'UNUSUAL_CATEGORY',
      status: 'RESOLVED',
      resolution_reason: 'NO_LONGER_MATCHES',
    });
  });

  it('keeps an explicitly dismissed signal dismissed after it resolves and becomes applicable again', async () => {
    const samples = await history();
    const candidate = await post('5010', '2000', '2026-06-01');
    await analyzeEntry(org, candidate.id);
    await query("UPDATE alerts SET status='DISMISSED' WHERE entry_id=$1", [candidate.id]);
    await finishExistingJobs();
    await reverseEntry(org, samples[0].id, '2026-07-01', randomUUID());
    await drain();
    const resolved = (await alerts(candidate.id))[0];
    expect(resolved).toMatchObject({ status: 'DISMISSED', resolution_reason: 'NO_LONGER_MATCHES' });
    expect(resolved.resolved_at).not.toBeNull();
    await post('5010', '1000', '2026-01-02');
    await analyzeEntry(org, candidate.id);
    expect((await alerts(candidate.id))[0]).toMatchObject({
      id: resolved.id,
      status: 'DISMISSED',
      resolved_at: null,
      evidence: { sampleCount: 4 },
    });
  });
});

describe('Durable bounded anomaly refresh', () => {
  it('persists a 50-entry cursor, resumes the remainder and never requeues a completed scan', async () => {
    const original = await post('5010', '1000', '2026-01-01');
    const affected = [];
    for (let n = 0; n < 55; n++)
      affected.push(
        await post('5010', String(1100 + n), n === 0 ? '2025-12-29' : n === 54 ? '2027-01-01' : '2026-02-01'),
      );
    const unrelated = [
      await post('5010', '1000', '2025-12-28'),
      await post('5010', '1000', '2027-01-02'),
      await post('5010', '1000', '2026-02-01', 'Another merchant'),
    ];
    await finishExistingJobs();
    const reversal = await reverseEntry(org, original.id, '2026-03-01', randomUUID());
    const firstClaim = await claim(reversal.id);
    expect(await processClaimedAnalysisJob(firstClaim)).toBe(true);
    const paused = (await query('SELECT * FROM jobs WHERE id=$1', [firstClaim.id]))[0];
    expect(paused).toMatchObject({ status: 'PENDING', anomaly_refresh_complete: false, attempts: 0 });
    expect(paused.anomaly_refresh_cursor).toBe(affected.map((entry) => entry.id).sort()[49]);
    expect((await query('SELECT id FROM jobs WHERE refresh_entry_id=$1', [reversal.id])).length).toBe(50);
    await processClaimedAnalysisJob(await claim(reversal.id));
    expect((await query('SELECT * FROM jobs WHERE id=$1', [firstClaim.id]))[0]).toMatchObject({
      status: 'DONE',
      anomaly_refresh_complete: true,
    });
    expect((await query('SELECT id FROM jobs WHERE refresh_entry_id=$1', [reversal.id])).length).toBe(55);
    for (const entry of unrelated)
      expect(
        (await query('SELECT status,refresh_entry_id FROM jobs WHERE entry_id=$1', [entry.id]))[0],
      ).toEqual({ status: 'DONE', refresh_entry_id: null });
    await finishExistingJobs();
    await processClaimedAnalysisJob(await claim(reversal.id));
    expect(
      (await query("SELECT id FROM jobs WHERE organization_id=$1 AND status<>'DONE'", [org])).length,
    ).toBe(0);
  });

  it('rolls back alert resolution, enqueues and scan progress after a failed acknowledgement, then reclaims the lease', async () => {
    const original = await post('5020', '89', '2026-05-01');
    const peer = await post('5020', '89', '2026-05-02');
    await analyzeEntry(org, original.id);
    await analyzeEntry(org, peer.id);
    await finishExistingJobs();
    const reversal = await reverseEntry(org, original.id, '2026-06-01', randomUUID());
    const claimed = await claim(reversal.id);
    const realQuery = database.query;
    const failAcknowledgement = vi
      .spyOn(database, 'query')
      .mockImplementation(
        <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, values: unknown[] = [], db?: Db) => {
          if (sql.includes('UPDATE jobs SET status=$3'))
            return Promise.reject(new Error('Injected acknowledgement failure'));
          return realQuery<T>(sql, values, db);
        },
      );
    await expect(processClaimedAnalysisJob(claimed)).rejects.toThrow('Injected acknowledgement failure');
    failAcknowledgement.mockRestore();
    expect((await alerts(original.id))[0]).toMatchObject({ status: 'OPEN', resolved_at: null });
    expect((await query('SELECT * FROM jobs WHERE id=$1', [claimed.id]))[0]).toMatchObject({
      status: 'RUNNING',
      anomaly_refresh_cursor: null,
      anomaly_refresh_complete: false,
    });
    expect((await query('SELECT status,refresh_entry_id FROM jobs WHERE entry_id=$1', [peer.id]))[0]).toEqual(
      { status: 'DONE', refresh_entry_id: null },
    );
    await query("UPDATE jobs SET locked_at=now()-interval '5 minutes' WHERE id=$1", [claimed.id]);
    await drain();
    expect((await alerts(original.id))[0].status).toBe('RESOLVED');
    expect((await alerts(peer.id))[0].status).toBe('RESOLVED');
  });

  it('rejects a stale worker claim before any alert write or job acknowledgement', async () => {
    const original = await post('5020', '89', '2026-05-01');
    await post('5020', '89', '2026-05-02');
    await analyzeEntry(org, original.id);
    await finishExistingJobs();
    const reversal = await reverseEntry(org, original.id, '2026-06-01', randomUUID());
    const stale = await claim(reversal.id);
    const current = await claim(reversal.id);
    expect(await processClaimedAnalysisJob(stale)).toBe(false);
    expect((await alerts(original.id))[0]).toMatchObject({ status: 'OPEN', resolved_at: null });
    expect(
      (await query('SELECT lease_token,anomaly_refresh_cursor FROM jobs WHERE id=$1', [stale.id]))[0],
    ).toEqual({ lease_token: current.lease_token, anomaly_refresh_cursor: null });
    expect(await processClaimedAnalysisJob(current)).toBe(true);
    expect((await alerts(original.id))[0].status).toBe('RESOLVED');
  });

  it('retains retry state but never logs or persists raw failed-query details', async () => {
    const entry = await post('5010', '1000', '2026-05-01');
    const privateText = 'PRIVATE_SYNTHETIC_PURCHASE_DETAILS';
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const realQuery = database.query;
    const failAnalysis = vi
      .spyOn(database, 'query')
      .mockImplementation(
        <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, values: unknown[] = [], db?: Db) => {
          if (sql.includes('SELECT a.id AS account_id,a.name,l.currency'))
            return Promise.reject(
              Object.assign(new Error(privateText), { code: '23514', detail: privateText }),
            );
          return realQuery<T>(sql, values, db);
        },
      );
    await processJobs(org);
    failAnalysis.mockRestore();
    const job = (await query('SELECT * FROM jobs WHERE entry_id=$1', [entry.id]))[0];
    expect(job).toMatchObject({ status: 'PENDING', attempts: 1, lease_token: null, locked_at: null });
    expect(job.last_error).toBe('Entry analysis failed (23514). See worker diagnostics.');
    const output = log.mock.calls.map((call) => JSON.parse(call[0]));
    expect(output).toContainEqual(
      expect.objectContaining({
        event: 'worker_error',
        operation: 'anomaly_analysis',
        jobId: String(job.id),
        databaseCode: '23514',
      }),
    );
    expect(JSON.stringify(output)).not.toContain(privateText);
    expect(await alerts(entry.id)).toEqual([]);
    expect((await getEntry(org, entry.id)).lines).toEqual(entry.lines);
  });

  it('executes the migration backfill against existing completed reversal jobs without duplicating or changing journals', async () => {
    const client = new pg.Client({ connectionString: config.migrationUrl });
    await client.connect();
    try {
      // Session-local tables exercise the exact migration statement without touching other test workspaces.
      await client.query(`CREATE TEMP TABLE journal_entries(
        id uuid PRIMARY KEY,organization_id uuid NOT NULL,status text NOT NULL,source text NOT NULL);
        CREATE TEMP TABLE jobs(
        organization_id uuid NOT NULL,entry_id uuid NOT NULL,kind text NOT NULL DEFAULT 'ANALYZE_ENTRY',
        status text NOT NULL DEFAULT 'PENDING',attempts integer NOT NULL DEFAULT 0,
        run_after timestamptz NOT NULL DEFAULT now(),locked_at timestamptz,lease_token uuid,last_error text,
        anomaly_refresh_cursor uuid,anomaly_refresh_complete boolean NOT NULL DEFAULT false,refresh_entry_id uuid,
        UNIQUE(entry_id,kind));`);
      const completed = randomUUID(),
        missingJob = randomUUID(),
        manual = randomUUID(),
        draft = randomUUID();
      for (const [id, status, source] of [
        [completed, 'POSTED', 'REVERSAL'],
        [missingJob, 'POSTED', 'REVERSAL'],
        [manual, 'POSTED', 'MANUAL'],
        [draft, 'DRAFT', 'REVERSAL'],
      ])
        await client.query('INSERT INTO journal_entries VALUES($1,$2,$3,$4)', [id, org, status, source]);
      await client.query(
        `INSERT INTO jobs(organization_id,entry_id,status,attempts,lease_token,locked_at,
          anomaly_refresh_cursor,anomaly_refresh_complete) VALUES($1,$2,'DONE',4,$3,now(),$4,true)`,
        [org, completed, randomUUID(), randomUUID()],
      );
      await client.query("INSERT INTO jobs(organization_id,entry_id,status) VALUES($1,$2,'DONE')", [
        org,
        manual,
      ]);
      const before = (await client.query('SELECT * FROM journal_entries ORDER BY id')).rows;
      const migration = readFileSync('db/migrations/006_anomaly_lifecycle.sql', 'utf8');
      const backfill = migration.split('-- Requeue historical reversal jobs through the bounded worker.')[1];
      expect(backfill).toBeTruthy();
      await client.query(backfill);
      await client.query(backfill);
      const queued = (await client.query("SELECT * FROM jobs WHERE status='PENDING' ORDER BY entry_id")).rows;
      expect(queued.map((job) => job.entry_id).sort()).toEqual([completed, missingJob].sort());
      for (const job of queued)
        expect(job).toMatchObject({
          attempts: 0,
          lease_token: null,
          locked_at: null,
          anomaly_refresh_cursor: null,
          anomaly_refresh_complete: false,
          last_error: null,
        });
      expect((await client.query('SELECT * FROM journal_entries ORDER BY id')).rows).toEqual(before);
      expect((await client.query('SELECT status FROM jobs WHERE entry_id=$1', [manual])).rows[0].status).toBe(
        'DONE',
      );
      expect((await client.query('SELECT * FROM jobs WHERE entry_id=$1', [draft])).rows).toEqual([]);
    } finally {
      await client.end();
    }
  });
});
