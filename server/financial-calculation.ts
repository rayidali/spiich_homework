import { z } from 'zod';
import { AppError } from './errors';
import { Decimal, formatCurrency } from '../shared/money';
import { executeFinancialAnalysis, financialQuerySchema, type AnalysisFacts } from './financial-analysis';
import type { FinancialTool, ModelMessages } from './ai-provider';
import type { InsightEvidence } from './ai';
import { conversationSchema } from '../shared/conversation';
import { currencyCodes, dateSchema } from '../shared/schema';
import { compoundRowId, groupingDimensions, groupingPeriod } from './financial-grouping';

const nodeId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const decimal = z.string().regex(/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/);
const unitSchema = z.enum(['USD', 'USD_per_month', 'months', 'count', 'ratio']);
export type ScenarioUnit = z.infer<typeof unitSchema>;
const referenceSchema = z.union([
  z.strictObject({
    source: z.literal('query'),
    id: nodeId,
    rowId: z.string().min(1).max(1024),
    field: z.literal('value'),
  }),
  z.strictObject({
    source: z.literal('query'),
    id: nodeId,
    rowId: z.null(),
    field: z.literal('month_count'),
  }),
  z.strictObject({ source: z.literal('assumption'), id: nodeId, rowId: z.null(), field: z.literal('value') }),
  z.strictObject({
    source: z.literal('calculation'),
    id: nodeId,
    rowId: z.null(),
    field: z.literal('value'),
  }),
]);
export const financialScenarioSchema = z.strictObject({
  queries: z.array(financialQuerySchema).max(4),
  assumptions: z
    .array(
      z.strictObject({
        id: nodeId,
        value: decimal,
        unit: unitSchema,
        sourceText: z.string().min(1).max(500),
      }),
    )
    .max(8),
  calculations: z
    .array(
      z.strictObject({
        id: nodeId,
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        operands: z.array(referenceSchema).length(2),
      }),
    )
    .min(1)
    .max(8),
});
// Compatibility is deliberately narrower than the advertised tool grammar.
// A balance is the value of an explicitly identified balance query, never a
// second financial field that the model may invent on some other result.
const compatibleScenarioSchema = financialScenarioSchema.extend({
  calculations: z
    .array(
      financialScenarioSchema.shape.calculations.element.extend({
        operands: z
          .array(
            z.union([
              referenceSchema,
              z.strictObject({
                source: z.literal('query'),
                id: nodeId,
                rowId: z.string().min(1).max(1024),
                field: z.literal('balance'),
              }),
            ]),
          )
          .length(2),
      }),
    )
    .min(1)
    .max(8),
});
export function parseFinancialScenario(input: unknown): FinancialScenario {
  const parsed = compatibleScenarioSchema.parse(input);
  return financialScenarioSchema.parse({
    ...parsed,
    calculations: parsed.calculations.map((calculation) => ({
      ...calculation,
      operands: calculation.operands.map((reference) => {
        if (reference.field !== 'balance') return reference;
        if (
          !['account_balance', 'cash_balance'].includes(
            parsed.queries.find((query) => query.id === reference.id)?.metric ?? '',
          )
        )
          invalid('The balance field alias requires an explicitly referenced account-balance query.');
        return { ...reference, field: 'value' };
      }),
    })),
  });
}
export type FinancialScenario = z.infer<typeof financialScenarioSchema>;
export type ScenarioReference = z.infer<typeof referenceSchema>;
type Operation = FinancialScenario['calculations'][number]['operation'];
const parameters = z.toJSONSchema(financialScenarioSchema);
delete parameters.$schema;
export const financialScenarioTool: FinancialTool = {
  type: 'function',
  name: 'financial_scenario',
  strict: true,
  parameters,
  description: `Compute exact derived financial values using up to4 ledger queries,0..8 explicit user assumptions and1..8 ordered binary arithmetic steps. Pure posted-book arithmetic needs no assumptions and is labeled as recorded-data calculation. User-assumption or draft ancestry stays hypothetical. Never invent a numeric literal: every operand references a query's exact rowId/value, a quoted assumption, or an earlier calculation. Node IDs are globally unique. Query rows must be complete, non-null, and not per-entry averages. For a total query the rowId is total:total. Monetary value operands must be USD; count operands are counts.
Balance operands MUST use cash_balance with accountCodes:[], not account_balance. The server selects cash-designated ASSET posting accounts; an Assets group or an account called Cash is not equivalent. For a whole-company cash scenario use base currency, groupBy:'total', from:null and the requested as-of date. All generic account_balance queries are deliberately unsupported in this calculator, even when named cash or numerically equal to cash. Use financial_analysis for standalone noncash balances and request_details for unsupported noncash balance arithmetic. Net expense/revenue/profit flows and transaction counts remain supported for their actual meanings; never relabel them as opening cash. Cash source identities are retained through every derived calculation.
net_cash_movement operands are signed changes during an explicit inclusive period, not opening or closing cash. They require server-selected cash accounts, POSTED and sum. Their exact period, cash identities and query filters remain attached to the arithmetic as separate movement lineage. Filtered movement is only the change in matching transactions; co-occurring expense accounts do not establish payment allocation. Monetary operands remain USD only. Never present a movement as an as-of cash balance or a gross payment.
Compound group rows must be referenced by their exact compound rowId, with the ordered dimension keys and account identities returned by the query. Combining explicit rows does not allocate payments or prove the intended formula.
For an average per calendar month, use a single-dimension monthly flow query covering full calendar months and reference {source:'query',id:itsId,rowId:null,field:'month_count'}. The server derives months only from the complete, untruncated, unique, contiguous zero-filled monthly series with exact boundaries. No partial months, balances, quarters or per-entry averages. Divide the matching period's total by that month count; monetary query ancestors must cover the same full period. This field never reads a model-supplied number.
Each assumption sourceText must quote the actual USER wording with exactly one complete quantity and its unit: e.g. '$6,000 per month' USD_per_month, 'three months' months value3, '$3,000 recruiting' USD, 'eighteen percent' ratio value0.18, or '2 employees' count. Copy the original words; do not paraphrase the quote. Digits and unambiguous English whole cardinals zero through ninety-nine (including twenty-one) are supported. Hundreds, larger number words, fractions, ranges and negated quantities require clarification or digits. No assistant text, invented constants, annual-to-monthly conversions or unsupported currencies. The server preserves the actual user substring and span even if a returned quote normalized a cardinal to digits. Percent normalization is exact. These quotes prove numeric provenance, not future truth or intent.
Addition/subtraction require equal units. A ratio scales a value. USD_per_month times months is USD; USD divided by USD_per_month is months; USD divided by months is USD_per_month. Count may multiply USD, USD_per_month or months. Equal units divided yield ratio. Other dimensional combinations and zero divisors are rejected. Values are magnitude bounded. Calculations preserve exact rational arithmetic and round only for display. For salary plus18% burden, add salary to salary times0.18; do not invent a constant1.
Ask for missing scenario assumptions rather than inventing future revenue, obligations or reserves. Any used assumption makes that result hypothetical; draft-derived results remain unposted. Neither historical arithmetic nor a positive scenario remainder establishes affordability or predicts the future.`,
};

