/** Server-only HTTP failure telemetry. Provider prose may echo prompts or keys:
 * inspect it only for fixed categories and never return/log the original text.
 * A category is a provider-reported hint, not proof of the request's root cause. */
export const MAX_PROVIDER_ERROR_BYTES = 16 * 1024;
const ERROR_READ_TIMEOUT_MS = 1000;

const statuses = [
  'INVALID_ARGUMENT',
  'RESOURCE_EXHAUSTED',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'FAILED_PRECONDITION',
  'OUT_OF_RANGE',
  'ABORTED',
  'INTERNAL',
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'UNIMPLEMENTED',
  'CANCELLED',
  'DATA_LOSS',
  'UNKNOWN',
] as const;
const codes = [
  'invalid_json_schema',
  'invalid_request_error',
  'context_length_exceeded',
  'model_not_found',
  'invalid_api_key',
  'insufficient_quota',
  'rate_limit_exceeded',
  'permission_denied',
  'server_error',
] as const;
const reasons = [
  'schema_complexity',
  'schema_rejected',
  'request_too_large',
  'invalid_argument',
  'quota_exceeded',
  'rate_limited',
  'rate_or_quota_limit',
  'permission_denied',
  'unauthenticated',
  'model_not_found',
  'not_found',
  'service_unavailable',
  'unknown',
] as const;
const bodyStates = [
  'parsed',
  'empty',
  'non_json',
  'malformed_json',
  'unexpected_shape',
  'invalid_encoding',
  'too_large',
  'read_failed',
  'timeout',
  'aborted',
] as const;

