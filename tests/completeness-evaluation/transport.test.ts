import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGeminiFinancialRequest } from '../../server/ai-provider';
import {
  createEvaluationTransport,
  type EvaluationTransportConfig,
} from '../../scripts/completeness-evaluation/transport';

const key = 'synthetic-key-for-accounting-tests-only';
const keyHash = createHash('sha256').update(key).digest('hex');
const model = 'gemini-3.5-flash-lite';
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const directories: string[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function body() {
  return {
    systemInstruction: { parts: [{ text: 'Read-only financial tools.' }] },
    contents: [{ role: 'user', parts: [{ text: 'Show expenses.' }] }],
    generationConfig: { candidateCount: 1, maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: 'LOW' } },
    tools: [{ functionDeclarations: [{ name: 'show', parameters: { type: 'object' } }] }],
  };
}
function request(): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body()),
    signal: new AbortController().signal,
  };
}
function payload(usage: Record<string, unknown> = {}) {
  return {
    modelVersion: model,
    candidates: [
      { finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'show', args: {} } }] } },
    ],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 10,
      thoughtsTokenCount: 2,
      totalTokenCount: 112,
      serviceTier: 'standard',
      ...usage,
    },
  };
}
const response = (raw: unknown = payload(), status = 200) => new Response(JSON.stringify(raw), { status });
function setup(overrides: Partial<EvaluationTransportConfig> = {}, callback?: typeof fetch) {
  const base = mkdtempSync(join(tmpdir(), 'daybook-completeness-transport-'));
  directories.push(base);
  const config: EvaluationTransportConfig = {
    directory: join(base, 'new-cohort'),
    model,
    apiKey: key,
    expectedKeySha256: keyHash,
    ceilingUsd: '0.90',
    maxAttempts: 160,
    inputUsdPerMillion: '0.30',
    outputUsdPerMillion: '2.50',
    maxRequestBytes: 256 * 1024,
    ...overrides,
  };
  const native = callback ?? vi.fn<typeof fetch>(async () => response());
  const adapter = createEvaluationTransport(config, native);
  return { config, native, adapter, path: config.directory };
}
function start(test: ReturnType<typeof setup>, caseId = 'D01', maxAttempts = 3) {
  test.adapter.beginTrial({ caseId, route: 'adaptive', maxAttempts });
}
const ledger = (path: string) => JSON.parse(readFileSync(join(path, 'ledger.json'), 'utf8'));
function allFiles(directory: string): string {
  return readdirSync(directory)
    .map((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? allFiles(path) : readFileSync(path, 'utf8');
    })
    .join('\n');
}
describe('evaluation-only actual Gemini fetch accounting', () => {
  it('accepts the actual production request builder without replacing its grammar', async () => {
    const built = buildGeminiFinancialRequest(
      [
        {
          type: 'function',
          name: 'show',
          strict: true,
          description: 'Show results',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ],
      'Read-only test.',
      [{ role: 'user', content: 'Show expenses.' }],
      model,
    );
    const test = setup();
    start(test);
    await test.adapter.fetch(built.url, { ...request(), body: JSON.stringify(built.body) });
    expect(test.native).toHaveBeenCalledTimes(1);
    expect(test.adapter.summary().haltReason).toBeNull();
  });
  it('durably reserves before dispatch, settles exact including-thinking cost, and preserves the response', async () => {
    let test: ReturnType<typeof setup>;
    test = setup(
      {},
      vi.fn(async (_url, init) => {
        const pending = ledger(test.path);
        expect(pending.records).toHaveLength(1);
        expect(pending.records[0].state).toBe('pending');
        expect(Number(pending.records[0].reservedUsd)).toBeGreaterThan(0.01);
        expect(existsSync(join(test.path, 'attempts/0001/reservation.json'))).toBe(true);
        expect(init?.redirect).toBe('error');
        return response();
      }),
    );
    start(test);
    expect(await (await test.adapter.fetch(url, request())).json()).toEqual(payload());
    expect(test.adapter.summary()).toMatchObject({
      attempts: 1,
      knownUsd: '0.00006',
      unknownReservedUsd: '0',
      chargedUsd: '0.00006',
      haltReason: null,
    });
    expect(ledger(test.path).records[0].state).toBe('known');
    expect(statSync(join(test.path, 'attempts/0001/request.json')).mode & 0o777).toBe(0o600);
    expect(allFiles(test.path)).not.toContain(key);
  });

  it('accepts additive usage metadata and missing thought count, without altering the candidate', async () => {
    const raw = payload({
      thoughtsTokenCount: undefined,
      totalTokenCount: 110,
      newMetadata: 'harmless',
      cachedContentTokenCount: 20,
    });
    const test = setup(
      {},
      vi.fn(async () => response(raw)),
    );
    start(test);
    await test.adapter.fetch(url, request());
    expect(test.adapter.summary().knownUsd).toBe('0.000055');
  });

  it.each([
    { totalTokenCount: 111 },
    { thoughtsTokenCount: -1 },
    { promptTokenCount: 0.5 },
    { serviceTier: 'priority' },
    { toolUsePromptTokenCount: 4 },
    { cachedContentTokenCount: 101 },
  ])('retains the full reservation and stops on unpriceable usage %j', async (usage) => {
    const test = setup(
      {},
      vi.fn(async () => response(payload(usage))),
    );
    start(test);
    await test.adapter.fetch(url, request());
    const state = ledger(test.path);
    expect(state.records[0].state).toBe('unknown');
    expect(test.adapter.summary()).toMatchObject({
      knownUsd: '0',
      chargedUsd: state.records[0].reservedUsd,
      haltReason: 'USAGE_UNKNOWN',
    });
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('HALTED');
    expect(test.native).toHaveBeenCalledTimes(1);
  });

  it('keeps model-schema failures with known usage as measured candidates, not retries', async () => {
    const raw = { ...payload(), candidates: [] };
    const test = setup(
      {},
      vi.fn(async () => response(raw)),
    );
    start(test);
    expect(await (await test.adapter.fetch(url, request())).json()).toEqual(raw);
    expect(test.adapter.summary().haltReason).toBeNull();
    test.adapter.endTrial();
    start(test, 'D02');
    await test.adapter.fetch(url, request());
    expect(test.adapter.summary().attempts).toBe(2);
  });

  it('counts each permitted continuation and preserves earlier known usage when a later request becomes unknown', async () => {
    const native = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ modelVersion: model, candidates: [] }));
    const test = setup({}, native);
    start(test);
    await test.adapter.fetch(url, request());
    const first = structuredClone(ledger(test.path).records[0]);
    await test.adapter.fetch(url, request());
    await test.adapter.fetch(url, request());
    const saved = ledger(test.path);
    expect(saved.records[0]).toEqual(first);
    expect(test.adapter.summary()).toMatchObject({
      attempts: 3,
      knownUsd: '0.00012',
      unknownReservedUsd: saved.records[2].reservedUsd,
      haltReason: 'USAGE_UNKNOWN',
    });
    expect(native).toHaveBeenCalledTimes(3);
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('HALTED');
  });

  it.each([400, 401, 403, 404, 429, 503])(
    'halts on HTTP %s, preserves accounting but never stores/returns raw errors',
    async (status) => {
      const test = setup(
        {},
        vi.fn(async () => response({ ...payload(), error: { message: `Do not log ${key}` } }, status)),
      );
      start(test);
      const result = await test.adapter.fetch(url, request());
      expect(result.status).toBe(status);
      expect(await result.text()).toBe('');
      expect(test.adapter.summary().haltReason).not.toBeNull();
      expect(existsSync(join(test.path, 'attempts/0001/response.json'))).toBe(false);
      expect(allFiles(test.path)).not.toContain(key);
      await expect(test.adapter.fetch(url, request())).rejects.toThrow('HALTED');
    },
  );

  it('records valid error-response usage without storing its body', async () => {
    const test = setup(
      {},
      vi.fn(async () => response({ ...payload(), error: { message: 'private raw detail' } }, 429)),
    );
    start(test);
    await test.adapter.fetch(url, request());
    expect(test.adapter.summary()).toMatchObject({ knownUsd: '0.00006', haltReason: 'PROVIDER_HTTP_ERROR' });
    expect(allFiles(test.path)).not.toContain('private raw detail');
  });

  it('preserves reservation on network failure and never exposes the raw cause', async () => {
    const test = setup(
      {},
      vi.fn(async () => {
        throw new TypeError(`secret ${key}`);
      }),
    );
    start(test);
    await expect(test.adapter.fetch(url, request())).rejects.toThrow(
      'COMPLETENESS_EVALUATION_TRANSPORT_ERROR',
    );
    expect(test.adapter.summary()).toMatchObject({
      attempts: 1,
      knownUsd: '0',
      haltReason: 'TRANSPORT_ERROR',
    });
    expect(allFiles(test.path)).not.toContain(key);
  });

  it('bounds streamed response bytes and retains unknown reservation', async () => {
    const test = setup(
      {},
      vi.fn(async () => new Response('x'.repeat(256 * 1024 + 1))),
    );
    start(test);
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('RESPONSE_TOO_LARGE');
    expect(test.adapter.summary().knownUsd).toBe('0');
    expect(existsSync(join(test.path, 'attempts/0001/response.json'))).toBe(false);
  });

  it('honors cancellation while reading a stalled body', async () => {
    const controller = new AbortController();
    const test = setup(
      {},
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start() {
                setTimeout(() => controller.abort(), 1);
              },
            }),
          ),
      ),
    );
    start(test);
    await expect(test.adapter.fetch(url, { ...request(), signal: controller.signal })).rejects.toThrow(
      'ABORTED',
    );
    expect(test.adapter.summary().haltReason).toBe('ABORTED');
  });

  it('charges actually reported over-reservation usage and stops rather than understating it', async () => {
    const test = setup(
      {},
      vi.fn(async () =>
        response(
          payload({
            promptTokenCount: 1_000_000,
            candidatesTokenCount: 100_000,
            thoughtsTokenCount: 0,
            totalTokenCount: 1_100_000,
          }),
        ),
      ),
    );
    start(test);
    await test.adapter.fetch(url, request());
    expect(test.adapter.summary()).toMatchObject({
      knownUsd: '0.55',
      chargedUsd: '0.55',
      haltReason: 'RESERVATION_EXCEEDED',
    });
  });

  it('rejects a changed returned model without silently pricing it', async () => {
    const test = setup(
      {},
      vi.fn(async () => response({ ...payload(), modelVersion: 'different-model' })),
    );
    start(test);
    await test.adapter.fetch(url, request());
    expect(test.adapter.summary()).toMatchObject({ knownUsd: '0', haltReason: 'USAGE_UNKNOWN' });
  });

  it('does not persist or return an echoed credential in a successful response', async () => {
    const test = setup(
      {},
      vi.fn(async () => response({ ...payload(), harmless: key })),
    );
    start(test);
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('CREDENTIAL_IN_RESPONSE');
    expect(allFiles(test.path)).not.toContain(key);
  });

  it('preserves known usage but rejects an HTTP200 provider error envelope without retaining the error body', async () => {
    const test = setup(
      {},
      vi.fn(async () => response({ ...payload(), error: { message: 'Private vendor diagnostic' } })),
    );
    start(test);
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('PROVIDER_ERROR_ENVELOPE');
    expect(test.adapter.summary()).toMatchObject({
      knownUsd: '0.00006',
      haltReason: 'PROVIDER_ERROR_ENVELOPE',
    });
    expect(allFiles(test.path)).not.toContain('Private vendor diagnostic');
  });
});