type Fraction = { numerator: bigint; denominator: bigint };
const magnitude = 10n ** 15n;
function invalid(message: string): never {
  throw new AppError(422, 'INVALID_SCENARIO', message);
}
function absolute(value: bigint) {
  return value < 0n ? -value : value;
}
function fraction(numerator: bigint, denominator: bigint): Fraction {
  if (!denominator) invalid('A scenario cannot divide by zero.');
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  let a = absolute(numerator),
    b = denominator;
  while (b) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  numerator /= a;
  denominator /= a;
  if (
    absolute(numerator) > magnitude * denominator ||
    numerator.toString().length > 2048 ||
    denominator.toString().length > 2048
  )
    invalid('A scenario exceeds the supported amount or precision bound.');
  return { numerator, denominator };
}
function fromDecimal(value: string): Fraction {
  decimal.parse(value);
  if (new Decimal(value).abs().gt('1000000000000000'))
    invalid('A scenario value exceeds the supported magnitude.');
  const negative = value.startsWith('-');
  const [whole, digits = ''] = value.replace(/^-/, '').split('.');
  return fraction(BigInt(whole + digits) * (negative ? -1n : 1n), 10n ** BigInt(digits.length));
}
function arithmetic(operation: Operation, left: Fraction, right: Fraction): Fraction {
  if (operation === 'add' || operation === 'subtract')
    return fraction(
      left.numerator * right.denominator +
        (operation === 'add' ? 1n : -1n) * right.numerator * left.denominator,
      left.denominator * right.denominator,
    );
  if (operation === 'multiply')
    return fraction(left.numerator * right.numerator, left.denominator * right.denominator);
  return fraction(left.numerator * right.denominator, left.denominator * right.numerator);
}
function resultUnit(operation: Operation, left: ScenarioUnit, right: ScenarioUnit): ScenarioUnit {
  if (operation === 'add' || operation === 'subtract') {
    if (left === right) return left;
  } else if (operation === 'multiply') {
    if (left === 'ratio') return right;
    if (right === 'ratio') return left;
    if ((left === 'USD_per_month' && right === 'months') || (right === 'USD_per_month' && left === 'months'))
      return 'USD';
    if (left === 'count' && ['USD', 'USD_per_month', 'months'].includes(right)) return right;
    if (right === 'count' && ['USD', 'USD_per_month', 'months'].includes(left)) return left;
  } else {
    if (left === right) return 'ratio';
    if (right === 'ratio') return left;
    if (left === 'USD' && right === 'USD_per_month') return 'months';
    if (left === 'USD' && right === 'months') return 'USD_per_month';
  }
  return invalid('Those scenario units cannot be combined by the selected operation.');
}

