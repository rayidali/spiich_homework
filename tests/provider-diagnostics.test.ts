import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PROVIDER_ERROR_BYTES,
  parseProviderErrorDiagnostics,
  readProviderErrorDiagnostics,
  safeProviderErrorDiagnostics,
} from '../server/provider-diagnostics';

const privateText = 'PRIVATE_ACCOUNTING_PROMPT_DO_NOT_LOG';
const key = 'AIza' + 'x'.repeat(35);
const encode = (value: string) => new TextEncoder().encode(value);
const body = (message: unknown, status = 'INVALID_ARGUMENT', code: unknown = 400) =>
  JSON.stringify({ error: { message, status, code } });
const parse = (message: string) =>
  parseProviderErrorDiagnostics(body(message), { httpStatus: 400, apiKey: key });

afterEach(() => vi.useRealTimers());

describe('Provider error classification without provider prose', () => {
  it('identifies an explicit schema complexity report while excluding the provider message', () => {
    expect(parse('The specified schema produces a constraint that has too many states for serving.')).toEqual(
      {
        providerBodyState: 'parsed',
        providerStatus: 'INVALID_ARGUMENT',
        providerCode: 400,
        providerReason: 'schema_complexity',
      },
    );
  });

  it.each([
    ['The response schema is too complex.', 'schema_complexity'],
    ['Schema complexity limit reached.', 'schema_complexity'],
    ['Invalid function_declarations parameters.', 'schema_rejected'],
    ['Missing required argument.', 'invalid_argument'],
    ['Private prompt says quota exceeded.', 'invalid_argument'],
  ])('classifies a bounded HTTP 400 hint: %s', (message, reason) => {
    expect(parse(message).providerReason).toBe(reason);
  });

  it.each([
    [429, 'RESOURCE_EXHAUSTED', 'Quota exceeded for this project.', 'quota_exceeded'],
    [429, 'RESOURCE_EXHAUSTED', 'Too many requests.', 'rate_limited'],
    [429, 'RESOURCE_EXHAUSTED', privateText, 'rate_or_quota_limit'],
    [403, 'PERMISSION_DENIED', privateText, 'permission_denied'],
    [401, 'UNAUTHENTICATED', privateText, 'unauthenticated'],
    [404, 'NOT_FOUND', 'Model configured-model is not found.', 'model_not_found'],
    [404, 'NOT_FOUND', privateText, 'not_found'],
    [503, 'UNAVAILABLE', privateText, 'service_unavailable'],
  ])('retains compatible HTTP %s categories', (httpStatus, status, message, reason) => {
    expect(parseProviderErrorDiagnostics(body(message, status, httpStatus), { httpStatus })).toMatchObject({
      providerReason: reason,
      providerStatus: status,
      providerCode: httpStatus,
    });
  });

  it('recognizes allowlisted symbolic provider codes without retaining type, param or nested details', () => {
    const result = parseProviderErrorDiagnostics(
      JSON.stringify({
        error: {
          code: 'invalid_json_schema',
          type: privateText,
          param: privateText,
          message: privateText,
          details: [{ secret: key }],
        },
      }),
      { httpStatus: 400, apiKey: key },
    );
    expect(result).toEqual({
      providerReason: 'schema_rejected',
      providerBodyState: 'parsed',
      providerCode: 'invalid_json_schema',
    });
  });

  it('never returns keys, prompts, details, arbitrary codes, or status text', () => {
    const result = parseProviderErrorDiagnostics(body(`${key} ${privateText}`, key, privateText), {
      httpStatus: 400,
      apiKey: key,
    });
    expect(result).toEqual({ providerReason: 'invalid_argument', providerBodyState: 'parsed' });
    expect(JSON.stringify(result)).not.toContain(privateText);
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it('redacts the actual key before using provider text as a category hint', () => {
    expect(
      parseProviderErrorDiagnostics(body('schema too complex'), {
        httpStatus: 400,
        apiKey: 'schema too complex',
      }).providerReason,
    ).toBe('invalid_argument');
  });

  it.each([
    ['<html>private proxy error</html>', 'non_json'],
    ['{"error":', 'malformed_json'],
    ['{"error": {broken}}', 'malformed_json'],
    ['null', 'unexpected_shape'],
    ['[]', 'unexpected_shape'],
    ['{"error":"private text"}', 'unexpected_shape'],
    ['', 'empty'],
  ])('keeps malformed error body %j out of output', (raw, state) => {
    expect(parseProviderErrorDiagnostics(raw, { httpStatus: 429 })).toEqual({
      providerReason: 'rate_or_quota_limit',
      providerBodyState: state,
    });
  });

  it('bounds actual UTF-8 bytes and rejects invalid encoding', () => {
    expect(parseProviderErrorDiagnostics('€'.repeat(6000), { httpStatus: 400 }).providerBodyState).toBe(
      'too_large',
    );
    expect(
      parseProviderErrorDiagnostics(new Uint8Array([0xc3, 0x28]), { httpStatus: 400 }).providerBodyState,
    ).toBe('invalid_encoding');
  });

  it('does not throw or serialize message objects or arrays', () => {
    expect(parseProviderErrorDiagnostics(body({ prompt: privateText }), { httpStatus: 400 })).toEqual({
      providerReason: 'invalid_argument',
      providerBodyState: 'parsed',
      providerStatus: 'INVALID_ARGUMENT',
      providerCode: 400,
    });
  });

  it.each(['x-request-id', 'request-id', 'x-goog-request-id'])(
    'keeps a constrained ID from %s only',
    (header) => {
      const id = 'req_' + 'a'.repeat(32);
      const result = parseProviderErrorDiagnostics(body(privateText), {
        httpStatus: 400,
        headers: new Headers({ [header]: id, authorization: key }),
      });
      expect(result.providerRequestId).toBe(id);
    },
  );

  it.each([privateText, key, 'https://example.test/' + privateText, 'req_' + 'a'.repeat(100)])(
    'drops unsafe upstream request identifiers',
    (id) => {
      const result = parseProviderErrorDiagnostics(body(privateText), {
        httpStatus: 400,
        apiKey: key,
        headers: new Headers({ 'x-request-id': id }),
      });
      expect(result).not.toHaveProperty('providerRequestId');
    },
  );

  it('drops even a well-shaped ID if it equals the actual credential', () => {
    const id = 'req_' + 'b'.repeat(32);
    expect(
      parseProviderErrorDiagnostics(body(privateText), {
        httpStatus: 400,
        apiKey: id,
        headers: new Headers({ 'x-request-id': id }),
      }),
    ).not.toHaveProperty('providerRequestId');
  });

  it('revalidates logger fields and discards all extra/raw properties', () => {
    expect(
      safeProviderErrorDiagnostics({
        providerReason: 'invalid_argument',
        providerBodyState: 'parsed',
        providerStatus: privateText,
        providerCode: key,
        providerRequestId: key,
        message: privateText,
        raw: { secret: key },
      }),
    ).toEqual({ providerReason: 'invalid_argument', providerBodyState: 'parsed' });
    expect(safeProviderErrorDiagnostics({ providerReason: privateText, providerBodyState: 'parsed' })).toBe(
      undefined,
    );
    expect(safeProviderErrorDiagnostics(null)).toBe(undefined);
  });
});

describe('Bounded HTTP failure-body reader, synthetic streams only', () => {
  it('reads a JSON 400 and preserves safe metadata without logging', async () => {
    const spy = vi.spyOn(console, 'error');
    const result = await readProviderErrorDiagnostics(new Response(body(privateText), { status: 400 }), {
      apiKey: key,
    });
    expect(result.providerStatus).toBe('INVALID_ARGUMENT');
    expect(JSON.stringify(result)).not.toContain(privateText);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('cancels an advertised oversized body without reading it', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const result = await readProviderErrorDiagnostics(
      new Response(stream, {
        status: 400,
        headers: { 'content-length': String(MAX_PROVIDER_ERROR_BYTES + 1) },
      }),
    );
    expect(result.providerBodyState).toBe('too_large');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('enforces actual chunked bytes despite an incorrect content length', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_PROVIDER_ERROR_BYTES));
        controller.enqueue(encode('x'));
      },
      cancel,
    });
    const result = await readProviderErrorDiagnostics(
      new Response(stream, { status: 429, headers: { 'content-length': '1' } }),
    );
    expect(result).toEqual({ providerReason: 'rate_or_quota_limit', providerBodyState: 'too_large' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('handles a truncated stream without replacing the HTTP category or propagating its error', async () => {
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (reads++ === 0) controller.enqueue(encode('{"error":'));
        else controller.error(new Error(privateText + key));
      },
    });
    expect(await readProviderErrorDiagnostics(new Response(stream, { status: 400 }))).toEqual({
      providerReason: 'invalid_argument',
      providerBodyState: 'read_failed',
    });
  });

  it('retains split UTF-8 without leaking the decoded content', async () => {
    const bytes = encode(body('schema rejected: ' + '€' + privateText));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    expect((await readProviderErrorDiagnostics(new Response(stream, { status: 400 }))).providerReason).toBe(
      'schema_rejected',
    );
  });

  it('stops stalled bodies after one second, including a cancellation promise that never settles', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const promise = readProviderErrorDiagnostics(
      new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 503 }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual({
      providerReason: 'service_unavailable',
      providerBodyState: 'timeout',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('honors cancellation before and during body reads', async () => {
    const controller = new AbortController();
    const promise = readProviderErrorDiagnostics(
      new Response(new ReadableStream<Uint8Array>(), { status: 400 }),
      { signal: controller.signal },
    );
    controller.abort();
    expect((await promise).providerBodyState).toBe('aborted');
    expect(
      (
        await readProviderErrorDiagnostics(new Response(body(privateText), { status: 400 }), {
          signal: controller.signal,
        })
      ).providerBodyState,
    ).toBe('aborted');
  });

  it('handles absent and already consumed bodies', async () => {
    expect((await readProviderErrorDiagnostics(new Response(null, { status: 400 }))).providerBodyState).toBe(
      'empty',
    );
    const response = new Response(body(privateText), { status: 400 });
    await response.text();
    expect((await readProviderErrorDiagnostics(response)).providerBodyState).toBe('read_failed');
  });
});
