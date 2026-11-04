import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { oracleQuery } from './oracle-query';
import {
  assertTarget,
  assertPinnedRemoteTarget,
  comparable,
  FixtureError,
  hash,
  lineId,
  readReferences,
  requireFixture,
  sameValue,
  type References,
} from './references';

type Row = Record<string, unknown>;
const stamp = '2026-11-03T12:00:00.000Z';
const tables = [
  'organizations',
  'accounts',
  'recurring_templates',
  'journal_entries',
  'journal_lines',
  'alerts',
] as const;
type Table = (typeof tables)[number];
const decimalColumns = new Set(['debit', 'credit', 'exchange_rate', 'base_debit', 'base_credit']);
const dateColumns = new Set(['date', 'anchor_date', 'next_date', 'occurrence_date', 'end_date']);

/** Map fixture metadata to schema fields; money is passed unchanged as decimal strings. */
export function expectedRows({ fixture: f }: References): Record<Table, Row[]> {
  return {
    organizations: f.organizations.map(({ key: _key, ...row }) => row),
    accounts: f.accounts,
    recurring_templates: f.recurring_templates.map((t) => ({
      ...t,
      description: f.entries.find((e) => e.recurring_template_id === t.id)?.description ?? t.name,
      end_date: null,
      lines: t.lines.map((l) => ({
        accountId: l.account_id,
        debit: l.debit,
        credit: l.credit,
        exchangeRate: l.exchange_rate,
        memo: l.memo,
      })),
    })),
    journal_entries: f.entries.map(({ key: _key, lines: _lines, ...row }) => ({
      ...row,
      number: String(row.number),
    })),
    journal_lines: f.entries.flatMap((e) =>
      e.lines.map(({ account_code: _code, ...l }) => ({
        ...l,
        id: lineId(e.id, l.position),
        organization_id: e.organization_id,
        entry_id: e.id,
      })),
    ),
    alerts: f.alerts.map(({ entry_key, ...a }) => ({
      ...a,
      title: `Fixture: ${a.rule}`,
      explanation: 'Fictional reference alert; a review flag is not a confirmed error.',
      evidence: { fixtureVersion: f.version, entryKey: entry_key },
      resolution_reason: a.status === 'RESOLVED' ? 'ENTRY_REVERSED' : null,
      resolution_entry_id:
        a.status === 'RESOLVED' ? f.entries.find((e) => e.reverses_entry_id === a.entry_id)?.id : null,
    })),
  };
}

const sortRows = (rows: Row[]) =>
  rows
    .map((row) =>
      Object.fromEntries(
        Object.entries(row)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, decimalColumns.has(key) ? comparable(value) : value]),
      ),
    )
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

