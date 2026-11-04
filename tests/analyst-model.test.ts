import { describe, expect, it, vi } from 'vitest';
import { generateText, tool, type ModelMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { APICallError, type LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { z } from 'zod';
import {
  ANALYST_MODEL_LIMITS,
  AnalystModelError,
  createNativeModel,
  executeAnalystStep,
  type AnalystModelAttempt,
  type AnalystModelReceipt,
  type NativeModelOptions,
} from '../server/analyst-model';

const messages: ModelMessage[] = [{ role: 'user', content: 'What changed in spending?' }];
const instructions = 'Use the supplied read-only books.';
const sdkUsage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 15, text: 10, reasoning: 5 },
};
const response = (
  content: LanguageModelV4GenerateResult['content'],
  finish: 'stop' | 'tool-calls' = 'stop',
): LanguageModelV4GenerateResult => ({
  content,
  finishReason: { unified: finish, raw: finish },
  usage: sdkUsage,
  warnings: [],
});
const usage = {
  promptTokenCount: 100,
  candidatesTokenCount: 10,
  thoughtsTokenCount: 5,
  totalTokenCount: 115,
  cachedContentTokenCount: 50,
};
function googleReply(options: { usage?: unknown; finishReason?: string; continuationToken?: string } = {}) {
  return Response.json({
    candidates: [
      {
        content: { role: 'model', parts: [{ text: 'Checked answer.' }] },
        finishReason: options.finishReason ?? 'STOP',
        ...(options.continuationToken ? { continuationToken: options.continuationToken } : {}),
      },
    ],
    usageMetadata: Object.hasOwn(options, 'usage') ? options.usage : usage,
  });
}
function modelFixture(
  transport: NonNullable<NativeModelOptions['fetch']> = async () => googleReply(),
  overrides: Partial<NativeModelOptions> = {},
) {
  const attempts: AnalystModelAttempt[] = [],
    receipts: AnalystModelReceipt[] = [],
    order: string[] = [];
  const beforeDispatch = vi.fn(async (attempt: AnalystModelAttempt) => {
    order.push('reserve');
    attempts.push(attempt);
  });
  const afterResponse = vi.fn(async (receipt: AnalystModelReceipt) => {
    order.push('receipt');
    receipts.push(receipt);
  });
  const fetch = vi.fn(async (...args: Parameters<NonNullable<NativeModelOptions['fetch']>>) => {
    order.push('transport');
    return transport(...args);
  });
  const model = createNativeModel({
    apiKey: 'fictional-never-sent-key',
    beforeDispatch,
    afterResponse,
    fetch,
    ...overrides,
  });
  return { model, attempts, receipts, order, fetch, beforeDispatch, afterResponse };
}
const run = (model: Parameters<typeof executeAnalystStep>[0]['model']) =>
  executeAnalystStep({ model, tools: {}, messages, instructions });

