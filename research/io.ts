import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ResearchRequest, ResearchResponse, ResearchTransport } from './providers/transport';

export type HttpRequest = Omit<ResearchRequest, 'provider' | 'model' | 'kind'>;
export type HttpTransport = (request: HttpRequest) => Promise<ResearchResponse>;

/** Appended last: .done existence alone does not prove curl finished writing it. */
export const QUEUE_COMPLETION_MARKER = 'DAYBOOK_HTTP_DONE_V1';
export interface QueueCompletion {
  status: number;
  elapsedMs: number;
  exitCode: number;
}
export function parseQueueCompletion(value: string): QueueCompletion | null {
  if (!value.endsWith(` ${QUEUE_COMPLETION_MARKER}\n`)) return null;
  const match = /^(\d{3}) (\d+(?:\.\d+)?) (\d{1,3}) DAYBOOK_HTTP_DONE_V1\n$/.exec(value);
  if (!match) throw new Error('RESEARCH_INVALID_HTTP_COMPLETION');
  const status = Number(match[1]);
  const elapsedMs = Math.round(Number(match[2]) * 1000);
  const exitCode = Number(match[3]);
  if ((status !== 0 && (status < 100 || status > 599)) || !Number.isSafeInteger(elapsedMs) || exitCode > 255)
    throw new Error('RESEARCH_INVALID_HTTP_COMPLETION');
  return { status, elapsedMs, exitCode };
}

export function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}

/** For this sandbox: prepare private requests; an authorized curl tool executes them.
 * Normal environments use fetch. No shell command or credential is printed. */
export function queuedHttp(directory = '.tools/research/queue'): HttpTransport {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return async (request) => {
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 60000)
      throw new Error('RESEARCH_INVALID_HTTP_TIMEOUT');
    const expiresAt = Date.now() + request.timeoutMs;
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port)
      throw new Error('RESEARCH_INVALID_HTTP_TARGET');
    if (
      !['generativelanguage.googleapis.com', 'api.typesafe.ai'].includes(url.hostname) &&
      !/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(url.hostname)
    )
      throw new Error('RESEARCH_INVALID_HTTP_TARGET');
    const id = randomUUID();
    const stem = `${root}/${id}`;
    const body = request.rawBody ?? (request.body === undefined ? undefined : JSON.stringify(request.body));
    if (body && Buffer.byteLength(body) > 2_000_000) throw new Error('RESEARCH_REQUEST_TOO_LARGE');
    if (body !== undefined) writeFileSync(`${stem}.body`, body, { mode: 0o600 });
    const quote = (s: string) => JSON.stringify(s);
    const config = [
      'no-fail',
      'silent',
      'show-error',
      'proto = "=https"',
      'max-redirs = 0',
      `max-time = ${Math.min(60, Math.max(1, Math.ceil(request.timeoutMs / 1000)))}`,
      'max-filesize = 8000000',
      `url = ${quote(request.url)}`,
      `request = ${quote(request.method)}`,
      ...Object.entries(request.headers).map(([k, v]) => `header = ${quote(`${k}: ${v}`)}`),
      ...(body === undefined ? [] : [`data-binary = ${quote(`@${stem}.body`)}`]),
      `output = ${quote(`${stem}.response`)}`,
      `dump-header = ${quote(`${stem}.headers`)}`,
      `write-out = ${quote(`%output{${stem}.done}%{http_code} %{time_total} %{exitcode} ${QUEUE_COMPLETION_MARKER}\n`)}`,
    ].join('\n');
    writeFileSync(`${stem}.curl`, config + '\n', { mode: 0o600 });
    atomicJson(`${stem}.ready`, { id, createdAt: new Date().toISOString(), expiresAt });
    let completion: QueueCompletion | null = null;
    while (!completion) {
      // Queue waiting consumes the same request/episode deadline as network I/O.
      if (Date.now() >= expiresAt) {
        if (existsSync(`${stem}.ready`)) unlinkSync(`${stem}.ready`);
        throw new Error('RESEARCH_HTTP_TIMEOUT');
      }
      if (existsSync(`${stem}.done`)) completion = parseQueueCompletion(readFileSync(`${stem}.done`, 'utf8'));
      if (!completion) await new Promise((r) => setTimeout(r, Math.min(100, expiresAt - Date.now())));
    }
    if (Date.now() > expiresAt) throw new Error('RESEARCH_HTTP_TIMEOUT');
    const raw = existsSync(`${stem}.response`) ? readFileSync(`${stem}.response`, 'utf8') : '';
    let json: unknown = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      /* Safe status classification downstream. */
    }
    const headers = Object.fromEntries(
      (existsSync(`${stem}.headers`) ? readFileSync(`${stem}.headers`, 'utf8') : '')
        .split(/\r?\n/)
        .filter((s) => s.includes(':'))
        .map((line) => {
          const colon = line.indexOf(':');
          return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
        }),
    );
    if (completion.exitCode !== 0)
      throw new Error(completion.exitCode === 28 ? 'RESEARCH_HTTP_TIMEOUT' : 'RESEARCH_HTTP_FAILURE');
    return { status: completion.status, json, headers, elapsedMs: completion.elapsedMs };
  };
}

export const directHttp: HttpTransport = async (request) => {
  const start = performance.now();
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.rawBody ?? (request.body === undefined ? undefined : JSON.stringify(request.body)),
    signal: AbortSignal.timeout(request.timeoutMs),
    redirect: 'error',
  });
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 8_000_000) throw new Error('RESEARCH_RESPONSE_TOO_LARGE');
  let json: unknown = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    /* Status handled by caller. */
  }
  return {
    status: response.status,
    json,
    headers: Object.fromEntries(response.headers.entries()),
    elapsedMs: Math.round(performance.now() - start),
  };
};

export function httpTransport(): HttpTransport {
  return process.env.RESEARCH_TRANSPORT === 'queue' ? queuedHttp() : directHttp;
}
export function providerTransport(http: HttpTransport): ResearchTransport {
  return (request) => http(request);
}
