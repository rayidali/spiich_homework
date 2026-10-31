import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, asUiError, write } from '../web/src/api';

const reference = 'd11d5de3-9d91-4979-a54d-95ac0c3fe7af';
const otherReference = 'd11d5de3-9d91-4979-a54d-95ac0c3fe7ae';
afterEach(() => vi.unstubAllGlobals());

function response(body: unknown, status = 503, headers: Record<string, string> = {}) {
  const fetch = vi.fn(async () => Response.json(body, { status, headers }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('Browser API error references and recovery', () => {
  it('keeps the server reference through the error shown by the interface', async () => {
    response({
      error: {
        code: 'AI_SERVICE_UNAVAILABLE',
        message: 'The AI service is temporarily unavailable.',
        requestId: reference,
      },
    });
    const error = await api('/ai/entry').catch((error) => error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'AI_SERVICE_UNAVAILABLE', status: 503, requestId: reference });
    expect(asUiError(error)).toEqual({
      message: 'The AI service is temporarily unavailable.',
      requestId: reference,
    });
  });

  it('uses the response header as the canonical reference and preserves it for non-JSON failures', async () => {
    response({ error: { code: 'INTERNAL_ERROR', message: 'Try again.', requestId: otherReference } }, 500, {
      'X-Request-Id': reference,
    });
    await expect(api('/entries')).rejects.toMatchObject({ requestId: reference });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>PRIVATE_PROXY_TEXT</html>', {
            status: 502,
            headers: { 'X-Request-Id': reference },
          }),
      ),
    );
    const error = await api('/entries').catch((error) => error);
    expect(error).toMatchObject({ code: 'HTTP_ERROR', status: 502, requestId: reference });
    expect((error as ApiError).message).not.toContain('PRIVATE_PROXY_TEXT');
  });

  it('distinguishes connection failure and never silently retries a write', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('PRIVATE_TRANSPORT_DETAIL');
    });
    vi.stubGlobal('fetch', fetch);
    const error = await write(
      '/entries',
      { description: 'A reviewed entry' },
      'POST',
      'test-idempotency-key',
    ).catch((error) => error);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: 0, requestId: undefined });
    expect((error as ApiError).message).not.toContain('PRIVATE_TRANSPORT_DETAIL');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toBeInstanceOf(Headers);
  });

  it('does not turn an intentionally aborted resource load into a user-facing connection error', async () => {
    const controller = new AbortController();
    const abort = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        throw abort;
      }),
    );
    await expect(api('/entries', { signal: controller.signal })).rejects.toBe(abort);
  });

  it('does not display malformed error fields or invented diagnostic references', async () => {
    response(
      {
        error: {
          code: { secret: 'PRIVATE' },
          message: { private: 'PRIVATE' },
          requestId: 'PRIVATE_REFERENCE_TEXT',
        },
      },
      500,
      { 'X-Request-Id': 'PRIVATE_HEADER_TEXT' },
    );
    const error = await api('/entries').catch((error) => error);
    expect(error).toMatchObject({ code: 'HTTP_ERROR', status: 500, requestId: undefined });
    expect(JSON.stringify(asUiError(error))).not.toContain('PRIVATE');
  });

  it('preserves an error reference when a nominally successful response is truncated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"broken":', { status: 200, headers: { 'X-Request-Id': reference } })),
    );
    await expect(api('/entries')).rejects.toMatchObject({
      code: 'INVALID_SERVER_RESPONSE',
      requestId: reference,
    });
  });

  it('preserves caller headers and handles no-content success without parsing JSON', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      api('/accounts/example', {
        method: 'DELETE',
        headers: new Headers({ 'Idempotency-Key': 'reviewed-key' }),
      }),
    ).resolves.toBeUndefined();
    const headers = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Headers;
    expect(headers.get('Idempotency-Key')).toBe('reviewed-key');
    expect(headers.get('Content-Type')).toBe('application/json');
  });
});