describe('one-step native SDK execution', () => {
  it('returns full durable tool calls without executing tools that have no execute function', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: response(
        [
          {
            type: 'tool-call',
            toolCallId: 'q1',
            toolName: 'query',
            input: '{"sql":"SELECT 1"}',
            providerMetadata: { google: { thoughtSignature: 'signature-kept' } },
          },
        ],
        'tool-calls',
      ),
    });
    const result = await executeAnalystStep({
      model,
      messages,
      instructions,
      tools: { query: tool({ inputSchema: z.object({ sql: z.string() }) }) },
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].maxOutputTokens).toBe(ANALYST_MODEL_LIMITS.outputTokens);
    expect(result.toolCalls).toEqual([
      { toolCallId: 'q1', toolName: 'query', input: { sql: 'SELECT 1' }, invalid: false },
    ]);
    expect(result.toolResults).toEqual([]);
    expect(JSON.stringify(result.responseMessages)).toContain('signature-kept');
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 15,
      totalTokens: 115,
      reasoningTokens: 5,
      cachedInputTokens: 0,
    });
  });

  it('runs local tools sequentially and permits next-call continuation after a saved safe tool error', async () => {
    const events: string[] = [];
    let active = 0,
      peak = 0;
    const model = new MockLanguageModelV4({
      doGenerate: [
        response(
          [
            { type: 'tool-call', toolCallId: 'q1', toolName: 'query', input: '{"sql":"first"}' },
            { type: 'tool-call', toolCallId: 'q2', toolName: 'query', input: '{"sql":"second"}' },
          ],
          'tool-calls',
        ),
        response([{ type: 'text', text: 'The second query failed; I have not invented its result.' }]),
      ],
    });
    const tools = {
      query: tool({
        inputSchema: z.object({ sql: z.string() }),
        execute: async ({ sql }) => {
          active++;
          peak = Math.max(peak, active);
          events.push(`start:${sql}`);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active--;
          events.push(`end:${sql}`);
          if (sql === 'second') throw new Error('SAFE_QUERY_ERROR');
          return { amount: '12.35' };
        },
      }),
    };
    const first = await executeAnalystStep({ model, tools, messages, instructions });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(peak).toBe(1);
    expect(events).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
    expect(first.toolResults).toEqual([
      { toolCallId: 'q1', toolName: 'query', kind: 'result' },
      { toolCallId: 'q2', toolName: 'query', kind: 'error' },
    ]);
    const saved: ModelMessage[] = JSON.parse(JSON.stringify([...messages, ...first.responseMessages]));
    const second = await executeAnalystStep({ model, tools, messages: saved, instructions });
    expect(second.finishReason).toBe('stop');
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain('SAFE_QUERY_ERROR');
  });

  it('does not retry a retryable provider error or expose its raw URL, key, body or headers', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: 'secret-provider-error',
          url: 'https://provider.invalid?key=secret-key',
          requestBodyValues: { secret: true },
          statusCode: 429,
          responseHeaders: { authorization: 'secret-key' },
          responseBody: 'secret-body',
        });
      },
    });
    await expect(run(model)).rejects.toMatchObject({
      code: 'ANALYST_MODEL_PROVIDER',
      message: 'The AI provider could not complete this analyst step.',
    });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('passes the adapter deadline to the model transport and distinguishes user cancellation', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
        }),
    });
    await expect(
      executeAnalystStep({ model, tools: {}, messages, instructions, timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'ANALYST_MODEL_TIMEOUT' });
    const controller = new AbortController();
    controller.abort(new Error('private-cancel-reason'));
    await expect(
      executeAnalystStep({ model, tools: {}, messages, instructions, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ANALYST_MODEL_CANCELLED' });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('rejects externally expanded media before model conversion or provider dispatch', async () => {
    const f = modelFixture();
    await expect(
      executeAnalystStep({
        model: f.model,
        tools: {},
        instructions,
        messages: [
          { role: 'user', content: [{ type: 'image', image: new URL('https://private.invalid/image.png') }] },
        ],
      }),
    ).rejects.toMatchObject({ code: 'ANALYST_MODEL_INPUT' });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.attempts).toEqual([]);
  });
});

