import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { z } from 'zod';
import type { AnalysisAccount } from '../../server/financial-analysis';
import type { AdaptiveEvaluationCase, ExpectedClaim, Formula } from './scoring';

const moneyText = z.string().regex(/^\d+(?:\.\d{1,2})?$/);
const accountSchema = z.strictObject({
  code: z.string().regex(/^\d{4}$/),
  name: z.string().min(1).max(100),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  parentCode: z.string().nullable(),
  currency: z.enum(['USD', 'EUR']),
  isCash: z.boolean(),
  isGroup: z.boolean(),
  archived: z.boolean(),
});
const lineSchema = z.strictObject({
  accountCode: z.string(),
  debit: moneyText,
  credit: moneyText,
  exchangeRate: z.string().regex(/^\d+(?:\.\d{1,10})?$/),
});
const entrySchema = z.strictObject({
  id: z.string().min(1),
  tenant: z.enum(['primary', 'foreign']),
  date: z.iso.date(),
  description: z.string().min(1).max(500),
  counterparty: z.string().max(100),
  reference: z.string(),
  status: z.enum(['POSTED', 'DRAFT']),
  reverses: z.string().nullable(),
  lines: z.array(lineSchema).min(2).max(100),
});
const ledgerSchema = z.strictObject({
  version: z.literal('adaptive-fixture-v1'),
  asOf: z.literal('2026-10-31'),
  authorship: z.string(),
  accounts: z.array(accountSchema),
  entries: z.array(entrySchema),
});
export type FixtureLedger = z.infer<typeof ledgerSchema>;
export const fixtureVersion = 'adaptive-fixture-v1';
export const fixtureFamilies = ['common', 'discovery', 'arithmetic', 'clarification'] as const;
export const fixtureFiles = [
  'scripts/adaptive-evaluation/fixtures/ledger.json',
  'scripts/adaptive-evaluation/fixtures/development.json',
  'scripts/adaptive-evaluation/fixtures/holdout.json',
  'scripts/adaptive-evaluation/fixtures/worked-totals.json',
] as const;
function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}
function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
export function loadLedger(): FixtureLedger {
  return ledgerSchema.parse(readJson('ledger'));
}
/** Loads only the explicitly selected split. Never pass the returned expected field to a provider. */
export function loadCases(split: AdaptiveEvaluationCase['split']): AdaptiveEvaluationCase[] {
  ensure(split === 'development' || split === 'holdout', 'FIXTURE_SPLIT_INVALID');
  const result = readJson(split) as AdaptiveEvaluationCase[];
  ensure(Array.isArray(result) && result.length === (split === 'development' ? 4 : 16), 'FIXTURE_CASE_COUNT');
  ensure(new Set(result.map((item) => item.id)).size === result.length, 'FIXTURE_DUPLICATE_CASE');
  for (const item of result) {
    ensure(
      item.split === split && fixtureFamilies.includes(item.family as (typeof fixtureFamilies)[number]),
      'FIXTURE_CASE_SPLIT',
    );
    ensure(
      item.messages.length === 1 &&
        item.messages[0].role === 'user' &&
        typeof item.messages[0].content === 'string',
      'FIXTURE_CONVERSATION',
    );
    ensure(['ANSWER', 'CLARIFY', 'REFUSE'].includes(item.expected.behavior), 'FIXTURE_BEHAVIOR');
  }
  for (const family of fixtureFamilies)
    ensure(
      result.filter((item) => item.family === family).length === (split === 'development' ? 1 : 4),
      'FIXTURE_FAMILY_COUNT',
    );
  return result;
}
/** Explicit provider-visible projection: no expected values, labels, scenario IDs or split. */
export function fixtureMessages(item: AdaptiveEvaluationCase) {
  return structuredClone(item.messages);
}
export function counterparties(ledger = loadLedger()) {
  return [
    ...new Set(ledger.entries.filter((item) => item.tenant === 'primary').map((item) => item.counterparty)),
  ].sort();
}

