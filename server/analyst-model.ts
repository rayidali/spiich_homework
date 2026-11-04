import { createHash, randomUUID } from 'node:crypto';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
  ToolLoopAgent,
  isStepCount,
  type FinishReason,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';

export const ANALYST_MODEL_LIMITS = Object.freeze({
  modelId: 'gemini-3.8-flash',
  requestBytes: 200_000,
  outputTokens: 4096,
  timeoutMs: 40_000,
  accountingMs: 2000,
  inputNanoUsdPerToken: 750,
  outputNanoUsdPerToken: 3750,
});

type ErrorCode =
  | 'ANALYST_MODEL_CONFIG'
  | 'ANALYST_MODEL_INPUT'
  | 'ANALYST_MODEL_BUDGET'
  | 'ANALYST_MODEL_ACCOUNTING'
  | 'ANALYST_MODEL_PROVIDER'
  | 'ANALYST_MODEL_CANCELLED'
  | 'ANALYST_MODEL_TIMEOUT';
const errorMessages: Record<ErrorCode, string> = {
  ANALYST_MODEL_CONFIG: 'The analyst model is not configured for this request.',
  ANALYST_MODEL_INPUT: 'The analyst request exceeds its supported input or output limits.',
  ANALYST_MODEL_BUDGET: 'The analyst spending allowance could not authorize this request.',
  ANALYST_MODEL_ACCOUNTING:
    'The analyst could not save the request usage safely. Its allowance remains reserved.',
  ANALYST_MODEL_PROVIDER: 'The AI provider could not complete this analyst step.',
  ANALYST_MODEL_CANCELLED: 'The analyst was stopped.',
  ANALYST_MODEL_TIMEOUT: 'The analyst step exceeded its time limit.',
};
export class AnalystModelError extends Error {
  constructor(readonly code: ErrorCode) {
    super(errorMessages[code]);
    this.name = 'AnalystModelError';
  }
}
function fail(code: ErrorCode): never {
  throw new AnalystModelError(code);
}
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const dollars = (nanoUsd: number) => {
  const exact = BigInt(nanoUsd);
  return `${exact / 1_000_000_000n}.${String(exact % 1_000_000_000n).padStart(9, '0')}`;
};
const cost = (input: number, output: number) => {
  const nanoUsd =
    input * ANALYST_MODEL_LIMITS.inputNanoUsdPerToken + output * ANALYST_MODEL_LIMITS.outputNanoUsdPerToken;
  if (!Number.isSafeInteger(nanoUsd) || nanoUsd < 0) return undefined;
  return { nanoUsd, usd: dollars(nanoUsd) };
};

export type AnalystModelAttempt = {
  attemptId: string;
  modelId: string;
  requestBytes: number;
  requestSha256: string;
  /** Prior output implicitly billed again as input on an automatic continuation. */
  continuationCarryTokens: number;
  inputTokenReservation: number;
  outputTokenReservation: number;
  reservationNanoUsd: number;
  reservationUsd: string;
};
export type AnalystGoogleUsage = {
  promptTokenCount: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount: number;
};
export type AnalystModelReceipt = AnalystModelAttempt &
  (
    | {
        kind: 'known';
        httpStatus: number;
        usage: AnalystGoogleUsage;
        inputTokens: number;
        /** Any unclassified residual tokens are conservatively billed as output. */
        outputTokens: number;
        unclassifiedOutputTokens: number;
        costNanoUsd: number;
        costUsd: string;
      }
    | {
        kind: 'unknown';
        reason: 'transport-error' | 'missing-usage' | 'invalid-usage';
        httpStatus?: number;
        /** True only after invoking the HTTP transport, not merely reserving its cost. */
        transportStarted?: boolean;
      }
  );
type ProviderFetch = NonNullable<NonNullable<Parameters<typeof createGoogleGenerativeAI>[0]>['fetch']>;
export type NativeModelOptions = {
  apiKey: string;
  /** Only the reviewed model/tariff is accepted. Other tariffs require an explicit code change. */
  modelId?: string;
  /** Hooks must use bounded storage operations. They are awaited to completion, including on Stop. */
  beforeDispatch: (attempt: AnalystModelAttempt) => Promise<void>;
  afterResponse: (receipt: AnalystModelReceipt) => Promise<void>;
  fetch?: ProviderFetch;
};

