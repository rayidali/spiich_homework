import { createHash } from 'node:crypto';
import { accounts, entries, entryLines } from '../flexible-analytics-evaluation/fixture';

/** Pure export: this module never connects to a database or a model provider. */
export type QuerioFixtureExportOptions = {
  databaseName: string;
  readerRole?: string;
  schema?: string;
  storageSchema?: string;
};

const businessDate = '2026-11-03';
const defaults = {
  readerRole: 'daybook_querio_reader',
  schema: 'daybook_querio',
  storageSchema: 'daybook_querio_storage',
} as const;

function identifier(value: string): string {
  if (!/^daybook_querio(?:_[a-z0-9]+)*$/.test(value) || value.length > 63)
    throw new Error(
      'Querio fixture identifiers must be lowercase daybook_querio-prefixed names, at most 63 characters.',
    );
  return `"${value}"`;
}

function literal(value: string): string {
  if (value.includes('\0')) throw new Error('NUL is not valid PostgreSQL text.');
  return `'${value.replaceAll("'", "''")}'`;
}

function stableId(name: string): string {
  const value = createHash('sha256').update(`daybook-querio-fixture-v1:${name}`).digest('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

function insert(table: string, columns: string[], rows: (string | number | boolean)[][]): string {
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${rows
    .map(
      (row) =>
        `  (${row.map((value) => (typeof value === 'string' ? literal(value) : String(value))).join(', ')})`,
    )
    .join(',\n')};`;
}

/** Exact same records as the native route; gold totals and case definitions are not exported. */
export function querioFixtureRecords() {
  const organizations = (['primary', 'other'] as const).map((workspace) => ({
    id: stableId(`organization:${workspace}`),
    name: `Disposable flexible analysis ${workspace}`,
    base_currency: 'USD',
    workspace,
  }));
  const chart = organizations.flatMap((organization) =>
    accounts.map((account) => ({
      id: stableId(`account:${organization.workspace}:${account.code}`),
      organization_id: organization.id,
      code: account.code,
      name: account.name,
      type: account.type,
      currency: 'USD',
      is_cash: account.cash,
    })),
  );
  const journals = entries.map((entry) => ({
    id: stableId(`entry:${entry.id}`),
    organization_id: organizations.find((organization) => organization.workspace === entry.workspace)!.id,
    date: entry.date,
    description: 'Independent acceptance fixture',
    counterparty: entry.counterparty,
    status: entry.status,
  }));
  const lines = entries.flatMap((entry) =>
    entryLines(entry).map((line, position) => ({
      id: stableId(`line:${entry.id}:${position}`),
      organization_id: organizations.find((organization) => organization.workspace === entry.workspace)!.id,
      entry_id: stableId(`entry:${entry.id}`),
      account_id: stableId(`account:${entry.workspace}:${line.account}`),
      position,
      currency: 'USD',
      debit: line.debit,
      credit: line.credit,
      exchange_rate: '1',
    })),
  );
  return { organizations, accounts: chart, entries: journals, lines };
}

export function exportQuerioFixture(options: QuerioFixtureExportOptions) {
  const names = { ...defaults, ...options };
  const database = identifier(names.databaseName);
  const reader = identifier(names.readerRole);
  const schema = identifier(names.schema);
  const storage = identifier(names.storageSchema);
  if (new Set([names.readerRole, names.schema, names.storageSchema]).size !== 3)
    throw new Error('Reader role and the two schema names must be distinct.');
  const records = querioFixtureRecords();
  const primary = records.organizations.find((organization) => organization.workspace === 'primary')!.id;
  const fixtureSha256 = createHash('sha256').update(JSON.stringify(records)).digest('hex');
  const firstYear = Math.min(...records.entries.map((entry) => Number(entry.date.slice(0, 4))));
  const lastYear = Math.max(...records.entries.map((entry) => Number(entry.date.slice(0, 4))));
  const context = [
    'Daybook synthetic accounting fixture. This datasource is for evaluation, not the production application.',
    `The business date is ${businessDate}; interpret today, this year and year-to-date using workspace_context.business_date, not the database server clock.`,
    `Query only ${names.schema}.ledger_lines, ${names.schema}.chart_of_accounts, ${names.schema}.calendar_months and ${names.schema}.workspace_context.`,
    'These views are already restricted to one business workspace. ledger_lines contains POSTED entries and DRAFT entries; actual recorded financial answers must filter status = POSTED unless drafts are explicitly requested. Drafts do not affect posted reports.',
    'One ledger row is one journal line, not one transaction. A journal has two or more balanced debit/credit lines. Count distinct entry_id for transactions; do not count both sides or add their absolute values as spending.',
    'Account type determines the sign: net expenses sum base_debit - base_credit only for EXPENSE accounts; revenue sums base_credit - base_debit only for REVENUE accounts. Profit is revenue minus net expenses. Negative net expenses represent refunds and retain their sign.',
    'An account code or counterparty filter applies only to the requested population. For a category share of total expenses, the numerator is the category and the denominator includes all expense accounts in the same period; do not accidentally filter the denominator too.',
    'The base currency is USD. base_debit/base_credit are stored rounded conversions using the recorded exchange_rate. debit/credit are native account-currency amounts; never add different native currencies. This fixture contains only USD at rate 1, so it cannot evaluate foreign-exchange behavior.',
    'Transaction dates are accounting dates with inclusive requested bounds. Future-dated POSTED entries exist; through today excludes dates after business_date. A balance as of a date includes all posted history up to that date. Cash means accounts where is_cash is true, not all assets.',
    'calendar_months is a date scaffold, not financial data. When every calendar month or quiet months are requested, left join it to correctly filtered aggregates and fill missing monetary totals with zero. Do not drop quiet months from medians or moving windows.',
    'For ratios, divide exact numeric amounts before presentation rounding. A zero denominator yields NULL/unavailable, not zero percent; refunds may make a ratio negative or greater than 100%. A weighted annual share differs from the mean of monthly percentages.',
    'Use the exact counterparty comparison requested. Return every requested output, period and grouping. Ask for clarification when the time range or percentage denominator remains ambiguous; do not invent them.',
    'No employee roster, salary commitments, documents or external business facts are included. Identify scenarios and user-supplied assumptions explicitly; do not invent unsupported facts.',
  ].join('\n\n');

  const sql = `-- Daybook / Querio isolated synthetic fixture, version 1.
-- No live records, credentials, expected answers or grading cases are included.
-- Run only as owner of a fresh dedicated database. This intentionally fails on rerun.
-- Reader is created NOLOGIN; the operator sets its private password/login separately.
-- Record SHA256: ${fixtureSha256}
BEGIN;
SET LOCAL standard_conforming_strings = on;
DO $fixture_guard$
BEGIN
  IF current_database() <> ${literal(names.databaseName)} THEN
    RAISE EXCEPTION 'Wrong database for isolated Querio fixture';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public', 'information_schema') AND nspname NOT LIKE 'pg_%')
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') THEN
    RAISE EXCEPTION 'Querio fixture requires a fresh empty database';
  END IF;
END;
$fixture_guard$;
CREATE ROLE ${reader} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
REVOKE ALL ON DATABASE ${database} FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE ${database} TO ${reader};
ALTER ROLE ${reader} SET default_transaction_read_only = on;
ALTER ROLE ${reader} SET statement_timeout = '10s';
ALTER ROLE ${reader} SET lock_timeout = '2s';
ALTER ROLE ${reader} SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE ${reader} SET search_path = ${schema}, pg_catalog;
CREATE SCHEMA ${storage};
CREATE SCHEMA ${schema};
REVOKE ALL ON SCHEMA ${storage}, ${schema} FROM PUBLIC;
CREATE TABLE ${storage}.organizations (
  id uuid PRIMARY KEY, name text NOT NULL,
  base_currency text NOT NULL CHECK (base_currency = 'USD')
);
CREATE TABLE ${storage}.accounts (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES ${storage}.organizations(id),
  code text NOT NULL, name text NOT NULL,
  type text NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  currency text NOT NULL CHECK (currency = 'USD'), is_cash boolean NOT NULL,
  UNIQUE (organization_id, id), UNIQUE (organization_id, code),
  CHECK (NOT is_cash OR type = 'ASSET')
);
CREATE TABLE ${storage}.journal_entries (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES ${storage}.organizations(id),
  date date NOT NULL, description text NOT NULL, counterparty text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','POSTED')),
  UNIQUE (organization_id, id)
);
CREATE TABLE ${storage}.journal_lines (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, entry_id uuid NOT NULL, account_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0), currency text NOT NULL CHECK (currency = 'USD'),
  debit numeric NOT NULL, credit numeric NOT NULL, exchange_rate numeric NOT NULL CHECK (exchange_rate = 1),
  base_debit numeric GENERATED ALWAYS AS (round(debit * exchange_rate, 2)) STORED,
  base_credit numeric GENERATED ALWAYS AS (round(credit * exchange_rate, 2)) STORED,
  FOREIGN KEY (organization_id, entry_id) REFERENCES ${storage}.journal_entries(organization_id, id),
  FOREIGN KEY (organization_id, account_id) REFERENCES ${storage}.accounts(organization_id, id),
  UNIQUE (entry_id, position),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  CHECK (debit = round(debit, 2) AND credit = round(credit, 2))
);
${insert(
  `${storage}.organizations`,
  ['id', 'name', 'base_currency'],
  records.organizations.map((row) => [row.id, row.name, row.base_currency]),
)}
${insert(
  `${storage}.accounts`,
  ['id', 'organization_id', 'code', 'name', 'type', 'currency', 'is_cash'],
  records.accounts.map((row) => [
    row.id,
    row.organization_id,
    row.code,
    row.name,
    row.type,
    row.currency,
    row.is_cash,
  ]),
)}
${insert(
  `${storage}.journal_entries`,
  ['id', 'organization_id', 'date', 'description', 'counterparty', 'status'],
  records.entries.map((row) => [
    row.id,
    row.organization_id,
    row.date,
    row.description,
    row.counterparty,
    row.status,
  ]),
)}
${insert(
  `${storage}.journal_lines`,
  [
    'id',
    'organization_id',
    'entry_id',
    'account_id',
    'position',
    'currency',
    'debit',
    'credit',
    'exchange_rate',
  ],
  records.lines.map((row) => [
    row.id,
    row.organization_id,
    row.entry_id,
    row.account_id,
    row.position,
    row.currency,
    row.debit,
    row.credit,
    row.exchange_rate,
  ]),
)}
DO $fixture_balance$
BEGIN
  IF EXISTS (
    SELECT e.id FROM ${storage}.journal_entries e LEFT JOIN ${storage}.journal_lines l ON l.entry_id = e.id
    GROUP BY e.id HAVING count(l.id) < 2 OR sum(l.base_debit - l.base_credit) <> 0
  ) THEN RAISE EXCEPTION 'Unbalanced fixture entry'; END IF;
END;
$fixture_balance$;
CREATE VIEW ${schema}.ledger_lines WITH (security_barrier = true) AS
SELECT l.id AS line_id, e.id AS entry_id, e.date, e.description, e.counterparty, e.status,
       a.id AS account_id, a.code AS account_code, a.name AS account_name, a.type AS account_type,
       a.is_cash, l.position, l.currency, l.debit, l.credit, l.exchange_rate,
       o.base_currency, l.base_debit, l.base_credit
FROM ${storage}.journal_entries e
JOIN ${storage}.journal_lines l ON l.organization_id = e.organization_id AND l.entry_id = e.id
JOIN ${storage}.accounts a ON a.organization_id = l.organization_id AND a.id = l.account_id
JOIN ${storage}.organizations o ON o.id = e.organization_id
WHERE e.organization_id = ${literal(primary)}::uuid;
CREATE VIEW ${schema}.chart_of_accounts WITH (security_barrier = true) AS
SELECT id AS account_id, code AS account_code, name AS account_name, type AS account_type, currency, is_cash
FROM ${storage}.accounts WHERE organization_id = ${literal(primary)}::uuid;
CREATE VIEW ${schema}.workspace_context AS
SELECT 'Daybook synthetic evaluation workspace'::text AS workspace_name,
       'USD'::text AS base_currency, DATE ${literal(businessDate)} AS business_date;
CREATE VIEW ${schema}.calendar_months AS
SELECT (DATE '${firstYear}-01-01' + make_interval(months => i))::date AS month_start,
       (DATE '${firstYear}-01-01' + make_interval(months => i + 1) - INTERVAL '1 day')::date AS month_end,
       to_char(DATE '${firstYear}-01-01' + make_interval(months => i), 'YYYY-MM') AS month
FROM generate_series(0, ${(lastYear - firstYear + 1) * 12 - 1}) AS offsets(i);
COMMENT ON VIEW ${schema}.ledger_lines IS 'Primary workspace only. One row per journal line; default financial reports require status=POSTED. Expense=base_debit-base_credit for EXPENSE accounts; revenue=base_credit-base_debit for REVENUE accounts. Preserve refunds. Do not double count cash counterparts.';
COMMENT ON VIEW ${schema}.chart_of_accounts IS 'Accounts of this workspace only. Missing activity is different from a missing account. Cash is is_cash=true, not every ASSET.';
COMMENT ON VIEW ${schema}.workspace_context IS 'Use business_date for today and year-to-date; the evaluation clock is fixed, independent of the server date.';
COMMENT ON VIEW ${schema}.calendar_months IS 'Date scaffold only. Left join correctly filtered aggregates to preserve quiet months when requested; this view contains no financial answers.';
GRANT USAGE ON SCHEMA ${schema} TO ${reader};
GRANT SELECT ON ${schema}.ledger_lines, ${schema}.chart_of_accounts, ${schema}.workspace_context, ${schema}.calendar_months TO ${reader};
COMMIT;
`;
  return {
    sql,
    context,
    // Operator-only checks: do not place these query results in Querio's context.
    // They contain no expected answers and do not change database state.
    verificationSql: {
      ownerInventory: `SELECT jsonb_build_object(
  'organizations', (SELECT count(*) FROM ${storage}.organizations),
  'accounts', (SELECT count(*) FROM ${storage}.accounts),
  'entries', (SELECT count(*) FROM ${storage}.journal_entries),
  'lines', (SELECT count(*) FROM ${storage}.journal_lines)
) AS counts, md5(jsonb_build_object(
  'organizations', (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM ${storage}.organizations o),
  'accounts', (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM ${storage}.accounts a),
  'entries', (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM ${storage}.journal_entries e),
  'lines', (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM ${storage}.journal_lines l)
)::text) AS fixture_fingerprint;`,
      ownerBalances: `SELECT e.id AS entry_id, count(l.id) AS lines, sum(l.base_debit-l.base_credit)::text AS imbalance
FROM ${storage}.journal_entries e LEFT JOIN ${storage}.journal_lines l ON l.entry_id=e.id
GROUP BY e.id HAVING count(l.id)<2 OR sum(l.base_debit-l.base_credit)<>0;`,
      readerIdentity: `SELECT current_database() AS database_name, current_user AS reader_role,
current_setting('default_transaction_read_only') AS default_read_only,
has_database_privilege(current_user,current_database(),'CREATE') AS can_create_schema,
has_database_privilege(current_user,current_database(),'TEMP') AS can_create_temp,
has_schema_privilege(current_user,${literal(names.storageSchema)},'USAGE') AS can_access_storage,
has_schema_privilege(current_user,${literal(names.schema)},'CREATE') AS can_create_in_reader_schema,
has_table_privilege(current_user,${literal(`${names.schema}.ledger_lines`)},'SELECT') AS can_read_ledger,
has_table_privilege(current_user,${literal(`${names.schema}.ledger_lines`)},'INSERT,UPDATE,DELETE,TRUNCATE') AS can_write_ledger;`,
      readerInventory: `SELECT count(*) AS lines, count(DISTINCT entry_id) AS entries,
count(DISTINCT entry_id) FILTER (WHERE status='DRAFT') AS draft_entries,
(SELECT count(*) FROM ${schema}.chart_of_accounts) AS accounts
FROM ${schema}.ledger_lines;`,
      readerTotals: `WITH periods(name,from_date,to_date) AS (
VALUES ('calendar_2025',DATE '2025-01-01',DATE '2025-12-31'),
       ('year_to_business_date',DATE '2026-01-01',DATE '${businessDate}')
)
SELECT p.name,
coalesce(sum(l.base_debit-l.base_credit) FILTER (WHERE l.account_type='EXPENSE'),0)::text AS net_expenses,
coalesce(sum(l.base_credit-l.base_debit) FILTER (WHERE l.account_type='REVENUE'),0)::text AS revenue,
coalesce(sum(l.base_debit-l.base_credit) FILTER (WHERE l.account_code='5010'),0)::text AS rent
FROM periods p LEFT JOIN ${schema}.ledger_lines l ON l.status='POSTED' AND l.date BETWEEN p.from_date AND p.to_date
GROUP BY p.name ORDER BY p.name;`,
    },
    manifest: {
      version: 'querio-fixture-export-v1',
      databaseName: names.databaseName,
      readerRole: names.readerRole,
      schema: names.schema,
      storageSchema: names.storageSchema,
      businessDate,
      fixtureSha256,
      sqlSha256: createHash('sha256').update(sql).digest('hex'),
      counts: {
        organizations: records.organizations.length,
        accounts: records.accounts.length,
        entries: records.entries.length,
        lines: records.lines.length,
        readerAccounts: records.accounts.filter((row) => row.organization_id === primary).length,
        readerEntries: records.entries.filter((row) => row.organization_id === primary).length,
        readerLines: records.lines.filter((row) => row.organization_id === primary).length,
      },
      limitations: [
        'Pure export only; SQL execution, live privileges and Querio answers require separate verification.',
        'This is a dedicated read-only fixture copy, not the full Daybook transactional schema or a production migration.',
        'The fixture contains USD only and does not evaluate native-currency or FX behavior.',
        'The reader receives semantic views; any model comparison must disclose this interface difference.',
      ],
    },
  };
}