// Round the exact fraction only at the presentation boundary (half away from zero).
// Even recurring decimal divisions remain exact for downstream calculations.
function presentation(value: Fraction, unit: ScenarioUnit) {
  const digits = unit === 'USD' || unit === 'USD_per_month' ? 2 : 6;
  const scale = 10n ** BigInt(digits),
    scaled = absolute(value.numerator) * scale;
  let rounded = scaled / value.denominator;
  if ((scaled % value.denominator) * 2n >= value.denominator) rounded++;
  const padded = rounded.toString().padStart(digits + 1, '0');
  const amount = `${value.numerator < 0n && rounded !== 0n ? '-' : ''}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
  const normalized = digits === 2 ? amount : amount.replace(/\.?0+$/, '');
  return {
    value: normalized,
    label:
      unit === 'USD'
        ? `${formatCurrency(normalized)} USD`
        : unit === 'USD_per_month'
          ? `${formatCurrency(normalized)} USD/month`
          : `${normalized} ${unit}`,
  };
}

export type ScenarioAssumption = FinancialScenario['assumptions'][number] & {
  userMessageIndex: number;
  // Optional only for persisted historical evidence; every new citation emits both.
  sourceStart?: number;
  sourceEnd?: number;
  normalization?: 'english_cardinal';
};
type QueryReference =
  | { id: string; rowId: string; field: 'value' }
  | { id: string; rowId: null; field: 'month_count' };
type Provenance = { assumptionIds: string[]; queryRows: QueryReference[] };
type CalculationSource = 'posted' | 'draft' | 'scenario';
type Value = { exact: Fraction; unit: ScenarioUnit; provenance: Provenance; source: CalculationSource };
export type ScenarioCalculationFact = {
  kind: 'scenario_calculation';
  id: string;
  hypothetical: boolean;
  source: CalculationSource;
  operation: Operation;
  operands: ScenarioReference[];
  value: string;
  unit: ScenarioUnit;
  exact: { numerator: string; denominator: string };
  assumptions: ScenarioAssumption[];
  provenance: Provenance;
  // Optional only for historical persisted facts. Every new result emits this
  // exact server-verified lineage; IDs/names supplied by a model grant no role.
  cashSources?: { queryId: string; rowId: string; asOf: string; accountIds: string[] }[];
  cashMovementSources?: {
    queryId: string;
    rowId: string;
    from: string;
    to: string;
    accountIds: string[];
  }[];
};

const smallCardinals = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const tensCardinals = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const cardinalPattern = new RegExp(
  `\\b(?:${tensCardinals.join('|')})(?:[ -](?:${smallCardinals.slice(1, 10).join('|')}))?\\b|\\b(?:${smallCardinals.join('|')})\\b`,
  'gi',
);

/** Replace only whole cardinals, retaining an original character span for every
 * normalized character. No unit, punctuation, currency or other word changes. */
function normalizeCardinals(input: string) {
  let text = '';
  const starts: number[] = [],
    ends: number[] = [];
  let position = 0;
  function literal(from: number, to: number) {
    for (let index = from; index < to; index++) {
      text += input[index];
      starts.push(index);
      ends.push(index + 1);
    }
  }
  for (const match of input.matchAll(cardinalPattern)) {
    const start = match.index!,
      end = start + match[0].length;
    // "one-off", "one-hundred" and word fragments are not a quantity.
    if ((start > 1 && /[A-Za-z]-$/.test(input.slice(0, start))) || /^-[A-Za-z]/.test(input.slice(end)))
      continue;
    // Names such as "Three Rivers" and ordinary "one-time" prose are not
    // quantities. Only cardinals directly followed by supported units change.
    if (
      !/^\s*(?:%|(?:calendar\s+|full\s+|complete\s+)?months?\b|employees?\b|people\b|hires?\b|workers?\b|units?\b|items?\b|count\b|FTEs?\b|percent(?:age)?\b|ratio\b|fraction\b|multiplier\b|USD\b|(?:US\s+)?dollars?\b)/i.test(
        input.slice(end),
      )
    )
      continue;
    literal(position, start);
    const words = match[0].toLowerCase().split(/[ -]/);
    const value = tensCardinals.includes(words[0])
      ? (tensCardinals.indexOf(words[0]) + 2) * 10 + (words[1] ? smallCardinals.indexOf(words[1]) : 0)
      : smallCardinals.indexOf(words[0]);
    for (const digit of String(value)) {
      text += digit;
      starts.push(start);
      ends.push(end);
    }
    position = end;
  }
  literal(position, input.length);
  return { text, starts, ends };
}

// These bounded surrounding checks reject cropped scales, ranges, signs and
// explicit negation. They are not a claim to interpret every natural-language
// condition; unsupported wording asks for a clear numeric quantity instead.
function unsafeQuantityContext(before: string, after: string, afterQuote: string, unit: ScenarioUnit) {
  const prefix = before.replace(/(?:\bUSD\s*)?\$\s*$|\bUSD\s*$/i, '');
  const joined = /\b(\d+|[a-z]+(?:-[a-z]+)?)\s+(and|or|to)\s*$/i.exec(prefix);
  const joinedNumber =
    joined &&
    (/^\d+$/.test(joined[1]) ||
      joined[1]
        .toLowerCase()
        .split('-')
        .every((word) => smallCardinals.includes(word) || tensCardinals.includes(word)));
  const joinedQuantity =
    /\b(?:\d+|half|quarter)\s+(months?|employees?|people|hires?|workers?|units?|items?|count|FTEs?)\s+(and|or|to)\s*$/i.exec(
      prefix,
    );
  const previousUnit = joinedQuantity && /^months?$/i.test(joinedQuantity[1]) ? 'months' : 'count';
  return (
    /\b(?:hundred|thousand|million|billion|trillion|point|minus|negative)(?:\s+and)?\s*$/i.test(prefix) ||
    /^\s*(?:hundred|thousand|million|billion|trillion|point|and\s+(?:a\s+)?half|quarters?)\b/i.test(after) ||
    Boolean(joinedNumber && (joined![2].toLowerCase() !== 'and' || prefix === before)) ||
    Boolean(joinedQuantity && (joinedQuantity[2].toLowerCase() !== 'and' || previousUnit === unit)) ||
    /\d+\s*[-–—/]\s*$/.test(prefix) ||
    /^\s*(?:[-–—/]\s*\d|(?:or|to)\s+\d)/i.test(after) ||
    /^\s*(?:or|to)\s+\d/i.test(afterQuote) ||
    /^\s+and\s+(?:a|one|1)\s+(?:half|quarter)\b/i.test(afterQuote) ||
    (/\bbetween\s*$/i.test(prefix) && /^\s+and\s+(?:\d|[a-z])/i.test(afterQuote)) ||
    /\b(?:not|never|don't|do not|exclude|ignore|rather than|instead of)(?:\s+(?:use|assume|allow|budget|count|plan|for|a|the|period|of)){0,4}\s*$/i.test(
      prefix,
    ) ||
    /^\s*(?:(?:is|was|would be)\s+)?(?:wrong|incorrect|not)\b/i.test(afterQuote)
  );
}

function quotedAssumption(
  assumption: FinancialScenario['assumptions'][number],
  messages: ModelMessages,
): { value: Value; evidence: ScenarioAssumption } {
  const normalizedQuote = normalizeCardinals(assumption.sourceText);
  const text = normalizedQuote.text;
  if (/[£€¥₹]|\b(?:EUR|GBP|CAD|AUD|JPY|INR|Canadian|Australian|pounds?|euros?|yen)\b/i.test(text))
    invalid('Only explicit USD monetary assumptions are supported.');
  const literals = [...text.matchAll(/[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g)];
  if (literals.length !== 1)
    invalid('Each assumption quote must contain exactly one unambiguous numeric literal.');
  const literal = literals[0];
  if (literal.index! > 0 && /[\w.]/.test(text[literal.index! - 1]))
    invalid('An assumption needs a standalone numeric literal.');
  const end = literal.index! + literal[0].length;
  if (/^(?:\d|[.,]\d|[eE][+-]?\d)/.test(text.slice(end)))
    invalid('An assumption numeric literal is ambiguous.');
  const moneyUnit = /\$|\b(?:USD|(?:US\s+)?dollars?)\b/i.test(text);
  const monthly = /(?:per\s+month|a\s+month|each\s+month|\/\s*(?:month|mo)\b|monthly\b)/i.test(text);
  const percent = /%|\bpercent(?:age)?\b/i.test(text);
  // The unit must qualify this numeric literal, not another noun elsewhere in
  // the quote (for example, "2 months for employees" is a duration, not a count).
  const afterLiteral = text.slice(end);
  const monthUnit = /^\s*(?:(?:calendar|full|complete)\s+)?months?\b/i.test(afterLiteral);
  const countUnit = /^\s*(?:employees?|people|hires?|workers?|units?|items?|count|FTEs?)\b/i.exec(
    afterLiteral,
  );
  const countRate =
    countUnit !== null &&
    /^\s*(?:(?:per|a|each|every|\/)\s*(?:months?|years?|weeks?|days?|hours?)\b|monthly\b|annually\b|yearly\b|weekly\b|daily\b)/i.test(
      afterLiteral.slice(countUnit[0].length),
    );
  if (
    (assumption.unit === 'USD' && (!moneyUnit || monthly || percent)) ||
    (assumption.unit === 'USD_per_month' &&
      (!moneyUnit || !monthly || percent || /\b(?:annual|annually|yearly|weekly|daily)\b/i.test(text))) ||
    (assumption.unit === 'months' && (!monthUnit || monthly || moneyUnit || percent)) ||
    (assumption.unit === 'count' && (!countUnit || countRate || moneyUnit || percent)) ||
    (assumption.unit === 'ratio' &&
      (!(percent || /\b(?:ratio|fraction|multiplier)\b/i.test(text)) || moneyUnit))
  )
    invalid('The quoted number must include the unit used by its assumption.');
  let citation:
    | {
        userMessageIndex: number;
        sourceStart: number;
        sourceEnd: number;
        sourceText: string;
        normalization?: 'english_cardinal';
      }
    | undefined;
  for (const [userMessageIndex, message] of messages.entries()) {
    if (message.role !== 'user') continue;
    const normalizedMessage = normalizeCardinals(message.content);
    for (
      let at = normalizedMessage.text.indexOf(text);
      at !== -1;
      at = normalizedMessage.text.indexOf(text, at + 1)
    ) {
      const before = normalizedMessage.text.slice(0, at + literal.index!);
      const after = normalizedMessage.text.slice(at + end);
      const beforeQuote = normalizedMessage.text.slice(0, at);
      const afterQuote = normalizedMessage.text.slice(at + text.length);
      if (/[\w.,+\-–—]$/.test(before) || /^(?:\d|[.,]\d|[eE][+-]?\d)/.test(after)) continue;
      if (unsafeQuantityContext(before, after, afterQuote, assumption.unit)) continue;
      // A short quotation cannot crop a rate from its quantity's real unit.
      if (assumption.unit === 'count' || assumption.unit === 'months') {
        const unit =
          assumption.unit === 'count'
            ? /^\s*(?:employees?|people|hires?|workers?|units?|items?|count|FTEs?)\b/i.exec(after)
            : /^\s*(?:(?:calendar|full|complete)\s+)?months?\b/i.exec(after);
        if (
          unit &&
          /^\s*(?:(?:per|a|each|every|\/)\s*(?:months?|years?|weeks?|days?|hours?)\b|monthly\b|annually\b|yearly\b|weekly\b|daily\b)/i.test(
            after.slice(unit[0].length),
          )
        )
          continue;
      }
      if (/[-+]\s*\$\s*$/.test(before) && !/[-+]\s*\$\s*$/.test(text.slice(0, literal.index))) continue;
      if (
        /(?:£|€|¥|₹|\b(?:CAD|EUR|GBP|AUD|JPY|INR))\s*\$?\s*$/i.test(beforeQuote) ||
        /^\s*(?:CAD|EUR|GBP|AUD|JPY|INR)\b/i.test(afterQuote)
      )
        continue;
      if (!percent && /^\s*(?:%|percent\b)/i.test(after)) continue;
      if (
        assumption.unit === 'USD' &&
        /^\s*(?:USD\s*)?(?:(?:per|a|each|every|\/)\s*(?:months?|years?|weeks?|days?|hours?)\b|monthly\b|annually\b|yearly\b|weekly\b|daily\b)/i.test(
          after,
        )
      )
        continue;
      const sourceStart = normalizedMessage.starts[at];
      const sourceEnd = normalizedMessage.ends[at + text.length - 1];
      const sourceText = message.content.slice(sourceStart, sourceEnd);
      citation = {
        userMessageIndex,
        sourceStart,
        sourceEnd,
        sourceText,
        ...(sourceText !== text || assumption.sourceText !== text
          ? { normalization: 'english_cardinal' as const }
          : {}),
      };
      break;
    }
    if (citation) break;
  }
  if (!citation)
    invalid(
      'I could not verify a complete, unambiguous quantity and unit in your message. Please confirm that quantity using digits; I will not invent a replacement.',
    );
  let literalText = literal[0].replaceAll(',', '').replace(/^\+/, '');
  if (/-\s*\$\s*$/.test(text.slice(0, literal.index))) {
    if (literalText.startsWith('-')) invalid('An assumption sign is ambiguous.');
    literalText = '-' + literalText;
  }
  let quoted = fromDecimal(literalText);
  if (percent) quoted = fraction(quoted.numerator, quoted.denominator * 100n);
  const asserted = fromDecimal(assumption.value);
  if (asserted.numerator !== quoted.numerator || asserted.denominator !== quoted.denominator)
    invalid('An assumption value does not equal its quoted number.');
  if (assumption.unit === 'count' && (asserted.denominator !== 1n || asserted.numerator < 0n))
    invalid('A count assumption must be a nonnegative whole count.');
  return {
    value: {
      exact: asserted,
      unit: assumption.unit,
      provenance: { assumptionIds: [assumption.id], queryRows: [] },
      source: 'scenario',
    },
    evidence: { ...assumption, ...citation },
  };
}

function fullMonths(from: string | null, to: string) {
  if (!from || !from.endsWith('-01'))
    invalid('A calendar-month count requires full months, beginning on the first day.');
  const start = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1;
  const end = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7)) - 1;
  if (end < start || end - start + 1 > 120)
    invalid('A calendar-month count exceeds the supported period range.');
  const months = Array.from({ length: end - start + 1 }, (_, index) => {
    const monthIndex = start + index,
      year = Math.floor(monthIndex / 12),
      month = (monthIndex % 12) + 1;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    return { rowId: `month:${prefix}`, from: `${prefix}-01`, to: `${prefix}-${last}` };
  });
  if (months.at(-1)!.to !== to)
    invalid('A calendar-month count requires full months, ending on the last day.');
  return months;
}

function calendarMonths(fact: AnalysisFacts) {
  const p = fact.scope.plan;
  if (
    p.groupBy !== 'month' ||
    p.aggregation !== 'sum' ||
    ['account_balance', 'cash_balance'].includes(p.metric) ||
    fact.truncated
  )
    invalid('A month count requires a complete monthly flow series, not averages or closing balances.');
  const expected = fullMonths(p.from, p.to);
  if (expected.length > p.limit || fact.rows.length !== expected.length)
    invalid('The monthly query must include every month, including months without activity.');
  for (const period of expected) {
    const row = fact.rows.find((item) => item.rowId === period.rowId);
    if (
      !row ||
      row.from !== period.from ||
      row.to !== period.to ||
      row.value === null ||
      !/^\d{1,20}$/.test(row.entryCount) ||
      !/^-?\d+(?:\.\d+)?$/.test(row.value) ||
      (BigInt(row.entryCount) === 0n && !new Decimal(row.value).eq(0))
    )
      invalid('Monthly evidence has missing, duplicate, partial or incompatible calendar coverage.');
  }
  return fraction(BigInt(expected.length), 1n);
}

function checkAveragePeriods(amount: Value, duration: Value, facts: AnalysisFacts[]) {
  const calendars = duration.provenance.queryRows.filter((ref) => ref.field === 'month_count');
  for (const calendar of calendars) {
    const denominator = facts.find((fact) => fact.queryId === calendar.id)!;
    const expected = fullMonths(denominator.scope.plan.from, denominator.scope.plan.to).map((m) => m.rowId);
    const monetary = amount.provenance.queryRows.filter((ref) => ref.field === 'value');
    for (const id of new Set(monetary.map((ref) => ref.id))) {
      const fact = facts.find((item) => item.queryId === id)!;
      if (fact.unit === 'count') continue;
      const references = monetary.filter((ref) => ref.id === id);
      const spans = references.map((ref) => fact.rows.find((row) => row.rowId === ref.rowId)!);
      // A whole-period aggregate already covers the denominator. Otherwise,
      // require nonoverlapping full-month buckets covering that same period.
      const whole = spans.every(
        (row) => row.from === denominator.scope.plan.from && row.to === denominator.scope.plan.to,
      );
      if (whole && !['account_balance', 'cash_balance'].includes(fact.metric)) continue;
      if (!groupingPeriod(fact.grain) || ['account_balance', 'cash_balance'].includes(fact.metric))
        invalid('A monthly average must use amounts from the same full calendar period as its month count.');
      // Account/vendor buckets may repeat the same calendar period legitimately.
      // Prove complete coverage independently for every selected non-time tuple;
      // January for one vendor plus February for another is not a complete series.
      const tuples = new Map<string, typeof spans>();
      for (const row of spans) {
        const key = Array.isArray(fact.grain)
          ? JSON.stringify(
              row
                .dimensions!.filter((d) => d.kind !== 'month' && d.kind !== 'quarter')
                .map((d) => [d.kind, d.key, d.accountId ?? null]),
            )
          : '';
        tuples.set(key, [...(tuples.get(key) ?? []), row]);
      }
      for (const rows of tuples.values()) {
        const coverage = rows.flatMap((row) => fullMonths(row.from, row.to!).map((m) => m.rowId));
        if (
          coverage.length !== expected.length ||
          new Set(coverage).size !== coverage.length ||
          [...coverage].sort().some((month, index) => month !== [...expected].sort()[index])
        )
          invalid(
            'A monthly average requires the same complete calendar period for every selected account or counterparty tuple.',
          );
      }
    }
  }
}

function prepare(input: unknown, messages: ModelMessages) {
  const plan = parseFinancialScenario(input);
  conversationSchema.parse(messages);
  const ids = [...plan.queries, ...plan.assumptions, ...plan.calculations].map((node) => node.id);
  if (new Set(ids).size !== ids.length) invalid('Scenario node IDs must be unique.');
  // A generic stock measure can contain receivables/equipment and cannot be
  // established as cash by its query ID, selected account name or equal amount.
  // Keep standalone balance reporting, but withhold this broader arithmetic.
  if (plan.queries.some((query) => query.metric === 'account_balance'))
    invalid(
      'This calculator supports cash_balance for balance operands, not generic account balances. Noncash account balances can be viewed separately.',
    );
  const assumptions = new Map(plan.assumptions.map((item) => [item.id, quotedAssumption(item, messages)]));
  const units = new Map<string, ScenarioUnit>([...assumptions].map(([id, item]) => [id, item.value.unit]));
  for (const calculation of plan.calculations) {
    const operandUnits = calculation.operands.map((ref) => {
      if (ref.source === 'query') {
        const query = plan.queries.find((q) => q.id === ref.id);
        if (!query || query.aggregation === 'average_per_entry')
          invalid('Use a recorded total or count, not a per-entry average, as a scenario operand.');
        if (ref.field === 'month_count') {
          if (query.groupBy !== 'month' || query.metric === 'cash_balance')
            invalid('A calendar-month count requires a complete monthly flow query.');
          fullMonths(query.from, query.to);
          return 'months' as const;
        }
        if (query.metric !== 'journal_count' && query.currencyMode === 'native' && query.currency !== 'USD')
          invalid('Scenario monetary operands must be in USD; no currency conversion is inferred.');
        return query.metric === 'journal_count' ? ('count' as const) : ('USD' as const);
      }
      const unit = units.get(ref.id);
      const expected =
        ref.source === 'assumption'
          ? assumptions.has(ref.id)
          : plan.calculations.some((c) => c.id === ref.id) && !assumptions.has(ref.id);
      if (!unit || !expected)
        invalid('Every operand must reference an existing assumption or an earlier calculation.');
      return unit;
    });
    units.set(calculation.id, resultUnit(calculation.operation, operandUnits[0], operandUnits[1]));
  }
  return { plan, assumptions };
}

/** Compound facts come only from the query executor. Check their explicit
 * dimensions and IDs rather than inferring scope from equal amounts or labels. */
function validateCompoundRows(fact: AnalysisFacts) {
  const plan = fact.scope.plan;
  if (!Array.isArray(plan.groupBy)) return;
  const kinds = groupingDimensions(plan.groupBy);
  const accounts = fact.scope.groupingAccounts;
  if (
    !fact.scope.compoundGrouping ||
    JSON.stringify(fact.scope.compoundGrouping.dimensions) !== JSON.stringify(kinds) ||
    !accounts ||
    new Set(accounts.map((a) => a.id)).size !== accounts.length ||
    new Set(accounts.map((a) => a.code)).size !== accounts.length ||
    accounts.some((a) => !a.id || !a.code) ||
    (!kinds.includes('account') && accounts.length !== 0)
  )
    invalid('Compound query evidence requires its exact grouping and account scope.');
  for (const row of fact.rows) {
    const dimensions = row.dimensions;
    if (
      !dimensions ||
      dimensions.length !== kinds.length ||
      dimensions.some(
        (d, index) =>
          d.kind !== kinds[index] ||
          typeof d.key !== 'string' ||
          typeof d.label !== 'string' ||
          (d.kind === 'account'
            ? !d.accountId || !accounts.some((a) => a.id === d.accountId && a.code === d.key)
            : d.accountId !== undefined) ||
          (d.kind === 'counterparty' && d.key.length > 100),
      ) ||
      row.rowId !== compoundRowId(dimensions) ||
      !rowPeriodMatches(fact, row) ||
      (plan.metric === 'cash_balance' ? row.balanceAsOf !== row.to : row.balanceAsOf !== undefined)
    )
      invalid('Compound query rows have incompatible dimension identity, order or period.');
    const account = dimensions.find((d) => d.kind === 'account');
    const cash = fact.scope.cashBalanceSource ?? fact.scope.cashMovementSource;
    if (
      account &&
      ['cash_balance', 'net_cash_movement'].includes(plan.metric) &&
      !cash?.accounts.some((a) => a.id === account.accountId && a.code === account.key)
    )
      invalid('A compound cash row must identify an actual account in its verified cash source.');
  }
}

function cashRowAccountIds(fact: AnalysisFacts, row: AnalysisFacts['rows'][number]): string[] {
  if (Array.isArray(fact.grain)) {
    const account = row.dimensions!.find((d) => d.kind === 'account');
    if (account) return [account.accountId!];
  }
  return fact.grain === 'account'
    ? [decodeURIComponent(row.rowId.slice('account:'.length))]
    : [...fact.scope.resolvedAccountIds];
}

function validateCashSource(fact: AnalysisFacts) {
  const plan = fact.scope.plan;
  const proof = fact.scope.cashBalanceSource;
  const accountIds = proof?.accounts.map((account) => account.id) ?? [];
  const series = groupingPeriod(plan.groupBy) !== undefined;
  if (
    !proof ||
    proof.selection !== 'all_cash_asset_posting_accounts' ||
    plan.status !== 'POSTED' ||
    plan.aggregation !== 'sum' ||
    plan.accountCodes.length !== 0 ||
    plan.cooccurringAccountCodes.length !== 0 ||
    plan.counterparty.mode !== 'any' ||
    plan.counterparty.value !== '' ||
    plan.descriptionSearch !== '' ||
    plan.minimumAmount !== null ||
    plan.maximumAmount !== null ||
    (Array.isArray(plan.groupBy)
      ? plan.groupBy.length !== 2 || !plan.groupBy.includes('account') || !series
      : !['total', 'account', 'month', 'quarter'].includes(plan.groupBy)) ||
    (series ? plan.from === null : plan.from !== null) ||
    (plan.currencyMode === 'base' ? plan.currency !== null : plan.currency !== 'USD') ||
    fact.scope.statusMeaning !== 'booked' ||
    fact.scope.cooccurringAccountIds.length !== 0 ||
    fact.scope.amountBasis !== `inception_to_closing_date_${plan.currencyMode}_lines` ||
    new Set(accountIds).size !== accountIds.length ||
    accountIds.length !== fact.scope.resolvedAccountIds.length ||
    accountIds.some((id) => !fact.scope.resolvedAccountIds.includes(id)) ||
    proof.accounts.some(
      (account) =>
        account.type !== 'ASSET' ||
        account.is_cash !== true ||
        account.is_group !== false ||
        (plan.currencyMode === 'native' && account.currency !== plan.currency),
    ) ||
    fact.rows.some(
      (row) =>
        !row.to ||
        row.balanceAsOf !== row.to ||
        row.to > plan.to ||
        (series
          ? !row.from || row.from < plan.from! || row.from > row.to
          : row.from !== null || row.to !== plan.to) ||
        (plan.groupBy === 'account' &&
          !accountIds.some((id) => row.rowId === `account:${encodeURIComponent(id)}`)),
    ) ||
    (plan.groupBy === 'total' && (fact.rows.length !== 1 || fact.rows[0].rowId !== 'total:total'))
  )
    invalid('Cash operands require verified cash-designated asset accounts and matching balance scope.');
}

function rowPeriodMatches(fact: AnalysisFacts, row: AnalysisFacts['rows'][number]) {
  const plan = fact.scope.plan;
  const period = groupingPeriod(plan.groupBy);
  if (!period) return row.from === plan.from && row.to === plan.to;
  const key = Array.isArray(plan.groupBy)
    ? row.dimensions?.find((d) => d.kind === period)?.key
    : row.rowId.startsWith(`${period}:`)
      ? row.rowId.slice(period.length + 1)
      : undefined;
  if (key === undefined) return false;
  const match = period === 'month' ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key) : /^(\d{4})-Q([1-4])$/.exec(key);
  if (!match) return false;
  const month = period === 'month' ? Number(match[2]) : (Number(match[2]) - 1) * 3 + 1;
  const start = `${match[1]}-${String(month).padStart(2, '0')}-01`;
  if (!dateSchema.safeParse(start).success) return false;
  const endDate = new Date(`${start}T00:00:00.000Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + (period === 'month' ? 1 : 3));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const end = endDate.toISOString().slice(0, 10);
  return (
    plan.from !== null &&
    start <= plan.to &&
    end >= plan.from &&
    row.from === (start < plan.from ? plan.from : start) &&
    row.to === (end > plan.to ? plan.to : end)
  );
}