// This oracle intentionally uses integer cents and rational arithmetic. It does
// not import the SQL compiler, report tools, production Decimal helpers or an LLM.
type Rational = { n: bigint; d: bigint };
function rational(text: string): Rational {
  ensure(/^-?\d+(?:\.\d+)?$/.test(text), 'FIXTURE_DECIMAL_INVALID');
  const negative = text.startsWith('-'),
    clean = negative ? text.slice(1) : text;
  const [whole, fractional = ''] = clean.split('.');
  return { n: BigInt(whole + fractional) * (negative ? -1n : 1n), d: 10n ** BigInt(fractional.length) };
}
function cents(text: string): bigint {
  const value = rational(text);
  ensure((value.n * 100n) % value.d === 0n, 'FIXTURE_PRECISION_INVALID');
  return (value.n * 100n) / value.d;
}
function savedBase(text: string, rate: string) {
  const value = rational(text),
    fx = rational(rate);
  const numerator = value.n * fx.n * 100n,
    denominator = value.d * fx.d;
  ensure(numerator >= 0n && denominator > 0n, 'FIXTURE_RATE_INVALID');
  return (numerator * 2n + denominator) / (2n * denominator);
}
function decimal(value: bigint) {
  const sign = value < 0n ? '-' : '',
    magnitude = value < 0n ? -value : value;
  return `${sign}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`;
}
export function verifyLedger(ledger = loadLedger()) {
  const accounts = new Map(ledger.accounts.map((item) => [item.code, item]));
  ensure(accounts.size === ledger.accounts.length, 'FIXTURE_DUPLICATE_ACCOUNT');
  const entries = new Map(ledger.entries.map((item) => [item.id, item]));
  ensure(entries.size === ledger.entries.length, 'FIXTURE_DUPLICATE_ENTRY');
  for (const account of ledger.accounts) {
    ensure(!account.parentCode || accounts.get(account.parentCode)?.isGroup, 'FIXTURE_ACCOUNT_PARENT');
    ensure(!account.isCash || (account.type === 'ASSET' && !account.isGroup), 'FIXTURE_CASH_ACCOUNT');
  }
  for (const entry of ledger.entries) {
    ensure(entry.date <= ledger.asOf, 'FIXTURE_FUTURE_ENTRY');
    let debit = 0n,
      credit = 0n;
    for (const line of entry.lines) {
      const account = accounts.get(line.accountCode);
      ensure(account && !account.isGroup, 'FIXTURE_POSTING_ACCOUNT');
      ensure(cents(line.debit) > 0n !== cents(line.credit) > 0n, 'FIXTURE_LINE_SIDE');
      ensure(rational(line.exchangeRate).n > 0n, 'FIXTURE_RATE_INVALID');
      ensure(account.currency !== 'USD' || line.exchangeRate === '1', 'FIXTURE_USD_RATE');
      debit += savedBase(line.debit, line.exchangeRate);
      credit += savedBase(line.credit, line.exchangeRate);
    }
    ensure(debit === credit, 'FIXTURE_UNBALANCED_ENTRY');
    if (entry.reverses) {
      const original = entries.get(entry.reverses);
      ensure(
        original?.tenant === entry.tenant && original.status === 'POSTED' && entry.status === 'POSTED',
        'FIXTURE_REVERSAL_ORIGINAL',
      );
      const signature = (lines: FixtureLedger['entries'][number]['lines'], reverse: boolean) =>
        lines
          .map((line) =>
            JSON.stringify([
              line.accountCode,
              cents(reverse ? line.credit : line.debit).toString(),
              cents(reverse ? line.debit : line.credit).toString(),
              line.exchangeRate,
            ]),
          )
          .sort();
      ensure(
        JSON.stringify(signature(entry.lines, false)) === JSON.stringify(signature(original.lines, true)),
        'FIXTURE_REVERSAL_LINES',
      );
    }
  }
  return {
    accountsPerOrganization: accounts.size,
    organizations: 2,
    entries: entries.size,
    lines: ledger.entries.reduce((sum, item) => sum + item.lines.length, 0),
  };
}
export function referenceLedgerValue(
  claim: Extract<ExpectedClaim, { kind: 'ledger' }>,
  ledger = loadLedger(),
): string {
  const { scope, metric } = claim;
  ensure(
    [
      'net_expense',
      'net_revenue',
      'net_profit',
      'cash_balance',
      'account_balance',
      'net_cash_movement',
    ].includes(metric),
    'FIXTURE_ORACLE_METRIC',
  );
  ensure(
    scope.cooccurringAccountCodes.length === 0 &&
      scope.descriptionSearch === '' &&
      scope.minimumAmount === null &&
      scope.maximumAmount === null &&
      !scope.entryId &&
      !scope.averageDenominator,
    'FIXTURE_ORACLE_UNSUPPORTED_FILTER',
  );
  ensure(
    ['any', 'identity', 'exact', 'contains'].includes(scope.counterparty.mode),
    'FIXTURE_ORACLE_COUNTERPARTY',
  );
  const stock = metric === 'cash_balance' || metric === 'account_balance';
  ensure(
    stock ? scope.from === null && scope.asOf === scope.to : scope.from && scope.asOf === null,
    'FIXTURE_ORACLE_PERIOD',
  );
  const accounts = new Map(ledger.accounts.map((item) => [item.code, item]));
  for (const code of scope.accountCodes) {
    const account = accounts.get(code);
    ensure(account && !account.isGroup, 'FIXTURE_ORACLE_ACCOUNT');
    ensure(scope.currencyMode !== 'native' || account.currency === scope.currency, 'FIXTURE_ORACLE_CURRENCY');
    ensure(metric !== 'net_expense' || account.type === 'EXPENSE', 'FIXTURE_ORACLE_TYPE');
    ensure(metric !== 'net_revenue' || account.type === 'REVENUE', 'FIXTURE_ORACLE_TYPE');
    ensure(!['cash_balance', 'net_cash_movement'].includes(metric) || account.isCash, 'FIXTURE_ORACLE_CASH');
  }
  let total = 0n;
  for (const entry of ledger.entries) {
    if (
      entry.tenant !== 'primary' ||
      entry.status !== scope.status ||
      entry.date > scope.to! ||
      (scope.from && entry.date < scope.from)
    )
      continue;
    const filter = scope.counterparty;
    if (filter.mode === 'identity' && entry.counterparty !== filter.value) continue;
    if (filter.mode === 'exact' && entry.counterparty.toLowerCase() !== filter.value.toLowerCase()) continue;
    if (filter.mode === 'contains' && !entry.counterparty.toLowerCase().includes(filter.value.toLowerCase()))
      continue;
    for (const line of entry.lines) {
      if (!scope.accountCodes.includes(line.accountCode)) continue;
      const account = accounts.get(line.accountCode)!;
      const debit =
        scope.currencyMode === 'native' ? cents(line.debit) : savedBase(line.debit, line.exchangeRate);
      const credit =
        scope.currencyMode === 'native' ? cents(line.credit) : savedBase(line.credit, line.exchangeRate);
      const creditNormal =
        metric === 'net_revenue' ||
        metric === 'net_profit' ||
        (metric === 'account_balance' && ['LIABILITY', 'EQUITY', 'REVENUE'].includes(account.type));
      total += creditNormal ? credit - debit : debit - credit;
    }
  }
  return decimal(total);
}
export function verifyCaseReferences(item: AdaptiveEvaluationCase, ledger = loadLedger()) {
  const claims = [...item.expected.required, ...item.expected.supporting];
  const indexed = new Map(claims.map((claim) => [claim.id, claim]));
  ensure(indexed.size === claims.length, 'FIXTURE_DUPLICATE_CLAIM');
  const evaluating = new Set<string>();
  const evaluate = (formula: Formula): Rational => {
    if ('claim' in formula) return evaluateClaim(formula.claim);
    if ('assumption' in formula) {
      ensure(
        item.messages.some(
          (message) => message.role === 'user' && message.content.includes(formula.assumption.sourceText),
        ),
        'FIXTURE_ASSUMPTION_QUOTE',
      );
      return rational(formula.assumption.value);
    }
    const a = evaluate(formula.operands[0]),
      b = evaluate(formula.operands[1]);
    if (formula.operation === 'add') return { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
    if (formula.operation === 'subtract') return { n: a.n * b.d - b.n * a.d, d: a.d * b.d };
    if (formula.operation === 'multiply') return { n: a.n * b.n, d: a.d * b.d };
    ensure(b.n !== 0n, 'FIXTURE_DIVISION_ZERO');
    return { n: a.n * b.d, d: a.d * b.n };
  };
  const evaluateClaim = (id: string): Rational => {
    ensure(!evaluating.has(id), 'FIXTURE_FORMULA_CYCLE');
    const claim = indexed.get(id);
    ensure(claim, 'FIXTURE_UNKNOWN_CLAIM');
    evaluating.add(id);
    const result =
      claim.kind === 'ledger' ? rational(referenceLedgerValue(claim, ledger)) : evaluate(claim.formula);
    const expected = rational(claim.value);
    ensure(result.n * expected.d === expected.n * result.d, `FIXTURE_WRONG_REFERENCE:${item.id}:${id}`);
    evaluating.delete(id);
    return result;
  };
  for (const claim of claims) evaluateClaim(claim.id);
  return claims.length;
}

export type FixtureDatabaseOptions = {
  ownerUrl: string;
  runtimeUrl: string;
  confirmation: 'CREATE_ISOLATED_ADAPTIVE_FIXTURE';
};
/** No default URLs, .env lookup, production host, existing workspace or reset path. */
export function assertDisposableFixtureDatabase(options: FixtureDatabaseOptions) {
  ensure(options.confirmation === 'CREATE_ISOLATED_ADAPTIVE_FIXTURE', 'FIXTURE_CONFIRMATION_REQUIRED');
  const owner = new URL(options.ownerUrl),
    runtime = new URL(options.runtimeUrl);
  for (const url of [owner, runtime]) {
    ensure(['postgres:', 'postgresql:'].includes(url.protocol), 'FIXTURE_DATABASE_PROTOCOL');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const ciService = process.env.CI === 'true' && ['db', 'postgres'].includes(url.hostname);
    ensure(local || ciService, 'FIXTURE_DATABASE_HOST');
    ensure(/^\/daybook_adaptive_eval_[a-z0-9_]+$/.test(url.pathname), 'FIXTURE_DATABASE_NAME');
    ensure(url.search === '' && url.hash === '', 'FIXTURE_DATABASE_OPTIONS');
  }
  ensure(
    owner.hostname === runtime.hostname && owner.port === runtime.port && owner.pathname === runtime.pathname,
    'FIXTURE_DATABASE_MISMATCH',
  );
  ensure(owner.username !== runtime.username, 'FIXTURE_RUNTIME_MUST_DIFFER');
  return { databaseName: decodeURIComponent(owner.pathname.slice(1)) };
}
export type FixtureFingerprint = {
  sha256: string;
  organizations: number;
  accounts: number;
  entries: number;
  lines: number;
  scope: 'full_org_account_entry_line_rows';
};
export async function seedFixtures(options: FixtureDatabaseOptions) {
  const target = assertDisposableFixtureDatabase(options);
  const ledger = loadLedger(),
    counts = verifyLedger(ledger);
  // Reference verification is offline and cannot issue any provider request.
  const referenceChecks = [...loadCases('development'), ...loadCases('holdout')].reduce(
    (total, item) => total + verifyCaseReferences(item, ledger),
    0,
  );
  const owner = new pg.Client({ connectionString: options.ownerUrl });
  const runtime = new pg.Client({ connectionString: options.runtimeUrl });
  const orgId = randomUUID(),
    foreignOrgId = randomUUID();
  let ownerConnected = false,
    runtimeConnected = false,
    committed = false;
  try {
    await owner.connect();
    ownerConnected = true;
    await runtime.connect();
    runtimeConnected = true;
    const ownerIdentity = (
      await owner.query<{ name: string; role: string }>(
        'SELECT current_database() AS name,current_user AS role',
      )
    ).rows[0];
    const runtimeIdentity = (
      await runtime.query<{
        name: string;
        role: string;
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
      }>(
        'SELECT current_database() AS name,current_user AS role,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    ensure(
      ownerIdentity.name === target.databaseName &&
        runtimeIdentity.name === target.databaseName &&
        ownerIdentity.role !== runtimeIdentity.role,
      'FIXTURE_DATABASE_IDENTITY',
    );
    ensure(
      !runtimeIdentity.rolsuper && !runtimeIdentity.rolcreatedb && !runtimeIdentity.rolcreaterole,
      'FIXTURE_RUNTIME_PRIVILEGES',
    );
    await owner.query('BEGIN');
    await owner.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['daybook_adaptive_fixture_seed']);
    const existing = (
      await owner.query<{ count: string }>('SELECT count(*)::text AS count FROM organizations')
    ).rows[0];
    ensure(existing.count === '0', 'FIXTURE_DATABASE_NOT_EMPTY');
    const ids = new Map<string, string>(),
      entryIds = new Map<string, string>();
    for (const [tenant, organizationId] of [
      ['primary', orgId],
      ['foreign', foreignOrgId],
    ] as const) {
      await owner.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
        organizationId,
        `Isolated adaptive fixture ${tenant}`,
      ]);
      for (const account of ledger.accounts) {
        const id = randomUUID();
        ids.set(`${tenant}:${account.code}`, id);
        await owner.query(
          'INSERT INTO accounts(id,organization_id,code,name,type,currency,parent_id,is_group,is_cash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            id,
            organizationId,
            account.code,
            account.name,
            account.type,
            account.currency,
            account.parentCode ? ids.get(`${tenant}:${account.parentCode}`) : null,
            account.isGroup,
            account.isCash,
          ],
        );
      }
    }
    for (const entry of ledger.entries) {
      const id = randomUUID();
      entryIds.set(entry.id, id);
      const organizationId = entry.tenant === 'primary' ? orgId : foreignOrgId;
      await owner.query(
        'INSERT INTO journal_entries(id,organization_id,date,description,counterparty,reference,source,reverses_entry_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          id,
          organizationId,
          entry.date,
          entry.description,
          entry.counterparty,
          entry.reference,
          entry.reverses ? 'REVERSAL' : 'SEED',
          entry.reverses ? entryIds.get(entry.reverses) : null,
          `adaptive:${entry.id}`,
        ],
      );
      for (const [position, line] of entry.lines.entries()) {
        const account = ledger.accounts.find((item) => item.code === line.accountCode)!;
        await owner.query(
          'INSERT INTO journal_lines(organization_id,entry_id,account_id,position,currency,debit,credit,exchange_rate,memo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            organizationId,
            id,
            ids.get(`${entry.tenant}:${line.accountCode}`),
            position,
            account.currency,
            line.debit,
            line.credit,
            line.exchangeRate,
            'Synthetic fixture',
          ],
        );
      }
      if (entry.status === 'POSTED')
        await owner.query(
          "UPDATE journal_entries SET status='POSTED',posted_at='2026-10-31T00:00:00Z' WHERE id=$1",
          [id],
        );
    }
    // Run deferred posting/reversal constraints before archiving historical cash.
    await owner.query('SET CONSTRAINTS ALL IMMEDIATE');
    for (const account of ledger.accounts.filter((item) => item.archived))
      await owner.query(
        'UPDATE accounts SET archived=true WHERE organization_id=ANY($1::uuid[]) AND code=$2',
        [[orgId, foreignOrgId], account.code],
      );
    await owner.query('COMMIT');
    committed = true;
    const chart = (
      await runtime.query<AnalysisAccount>(
        'SELECT id,code,name,type,currency,parent_id,is_group,is_cash,archived FROM accounts WHERE organization_id=$1 ORDER BY code',
        [orgId],
      )
    ).rows;
    const stored = (
      await runtime.query<{
        organization_id: string;
        reference: string;
        date: string;
        description: string;
        counterparty: string;
        status: string;
        source: string;
        original_reference: string | null;
        position: number;
        code: string;
        currency: string;
        debit: string;
        credit: string;
        exchange_rate: string;
        base_debit: string;
        base_credit: string;
      }>(
        `SELECT e.organization_id,e.reference,e.date::text,e.description,e.counterparty,e.status,e.source,
      original.reference AS original_reference,l.position,a.code,l.currency,l.debit::text,l.credit::text,
      l.exchange_rate::text,l.base_debit::text,l.base_credit::text
      FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id AND l.organization_id=e.organization_id
      JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
      LEFT JOIN journal_entries original ON original.id=e.reverses_entry_id AND original.organization_id=e.organization_id
      WHERE e.organization_id=ANY($1::uuid[]) ORDER BY e.reference,l.position`,
        [[orgId, foreignOrgId]],
      )
    ).rows;
    ensure(stored.length === counts.lines, 'FIXTURE_STORED_LINES');
    for (const row of stored) {
      const expected = ledger.entries.find((item) => item.id === row.reference),
        line = expected?.lines[row.position];
      ensure(expected && line, 'FIXTURE_STORED_REFERENCE');
      ensure(
        row.organization_id === (expected.tenant === 'primary' ? orgId : foreignOrgId) &&
          row.date === expected.date &&
          row.description === expected.description &&
          row.counterparty === expected.counterparty &&
          row.status === expected.status &&
          row.original_reference === expected.reverses &&
          row.source === (expected.reverses ? 'REVERSAL' : 'SEED'),
        'FIXTURE_STORED_ENTRY',
      );
      ensure(
        row.code === line.accountCode &&
          row.currency === ledger.accounts.find((item) => item.code === line.accountCode)!.currency &&
          cents(row.debit) === cents(line.debit) &&
          cents(row.credit) === cents(line.credit) &&
          rational(row.exchange_rate).n * rational(line.exchangeRate).d ===
            rational(line.exchangeRate).n * rational(row.exchange_rate).d,
        'FIXTURE_STORED_LINE',
      );
      ensure(
        cents(row.base_debit) === savedBase(line.debit, line.exchangeRate) &&
          cents(row.base_credit) === savedBase(line.credit, line.exchangeRate),
        'FIXTURE_STORED_BASE',
      );
    }
    for (const expected of ledger.accounts) {
      const actual = chart.find((item) => item.code === expected.code);
      ensure(
        actual &&
          actual.name === expected.name &&
          actual.type === expected.type &&
          actual.currency === expected.currency &&
          actual.is_cash === expected.isCash &&
          actual.is_group === expected.isGroup &&
          actual.archived === expected.archived &&
          actual.parent_id === (expected.parentCode ? ids.get(`primary:${expected.parentCode}`) : null),
        'FIXTURE_STORED_CHART',
      );
    }
    const fingerprint = async (): Promise<FixtureFingerprint> => {
      await runtime.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const result = (
          await runtime.query<{
            value: { organizations: unknown[]; accounts: unknown[]; entries: unknown[]; lines: unknown[] };
          }>(
            `SELECT jsonb_build_object(
          'organizations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM organizations o WHERE id=ANY($1::uuid[])),
          'accounts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM accounts a WHERE organization_id=ANY($1::uuid[])),
          'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM journal_entries e WHERE organization_id=ANY($1::uuid[])),
          'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM journal_lines l WHERE organization_id=ANY($1::uuid[]))) AS value`,
            [[orgId, foreignOrgId]],
          )
        ).rows[0].value;
        await runtime.query('COMMIT');
        return {
          sha256: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
          organizations: result.organizations.length,
          accounts: result.accounts.length,
          entries: result.entries.length,
          lines: result.lines.length,
          scope: 'full_org_account_entry_line_rows',
        };
      } catch (error) {
        await runtime.query('ROLLBACK');
        throw error;
      }
    };
    const initialFingerprint = await fingerprint();
    ensure(
      initialFingerprint.organizations === 2 &&
        initialFingerprint.accounts === counts.accountsPerOrganization * 2 &&
        initialFingerprint.entries === counts.entries &&
        initialFingerprint.lines === counts.lines,
      'FIXTURE_STORED_COUNTS',
    );
    await owner.end();
    ownerConnected = false;
    return {
      orgId,
      foreignOrgId,
      chart,
      counterparties: counterparties(ledger),
      fixtureVersion,
      referenceChecks,
      storedLineChecks: stored.length,
      counts,
      initialFingerprint,
      fingerprint,
      close: async () => {
        if (runtimeConnected) {
          await runtime.end();
          runtimeConnected = false;
        }
      },
    };
  } catch (error) {
    if (ownerConnected) {
      if (!committed) await owner.query('ROLLBACK').catch(() => undefined);
      await owner.end();
    }
    if (runtimeConnected) await runtime.end();
    throw error;
  }
}