export type ProviderErrorDiagnostics = {
  providerReason: (typeof reasons)[number];
  providerBodyState: (typeof bodyStates)[number];
  providerStatus?: (typeof statuses)[number];
  providerCode?: number | (typeof codes)[number];
  providerRequestId?: string;
};
type Options = {
  httpStatus: number;
  apiKey?: string;
  headers?: Pick<Headers, 'get'>;
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const contains = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.includes(value as T);
const httpCode = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599;

/** Redaction is defense in depth: even the redacted prose never leaves this module. */
function redact(value: string, apiKey?: string): string {
  return (apiKey ? value.split(apiKey).join('[redacted]') : value)
    .replace(/AIza[\w-]{20,}/g, '[redacted]')
    .replace(/\bsk-(?:(?:proj|svcacct)-)?[\w-]{12,}/g, '[redacted]')
    .replace(/\bBearer\s+[\w.+/=-]+/gi, '[redacted]')
    .replace(/\b(?:api[_ -]?key|authorization)\s*[:=]\s*["']?[^\s"',;]+/gi, '[redacted]');
}

function safeRequestId(value: unknown, apiKey?: string): value is string {
  // Only known opaque formats, from explicitly named RESPONSE headers. Do not
  // accept arbitrary alphanumeric prose, URLs, trace headers, or body fields.
  return (
    typeof value === 'string' &&
    value.length <= 80 &&
    redact(value, apiKey) === value &&
    /^(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|req_[a-f0-9]{16,64})$/i.test(value)
  );
}
function requestId(options: Options) {
  for (const name of ['x-request-id', 'request-id', 'x-goog-request-id']) {
    const value = options.headers?.get(name);
    if (safeRequestId(value, options.apiKey)) return value;
  }
  return undefined;
}
function baseReason(httpStatus: number): ProviderErrorDiagnostics['providerReason'] {
  if (httpStatus === 400) return 'invalid_argument';
  if (httpStatus === 401) return 'unauthenticated';
  if (httpStatus === 403) return 'permission_denied';
  if (httpStatus === 404) return 'not_found';
  if (httpStatus === 413) return 'request_too_large';
  if (httpStatus === 429) return 'rate_or_quota_limit';
  if (httpStatus >= 500 && httpStatus <= 599) return 'service_unavailable';
  return 'unknown';
}
function emptyDiagnostic(options: Options, state: ProviderErrorDiagnostics['providerBodyState']) {
  const id = requestId(options);
  return {
    providerReason: baseReason(options.httpStatus),
    providerBodyState: state,
    ...(id ? { providerRequestId: id } : {}),
  } satisfies ProviderErrorDiagnostics;
}

function classify(
  options: Options,
  status: ProviderErrorDiagnostics['providerStatus'],
  code: ProviderErrorDiagnostics['providerCode'],
  message: string,
): ProviderErrorDiagnostics['providerReason'] {
  // More specific hints require a compatible HTTP/status/code class; an echoed
  // sentence about a quota must not turn an HTTP 400 schema failure into a 429.
  if (options.httpStatus === 401 || status === 'UNAUTHENTICATED' || code === 'invalid_api_key')
    return 'unauthenticated';
  if (options.httpStatus === 403 || status === 'PERMISSION_DENIED' || code === 'permission_denied')
    return 'permission_denied';
  if (code === 'model_not_found') return 'model_not_found';
  if (options.httpStatus === 404 || status === 'NOT_FOUND')
    return /\bmodel\b[^\r\n]{0,100}\b(?:not found|does not exist|not supported|unavailable)\b/i.test(message)
      ? 'model_not_found'
      : 'not_found';
  if (
    options.httpStatus === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    code === 'rate_limit_exceeded' ||
    code === 'insufficient_quota'
  ) {
    if (code === 'insufficient_quota' || /\bquota\b/i.test(message)) return 'quota_exceeded';
    if (code === 'rate_limit_exceeded' || /\b(?:rate limit|too many requests)\b/i.test(message))
      return 'rate_limited';
    return 'rate_or_quota_limit';
  }
  if (code === 'context_length_exceeded' || options.httpStatus === 413) return 'request_too_large';
  if (options.httpStatus === 400 || status === 'INVALID_ARGUMENT' || code === 'invalid_json_schema') {
    if (
      /\b(?:schema|constraint)\b[^\r\n]{0,160}\b(?:too complex|too many states|complexity limit|too large)\b/i.test(
        message,
      ) ||
      /\bschema complexity\b/i.test(message)
    )
      return 'schema_complexity';
    if (
      code === 'invalid_json_schema' ||
      /\b(?:schema|function_declarations|response_schema|response_json_schema)\b/i.test(message)
    )
      return 'schema_rejected';
    return 'invalid_argument';
  }
  if (status === 'UNAVAILABLE' || status === 'INTERNAL' || code === 'server_error')
    return 'service_unavailable';
  return baseReason(options.httpStatus);
}

/** Parses a bounded byte/string body; output contains no provider message text.
 * Invalid/truncated/non-JSON bodies retain only HTTP-derived categories. */
export function parseProviderErrorDiagnostics(
  body: string | Uint8Array,
  options: Options,
): ProviderErrorDiagnostics {
  const size = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength;
  if (size > MAX_PROVIDER_ERROR_BYTES) return emptyDiagnostic(options, 'too_large');
  let text: string;
  try {
    text = typeof body === 'string' ? body : new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return emptyDiagnostic(options, 'invalid_encoding');
  }
  if (!text.trim()) return emptyDiagnostic(options, 'empty');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyDiagnostic(options, /^[\s]*[\[{]/.test(text) ? 'malformed_json' : 'non_json');
  }
  if (!object(parsed) || !object(parsed.error)) return emptyDiagnostic(options, 'unexpected_shape');
  const error = parsed.error;
  const status =
    contains(statuses, error.status) && redact(error.status, options.apiKey) === error.status
      ? error.status
      : undefined;
  const code =
    httpCode(error.code) || (contains(codes, error.code) && redact(error.code, options.apiKey) === error.code)
      ? error.code
      : undefined;
  const message = typeof error.message === 'string' ? redact(error.message, options.apiKey) : '';
  return {
    ...emptyDiagnostic(options, 'parsed'),
    providerReason: classify(options, status, code, message),
    ...(status ? { providerStatus: status } : {}),
    ...(code !== undefined ? { providerCode: code } : {}),
  };
}

/** Revalidate at the logger boundary. Never spread an arbitrary diagnostics object. */
export function safeProviderErrorDiagnostics(value: unknown): ProviderErrorDiagnostics | undefined {
  if (
    !object(value) ||
    !contains(reasons, value.providerReason) ||
    !contains(bodyStates, value.providerBodyState)
  )
    return undefined;
  return {
    providerReason: value.providerReason,
    providerBodyState: value.providerBodyState,
    ...(contains(statuses, value.providerStatus) ? { providerStatus: value.providerStatus } : {}),
    ...(httpCode(value.providerCode) || contains(codes, value.providerCode)
      ? { providerCode: value.providerCode }
      : {}),
    ...(safeRequestId(value.providerRequestId) ? { providerRequestId: value.providerRequestId } : {}),
  };
}

/** Read at most 16 KiB and wait at most one second, without throwing over the
 * original HTTP failure. Consumes this response body; do not read it again.
 * Cancellation is requested but never awaited, since a stream may not settle. */
export async function readProviderErrorDiagnostics(
  response: Response,
  options: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<ProviderErrorDiagnostics> {
  const context: Options = { httpStatus: response.status, headers: response.headers, apiKey: options.apiKey };
  const advertised = response.headers.get('content-length');
  if (advertised && /^\d+$/.test(advertised) && Number(advertised) > MAX_PROVIDER_ERROR_BYTES) {
    void response.body?.cancel().catch(() => {});
    return emptyDiagnostic(context, 'too_large');
  }
  if (options.signal?.aborted) {
    void response.body?.cancel().catch(() => {});
    return emptyDiagnostic(context, 'aborted');
  }
  if (!response.body) return emptyDiagnostic(context, 'empty');
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    return emptyDiagnostic(context, 'read_failed');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop!: (reason: 'timeout' | 'aborted') => void;
  const stopped = new Promise<'timeout' | 'aborted'>((resolve) => {
    stop = resolve;
    timer = setTimeout(() => resolve('timeout'), ERROR_READ_TIMEOUT_MS);
  });
  const abort = () => stop('aborted');
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) stop('aborted');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), stopped]);
      if (typeof next === 'string') {
        void reader.cancel().catch(() => {});
        return emptyDiagnostic(context, next);
      }
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_PROVIDER_ERROR_BYTES) {
        void reader.cancel().catch(() => {});
        return emptyDiagnostic(context, 'too_large');
      }
      chunks.push(next.value);
    }
    return parseProviderErrorDiagnostics(Buffer.concat(chunks, length), context);
  } catch {
    void reader.cancel().catch(() => {});
    return emptyDiagnostic(context, 'read_failed');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}