async function assertMigrations(client: pg.Client, root: string) {
  const names = readdirSync(join(root, 'db/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const rows = (await client.query('SELECT name,checksum FROM public.schema_migrations ORDER BY name')).rows;
  requireFixture(
    rows.length === names.length &&
      rows.every(
        (r, i) =>
          r.name === names[i] && r.checksum === hash(readFileSync(join(root, 'db/migrations', r.name))),
      ),
    'MIGRATION_MISMATCH',
  );
  return rows as { name: string; checksum: string }[];
}

async function insert(client: pg.Client, table: Table, row: Row, identity = false) {
  // All table/column identifiers originate from the fixed mappings in this file.
  const columns = Object.keys(row);
  requireFixture(
    columns.every((c) => /^[a-z_]+$/.test(c)),
    'INVALID_FIXTURE_COLUMN',
  );
  await client.query(
    `INSERT INTO public.${table} (${columns.join(',')}) ${identity ? 'OVERRIDING SYSTEM VALUE ' : ''}VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`,
    columns.map((key) => (key === 'lines' || key === 'evidence' ? JSON.stringify(row[key]) : row[key])),
  );
}

async function load(client: pg.Client, refs: References) {
  requireFixture(
    (await client.query('SELECT count(*)::text AS count FROM public.organizations')).rows[0].count === '0',
    'DATABASE_NOT_EMPTY',
  );
  const rows = expectedRows(refs);
  for (const table of ['organizations', 'accounts', 'recurring_templates'] as const)
    for (const row of rows[table]) await insert(client, table, { ...row, created_at: stamp });
  for (const entry of rows.journal_entries) {
    await insert(
      client,
      'journal_entries',
      { ...entry, status: 'DRAFT', posted_at: null, created_at: stamp },
      true,
    );
    for (const { base_debit: _debit, base_credit: _credit, ...line } of rows.journal_lines.filter(
      (l) => l.entry_id === entry.id,
    ))
      await insert(client, 'journal_lines', line);
    if (entry.status === 'POSTED')
      await client.query("UPDATE public.journal_entries SET status='POSTED',posted_at=$2 WHERE id=$1", [
        entry.id,
        stamp,
      ]);
  }
  for (const alert of rows.alerts) {
    requireFixture(alert.resolution_entry_id !== undefined, 'MISSING_FIXTURE_REVERSAL');
    await insert(client, 'alerts', {
      ...alert,
      created_at: stamp,
      resolved_at: alert.status === 'RESOLVED' ? stamp : null,
    });
  }
  // Keep explicitly authored historical alert states stable; never run a product worker on this fixture.
  await client.query("UPDATE public.jobs SET status='DONE' WHERE organization_id=ANY($1::uuid[])", [
    refs.fixture.organizations.map((o) => o.id),
  ]);
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
}

async function installReader(client: pg.Client, reader: string, database: string, org: string) {
  requireFixture(
    /^[a-z0-9_]+$/.test(reader) && /^[a-z0-9_]+$/.test(database) && /^[0-9a-f-]{36}$/.test(org),
    'INVALID_FIXTURE_IDENTITY',
  );
  requireFixture(
    (await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [reader])).rowCount === 0,
    'READER_ROLE_ALREADY_EXISTS',
  );
  await client.query(
    `CREATE ROLE ${reader} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
  );
  await client.query(`ALTER ROLE ${reader} SET default_transaction_read_only=on`);
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query(`REVOKE TEMPORARY ON DATABASE ${database} FROM PUBLIC`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${reader}`);
  await client.query(`GRANT SELECT ON public.currencies TO ${reader}`);
  for (const table of tables) {
    await client.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    await client.query(
      `CREATE POLICY analyst_fixture_scope ON public.${table} FOR SELECT TO ${reader} USING (${table === 'organizations' ? 'id' : 'organization_id'}='${org}'::uuid)`,
    );
    await client.query(`GRANT SELECT ON public.${table} TO ${reader}`);
  }
}

async function snapshot(client: pg.Client) {
  const snapshot: Record<string, string[]> = {};
  for (const table of tables)
    snapshot[table] = (
      await client.query(`SELECT to_jsonb(t)::text AS row FROM public.${table} t ORDER BY id`)
    ).rows.map((r) => r.row);
  return {
    hash: hash(JSON.stringify(snapshot)),
    counts: Object.fromEntries(tables.map((t) => [t, snapshot[t].length])),
  };
}

async function verifyRows(client: pg.Client, refs: References) {
  const expected = expectedRows(refs);
  for (const table of tables) {
    const columns = Object.keys(expected[table][0]);
    const projection = columns
      .map((c) => (dateColumns.has(c) || decimalColumns.has(c) || c === 'number' ? `${c}::text AS ${c}` : c))
      .join(',');
    const actual = (await client.query(`SELECT ${projection} FROM public.${table} ORDER BY id`))
      .rows as Row[];
    // Nested JSON has object-key order chosen by jsonb, so canonicalize keys but never numeric-looking metadata.
    const ordered = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(ordered)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => [k, ordered(v)]),
            )
          : value;
    requireFixture(
      JSON.stringify(ordered(sortRows(actual))) === JSON.stringify(ordered(sortRows(expected[table]))),
      `STORED_${table.toUpperCase()}_MISMATCH`,
    );
  }
  const stamps = (
    await client.query(
      `SELECT count(*)::text AS count FROM public.journal_entries WHERE (status='POSTED')<>(posted_at IS NOT NULL)`,
    )
  ).rows[0];
  requireFixture(stamps.count === '0', 'STORED_POSTING_STATE_MISMATCH');
}

