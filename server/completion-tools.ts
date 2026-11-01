import { z } from 'zod';
import type { FinancialTool } from './ai-provider';
import {
  answerContractSchema,
  outputBindingsSchema,
  type AnswerContract,
  type OutputBinding,
} from './answer-contract';
import { AppError } from './errors';

type Phase = 'initial' | 'followup';
type ParseBase = (name: string, args: unknown) => Record<string, unknown>;
const initialNames = new Set([
  'financial_analysis',
  'financial_scenario',
  'inspect_financial_data',
  'request_details',
]);
const followupNames = new Set([
  'inspect_financial_data',
  'show_inspected_results',
  'calculate_from_inspection',
  'request_details',
]);
const metadataNames = ['answerContract', 'outputBindings'] as const;
/** Shared by the live planner and the bounded compatibility probe. This explains
 * existing strict rules; it does not normalize or accept invalid references. */
export const completionReferenceInstructions =
  '\nFor sourceQuotes, messageIndex is the ZERO-BASED index in the ENTIRE original conversation, including assistant messages. For [user, assistant, user], the second user message has messageIndex:2, never 1. Quote text must occur exactly once in that indexed original USER message. Do not count only user turns.\nOutput bindings must match the requested output kind: value and selected_identity require source:{kind:"query_row",queryId,rowId}; use rowId:"total:total" for an ungrouped total. A table requires source:{kind:"query_result",queryId}. Arithmetic requires source:{kind:"calculation",calculationId}. A query_result is not a scalar value binding, even if its table has only one row. Keep selectedAccountCode:null unless selecting one account from a grouped result; a simple account-filtered total already identifies its account in scope.accountCodes.';
const initialEnvelope = z.strictObject({
  answerContract: answerContractSchema,
  outputBindings: outputBindingsSchema,
});
const initialInspectionEnvelope = initialEnvelope.extend({ outputBindings: outputBindingsSchema.length(0) });
const finishEnvelope = z.strictObject({ outputBindings: outputBindingsSchema });
const emptyEnvelope = z.strictObject({});
function envelope(name: string, phase: Phase) {
  if (!(phase === 'initial' ? initialNames : followupNames).has(name))
    throw new AppError(422, 'UNSUPPORTED_TOOL', 'This completion-required financial tool is not supported.');
  if (name === 'request_details' || (phase === 'followup' && name === 'inspect_financial_data'))
    return emptyEnvelope;
  if (phase === 'followup') return finishEnvelope;
  return name === 'inspect_financial_data' ? initialInspectionEnvelope : initialEnvelope;
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function wrap(tool: FinancialTool, phase: Phase): FinancialTool {
  const fields = envelope(tool.name, phase);
  const copy = structuredClone(tool);
  if (fields === emptyEnvelope) return copy;
  const base = copy.parameters;
  if (
    base.type !== 'object' ||
    !record(base.properties) ||
    base.additionalProperties !== false ||
    (base.required !== undefined &&
      (!Array.isArray(base.required) || !base.required.every((key) => typeof key === 'string'))) ||
    metadataNames.some((key) => Object.hasOwn(base.properties as object, key))
  )
    throw new Error('Completion tools require a strict, unwrapped object parameter schema.');
  const extra = z.toJSONSchema(fields);
  copy.parameters = {
    ...base,
    properties: { ...base.properties, ...extra.properties },
    required: [...new Set([...((base.required as string[] | undefined) ?? []), ...(extra.required ?? [])])],
  };
  copy.description =
    phase === 'initial'
      ? `Declare answerContract before the first financial-result read. List the requested outputs with exact ORIGINAL USER quotes; the server freezes this contract after the entire first plan validates. It checks fulfillment of that declaration, not exhaustive user-intent understanding. Include outputBindings for direct results; inspect_financial_data requires outputBindings:[]. Never invent amounts or treat database/repair feedback as user evidence. This shares the existing three-attempt, one-schema-repair and time limits.\n${copy.description}`
      : `Supply outputBindings connecting the frozen requested outputs to exact query rows/results or checked calculations. Do not supply or replace answerContract. Copy request-local row handles when available. Missing bindings remain unresolved; no extra provider allowance is created. Existing source, arithmetic, snapshot and original-user safeguards still apply.\n${copy.description}`;
  return copy;
}
function selectTools(tools: FinancialTool[], phase: Phase): FinancialTool[] {
  const allowed = phase === 'initial' ? initialNames : followupNames;
  const selected = tools.filter((tool) => allowed.has(tool.name));
  if (new Set(selected.map((tool) => tool.name)).size !== selected.length)
    throw new Error('Completion tool names must be unique.');
  return selected.map((tool) => wrap(tool, phase));
}
/** Only the new opt-in route should use these declarations. Legacy tools stay unchanged. */
export const completionInitialTools = (tools: FinancialTool[]) => selectTools(tools, 'initial');
/** Preserve the caller's remaining-step subset; never re-add an exhausted read tool. */
export const completionFollowupTools = (tools: FinancialTool[]) => selectTools(tools, 'followup');

/** Validate structure only. Original-user anchors, dependencies and freezing belong to the caller. */
export function parseCompletionArgs(
  name: string,
  args: unknown,
  phase: Phase,
  parseBase: ParseBase,
): Record<string, unknown> {
  const schema = envelope(name, phase);
  const object = z.object({}).passthrough().parse(args);
  const metadata = Object.fromEntries(
    metadataNames.filter((key) => Object.hasOwn(object, key)).map((key) => [key, object[key]]),
  );
  const validated = schema.parse(metadata);
  const stripped = Object.fromEntries(
    Object.entries(object).filter(([key]) => !metadataNames.some((name) => name === key)),
  );
  const parsed = parseBase(name, stripped);
  // Base parsers cannot introduce a second envelope or overwrite validated metadata.
  if (metadataNames.some((key) => Object.hasOwn(parsed, key)))
    throw new Error('A base financial parser returned completion metadata.');
  return { ...parsed, ...validated };
}

/** Extract already-validated metadata before passing arguments to the unchanged executor. */
export function stripCompletionArgs(args: Record<string, unknown>): {
  args: Record<string, unknown>;
  contract?: AnswerContract;
  bindings?: OutputBinding[];
} {
  const { answerContract, outputBindings, ...base } = args;
  return {
    args: base,
    ...(Object.hasOwn(args, 'answerContract') ? { contract: answerContract as AnswerContract } : {}),
    ...(Object.hasOwn(args, 'outputBindings') ? { bindings: outputBindings as OutputBinding[] } : {}),
  };
}
