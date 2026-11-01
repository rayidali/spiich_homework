import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { z } from 'zod';
import type { AnalysisAccount } from '../../server/financial-analysis';
import type { CompletenessCase, Formula, LedgerClaim, LedgerReferenceResult } from './types';

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
  version: z.literal('completeness-fixture-v1'),
  asOf: z.literal('2026-09-30'),
  authorship: z.string(),
  accounts: z.array(accountSchema),
  entries: z.array(entrySchema),
});
export type FixtureLedger = z.infer<typeof ledgerSchema>;
export const fixtureVersion = 'completeness-fixture-v1';
export const fixtureFamilies = ['common', 'discovery', 'arithmetic', 'boundary'] as const;
export const fixtureFiles = [
  'scripts/completeness-evaluation/fixtures/ledger.json',
  'scripts/completeness-evaluation/fixtures/development.json',
  'scripts/completeness-evaluation/fixtures/worked-totals.json',
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
export function loadCases(split: CompletenessCase['split']): CompletenessCase[] {
  ensure(split === 'development' || split === 'holdout', 'FIXTURE_SPLIT_INVALID');
  const result = readJson(split) as CompletenessCase[];
  ensure(Array.isArray(result) && result.length === (split === 'development' ? 4 : 16), 'FIXTURE_CASE_COUNT');
  ensure(new Set(result.map((item) => item.id)).size === result.length, 'FIXTURE_DUPLICATE_CASE');
  for (const item of result) {
    ensure(
      item.split === split && fixtureFamilies.includes(item.family as (typeof fixtureFamilies)[number]),
      'FIXTURE_CASE_SPLIT',
    );
    ensure(
      item.messages.length >= 1 &&
        item.messages.length <= 100 &&
        item.messages[0].role === 'user' &&
        item.messages.at(-1)?.role === 'user' &&
        item.messages.every(
          (message) =>
            ['user', 'assistant'].includes(message.role) &&
            typeof message.content === 'string' &&
            message.content.length > 0,
        ),
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
export function fixtureMessages(item: CompletenessCase) {
  return structuredClone(item.messages);
}
export function counterparties(ledger = loadLedger()) {
  return [
    ...new Set(ledger.entries.filter((item) => item.tenant === 'primary').map((item) => item.counterparty)),
  ].sort();
}

// Independent BigInt arithmetic adapted from the earlier fixture plumbing, with fresh explicit data.
// No earlier fixture or scorer module is imported. Seed verification reads development only.
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
  ledger = ledgerSchema.parse(ledger);
  const accounts = new Map(ledger.accounts.map((item) => [item.code, item]));
  ensure(accounts.size === ledger.accounts.length, 'FIXTURE_DUPLICATE_ACCOUNT');
  const entries = new Map(ledger.entries.map((item) => [item.id, item]));
  ensure(entries.size === ledger.entries.length, 'FIXTURE_DUPLICATE_ENTRY');
  const earlierAccounts = new Set<string>();
  for (const account of ledger.accounts) {
    ensure(!account.parentCode || accounts.get(account.parentCode)?.isGroup, 'FIXTURE_ACCOUNT_PARENT');
    ensure(!account.parentCode || earlierAccounts.has(account.parentCode), 'FIXTURE_ACCOUNT_PARENT_ORDER');
    ensure(!account.isCash || (account.type === 'ASSET' && !account.isGroup), 'FIXTURE_CASH_ACCOUNT');
    earlierAccounts.add(account.code);
  }
  for (const entry of ledger.entries) {
    ensure(entry.date <= ledger.asOf, 'FIXTURE_FUTURE_ENTRY');
    ensure(entry.reference === entry.id, 'FIXTURE_REFERENCE_IDENTITY');
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
      ensure(original.date <= entry.date, 'FIXTURE_REVERSAL_DATE');
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
/** Independent scalar oracle. Accounts are effective posting codes, never inferred
 * from names. Entry IDs may be explicitly mapped by the isolated seeder. */
export function referenceLedgerValue(
  claim: LedgerClaim,
  ledger: FixtureLedger,
  entryAliases: Readonly<Record<string, string>> = {},
): string {
  const { scope } = claim;
  const average = claim.metric.endsWith('_average_per_entry');
  const metric = claim.metric.replace(/_average_per_entry$/, '');
  ensure(
    [
      'net_expense',
      'net_revenue',
      'net_profit',
      'cash_balance',
      'account_balance',
      'net_cash_movement',
      'journal_total',
      'journal_count',
    ].includes(metric),
    'FIXTURE_ORACLE_METRIC',
  );
  const stock = metric === 'cash_balance' || metric === 'account_balance';
  const fullJournal = metric === 'journal_total' || metric === 'journal_count';
  ensure(['POSTED', 'DRAFT'].includes(scope.status), 'FIXTURE_ORACLE_STATUS');
  const endDate = stock ? scope.asOf : scope.to;
  ensure(endDate !== null && z.iso.date().safeParse(endDate).success, 'FIXTURE_ORACLE_PERIOD');
  ensure(
    stock
      ? scope.from === null && (scope.to === null || scope.asOf === scope.to)
      : scope.from &&
          z.iso.date().safeParse(scope.from).success &&
          scope.from <= endDate &&
          scope.asOf === null,
    'FIXTURE_ORACLE_PERIOD',
  );
  ensure(
    ['base', 'native'].includes(scope.currencyMode) &&
      (scope.currencyMode === 'base'
        ? scope.currency === null || scope.currency === 'USD'
        : ['USD', 'EUR'].includes(scope.currency ?? '')),
    'FIXTURE_ORACLE_CURRENCY',
  );
  ensure(
    !(fullJournal && scope.currencyMode === 'native') && !(average && (stock || metric === 'journal_count')),
    'FIXTURE_ORACLE_UNSUPPORTED_AGGREGATION',
  );
  ensure(
    ['any', 'identity', 'exact', 'contains'].includes(scope.counterparty.mode),
    'FIXTURE_ORACLE_COUNTERPARTY',
  );
  const accounts = new Map(ledger.accounts.map((item) => [item.code, item]));
  const effective = (codes: string[]) => {
    ensure(new Set(codes).size === codes.length, 'FIXTURE_ORACLE_DUPLICATE_ACCOUNT');
    return codes.map((code) => {
      const account = accounts.get(code);
      ensure(account && !account.isGroup, 'FIXTURE_ORACLE_ACCOUNT');
      return account;
    });
  };
  const selected = effective(scope.accountCodes);
  ensure(selected.length > 0, 'FIXTURE_ORACLE_EMPTY_ACCOUNT_SCOPE');
  const thresholdCodes = scope.amountThresholdAccountCodes ?? scope.accountCodes;
  effective(thresholdCodes);
  effective(scope.cooccurringAccountCodes);
  for (const account of [...selected, ...effective(thresholdCodes)]) {
    ensure(scope.currencyMode !== 'native' || account.currency === scope.currency, 'FIXTURE_ORACLE_CURRENCY');
    ensure(metric !== 'net_expense' || account.type === 'EXPENSE', 'FIXTURE_ORACLE_TYPE');
    ensure(metric !== 'net_revenue' || account.type === 'REVENUE', 'FIXTURE_ORACLE_TYPE');
    ensure(metric !== 'net_profit' || ['REVENUE', 'EXPENSE'].includes(account.type), 'FIXTURE_ORACLE_TYPE');
    ensure(
      !['cash_balance', 'net_cash_movement'].includes(metric) || (account.type === 'ASSET' && account.isCash),
      'FIXTURE_ORACLE_CASH',
    );
  }
  if (stock)
    ensure(
      scope.status === 'POSTED' &&
        scope.counterparty.mode === 'any' &&
        !scope.descriptionSearch &&
        !scope.searchText &&
        !scope.cooccurringAccountCodes.length &&
        scope.minimumAmount === null &&
        scope.maximumAmount === null,
      'FIXTURE_ORACLE_STOCK_FILTER',
    );
  if (metric === 'net_cash_movement') ensure(scope.status === 'POSTED', 'FIXTURE_ORACLE_CASH_STATUS');
  const requestedEntry =
    scope.entryId === undefined ? undefined : (entryAliases[scope.entryId] ?? scope.entryId);
  if (requestedEntry !== undefined)
    ensure(
      ledger.entries.some((entry) => entry.id === requestedEntry && entry.tenant === 'primary'),
      'FIXTURE_ORACLE_ENTRY',
    );
  const monetary = (line: FixtureLedger['entries'][number]['lines'][number], normalMetric = metric) => {
    const account = accounts.get(line.accountCode)!;
    const debit =
      scope.currencyMode === 'native' ? cents(line.debit) : savedBase(line.debit, line.exchangeRate);
    const credit =
      scope.currencyMode === 'native' ? cents(line.credit) : savedBase(line.credit, line.exchangeRate);
    if (normalMetric === 'journal_total' || normalMetric === 'journal_count') return debit;
    const creditNormal =
      normalMetric === 'net_revenue' ||
      normalMetric === 'net_profit' ||
      (normalMetric === 'account_balance' && ['LIABILITY', 'EQUITY', 'REVENUE'].includes(account.type));
    return creditNormal ? credit - debit : debit - credit;
  };
  let total = 0n,
    count = 0n;
  for (const entry of ledger.entries) {
    if (
      entry.tenant !== 'primary' ||
      entry.status !== scope.status ||
      entry.date > endDate ||
      (scope.from && entry.date < scope.from) ||
      (requestedEntry !== undefined && entry.id !== requestedEntry)
    )
      continue;
    const filter = scope.counterparty;
    if (filter.mode === 'identity' && entry.counterparty !== filter.value) continue;
    if (filter.mode === 'exact' && entry.counterparty.toLowerCase() !== filter.value.toLowerCase()) continue;
    if (filter.mode === 'contains' && !entry.counterparty.toLowerCase().includes(filter.value.toLowerCase()))
      continue;
    if (
      scope.descriptionSearch &&
      !entry.description.toLowerCase().includes(scope.descriptionSearch.toLowerCase())
    )
      continue;
    if (
      scope.searchText &&
      ![entry.description, entry.counterparty, entry.reference].some((text) =>
        text.toLowerCase().includes(scope.searchText!.toLowerCase()),
      )
    )
      continue;
    if (
      scope.cooccurringAccountCodes.length &&
      !entry.lines.some((line) => scope.cooccurringAccountCodes.includes(line.accountCode))
    )
      continue;
    const selectedLines = entry.lines.filter((line) => scope.accountCodes.includes(line.accountCode));
    if (!selectedLines.length) continue;
    const thresholdLines = fullJournal
      ? entry.lines
      : entry.lines.filter((line) => thresholdCodes.includes(line.accountCode));
    const basis = thresholdLines.reduce((sum, line) => sum + monetary(line), 0n);
    if (
      (scope.minimumAmount !== null && basis < cents(scope.minimumAmount)) ||
      (scope.maximumAmount !== null && basis > cents(scope.maximumAmount))
    )
      continue;
    count += 1n;
    total += (fullJournal ? entry.lines : selectedLines).reduce((sum, line) => sum + monetary(line), 0n);
  }
  if (scope.averageDenominator !== undefined)
    ensure(scope.averageDenominator === count.toString(), 'FIXTURE_ORACLE_AVERAGE_DENOMINATOR');
  if (metric === 'journal_count') return count.toString();
  if (!average) return decimal(total);
  ensure(count > 0n, 'FIXTURE_ORACLE_NULL_AVERAGE');
  const magnitude = total < 0n ? -total : total;
  return decimal(((magnitude * 2n + count) / (count * 2n)) * (total < 0n ? -1n : 1n));
}

export function referenceLedgerClaim(
  claim: LedgerClaim,
  ledger: FixtureLedger,
  entryAliases: Readonly<Record<string, string>> = {},
): LedgerReferenceResult {
  try {
    const value = referenceLedgerValue(claim, ledger, entryAliases);
    const expectedUnit =
      claim.metric === 'journal_count'
        ? 'count'
        : claim.scope.currencyMode === 'native'
          ? claim.scope.currency
          : 'USD';
    const actual = rational(claim.value),
      expected = rational(value);
    const entry = claim.scope.entryId
      ? ledger.entries.find(
          (item) =>
            item.tenant === 'primary' &&
            item.id === (entryAliases[claim.scope.entryId!] ?? claim.scope.entryId),
        )
      : undefined;
    return claim.unit === expectedUnit && actual.n * expected.d === expected.n * actual.d
      ? {
          status: 'verified',
          value,
          ...(entry ? { entry: { date: entry.date, description: entry.description } } : {}),
        }
      : { status: 'incorrect', value, reason: 'VALUE_OR_UNIT_MISMATCH' };
  } catch (error) {
    return {
      status: 'unsupported',
      reason:
        error instanceof Error && /^FIXTURE_[A-Z_]+$/.test(error.message)
          ? error.message
          : 'FIXTURE_ORACLE_UNSUPPORTED',
    };
  }
}
function roundedRational(value: Rational, digits: number): Rational {
  ensure(value.d !== 0n, 'FIXTURE_DIVISION_ZERO');
  const numerator = value.d < 0n ? -value.n : value.n,
    denominator = value.d < 0n ? -value.d : value.d;
  const scale = 10n ** BigInt(digits),
    magnitude = numerator < 0n ? -numerator : numerator;
  const rounded = (magnitude * scale * 2n + denominator) / (2n * denominator);
  return { n: rounded * (numerator < 0n ? -1n : 1n), d: scale };
}
function resultUnit(operation: string, left: string, right: string) {
  if (['add', 'subtract'].includes(operation) && left === right) return left;
  if (operation === 'multiply') {
    if (left === 'ratio') return right;
    if (right === 'ratio') return left;
    if ((left === 'USD_per_month' && right === 'months') || (right === 'USD_per_month' && left === 'months'))
      return 'USD';
    if (left === 'count' && ['USD', 'USD_per_month', 'months'].includes(right)) return right;
    if (right === 'count' && ['USD', 'USD_per_month', 'months'].includes(left)) return left;
  }
  if (operation === 'divide') {
    if (left === right) return 'ratio';
    if (right === 'ratio') return left;
    if (left === 'USD' && right === 'months') return 'USD_per_month';
    if (left === 'USD' && right === 'USD_per_month') return 'months';
  }
  throw new Error('FIXTURE_FORMULA_UNIT');
}
export function verifyCaseReferences(item: CompletenessCase, ledger = loadLedger()) {
  const claims = [...item.expected.required, ...item.expected.supporting];
  const indexed = new Map(claims.map((claim) => [claim.id, claim]));
  ensure(indexed.size === claims.length, 'FIXTURE_DUPLICATE_CLAIM');
  const evaluating = new Set<string>();
  type Quantity = Rational & { unit: string };
  const evaluate = (formula: Formula): Quantity => {
    if ('claim' in formula) return evaluateClaim(formula.claim);
    if ('assumption' in formula) {
      const assumption = formula.assumption;
      const occurrences = item.messages
        .filter((message) => message.role === 'user')
        .reduce((sum, message) => sum + message.content.split(assumption.sourceText).length - 1, 0);
      ensure(assumption.sourceText.length > 0 && occurrences === 1, 'FIXTURE_ASSUMPTION_QUOTE');
      const numbers = assumption.sourceText.match(/[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g);
      ensure(numbers?.length === 1, 'FIXTURE_ASSUMPTION_QUANTITY');
      const quoted = rational(numbers[0].replaceAll(',', ''));
      const percentage = /%|\bpercent\b/i.test(assumption.sourceText);
      const units =
        assumption.unit === 'ratio'
          ? percentage
          : assumption.unit === 'months'
            ? /\bmonths?\b/i.test(assumption.sourceText)
            : assumption.unit === 'count'
              ? /\b(?:employees?|workers?|mechanics?|people|units?)\b/i.test(assumption.sourceText)
              : /^USD(?:_per_month)?$/.test(assumption.unit) &&
                /\$|\bUSD\b/i.test(assumption.sourceText) &&
                (assumption.unit !== 'USD_per_month' || /\bmonths?\b|monthly/i.test(assumption.sourceText));
      ensure(units, 'FIXTURE_ASSUMPTION_UNIT');
      const value = rational(assumption.value),
        denominator = quoted.d * (percentage ? 100n : 1n);
      ensure(quoted.n * value.d === value.n * denominator, 'FIXTURE_ASSUMPTION_VALUE');
      return { ...value, unit: assumption.unit };
    }
    if ('calendarMonths' in formula) {
      const { scope, value } = formula.calendarMonths;
      ensure(
        scope.from !== null && scope.to !== null && scope.from.endsWith('-01'),
        'FIXTURE_MONTH_BOUNDARY',
      );
      const next = new Date(new Date(`${scope.to}T00:00:00Z`).getTime() + 86400000);
      ensure(next.getUTCDate() === 1 && scope.from <= scope.to, 'FIXTURE_MONTH_BOUNDARY');
      const count =
        (Number(scope.to.slice(0, 4)) - Number(scope.from.slice(0, 4))) * 12 +
        Number(scope.to.slice(5, 7)) -
        Number(scope.from.slice(5, 7)) +
        1;
      ensure(count >= 1 && count <= 120 && value === String(count), 'FIXTURE_MONTH_COUNT');
      return { n: BigInt(count), d: 1n, unit: 'months' };
    }
    const a = evaluate(formula.operands[0]),
      b = evaluate(formula.operands[1]);
    const unit = resultUnit(formula.operation, a.unit, b.unit);
    if (formula.operation === 'add') return { n: a.n * b.d + b.n * a.d, d: a.d * b.d, unit };
    if (formula.operation === 'subtract') return { n: a.n * b.d - b.n * a.d, d: a.d * b.d, unit };
    if (formula.operation === 'multiply') return { n: a.n * b.n, d: a.d * b.d, unit };
    ensure(b.n !== 0n, 'FIXTURE_DIVISION_ZERO');
    return { n: a.n * b.d, d: a.d * b.n, unit };
  };
  const evaluateClaim = (id: string): Quantity => {
    ensure(!evaluating.has(id), 'FIXTURE_FORMULA_CYCLE');
    const claim = indexed.get(id);
    ensure(claim, 'FIXTURE_UNKNOWN_CLAIM');
    evaluating.add(id);
    const result =
      claim.kind === 'ledger'
        ? {
            ...rational(referenceLedgerValue(claim, ledger)),
            unit:
              claim.metric === 'journal_count'
                ? 'count'
                : claim.scope.currencyMode === 'native'
                  ? claim.scope.currency!
                  : 'USD',
          }
        : evaluate(claim.formula);
    ensure(claim.unit === result.unit, 'FIXTURE_WRONG_UNIT');
    const expected = rational(claim.value);
    const presented =
      claim.kind === 'ledger'
        ? result
        : roundedRational(result, ['USD', 'USD_per_month'].includes(result.unit) ? 2 : 6);
    ensure(presented.n * expected.d === expected.n * presented.d, `FIXTURE_WRONG_REFERENCE:${item.id}:${id}`);
    if (claim.kind === 'calculation' && claim.exact) {
      ensure(
        /^[-]?\d+$/.test(claim.exact.numerator) &&
          /^\d+$/.test(claim.exact.denominator) &&
          BigInt(claim.exact.denominator) > 0n,
        'FIXTURE_EXACT_FRACTION',
      );
      ensure(
        result.n * BigInt(claim.exact.denominator) === BigInt(claim.exact.numerator) * result.d,
        'FIXTURE_EXACT_FRACTION',
      );
    }
    evaluating.delete(id);
    return result;
  };
  for (const claim of claims) evaluateClaim(claim.id);
  for (const table of item.expected.tables ?? []) {
    ensure(
      table.claimIds.length > 0 && new Set(table.claimIds).size === table.claimIds.length,
      'FIXTURE_TABLE_CLAIMS',
    );
    for (const id of [...table.claimIds, ...(table.alternativeClaimIds ?? []).flat()])
      ensure(indexed.get(id)?.kind === 'ledger', 'FIXTURE_TABLE_CLAIMS');
  }
  for (const id of item.expected.primaryClaimIds ?? []) ensure(indexed.has(id), 'FIXTURE_PRIMARY_CLAIM');
  return claims.length;
}

export function verifyWorkedTotals(ledger = loadLedger()) {
  const data = readJson('worked-totals') as {
    version: string;
    checks: { name: string; explanation: string; claim: LedgerClaim }[];
  };
  ensure(
    data.version === 'completeness-worked-totals-v1' && Array.isArray(data.checks),
    'FIXTURE_WORKED_FORMAT',
  );
  ensure(
    new Set(data.checks.map((item) => item.name)).size === data.checks.length,
    'FIXTURE_WORKED_DUPLICATE',
  );
  for (const item of data.checks) {
    ensure(item.explanation.length > 0 && item.claim.kind === 'ledger', 'FIXTURE_WORKED_FORMAT');
    const result = referenceLedgerClaim(item.claim, ledger);
    ensure(result.status === 'verified', `FIXTURE_WORKED_MISMATCH:${item.name}`);
  }
  return data.checks.length;
}

export type FixtureDatabaseOptions = {
  ownerUrl: string;
  runtimeUrl: string;
  confirmation: 'CREATE_ISOLATED_COMPLETENESS_FIXTURE';
};
/** No default URLs, .env lookup, production host, existing workspace or reset path. */
export function assertDisposableFixtureDatabase(options: FixtureDatabaseOptions) {
  ensure(options.confirmation === 'CREATE_ISOLATED_COMPLETENESS_FIXTURE', 'FIXTURE_CONFIRMATION_REQUIRED');
  const owner = new URL(options.ownerUrl),
    runtime = new URL(options.runtimeUrl);
  for (const url of [owner, runtime]) {
    ensure(['postgres:', 'postgresql:'].includes(url.protocol), 'FIXTURE_DATABASE_PROTOCOL');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const ciService = process.env.CI === 'true' && ['db', 'postgres'].includes(url.hostname);
    ensure(local || ciService, 'FIXTURE_DATABASE_HOST');
    ensure(/^\/daybook_completeness_eval_[a-z0-9_]+$/.test(url.pathname), 'FIXTURE_DATABASE_NAME');
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
  const referenceChecks = loadCases('development').reduce(
    (total, item) => total + verifyCaseReferences(item, ledger),
    0,
  );
  const workedChecks = verifyWorkedTotals(ledger);
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
    await owner.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['daybook_completeness_fixture_seed']);
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
        `Isolated completeness fixture ${tenant}`,
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
          `completeness:${entry.id}`,
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
          "UPDATE journal_entries SET status='POSTED',posted_at='2026-09-30T00:00:00Z' WHERE id=$1",
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
      entryAliases: Object.fromEntries(
        [...entryIds].map(([fixtureId, databaseId]) => [databaseId, fixtureId]),
      ),
      referenceLedgerClaim: (claim: LedgerClaim) =>
        referenceLedgerClaim(
          claim,
          ledger,
          Object.fromEntries([...entryIds].map(([fixtureId, databaseId]) => [databaseId, fixtureId])),
        ),
      referenceChecks,
      workedChecks,
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
