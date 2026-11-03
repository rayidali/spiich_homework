import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Decimal } from '../shared/money';
import { sha256, sourceBinding } from '../scripts/conversation-acceptance/protocol';
import {
  createEvaluationTransport,
  type ReservationBasis,
} from '../scripts/completion-repair-evaluation/transport';

// Every response is synthetic. These tests must never call a real provider.
const key = 'synthetic-count-preflight-key';
const model = 'gemini-3.5-flash-lite';
const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
const directories: string[] = [];
afterEach(() => {
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  vi.restoreAllMocks();
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const generation = (input = 1000, output = 10) =>
  json({
    modelVersion: model,
    usageMetadata: { promptTokenCount: input, candidatesTokenCount: output, totalTokenCount: input + output },
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Synthetic answer' }] } }],
  });
const request = (signal = new AbortController().signal): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({
    systemInstruction: { parts: [{ text: 'A complete synthetic system instruction.' }] },
    contents: [{ role: 'user', parts: [{ text: 'Synthetic context '.repeat(1500) }] }],
    tools: [
      {
        functionDeclarations: [{ name: 'review', description: 'Synthetic', parameters: { type: 'OBJECT' } }],
      },
    ],
    toolConfig: { functionCallingConfig: { mode: 'ANY' } },
    generationConfig: { maxOutputTokens: 4000, candidateCount: 1, thinkingConfig: { thinkingLevel: 'LOW' } },
  }),
  signal,
});
function setup(
  native: typeof fetch,
  ceilingUsd = '0.0220809',
  reservationBasis: ReservationBasis | null = 'gemini_count_tokens_plus_2048',
) {
  const base = mkdtempSync(join(tmpdir(), 'daybook-count-preflight-'));
  directories.push(base);
  const directory = join(base, 'transport');
  const adapter = createEvaluationTransport(
    {
      directory,
      model,
      apiKey: key,
      expectedKeySha256: sha256(key),
      ceilingUsd,
      maxAttempts: 4,
      maxRequestBytes: 262144,
      inputUsdPerMillion: '0.30',
      outputUsdPerMillion: '2.50',
      ...(reservationBasis ? { reservationBasis } : {}),
    },
    native,
  );
  adapter.beginTrial({ caseId: 'C02', route: 'composable', maxAttempts: 2 });
  return { adapter, directory };
}
const read = (directory: string, file: string) => JSON.parse(readFileSync(join(directory, file), 'utf8'));

it('binds a complete count request to the unchanged paid request and privately retains exact counter evidence', async () => {
  const native = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json({ totalTokens: 1000, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 1000 }] }),
    )
    .mockResolvedValueOnce(generation());
  const { adapter, directory } = setup(native, '0.011');
  const input = request();
  await expect(adapter.fetch(`${baseUrl}:generateContent`, input)).resolves.toHaveProperty('status', 200);
  expect(native).toHaveBeenCalledTimes(2);
  const [countUrl, countInit] = native.mock.calls[0];
  const [paidUrl, paidInit] = native.mock.calls[1];
  expect(countUrl).toBe(`${baseUrl}:countTokens`);
  expect(JSON.parse(String(countInit!.body))).toEqual({
    generateContentRequest: { ...JSON.parse(String(input.body)), model: `models/${model}` },
  });
  expect(countInit).toMatchObject({ method: 'POST', redirect: 'error' });
  expect(countInit!.signal).toBeInstanceOf(AbortSignal);
  expect(paidUrl).toBe(`${baseUrl}:generateContent`);
  expect(paidInit!.body).toBe(input.body);
  const evidence = read(directory, 'token-counts/0001/completion.json');
  expect(evidence).toMatchObject({
    generationRequestSha256: sha256(String(input.body)),
    requestSha256: sha256(String(countInit!.body)),
    responseSha256: sha256(readFileSync(join(directory, 'token-counts/0001/response.json'))),
    httpStatus: 200,
    totalTokens: 1000,
    inputReservationTokens: 3048,
    outputReservationTokens: 4000,
    failure: null,
  });
  const record = read(directory, 'attempts/0001/completion.json');
  expect(record.reservedUsd).toBe('0.0109144');
  expect(record.tokenCountEvidence).toEqual({
    path: 'token-counts/0001/completion.json',
    sha256: sha256(readFileSync(join(directory, 'token-counts/0001/completion.json'))),
    inputReservationTokens: 3048,
  });
  expect(adapter.summary()).toMatchObject({ attempts: 1, knownUsd: '0.000325', unknownReservedUsd: '0' });
  for (const file of readdirSync(join(directory, 'token-counts/0001'))) {
    const path = join(directory, 'token-counts/0001', file);
    expect(readFileSync(path, 'utf8')).not.toContain(key);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  }
});

