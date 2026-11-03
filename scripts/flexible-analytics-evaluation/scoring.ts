import type { AnalysisFacts, FinancialQuery } from '../../server/financial-analysis';
import { entries } from './fixture';
import type { Case, ExpectedRow } from './specification';
import { sha256 } from './protocol';
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const fraction = (value: string) => {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw Error('DECIMAL');
  const [a, b = ''] = value.split('.');
  return { n: BigInt(a + b), d: 10n ** BigInt(b.length) };
};
const equal = (a: { n: bigint; d: bigint }, b: { n: bigint; d: bigint }) => a.n * b.d === b.n * a.d;
function keyFromRow(
  fact: AnalysisFacts,
  row: AnalysisFacts['rows'][number],
  dimension: string,
): string | null {
  const compound = row.dimensions?.find((d) => d.kind === dimension);
  if (compound) return compound.key;
  return fact.grain === dimension && row.rowId.startsWith(`${dimension}:`)
    ? row.rowId.slice(dimension.length + 1)
    : null;
}
/** Independent integer-cent replay of source rows. No product compiler/calculator is used. */
export function replaySource(fact: AnalysisFacts, row: AnalysisFacts['rows'][number]): string | null {
  const p: FinancialQuery = fact.scope.plan;
  if (
    !['net_expense', 'net_revenue', 'net_profit'].includes(p.metric) ||
    p.aggregation !== 'sum' ||
    p.currencyMode !== 'base' ||
    p.currency !== null ||
    p.cooccurringAccountCodes.length ||
    p.descriptionSearch ||
    p.minimumAmount !== null ||
    p.maximumAmount !== null
  )
    return null;
  const account = keyFromRow(fact, row, 'account'),
    counterparty = keyFromRow(fact, row, 'counterparty');
  let cents = 0n;
  for (const e of entries) {
    if (
      e.workspace !== 'primary' ||
      e.status !== p.status ||
      e.date < (row.from ?? p.from ?? '0000-01-01') ||
      e.date > (row.to ?? p.to) ||
      (p.accountCodes.length && !p.accountCodes.includes(e.account)) ||
      (account !== null && e.account !== account) ||
      (counterparty !== null && e.counterparty !== counterparty)
    )
      continue;
    if (p.counterparty.mode === 'exact' || p.counterparty.mode === 'identity') {
      if (e.counterparty !== p.counterparty.value) continue;
    } else if (p.counterparty.mode === 'contains') {
      if (!e.counterparty.toLowerCase().includes(p.counterparty.value.toLowerCase())) continue;
    }
    if (p.metric === 'net_expense' && e.kind === 'expense') cents += BigInt(e.amountCents);
    if (p.metric === 'net_revenue' && e.kind === 'revenue') cents += BigInt(e.amountCents);
    if (p.metric === 'net_profit' && (e.kind === 'expense' || e.kind === 'revenue'))
      cents += BigInt(e.amountCents) * (e.kind === 'expense' ? -1n : 1n);
  }
  const sign = cents < 0n ? '-' : '';
  const digits = (cents < 0n ? -cents : cents).toString().padStart(3, '0');
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
const monthNames = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
function matchesLabel(expected: string, label: string) {
  const text = label.toLowerCase();
  if (/^\d{4}-\d{2}$/.test(expected)) {
    const n = Number(expected.slice(-2));
    return text.includes(expected) || new RegExp(`\\b${monthNames[n - 1]}\\b`, 'i').test(text);
  }
  if (/^\d{4}-Q[1-4]$/.test(expected))
    return text.includes(expected.toLowerCase()) || new RegExp(`\\bq${expected.at(-1)}\\b`, 'i').test(text);
  if (expected === 'mean') return /mean|average/.test(text);
  if (expected === 'change') return /change|growth|increase/.test(text);
  if (expected === 'months') return /month|count/.test(text);
  if (expected === 'expenses') return /expense|spending/.test(text);
  return text.includes(expected);
}
const amountText = (value: string) => value.replace(/[$,%\s]/g, '').replace(/−/g, '-');
type Candidate = {
  label: string;
  display: string;
  unit: string;
  exact: { n: bigint; d: bigint } | null;
  unavailable: boolean;
  index: number;
  derived: boolean;
};
function candidateMatches(expected: ExpectedRow, c: Candidate) {
  if (c.unit !== expected.unit || !matchesLabel(expected.label, c.label)) return false;
  if (expected.value === null) return c.unavailable && c.exact === null;
  if (c.unavailable || !c.exact) return false;
  const target =
    expected.numerator !== undefined
      ? { n: BigInt(expected.numerator), d: BigInt(expected.denominator!) }
      : fraction(expected.value);
  if (!equal(c.exact, target)) return false;
  const displayed = amountText(c.display);
  if (!/^-?\d+(?:\.\d+)?$/.test(displayed)) return false;
  return (
    equal(fraction(displayed), fraction(expected.value)) &&
    (expected.unit !== 'ratio' || c.display.includes('%'))
  );
}
/** Never returns overall pass: arithmetic and independent semantic review are separate. */
export function assess(item: Case, turn: number, response: unknown, org: string) {
  const failures: string[] = [],
    unassessed: string[] = [];
  let sourceChecks = 0;
  const candidates: Candidate[] = [];
  if (!object(response) || typeof response.answer !== 'string')
    return {
      numericStatus: 'failed',
      failures: ['MISSING_RESPONSE'],
      semanticReview: 'pending',
      overallPass: false,
    };
  const required = item.oracleRows[turn];
  if (!required.length)
    return {
      numericStatus: 'not_applicable',
      semanticReview: 'pending',
      reviewRequirement:
        'Review the actual clarification: unresolved year/basis only, no broad repeated menu or invented denominator.',
      overallPass: false,
    };
  const facts = Array.isArray(response.facts) ? (response.facts as AnalysisFacts[]) : [];
  if (!facts.length) unassessed.push('NON_ANALYSIS_RESPONSE_REQUIRES_INDEPENDENT_REVIEW');
  const factRows = new Map<string, { fact: AnalysisFacts; row: AnalysisFacts['rows'][number] }>();
  for (const fact of facts) {
    if (!fact?.scope?.plan || !Array.isArray(fact.rows)) {
      failures.push('MALFORMED_FACT');
      continue;
    }
    if (
      fact.scope.organizationId !== org ||
      fact.scope.plan.status !== 'POSTED' ||
      fact.unit !== 'USD' ||
      fact.truncated ||
      !fact.scope.plan.from ||
      fact.scope.plan.from < item.from ||
      fact.scope.plan.to > item.to
    )
      failures.push('SOURCE_SCOPE_MISMATCH');
    for (const row of fact.rows) {
      const key = `${fact.queryId}/${row.rowId}`;
      if (factRows.has(key)) failures.push('DUPLICATE_SOURCE_ID');
      factRows.set(key, { fact, row });
      const replayed = replaySource(fact, row);
      if (replayed === null) unassessed.push('SOURCE_PLAN_REQUIRES_REVIEW');
      else if (row.value === null || !equal(fraction(replayed), fraction(row.value)))
        failures.push('SOURCE_VALUE_MISMATCH');
      else sourceChecks++;
      if (row.from === null || row.to === null || row.from < item.from || row.to > item.to)
        failures.push('SOURCE_ROW_PERIOD_MISMATCH');
    }
  }
  const program = object(response.program) ? response.program : null;
  const evidence = Array.isArray(response.evidence) ? response.evidence : [];
  if (
    program &&
    (typeof program.code !== 'string' ||
      sha256(program.code) !== program.codeHash ||
      !Array.isArray(program.tables))
  )
    failures.push('PROGRAM_BINDING_MISMATCH');
  let index = 0;
  for (const card of evidence) {
    if (!object(card) || !Array.isArray(card.rows)) continue;
    for (const cell of card.rows) {
      index++;
      if (
        !object(cell) ||
        typeof cell.label !== 'string' ||
        typeof cell.value !== 'string' ||
        !object(cell.factRef)
      )
        continue;
      const ref = cell.factRef;
      if (ref.kind === 'program_result' && program && Array.isArray(program.tables)) {
        const table = program.tables[Number(ref.tableIndex)];
        const row = object(table) && Array.isArray(table.rows) ? table.rows[Number(ref.rowIndex)] : null;
        if (
          !object(row) ||
          ref.programHash !== program.codeHash ||
          row.label !== cell.label ||
          row.value !== cell.value ||
          row.source !== 'posted' ||
          !Array.isArray(row.references) ||
          !row.references.length
        ) {
          failures.push('VISIBLE_PROGRAM_BINDING_MISMATCH');
          continue;
        }
        for (const source of row.references)
          if (!object(source) || !factRows.has(`${source.queryId}/${source.rowId}`))
            failures.push('MISSING_SOURCE_REFERENCE');
        const exact =
          object(row.exact) &&
          typeof row.exact.numerator === 'string' &&
          typeof row.exact.denominator === 'string'
            ? { n: BigInt(row.exact.numerator), d: BigInt(row.exact.denominator) }
            : null;
        const unavailable =
          exact === null &&
          row.reason === 'zero_denominator' &&
          /zero|undefined|unavailable|not available/i.test(cell.value);
        candidates.push({
          label: `${String(card.title)} ${cell.label}`,
          display: cell.value,
          unit: String(row.unit),
          exact,
          unavailable,
          index,
          derived: true,
        });
      } else if (ref.kind === 'query_row') {
        const source = factRows.get(`${ref.queryId}/${ref.rowId}`);
        if (!source || source.row.value === null) {
          failures.push('VISIBLE_QUERY_BINDING_MISMATCH');
          continue;
        }
        candidates.push({
          label: `${String(card.title)} ${cell.label}`,
          display: cell.value,
          unit: source.fact.unit,
          exact: fraction(source.row.value),
          unavailable: false,
          index,
          derived: false,
        });
      } else if (ref.kind === 'calculation')
        unassessed.push('LEGACY_CALCULATION_REQUIRES_INDEPENDENT_REVIEW');
    }
  }
  const matched: number[] = [];
  for (const expected of required) {
    const found = candidates.find((c) => !matched.includes(c.index) && candidateMatches(expected, c));
    if (found) matched.push(found.index);
    else failures.push(`MISSING_OR_INCORRECT_OUTPUT:${expected.label}:${expected.unit}`);
  }
  if (item.ordered && matched.some((n, i) => i > 0 && n < matched[i - 1]))
    failures.push('OUTPUT_ORDER_MISMATCH');
  // A source table is valid for a requested ranking/amount, but never for a new running total/median/mean/ratio.
  if (
    [
      'F01',
      'F02',
      'F03',
      'F04',
      'F05',
      'F06',
      'F09',
      'F10',
      'F11',
      'F12',
      'F13',
      'F14',
      'F15',
      'F16',
      'F17',
      'F18',
      'F19',
      'F20',
    ].includes(item.id) &&
    !matched.some((n) => candidates.find((c) => c.index === n)?.derived)
  )
    failures.push('REQUESTED_CALCULATION_NOT_DISPLAYED');
  return {
    numericStatus: failures.length ? 'failed' : unassessed.length ? 'needs_review' : 'verified',
    sourceChecks,
    requiredOutputs: required.length,
    matchedOutputs: matched.length,
    failures: [...new Set(failures)],
    unassessed: [...new Set(unassessed)],
    semanticReview: 'pending',
    overallPass: false,
    reviewRequirement:
      'Check original intent, every requested output, exact source/filter and denominator meaning, row labels and order, clarification quality, all prose/causal claims and extra financial figures. Numeric matching alone is not a conversation pass.',
  };
}
