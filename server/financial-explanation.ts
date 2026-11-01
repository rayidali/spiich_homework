import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { FinancialTool } from './ai-provider';

export type FinancialExplanation = {
  text: string;
  grounding: 'general_knowledge';
  verifiedFinancialData: false;
};

const finalTools = new Set([
  'expense_summary',
  'expense_by_account',
  'revenue_comparison',
  'income_summary',
  'period_comparison',
  'find_transactions',
  'cash_position',
  'financial_analysis',
  'financial_scenario',
  'show_inspected_results',
  'calculate_from_inspection',
]);
const field = 'generalExplanation';
const explanationValue = z
  .string()
  .max(1600)
  .trim()
  .min(1)
  .nullable()
  .describe(
    'A requested general concept explanation, without company facts or calculated outcomes. Null otherwise.',
  );
const explanationParameter = z.toJSONSchema(explanationValue);
delete explanationParameter.$schema;
const envelope = z.object({ generalExplanation: explanationValue.optional() }).passthrough();
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function annotated(tool: FinancialTool): boolean {
  return (
    finalTools.has(tool.name) &&
    record(tool.parameters.properties) &&
    Object.hasOwn(tool.parameters.properties, field) &&
    isDeepStrictEqual(tool.parameters.properties[field], explanationParameter)
  );
}

/** Add only a shallow optional explanation, never another copy of the query grammar.
 * Null is required on the strict provider wire; omitted historical calls remain
 * accepted by the decoder. The original declarations are never changed.
 */
export function withFinancialExplanations(tools: FinancialTool[]): FinancialTool[] {
  return tools.map((tool) => {
    if (!finalTools.has(tool.name)) return tool;
    if (annotated(tool)) return structuredClone(tool);
    const parameters = tool.parameters;
    if (
      parameters.type !== 'object' ||
      parameters.additionalProperties !== false ||
      !record(parameters.properties) ||
      Object.hasOwn(parameters.properties, field) ||
      (parameters.required !== undefined &&
        (!Array.isArray(parameters.required) ||
          !parameters.required.every((name) => typeof name === 'string')))
    )
      throw new Error('Financial explanation annotations require an unchanged strict object tool schema.');
    const copy = structuredClone(tool);
    copy.parameters.properties = {
      ...(copy.parameters.properties as Record<string, unknown>),
      [field]: structuredClone(explanationParameter),
    };
    copy.parameters.required = [
      ...new Set([...((copy.parameters.required as string[] | undefined) ?? []), field]),
    ];
    return copy;
  });
}

/** Repair describes the accepted application shape. Historical valid calls may
 * omit this optional annotation even though the strict wire asks for null. */
export function financialExplanationRepairTools(tools: FinancialTool[]): FinancialTool[] {
  return tools.map((tool) => {
    if (!annotated(tool)) return tool;
    const copy = structuredClone(tool);
    copy.parameters.required = (copy.parameters.required as string[]).filter((name) => name !== field);
    return copy;
  });
}

/** An annotation is not a financial argument or evidence. Strip only this known
 * field, and only when this exact offered tool declared it. All other fields go
 * unchanged to the ordinary financial parser. Shape checks cannot prove that
 * generated prose is true, relevant or free of unsupported claims.
 */
export function decodeFinancialExplanation<T>(
  tools: FinancialTool[],
  call: { name: string; args: T },
): {
  call: { name: string; args: T | Record<string, unknown> };
  generalExplanation?: FinancialExplanation;
} {
  const offered = tools.filter((tool) => tool.name === call.name);
  if (offered.length !== 1 || !annotated(offered[0])) return { call };
  const { generalExplanation, ...args } = envelope.parse(call.args);
  return {
    call: { name: call.name, args },
    ...(generalExplanation
      ? {
          generalExplanation: {
            text: generalExplanation,
            grounding: 'general_knowledge' as const,
            verifiedFinancialData: false as const,
          },
        }
      : {}),
  };
}

export const financialExplanationInstructions = `
When a user asks both for a stable business/accounting explanation and for recorded figures or a hypothetical calculation, choose the financial tool that answers the figures and fill its generalExplanation field with the requested concept explanation. Do not choose discuss_business alone and drop a financial question that the tools can answer. For example, "What is profit and what was ours last month?" needs the profit query for that calendar month plus a short explanation of profit.
The generalExplanation field is null unless an explanation was requested. Explain only the concept, never company amounts, calculated outcomes, causal conclusions, future facts, legal permission or an interpretation of results you have not read. Do not invent citations or data access. The application will display this general knowledge separately from the financial tool's checked answer and source cards; this text is not evidence and does not make a partial financial query complete. Preserve every financial constraint and use all existing query/calculation validation rules. If material information is missing, ask for it rather than inventing a result. This field adds no database access or provider step.`;