it('retains historical byte reservation and makes no count request when omitted or explicitly selected', async () => {
  for (const basis of [null, 'utf8_bytes_plus_2048'] as const) {
    const native = vi.fn<typeof fetch>().mockResolvedValueOnce(generation());
    const { adapter, directory } = setup(native, '0.10', basis);
    const input = request();
    await adapter.fetch(`${baseUrl}:generateContent`, input);
    expect(native).toHaveBeenCalledTimes(1);
    expect(native.mock.calls[0][0]).toBe(`${baseUrl}:generateContent`);
    const reserved = new Decimal(Buffer.byteLength(String(input.body)) + 2048)
      .times('0.30')
      .plus(10000)
      .div(1e6)
      .toFixed();
    expect(read(directory, 'attempts/0001/reservation.json').reservedUsd).toBe(reserved);
    expect(read(directory, 'manifest.json')).not.toHaveProperty('reservationMode');
    expect(readdirSync(directory)).not.toContain('token-counts');
  }
});

it.each([
  ['HTTP error', () => json({ error: { message: 'Synthetic refusal' } }, 429)],
  ['error envelope', () => json({ totalTokens: 1000, error: {} })],
  ['missing count', () => json({})],
  ['zero count', () => json({ totalTokens: 0 })],
  ['negative count', () => json({ totalTokens: -1 })],
  ['fraction count', () => json({ totalTokens: 1000.1 })],
  ['string count', () => json({ totalTokens: '1000' })],
  ['oversized count', () => json({ totalTokens: 262145 })],
  ['unexpected caching', () => json({ totalTokens: 1000, cachedContentTokenCount: 1 })],
  [
    'unexpected media',
    () => json({ totalTokens: 1000, promptTokensDetails: [{ modality: 'IMAGE', tokenCount: 1000 }] }),
  ],
  ['malformed JSON', () => new Response('not JSON')],
  ['oversized declared body', () => new Response('{}', { headers: { 'content-length': '16385' } })],
  ['oversized actual body', () => new Response('x'.repeat(16385))],
] as const)(
  'never dispatches or reserves generation after %s in token counting',
  async (_label, response) => {
    const native = vi.fn<typeof fetch>().mockImplementationOnce(async () => response());
    const { adapter, directory } = setup(native);
    await expect(adapter.fetch(`${baseUrl}:generateContent`, request())).rejects.toThrow();
    expect(native).toHaveBeenCalledTimes(1);
    expect(adapter.summary()).toMatchObject({ attempts: 0, chargedUsd: '0', pending: 0 });
    expect(adapter.summary().haltReason).not.toBeNull();
    expect(read(directory, 'token-counts/0001/completion.json').failure).not.toBeNull();
    await expect(adapter.fetch(`${baseUrl}:generateContent`, request())).rejects.toThrow('HALTED');
    expect(native).toHaveBeenCalledTimes(1);
  },
);

it.each(['plain', 'escaped', 'invalid-utf8'] as const)(
  'never retains a %s credential echo from countTokens',
  async (form) => {
    const raw =
      form === 'plain'
        ? JSON.stringify({ totalTokens: 1000, echo: key })
        : form === 'escaped'
          ? `{"totalTokens":1000,"echo":"${key
              .split('')
              .map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
              .join('')}"}`
          : Buffer.concat([Buffer.from([0xff]), Buffer.from(key)]);
    const native = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(raw));
    const { adapter, directory } = setup(native);
    await expect(adapter.fetch(`${baseUrl}:generateContent`, request())).rejects.toThrow(
      'CREDENTIAL_IN_RESPONSE',
    );
    expect(
      readdirSync(join(directory, 'token-counts/0001')).some((file) => file.startsWith('response.')),
    ).toBe(false);
    expect(native).toHaveBeenCalledTimes(1);
    expect(adapter.summary().chargedUsd).toBe('0');
  },
);

it('refuses a paid dispatch when the actual counted reservation still exceeds the remaining cap', async () => {
  const native = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ totalTokens: 1000 }));
  const { adapter, directory } = setup(native, '0.0109');
  await expect(adapter.fetch(`${baseUrl}:generateContent`, request())).rejects.toThrow('BUDGET_EXHAUSTED');
  expect(native).toHaveBeenCalledTimes(1);
  expect(adapter.summary()).toMatchObject({ attempts: 0, chargedUsd: '0' });
  expect(read(directory, 'token-counts/0001/completion.json').totalTokens).toBe(1000);
});