function parseUsage(value: unknown) {
  const raw = object(value);
  if (!raw || !count(raw.promptTokenCount) || !count(raw.totalTokenCount)) return undefined;
  const usage: AnalystGoogleUsage = {
    promptTokenCount: raw.promptTokenCount,
    totalTokenCount: raw.totalTokenCount,
  };
  for (const field of [
    'candidatesTokenCount',
    'thoughtsTokenCount',
    'toolUsePromptTokenCount',
    'cachedContentTokenCount',
  ] as const) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (!count(value)) return undefined;
    usage[field] = value;
  }
  const inputTokens = usage.promptTokenCount + (usage.toolUsePromptTokenCount ?? 0);
  const declaredOutput = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  const outputTokens = usage.totalTokenCount - inputTokens;
  if (
    !count(inputTokens) ||
    !count(declaredOutput) ||
    !count(outputTokens) ||
    declaredOutput > outputTokens ||
    (usage.cachedContentTokenCount ?? 0) > inputTokens
  )
    return undefined;
  const priced = cost(inputTokens, outputTokens);
  if (!priced) return undefined;
  return {
    usage,
    inputTokens,
    outputTokens,
    unclassifiedOutputTokens: outputTokens - declaredOutput,
    costNanoUsd: priced.nanoUsd,
    costUsd: priced.usd,
  };
}

