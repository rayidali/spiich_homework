import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { accounts, entries, entryLines } from './fixture';
import { databaseTarget, requireCondition, sha256 } from './protocol';
export async function seedDatabase(ownerUrl: string, runtimeUrl: string, name: string, root = process.cwd()) {
  databaseTarget(ownerUrl, runtimeUrl, name);
  const owner = new pg.Client({ connectionString: ownerUrl }),
    runtime = new pg.Client({ connectionString: runtimeUrl });
  let ownerConnected = false,
    runtimeConnected = false,
    transaction = false;
  try {
    await owner.connect();
    ownerConnected = true;
    await runtime.connect();
    runtimeConnected = true;
    const a = (await owner.query('SELECT current_database() AS name,current_user AS role')).rows[0];
    const b = (
      await runtime.query(
        'SELECT current_database() AS name,current_user AS role,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    requireCondition(
      a.name === name &&
        b.name === name &&
        a.role !== b.role &&
        !b.rolsuper &&
        !b.rolcreatedb &&
        !b.rolcreaterole,
      'DATABASE_IDENTITY',
    );
    const names = readdirSync(join(root, 'db/migrations'))
      .filter((n) => n.endsWith('.sql'))
      .sort();
    const migrated = (await owner.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
    requireCondition(
      migrated.length === names.length &&
        migrated.every(
          (r, i) =>
            r.name === names[i] && r.checksum === sha256(readFileSync(join(root, 'db/migrations', r.name))),
        ),
      'MIGRATION_MISMATCH',
    );
    await owner.query('BEGIN');
    transaction = true;
    await owner.query("SELECT pg_advisory_xact_lock(hashtext('daybook_flexible_acceptance_seed'))");
    requireCondition(
      (await owner.query('SELECT count(*)::text AS count FROM organizations')).rows[0].count === '0',
      'DATABASE_NOT_EMPTY',
    );
    const organizations = { primary: randomUUID(), other: randomUUID() };
    const ids = new Map<string, string>();
    for (const [workspace, org] of Object.entries(organizations)) {
      await owner.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
        org,
        `Disposable flexible analysis ${workspace}`,
      ]);
      for (const account of accounts) {
        const id = randomUUID();
        ids.set(`${workspace}:${account.code}`, id);
        await owner.query(
          'INSERT INTO accounts(id,organization_id,code,name,type,currency,is_cash) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [id, org, account.code, account.name, account.type, 'USD', account.cash],
        );
      }
    }
    for (const entry of entries) {
      const id = randomUUID(),
        org = organizations[entry.workspace];
      await owner.query(
        "INSERT INTO journal_entries(id,organization_id,date,description,counterparty,source,idempotency_key) VALUES($1,$2,$3,$4,$5,'SEED',$6)",
        [id, org, entry.date, 'Independent acceptance fixture', entry.counterparty, `flexible:${entry.id}`],
      );
      for (const [position, line] of entryLines(entry).entries())
        await owner.query(
          "INSERT INTO journal_lines(organization_id,entry_id,account_id,position,currency,debit,credit,exchange_rate) VALUES($1,$2,$3,$4,'USD',$5,$6,1)",
          [org, id, ids.get(`${entry.workspace}:${line.account}`), position, line.debit, line.credit],
        );
      if (entry.status === 'POSTED')
        await owner.query("UPDATE journal_entries SET status='POSTED',posted_at=now() WHERE id=$1", [id]);
    }
    await owner.query('COMMIT');
    transaction = false;
    const stored = (
      await runtime.query(
        'SELECT e.idempotency_key,e.organization_id,e.status,e.date::text,a.code,l.position,l.base_debit::text,l.base_credit::text,l.currency,l.exchange_rate::text FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id ORDER BY e.idempotency_key,l.position',
      )
    ).rows;
    requireCondition(stored.length === entries.length * 2, 'STORED_LINE_COUNT');
    for (const entry of entries)
      for (const [position, line] of entryLines(entry).entries()) {
        const row = stored.find(
          (r) => r.idempotency_key === `flexible:${entry.id}` && r.position === position,
        );
        requireCondition(
          row &&
            row.organization_id === organizations[entry.workspace] &&
            row.status === entry.status &&
            row.date === entry.date &&
            row.code === line.account &&
            row.base_debit === line.debit &&
            row.base_credit === line.credit &&
            row.currency === 'USD' &&
            Number(row.exchange_rate) === 1,
          'STORED_LINE_MISMATCH',
        );
      }
    let oracleChecks = 0;
    for (const [from, to, expenses, revenue, rent] of [
      ['2025-01-01', '2025-12-31', '2050.00', '6000.00', '1200.00'],
      ['2026-01-01', '2026-11-03', '600.00', '1500.00', '350.00'],
    ] as const) {
      const row = (
        await runtime.query(
          `SELECT coalesce(sum(l.base_debit-l.base_credit) FILTER(WHERE a.type='EXPENSE'),0)::text AS expenses,coalesce(sum(l.base_credit-l.base_debit) FILTER(WHERE a.type='REVENUE'),0)::text AS revenue,coalesce(sum(l.base_debit-l.base_credit) FILTER(WHERE a.code='5010'),0)::text AS rent FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id WHERE e.organization_id=$1 AND e.status='POSTED' AND e.date BETWEEN $2 AND $3`,
          [organizations.primary, from, to],
        )
      ).rows[0];
      requireCondition(
        row.expenses === expenses && row.revenue === revenue && row.rent === rent,
        'STORED_ORACLE_MISMATCH',
      );
      oracleChecks += 3;
    }
    const fingerprint = async () => {
      await runtime.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const row = (
          await runtime.query(
            `SELECT jsonb_build_object('organizations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM organizations o),'accounts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM accounts a),'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM journal_entries e),'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM journal_lines l)) AS value`,
          )
        ).rows[0].value;
        await runtime.query('COMMIT');
        return {
          hash: sha256(JSON.stringify(row)),
          counts: {
            organizations: row.organizations.length,
            accounts: row.accounts.length,
            entries: row.entries.length,
            lines: row.lines.length,
          },
        };
      } catch (e) {
        await runtime.query('ROLLBACK');
        throw e;
      }
    };
    const before = await fingerprint();
    await owner.end();
    ownerConnected = false;
    return {
      org: organizations.primary,
      before,
      storedLineChecks: stored.length,
      oracleChecks,
      fingerprint,
      close: () => runtime.end(),
    };
  } catch (e) {
    if (transaction) await owner.query('ROLLBACK').catch(() => undefined);
    if (ownerConnected) await owner.end();
    if (runtimeConnected) await runtime.end();
    throw e;
  }
}
