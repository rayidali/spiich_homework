import Decimal from 'decimal.js';
import type { AnalystSqlResult } from './analyst-sql';
import { AnalystNotebookError } from './analyst-notebook';

const Exact = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP });
const currencies = new Set(Intl.supportedValuesOf('currency'));
const amount = String.raw`[+\-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+\-]?\d+)?`;
const scale = String.raw`(?:[ \t\u00a0]*(?:thousand|million|billion|[kKmMbB])\b)?`;
const pattern = new RegExp(
  String.raw`(?:[+\-−]?\p{Sc}[ \t\u00a0]*${amount}${scale}|\b[A-Z]{3}[ \t\u00a0]*${amount}${scale}|${amount}${scale}[ \t\u00a0]*(?:%|percent\b|per cent\b|dollars?\b|euros?\b|pounds?\b|[A-Z]{3}\b))`,
  'gu',
);
type Literal = { text: string; value: Decimal; places: number; kind: 'money' | 'percent' };

/** Recognized numeric currency/percent notation only; not spelled-out numbers or proof of meaning. */
export function financialLiterals(text: string): Literal[] {
  const plain = text.replace(/[*_`]/g, '');
  const found: Literal[] = [];
  for (const match of plain.matchAll(pattern)) {
    const token = match[0];
    const code = token.match(/[A-Z]{3}/)?.[0];
    if (code && !currencies.has(code)) continue;
    const digits = token.match(new RegExp(amount))?.[0];
    if (!digits) continue;
    const [mantissa, exponent = '0'] = digits.split(/[eE]/);
    const decimalPlaces = mantissa.split('.')[1]?.length ?? 0;
    if (digits.length > 100 || decimalPlaces > 12 || Math.abs(Number(exponent)) > 60)
      throw new AnalystNotebookError(
        'ANALYST_UNSUPPORTED_FINANCIAL_LITERAL',
        'A financial figure exceeds the supported display precision or magnitude. Use a bounded, explicit numeric SQL value and display format.',
      );
    const multiplier = token.match(/\d[ \t\u00a0]*(thousand|million|billion|[kKmMbB])\b/)?.[1]?.toLowerCase();
    const power =
      multiplier === 'k' || multiplier === 'thousand'
        ? 3
        : multiplier === 'm' || multiplier === 'million'
          ? 6
          : multiplier === 'b' || multiplier === 'billion'
            ? 9
            : 0;
    let value = new Exact(digits.replaceAll(',', '').replace('−', '-')).mul(new Exact(10).pow(power));
    if (/^[−-]\p{Sc}/u.test(token)) value = value.negated();
    found.push({
      text: token,
      value,
      places: decimalPlaces - Number(exponent) - power,
      kind: /%|percent|per cent/.test(token) ? 'percent' : 'money',
    });
  }
  return found;
}

const identifierColumn = /(?:^|_)(?:id|code|number|position|revision|year|month|day|count)(?:_|$)/i;
/** Presence is not attribution/currency verification. Ask SQL for unsupported scalar calculations. */
export function assertFinancialLiteralSupport(
  texts: string[],
  results: AnalystSqlResult[],
  userTexts: string[] = [],
) {
  const claims = texts.flatMap(financialLiterals);
  if (!claims.length) return;
  const inputs = userTexts.flatMap(financialLiterals);
  const values: Decimal[] = [];
  for (const result of results) {
    result.columns.forEach((column, index) => {
      if (!['decimal', 'float', 'integer'].includes(column.kind) || identifierColumn.test(column.name))
        return;
      for (const row of result.rows) {
        const raw = row[index];
        if (raw === null || raw.length > 100 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))
          continue;
        const value = new Exact(raw);
        if (value.isFinite() && Math.abs(value.e) <= 60) values.push(value);
      }
    });
  }
  const unsupported = new Set<string>();
  for (const claim of claims) {
    const rounding = new Exact(10).pow(claim.places);
    const matches = (value: Decimal) => value.mul(rounding).toDecimalPlaces(0).div(rounding).eq(claim.value);
    if (!values.some(matches) && !inputs.some((input) => input.kind === claim.kind && matches(input.value)))
      unsupported.add(claim.text);
  }
  if (unsupported.size)
    throw new AnalystNotebookError(
      'ANALYST_UNSUPPORTED_FINANCIAL_LITERAL',
      `These money/percentage figures have no numeric support in the selected current query results or explicit user inputs: ${[...unsupported].slice(0, 12).join(', ')}. While investigation remains, calculate required totals/ratios in SQL and include their result table. Otherwise remove optional unsupported details, or clearly disclose an incomplete answer without those figures. Never guess or change a number just to pass this check. A matching value alone does not prove its meaning, currency or attribution.`,
    );
}