/** The executor supplies the authoritative cash selection. Check its identity,
 * period and grain without treating a filtered flow as an as-of stock. */
function validateCashMovementSource(fact: AnalysisFacts) {
  const plan = fact.scope.plan;
  const proof = fact.scope.cashMovementSource;
  const ids = proof?.accounts.map((account) => account.id) ?? [];
  if (
    !proof ||
    proof.selection !== 'all_cash_asset_posting_accounts' ||
    plan.status !== 'POSTED' ||
    plan.aggregation !== 'sum' ||
    plan.accountCodes.length !== 0 ||
    plan.from === null ||
    plan.from > plan.to ||
    (plan.currencyMode === 'base' ? plan.currency !== null : plan.currency === null) ||
    fact.scope.statusMeaning !== 'booked' ||
    fact.scope.amountBasis !== `net_cash_movement_${plan.currencyMode}_lines` ||
    fact.scope.cashBalanceSource !== undefined ||
    new Set(ids).size !== ids.length ||
    ids.length !== fact.scope.resolvedAccountIds.length ||
    ids.some((id) => !fact.scope.resolvedAccountIds.includes(id)) ||
    proof.accounts.some(
      (account) =>
        !account.id ||
        account.type !== 'ASSET' ||
        account.is_cash !== true ||
        account.is_group !== false ||
        !currencyCodes.some((currency) => currency === account.currency) ||
        (plan.currencyMode === 'native' && account.currency !== plan.currency),
    ) ||
    (plan.cooccurringAccountCodes.length === 0 && fact.scope.cooccurringAccountIds.length !== 0) ||
    fact.rows.some(
      (row) =>
        row.balanceAsOf !== undefined ||
        !rowPeriodMatches(fact, row) ||
        (plan.groupBy === 'account' && !ids.some((id) => row.rowId === `account:${encodeURIComponent(id)}`)),
    ) ||
    (plan.groupBy === 'total' && (fact.rows.length !== 1 || fact.rows[0].rowId !== 'total:total'))
  )
    invalid('Cash movement operands require verified cash accounts and matching inclusive flow scope.');
}

