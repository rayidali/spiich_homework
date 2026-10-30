import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { accounts, documents, entries, primaryOrganizationId } from './dataset';
import { ResearchDatabase } from './database';
import { atomicJson, httpTransport } from './io';

/** Explicit separate research provisioning; never calls demo seed/migrations. */
export async function setupDatabase(ownerUrl: string) {
  const db = new ResearchDatabase(ownerUrl, httpTransport());
  const statePath = '.tools/research/database-private.json';
  mkdirSync('.tools/research', { recursive: true, mode: 0o700 });
  const password = existsSync(statePath)
    ? (JSON.parse(readFileSync(statePath, 'utf8')) as { password: string }).password
    : randomBytes(36).toString('hex');
  if (!/^[a-f0-9]{72}$/.test(password)) throw new Error('RESEARCH_PASSWORD_FORMAT');
  const reader = new URL(ownerUrl);
  reader.username = 'daybook_research_reader';
  reader.password = password;
  atomicJson(statePath, { password, readerUrl: reader.toString() });
  const statements = [
    'CREATE EXTENSION IF NOT EXISTS vector',
    'CREATE EXTENSION IF NOT EXISTS pg_trgm',
    'CREATE SCHEMA IF NOT EXISTS research',
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='daybook_research_reader') THEN CREATE ROLE daybook_research_reader LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF; END $$`,
    'ALTER ROLE daybook_research_reader SET default_transaction_read_only=on',
    "ALTER ROLE daybook_research_reader SET statement_timeout='3s'",
    "ALTER ROLE daybook_research_reader SET lock_timeout='1s'",
    "ALTER ROLE daybook_research_reader SET search_path='research,pg_catalog'",
    'REVOKE ALL ON SCHEMA research FROM PUBLIC',
    `CREATE TABLE IF NOT EXISTS research.ledger (organization_id uuid NOT NULL,entry_id text NOT NULL,date date NOT NULL,status text NOT NULL,description text NOT NULL,vendor text NOT NULL,account_code text NOT NULL,account_name text NOT NULL,account_type text NOT NULL,currency text NOT NULL,is_cash boolean NOT NULL,debit numeric(24,2) NOT NULL,credit numeric(24,2) NOT NULL,base_debit numeric(24,2) NOT NULL,base_credit numeric(24,2) NOT NULL,exchange_rate numeric(24,8) NOT NULL,PRIMARY KEY(organization_id,entry_id,account_code))`,
    `CREATE TABLE IF NOT EXISTS research.documents (id text PRIMARY KEY,organization_id uuid NOT NULL,title text NOT NULL,version integer NOT NULL,effective_from date NOT NULL,effective_to date,text text NOT NULL,embedding vector(768),content_hash text NOT NULL)`,
    `CREATE OR REPLACE VIEW research.scoped_ledger WITH (security_barrier=true) AS SELECT * FROM research.ledger WHERE organization_id='${primaryOrganizationId}' AND status='POSTED'`,
    `CREATE OR REPLACE VIEW research.scoped_documents WITH (security_barrier=true) AS SELECT * FROM research.documents WHERE organization_id='${primaryOrganizationId}'`,
    'GRANT USAGE ON SCHEMA research TO daybook_research_reader',
    'GRANT SELECT ON research.scoped_ledger,research.scoped_documents TO daybook_research_reader',
  ];
  for (const sql of statements) await db.execute(sql);
  const rows = entries.flatMap((entry) =>
    entry.lines.map((line) => {
      const account = accounts.find((a) => a.code === line.accountCode)!;
      return [
        entry.organizationId,
        entry.id,
        entry.date,
        entry.status,
        entry.description,
        entry.vendor,
        line.accountCode,
        account.name,
        account.type,
        line.currency,
        account.isCash,
        line.debit,
        line.credit,
        line.baseDebit,
        line.baseCredit,
        line.exchangeRate,
      ];
    }),
  );
  for (let offset = 0; offset < rows.length; offset += 30) {
    const batch = rows.slice(offset, offset + 30),
      params = batch.flat();
    const values = batch.map((row, i) => `(${row.map((_, j) => `$${i * 16 + j + 1}`).join(',')})`).join(',');
    await db.execute(`INSERT INTO research.ledger VALUES ${values} ON CONFLICT DO NOTHING`, params);
  }
  for (const doc of documents) {
    const hash = createHash('sha256').update(doc.text).digest('hex');
    await db.execute(
      'INSERT INTO research.documents(id,organization_id,title,version,effective_from,effective_to,text,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
      [
        doc.id,
        doc.organizationId,
        doc.title,
        doc.version,
        doc.effectiveFrom,
        doc.effectiveTo,
        doc.text,
        hash,
      ],
    );
  }
  const readerDb = new ResearchDatabase(reader.toString(), httpTransport());
  const fingerprint = await readerDb.fingerprint();
  const facts = await readerDb.execute(
    'SELECT count(*)::text AS lines, count(DISTINCT entry_id)::text AS entries,coalesce(sum(base_debit-base_credit),0)::text AS imbalance FROM research.scoped_ledger',
  );
  if (facts.rows[0].imbalance !== '0.00') throw new Error('RESEARCH_FIXTURE_UNBALANCED');
  atomicJson('.tools/research/database-setup.json', {
    at: new Date().toISOString(),
    fingerprint,
    facts: facts.rows,
    databaseTransport: process.env.RESEARCH_DB_TRANSPORT ?? 'neon-http',
    isolation:
      process.env.RESEARCH_DB_TRANSPORT === 'postgres'
        ? 'Dedicated research schema and restricted role over native PostgreSQL; server topology is not inferred'
        : 'Dedicated research schema and restricted role over Neon HTTP; server topology is not inferred',
    extension: 'vector',
    fixtureHash: createHash('sha256').update(JSON.stringify({ entries, documents })).digest('hex'),
  });
  return { fingerprint, facts: facts.rows };
}
