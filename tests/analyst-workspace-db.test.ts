import pg from 'pg';
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyDatabase, expectedRows } from '../scripts/analyst-workspace-evaluation/database';
import { assertTarget, readReferences, sameValue } from '../scripts/analyst-workspace-evaluation/references';
import { createAnalystSql, type AnalystSqlResult } from '../server/analyst-sql';

// Opt-in CI step creates and migrates a dedicated empty database. Never point at product books.
const enabled = process.env.ANALYST_WORKSPACE_DB_TEST === '1';
const suite = describe.runIf(enabled);
let pool: pg.Pool;
let sql: ReturnType<typeof createAnalystSql>;
let refs: ReturnType<typeof readReferences>;
let seeded: Awaited<ReturnType<typeof verifyDatabase>>;
let ownerUrl: string, database: string;
const viewMap = {
  organizations: 'organization',
  accounts: 'accounts',
  recurring_templates: 'recurring',
  journal_entries: 'entries',
  journal_lines: 'lines',
  alerts: 'alerts',
} as const;

function objectRows(result: AnalystSqlResult) {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((column, i) => [column.name, row[i]])),
  );
}

suite('frozen acceptance books through the real native SQL boundary', () => {
  beforeAll(async () => {
    ownerUrl = process.env.ANALYST_FIXTURE_OWNER_URL ?? '';
    const runtimeUrl = process.env.ANALYST_FIXTURE_RUNTIME_URL ?? '';
    database = process.env.ANALYST_FIXTURE_DATABASE ?? '';
    assertTarget(ownerUrl, database);
    assertTarget(runtimeUrl, database);
    const owner = new URL(ownerUrl),
      runtime = new URL(runtimeUrl);
    if (
      runtime.username !== 'spiich_app' ||
      owner.hostname !== runtime.hostname ||
      owner.port !== runtime.port
    )
      throw Error('EXPLICIT_MATCHED_FIXTURE_RUNTIME_REQUIRED');
    refs = readReferences(); // Recompute Python Decimal facts before touching PostgreSQL.
    seeded = await verifyDatabase(ownerUrl, database, 'seed-check');
    pool = new pg.Pool({ connectionString: runtimeUrl, max: 1, connectionTimeoutMillis: 3000 });
    sql = createAnalystSql({ connect: () => pool.connect() });
  }, 60000);

  afterAll(async () => {
    try {
      if (seeded) {
        const checked = await verifyDatabase(ownerUrl, database, 'verify');
        expect(checked.fingerprintBefore).toBe(seeded.fingerprintBefore);
        expect(checked.fingerprintAfter).toBe(seeded.fingerprintAfter);
        expect(checked.factChecks).toBe(38);
        if (process.env.ANALYST_FIXTURE_RECEIPT)
          writeFileSync(
            process.env.ANALYST_FIXTURE_RECEIPT,
            JSON.stringify(
              {
                ...checked,
                nativeReaderChecked: true,
                caveat:
                  'Real fixture/SQL boundary checks only. Test runner outcome separately establishes whether all assertions passed; no model accuracy score.',
              },
              null,
              2,
            ) + '\n',
            { flag: 'wx', mode: 0o600 },
          );
      }
    } finally {
      await pool?.end();
    }
  }, 60000);

  it('loads all original records and verifies 38 independently calculated facts', () => {
    expect(seeded.lineChecks).toBe(118);
    expect(seeded.factChecks).toBe(38);
    expect(seeded.counts).toMatchObject({
      organizations: 2,
      accounts: 34,
      journal_entries: 59,
      journal_lines: 118,
      alerts: 6,
      recurring_templates: 2,
    });
    expect(seeded.readerIsolation).toBe(true);
    expect(seeded.fingerprintAfter).toBe(seeded.fingerprintBefore);
  });

  it.each(Object.keys(viewMap) as (keyof typeof viewMap)[])(
    'exposes every primary-workspace %s field and no secondary-workspace rows',
    async (table) => {
      const rows = expectedRows(refs)
        [table].filter(
          (row) =>
            (table === 'organizations' ? row.id : row.organization_id) === refs.fixture.organization_id,
        )
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const columns = Object.keys(rows[0]);
      expect(columns.every((name) => /^[a-z_]+$/.test(name))).toBe(true);
      const actual = await sql.query(refs.fixture.organization_id, {
        id: `fields_${table}`,
        sql: `SELECT ${columns.join(',')} FROM analytics.${viewMap[table]} ORDER BY id`,
      });
      expect(actual.truncated).toBe(false);
      expect(actual.rowCount).toBe(rows.length);
      const expected = rows.map((row) =>
        actual.columns.map((column) => {
          const value = row[column.name];
          if (value === null) return null;
          if (column.kind === 'json') return value;
          if (column.kind === 'boolean') return value;
          return String(value);
        }),
      );
      const values = actual.rows.map((row) =>
        row.map((value, i) => {
          if (value === null) return null;
          if (actual.columns[i].kind === 'json') return JSON.parse(value);
          if (actual.columns[i].kind === 'boolean') return value === 't' || value === 'true';
          return value;
        }),
      );
      expect(sameValue(values, expected)).toBe(true);
    },
  );

  it('cannot retrieve sentinel records even when SQL explicitly asks for the other workspace', async () => {
    const other = refs.fixture.organizations.find((org) => org.id !== refs.fixture.organization_id)!;
    const response = await sql.query(refs.fixture.organization_id, {
      id: 'sentinel',
      sql: 'SELECT id FROM analytics.entries WHERE organization_id=$1::uuid',
      params: [other.id],
    });
    expect(response.rows).toEqual([]);
    expect(response.organizationId).toBe(refs.fixture.organization_id);
  });

  it('computes exact cash through the fixed business date including historical entries and saved FX', async () => {
    const response = await sql.query(refs.fixture.organization_id, {
      id: 'cash',
      sql: `SELECT ROUND(COALESCE(SUM(base_net_debit),0),2) AS amount
        FROM analytics.ledger WHERE is_cash AND account_type='ASSET' AND status='POSTED' AND date<=$1::date`,
      params: [refs.fixture.business_date],
    });
    expect(sameValue(response.rows[0][0], refs.facts['cash.total'].value)).toBe(true);
    expect(response.columns[0].kind).toBe('decimal');
  });

  it('returns all monthly rent percentages with quiet months undefined instead of zero', async () => {
    const response = await sql.query(refs.fixture.organization_id, {
      id: 'monthly-rent',
      sql: `WITH calendar AS (
        SELECT value::date AS month FROM generate_series('2026-01-01'::date,$1::date,interval '1 month') AS value
      ), monthly AS (
        SELECT c.month,COALESCE(SUM(l.base_net_debit) FILTER(WHERE l.account_code='5010'),0) AS rent,
          COALESCE(SUM(l.base_net_debit) FILTER(WHERE l.account_type='EXPENSE'),0) AS expenses
        FROM calendar c LEFT JOIN analytics.ledger l ON date_trunc('month',l.date)::date=c.month
          AND l.status='POSTED' AND l.date<=$1::date GROUP BY c.month
      ) SELECT to_char(month,'YYYY-MM') AS month,ROUND(rent,2) AS rent,ROUND(expenses,2) AS expenses,
        ROUND(rent*100/NULLIF(expenses,0),6) AS rent_pct FROM monthly ORDER BY month`,
      params: [refs.fixture.business_date],
    });
    expect(sameValue(objectRows(response), refs.facts['rent.monthly_shares'].value)).toBe(true);
    expect(response.rows).toHaveLength(11);
    expect(response.rows.some((row) => row[3] === null)).toBe(true);
  });

  it('ranks net vendor expenses with exact shares and cumulative percentages', async () => {
    const response = await sql.query(refs.fixture.organization_id, {
      id: 'vendors',
      sql: `WITH vendors AS (
        SELECT counterparty,SUM(base_net_debit) AS amount FROM analytics.ledger
        WHERE account_type='EXPENSE' AND status='POSTED' AND date BETWEEN '2026-01-01'::date AND $1::date
        GROUP BY counterparty
      ) SELECT counterparty AS vendor,ROUND(amount,2) AS expense,
        ROUND(amount*100/NULLIF(SUM(amount) OVER(),0),6) AS share_pct,
        ROUND(SUM(amount) OVER(ORDER BY amount DESC,counterparty ROWS UNBOUNDED PRECEDING)*100/NULLIF(SUM(amount) OVER(),0),6) AS cumulative_pct
        FROM vendors ORDER BY amount DESC,counterparty LIMIT 3`,
      params: [refs.fixture.business_date],
    });
    expect(sameValue(objectRows(response), refs.facts['vendors.top_three'].value)).toBe(true);
    const repeated = await sql.reexecute(refs.fixture.organization_id, [response]);
    expect(repeated.changedQueryIds).toEqual([]);
    expect(repeated.results[0].hash).toBe(response.hash);
  });
});