async function verifyReader(client: pg.Client, refs: References, reader: string, database: string) {
  const role = (await client.query('SELECT * FROM pg_roles WHERE rolname=$1', [reader])).rows[0];
  requireFixture(
    role &&
      !role.rolcanlogin &&
      !role.rolsuper &&
      !role.rolcreatedb &&
      !role.rolcreaterole &&
      !role.rolreplication &&
      !role.rolbypassrls &&
      !role.rolinherit,
    'UNSAFE_READER_ROLE',
  );
  requireFixture(
    (
      await client.query(
        'SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=$1',
        [reader],
      )
    ).rowCount === 0,
    'READER_ROLE_MEMBERSHIP',
  );
  await client.query(`SET LOCAL ROLE ${reader}`);
  const privileges = (
    await client.query(
      `SELECT has_schema_privilege(current_user,'public','CREATE') AS create_schema,
    has_database_privilege(current_user,$1,'TEMP') AS temporary,
    EXISTS(SELECT 1 FROM information_schema.tables t WHERE t.table_schema='public' AND
      (has_table_privilege(current_user,quote_ident(t.table_schema)||'.'||quote_ident(t.table_name),'INSERT') OR
       has_table_privilege(current_user,quote_ident(t.table_schema)||'.'||quote_ident(t.table_name),'UPDATE') OR
       has_table_privilege(current_user,quote_ident(t.table_schema)||'.'||quote_ident(t.table_name),'DELETE') OR
       has_table_privilege(current_user,quote_ident(t.table_schema)||'.'||quote_ident(t.table_name),'TRUNCATE'))) AS writable`,
      [database],
    )
  ).rows[0];
  requireFixture(
    !privileges.create_schema && !privileges.temporary && !privileges.writable,
    'READER_WRITE_PERMISSION',
  );
  const expected = expectedRows(refs);
  for (const table of tables) {
    const visible = (await client.query(`SELECT id::text AS id FROM public.${table} ORDER BY id`)).rows.map(
      (r) => r.id,
    );
    const allowed = expected[table]
      .filter((r) => (table === 'organizations' ? r.id : r.organization_id) === refs.fixture.organization_id)
      .map((r) => r.id)
      .sort();
    requireFixture(
      JSON.stringify(visible) === JSON.stringify(allowed),
      `READER_${table.toUpperCase()}_SCOPE`,
    );
  }
  const facts = (await client.query(oracleQuery, [refs.fixture.organization_id, refs.fixture.business_date]))
    .rows[0]?.facts as Record<string, unknown>;
  requireFixture(
    facts && Object.keys(facts).length === Object.keys(refs.facts).length,
    'DATABASE_ORACLE_KEY_COUNT',
  );
  for (const [id, expectedFact] of Object.entries(refs.facts))
    requireFixture(sameValue(facts[id], expectedFact.value), `DATABASE_ORACLE_MISMATCH:${id}`);
  await client.query('RESET ROLE');
  return Object.keys(refs.facts).length;
}

export async function verifyDatabase(
  ownerUrl: string,
  database: string,
  mode: 'seed-check' | 'verify',
  root = process.cwd(),
) {
  const { readerRole } = assertTarget(ownerUrl, database);
  requireFixture(mode === 'seed-check' || mode === 'verify', 'INVALID_FIXTURE_MODE');
  const refs = readReferences(root);
  const client = new pg.Client({
    connectionString: ownerUrl,
    connectionTimeoutMillis: 3000,
    statement_timeout: 15_000,
  });
  let connected = false,
    transaction = false;
  let phase = 'CONNECT';
  try {
    await client.connect();
    connected = true;
    requireFixture(
      (await client.query('SELECT current_database() AS name')).rows[0].name === database,
      'CONNECTED_DATABASE_MISMATCH',
    );
    phase = 'MIGRATIONS';
    const migrations = await assertMigrations(client, root);
    await client.query(mode === 'seed-check' ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transaction = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('daybook_analyst_workspace_fixture'))");
    if (mode === 'seed-check') {
      phase = 'SEED_ROWS';
      await load(client, refs);
      phase = 'READER_INSTALL';
      await installReader(client, readerRole, database, refs.fixture.organization_id);
    }
    phase = 'ROW_VERIFICATION';
    const before = await snapshot(client);
    await verifyRows(client, refs);
    phase = 'READER_AND_ORACLE_VERIFICATION';
    const factChecks = await verifyReader(client, refs, readerRole, database);
    phase = 'FINAL_FINGERPRINT';
    const after = await snapshot(client);
    requireFixture(before.hash === after.hash, 'VERIFICATION_CHANGED_BOOKS');
    if (mode === 'seed-check')
      await client.query(
        "SELECT setval(pg_get_serial_sequence('public.journal_entries','number'),(SELECT max(number) FROM public.journal_entries),true)",
      );
    phase = 'COMMIT';
    await client.query('COMMIT');
    transaction = false;
    return {
      version: 1,
      mode,
      businessDate: refs.fixture.business_date,
      organizationId: refs.fixture.organization_id,
      referenceHashes: refs.hashes,
      migrations,
      counts: before.counts,
      lineChecks: before.counts.journal_lines,
      factChecks,
      readerRole,
      readerIsolation: true,
      readerWritesPermitted: false,
      fingerprintBefore: before.hash,
      fingerprintAfter: after.hash,
      modelCalls: 0,
      caveat: 'Fixture/database verification only; no assistant accuracy score.',
    };
  } catch (error) {
    if (error instanceof FixtureError) throw error;
    const code = (error as { code?: unknown })?.code;
    const safeCode =
      typeof code === 'string' &&
      (/^[0-9A-Z]{5}$/.test(code) || ['ECONNREFUSED', 'EPERM', 'EACCES', 'ETIMEDOUT'].includes(code))
        ? code
        : 'UNKNOWN';
    throw new FixtureError(`DATABASE_${phase}_FAILED:${safeCode}`);
  } finally {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined);
    if (connected) await client.end();
  }
}