/** Stop waiting on callbacks/transport after cancellation; durable reservations are never refunded here. */
async function abortable<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  // Consume a late rejection even if the signal was already aborted on entry.
  void work.catch(() => undefined);
  if (!signal) return work;
  if (signal.aborted) throw signal.reason ?? new Error('aborted');
  let abort: () => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([work, stopped]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function validateBody(
  bodyText: string,
  modelId: string,
  input: Parameters<ProviderFetch>[0],
  init: Parameters<ProviderFetch>[1],
) {
  if (Buffer.byteLength(bodyText) > ANALYST_MODEL_LIMITS.requestBytes) fail('ANALYST_MODEL_INPUT');
  let url: URL, body: Record<string, unknown> | undefined;
  try {
    url = new URL(String(input));
    body = object(JSON.parse(bodyText));
  } catch {
    return fail('ANALYST_MODEL_INPUT');
  }
  const config = object(body?.generationConfig);
  if (
    url.origin !== 'https://generativelanguage.googleapis.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.pathname !== `/v1beta/models/${modelId}:generateContent` ||
    init?.method !== 'POST' ||
    !body ||
    config?.maxOutputTokens !== ANALYST_MODEL_LIMITS.outputTokens ||
    (body.model !== undefined && body.model !== modelId) ||
    body.cachedContent !== undefined ||
    (config.responseModalities !== undefined && JSON.stringify(config.responseModalities) !== '["TEXT"]')
  )
    fail('ANALYST_MODEL_INPUT');
  // The byte-based allowance is for text/function messages. Files, cached prompts,
  // provider search and other externally expanded context need separate pricing.
  const messages = [
    ...(Array.isArray(body.contents) ? body.contents : []),
    ...(body.systemInstruction === undefined ? [] : [body.systemInstruction]),
  ];
  if (!Array.isArray(body.contents) || !messages.length) fail('ANALYST_MODEL_INPUT');
  for (const message of messages) {
    const parts = object(message)?.parts;
    if (!Array.isArray(parts)) fail('ANALYST_MODEL_INPUT');
    for (const part of parts) {
      const p = object(part);
      if (
        !p ||
        Object.keys(p).some(
          (key) => !['text', 'functionCall', 'functionResponse', 'thought', 'thoughtSignature'].includes(key),
        ) ||
        (p.text !== undefined && typeof p.text !== 'string') ||
        object(p.functionResponse)?.parts !== undefined
      )
        fail('ANALYST_MODEL_INPUT');
    }
  }
  if (
    body.tools !== undefined &&
    (!Array.isArray(body.tools) ||
      body.tools.some((tool) => {
        const value = object(tool);
        return (
          !value ||
          Object.keys(value).some((key) => key !== 'functionDeclarations') ||
          !Array.isArray(value.functionDeclarations)
        );
      }))
  )
    fail('ANALYST_MODEL_INPUT');
  if (
    body.continuationToken !== undefined &&
    (typeof body.continuationToken !== 'string' || !body.continuationToken)
  )
    fail('ANALYST_MODEL_INPUT');
  return body;
}

/** Direct Google provider. Construction makes no network calls and reads no environment keys. */
export function createNativeModel(options: NativeModelOptions): LanguageModel {
  const modelId = options.modelId ?? ANALYST_MODEL_LIMITS.modelId;
  if (
    typeof options.apiKey !== 'string' ||
    !options.apiKey.trim() ||
    modelId !== ANALYST_MODEL_LIMITS.modelId ||
    typeof options.beforeDispatch !== 'function' ||
    typeof options.afterResponse !== 'function'
  )
    fail('ANALYST_MODEL_CONFIG');
  const transport: ProviderFetch = options.fetch ?? globalThis.fetch;
  const continuations = new Map<string, { carryTokens: number; baseRequestHash: string }>();
  const accountedFetch: ProviderFetch = async (input, init) => {
    if (typeof init?.body !== 'string') fail('ANALYST_MODEL_INPUT');
    const bodyText = init.body as string;
    const body = validateBody(bodyText, modelId, input, init);
    const continuation = typeof body.continuationToken === 'string' ? body.continuationToken : undefined;
    const { continuationToken: _token, ...baseBody } = body;
    const baseRequestHash = createHash('sha256').update(JSON.stringify(baseBody)).digest('hex');
    const resumed = continuation ? continuations.get(continuation) : undefined;
    if (continuation && (!resumed || resumed.baseRequestHash !== baseRequestHash))
      fail('ANALYST_MODEL_INPUT');
    const continuationCarryTokens = resumed?.carryTokens ?? 0;
    if (continuation) continuations.delete(continuation);
    const requestBytes = Buffer.byteLength(bodyText);
    const inputTokenReservation = requestBytes + 2048 + continuationCarryTokens;
    const priced = cost(inputTokenReservation, ANALYST_MODEL_LIMITS.outputTokens);
    if (!priced) fail('ANALYST_MODEL_INPUT');
    const attempt: AnalystModelAttempt = {
      attemptId: randomUUID(),
      modelId,
      requestBytes,
      requestSha256: createHash('sha256').update(bodyText).digest('hex'),
      continuationCarryTokens,
      inputTokenReservation,
      outputTokenReservation: ANALYST_MODEL_LIMITS.outputTokens,
      reservationNanoUsd: priced!.nanoUsd,
      reservationUsd: priced!.usd,
    };
    init?.signal?.throwIfAborted();
    try {
      await options.beforeDispatch(attempt);
    } catch {
      if (init?.signal?.aborted) throw init.signal.reason;
      return fail('ANALYST_MODEL_BUDGET');
    }
    const record = async (receipt: AnalystModelReceipt) => {
      // Await this callback even after Stop so the caller still owns its lease.
      // Hook writes must be bounded, idempotent and cannot revive stopped chat.
      try {
        await options.afterResponse(receipt);
      } catch {
        fail('ANALYST_MODEL_ACCOUNTING');
      }
    };
    let response: Response;
    let transportStarted = false;
    try {
      init?.signal?.throwIfAborted();
      // The real fetch obeys init.signal. If a transport returns a received
      // response during cancellation, finish its accounting before returning.
      transportStarted = true;
      response = await transport(input, init);
    } catch {
      await record({ ...attempt, kind: 'unknown', reason: 'transport-error', transportStarted });
      if (init?.signal?.aborted) throw init.signal.reason;
      return fail('ANALYST_MODEL_PROVIDER');
    }
    let payload: Record<string, unknown> | undefined;
    try {
      payload = object(
        await abortable(response.clone().json(), AbortSignal.timeout(ANALYST_MODEL_LIMITS.accountingMs)),
      );
    } catch {
      /* Keep an unknown charge when the response cannot be read. */
    }
    const usage = parseUsage(payload?.usageMetadata);
    await record(
      usage
        ? { ...attempt, kind: 'known', httpStatus: response.status, ...usage }
        : {
            ...attempt,
            kind: 'unknown',
            reason: payload?.usageMetadata == null ? 'missing-usage' : 'invalid-usage',
            httpStatus: response.status,
          },
    );
    if (
      usage &&
      (usage.inputTokens > inputTokenReservation || usage.outputTokens > ANALYST_MODEL_LIMITS.outputTokens)
    )
      fail('ANALYST_MODEL_PROVIDER');
    const candidate = Array.isArray(payload?.candidates) ? object(payload!.candidates[0]) : undefined;
    if (candidate?.finishReason === 'CONTINUATION' && typeof candidate.continuationToken === 'string') {
      if (continuations.size >= 64) fail('ANALYST_MODEL_INPUT');
      continuations.set(candidate.continuationToken, {
        carryTokens: continuationCarryTokens + ANALYST_MODEL_LIMITS.outputTokens,
        baseRequestHash,
      });
    }
    return response;
  };
  return createGoogleGenerativeAI({ apiKey: options.apiKey, fetch: accountedFetch })(modelId);
}

export type AnalystStepUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};
export type AnalystStepResult = {
  text: string;
  finishReason: FinishReason;
  responseMessages: ModelMessage[];
  usage: AnalystStepUsage;
  toolCalls: { toolCallId: string; toolName: string; input: unknown; invalid: boolean }[];
  toolResults: { toolCallId: string; toolName: string; kind: 'result' | 'error' }[];
};

