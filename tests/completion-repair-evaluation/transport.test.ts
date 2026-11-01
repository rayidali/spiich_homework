import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Decimal } from '../../shared/money';
import { sha256 } from '../../scripts/completion-repair-evaluation/protocol';
import { createEvaluationTransport } from '../../scripts/completion-repair-evaluation/transport';

const key = 'synthetic-repair-transport-key';
const model = 'gemini-3.5-flash-lite';
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
const good = () =>
  new Response(
    JSON.stringify({
      modelVersion: model,
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 },
      candidates: [
        { finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'show', args: {} } }] } },
      ],
    }),
  );
const request = (): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Synthetic test' }] }],
    tools: [],
    generationConfig: { maxOutputTokens: 4000 },
  }),
  signal: new AbortController().signal,
});
function setup(first: () => Response | Promise<Response>, ceilingUsd = '0.14') {
  const base = mkdtempSync(join(tmpdir(), 'daybook-repair-transport-'));
  directories.push(base);
  const directory = join(base, 'transport');
  const native = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(async () => await first())
    .mockImplementation(async () => good());
  const adapter = createEvaluationTransport(
    {
      directory,
      model,
      apiKey: key,
      expectedKeySha256: sha256(key),
      ceilingUsd,
      maxAttempts: 32,
      inputUsdPerMillion: '0.30',
      outputUsdPerMillion: '2.50',
      maxRequestBytes: 256 * 1024,
    },
    native,
  );
  const begin = (caseId: string) => adapter.beginTrial({ caseId, route: 'complete', maxAttempts: 3 });
  return { adapter, directory, native, begin };
}
it.each([400, 500, 503])(
  'records HTTP %s as a failed cell, retains its full reserve and continues only a distinct cell',
  async (status) => {
    const raw = JSON.stringify({
      error: {
        code: status,
        status: status === 400 ? 'INVALID_ARGUMENT' : 'INTERNAL',
        message: 'Synthetic provider failure',
      },
    });
    const { adapter, directory, native, begin } = setup(() => new Response(raw, { status }));
    begin('D01');
    await expect(adapter.fetch(url, request())).rejects.toThrow('CELL_PROVIDER_FAILURE');
    const failed = adapter.summary();
    expect(failed.haltReason).toBeNull();
    expect(new Decimal(failed.unknownReservedUsd).gt(0)).toBe(true);
    expect(readFileSync(join(directory, 'attempts/0001/response.json'), 'utf8')).toBe(raw);
    await expect(adapter.fetch(url, request())).rejects.toThrow('CELL_ALREADY_FAILED');
    expect(native).toHaveBeenCalledTimes(1);
    adapter.endTrial();
    begin('D02');
    expect((await adapter.fetch(url, request())).status).toBe(200);
    adapter.endTrial();
    expect(native).toHaveBeenCalledTimes(2);
    expect(() => begin('D01')).toThrow('TRIAL_REPLAY');
  },
);
it('continues a distinct scheduled cell after missing usage, with exact known plus unknown accounting', async () => {
  const { adapter, begin, native } = setup(() => new Response('{}'));
  begin('D01');
  await expect(adapter.fetch(url, request())).rejects.toThrow('CELL_PROVIDER_FAILURE');
  const unknown = adapter.summary().unknownReservedUsd;
  adapter.endTrial();
  begin('D02');
  expect((await adapter.fetch(url, request())).status).toBe(200);
  adapter.endTrial();
  const closed = adapter.close();
  expect(closed).toMatchObject({
    state: 'closed',
    attempts: 2,
    pending: 0,
    activeTrial: null,
    haltReason: null,
    unknownReservedUsd: unknown,
    knownUsd: '0.000055',
  });
  expect(closed.chargedUsd).toBe(new Decimal(unknown).plus('0.000055').toString());
  expect(native).toHaveBeenCalledTimes(2);
});
it.each([401, 402, 403, 404, 429])(
  'stops globally on HTTP %s without another provider attempt',
  async (status) => {
    const { adapter, begin, native } = setup(() => new Response('{}', { status }));
    begin('D01');
    await expect(adapter.fetch(url, request())).rejects.toThrow('PROVIDER_GLOBAL_ERROR');
    adapter.endTrial();
    expect(() => begin('D02')).toThrow('HALTED');
    expect(native).toHaveBeenCalledTimes(1);
    expect(adapter.close().unknownReservedUsd).not.toBe('0');
  },
);
it.each(['RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'UNAUTHENTICATED'])(
  'stops on provider-wide %s even with HTTP400',
  async (status) => {
    const { adapter, begin } = setup(
      () =>
        new Response(JSON.stringify({ error: { status, message: 'Provider-wide refusal' } }), {
          status: 400,
        }),
    );
    begin('D01');
    await expect(adapter.fetch(url, request())).rejects.toThrow('PROVIDER_GLOBAL_ERROR');
    expect(adapter.summary().haltReason).not.toBeNull();
  },
);
it('does not spend a retained unknown reservation again', async () => {
  const { adapter, begin, native } = setup(() => new Response('{}'), '0.011');
  begin('D01');
  await expect(adapter.fetch(url, request())).rejects.toThrow('CELL_PROVIDER_FAILURE');
  adapter.endTrial();
  begin('D02');
  await expect(adapter.fetch(url, request())).rejects.toThrow('BUDGET_EXHAUSTED');
  expect(native).toHaveBeenCalledTimes(1);
});
it('retains malformed bounded error bytes but never credential echoes, including invalid UTF8', async () => {
  const ordinary = setup(() => new Response('not json', { status: 400 }));
  ordinary.begin('D01');
  await expect(ordinary.adapter.fetch(url, request())).rejects.toThrow('CELL_PROVIDER_FAILURE');
  expect(readFileSync(join(ordinary.directory, 'attempts/0001/response.bin'), 'utf8')).toBe('not json');
  const secret = setup(
    () => new Response(Buffer.concat([Buffer.from([0xff]), Buffer.from(key)]), { status: 400 }),
  );
  secret.begin('D01');
  await expect(secret.adapter.fetch(url, request())).rejects.toThrow('CREDENTIAL_IN_RESPONSE');
  expect(
    readdirSync(join(secret.directory, 'attempts/0001')).some((file) => file.startsWith('response.')),
  ).toBe(false);
  expect(secret.adapter.summary().haltReason).toBe('CREDENTIAL_IN_RESPONSE');
});
it('stops globally on unresolved transport failure, preserving its reservation', async () => {
  const { adapter, begin } = setup(async () => {
    throw Error('synthetic connection loss');
  });
  begin('D01');
  await expect(adapter.fetch(url, request())).rejects.toThrow('TRANSPORT_ERROR');
  expect(adapter.summary()).toMatchObject({ haltReason: 'TRANSPORT_ERROR', pending: 0 });
  expect(adapter.summary().unknownReservedUsd).not.toBe('0');
});
