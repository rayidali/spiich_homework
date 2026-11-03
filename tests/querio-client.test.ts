import { describe, expect, it, vi } from 'vitest';
import { createQuerioClient, querioSettings, remoteId } from '../server/querio-client';
import { failureStage } from '../server/errors';

const settings = { key: 'TEST_PRIVATE_KEY', workspaceId: 'workspace-test', datasource: 'daybook-live' };
const mockFetch = (handler: (url: string, init: RequestInit) => Promise<Response>) =>
  vi.fn(handler) as unknown as typeof fetch;

describe('Querio resource transport (injected fetch only)', () => {
  it('uses the configured workspace and keeps the credential in headers', async () => {
    const fetcher = mockFetch(async () => Response.json({ id: 'saved-notebook' }));
    const request = createQuerioClient(settings, fetcher);
    await expect(request('POST', '/notebooks', { title: 'A question' })).resolves.toEqual({
      id: 'saved-notebook',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe('https://app.querio.ai/api/v3/notebooks');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      body: '{"title":"A question"}',
      headers: {
        Authorization: 'Bearer TEST_PRIVATE_KEY',
        'Querio-Workspace-Id': 'workspace-test',
        Accept: 'application/json',
      },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(String(url)).not.toContain(settings.key);
  });

  it.each([
    'https://attacker.invalid/path',
    '//attacker.invalid',
    '/runs/a/../secrets',
    '/runs/a%2Fb',
    '/runs/a?url=https://attacker.invalid',
    '/runs/a#fragment',
    '/runs/a\nHeader: value',
  ])('rejects a non-internal request path %j without contacting anything', async (path) => {
    const fetcher = mockFetch(async () => Response.json({}));
    await expect(createQuerioClient(settings, fetcher)('GET', path)).rejects.toThrow(
      'Invalid internal Querio request path',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts the bounded run-history path needed for uncertain submission recovery', async () => {
    const fetcher = mockFetch(async () => Response.json({ items: [] }));
    await expect(
      createQuerioClient(settings, fetcher)('GET', '/agent-sessions/saved-id/runs?limit=100'),
    ).resolves.toEqual({ items: [] });
  });

  it.each([401, 403, 429, 409, 500, 502])(
    'sanitizes HTTP %s without retrying or forwarding private provider bodies',
    async (status) => {
      const fetcher = mockFetch(
        async () => new Response('PRIVATE_PROVIDER_TRACE TEST_PRIVATE_KEY', { status }),
      );
      const error = await createQuerioClient(settings, fetcher)('POST', '/notebooks', {}).catch(
        (error: unknown) => error,
      );
      expect(error).toMatchObject({
        code:
          status === 401 || status === 403
            ? 'AI_AUTH_ERROR'
            : status === 429
              ? 'AI_RATE_LIMIT'
              : 'AI_PROVIDER_ERROR',
        details: { upstreamStatus: status },
      });
      expect(failureStage(error)).toBe('provider_http');
      expect(JSON.stringify(error)).not.toContain('PRIVATE');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('does not replay a request when the connection fails after it may have been accepted', async () => {
    const fetcher = mockFetch(async () => {
      throw new Error('PRIVATE_NETWORK_URL TEST_PRIVATE_KEY');
    });
    const error = await createQuerioClient(settings, fetcher)('POST', '/agent-sessions/test/events', {
      type: 'message',
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'AI_CONNECTION_ERROR', status: 503 });
    expect(failureStage(error)).toBe('provider_transport');
    expect(JSON.stringify(error)).not.toContain('PRIVATE');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('accepts a successful empty deletion response', async () => {
    const fetcher = mockFetch(async () => new Response(null, { status: 204 }));
    await expect(
      createQuerioClient(settings, fetcher)('DELETE', '/execution-environments/env-1'),
    ).resolves.toEqual({});
  });

  it.each(['not json', '{"id":', 'null', '[]', 'true', '42', '"text"'])(
    'rejects malformed or non-object JSON %j as a protocol failure',
    async (body) => {
      const fetcher = mockFetch(async () => new Response(body, { status: 200 }));
      await expect(createQuerioClient(settings, fetcher)('GET', '/runs/run-1')).rejects.toMatchObject({
        code: 'AI_INVALID_RESPONSE',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('bounds the declared body before decoding it', async () => {
    const fetcher = mockFetch(async () => new Response('{}', { headers: { 'content-length': '4000001' } }));
    await expect(createQuerioClient(settings, fetcher)('GET', '/runs/run-1')).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
  });

  it('bounds streaming bytes even when the server omits content-length', async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks++;
        controller.enqueue(new Uint8Array(1_000_001));
      },
      cancel,
    });
    const fetcher = mockFetch(async () => new Response(stream));
    await expect(createQuerioClient(settings, fetcher)('GET', '/runs/run-1')).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(chunks).toBeLessThanOrEqual(6);
  });

  it('does not replay when the body stream breaks after response headers arrive', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('PRIVATE_STREAM_FAILURE'));
      },
    });
    const fetcher = mockFetch(async () => new Response(stream));
    const error = await createQuerioClient(settings, fetcher)(
      'POST',
      '/agent-sessions/test/events',
      {},
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(JSON.stringify(error)).not.toContain('PRIVATE_STREAM');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('Querio configuration and remote references', () => {
  it('requires both a local server key and workspace and defaults to the live datasource', () => {
    expect(querioSettings({})).toBeNull();
    expect(querioSettings({ QUERIO_API_KEY: 'key' })).toBeNull();
    expect(querioSettings({ QUERIO_API_KEY: ' key ', QUERIO_WORKSPACE_ID: ' workspace-test ' })).toEqual({
      key: 'key',
      workspaceId: 'workspace-test',
      datasource: 'daybook-live',
      model: undefined,
    });
  });

  it.each([
    { QUERIO_WORKSPACE_ID: '../private' },
    { QUERIO_DATASOURCE_SLUG: 'live?other=true' },
    { QUERIO_MODEL: 'model\nPRIVATE' },
  ])('rejects malformed route configuration without echoing its value', (override) => {
    expect(() =>
      querioSettings({ QUERIO_API_KEY: 'PRIVATE_KEY', QUERIO_WORKSPACE_ID: 'workspace-test', ...override }),
    ).toThrow(/Invalid Querio/);
  });

  it.each([null, {}, '', '../secrets', 'id?x=y', 'a'.repeat(129), 'id\nHeader: value'])(
    'rejects unsafe remote ID %j',
    (id) => {
      expect(() => remoteId(id)).toThrow('Querio returned an invalid session reference');
    },
  );
});
