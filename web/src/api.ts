import { useCallback, useEffect, useState } from 'react';
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      body?.error?.message ?? 'Unable to reach the server. Please try again.',
      body?.error?.code ?? 'NETWORK_ERROR',
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const write = <T>(url: string, body: unknown, method = 'POST', key?: string) =>
  api<T>(url, { method, body: JSON.stringify(body), headers: key ? { 'Idempotency-Key': key } : undefined });
export function useResource<T>(url: string | null, revision = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(Boolean(url)),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<T>(url, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
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