/** One generation plus sequential local tools. Caller owns durable history, leases and turn limits. */
export async function executeAnalystStep(input: {
  model: LanguageModel;
  tools: ToolSet;
  messages: ModelMessage[];
  instructions: string;
  signal?: AbortSignal;
  /** May shorten the deadline, never extend the40-second maximum. */
  timeoutMs?: number;
}): Promise<AnalystStepResult> {
  const timeoutMs = input.timeoutMs ?? ANALYST_MODEL_LIMITS.timeoutMs;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > ANALYST_MODEL_LIMITS.timeoutMs ||
    !Array.isArray(input.messages) ||
    !input.messages.length ||
    typeof input.instructions !== 'string'
  )
    fail('ANALYST_MODEL_INPUT');
  if (input.signal?.aborted) fail('ANALYST_MODEL_CANCELLED');
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  // Avoid SDK prompt conversion downloading external media before the metered Google fetch.
  for (const message of input.messages) {
    if (Array.isArray(message.content))
      for (const part of message.content) {
        if (
          ['image', 'file', 'reasoning-file'].includes(part.type) ||
          (part.type === 'tool-result' && object(part.output)?.type === 'content')
        )
          fail('ANALYST_MODEL_INPUT');
      }
  }
  try {
    const agent = new ToolLoopAgent({
      model: input.model,
      tools: input.tools,
      instructions: input.instructions,
      stopWhen: isStepCount(1),
      toolCallConcurrency: 1,
      maxRetries: 0,
      maxOutputTokens: ANALYST_MODEL_LIMITS.outputTokens,
      timeout: timeoutMs,
    });
    const result = await agent.generate({ messages: input.messages, abortSignal: signal });
    if (input.signal?.aborted) return fail('ANALYST_MODEL_CANCELLED');
    if (deadline.aborted) return fail('ANALYST_MODEL_TIMEOUT');
    const safeCount = (value: unknown) => (count(value) ? value : undefined);
    return {
      text: result.text,
      finishReason: result.finishReason,
      responseMessages: result.responseMessages,
      usage: {
        inputTokens: safeCount(result.usage.inputTokens),
        outputTokens: safeCount(result.usage.outputTokens),
        totalTokens: safeCount(result.usage.totalTokens),
        reasoningTokens: safeCount(result.usage.outputTokenDetails.reasoningTokens),
        cachedInputTokens: safeCount(result.usage.inputTokenDetails.cacheReadTokens),
      },
      toolCalls: result.toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        invalid: call.invalid === true,
      })),
      toolResults: result.responseMessages.flatMap((message) =>
        message.role === 'tool'
          ? message.content.flatMap((part) =>
              part.type === 'tool-result'
                ? [
                    {
                      toolCallId: part.toolCallId,
                      toolName: part.toolName,
                      kind:
                        part.output.type === 'error-text' || part.output.type === 'error-json'
                          ? ('error' as const)
                          : ('result' as const),
                    },
                  ]
                : [],
            )
          : [],
      ),
    };
  } catch (error) {
    if (input.signal?.aborted) return fail('ANALYST_MODEL_CANCELLED');
    // A slow accounting/admission callback is not a retryable transport timeout.
    // Preserve that known safe cause even if the inference deadline also elapsed.
    if (error instanceof AnalystModelError && error.code !== 'ANALYST_MODEL_PROVIDER') throw error;
    if (deadline.aborted) return fail('ANALYST_MODEL_TIMEOUT');
    if (error instanceof AnalystModelError) throw error;
    return fail('ANALYST_MODEL_PROVIDER');
  }
}
