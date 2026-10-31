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
const referenceSchema = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('query'),
    id: nodeId,
    rowId: z.string().min(1).max(500),
    field: z.literal('value'),
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
    .min(1)
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
  description: `Compute a clearly HYPOTHETICAL scenario using up to4 ledger queries,1..8 explicit user assumptions and1..8 ordered binary arithmetic steps. Never invent a numeric literal: every operand references a query's exact rowId/value, a quoted assumption, or an earlier calculation. Node IDs are globally unique. Query rows must be complete, non-null, and not per-entry averages. For a total query the rowId is total:total. Query values are recorded USD or counts.
Each assumption sourceText must be an exact substring of a USER message, containing exactly one numeric literal and its unit: e.g. '$6,000 per month' USD_per_month, '3 months' months, '$3,000 recruiting' USD, '18%' ratio value0.18, or '2 employees' count. No assistant text, invented constants, annual-to-monthly conversions or unsupported currencies. Percent normalization is exact. Use digits, not spelled-out numbers. These quotes prove numeric provenance, not future truth or intent.
Addition/subtraction require equal units. A ratio scales a value. USD_per_month times months is USD; USD divided by USD_per_month is months; USD divided by months is USD_per_month. Count may multiply USD, USD_per_month or months. Equal units divided yield ratio. Other dimensional combinations and zero divisors are rejected. Values are magnitude bounded. Calculations preserve exact rational arithmetic and round only for display. For salary plus18% burden, add salary to salary times0.18; do not invent a constant1.
All derived results are hypothetical, not forecasts or affordability decisions. Ask for missing assumptions rather than inventing future revenue, obligations or reserves. Do not claim affordability even when a calculated remainder is positive.`,
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
type Provenance = { assumptionIds: string[]; queryRows: { id: string; rowId: string; field: 'value' }[] };
type Value = { exact: Fraction; unit: ScenarioUnit; provenance: Provenance };
export type ScenarioCalculationFact = {
  kind: 'scenario_calculation';
  id: string;
  hypothetical: true;
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
  if (
    (assumption.unit === 'USD' && (!moneyUnit || monthly || percent)) ||
    (assumption.unit === 'USD_per_month' &&
      (!moneyUnit || !monthly || percent || /\b(?:annual|annually|yearly|weekly|daily)\b/i.test(text))) ||
    (assumption.unit === 'months' && (!/months?\b/i.test(text) || monthly || moneyUnit || percent)) ||
    (assumption.unit === 'count' &&
      (!/\b(?:employees?|people|hires?|workers?|units?|items?|count|FTEs?)\b/i.test(text) ||
        moneyUnit ||
        percent)) ||
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
    },
    evidence: { ...assumption, userMessageIndex },
  };
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
      fact.unit !== (requested.metric === 'journal_count' ? 'count' : 'USD') ||
      fact.currency !== (requested.metric === 'journal_count' ? null : 'USD') ||
      new Set(fact.rows.map((row) => row.rowId)).size !== fact.rows.length
    )
      invalid('The scenario query evidence has incompatible identity, units or scope.');
  }
  const computed = new Map<string, Value>();
  function resolve(ref: ScenarioReference): Value {
    if (ref.source === 'assumption') return assumptions.get(ref.id)!.value;
    if (ref.source === 'calculation') return computed.get(ref.id)!;
    const fact = queryFacts.find((f) => f.queryId === ref.id)!;
    const row = fact.rows.find((r) => r.rowId === ref.rowId);
    if (!row || row.value === null || fact.truncated)
      invalid('An operand needs its exact, non-null row from a complete query result.');
    return {
      exact: fromDecimal(row.value),
      // Non-USD monetary evidence is rejected above, never converted implicitly.
      unit: fact.unit === 'count' ? 'count' : 'USD',
      provenance: { assumptionIds: [], queryRows: [{ id: ref.id, rowId: ref.rowId, field: 'value' }] },
    };
  }
  const calculations: ScenarioCalculationFact[] = [];
  const tableRows: InsightEvidence['rows'] = [];
  const referenceLabel = (ref: ScenarioReference) =>
    ref.source === 'query'
      ? `Q${plan.queries.findIndex((q) => q.id === ref.id) + 1}[${ref.rowId}]`
      : ref.source === 'assumption'
        ? `A${plan.assumptions.findIndex((a) => a.id === ref.id) + 1}`
        : `C${plan.calculations.findIndex((c) => c.id === ref.id) + 1}`;
  for (const calculation of plan.calculations) {
    const [left, right] = calculation.operands.map(resolve);
    const exact = arithmetic(calculation.operation, left.exact, right.exact);
    const unit = resultUnit(calculation.operation, left.unit, right.unit);
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
    computed.set(calculation.id, { exact, unit, provenance });
    const displayed = presentation(exact, unit);
    calculations.push({
      kind: 'scenario_calculation',
      id: calculation.id,
      hypothetical: true,
      operation: calculation.operation,
      operands: calculation.operands,
      value: displayed.value,
      unit,
      exact: { numerator: exact.numerator.toString(), denominator: exact.denominator.toString() },
      assumptions: provenance.assumptionIds.map((id) => assumptions.get(id)!.evidence),
      provenance,
    });
    tableRows.push({
      label: `Calculated result ${calculations.length} (C${calculations.length}): ${referenceLabel(calculation.operands[0])} ${{ add: '+', subtract: '−', multiply: '×', divide: '÷' }[calculation.operation]} ${referenceLabel(calculation.operands[1])}`,
      value: displayed.label,
    });
  }
  const last = tableRows.at(-1)!;
  return {
    answer: `HYPOTHETICAL scenario. ${last.label}: ${last.value}. This calculation uses the listed user assumptions and recorded query results. It does not establish future receipts, obligations, or whether a decision is affordable.`,
    evidence: [
      {
        title: 'User assumptions · HYPOTHETICAL',
        period: 'Quoted from your messages; these are not posted transactions',
        rows: [...assumptions.values()].map((a, i) => ({
          label: `A${i + 1}: “${a.evidence.sourceText}”`,
          value: presentation(a.value.exact, a.value.unit).label,
        })),
        href: '/transactions',
      },
      {
        title: 'Scenario arithmetic · HYPOTHETICAL',
        period: 'Exact arithmetic internally; displayed USD amounts rounded to cents',
        rows: tableRows,
        href: '/transactions',
      },
    ],
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
