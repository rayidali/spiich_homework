import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg, { type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAnalystSql } from '../server/analyst-sql';

// No hosted target, model calls or migration application. CI applies migrations
// before these tests; private staging must not run them against product data.
const runtimeUrl =
  process.env.DATABASE_URL ?? 'postgres://spiich_app:spiich_app_local@127.0.0.1:55432/spiich';
const ownerUrl = process.env.MIGRATION_DATABASE_URL ?? 'postgres://spiich:spiich@127.0.0.1:55432/spiich';
const admin = new pg.Client({ connectionString: ownerUrl, connectionTimeoutMillis: 1500 });
const pool = new pg.Pool({ connectionString: runtimeUrl, max: 1, connectionTimeoutMillis: 1500 });
const sql = createAnalystSql({ connect: () => pool.connect() });
const org = randomUUID(),
  other = randomUUID();
let connected = false,
  baseline = '',
  draftId = '';
async function fingerprint() {
  const result = await admin.query(
    "SELECT jsonb_build_object('entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM journal_entries e WHERE organization_id=ANY($1::uuid[])),'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM journal_lines l WHERE organization_id=ANY($1::uuid[])))::text AS data",
    [[org, other]],
  );
  return createHash('sha256').update(result.rows[0].data).digest('hex');
}
async function addEntry(
  organization: string,
  expense: string,
  cash: string,
  amount: string,
  posted: boolean,
) {
  const id = randomUUID();
  await admin.query('BEGIN');
  try {
    await admin.query(
      "INSERT INTO journal_entries(id,organization_id,date,description,counterparty) VALUES($1,$2,'2026-11-03','SQL boundary fixture','Fixture')",
      [id, organization],
    );
    await admin.query(
      "INSERT INTO journal_lines(organization_id,entry_id,account_id,position,currency,debit,credit) VALUES($1,$2,$3,0,'USD',$5,0),($1,$2,$4,1,'USD',0,$5)",
      [organization, id, expense, cash, amount],
    );
    if (posted)
      await admin.query("UPDATE journal_entries SET status='POSTED',posted_at=now() WHERE id=$1", [id]);
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
  return id;
}
beforeAll(async () => {
  for (const value of [runtimeUrl, ownerUrl]) {
    const url = new URL(value);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !(process.env.NODE_ENV === 'test' && url.hostname === 'db' && url.pathname === '/spiich')
    )
      throw new Error('Analyst SQL tests require isolated local/CI PostgreSQL.');
  }
  try {
    await admin.connect();
    connected = true;
  } catch (error) {
    if (
      process.env.CI ||
      process.env.ANALYST_SQL_DB_REQUIRED === '1' ||
      !['ECONNREFUSED', 'ETIMEDOUT', 'EPERM', 'EACCES'].includes(String((error as { code?: string }).code))
    )
      throw error;
    return;
  }
  const migration = await admin.query("SELECT to_regclass('analytics.ledger') AS view");
  if (!migration.rows[0].view) throw new Error('Migration009 must be applied by the isolated test setup.');
  const roles = await admin.query(
    "SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='daybook_analyst_reader'",
  );
  expect(roles.rows).toEqual([
    {
      rolname: 'daybook_analyst_reader',
      rolcanlogin: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
    },
  ]);
  for (const organization of [org, other]) {
    const cash = randomUUID(),
      expense = randomUUID();
    await admin.query(
      "INSERT INTO organizations(id,name,timezone) VALUES($1,'Isolated SQL boundary fixture','Pacific/Honolulu')",
      [organization],
    );
    await admin.query(
      "INSERT INTO accounts(id,organization_id,code,name,type,currency,is_cash) VALUES($1,$3,'1010','Cash','ASSET','USD',true),($2,$3,'5030','Supplies','EXPENSE','USD',false)",
      [cash, expense, organization],
    );
    await addEntry(organization, expense, cash, organization === org ? '12.35' : '999.99', true);
    const draft = await addEntry(organization, expense, cash, '60.00', false);
    if (organization === org) draftId = draft;
  }
  baseline = await fingerprint();
});
beforeEach((context) => {
  if (!connected) context.skip();
});
afterAll(async () => {
  if (connected) {
    if (baseline) expect(await fingerprint()).toBe(baseline);
    await admin.end();
  }
  await pool.end();
});

