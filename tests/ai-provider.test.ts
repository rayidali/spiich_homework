import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const openai = vi.hoisted(() => ({ parse: vi.fn(), create: vi.fn(), options: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    static APIError = class extends Error {};
    constructor(options: unknown) {
      openai.options(options);
    }
    responses = openai;
  },
}));

import { config } from '../server/config';
import {
  generateProposal,
  chooseFinancialTool,
  getAiUsage,
  resetAiUsage,
  setAiBudget,
  type FinancialTool,
} from '../server/ai-provider';

const saved = { aiProvider: config.aiProvider, aiKey: config.aiKey, aiModel: config.aiModel };
const fetchMock = vi.fn();
const schema = z.strictObject({ amount: z.string(), action: z.enum(['READY', 'CLARIFY']) });
const input = [{ role: 'user' as const, content: 'Paid $25 rent from checking.' }];
const tool: FinancialTool = {
  type: 'function',
  name: 'cash_position',
  description: 'Read cash balances.',
  strict: true,
  parameters: {
    type: 'object',
    properties: { asOf: { type: 'string' } },
    required: ['asOf'],
    additionalProperties: false,
  },
};
function gemini(parts: unknown[], finishReason = 'STOP') {
  return {
    candidates: [{ finishReason, content: { role: 'model', parts } }],
    modelVersion: 'gemini-contract-version',
    usageMetadata: {
      promptTokenCount: 120,
      candidatesTokenCount: 30,
      thoughtsTokenCount: 10,
      totalTokenCount: 160,
    },
  };
}
function response(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', fetchMock);
  config.aiProvider = 'gemini';
  config.aiModel = 'gemini-3.8-flash';
  config.aiKey = 'contract-key-never-sent';
  setAiBudget(null);
  resetAiUsage();
});
afterEach(() => {
  Object.assign(config, saved);
  setAiBudget(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Gemini transport and response contract (no live calls)', () => {
  it('sends a JSON schema, maps conversation roles and keeps the key out of the URL', async () => {
    response(gemini([{ text: JSON.stringify({ amount: '25.00', action: 'READY' }) }]));
    const result = await generateProposal(schema, 'Prepare only drafts.', [
      ...input,
      { role: 'assistant', content: 'Which account?' },
      { role: 'user', content: 'Checking.' },
    ]);
    expect(result.data).toEqual({ amount: '25.00', action: 'READY' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(url).not.toContain(config.aiKey);
    expect(options.headers['x-goog-api-key']).toBe(config.aiKey);
    const body = JSON.parse(options.body);
    expect(body.contents.map((m: { role: string }) => m.role)).toEqual(['user', 'model', 'user']);
    expect(body.generationConfig.responseFormat.text.schema.additionalProperties).toBe(false);
    expect(body.generationConfig.responseFormat.text.mimeType).toBe('APPLICATION_JSON');
    expect(body.generationConfig.maxOutputTokens).toBe(4000);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(result.ai).toMatchObject({
      provider: 'gemini',
      modelVersion: 'gemini-contract-version',
      usage: { inputTokens: 120, outputTokens: 30, thinkingTokens: 10, totalTokens: 160 },
    });
    expect(getAiUsage()).toEqual({
      attempts: 1,
      inputTokens: 120,
      outputTokens: 30,
      thinkingTokens: 10,
      totalTokens: 160,
      unreportedUsage: 0,
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('preserves a structured clarification without performing a second model call', async () => {
    response(gemini([{ text: '{"amount":"","action":"CLARIFY"}' }]));
    expect((await generateProposal(schema, 'Clarify missing facts.', input)).data.action).toBe('CLARIFY');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes proposal literals on the Gemini wire and retains strict local rejection', async () => {
    const literal = z.strictObject({ action: z.literal('READY') });
    response(gemini([{ text: '{"action":"READY"}' }]));
    expect((await generateProposal(literal, 'Drafts only.', input)).data).toEqual({ action: 'READY' });
    const wire = JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.responseFormat.text.schema;
    expect(wire.properties.action).toEqual({ type: 'string', enum: ['READY'] });
    response(gemini([{ text: '{"action":"POST"}' }]));
    await expect(generateProposal(literal, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('omits array maxima from Gemini grammar while preserving the structured shape', async () => {
    const bounded = z.strictObject({
      lines: z.array(z.strictObject({ memo: z.string() })).max(100),
      maxItems: z.string(),
    });
    response(gemini([{ text: JSON.stringify({ lines: [{ memo: 'rent' }], maxItems: 'field name' }) }]));
    await generateProposal(bounded, 'Prepare a draft.', input);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.responseFormat.text.schema;
    expect(sent.properties.lines.maxItems).toBeUndefined();
    expect(sent.properties.lines.items.additionalProperties).toBe(false);
    expect(sent.properties.maxItems.type).toBe('string');
    expect(sent.required).toEqual(['lines', 'maxItems']);
  });

  it('still rejects responses exceeding the original array maximum locally', async () => {
    const bounded = z.strictObject({ lines: z.array(z.strictObject({ memo: z.string() })).max(100) });
    response(
      gemini([{ text: JSON.stringify({ lines: Array.from({ length: 101 }, () => ({ memo: 'x' })) }) }]),
    );
    await expect(generateProposal(bounded, 'Prepare a draft.', input)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid JSON', '{bad json'],
    ['wrong monetary type', '{"amount":25,"action":"READY"}'],
    ['unexpected field', '{"amount":"25","action":"READY","post":true}'],
  ])('rejects %s from a successful HTTP response', async (_name, text) => {
    response(gemini([{ text }]));
    await expect(generateProposal(schema, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects truncation even if the returned fragment happens to be valid JSON', async () => {
    response(gemini([{ text: '{"amount":"25","action":"READY"}' }], 'MAX_TOKENS'));
    await expect(generateProposal(schema, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
    expect(getAiUsage().totalTokens).toBe(160);
  });

  it('rejects blocked responses without attempting to remove the provider restriction', async () => {
    response({ promptFeedback: { blockReason: 'SAFETY' } });
    await expect(generateProposal(schema, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requests an allowlisted function and returns only the selected call', async () => {
    response(gemini([{ functionCall: { name: 'cash_position', args: { asOf: '2026-03-31' } } }]));
    const result = await chooseFinancialTool([tool], 'Choose one read-only query.', input);
    expect(result.call).toEqual({ name: 'cash_position', args: { asOf: '2026-03-31' } });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.toolConfig.functionCallingConfig).toEqual({
      mode: 'ANY',
      allowedFunctionNames: ['cash_position'],
    });
    expect(body.tools[0].functionDeclarations[0].parametersJsonSchema.additionalProperties).toBe(false);
    expect(body.generationConfig.maxOutputTokens).toBe(4000);
  });

  it('rejects an invented SQL tool', async () => {
    response(
      gemini([{ functionCall: { name: 'execute_sql', args: { sql: 'DELETE FROM journal_entries' } } }]),
    );
    await expect(chooseFinancialTool([tool], 'Read only.', input)).rejects.toMatchObject({
      code: 'UNSUPPORTED_TOOL',
    });
  });

  it('rejects multiple tool calls instead of silently choosing the first', async () => {
    response(
      gemini([
        { functionCall: { name: 'cash_position', args: { asOf: '2026-03-31' } } },
        { functionCall: { name: 'cash_position', args: { asOf: '2025-03-31' } } },
      ]),
    );
    await expect(chooseFinancialTool([tool], 'Choose one query.', input)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
  });

  it.each([
    [400, 'AI_REQUEST_REJECTED'],
    [401, 'AI_AUTH_ERROR'],
    [403, 'AI_AUTH_ERROR'],
    [404, 'AI_MODEL_UNAVAILABLE'],
    [429, 'AI_RATE_LIMIT'],
    [500, 'AI_SERVICE_UNAVAILABLE'],
    [502, 'AI_SERVICE_UNAVAILABLE'],
    [503, 'AI_SERVICE_UNAVAILABLE'],
    [504, 'AI_SERVICE_UNAVAILABLE'],
  ])('maps HTTP %s to a sanitized error without retrying', async (status, code) => {
    response({ error: { message: 'provider payload containing sensitive request details' } }, Number(status));
    const error = await generateProposal(schema, 'Drafts only.', input).catch((e: unknown) => e);
    expect(error).toMatchObject({ code });
    expect(error).toHaveProperty('details', undefined);
    if (Number(status) >= 500) expect(error).toHaveProperty('status', 503);
    expect(String(error)).not.toContain('sensitive request details');
    expect(console.error).toHaveBeenCalledTimes(1);
    const diagnostic = JSON.parse(vi.mocked(console.error).mock.calls[0][0]);
    expect(diagnostic).toEqual({
      event: 'ai_provider_failure',
      timestamp: expect.any(String),
      deploymentRevision: expect.any(String),
      provider: 'gemini',
      model: config.aiModel,
      operation: 'proposal',
      code,
      stage: 'provider_http',
      status: (error as { status: number }).status,
      failureClass: 'http',
      upstreamStatus: Number(status),
      durationMs: expect.any(Number),
    });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    for (const secret of [config.aiKey, 'sensitive request details', 'Drafts only.', input[0].content])
      expect(logged).not.toContain(secret);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAiUsage().attempts).toBe(1);
    expect(getAiUsage().unreportedUsage).toBe(1);
  });

  it('turns a timeout into a recoverable error without a hidden retry', async () => {
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'TimeoutError'));
    await expect(generateProposal(schema, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_TIMEOUT',
      status: 504,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toMatchObject({
      code: 'AI_TIMEOUT',
      failureClass: 'timeout',
      upstreamStatus: null,
    });
  });

  it('separates a fetch failure from an HTTP service failure without leaking its cause', async () => {
    fetchMock.mockRejectedValue(
      new TypeError('fetch failed with private request contents', {
        cause: { code: 'ENOTFOUND', message: 'private hostname and key', address: config.aiKey },
      }),
    );
    await expect(generateProposal(schema, 'Private instructions.', input)).rejects.toMatchObject({
      status: 502,
      code: 'AI_CONNECTION_ERROR',
      details: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toMatchObject({
      failureClass: 'transport',
      upstreamStatus: null,
      transportCode: 'ENOTFOUND',
    });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    for (const secret of [config.aiKey, 'private', 'Private instructions.', input[0].content])
      expect(logged).not.toContain(secret);
    expect(getAiUsage()).toMatchObject({ attempts: 1, unreportedUsage: 1 });
  });

  it('omits unknown transport cause codes instead of logging arbitrary provider content', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause: { code: config.aiKey } }));
    await expect(generateProposal(schema, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_CONNECTION_ERROR',
    });
    const diagnostic = JSON.parse(vi.mocked(console.error).mock.calls[0][0]);
    expect(diagnostic).not.toHaveProperty('transportCode');
    expect(JSON.stringify(diagnostic)).not.toContain(config.aiKey);
  });

  it('does not misclassify a local request-building TypeError as a network failure', async () => {
    const messages = [{ ...input[0] }];
    Object.defineProperty(messages[0], 'content', {
      get() {
        throw new TypeError('local serialization bug');
      },
    });
    await expect(generateProposal(schema, 'Drafts only.', messages)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toMatchObject({
      event: 'ai_request_failed',
      stage: 'internal',
    });
  });

  it('does not misclassify response-processing TypeErrors as fetch failures', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new TypeError('local response processing failed');
      },
    });
    await expect(generateProposal(schema, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toMatchObject({
      event: 'ai_request_failed',
      stage: 'model_response',
    });
  });

  it('identifies financial-tool service failures without logging tool arguments', async () => {
    response({ error: { message: 'private contents' } }, 503);
    await expect(chooseFinancialTool([tool], 'Private instructions.', input)).rejects.toMatchObject({
      code: 'AI_SERVICE_UNAVAILABLE',
    });
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toMatchObject({
      operation: 'financial_tool',
      upstreamStatus: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the HTTP failure if discarding the provider body also fails', async () => {
    const json = vi.fn();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      body: { cancel: async () => Promise.reject(new TypeError('private cleanup details')) },
      json,
    });
    await expect(generateProposal(schema, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_SERVICE_UNAVAILABLE',
    });
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toMatchObject({
      failureClass: 'http',
      upstreamStatus: 503,
    });
    expect(json).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retains unknown-usage budget blocking after a service failure', async () => {
    setAiBudget({ maxAttempts: 10, maxTotalTokens: 10000 });
    response({ error: { message: 'temporarily unavailable' } }, 503);
    await expect(generateProposal(schema, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_SERVICE_UNAVAILABLE',
    });
    await expect(generateProposal(schema, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_USAGE_UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAiUsage()).toMatchObject({ attempts: 1, unreportedUsage: 1 });
  });

  it('does not attempt a provider call without a key', async () => {
    config.aiKey = '';
    await expect(generateProposal(schema, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAiUsage().attempts).toBe(0);
  });

  it.each([
    { maxAttempts: 1, maxTotalTokens: 10000 },
    { maxAttempts: 10, maxTotalTokens: 150 },
  ])('stops subsequent requests when the configured budget is exhausted (%j)', async (limit) => {
    setAiBudget(limit);
    response(gemini([{ text: '{"amount":"25","action":"READY"}' }]));
    await generateProposal(schema, 'Drafts only.', input);
    await expect(generateProposal(schema, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_BUDGET_EXCEEDED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Bounded evaluation with missing usage', () => {
  it('stops if a successful response omits usage metadata', async () => {
    setAiBudget({ maxAttempts: 10, maxTotalTokens: 10000 });
    response({
      candidates: [
        { finishReason: 'STOP', content: { parts: [{ text: '{"amount":"25","action":"READY"}' }] } },
      ],
    });
    await generateProposal(schema, 'Drafts only.', input);
    expect(getAiUsage().unreportedUsage).toBe(1);
    await expect(generateProposal(schema, 'Drafts only.', input)).rejects.toMatchObject({
      code: 'AI_USAGE_UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAI compatibility behind the same boundary', () => {
  it('keeps structured parsing and disables automatic retries', async () => {
    config.aiProvider = 'openai';
    config.aiModel = 'gpt-6-luna';
    openai.parse.mockResolvedValue({
      output_parsed: { amount: '25', action: 'READY' },
      model: 'openai-contract-version',
      usage: {
        input_tokens: 100,
        output_tokens: 30,
        output_tokens_details: { reasoning_tokens: 10 },
        total_tokens: 130,
      },
    });
    const result = await generateProposal(schema, 'Drafts only.', input);
    expect(result.data.amount).toBe('25');
    expect(openai.options).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, timeout: 25000 }));
    expect(openai.parse.mock.calls[0][0].store).toBe(false);
    expect(result.ai.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      thinkingTokens: 10,
      totalTokens: 130,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
