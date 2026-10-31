import { z } from 'zod';
import { AppError } from './errors';
import { Decimal, formatCurrency } from '../shared/money';
import { executeFinancialAnalysis, financialQuerySchema, type AnalysisFacts } from './financial-analysis';
import type { FinancialTool, ModelMessages } from './ai-provider';
import type { InsightEvidence } from './ai';

const nodeId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const decimal = z.string().regex(/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/);
const unitSchema = z.enum(['USD', 'USD_per_month', 'months', 'count', 'ratio']);
export type ScenarioUnit = z.infer<typeof unitSchema>;
const referenceSchema = z.union([
  z.strictObject({
    source: z.literal('query'),
    id: nodeId,
    rowId: z.string().min(1).max(500),
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
For an average per calendar month, use a monthly flow query covering full calendar months and reference {source:'query',id:itsId,rowId:null,field:'month_count'}. The server derives months only from the complete, untruncated, unique, contiguous zero-filled monthly series with exact boundaries. No partial months, balances, quarters or per-entry averages. Divide the matching period's total by that month count; monetary query ancestors must cover the same full period. This field never reads a model-supplied number.
Each assumption sourceText must be an exact substring of a USER message, containing exactly one numeric literal and its unit: e.g. '$6,000 per month' USD_per_month, '3 months' months, '$3,000 recruiting' USD, '18%' ratio value0.18, or '2 employees' count. No assistant text, invented constants, annual-to-monthly conversions or unsupported currencies. Percent normalization is exact. Use digits, not spelled-out numbers. These quotes prove numeric provenance, not future truth or intent.
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

export type ScenarioAssumption = FinancialScenario['assumptions'][number] & { userMessageIndex: number };
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
};

function quotedAssumption(
  assumption: FinancialScenario['assumptions'][number],
  messages: ModelMessages,
): { value: Value; evidence: ScenarioAssumption } {
  const text = assumption.sourceText;
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
  const userMessageIndex = messages.findIndex((message) => {
    if (message.role !== 'user') return false;
    for (let at = message.content.indexOf(text); at !== -1; at = message.content.indexOf(text, at + 1)) {
      const before = message.content.slice(0, at + literal.index!);
      const after = message.content.slice(at + end);
      const beforeQuote = message.content.slice(0, at);
      const afterQuote = message.content.slice(at + text.length);
      if (/[\w.,+-]$/.test(before) || /^(?:\d|[.,]\d|[eE][+-]?\d)/.test(after)) continue;
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
      return true;
    }
    return false;
  });
  if (userMessageIndex < 0)
    invalid(
      'Every assumption must quote a complete, unambiguous number and unit from the user’s own message.',
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
    evidence: { ...assumption, userMessageIndex },
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
  if (p.groupBy !== 'month' || p.aggregation !== 'sum' || p.metric === 'account_balance' || fact.truncated)
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
      if (whole && fact.metric !== 'account_balance') continue;
      if (!['month', 'quarter'].includes(fact.grain) || fact.metric === 'account_balance')
        invalid('A monthly average must use amounts from the same full calendar period as its month count.');
      const coverage = spans.flatMap((row) => fullMonths(row.from, row.to!).map((m) => m.rowId));
      if (
        coverage.length !== expected.length ||
        new Set(coverage).size !== coverage.length ||
        [...coverage].sort().some((month, index) => month !== [...expected].sort()[index])
      )
        invalid(
          'A monthly average must include exactly the same complete calendar period as its month count.',
        );
    }
  }
}

function prepare(input: unknown, messages: ModelMessages) {
  const plan = financialScenarioSchema.parse(input);
  z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(12)
    .parse(messages);
  const ids = [...plan.queries, ...plan.assumptions, ...plan.calculations].map((node) => node.id);
  if (new Set(ids).size !== ids.length) invalid('Scenario node IDs must be unique.');
  const assumptions = new Map(plan.assumptions.map((item) => [item.id, quotedAssumption(item, messages)]));
  const units = new Map<string, ScenarioUnit>([...assumptions].map(([id, item]) => [id, item.value.unit]));
  for (const calculation of plan.calculations) {
    const operandUnits = calculation.operands.map((ref) => {
      if (ref.source === 'query') {
        const query = plan.queries.find((q) => q.id === ref.id);
        if (!query || query.aggregation === 'average_per_entry')
          invalid('Use a recorded total or count, not a per-entry average, as a scenario operand.');
        if (ref.field === 'month_count') {
          if (query.groupBy !== 'month' || query.metric === 'account_balance')
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
      fact.grain !== requested.groupBy ||
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
