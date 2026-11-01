import { z } from 'zod';
import type { FinancialTool } from './ai-provider';
import { publicFinancialQuerySchema } from './financial-analysis';
import { financialScenarioSchema } from './financial-calculation';
import { answerContractSchema, outputBindingsSchema } from './answer-contract';
import { AppError } from './errors';

const wireName = 'plan_complete_answer';
const initialNames = ['financial_analysis', 'financial_scenario', 'inspect_financial_data'] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function initialCompletion(tools: FinancialTool[]) {
  return initialNames.every((name) => {
    const matches = tools.filter((tool) => tool.name === name);
    const properties = matches[0]?.parameters.properties;
    return (
      matches.length === 1 &&
      record(properties) &&
      Object.hasOwn(properties, 'answerContract') &&
      Object.hasOwn(properties, 'outputBindings')
    );
  });
}
const query = publicFinancialQuerySchema.extend({
  currencyMode: publicFinancialQuerySchema.shape.currencyMode.removeDefault(),
  currency: publicFinancialQuerySchema.shape.currency.removeDefault(),
});
// One declaration of each nested grammar. Existing canonical schemas still
// validate the mapped plan before anchors are prepared or financial data read.
const wireShape = z.strictObject({
  mode: z.enum(['analysis', 'scenario', 'inspect']),
  queries: z.array(query).max(4),
  assumptions: z.array(financialScenarioSchema.shape.assumptions.element).max(8),
  calculations: z.array(financialScenarioSchema.shape.calculations.element).max(8),
  outputs: answerContractSchema.shape.outputs,
  bindings: outputBindingsSchema,
});
const wireSchema = wireShape.superRefine((value, context) => {
  const invalid = (path: string, message: string) =>
    context.addIssue({ code: 'custom', path: [path], message });
  if (value.mode !== 'scenario') {
    if (!value.queries.length) invalid('queries', 'Analysis and inspection require a query.');
    if (value.assumptions.length) invalid('assumptions', 'Only scenario mode accepts assumptions.');
    if (value.calculations.length) invalid('calculations', 'Only scenario mode accepts calculations.');
  } else if (!value.calculations.length) invalid('calculations', 'Scenario mode requires a calculation.');
  if (value.mode === 'inspect' && value.bindings.length)
    invalid('bindings', 'Initial inspection cannot bind unread results.');
});
const parameters = z.toJSONSchema(wireShape);
delete parameters.$schema;
const wireTool: FinancialTool = {
  type: 'function',
  name: wireName,
  strict: true,
  description:
    'Declare every requested output before reading amounts, then choose one initial action. mode analysis executes queries directly; scenario executes queries with explicit assumptions/calculations; inspect reads queries before a later decision. Analysis and inspect require at least one query and empty assumptions/calculations. Inspect requires bindings:[]. Scenario requires at least one calculation. outputs is the direct array of unchanged strict declared-output objects; bindings connects direct results to those outputs. Preserve original-user quotes and every scope/formula. No SQL, prose, annotations or extra fields. INITIAL WIRE FORMAT: call plan_complete_answer or request_details. Earlier financial_analysis, financial_scenario and inspect_financial_data describe the three modes analysis, scenario and inspect of plan_complete_answer, not separate initial function names. Supply exactly mode, queries, assumptions, calculations, outputs and bindings. outputs is an ARRAY directly: never add an answerContract wrapper or JSON-schema annotations such as type/properties. Each output still has id, sourceQuotes and requirement. bindings is the existing outputBindings array under this shorter field name. Analysis and inspect use assumptions:[] and calculations:[]; inspect also uses bindings:[]. Scenario requires a calculation. Initial query objects use the public query fields only; no counterpartySource is needed before any inspection. For requirement.kind=value ONLY, supply selectedAccountCode:null unless selecting a specific account cell; do not add selectedAccountCode to selected_identity, table or arithmetic. These syntax rules do not change any financial constraint, original-user quotation, arithmetic operation or validation rule.',
  parameters,
};

/** Gemini-only wire projection. Canonical product tools and other phases stay intact. */
export function completionWireTools(tools: FinancialTool[]): FinancialTool[] {
  if (!initialCompletion(tools)) return tools;
  return [
    structuredClone(wireTool),
    ...tools.filter((tool) => !initialNames.some((name) => name === tool.name)),
  ];
}

/** No I/O or permissive cleanup. Decode inside the existing schema-repair boundary. */
export function decodeCompletionWireCall(
  tools: FinancialTool[],
  call: { name: string; args: unknown },
): { name: string; args: unknown } {
  if (call.name !== wireName) {
    if (!tools.some((tool) => tool.name === call.name))
      throw new AppError(422, 'UNSUPPORTED_TOOL', 'This financial query is not supported');
    return call; // Known historical captures still pass the original strict parser.
  }
  if (!initialCompletion(tools))
    throw new AppError(422, 'UNSUPPORTED_TOOL', 'This financial query is not supported');
  const value = wireSchema.parse(call.args);
  const metadata = { answerContract: { outputs: value.outputs }, outputBindings: value.bindings };
  if (value.mode === 'analysis')
    return { name: 'financial_analysis', args: { queries: value.queries, ...metadata } };
  if (value.mode === 'inspect')
    return {
      name: 'inspect_financial_data',
      args: {
        queries: value.queries.map((item) => ({ ...item, counterpartySource: null })),
        ...metadata,
      },
    };
  return {
    name: 'financial_scenario',
    args: {
      queries: value.queries,
      assumptions: value.assumptions,
      calculations: value.calculations,
      ...metadata,
    },
  };
}