/** Pure arithmetic/provenance boundary. Supplied facts are the trusted query
 * executor's output, never facts manufactured by a model or matched by value. */
export function evaluateFinancialScenario(
  input: unknown,
  queryFacts: AnalysisFacts[],
  messages: ModelMessages,
): {
  answer: string;
  evidence: InsightEvidence[];
  facts: (AnalysisFacts | ScenarioCalculationFact)[];
} {
  const { plan, assumptions } = prepare(input, messages);
  if (
    queryFacts.length !== plan.queries.length ||
    new Set(queryFacts.map((f) => f.queryId)).size !== queryFacts.length
  )
    invalid('The scenario query evidence does not match its requested queries.');
  for (const fact of queryFacts) {
    const requested = plan.queries.find((q) => q.id === fact.queryId);
    if (
      !requested ||
      JSON.stringify(financialQuerySchema.parse(fact.scope.plan)) !== JSON.stringify(requested) ||
      fact.metric !== requested.metric ||
      fact.aggregation !== requested.aggregation ||
      JSON.stringify(fact.grain) !== JSON.stringify(requested.groupBy) ||
      fact.unit !==
        (requested.metric === 'journal_count'
          ? 'count'
          : requested.currencyMode === 'native'
            ? requested.currency
            : 'USD') ||
      fact.currency !==
        (requested.metric === 'journal_count'
          ? null
          : requested.currencyMode === 'native'
            ? requested.currency
            : 'USD') ||
      new Set(fact.rows.map((row) => row.rowId)).size !== fact.rows.length
    )
      invalid('The scenario query evidence has incompatible identity, units or scope.');
    validateCompoundRows(fact);
    if (fact.metric === 'cash_balance') validateCashSource(fact);
    if (fact.metric === 'net_cash_movement') validateCashMovementSource(fact);
  }
  const computed = new Map<string, Value>();
  function resolve(ref: ScenarioReference): Value {
    if (ref.source === 'assumption') return assumptions.get(ref.id)!.value;
    if (ref.source === 'calculation') return computed.get(ref.id)!;
    const fact = queryFacts.find((f) => f.queryId === ref.id)!;
    const source = fact.scope.plan.status === 'DRAFT' ? ('draft' as const) : ('posted' as const);
    if (ref.field === 'month_count')
      return {
        exact: calendarMonths(fact),
        unit: 'months',
        source,
        provenance: { assumptionIds: [], queryRows: [{ id: ref.id, rowId: null, field: 'month_count' }] },
      };
    const row = fact.rows.find((r) => r.rowId === ref.rowId);
    if (!row || row.value === null || fact.truncated)
      invalid('An operand needs its exact, non-null row from a complete query result.');
    return {
      exact: fromDecimal(row.value),
      // Non-USD monetary evidence is rejected above, never converted implicitly.
      unit: fact.unit === 'count' ? 'count' : 'USD',
      provenance: { assumptionIds: [], queryRows: [{ id: ref.id, rowId: ref.rowId, field: 'value' }] },
      source,
    };
  }
  const calculations: ScenarioCalculationFact[] = [];
  const tables = new Map<CalculationSource, InsightEvidence['rows']>();
  for (const calculation of plan.calculations) {
    const [left, right] = calculation.operands.map(resolve);
    const exact = arithmetic(calculation.operation, left.exact, right.exact);
    const unit = resultUnit(calculation.operation, left.unit, right.unit);
    if (calculation.operation === 'divide' && left.unit === 'USD' && right.unit === 'months')
      checkAveragePeriods(left, right, queryFacts);
    const provenance: Provenance = {
      assumptionIds: [...new Set([...left.provenance.assumptionIds, ...right.provenance.assumptionIds])],
      queryRows: [
        ...new Map(
          [...left.provenance.queryRows, ...right.provenance.queryRows].map((row) => [
            JSON.stringify(row),
            row,
          ]),
        ).values(),
      ],
    };
    const source: CalculationSource =
      left.source === 'scenario' || right.source === 'scenario'
        ? 'scenario'
        : left.source === 'draft' || right.source === 'draft'
          ? 'draft'
          : 'posted';
    computed.set(calculation.id, { exact, unit, provenance, source });
    const displayed = presentation(exact, unit);
    calculations.push({
      kind: 'scenario_calculation',
      id: calculation.id,
      hypothetical: source !== 'posted',
      source,
      operation: calculation.operation,
      operands: calculation.operands,
      value: displayed.value,
      unit,
      exact: { numerator: exact.numerator.toString(), denominator: exact.denominator.toString() },
      assumptions: provenance.assumptionIds.map((id) => assumptions.get(id)!.evidence),
      provenance,
      cashSources: provenance.queryRows.flatMap((reference) => {
        const fact = queryFacts.find((item) => item.queryId === reference.id)!;
        if (fact.metric !== 'cash_balance' || reference.field !== 'value') return [];
        const row = fact.rows.find((item) => item.rowId === reference.rowId)!;
        return [
          {
            queryId: reference.id,
            rowId: reference.rowId,
            asOf: row.balanceAsOf!,
            accountIds: cashRowAccountIds(fact, row),
          },
        ];
      }),
      cashMovementSources: provenance.queryRows.flatMap((reference) => {
        const fact = queryFacts.find((item) => item.queryId === reference.id)!;
        if (fact.metric !== 'net_cash_movement' || reference.field !== 'value') return [];
        const row = fact.rows.find((item) => item.rowId === reference.rowId)!;
        return [
          {
            queryId: reference.id,
            rowId: reference.rowId,
            from: row.from!,
            to: row.to!,
            accountIds: cashRowAccountIds(fact, row),
          },
        ];
      }),
    });
    const tableRows = tables.get(source) ?? [];
    tableRows.push({
      label: `Calculation ${calculations.length}: ${presentation(left.exact, left.unit).label} ${{ add: '+', subtract: '−', multiply: '×', divide: '÷' }[calculation.operation]} ${presentation(right.exact, right.unit).label}`,
      value: displayed.label,
    });
    tables.set(source, tableRows);
  }
  const last = calculations.at(-1)!;
  const lastValue = presentation(computed.get(last.id)!.exact, last.unit).label;
  const evidence: InsightEvidence[] = [];
  if (assumptions.size)
    evidence.push({
      title: 'User assumptions · HYPOTHETICAL',
      source: 'scenario',
      period: 'Quoted from your messages; these are not posted transactions',
      rows: [...assumptions.values()].map((a, i) => ({
        label: `Assumption ${i + 1}: “${a.evidence.sourceText}”`,
        value: presentation(a.value.exact, a.value.unit).label,
      })),
      href: '/transactions',
    });
  for (const [source, rows] of tables)
    evidence.push({
      title:
        source === 'scenario'
          ? 'Hypothetical calculations'
          : source === 'draft'
            ? 'Calculations using unposted drafts'
            : 'Calculations from posted books',
      source,
      period: 'Exact arithmetic internally; displayed USD amounts rounded to cents',
      rows,
      href: '/transactions',
    });
  return {
    answer:
      last.source === 'posted'
        ? `From the posted books, the calculated result is ${lastValue}. This uses recorded amounts for the shown scopes.`
        : last.source === 'draft'
          ? `Using unposted drafts, the calculated result is ${lastValue}. This is hypothetical and is not a posted book total.`
          : `Using these assumptions, the calculated result is ${lastValue}. This is hypothetical, not a forecast or an affordability decision.`,
    evidence,
    facts: [...queryFacts, ...calculations],
  };
}

export async function executeFinancialScenario(org: string, input: unknown, messages: ModelMessages) {
  // Validate quotes, identifiers, dependencies and dimensions before any database work.
  const { plan } = prepare(input, messages);
  const queried = plan.queries.length
    ? await executeFinancialAnalysis(org, { queries: plan.queries })
    : { facts: [], evidence: [] };
  if (queried.facts.some((fact) => fact.scope.organizationId !== org))
    invalid('Scenario evidence must belong to the current workspace.');
  const result = evaluateFinancialScenario(plan, queried.facts, messages);
  return { ...result, evidence: [...queried.evidence, ...result.evidence] };
}