/** Read-only audit of the one newly provisioned remote acceptance fixture. Never seeds or migrates. */
export async function verifyPinnedRemoteDatabase(
  auditUrl: string,
  expectedHostname: string,
  root = process.cwd(),
) {
  const target = assertPinnedRemoteTarget(auditUrl, expectedHostname);
  const refs = readReferences(root);
  const client = new pg.Client({
    connectionString: target.connectionString,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 5000,
    statement_timeout: 15_000,
  });
  let connected = false,
    transaction = false;
  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transaction = true;
    const identity = (
      await client.query(`SELECT current_database() AS database,current_user AS role,
      r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolinherit
      FROM pg_roles r WHERE r.rolname=current_user`)
    ).rows[0];
    requireFixture(
      identity?.database === target.database &&
        identity.role === target.auditRole &&
        !identity.rolsuper &&
        !identity.rolcreatedb &&
        !identity.rolcreaterole &&
        !identity.rolreplication &&
        !identity.rolbypassrls &&
        !identity.rolinherit,
      'REMOTE_AUDITOR_IDENTITY_OR_PRIVILEGES',
    );
    const privileges = (
      await client.query(`SELECT
      has_schema_privilege(current_user,'public','CREATE') AS create_schema,
      has_database_privilege(current_user,current_database(),'TEMP') AS temporary,
      EXISTS(SELECT 1 FROM information_schema.tables t WHERE t.table_schema IN('public','analytics','querio_fixture') AND
        (has_table_privilege(current_user,quote_ident(t.table_schema)||'.'||quote_ident(t.table_name),'INSERT') OR
         has_table_privilege(current_user,quote_ident(t.table_schema)||'.'||quote_ident(t.table_name),'UPDATE') OR
         has_table_privilege(current_user,quote_ident(t.table_schema)||'.'||quote_ident(t.table_name),'DELETE') OR
         has_table_privilege(current_user,quote_ident(t.table_schema)||'.'||quote_ident(t.table_name),'TRUNCATE'))) AS writable`)
    ).rows[0];
    requireFixture(
      !privileges.create_schema && !privileges.temporary && !privileges.writable,
      'REMOTE_AUDITOR_WRITE_PERMISSION',
    );
    const migrations = await assertMigrations(client, root);
    const before = await snapshot(client);
    await verifyRows(client, refs);
    const factChecks = await verifyReader(client, refs, target.readerRole, target.database);
    const after = await snapshot(client);
    requireFixture(before.hash === after.hash, 'VERIFICATION_CHANGED_BOOKS');
    await client.query('COMMIT');
    transaction = false;
    return {
      version: 1,
      mode: 'verify' as const,
      targetScope: 'dedicated-remote-acceptance-fixture',
      businessDate: refs.fixture.business_date,
      organizationId: refs.fixture.organization_id,
      referenceHashes: refs.hashes,
      migrations,
      counts: before.counts,
      lineChecks: before.counts.journal_lines,
      factChecks,
      readerRole: target.readerRole,
      readerIsolation: true,
      readerWritesPermitted: false,
      fingerprintBefore: before.hash,
      fingerprintAfter: after.hash,
      modelCalls: 0,
      caveat:
        'Read-only fixture verification, not model accuracy. This credential cannot seed, migrate or change books.',
    };
  } catch (error) {
    if (error instanceof FixtureError) throw error;
    const code = (error as { code?: unknown })?.code;
    throw new FixtureError(
      typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
        ? `REMOTE_FIXTURE_FAILED:${code}`
        : 'REMOTE_FIXTURE_VERIFICATION_FAILED',
    );
  } finally {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined);
    if (connected) await client.end();
  }
}
