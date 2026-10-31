import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { config } from './config';
import { AppError } from './errors';

export type ModelMessages = { role: 'user' | 'assistant'; content: string }[];
export type FinancialTool = {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
};
export type ModelUsage = {
  inputTokens: number | null;
  // Visible output; thinking/reasoning tokens are reported separately.
  outputTokens: number | null;
  thinkingTokens: number | null;
  totalTokens: number | null;
};
export type ModelMetadata = {
  provider: 'gemini' | 'openai';
  model: string;
  modelVersion?: string;
  durationMs: number;
  usage: ModelUsage;
};
type Budget = { maxAttempts: number; maxTotalTokens: number };
let budget: Budget | null = null;
let inFlight = 0;
let totals = emptyTotals();
function emptyTotals() {
  return {
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    unreportedUsage: 0,
  };
}

// CLI evaluation controls are process-local. No key, prompt or response body is retained.
// The token guard stops subsequent calls after reported usage reaches the limit;
// one bounded request may cross it, so this is not an absolute billing ceiling.
export function setAiBudget(value: Budget | null) {
  if (
    value &&
    (!Number.isSafeInteger(value.maxAttempts) ||
      value.maxAttempts < 1 ||
      !Number.isSafeInteger(value.maxTotalTokens) ||
      value.maxTotalTokens < 1)
  )
    throw new Error('AI evaluation budgets must be positive safe integers.');
  budget = value ? { ...value } : null;
}
export function resetAiUsage() {
  if (inFlight) throw new Error('Cannot reset AI usage while a request is running.');
  totals = emptyTotals();
}
export function getAiUsage() {
  return { ...totals };
}

const invalid = () =>
  new AppError(
    502,
    'AI_INVALID_RESPONSE',
    'The assistant returned an invalid response. Your books have not changed. Try adding more detail.',
  );
type ProviderDiagnostic = {
  failureClass: 'http' | 'transport' | 'timeout' | 'provider';
  upstreamStatus: number | null;
  transportCode?: string;
};
// Kept separate from AppError.details, which the API returns to the browser.
class ProviderFailure extends AppError {
  constructor(
    status: number,
    code: string,
    message: string,
    readonly diagnostic: ProviderDiagnostic,
  ) {
    super(status, code, message);
  }
}
function providerError(status?: number) {
  const diagnostic: ProviderDiagnostic = {
    failureClass: status === undefined ? 'provider' : 'http',
    upstreamStatus: status ?? null,
  };
  if (status === 400)
    return new ProviderFailure(
      502,
      'AI_REQUEST_REJECTED',
      'The AI provider rejected the request. Check the key, selected model and provider settings. Your books have not changed.',
      diagnostic,
    );
  if (status === 401 || status === 403)
    return new ProviderFailure(
      502,
      'AI_AUTH_ERROR',
      'The AI provider rejected access. Check the configured key and project permissions. Your books have not changed.',
      diagnostic,
    );
  if (status === 429)
    return new ProviderFailure(
      429,
      'AI_RATE_LIMIT',
      'The AI provider is at its rate or quota limit. Try later or use manual entry. Your books have not changed.',
      diagnostic,
    );
  if (status === 404)
    return new ProviderFailure(
      502,
      'AI_MODEL_UNAVAILABLE',
      'The configured AI model is unavailable to this project. Check AI_MODEL. Your books have not changed.',
      diagnostic,
    );
  if (status !== undefined && status >= 500 && status <= 599)
    return new ProviderFailure(
      503,
      'AI_SERVICE_UNAVAILABLE',
      'The AI service is temporarily unavailable. Your books have not changed. Try again shortly or use manual entry.',
      diagnostic,
    );
  return new ProviderFailure(
    502,
    'AI_PROVIDER_ERROR',
    'The AI provider could not complete this request. Your books have not changed. Try again or use manual entry.',
    diagnostic,
  );
}
function transportFailure(error: TypeError) {
  // Only explicitly recognized network codes are logged; messages and causes can contain secrets.
  const allowed = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
  ]);
  const cause = error.cause;
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  return new ProviderFailure(
    502,
    'AI_CONNECTION_ERROR',
    'Could not reach the AI service. Your books have not changed. Try again shortly or use manual entry.',
    {
      failureClass: 'transport',
      upstreamStatus: null,
      ...(typeof code === 'string' && allowed.has(code) ? { transportCode: code } : {}),
    },
  );
}
const tokenCount = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
function recordUsage(usage: ModelUsage) {
  totals.inputTokens += usage.inputTokens ?? 0;
  totals.outputTokens += usage.outputTokens ?? 0;
  totals.thinkingTokens += usage.thinkingTokens ?? 0;
  totals.totalTokens += usage.totalTokens ?? 0;
  if (usage.totalTokens === null) totals.unreportedUsage++;
}