describe('native analyst real PostgreSQL isolation', () => {
  it.each(['login', 'membership', 'inbound_membership', 'base_grant'])(
    'fails migration closed for a pre-existing reader role with %s',
    async (collision) => {
      const migration = await readFile(
        new URL('../db/migrations/009_analyst_readonly.sql', import.meta.url),
        'utf8',
      );
      await admin.query('BEGIN');
      try {
        if (collision === 'login') await admin.query('ALTER ROLE daybook_analyst_reader LOGIN');
        if (collision === 'membership') {
          const role = `analyst_collision_${randomUUID().replaceAll('-', '')}`;
          await admin.query(`CREATE ROLE ${role} NOLOGIN`);
          await admin.query(`GRANT ${role} TO daybook_analyst_reader`);
        }
        if (collision === 'inbound_membership') {
          const role = `analyst_collision_${randomUUID().replaceAll('-', '')}`;
          await admin.query(`CREATE ROLE ${role} NOLOGIN`);
          await admin.query(`GRANT daybook_analyst_reader TO ${role}`);
        }
        if (collision === 'base_grant')
          await admin.query('GRANT SELECT ON public.journal_entries TO daybook_analyst_reader');
        await expect(admin.query(migration)).rejects.toThrow(
          'Existing daybook_analyst_reader role has incompatible privileges',
        );
      } finally {
        await admin.query('ROLLBACK');
      }
    },
  );
  it('uses the reader role and READ ONLY for a successful exact-money query', async () => {
    let observed: unknown;
    const instrumented = createAnalystSql({
      connect: async () => {
        const client = await pool.connect();
        return {
          release: (discard: boolean) => client.release(discard),
          query: async (...args: unknown[]) => {
            if (typeof args[0] === 'object')
              observed = (
                await client.query(
                  "SELECT current_user AS role,current_setting('transaction_read_only') AS readonly,current_setting('daybook.organization_id') AS org,current_setting('TimeZone') AS timezone",
                )
              ).rows[0];
            return (client.query as (...args: unknown[]) => Promise<unknown>)(...args);
          },
        } as unknown as PoolClient;
      },
    });
    const result = await instrumented.query(org, {
      id: 'expense',
      sql: "SELECT sum(base_debit-base_credit) AS amount FROM analytics.ledger WHERE status='POSTED' AND account_type='EXPENSE'",
    });
    expect(result.rows).toEqual([['12.35']]);
    expect(observed).toEqual({
      role: 'daybook_analyst_reader',
      readonly: 'on',
      org,
      timezone: 'Pacific/Honolulu',
    });
  });
  it('shows posted and pending records separately, including foreign UUID filters without foreign rows', async () => {
    const result = await sql.query(org, {
      id: 'status',
      sql: "SELECT status,sum(base_debit-base_credit) AS amount FROM analytics.ledger WHERE account_type='EXPENSE' GROUP BY status ORDER BY status",
    });
    expect(result.rows).toEqual([
      ['DRAFT', '60.00'],
      ['POSTED', '12.35'],
    ]);
    expect(
      (
        await sql.query(org, {
          id: 'foreign',
          sql: 'SELECT id FROM analytics.entries WHERE organization_id=$1::uuid',
          params: [other],
        })
      ).rows,
    ).toEqual([]);
    expect(
      (
        await sql.query(other, {
          id: 'other',
          sql: "SELECT sum(base_debit-base_credit) AS amount FROM analytics.ledger WHERE status='POSTED' AND account_type='EXPENSE'",
        })
      ).rows,
    ).toEqual([['999.99']]);
  });
  it('enforces base-table denial at the database even if a query bypasses the parser', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query('SET LOCAL ROLE daybook_analyst_reader');
      expect(
        (await client.query('SELECT count(*)::text AS count FROM analytics.entries')).rows[0].count,
      ).toBe('0');
      await expect(client.query('SELECT id FROM public.journal_entries')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
  it('supports CTE, window and grouping operations with decimal arithmetic', async () => {
    const result = await sql.query(org, {
      id: 'window',
      sql: "WITH daily AS(SELECT date,sum(base_debit-base_credit) AS amount FROM analytics.ledger WHERE status='POSTED' AND account_type='EXPENSE' GROUP BY date) SELECT date,amount,sum(amount) OVER(ORDER BY date) AS running,amount/2::numeric AS half FROM daily",
    });
    expect(result.rows[0].slice(0, 3)).toEqual(['2026-11-03', '12.35', '12.35']);
    expect(result.rows[0][3]).toMatch(/^6\.1750*$/);
    const grouping = await sql.query(org, {
      id: 'grouping',
      sql: "SELECT account_type,sum(base_debit-base_credit) AS total FROM analytics.ledger WHERE status='POSTED' GROUP BY GROUPING SETS ((account_type),()) ORDER BY account_type NULLS LAST",
    });
    expect(grouping.rows).toEqual([
      ['ASSET', '-12.35'],
      ['EXPENSE', '12.35'],
      [null, '0.00'],
    ]);
  });
  it('resets role and workspace state after success and a SQL error on the reused connection', async () => {
    await sql.query(org, { id: 'first', sql: 'SELECT id FROM analytics.entries' });
    await expect(sql.query(org, { id: 'error', sql: 'SELECT 1/0 AS broken' })).rejects.toMatchObject({
      sqlState: '22012',
    });
    const identity = (
      await pool.query(
        "SELECT current_user AS role,nullif(current_setting('daybook.organization_id',true),'') AS org,current_setting('transaction_read_only') AS readonly",
      )
    ).rows[0];
    expect(identity).toEqual({ role: 'spiich_app', org: null, readonly: 'off' });
    expect(
      (await sql.query(other, { id: 'other', sql: 'SELECT id FROM analytics.organization' })).rows,
    ).toEqual([[other]]);
  });
  it('uses one snapshot for final reexecution and detects subsequently changed drafts', async () => {
    const query = {
      id: 'draft',
      sql: 'SELECT description FROM analytics.entries WHERE id=$1::uuid',
      params: [draftId],
    };
    const initial = await sql.query(org, query);
    await admin.query("UPDATE journal_entries SET description='Revised SQL boundary fixture' WHERE id=$1", [
      draftId,
    ]);
    try {
      expect((await sql.reexecute(org, [initial])).changedQueryIds).toEqual(['draft']);
    } finally {
      await admin.query("UPDATE journal_entries SET description='SQL boundary fixture' WHERE id=$1", [
        draftId,
      ]);
      baseline = await fingerprint();
    }
  });
  it('keeps all queries in a batch on one snapshot while a draft changes concurrently', async () => {
    let queryCount = 0;
    const consistent = createAnalystSql({
      connect: async () => {
        const client = await pool.connect();
        return {
          release: (discard: boolean) => client.release(discard),
          query: async (...args: unknown[]) => {
            const result = await (client.query as (...args: unknown[]) => Promise<unknown>)(...args);
            if (typeof args[0] === 'object' && ++queryCount === 1)
              await admin.query(
                "UPDATE journal_entries SET description='Concurrent changed description' WHERE id=$1",
                [draftId],
              );
            return result;
          },
        } as unknown as PoolClient;
      },
    });
    const source = { sql: 'SELECT description FROM analytics.entries WHERE id=$1::uuid', params: [draftId] };
    try {
      const results = await consistent.batch(org, [
        { id: 'before', ...source },
        { id: 'after', ...source },
      ]);
      expect(results.map((result) => result.rows)).toEqual([
        [['SQL boundary fixture']],
        [['SQL boundary fixture']],
      ]);
      expect((await sql.query(org, { id: 'latest', ...source })).rows).toEqual([
        ['Concurrent changed description'],
      ]);
    } finally {
      await admin.query("UPDATE journal_entries SET description='SQL boundary fixture' WHERE id=$1", [
        draftId,
      ]);
      baseline = await fingerprint();
    }
  });
  it('bounds expensive read-only SQL and recovers the pooled connection', async () => {
    await expect(
      sql.query(org, { id: 'large', sql: 'SELECT count(*) FROM generate_series(1,1000000000)' }),
    ).rejects.toMatchObject({ sqlState: '57014' });
    expect((await sql.query(org, { id: 'recovery', sql: 'SELECT 1 AS good' })).rows).toEqual([['1']]);
  });
  it('aborts active SQL, removes the connection, and stops server work within the timeout backstop', async () => {
    const controller = new AbortController();
    let backend = 0;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const cancellable = createAnalystSql({
      connect: async () => {
        const client = await pool.connect();
        backend = Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        return {
          release: (discard: boolean) => client.release(discard),
          query: async (...args: unknown[]) => {
            const result = (client.query as (...args: unknown[]) => Promise<unknown>)(...args);
            if (typeof args[0] === 'object') signalStarted();
            return result;
          },
        } as unknown as PoolClient;
      },
    });
    const outcome = cancellable
      .query(
        org,
        { id: 'cancel', sql: 'SELECT count(*) FROM generate_series(1,1000000000)' },
        { signal: controller.signal },
      )
      .catch((error) => error);
    await started;
    // Positive control: establish that PostgreSQL was executing the expensive
    // query before aborting, rather than merely testing an unused connection.
    let observedActive = false;
    try {
      const observeUntil = Date.now() + 1500;
      while (!observedActive && Date.now() < observeUntil) {
        const status = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND state='active' AND query LIKE '%generate_series%'",
          [backend],
        );
        observedActive = status.rowCount === 1;
        if (!observedActive) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observedActive).toBe(true);
    } finally {
      controller.abort();
    }
    expect(await outcome).toMatchObject({ code: 'ANALYST_SQL_CANCELLED' });
    // A direct server sees the closed socket; pooled hosting may require its
    // already-shortened statement timeout. Assert work ends, not just our await.
    const end = Date.now() + 4500;
    let stillRunning = true;
    while (stillRunning && Date.now() < end) {
      const status = await admin.query(
        "SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND state='active' AND query LIKE '%generate_series%'",
        [backend],
      );
      stillRunning = status.rowCount !== 0;
      if (stillRunning) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(stillRunning).toBe(false);
    const fresh = (await pool.query('SELECT pg_backend_pid() AS pid,current_user AS role')).rows[0];
    expect(Number(fresh.pid)).not.toBe(backend);
    expect(fresh.role).toBe('spiich_app');
    expect((await sql.query(org, { id: 'after_cancel', sql: 'SELECT 1 AS good' })).rows).toEqual([['1']]);
  });
});