describe('admission, replay and restoration boundaries', () => {
  it('accounts for all three routes independently while preventing each trial replay', async () => {
    const test = setup();
    for (const route of ['composable', 'adaptive', 'complete'] as const) {
      const maxAttempts = route === 'composable' ? 2 : 3;
      test.adapter.beginTrial({ caseId: 'D01', route, maxAttempts });
      for (let i = 0; i < maxAttempts; i++) await test.adapter.fetch(url, request());
      test.adapter.endTrial();
      expect(() => test.adapter.beginTrial({ caseId: 'D01', route, maxAttempts })).toThrow('TRIAL_REPLAY');
    }
    expect(test.native).toHaveBeenCalledTimes(8);
    expect(test.adapter.summary()).toMatchObject({ attempts: 8, knownUsd: '0.00048', haltReason: null });
    expect(Object.keys(ledger(test.path).trials)).toEqual(['composable/D01', 'adaptive/D01', 'complete/D01']);
    expect(ledger(test.path).version).toBe('completeness-evaluation-v1');
    expect(test.adapter.close().state).toBe('closed');
  });

  it.each([
    ['composable', 2],
    ['adaptive', 3],
    ['complete', 3],
  ] as const)('caps %s at %i actual attempts, including repairs', async (route, maxAttempts) => {
    const test = setup();
    expect(() => test.adapter.beginTrial({ caseId: 'D01', route, maxAttempts: maxAttempts + 1 })).toThrow(
      'TRIAL_INVALID',
    );
    test.adapter.beginTrial({ caseId: 'D01', route, maxAttempts });
    for (let i = 0; i < maxAttempts; i++) await test.adapter.fetch(url, request());
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('TRIAL_ATTEMPTS_EXHAUSTED');
    expect(test.native).toHaveBeenCalledTimes(maxAttempts);
    expect(test.adapter.summary().attempts).toBe(maxAttempts);
  });

  it.each([
    ['development', 32, '0.20'],
    ['holdout', 128, '0.70'],
    ['overall maximum', 160, '0.90'],
  ])('honors the caller’s %s attempt ceiling across all routes', async (_phase, maxAttempts, ceilingUsd) => {
    const test = setup({ maxAttempts: Number(maxAttempts), ceilingUsd: String(ceilingUsd) });
    const routes = ['composable', 'adaptive', 'complete'] as const;
    for (let i = 0; i < Number(maxAttempts); i++) {
      test.adapter.beginTrial({ caseId: `C${i}`, route: routes[i % routes.length], maxAttempts: 1 });
      await test.adapter.fetch(url, request());
      test.adapter.endTrial();
    }
    test.adapter.beginTrial({ caseId: 'overflow', route: 'complete', maxAttempts: 3 });
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('BUDGET_EXHAUSTED');
    expect(test.native).toHaveBeenCalledTimes(Number(maxAttempts));
    expect(test.adapter.summary()).toMatchObject({ attempts: Number(maxAttempts), pending: 0 });
    const manifest = JSON.parse(readFileSync(join(test.path, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ maxAttempts: Number(maxAttempts), maxOutputTokens: 4000 });
    test.adapter.endTrial();
    expect(test.adapter.close().state).toBe('closed');
  });

  it.each([
    { maxAttempts: 161 },
    { ceilingUsd: '0.900000000001' },
    { inputUsdPerMillion: '0.15' },
    { outputUsdPerMillion: '1.25' },
    { maxRequestBytes: 256 * 1024 + 1 },
  ])('refuses config outside the fixed standard-rate envelope: %j', (config) => {
    expect(() => setup(config)).toThrow('COMPLETENESS_EVALUATION_INVALID_CONFIG');
  });

  it('honors a smaller dollar ceiling after known requests across routes', async () => {
    const test = setup(
      { ceilingUsd: '0.02' },
      vi.fn(async () =>
        response(payload({ candidatesTokenCount: 3500, thoughtsTokenCount: 2, totalTokenCount: 3602 })),
      ),
    );
    for (const route of ['composable', 'adaptive'] as const) {
      test.adapter.beginTrial({ caseId: 'D01', route, maxAttempts: 1 });
      await test.adapter.fetch(url, request());
      test.adapter.endTrial();
    }
    test.adapter.beginTrial({ caseId: 'D01', route: 'complete', maxAttempts: 3 });
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('BUDGET_EXHAUSTED');
    expect(test.native).toHaveBeenCalledTimes(2);
    expect(test.adapter.summary()).toMatchObject({ attempts: 2, chargedUsd: '0.01757', pending: 0 });
  });

  it.each(['cachedContent', 'googleSearch', 'urlContext'])(
    'rejects unsupported charged service %s before dispatch',
    async (service) => {
      const test = setup();
      test.adapter.beginTrial({ caseId: 'D01', route: 'complete', maxAttempts: 3 });
      const invalid =
        service === 'cachedContent'
          ? { ...body(), cachedContent: 'cachedContents/example' }
          : { ...body(), tools: [{ [service]: {} }] };
      await expect(test.adapter.fetch(url, { ...request(), body: JSON.stringify(invalid) })).rejects.toThrow(
        'REQUEST_INVALID',
      );
      expect(test.native).not.toHaveBeenCalled();
      expect(test.adapter.summary().attempts).toBe(0);
    },
  );

  it('does not permit nested accounting installations', () => {
    const first = setup();
    const second = setup();
    const restore = first.adapter.install();
    try {
      expect(() => second.adapter.install()).toThrow('ALREADY_INSTALLED');
    } finally {
      restore();
    }
    const secondRestore = second.adapter.install();
    secondRestore();
  });
  it.each(['url', 'key', 'method', 'cap', 'image', 'request_secret', 'escaped_secret', 'bytes'] as const)(
    'refuses %s before network or request snapshot',
    async (kind) => {
      const test = setup(kind === 'bytes' ? { maxRequestBytes: 2 } : {});
      start(test);
      const init = request();
      let target = url;
      if (kind === 'url') target += '?other=1';
      if (kind === 'key') init.headers = { 'content-type': 'application/json', 'x-goog-api-key': 'wrong' };
      if (kind === 'method') init.method = 'GET';
      if (kind === 'cap')
        init.body = JSON.stringify({ ...body(), generationConfig: { maxOutputTokens: 4001 } });
      if (kind === 'image')
        init.body = JSON.stringify({
          ...body(),
          generationConfig: { maxOutputTokens: 4000, responseModalities: ['IMAGE'] },
        });
      if (kind === 'request_secret')
        init.body = JSON.stringify({ ...body(), contents: [{ parts: [{ text: key }] }] });
      if (kind === 'escaped_secret')
        init.body = JSON.stringify({ ...body(), contents: [{ parts: [{ text: key }] }] }).replace(
          key,
          key.replace('s', '\\u0073'),
        );
      await expect(test.adapter.fetch(target, init)).rejects.toThrow('REQUEST_INVALID');
      expect(test.native).not.toHaveBeenCalled();
      expect(test.adapter.summary().attempts).toBe(0);
      expect(allFiles(test.path)).not.toContain(key);
    },
  );

  it('refuses mismatched credential fingerprint before creating a cohort', () => {
    expect(() => setup({ expectedKeySha256: '0'.repeat(64) })).toThrow('INVALID_CONFIG');
  });

  it('enforces decimal dollar reservation before invoking native fetch', async () => {
    const test = setup({ ceilingUsd: '0.001' });
    start(test);
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('BUDGET_EXHAUSTED');
    expect(test.native).not.toHaveBeenCalled();
    expect(test.adapter.summary().attempts).toBe(0);
  });

  it('does not let a caller mutate the installed spending ceiling', async () => {
    const test = setup({ ceilingUsd: '0.001' });
    start(test);
    test.config.ceilingUsd = '100';
    test.config.maxAttempts = 10000;
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('BUDGET_EXHAUSTED');
    expect(test.native).not.toHaveBeenCalled();
  });

  it('enforces both trial and cumulative attempt ceilings across cases', async () => {
    const test = setup({ maxAttempts: 2 });
    start(test, 'D01', 1);
    await test.adapter.fetch(url, request());
    test.adapter.endTrial();
    start(test, 'D02', 1);
    await test.adapter.fetch(url, request());
    test.adapter.endTrial();
    start(test, 'D03', 1);
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('BUDGET_EXHAUSTED');
    expect(test.native).toHaveBeenCalledTimes(2);
    const other = setup();
    start(other, 'D01', 1);
    await other.adapter.fetch(url, request());
    await expect(other.adapter.fetch(url, request())).rejects.toThrow('TRIAL_ATTEMPTS_EXHAUSTED');
    expect(other.native).toHaveBeenCalledTimes(1);
  });

  it('refuses concurrent calls, keeps the first reservation and disallows busy restoration', async () => {
    let finish!: (value: Response) => void;
    const test = setup(
      {},
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const restore = test.adapter.install();
    start(test);
    const first = globalThis.fetch(url, request());
    expect(() => restore()).toThrow('RESTORE_NOT_IDLE');
    await expect(globalThis.fetch(url, request())).rejects.toThrow('CONCURRENT_REQUEST');
    expect(test.native).toHaveBeenCalledTimes(1);
    finish(response());
    await first;
    expect(test.adapter.summary()).toMatchObject({ attempts: 1, haltReason: 'CONCURRENT_REQUEST' });
    test.adapter.endTrial();
    restore();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('cannot replay a trial, reinitialize a directory, or send after closure', async () => {
    const test = setup();
    start(test);
    await test.adapter.fetch(url, request());
    test.adapter.endTrial();
    expect(() => start(test)).toThrow('TRIAL_REPLAY');
    expect(() => createEvaluationTransport(test.config, test.native)).toThrow();
    expect(test.adapter.close().state).toBe('closed');
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('HALTED');
  });

  it('fails closed on missing/corrupt accounting state before spending', async () => {
    const test = setup();
    start(test);
    writeFileSync(join(test.path, 'ledger.json'), '{}');
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('STATE_CHANGED');
    expect(test.native).not.toHaveBeenCalled();
  });

  it('keeps a crash-visible reservation when a request snapshot changes during network work', async () => {
    let test: ReturnType<typeof setup>;
    test = setup(
      {},
      vi.fn(async () => {
        writeFileSync(join(test.path, 'attempts/0001/request.json'), '{}');
        return response();
      }),
    );
    start(test);
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('REQUEST_SNAPSHOT_CHANGED');
    expect(test.adapter.summary()).toMatchObject({
      attempts: 1,
      pending: 1,
      knownUsd: '0',
      haltReason: 'REQUEST_SNAPSHOT_CHANGED',
    });
    await expect(test.adapter.fetch(url, request())).rejects.toThrow('HALTED');
  });
});
