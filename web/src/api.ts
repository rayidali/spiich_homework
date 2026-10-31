import { useCallback, useEffect, useState } from 'react';
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export type UiError = string | { message: string; requestId?: string };
export function asUiError(error: unknown): UiError {
  if (error instanceof ApiError) return { message: error.message, requestId: error.requestId };
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
function requestReference(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api${url}`, {
      ...options,
      headers,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      'Could not connect to Daybook. Check your connection and try again.',
      'NETWORK_ERROR',
      0,
    );
  }
  const reference = requestReference(response.headers.get('X-Request-Id'));
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      typeof body?.error?.message === 'string' && body.error.message.length <= 2000
        ? body.error.message
        : 'The server could not complete this request. Please try again.',
      typeof body?.error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(body.error.code)
        ? body.error.code
        : 'HTTP_ERROR',
      response.status,
      reference ?? requestReference(body?.error?.requestId),
    );
  }
  if (response.status === 204) return undefined as T;
  try {
    return await response.json();
  } catch {
    throw new ApiError(
      'Daybook returned an incomplete response. Please try again.',
      'INVALID_SERVER_RESPONSE',
      response.status,
      reference,
    );
  }
}
export const write = <T>(url: string, body: unknown, method = 'POST', key?: string) =>
  api<T>(url, { method, body: JSON.stringify(body), headers: key ? { 'Idempotency-Key': key } : undefined });
export function useResource<T>(url: string | null, revision = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<UiError>(''),
    [loading, setLoading] = useState(Boolean(url)),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!url) {
      setData(null);
      setError('');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<T>(url, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(asUiError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, revision, nonce]);
  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []) };
}
export const params = (values: Record<string, string | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) p.set(key, value);
  return p.toString();
};
export function downloadCsv(name: string, headers: string[], rows: unknown[][]) {
  const escape = (value: unknown) => {
    let s = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const content = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
