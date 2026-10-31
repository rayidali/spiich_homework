import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CategoryBudget } from '../scripts/category-evaluation/budget';
import {
  queuedTransport,
  reportedUsage,
  type TransportObservation,
} from '../scripts/category-evaluation/transport';
import type { CategoryHttpRequest } from '../server/category-selector';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'daybook-dispatch-test-'));
  dirs.push(root);
  const dir = join(root, 'calls');
  mkdirSync(dir);
  const budget = new CategoryBudget(join(root, 'ledger.json'), 'a'.repeat(64), 'create');
  const observation: TransportObservation = {
    dispatched: false,
    httpStatus: null,
    networkMs: null,
    exitCode: null,
  };
  const controller = new AbortController();
  const request: CategoryHttpRequest = {
    provider: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'synthetic-test-key' },
    body: JSON.stringify({ generationConfig: { maxOutputTokens: 256 }, contents: ['synthetic'] }),
    signal: controller.signal,
    timeoutMs: 25000,
    maxResponseBytes: 131072,
  };
  return { dir, budget, observation, controller, request };
}
describe('Explicit provider dispatch transport', () => {
  it('prices observed standard metadata but retains unknown cost for other billing tiers', () => {
    const usage = { promptTokenCount: 757, candidatesTokenCount: 12, totalTokenCount: 769 };
    for (const serviceTier of [undefined, 'standard', 'unspecified']) {
      expect(reportedUsage('gemini', { usageMetadata: { ...usage, serviceTier } })).toEqual({
        inputTokens: 757,
        outputTokens: 12,
      });
    }
    for (const serviceTier of ['priority', 'flex', 'unknown', null, 1])
      expect(reportedUsage('gemini', { usageMetadata: { ...usage, serviceTier } })).toBeNull();
  });
  it('reserves before handing out a request, accounts for thinking and separates network latency', async () => {
    const { dir, budget, observation, request } = setup();
    const promise = queuedTransport(dir, 'dev:one', budget, observation)(request);
    const pending = JSON.parse(readFileSync(join(dir, 'pending.json'), 'utf8'));
    expect(budget.snapshot().records[0].state).toBe('pending');
    const response = {
      modelVersion: 'gemini-3.5-flash-lite',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5 },
      candidates: [],
    };
    writeFileSync(join(pending.directory, 'response.json'), JSON.stringify(response));
    writeFileSync(
      join(pending.directory, 'completion.json'),
      JSON.stringify({ dispatched: true, exitCode: 0, httpStatus: 200, networkMs: 330 }),
    );
    expect(await promise).toEqual({ status: 200, body: response });
    expect(budget.snapshot().records[0].usage).toEqual({ inputTokens: 100, outputTokens: 15 });
    expect(observation).toMatchObject({ dispatched: true, exitCode: 0, httpStatus: 200, networkMs: 330 });
    budget.release();
  });
  it('retains consumed unknown cost after an interrupted dispatch and never retries', async () => {
    const { dir, budget, observation, request, controller } = setup();
    const promise = queuedTransport(dir, 'dev:two', budget, observation)(request);
    const pending = JSON.parse(readFileSync(join(dir, 'pending.json'), 'utf8'));
    writeFileSync(join(pending.directory, 'claimed'), '');
    controller.abort();
    await expect(promise).rejects.toThrow('TRANSPORT_ABORTED');
    expect(observation.claimed).toBe(true);
    expect(observation.dispatched).toBe(false);
    expect(observation.localFailure).toBe('TRANSPORT_ABORTED');
    expect(budget.snapshot().records[0].state).toBe('unknown');
    expect(budget.snapshot().records[0].chargedUsd).toBe(budget.snapshot().records[0].reservedUsd);
    expect(() => budget.reserve('dev:two', 'gemini', request.body)).toThrow('BUDGET_REQUEST_USED');
    budget.release();
  });
  it('refuses changed endpoints before creating any reservation', async () => {
    const { dir, budget, observation, request } = setup();
    await expect(
      queuedTransport(dir, 'dev:three', budget, observation)({ ...request, url: 'https://example.com' }),
    ).rejects.toThrow('TRANSPORT_TARGET');
    expect(budget.snapshot().records).toEqual([]);
    budget.release();
  });
  it('retains a real HTTP failure classification when curl uses exit 22', async () => {
    const { dir, budget, observation, request } = setup();
    const promise = queuedTransport(dir, 'dev:http', budget, observation)(request);
    const pending = JSON.parse(readFileSync(join(dir, 'pending.json'), 'utf8'));
    writeFileSync(
      join(pending.directory, 'completion.json'),
      JSON.stringify({ dispatched: true, exitCode: 22, httpStatus: 503, networkMs: 90 }),
    );
    expect(await promise).toEqual({ status: 503, body: null });
    expect(observation.localFailure).toBeUndefined();
    expect(budget.snapshot().records[0].state).toBe('unknown');
    budget.release();
  });
  it('does not treat missing, invalid or unsafe usage as free', () => {
    expect(reportedUsage('gemini', {})).toBeNull();
    expect(
      reportedUsage('gemini', {
        usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 10000 },
      }),
    ).toBeNull();
    expect(
      reportedUsage('gemini', { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: -1 } }),
    ).toBeNull();
    expect(
      reportedUsage('jev', { usage: { input_tokens: 10, output_tokens: Number.MAX_SAFE_INTEGER + 1 } }),
    ).toBeNull();
    expect(reportedUsage('jev', { usage: { input_tokens: 10, output_tokens: 0 } })).toEqual({
      inputTokens: 10,
      outputTokens: 0,
    });
  });
});
