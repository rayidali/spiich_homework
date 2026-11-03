import { AppError, markFailure } from './errors';

export type QuerioSettings = { key: string; workspaceId: string; datasource: string; model?: string };
export function querioSettings(env: NodeJS.ProcessEnv = process.env): QuerioSettings | null {
  const key = env.QUERIO_API_KEY?.trim();
  const workspaceId = env.QUERIO_WORKSPACE_ID?.trim();
  const datasource = env.QUERIO_DATASOURCE_SLUG?.trim() || 'daybook-live';
  const model = env.QUERIO_MODEL?.trim() || undefined;
  if (!key || !workspaceId) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId) || !/^[A-Za-z0-9_.-]{1,120}$/.test(datasource))
    throw new Error('Invalid Querio workspace or datasource configuration.');
  if (model && !/^[A-Za-z0-9_.:/-]{1,120}$/.test(model))
    throw new Error('Invalid Querio model configuration.');
  return { key, workspaceId, datasource, model };
}
export function remoteId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'Querio returned an invalid session reference.');
  return value;
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export type QuerioRequest = (
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;
export function createQuerioClient(settings: QuerioSettings, fetcher: typeof fetch = fetch): QuerioRequest {
  return async (method, path, body) => {
    if (!/^\/[a-zA-Z0-9/_-]+(?:\?limit=\d+)?$/.test(path))
      throw new Error('Invalid internal Querio request path.');
    let response: Response;
    try {
      response = await fetcher(`https://app.querio.ai/api/v3${path}`, {
        method,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${settings.key}`,
          'Querio-Workspace-Id': settings.workspaceId,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw markFailure(
        new AppError(
          503,
          'AI_CONNECTION_ERROR',
          'The connection to Querio was interrupted. Daybook will not automatically send your question twice.',
        ),
        'provider_transport',
      );
    }
    if (!response.ok) {
      const auth = response.status === 401 || response.status === 403;
      const limited = response.status === 429;
      throw markFailure(
        new AppError(
          auth ? 503 : limited ? 429 : 502,
          auth ? 'AI_AUTH_ERROR' : limited ? 'AI_RATE_LIMIT' : 'AI_PROVIDER_ERROR',
          auth
            ? 'Querio access needs attention. Your saved analysis is still available.'
            : limited
              ? 'Querio is busy or its usage allowance is exhausted. Try again later.'
              : 'Querio could not complete this operation. Your accounting records have not changed.',
          { upstreamStatus: response.status },
        ),
        'provider_http',
      );
    }
    if (response.status === 204) return {};
    const declared = Number(response.headers.get('content-length'));
    if (declared > 4_000_000)
      throw new AppError(
        502,
        'AI_INVALID_RESPONSE',
        'This analysis is too large to display. Narrow the question or inspect it in Querio.',
      );
    // Bound streamed bytes too; content-length need not be supplied by an upstream.
    const reader = response.body?.getReader();
    if (!reader) throw new AppError(502, 'AI_INVALID_RESPONSE', 'Querio returned an empty response.');
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 4_000_000) {
          await reader.cancel();
          throw new Error('oversize');
        }
        parts.push(part.value);
      }
      const parsed: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
      return parsed as Record<string, unknown>;
    } catch {
      throw markFailure(
        new AppError(
          502,
          'AI_INVALID_RESPONSE',
          'Querio returned an incomplete or oversized result. Your saved question has not been resent.',
        ),
        'model_response',
      );
    }
  };
}
