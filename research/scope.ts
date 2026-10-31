import { Decimal } from '../shared/money';

type IdentityColumns = { accountCode?: string; accountName?: string; vendor?: string; entryId?: string };
type FixedIdentity = { accountCode?: string; accountName?: string; vendor?: string };
export type RowScope =
  | { provenance: 'compiled-scope-v1' | 'ast-scope-v1'; supported: false }
  | {
      provenance: 'compiled-scope-v1' | 'ast-scope-v1';
      supported: true;
      from: string | null;
      toExclusive: string | null;
      periodColumn?: { name: string; kind: 'month' | 'date' };
      identityColumns?: IdentityColumns;
      fixedIdentity?: FixedIdentity;
    };
export interface ScopedFact {
  key: string;
  value: string;
  unit: string;
  entity?: string | null;
  from?: string | null;
  to?: string | null;
  asOf?: string | null;
  /** Machine-owned metadata; never accepted from the answer model. */
  scopeSupported?: boolean;
  periodKind?: 'month' | 'date' | 'event' | 'range';
  entityAliases?: string[];
  /** Each projected grouping dimension must be identified; fixed filters are not extra groups. */
  identityGrain?: string[][];
}
const iso = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value: string): boolean {
  if (!iso.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function nextDay(value: string): string {
  if (!validDate(value)) throw new Error('RESEARCH_INVALID_SCOPE_DATE');
  return new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}
const previousDay = (value: string) =>
  new Date(Date.parse(`${value}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const normalized = (value: string) => value.trim().toLocaleLowerCase('en-US');

/** Specialize a verified query scope using only returned, explicitly projected fields. */
export function rowQualifiers(
  scope: RowScope | undefined,
  row: Record<string, unknown>,
  chart: { code: string; name: string }[],
): Partial<ScopedFact> {
  if (!scope?.supported) return { scopeSupported: false };
  let from = scope.from,
    end = scope.toExclusive;
  if (
    from === undefined ||
    end === undefined ||
    (from !== null && !validDate(from)) ||
    (end !== null && !validDate(end)) ||
    (from !== null && end !== null && from >= end)
  )
    return { scopeSupported: false };
  const kind = scope.periodColumn?.kind ?? 'range';
  if (scope.periodColumn) {
    const raw = row[scope.periodColumn.name];
    if (typeof raw !== 'string') return { scopeSupported: false };
    // PostgreSQL date_trunc may return midnight text; only its date component is used.
    if (
      !(kind === 'month' && /^\d{4}-\d{2}$/.test(raw)) &&
      !/^\d{4}-\d{2}-\d{2}(?:[ T]00:00:00(?:\.0+)?(?:Z|[+-]00(?::?00)?)?)?$/.test(raw)
    )
      return { scopeSupported: false };
    const date = kind === 'month' && /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw.slice(0, 10);
    if (!validDate(date)) return { scopeSupported: false };
    if (kind === 'month' && date.slice(8) !== '01') return { scopeSupported: false };
    const rowEnd =
      kind === 'month'
        ? new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1)).toISOString().slice(0, 10)
        : nextDay(date);
    from = from === null || date > from ? date : from;
    end = end === null || rowEnd < end ? rowEnd : end;
    if (from >= end) return { scopeSupported: false };
  }
  const identities: FixedIdentity & { entryId?: string } = { ...scope.fixedIdentity };
  for (const [identity, column] of Object.entries(scope.identityColumns ?? {})) {
    if (typeof row[column] !== 'string') return { scopeSupported: false };
    const value = String(row[column]);
    const previous = identities[identity as keyof typeof identities];
    if (previous !== undefined && normalized(previous) !== normalized(value))
      return { scopeSupported: false };
    identities[identity as keyof typeof identities] = value;
  }
  if (identities.accountCode) {
    const account = chart.find((item) => item.code === identities.accountCode);
    if (
      !account ||
      (identities.accountName && normalized(identities.accountName) !== normalized(account.name))
    )
      return { scopeSupported: false };
    identities.accountName = account.name;
  }
  const aliases = [...new Set(Object.values(identities).filter((value): value is string => Boolean(value)))];
  const grain: string[][] = [];
  if (scope.identityColumns?.entryId && identities.entryId) grain.push([identities.entryId]);
  else {
    if (
      (scope.identityColumns?.accountCode || scope.identityColumns?.accountName) &&
      !scope.fixedIdentity?.accountCode &&
      !scope.fixedIdentity?.accountName
    )
      grain.push(
        [identities.accountCode, identities.accountName].filter((value): value is string => Boolean(value)),
      );
    if (scope.identityColumns?.vendor && !scope.fixedIdentity?.vendor && identities.vendor)
      grain.push([identities.vendor]);
  }
  return {
    scopeSupported: true,
    periodKind: kind === 'date' && identities.entryId ? 'event' : kind,
    ...(from ? { from } : {}),
    ...(end ? { to: previousDay(end) } : {}),
    ...(((kind === 'date' && identities.entryId) || (kind === 'range' && from === null)) && end
      ? { asOf: previousDay(end) }
      : {}),
    ...(aliases.length
      ? {
          entity: identities.accountName ?? identities.vendor ?? identities.entryId ?? aliases[0],
          entityAliases: aliases,
        }
      : {}),
    ...(grain.length ? { identityGrain: grain } : {}),
  };
}
function sameAmount(fact: ScopedFact, source: ScopedFact): boolean {
  if (source.scopeSupported === false || fact.unit !== source.unit) return false;
  if (!/^-?\d+(?:\.\d+)?$/.test(fact.value) || !/^-?\d+(?:\.\d+)?$/.test(source.value)) return false;
  return new Decimal(fact.value)
    .minus(source.value)
    .abs()
    .lte(['percent', 'months'].includes(fact.unit) ? '0.01' : '0');
}
function sameIdentity(fact: ScopedFact, source: ScopedFact): boolean {
  if (
    source.identityGrain?.length &&
    (!fact.entity ||
      !source.identityGrain.every((aliases) =>
        aliases.some((value) => normalized(value) === normalized(fact.entity!)),
      ))
  )
    return false;
  if (!fact.entity) return true;
  return [source.entity, ...(source.entityAliases ?? [])].some(
    (value) => value && normalized(value) === normalized(fact.entity!),
  );
}
function exactPeriod(fact: ScopedFact, source: ScopedFact): boolean {
  if (fact.asOf && source.periodKind === 'event' && fact.key !== 'entry_total') return false;
  return (['from', 'to', 'asOf'] as const).every(
    (dimension) => !fact[dimension] || fact[dimension] === source[dimension],
  );
}
/** Value equality alone cannot establish the date or entity of a ledger claim. */
export function ledgerFactBound(fact: ScopedFact, sourceFacts: ScopedFact[]): boolean {
  const matching = sourceFacts.filter((source) => sameAmount(fact, source) && sameIdentity(fact, source));
  if (matching.some((source) => exactPeriod(fact, source))) return true;
  // A monthly-rate claim may summarize equal monthly observations. This never turns
  // one month's amount into a multi-month total (e.g. "expenses").
  if (
    !/(?:^|_)monthly(?:_|$)/.test(fact.key) ||
    !fact.from ||
    !fact.to ||
    fact.asOf ||
    !validDate(fact.from) ||
    !validDate(fact.to) ||
    fact.from > fact.to
  )
    return false;
  const months = matching
    .filter(
      (source) => source.periodKind === 'month' && source.scopeSupported === true && source.from && source.to,
    )
    .sort((a, b) => a.from!.localeCompare(b.from!));
  if (new Set(months.map((source) => `${source.from}:${source.to}`)).size !== months.length) return false;
  const end = nextDay(fact.to);
  let cursor = fact.from;
  for (const source of months) {
    if (source.to! < cursor) continue;
    if (source.from! !== cursor || source.to! >= end) return false;
    cursor = nextDay(source.to!);
    if (cursor === end) return true;
  }
  return false;
}

/** Calculations may compare whole source periods or their contiguous union. They
 * cannot manufacture a new date/entity merely by wrapping an amount in arithmetic.
 * This proves provenance of qualifiers, not the economic meaning of a formula.
 */
export function calculationScopeBound(fact: ScopedFact, ancestors: ScopedFact[]): boolean {
  const sources = [...new Map(ancestors.map((source) => [JSON.stringify(source), source])).values()];
  if (!sources.length || sources.some((source) => source.scopeSupported === false)) return false;
  if (sources.some((source) => !sameIdentity(fact, source))) return false;
  if (sources.some((source) => exactPeriod(fact, source))) return true;
  if (
    !fact.from ||
    !fact.to ||
    fact.asOf ||
    !validDate(fact.from) ||
    !validDate(fact.to) ||
    fact.from > fact.to
  )
    return false;
  const intervals = sources
    .filter((source) => source.from && source.to && source.from >= fact.from! && source.to <= fact.to!)
    .sort((a, b) => a.from!.localeCompare(b.from!));
  let cursor = fact.from;
  for (const source of intervals) {
    if (source.to! < cursor) continue;
    if (source.from! > cursor) return false;
    cursor = nextDay(source.to!);
    if (cursor === nextDay(fact.to)) return true;
  }
  return false;
}
