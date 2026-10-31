import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CategoryHttpRequest, CategoryTransport } from '../../server/category-selector';
import { CATEGORY_PRICES, CategoryBudget } from './budget';

export function privateJson(path: string, value: unknown) {
  writeFileSync(path + '.next', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(path + '.next', path);
}
export function reportedUsage(provider: 'gemini' | 'jev', body: unknown) {
  if (!body || typeof body !== 'object') return null;
  const data = body as Record<string, unknown>;
  const usage = (provider === 'jev' ? data.usage : data.usageMetadata) as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== 'object') return null;
  const input = provider === 'jev' ? usage.input_tokens : usage.promptTokenCount;
  const visible = provider === 'jev' ? usage.output_tokens : usage.candidatesTokenCount;
  const thinking = provider === 'jev' ? 0 : (usage.thoughtsTokenCount ?? 0);
  if (![input, visible, thinking].every((v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0))
    return null;
  const output = (visible as number) + (thinking as number);
  if (
    provider === 'gemini' &&
    usage.totalTokenCount !== undefined &&
    (!Number.isSafeInteger(usage.totalTokenCount) || usage.totalTokenCount !== (input as number) + output)
  )
    return null;
  if (
    provider === 'gemini' &&
    usage.toolUsePromptTokenCount !== undefined &&
    usage.toolUsePromptTokenCount !== 0
  )
    return null;
  return Number.isSafeInteger(output) ? { inputTokens: input as number, outputTokens: output } : null;
}
function curlQuote(value: string) {
  if (/[\r\n\0]/.test(value)) throw new Error('TRANSPORT_HEADER');
  return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
}
export type TransportObservation = {
  claimed?: boolean;
  localFailure?: string;
  dispatched: boolean;
  httpStatus: number | null;
  networkMs: number | null;
  exitCode: number | null;
};

/** The environment permits explicit curl tool calls but not child-process DNS.
 * This queue lets the real selector await one externally dispatched HTTPS call.
 * Payloads/keys/raw responses stay in ignored private tooling, never result files.
 * Report network timing separately from orchestration-inclusive selector timing. */
export function queuedTransport(
  directory: string,
  id: string,
  budget: CategoryBudget,
  observation: TransportObservation,
): CategoryTransport {
  return async (request: CategoryHttpRequest) => {
    try {
      const expected =
        request.provider === 'jev'
          ? 'https://api.typesafe.ai/v1/systemone'
          : `https://generativelanguage.googleapis.com/v1beta/models/${CATEGORY_PRICES.gemini.model}:generateContent`;
      if (request.url !== expected || !/^[a-zA-Z0-9:_-]{1,100}$/.test(id))
        throw new Error('TRANSPORT_TARGET');
      const keys = Object.keys(request.headers).sort();
      const expectedKeys =
        request.provider === 'jev' ? ['Authorization', 'Content-Type'] : ['Content-Type', 'x-goog-api-key'];
      if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) throw new Error('TRANSPORT_HEADERS');
      if (request.signal.aborted) throw new Error('TRANSPORT_ABORTED');
      budget.reserve(id, request.provider, request.body);
      let settled = false;
      const callDirectory = join(directory, id.replaceAll(':', '-'));
      try {
        mkdirSync(callDirectory, { mode: 0o700 });
        const bodyFile = join(callDirectory, 'request.json');
        const configFile = join(callDirectory, 'auth.curl');
        writeFileSync(bodyFile, request.body, { mode: 0o600, flag: 'wx' });
        writeFileSync(join(callDirectory, 'response.json'), '', { mode: 0o600, flag: 'wx' });
        writeFileSync(
          configFile,
          Object.entries(request.headers)
            .map(([k, v]) => `header = ${curlQuote(k + ': ' + v)}`)
            .join('\n') + '\n',
          { mode: 0o600, flag: 'wx' },
        );
        privateJson(join(directory, 'pending.json'), {
          id,
          provider: request.provider,
          url: expected,
          directory: callDirectory,
          state: 'queued',
          deadline: Date.now() + request.timeoutMs - 1000,
          timeoutMs: request.timeoutMs,
          maxResponseBytes: request.maxResponseBytes,
        });
        const completionFile = join(callDirectory, 'completion.json');
        while (!existsSync(completionFile)) {
          if (request.signal.aborted) throw new Error('TRANSPORT_ABORTED');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const completion = JSON.parse(readFileSync(completionFile, 'utf8'));
        observation.dispatched = completion.dispatched === true;
        observation.exitCode = completion.exitCode;
        observation.httpStatus = completion.httpStatus;
        observation.networkMs = completion.networkMs;
        let body: unknown = null;
        const responseFile = join(callDirectory, 'response.json');
        const oversized = statSync(responseFile).size > request.maxResponseBytes;
        const raw = oversized ? Buffer.alloc(0) : readFileSync(responseFile);
        if (!oversized && raw.length <= request.maxResponseBytes) {
          try {
            body = JSON.parse(raw.toString('utf8'));
          } catch {
            /* Retain unknown usage. */
          }
        }
        // Capture usage even when the application later rejects an invalid response.
        const returned = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
        const expectedModel =
          request.provider === 'jev'
            ? returned.model === CATEGORY_PRICES.jev.model
            : typeof returned.modelVersion === 'string' &&
              /^gemini-3\.5-flash-lite(?:-|$)/.test(returned.modelVersion);
        budget.settle(id, expectedModel ? reportedUsage(request.provider, body) : null);
        settled = true;
        const httpFailureExit =
          completion.exitCode === 22 && completion.httpStatus >= 400 && completion.httpStatus <= 599;
        if ((completion.exitCode !== 0 && !httpFailureExit) || request.signal.aborted)
          throw new Error('TRANSPORT_FAILED');
        if (oversized || raw.length > request.maxResponseBytes) throw new Error('TRANSPORT_RESPONSE_BOUND');
        return { status: completion.httpStatus, body };
      } finally {
        observation.claimed = existsSync(join(callDirectory, 'claimed'));
        if (!settled && budget.snapshot().records.find((row) => row.id === id)?.state === 'pending')
          budget.settle(id, null);
        privateJson(join(directory, 'pending.json'), { id, state: 'consumed' });
      }
    } catch (error) {
      observation.localFailure =
        error instanceof Error && /^(?:BUDGET|TRANSPORT)_[A-Z_]{1,60}$/.test(error.message)
          ? error.message
          : 'TRANSPORT_LOCAL_FAILURE';
      throw error;
    }
  };
}
