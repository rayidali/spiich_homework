import { z } from 'zod';
import { ResearchProviderError, tokenCount, type ProviderUsage } from './transport';

// Official Interactions OpenAPI, reviewed 2026-10-30. FileSearchResultStep exposes
// a call_id, not retrieved passage text. A generated summary is not a passage.
const fileCitationSchema = z.object({
  type: z.literal('file_citation'),
  file_name: z.string().max(2000).optional(),
  document_uri: z.string().max(4000).optional(),
  source: z.string().max(20000).optional(),
  custom_metadata: z
    .union([
      z.record(z.string(), z.unknown()),
      // The File Search guide uses this array form; OpenAPI uses an object.
      z.array(
        z.object({
          key: z.string().max(100),
          string_value: z.string().max(2000).optional(),
          numeric_value: z.number().finite().optional(),
        }),
      ),
    ])
    .refine((value) => JSON.stringify(value).length <= 10000)
    .optional(),
  page_number: z.number().int().nonnegative().optional(),
  media_id: z.string().max(2000).optional(),
  start_index: z.number().int().nonnegative().optional(),
  end_index: z.number().int().nonnegative().optional(),
});
export type InteractionsFileCitation = z.infer<typeof fileCitationSchema>;
const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(200000),
  annotations: z.array(fileCitationSchema).max(200).optional(),
});
const stepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file_search_call'), id: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('file_search_result'), call_id: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('model_output'), content: z.array(textContentSchema).max(100) }),
  z.object({ type: z.literal('thought') }), // Never retain thought content/signatures.
]);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const responseSchema = z.object({
  status: z.literal('completed'),
  model: z.string().min(1).max(160).optional(),
  steps: z.array(stepSchema).max(200),
  usage: z
    .object({
      total_input_tokens: count.optional(),
      total_tool_use_tokens: count.optional(),
      total_output_tokens: count.optional(),
      total_thought_tokens: count.optional(),
      total_tokens: count.optional(),
    })
    .optional(),
});
export type InteractionsFileSearchResult = {
  citations: InteractionsFileCitation[];
  searchCallCount: number;
  searchResultCount: number;
  /** The endpoint has no documented passage-result fields. */
  rawPassagesAvailable: false;
};

export function parseFileSearchInteraction(value: unknown): {
  data: InteractionsFileSearchResult;
  model?: string;
  usage: ProviderUsage;
} {
  const result = responseSchema.safeParse(value);
  if (!result.success) throw new ResearchProviderError('INVALID_RESPONSE');
  const parsed = result.data;
  const calls = parsed.steps.filter((step) => step.type === 'file_search_call');
  const results = parsed.steps.filter((step) => step.type === 'file_search_result');
  const ids = new Set(calls.map((step) => step.id));
  if (
    ids.size !== calls.length ||
    results.some((step) => !ids.has(step.call_id)) ||
    new Set(results.map((step) => step.call_id)).size !== results.length
  )
    throw new ResearchProviderError('INVALID_RESPONSE');
  const citations = parsed.steps.flatMap((step) => {
    if (step.type !== 'model_output') return [];
    return step.content.flatMap((content) => {
      const annotations = content.annotations ?? [];
      const length = Buffer.byteLength(content.text, 'utf8');
      if (
        annotations.some(
          (item) =>
            (item.start_index !== undefined && item.start_index > length) ||
            (item.end_index !== undefined && item.end_index > length) ||
            (item.start_index !== undefined &&
              item.end_index !== undefined &&
              item.start_index > item.end_index),
        )
      )
        throw new ResearchProviderError('INVALID_RESPONSE');
      return annotations;
    });
  });
  return {
    data: {
      citations,
      searchCallCount: calls.length,
      searchResultCount: results.length,
      rawPassagesAvailable: false,
    },
    model: parsed.model,
    usage: {
      // Tool-use prompts include retrieved context, charged at the input rate.
      // initial_input_tokens is a diagnostic subset/turn counter, not an addend.
      inputTokens:
        parsed.usage?.total_input_tokens === undefined
          ? null
          : tokenCount(parsed.usage.total_input_tokens + (parsed.usage.total_tool_use_tokens ?? 0)),
      outputTokens: tokenCount(parsed.usage?.total_output_tokens),
      thinkingTokens: parsed.usage ? tokenCount(parsed.usage.total_thought_tokens ?? 0) : null,
      totalTokens: tokenCount(parsed.usage?.total_tokens),
    },
  };
}