async function withRequest<T>(
  operation: 'proposal' | 'financial_tool',
  fn: (metadata: (version: unknown, usage: ModelUsage) => ModelMetadata) => Promise<T>,
) {
  if (!config.aiKey)
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'The assistant is not connected yet. Manual entry and reports are available.',
    );
  if (inFlight >= 4) throw new AppError(429, 'AI_BUSY', 'The assistant is busy. Please try again shortly.');
  if (budget && (totals.attempts >= budget.maxAttempts || totals.totalTokens >= budget.maxTotalTokens))
    throw new AppError(
      429,
      'AI_BUDGET_EXCEEDED',
      'The configured AI evaluation limit has been reached. No further provider request was sent.',
    );
  if (budget && totals.unreportedUsage)
    throw new AppError(
      429,
      'AI_USAGE_UNAVAILABLE',
      'A previous provider attempt did not report token usage, so bounded evaluation has stopped. No further request was sent.',
    );
  inFlight++;
  totals.attempts++;
  const start = performance.now();
  let recorded = false;
  try {
    return await fn((version, usage) => {
      recordUsage(usage);
      recorded = true;
      return {
        provider: config.aiProvider,
        model: config.aiModel,
        ...(typeof version === 'string' && version.length <= 160 ? { modelVersion: version } : {}),
        durationMs: Math.round(performance.now() - start),
        usage,
      };
    });
  } catch (error) {
    let failure: AppError;
    if (error instanceof AppError) failure = error;
    else if (error instanceof OpenAI.APIError) failure = providerError(error.status);
    else if (
      error instanceof Error &&
      ['AbortError', 'TimeoutError', 'APIConnectionTimeoutError'].includes(error.name)
    )
      failure = new ProviderFailure(
        504,
        'AI_TIMEOUT',
        'The assistant took too long to respond. Your books have not changed. Try again or use manual entry.',
        { failureClass: 'timeout', upstreamStatus: null },
      );
    else failure = invalid();
    if (failure instanceof ProviderFailure)
      console.error(
        JSON.stringify({
          event: 'ai_provider_failure',
          provider: config.aiProvider,
          model: /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(config.aiModel) ? config.aiModel : 'invalid',
          operation,
          code: failure.code,
          ...failure.diagnostic,
          durationMs: Math.round(performance.now() - start),
        }),
      );
    throw failure;
  } finally {
    if (!recorded) totals.unreportedUsage++;
    inFlight--;
  }
}

function openAIClient() {
  // Exactly one HTTP attempt. The caller can retry explicitly; evaluations can count every attempt.
  return new OpenAI({ apiKey: config.aiKey, timeout: 25000, maxRetries: 0 });
}
function openAIUsage(response: {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
  } | null;
}): ModelUsage {
  const usage = response.usage;
  const thinking = usage ? tokenCount(usage.output_tokens_details?.reasoning_tokens ?? 0) : null;
  const output = tokenCount(usage?.output_tokens);
  return {
    inputTokens: tokenCount(usage?.input_tokens),
    outputTokens: output !== null && thinking !== null ? Math.max(0, output - thinking) : output,
    thinkingTokens: thinking,
    totalTokens: tokenCount(usage?.total_tokens),
  };
}

const geminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z
          .object({
            parts: z.array(
              z
                .object({
                  text: z.string().optional(),
                  thought: z.boolean().optional(),
                  functionCall: z.object({ name: z.string(), args: z.unknown() }).optional(),
                })
                .passthrough(),
            ),
          })
          .optional(),
      }),
    )
    .optional(),
  modelVersion: z.string().optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
    })
    .optional(),
});
type GeminiResponse = z.infer<typeof geminiResponseSchema>;
function geminiUsage(response: GeminiResponse): ModelUsage {
  const usage = response.usageMetadata;
  return {
    inputTokens: tokenCount(usage?.promptTokenCount),
    outputTokens: tokenCount(usage?.candidatesTokenCount),
    thinkingTokens: usage ? tokenCount(usage.thoughtsTokenCount ?? 0) : null,
    totalTokens: tokenCount(usage?.totalTokenCount),
  };
}
function responseParts(response: GeminiResponse) {
  if (response.candidates?.length !== 1 || response.candidates[0].finishReason !== 'STOP') throw invalid();
  const parts = response.candidates[0].content?.parts.filter((part) => !part.thought);
  if (!parts?.length) throw invalid();
  return parts;
}
function geminiProposalSchema(schema: z.ZodType) {
  // Large array maxima can exceed Gemini's constrained-decoding state budget.
  // Keep the complete Zod schema for response validation below; omit only the
  // provider grammar's array maxima. Output tokens still bound generation.
  return JSON.parse(
    JSON.stringify(z.toJSONSchema(schema), (key, value) =>
      key === 'maxItems' && typeof value === 'number' ? undefined : value,
    ),
  ) as Record<string, unknown>;
}
async function geminiRequest(
  instructions: string,
  messages: ModelMessages,
  extra: Record<string, unknown>,
  maxOutputTokens: number,
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.aiModel)}:generateContent`;
  // Build outside the network boundary so local serialization errors stay invalid-response errors.
  const request: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.aiKey },
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        candidateCount: 1,
        maxOutputTokens,
        ...(config.aiModel.startsWith('gemini-3') || config.aiModel.startsWith('gemini-4')
          ? { thinkingConfig: { thinkingLevel: 'LOW' } }
          : {}),
        ...(extra.generationConfig as Record<string, unknown> | undefined),
      },
      ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'generationConfig')),
    }),
  };
  let response: Response;
  try {
    response = await fetch(url, request);
  } catch (error) {
    if (error instanceof TypeError) throw transportFailure(error);
    throw error;
  }
  // Never include provider error payloads: they can echo user data or credentials.
  if (!response.ok) {
    // Stream cleanup must not replace the upstream status with an unrelated error.
    await response.body?.cancel().catch(() => {});
    throw providerError(response.status);
  }
  return geminiResponseSchema.parse(await response.json());
}

export async function generateProposal<T extends z.ZodType>(
  schema: T,
  instructions: string,
  messages: ModelMessages,
) {
  return withRequest('proposal', async (metadata) => {
    if (config.aiProvider === 'gemini') {
      const response = await geminiRequest(
        instructions,
        messages,
        {
          generationConfig: {
            responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: geminiProposalSchema(schema) } },
          },
        },
        4000,
      );
      const ai = metadata(response.modelVersion, geminiUsage(response));
      const parts = responseParts(response);
      if (parts.some((part) => typeof part.text !== 'string' || part.functionCall)) throw invalid();
      return { data: schema.parse(JSON.parse(parts.map((part) => part.text).join(''))) as z.infer<T>, ai };
    }
    const response = await openAIClient().responses.parse({
      model: config.aiModel,
      store: false,
      max_output_tokens: 4000,
      ...(config.aiModel === 'gpt-6-luna' ? { reasoning: { effort: 'low' as const } } : {}),
      instructions,
      input: messages,
      text: { format: zodTextFormat(schema, 'journal_proposal') },
    });
    const ai = metadata(response.model, openAIUsage(response));
    if (response.status && response.status !== 'completed') throw invalid();
    return { data: schema.parse(response.output_parsed) as z.infer<T>, ai };
  });
}

export async function chooseFinancialTool(
  tools: FinancialTool[],
  instructions: string,
  messages: ModelMessages,
) {
  const allowed = (call: { name: string; args: unknown }) => {
    if (!tools.some((tool) => tool.name === call.name))
      throw new AppError(422, 'UNSUPPORTED_TOOL', 'This financial query is not supported');
    return call;
  };
  return withRequest('financial_tool', async (metadata) => {
    if (config.aiProvider === 'gemini') {
      const response = await geminiRequest(
        instructions,
        messages,
        {
          tools: [
            {
              functionDeclarations: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: tool.parameters,
              })),
            },
          ],
          toolConfig: {
            functionCallingConfig: { mode: 'ANY', allowedFunctionNames: tools.map((tool) => tool.name) },
          },
        },
        2000,
      );
      const ai = metadata(response.modelVersion, geminiUsage(response));
      const calls = responseParts(response)
        .filter((part) => part.functionCall)
        .map((part) => part.functionCall!);
      if (calls.length !== 1) throw invalid();
      return { call: allowed({ name: calls[0].name, args: calls[0].args }), ai };
    }
    const response = await openAIClient().responses.create({
      model: config.aiModel,
      store: false,
      max_output_tokens: 2000,
      ...(config.aiModel === 'gpt-6-luna' ? { reasoning: { effort: 'low' as const } } : {}),
      tools,
      tool_choice: 'required',
      parallel_tool_calls: false,
      instructions,
      input: messages,
    });
    const ai = metadata(response.model, openAIUsage(response));
    if (response.status && response.status !== 'completed') throw invalid();
    const calls = response.output.filter((part) => part.type === 'function_call');
    if (calls.length !== 1) throw invalid();
    return { call: allowed({ name: calls[0].name, args: JSON.parse(calls[0].arguments) as unknown }), ai };
  });
}