describe('Google HTTP reservations and usage', () => {
  it('awaits a reservation before dispatch, binds exact bytes and includes thinking without discounting cached input', async () => {
    const f = modelFixture();
    const result = await run(f.model);
    expect(f.order).toEqual(['reserve', 'transport', 'receipt']);
    const request = String(f.fetch.mock.calls[0][1]?.body);
    const attempt = f.attempts[0];
    expect(attempt.requestBytes).toBe(Buffer.byteLength(request));
    expect(attempt.requestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(attempt.continuationCarryTokens).toBe(0);
    expect(attempt.inputTokenReservation).toBe(attempt.requestBytes + 2048);
    expect(attempt.reservationNanoUsd).toBe((attempt.requestBytes + 2048) * 750 + 4096 * 3750);
    expect(f.receipts[0]).toMatchObject({
      kind: 'known',
      usage,
      inputTokens: 100,
      outputTokens: 15,
      costNanoUsd: 131250,
      costUsd: '0.000131250',
    });
    expect(result.usage.outputTokens).toBe(15);
    expect(result.usage.reasoningTokens).toBe(5);
    expect(JSON.stringify(result)).not.toContain('fictional-never-sent-key');
    expect(JSON.stringify(f.receipts)).not.toContain('fictional-never-sent-key');
  });

  it('blocks rejected reservations without dispatch or a fabricated usage receipt', async () => {
    const f = modelFixture(undefined, {
      beforeDispatch: async () => {
        throw new Error('secret-budget-storage-error');
      },
    });
    await expect(run(f.model)).rejects.toMatchObject({ code: 'ANALYST_MODEL_BUDGET' });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.afterResponse).not.toHaveBeenCalled();
  });

  it('bounds UTF8 bytes before reserving, and disallows model IDs with unreviewed prices', async () => {
    const f = modelFixture();
    await expect(
      executeAnalystStep({
        model: f.model,
        tools: {},
        instructions,
        messages: [{ role: 'user', content: '🎉'.repeat(60_000) }],
      }),
    ).rejects.toMatchObject({ code: 'ANALYST_MODEL_INPUT' });
    expect(f.beforeDispatch).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(() =>
      createNativeModel({
        apiKey: 'fake',
        modelId: 'gemini-4-argon',
        beforeDispatch: async () => {},
        afterResponse: async () => {},
      }),
    ).toThrow(AnalystModelError);
  });

  it('rejects changed max output and cached external context even through a direct SDK call', async () => {
    const f = modelFixture();
    await expect(
      generateText({ model: f.model, prompt: 'test', maxOutputTokens: 4095, maxRetries: 0 }),
    ).rejects.toMatchObject({ code: 'ANALYST_MODEL_INPUT' });
    await expect(
      generateText({
        model: f.model,
        prompt: 'test',
        maxOutputTokens: 4096,
        maxRetries: 0,
        providerOptions: { google: { cachedContent: 'cachedContents/unpriced' } },
      }),
    ).rejects.toMatchObject({ code: 'ANALYST_MODEL_INPUT' });
    expect(f.beforeDispatch).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined, 'missing-usage'],
    ['partial', { promptTokenCount: 100 }, 'invalid-usage'],
    ['negative', { ...usage, thoughtsTokenCount: -1 }, 'invalid-usage'],
    ['inconsistent', { ...usage, totalTokenCount: 100 }, 'invalid-usage'],
    ['oversized cached count', { ...usage, cachedContentTokenCount: 101 }, 'invalid-usage'],
  ])('retains the reservation for %s usage', async (_label, raw, reason) => {
    const f = modelFixture(async () => googleReply({ usage: raw }));
    await run(f.model);
    expect(f.receipts).toHaveLength(1);
    expect(f.receipts[0]).toMatchObject({
      kind: 'unknown',
      reason,
      reservationNanoUsd: f.attempts[0].reservationNanoUsd,
    });
    expect(f.receipts[0]).not.toHaveProperty('costNanoUsd');
  });

  it('prices unidentified residual tokens as output and adds tool-use prompt tokens to input', async () => {
    const f = modelFixture(async () =>
      googleReply({
        usage: {
          promptTokenCount: 100,
          toolUsePromptTokenCount: 2,
          candidatesTokenCount: 10,
          totalTokenCount: 120,
        },
      }),
    );
    await run(f.model);
    expect(f.receipts[0]).toMatchObject({
      kind: 'known',
      inputTokens: 102,
      outputTokens: 18,
      unclassifiedOutputTokens: 8,
      costNanoUsd: 144000,
    });
    expect((f.receipts[0] as { usage: object }).usage).not.toHaveProperty('thoughtsTokenCount');
  });

  it('keeps unknown transport or unreadable-response charges and returns only safe failures', async () => {
    const transport = modelFixture(async () => {
      throw new Error('secret-network-credential');
    });
    await expect(run(transport.model)).rejects.toMatchObject({ code: 'ANALYST_MODEL_PROVIDER' });
    expect(transport.receipts[0]).toMatchObject({ kind: 'unknown', reason: 'transport-error' });
    const malformed = modelFixture(async () => new Response('secret-provider-html', { status: 500 }));
    await expect(run(malformed.model)).rejects.toMatchObject({ code: 'ANALYST_MODEL_PROVIDER' });
    expect(malformed.receipts[0]).toMatchObject({ kind: 'unknown', reason: 'missing-usage' });
    expect(malformed.fetch).toHaveBeenCalledTimes(1);
  });

  it('retains the reservation if receipt storage fails after successful generation', async () => {
    const f = modelFixture(undefined, {
      afterResponse: async () => {
        throw new Error('private-db-receipt-error');
      },
    });
    await expect(run(f.model)).rejects.toMatchObject({ code: 'ANALYST_MODEL_ACCOUNTING' });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.beforeDispatch).toHaveBeenCalledTimes(1);
  });

  it('meters hidden continuation separately and reserves prior output as implicit input', async () => {
    let calls = 0;
    const f = modelFixture(async (_url, init) => {
      const current = calls++;
      if (current > 0) expect(JSON.parse(String(init?.body)).continuationToken).toBe(`next-${current}`);
      return googleReply(
        current < 2 ? { finishReason: 'CONTINUATION', continuationToken: `next-${current + 1}` } : {},
      );
    });
    await run(f.model);
    expect(f.fetch).toHaveBeenCalledTimes(3);
    expect(new Set(f.attempts.map((a) => a.attemptId)).size).toBe(3);
    expect(f.order).toEqual([
      'reserve',
      'transport',
      'receipt',
      'reserve',
      'transport',
      'receipt',
      'reserve',
      'transport',
      'receipt',
    ]);
    expect(f.attempts.map((a) => a.continuationCarryTokens)).toEqual([0, 4096, 8192]);
    for (const attempt of f.attempts)
      expect(attempt.reservationNanoUsd).toBe(
        (attempt.requestBytes + 2048 + attempt.continuationCarryTokens) * 750 + 4096 * 3750,
      );
  });

  it('stops a hidden continuation when its next reservation is denied', async () => {
    let attempts = 0;
    const f = modelFixture(
      async () => googleReply({ finishReason: 'CONTINUATION', continuationToken: 'next' }),
      {
        beforeDispatch: async () => {
          if (++attempts > 1) throw new Error('turn cap');
        },
      },
    );
    await expect(run(f.model)).rejects.toMatchObject({ code: 'ANALYST_MODEL_BUDGET' });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.afterResponse).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch after cancellation while a durable reservation hook is still pending', async () => {
    let finish: () => void = () => {};
    const f = modelFixture(undefined, {
      beforeDispatch: async () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    const pending = executeAnalystStep({ model: f.model, tools: {}, messages, instructions, timeoutMs: 10 });
    let settled = false;
    void pending.catch(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false); // The lease must stay held until its DB callback settles.
    finish();
    await expect(pending).rejects.toMatchObject({ code: 'ANALYST_MODEL_TIMEOUT' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('records a late known receipt after Stop without dispatching another continuation', async () => {
    let finish: (response: Response) => void = () => {};
    let started: () => void = () => {};
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    const f = modelFixture(async () => {
      started();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    const controller = new AbortController();
    const pending = executeAnalystStep({
      model: f.model,
      tools: {},
      messages,
      instructions,
      signal: controller.signal,
    });
    await dispatched;
    controller.abort(new Error('private-stop'));
    let settled = false;
    void pending.catch(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(settled).toBe(false);
    finish(googleReply({ finishReason: 'CONTINUATION', continuationToken: 'late-next' }));
    await expect(pending).rejects.toMatchObject({ code: 'ANALYST_MODEL_CANCELLED' });
    expect(f.receipts).toHaveLength(1);
    expect(f.receipts[0]).toMatchObject({ kind: 'known', costNanoUsd: 131250 });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it('records provider usage beyond its reserved output bound and then stops', async () => {
    const f = modelFixture(async () =>
      googleReply({
        usage: { promptTokenCount: 100, candidatesTokenCount: 5000, totalTokenCount: 5100 },
        finishReason: 'CONTINUATION',
        continuationToken: 'exceeded',
      }),
    );
    await expect(run(f.model)).rejects.toMatchObject({ code: 'ANALYST_MODEL_PROVIDER' });
    expect(f.receipts[0]).toMatchObject({ kind: 'known', outputTokens: 5000 });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});