it('retains the entire counted reservation after an unknown generation and cannot spend it again', async () => {
  const native = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ totalTokens: 1000 }))
    .mockResolvedValueOnce(json({}))
    .mockResolvedValueOnce(json({ totalTokens: 1000 }));
  const { adapter } = setup(native, '0.015');
  await expect(adapter.fetch(`${baseUrl}:generateContent`, request())).rejects.toThrow(
    'CELL_PROVIDER_FAILURE',
  );
  expect(adapter.summary()).toMatchObject({
    attempts: 1,
    unknownReservedUsd: '0.0109144',
    chargedUsd: '0.0109144',
  });
  adapter.endTrial();
  adapter.beginTrial({ caseId: 'C17', route: 'composable', maxAttempts: 2 });
  await expect(adapter.fetch(`${baseUrl}:generateContent`, request())).rejects.toThrow('BUDGET_EXHAUSTED');
  expect(native.mock.calls.map(([url]) => url)).toEqual([
    `${baseUrl}:countTokens`,
    `${baseUrl}:generateContent`,
    `${baseUrl}:countTokens`,
  ]);
  expect(adapter.summary().chargedUsd).toBe('0.0109144');
});

it('halts if actual prompt tokens exceed counted input plus framing even when the total cost fits', async () => {
  const native = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ totalTokens: 100 }))
    .mockResolvedValueOnce(generation(3000));
  const { adapter } = setup(native);
  await expect(adapter.fetch(`${baseUrl}:generateContent`, request())).rejects.toThrow(
    'RESERVATION_EXCEEDED',
  );
  expect(adapter.summary()).toMatchObject({
    attempts: 1,
    knownUsd: '0.000925',
    haltReason: 'RESERVATION_EXCEEDED',
  });
});

it('retains the immutable generation body even if its caller mutates the init object during counting', async () => {
  const input = request();
  const original = String(input.body);
  const native = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(async () => {
      input.body = '{}';
      input.headers = { 'x-goog-api-key': 'changed' };
      return json({ totalTokens: 1000 });
    })
    .mockResolvedValueOnce(generation());
  const { adapter } = setup(native);
  await adapter.fetch(`${baseUrl}:generateContent`, input);
  expect(native.mock.calls[1][1]!.body).toBe(original);
  expect(new Headers(native.mock.calls[1][1]!.headers).get('x-goog-api-key')).toBe(key);
});

it('blocks concurrent entry during counting and never follows it with generation', async () => {
  let complete!: (value: Response) => void;
  const native = vi.fn<typeof fetch>().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const { adapter } = setup(native);
  const first = adapter.fetch(`${baseUrl}:generateContent`, request());
  const rejected = expect(first).rejects.toThrow();
  await expect(adapter.fetch(`${baseUrl}:generateContent`, request())).rejects.toThrow('CONCURRENT_REQUEST');
  complete(json({ totalTokens: 1000 }));
  await rejected;
  expect(native).toHaveBeenCalledTimes(1);
  expect(adapter.summary()).toMatchObject({ attempts: 0, chargedUsd: '0', haltReason: 'CONCURRENT_REQUEST' });
});

it.each(['ledger', 'count-request'] as const)(
  'blocks generation if the %s snapshot changes during counting',
  async (target) => {
    let directory = '';
    const native = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
      writeFileSync(
        join(directory, target === 'ledger' ? 'ledger.json' : 'token-counts/0001/request.json'),
        '{}',
      );
      return json({ totalTokens: 1000 });
    });
    const setupResult = setup(native);
    directory = setupResult.directory;
    await expect(setupResult.adapter.fetch(`${baseUrl}:generateContent`, request())).rejects.toThrow();
    expect(native).toHaveBeenCalledTimes(1);
    expect(setupResult.adapter.summary()).toMatchObject({ attempts: 0, chargedUsd: '0' });
  },
);

it('stops before generation on an aborted count request', async () => {
  const controller = new AbortController();
  const native = vi.fn<typeof fetch>().mockImplementationOnce(async (_url, init) => {
    controller.abort();
    expect(init!.signal!.aborted).toBe(true);
    throw new Error('Synthetic abort');
  });
  const { adapter } = setup(native);
  await expect(adapter.fetch(`${baseUrl}:generateContent`, request(controller.signal))).rejects.toThrow(
    'TOKEN_COUNT_ABORTED',
  );
  expect(native).toHaveBeenCalledTimes(1);
  expect(adapter.summary()).toMatchObject({ attempts: 0, chargedUsd: '0' });
});

it('includes these safety tests in the source binding', () => {
  expect(sourceBinding().files).toHaveProperty('tests/conversation-token-count-reservation.test.ts');
});
