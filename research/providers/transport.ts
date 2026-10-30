/** All provider I/O is injectable so the study runner can account for every attempt. */
export type RequestKind =
  | 'generate'
  | 'critic'
  | 'embed'
  | 'file-search-query'
  | 'file-store'
  | 'file-index'
  | 'file-poll'
  | 'jev-systemone'
  | 'jev-rerank'
  | 'jev-verify';

export type ResearchRequest = {
  provider: 'gemini' | 'jev';
  model: string;
  kind: RequestKind;
  url: string;
  method: 'GET' | 'POST' | 'DELETE';
  headers: Record<string, string>;
  body?: unknown;
  /** Used only for the UTF-8 upload stage. Do not JSON-encode it. */
  rawBody?: string;
  timeoutMs: number;
};

export type ResearchResponse = {
  status: number;
  json: unknown;
  elapsedMs: number;
  /** Lowercase names, needed for Google's resumable upload URL. */
  headers?: Record<string, string>;
};
export type ResearchTransport = (request: ResearchRequest) => Promise<ResearchResponse>;

export type ProviderUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  totalTokens: number | null;
};
export type ProviderMetadata = {
  provider: 'gemini' | 'jev';
  requestedModel: string;
  model: string;
  kind: RequestKind;
  elapsedMs: number;
  usage: ProviderUsage;
};
export type ProviderResult<T> = { data: T; metadata: ProviderMetadata };

export class ResearchProviderError extends Error {
  constructor(
    readonly code:
      | 'NOT_CONFIGURED'
      | 'INVALID_REQUEST'
      | 'INVALID_RESPONSE'
      | 'TIMEOUT'
      | 'NETWORK_ERROR'
      | 'AUTH_ERROR'
      | 'RATE_LIMIT'
      | 'MODEL_UNAVAILABLE'
      | 'PROVIDER_ERROR'
      | 'INDEX_FAILED',
    readonly status?: number,
  ) {
    // Deliberately excludes provider bodies, URLs, prompts and keys.
    super(`Research provider request failed: ${code}.`);
    this.name = 'ResearchProviderError';
  }
}

export const missingUsage = (): ProviderUsage => ({
  inputTokens: null,
  outputTokens: null,
  thinkingTokens: null,
  totalTokens: null,
});

export function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function checkStatus(response: ResearchResponse) {
  if (response.status >= 200 && response.status < 300) return;
  throw new ResearchProviderError(
    response.status === 401 || response.status === 403
      ? 'AUTH_ERROR'
      : response.status === 429
        ? 'RATE_LIMIT'
        : response.status === 404
          ? 'MODEL_UNAVAILABLE'
          : 'PROVIDER_ERROR',
    response.status,
  );
}

/** No redirects, retries, arbitrary hosts, unbounded bodies, or implicit key lookup. */
export const fetchTransport: ResearchTransport = async (request) => {
  const url = new URL(request.url);
  const host = request.provider === 'gemini' ? 'generativelanguage.googleapis.com' : 'api.typesafe.ai';
  if (
    url.protocol !== 'https:' ||
    url.hostname !== host ||
    url.port ||
    url.username ||
    url.password ||
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < 1 ||
    request.timeoutMs > 25000 ||
    (request.rawBody !== undefined && request.body !== undefined)
  )
    throw new ResearchProviderError('INVALID_REQUEST');
  const body = request.rawBody ?? (request.body === undefined ? undefined : JSON.stringify(request.body));
  if (body !== undefined && Buffer.byteLength(body) > 1024 * 1024)
    throw new ResearchProviderError('INVALID_REQUEST');
  const start = performance.now();
  try {
    const response = await fetch(url, {
      method: request.method,
      headers: request.headers,
      body,
      signal: AbortSignal.timeout(request.timeoutMs),
      redirect: 'error',
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new ResearchProviderError('INVALID_RESPONSE');
        }
        chunks.push(value);
      }
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let json: unknown = null;
    if (raw.trim()) {
      try {
        json = JSON.parse(raw);
      } catch {
        // HTTP errors may be HTML; the status is enough to classify them safely.
        if (response.ok) throw new ResearchProviderError('INVALID_RESPONSE');
      }
    }
    return {
      status: response.status,
      json,
      elapsedMs: Math.round(performance.now() - start),
      headers: Object.fromEntries(response.headers.entries()),
    };
  } catch (error) {
    if (error instanceof ResearchProviderError) throw error;
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
      throw new ResearchProviderError('TIMEOUT');
    throw new ResearchProviderError('NETWORK_ERROR');
  }
};
