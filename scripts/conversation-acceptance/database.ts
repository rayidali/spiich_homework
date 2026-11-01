import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Decimal } from '../../shared/money';
import { accounts, entries } from '../../tests/conversation-acceptance/book';
import { cases, oracles } from '../../tests/conversation-acceptance/cases';
import { validateSpecification } from '../../tests/conversation-acceptance/validate';
import { databaseTarget, requireCondition, sha256 } from './protocol';

export function decimalCents(value: string) {
  requireCondition(/^\d+$/.test(value), 'FIXTURE_CENTS');
  const padded = value.padStart(3, '0');
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}
export function nativeLine(entryId: string, line: (typeof entries)[number]['lines'][number]) {
  if (entryId === 'oct-travel' && line.account === '6110') {
    requireCondition(line.baseDebitCents === '22000' && line.baseCreditCents === '0', 'FX_FIXTURE_CHANGED');
    return { debit: '200.00', credit: '0.00', exchangeRate: '1.10' };
  }
  return {
    debit: decimalCents(line.baseDebitCents),
    credit: decimalCents(line.baseCreditCents),
    exchangeRate: '1',
  };
}

export async function seedDatabase(
  ownerUrl: string,
  runtimeUrl: string,
  expectedName: string,
  root = process.cwd(),
) {
  databaseTarget(ownerUrl, runtimeUrl, expectedName);
  requireCondition(validateSpecification(cases, oracles).length === 0, 'INVALID_SPECIFICATION');
  const owner = new pg.Client({ connectionString: ownerUrl });
  const runtime = new pg.Client({ connectionString: runtimeUrl });
  let transaction = false;
  let ownerConnected = false;
  let runtimeConnected = false;
  try {
    await owner.connect();
    ownerConnected = true;
    await runtime.connect();
    runtimeConnected = true;
    const ownerIdentity = (await owner.query('SELECT current_database() AS name,current_user AS role'))
      .rows[0];
    const runtimeIdentity = (
      await runtime.query(
        'SELECT current_database() AS name,current_user AS role,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    requireCondition(
      ownerIdentity.name === expectedName &&
        runtimeIdentity.name === expectedName &&
        ownerIdentity.role !== runtimeIdentity.role,
      'DATABASE_IDENTITY',
    );
    requireCondition(
      !runtimeIdentity.rolsuper && !runtimeIdentity.rolcreatedb && !runtimeIdentity.rolcreaterole,
      'RUNTIME_PRIVILEGES',
    );
    const migrated = (await owner.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
    const migrationNames = readdirSync(join(root, 'db/migrations'))
      .filter((n) => n.endsWith('.sql'))
      .sort();
    requireCondition(
      migrated.length === migrationNames.length &&
        migrated.every(
          (row, i) =>
            row.name === migrationNames[i] &&
            row.checksum === sha256(readFileSync(join(root, 'db/migrations', row.name))),
        ),
      'MIGRATION_MISMATCH',
    );
    await owner.query('BEGIN');
    transaction = true;
    await owner.query("SELECT pg_advisory_xact_lock(hashtext('daybook_conversation_acceptance_seed'))");
    const count = (await owner.query('SELECT count(*)::text AS count FROM organizations')).rows[0].count;
    requireCondition(count === '0', 'DATABASE_NOT_EMPTY');
    const org = randomUUID();
    await owner.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
      org,
      'Disposable conversation acceptance fixture',
    ]);
    const ids = new Map<string, string>();
    for (const account of accounts) {
      const id = randomUUID();
      ids.set(account.code, id);
      await owner.query(
        'INSERT INTO accounts(id,organization_id,code,name,type,currency,is_cash) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id, org, account.code, account.name, account.type, account.currency, account.cash],
      );
    }
    const entryIds = new Map<string, string>();
    for (const entry of entries) {
      const id = randomUUID();
      entryIds.set(entry.id, id);
      await owner.query(
        "INSERT INTO journal_entries(id,organization_id,date,description,counterparty,source,idempotency_key) VALUES($1,$2,$3,$4,$5,'SEED',$6)",
        [id, org, entry.date, entry.description, entry.counterparty, `conversation:${entry.id}`],
      );
      for (const [position, line] of entry.lines.entries()) {
        const account = accounts.find((a) => a.code === line.account)!;
        const native = nativeLine(entry.id, line);
        await owner.query(
          'INSERT INTO journal_lines(organization_id,entry_id,account_id,position,currency,debit,credit,exchange_rate) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            org,
            id,
            ids.get(line.account),
            position,
            account.currency,
            native.debit,
            native.credit,
            native.exchangeRate,
          ],
        );
      }
      if (entry.status === 'POSTED')
        await owner.query("UPDATE journal_entries SET status='POSTED',posted_at=now() WHERE id=$1", [id]);
    }
    await owner.query('COMMIT');
    transaction = false;
    const stored = (
      await runtime.query(
        'SELECT e.idempotency_key,e.status,e.date::text,a.code,l.position,l.currency,l.debit::text,l.credit::text,l.exchange_rate::text,l.base_debit::text,l.base_credit::text FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id WHERE e.organization_id=$1 ORDER BY e.idempotency_key,l.position',
        [org],
      )
    ).rows;
    requireCondition(
      stored.length === entries.reduce((count, e) => count + e.lines.length, 0),
      'STORED_LINE_COUNT',
    );
    for (const entry of entries)
      for (const [position, line] of entry.lines.entries()) {
        const found = stored.find(
          (row) => row.idempotency_key === `conversation:${entry.id}` && row.position === position,
        );
        requireCondition(
          found &&
            found.code === line.account &&
            found.date === entry.date &&
            found.status === entry.status &&
            found.base_debit === decimalCents(line.baseDebitCents) &&
            found.base_credit === decimalCents(line.baseCreditCents),
          'STORED_LINE_MISMATCH',
        );
        if (entry.id === 'oct-travel' && line.account === '6110')
          requireCondition(
            found.currency === 'EUR' &&
              Number(found.debit) === 200 &&
              Number(found.exchange_rate) === 1.1 &&
              found.base_debit === '220.00',
            'STORED_FX_MISMATCH',
          );
      }
    const chart = (
      await runtime.query(
        'SELECT id,code,name,type,currency,is_cash,is_group,parent_id FROM accounts WHERE organization_id=$1 ORDER BY code',
        [org],
      )
    ).rows;
    let oracleChecks = 0;
    for (const oracle of oracles) {
      if (oracle.kind !== 'recorded') continue;
      const valueExpression =
        oracle.metric === 'profit' ? 'l.base_credit-l.base_debit' : 'l.base_debit-l.base_credit';
      const accountPredicate =
        oracle.metric === 'cash_balance'
          ? "a.type='ASSET' AND a.is_cash"
          : oracle.metric === 'profit'
            ? "a.type IN ('REVENUE','EXPENSE')"
            : "a.type='EXPENSE'";
      const value = (
        await runtime.query(
          `SELECT coalesce(sum(${valueExpression}),0)::text AS amount
        FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
        WHERE e.organization_id=$1 AND e.status='POSTED' AND e.date<=$2
          AND ($3::date IS NULL OR e.date>=$3) AND (cardinality($4::text[])=0 OR a.code=ANY($4::text[]))
          AND ($5::text IS NULL OR e.counterparty=$5) AND ${accountPredicate}`,
          [org, oracle.to, oracle.from, oracle.accountCodes, oracle.counterparty],
        )
      ).rows[0].amount;
      requireCondition(new Decimal(value).times(100).eq(oracle.expectedCents), 'STORED_ORACLE_MISMATCH');
      oracleChecks++;
    }
    const fingerprint = async () => {
      await runtime.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const rows = (
          await runtime.query(`SELECT jsonb_build_object(
          'organizations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM organizations o),
          'accounts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM accounts a),
          'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM journal_entries e),
          'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM journal_lines l)) AS value`)
        ).rows[0].value;
        await runtime.query('COMMIT');
        return {
          hash: sha256(JSON.stringify(rows)),
          counts: {
            organizations: rows.organizations.length,
            accounts: rows.accounts.length,
            entries: rows.entries.length,
            lines: rows.lines.length,
          },
        };
      } catch (error) {
        await runtime.query('ROLLBACK');
        throw error;
      }
    };
    const before = await fingerprint();
    await owner.end();
    ownerConnected = false;
    return {
      org,
      chart,
      before,
      storedLineChecks: stored.length,
      oracleChecks,
      fingerprint,
      close: async () => {
        if (runtimeConnected) {
          await runtime.end();
          runtimeConnected = false;
        }
      },
    };
  } catch (error) {
    if (transaction) await owner.query('ROLLBACK').catch(() => undefined);
    if (ownerConnected) await owner.end().catch(() => undefined);
    if (runtimeConnected) await runtime.end().catch(() => undefined);
    throw error;
  }
}
