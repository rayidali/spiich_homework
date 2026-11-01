import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cases } from './conversation-acceptance/cases';
import { nativeLine } from '../scripts/conversation-acceptance/database';
import { createEvaluationTransport } from '../scripts/completion-repair-evaluation/transport';
import {
  databaseTarget,
  MAX_REQUEST_BYTES,
  preparation,
  reservationUsd,
  sha256,
  validateApproval,
} from '../scripts/conversation-acceptance/protocol';
import {
  globalStop,
  privateJson,
  runConversations,
  type TurnOutcome,
} from '../scripts/conversation-acceptance/runner';

const directories: string[] = [];
afterEach(() => {
  directories.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  vi.restoreAllMocks();
});
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), 'daybook-conversation-test-'));
  directories.push(d);
  return d;
};
const key = 'synthetic-conversation-key';
const model = 'gemini-3.5-flash-lite';
const request = () => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Synthetic fixture' }] }],
    tools: [],
    generationConfig: { maxOutputTokens: 4000 },
  }),
  signal: new AbortController().signal,
});
const providerResponse = () =>
  new Response(
    JSON.stringify({
      modelVersion: model,
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110 },
      candidates: [],
    }),
  );
function transport(first = providerResponse, ceilingUsd = '0.20') {
  const directory = join(folder(), 'transport');
  const native = vi.fn<typeof fetch>().mockImplementation(async () => first());
  return {
    native,
    directory,
    value: createEvaluationTransport(
      {
        directory,
        model,
        apiKey: key,
        expectedKeySha256: sha256(key),
        ceilingUsd,
        maxAttempts: 70,
        inputUsdPerMillion: '0.30',
        outputUsdPerMillion: '2.50',
        maxRequestBytes: MAX_REQUEST_BYTES,
      },
      native,
    ),
  };
}
function permit() {
  return {
    version: 'conversation-acceptance-approval-v1',
    authorization: 'explicit_user_approval_recorded_by_operator',
    cohort: 'conversation-development-20261101',
    sourceCommit: 'a'.repeat(40),
    sourceHash: 'b'.repeat(64),
    keySha256: sha256(key),
    artifactKeySha256: sha256('d'.repeat(64)),
    databaseName: 'daybook_conversation_tests',
    approvedAt: '2026-11-01T12:00:00Z',
    expiresAt: '2026-11-02T12:00:00Z',
    model,
    route: 'composable',
    businessDate: '2026-11-01',
    maxRequests: 35,
    maxAttempts: 70,
    maxRequestBytes: MAX_REQUEST_BYTES,
    maxOutputTokens: 4000,
    ceilingUsd: '0.20',
    inputUsdPerMillion: '0.30',
    outputUsdPerMillion: '2.50',
  };
}
const now = Date.parse('2026-11-01T13:00:00Z');

describe('new opt-in conversation runner: offline safety and orchestration', () => {
  it('binds a finite approval to exact source, key, pricing and validity window', () => {
    const raw = JSON.stringify(permit());
    expect(validateApproval(raw, sha256(raw), 'b'.repeat(64), key, now).ceilingUsd).toBe('0.20');
    expect(() => validateApproval(raw, '0'.repeat(64), 'b'.repeat(64), key, now)).toThrow('APPROVAL_HASH');
    expect(() => validateApproval(raw, sha256(raw), 'c'.repeat(64), key, now)).toThrow('SOURCE_DRIFT');
    expect(() => validateApproval(raw, sha256(raw), 'b'.repeat(64), 'different', now)).toThrow('KEY_BINDING');
    expect(() => validateApproval(raw, sha256(raw), 'b'.repeat(64), key, now + 3 * 86400000)).toThrow(
      'APPROVAL_TIME',
    );
  });
  it.each([
    { authorization: 'NOT_APPROVED' },
    { maxRequests: 36 },
    { maxAttempts: 71 },
    { ceilingUsd: '0.21' },
    { model: 'another-model' },
    { outputUsdPerMillion: '0.10' },
    { route: 'adaptive' },
  ])('rejects unapproved widening %j', (change) => {
    const raw = JSON.stringify({ ...permit(), ...change });
    expect(() => validateApproval(raw, sha256(raw), 'b'.repeat(64), key, now)).toThrow();
  });
  it('accepts only a distinct-owner local disposable database pair', () => {
    const owner = 'postgres://owner:synthetic@127.0.0.1:55432/daybook_conversation_tests';
    const runtime = 'postgres://spiich_app:synthetic@127.0.0.1:55432/daybook_conversation_tests';
    expect(databaseTarget(owner, runtime, 'daybook_conversation_tests')).toEqual({
      databaseName: 'daybook_conversation_tests',
    });
    expect(() => databaseTarget(owner, owner, 'daybook_conversation_tests')).toThrow('DISPOSABLE');
    expect(() =>
      databaseTarget(owner.replace('127.0.0.1', 'production.example'), runtime, 'daybook_conversation_tests'),
    ).toThrow('DISPOSABLE');
    expect(() =>
      databaseTarget(
        owner.replace('daybook_conversation_tests', 'spiich'),
        runtime.replace('daybook_conversation_tests', 'spiich'),
        'spiich',
      ),
    ).toThrow('DISPOSABLE');
    expect(() => databaseTarget(owner, `${runtime}?options=unsafe`, 'daybook_conversation_tests')).toThrow(
      'DISPOSABLE',
    );
  });
  it('keeps native EUR200, saved1.10 FX and USD220 distinct', () => {
    expect(
      nativeLine('oct-travel', { account: '6110', baseDebitCents: '22000', baseCreditCents: '0' }),
    ).toEqual({ debit: '200.00', credit: '0.00', exchangeRate: '1.10' });
    expect(
      nativeLine('oct-travel', { account: '1000', baseDebitCents: '0', baseCreditCents: '22000' }),
    ).toEqual({ debit: '0.00', credit: '220.00', exchangeRate: '1' });
    expect(() =>
      nativeLine('oct-travel', { account: '6110', baseDebitCents: '20000', baseCreditCents: '0' }),
    ).toThrow('FX_FIXTURE_CHANGED');
  });
  it('reserves from actual bytes and the whole output cap before dispatch', () => {
    expect(reservationUsd(1000)).toBe('0.0109144');
    expect(reservationUsd(MAX_REQUEST_BYTES)).toBe('0.0892576');
    expect(() => reservationUsd(MAX_REQUEST_BYTES + 1)).toThrow('REQUEST_BYTES');
  });
  it('never overwrites an outcome file', () => {
    const path = join(folder(), 'outcome.json');
    privateJson(path, { original: 'failure' });
    expect(() => privateJson(path, { replacement: 'pass' })).toThrow();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ original: 'failure' });
  });
  it('passes actual prior assistant responses into follow-ups, including an unhelpful one', async () => {
    const t = transport();
    const answers = ['A poor actual answer.', 'Another actual answer.', 'A final actual answer.'];
    const chat = vi.fn(async (_messages: unknown) => ({ answer: answers.shift(), evidence: [] }));
    const recorded: TurnOutcome[] = [];
    const summary = await runConversations({
      transport: t.value,
      chat,
      assess: () => ({ semanticReview: 'pending' }),
      beforeTurn: () => undefined,
      afterTurn: () => undefined,
      write: (o) => recorded.push(o),
      selectedCases: [cases[0]],
    });
    expect(chat.mock.calls[1][0]).toEqual([
      { role: 'user', content: cases[0].turns[0].user },
      { role: 'assistant', content: 'A poor actual answer.' },
      { role: 'user', content: cases[0].turns[1].user },
    ]);
    expect(summary).toMatchObject({
      requests: 3,
      executionComplete: true,
      semanticReview: 'pending',
      modelAccuracyEstablished: false,
    });
    expect(recorded).toHaveLength(3);
    expect(t.native).not.toHaveBeenCalled();
    t.value.close();
  });
  it('retains a failed turn in evidence while rolling back next-turn context like the UI', async () => {
    const t = transport();
    const chat = vi
      .fn<(_: unknown) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('synthetic failure'))
      .mockResolvedValue({ answer: 'Actual continuation.' });
    const recorded: TurnOutcome[] = [];
    await runConversations({
      transport: t.value,
      chat,
      assess: () => ({ semanticReview: 'pending' }),
      beforeTurn: () => undefined,
      afterTurn: () => undefined,
      write: (o) => recorded.push(o),
      selectedCases: [cases[0]],
    });
    expect(recorded[0].errorCode).toBe('CONVERSATION_ACCEPTANCE_EXECUTION_FAILED');
    expect(recorded[0].response).toBeNull();
    expect(recorded[0].messages).toEqual([{ role: 'user', content: cases[0].turns[0].user }]);
    expect(chat.mock.calls[1][0]).toEqual([{ role: 'user', content: cases[0].turns[1].user }]);
    t.value.close();
  });
  it('retains unknown usage reservation and halts before another conversation', async () => {
    const t = transport(() => new Response('{}'));
    const recorded: TurnOutcome[] = [];
    const summary = await runConversations({
      transport: t.value,
      chat: async () => {
        await t.value.fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          request(),
        );
        return { answer: 'Unreachable' };
      },
      assess: () => ({}),
      beforeTurn: () => undefined,
      afterTurn: () => undefined,
      write: (o) => recorded.push(o),
      selectedCases: [cases[1], cases[2]],
    });
    expect(summary).toMatchObject({ requests: 1, haltReason: 'USAGE_UNKNOWN', executionComplete: false });
    expect(recorded[0].errorCode).toBe('COMPLETENESS_EVALUATION_CELL_PROVIDER_FAILURE');
    expect(t.native).toHaveBeenCalledTimes(1);
    const closed = t.value.close();
    expect(Number(closed.unknownReservedUsd)).toBeGreaterThan(0);
    expect(closed.chargedUsd).toBe(closed.unknownReservedUsd);
  });
  it('refuses an unaffordable reservation before the network call', async () => {
    const t = transport(providerResponse, '0.001');
    const summary = await runConversations({
      transport: t.value,
      chat: async () => {
        await t.value.fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          request(),
        );
        return {};
      },
      assess: () => ({}),
      beforeTurn: () => undefined,
      afterTurn: () => undefined,
      write: () => undefined,
      selectedCases: [cases[1], cases[2]],
    });
    expect(summary.haltReason).toBe('BUDGET_EXHAUSTED');
    expect(t.native).not.toHaveBeenCalled();
    expect(t.value.close().chargedUsd).toBe('0');
  });
  it('halts after a detected book mutation and preserves its response', async () => {
    const t = transport();
    const recorded: TurnOutcome[] = [];
    const summary = await runConversations({
      transport: t.value,
      chat: async () => ({ answer: 'Actual answer' }),
      assess: () => ({}),
      beforeTurn: () => undefined,
      afterTurn: () => {
        throw new Error('CONVERSATION_ACCEPTANCE_BOOKS_CHANGED');
      },
      write: (o) => recorded.push(o),
      selectedCases: [cases[1], cases[2]],
    });
    expect(summary).toMatchObject({
      requests: 1,
      haltReason: 'CONVERSATION_ACCEPTANCE_BOOKS_CHANGED',
      executionComplete: false,
    });
    expect(recorded[0].response).toEqual({ answer: 'Actual answer' });
    t.value.close();
  });
  it('preserves pending semantic review even if numeric assessment throws', async () => {
    const t = transport();
    const recorded: TurnOutcome[] = [];
    await runConversations({
      transport: t.value,
      chat: async () => ({ answer: 'Actual answer' }),
      assess: () => {
        throw Error('bad shape');
      },
      beforeTurn: () => undefined,
      afterTurn: () => undefined,
      write: (o) => recorded.push(o),
      selectedCases: [cases[1]],
    });
    expect(recorded[0].assessment).toEqual({
      status: 'needs_review',
      reason: 'ASSESSOR_FAILED',
      semanticReview: 'pending',
    });
    t.value.close();
  });
  it('bounds application requests even if a caller supplies an oversized schedule', async () => {
    const t = transport();
    const selected = Array.from({ length: 36 }, (_, i) => ({ ...cases[1], id: `C${i + 1}` }));
    const summary = await runConversations({
      transport: t.value,
      chat: async () => ({ answer: 'Actual answer' }),
      assess: () => ({}),
      beforeTurn: () => undefined,
      afterTurn: () => undefined,
      write: () => undefined,
      selectedCases: selected,
    });
    expect(summary).toMatchObject({
      requests: 35,
      haltReason: 'CONVERSATION_ACCEPTANCE_REQUEST_CAP',
      executionComplete: false,
    });
    t.value.close();
  });
  it('never interprets a nonzero unknown reservation as remaining spendable credit', () => {
    expect(
      globalStop({
        state: 'open',
        attempts: 1,
        knownUsd: '0',
        unknownReservedUsd: '0.03',
        chargedUsd: '0.03',
        haltReason: null,
        pending: 0,
        activeTrial: null,
      }),
    ).toBe('USAGE_UNKNOWN');
  });
  it('prepares a source-bound proposal without reading provider credentials or dispatching requests', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw Error('No network allowed');
    });
    const result = preparation();
    expect(result).toMatchObject({
      status: 'NOT_APPROVED_NOT_EXECUTED',
      noSpend: true,
      cases: 31,
      requests: 35,
      maxAttempts: 70,
      proposedCeilingUsd: '0.20',
    });
    expect(result.source.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result).not.toHaveProperty('keySha256');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains a labeled general explanation in the next actual assistant turn', async () => {
    const t = transport();
    const chat = vi.fn(async (_messages: unknown) => ({
      answer: 'Your figures are shown above.',
      generalExplanation: {
        text: 'Cash and profit measure different things.',
        grounding: 'general_knowledge',
        verifiedFinancialData: false,
      },
    }));
    await runConversations({
      transport: t.value,
      chat,
      assess: () => ({}),
      beforeTurn: () => undefined,
      afterTurn: () => undefined,
      write: () => undefined,
      selectedCases: [cases[0]],
    });
    const messages = chat.mock.calls[1][0] as { role: string; content: string }[];
    expect(messages[1].content).toContain('Your figures are shown above.');
    expect(messages[1].content).toContain('Cash and profit measure different things.');
    t.value.close();
  });
  it('records an invalid explanation instead of silently dropping or trusting it', async () => {
    const t = transport();
    const recorded: TurnOutcome[] = [];
    await runConversations({
      transport: t.value,
      chat: async () => ({
        answer: 'Answer',
        generalExplanation: { text: 'Fake book claim', grounding: 'posted', verifiedFinancialData: true },
      }),
      assess: () => ({}),
      beforeTurn: () => undefined,
      afterTurn: () => undefined,
      write: (o) => recorded.push(o),
      selectedCases: [cases[1]],
    });
    expect(recorded[0].errorCode).toBe('CONVERSATION_ACCEPTANCE_INVALID_EXPLANATION');
    expect(recorded[0].response).toHaveProperty('generalExplanation.text', 'Fake book claim');
    t.value.close();
  });
  it('writes the actual answer and halts if trial finalization fails', async () => {
    const t = transport();
    const recorded: TurnOutcome[] = [];
    const broken = {
      ...t.value,
      endTrial: () => {
        t.value.endTrial();
        throw new Error('Failure after trial persist');
      },
    };
    const result = await runConversations({
      transport: broken,
      chat: async () => ({ answer: 'Keep this actual answer.' }),
      assess: () => ({}),
      beforeTurn: () => undefined,
      afterTurn: () => undefined,
      write: (o) => recorded.push(o),
      selectedCases: [cases[1], cases[2]],
    });
    expect(result).toMatchObject({
      requests: 1,
      executionComplete: false,
      haltReason: 'TRIAL_FINALIZATION_FAILED',
    });
    expect(recorded[0]).toMatchObject({
      response: { answer: 'Keep this actual answer.' },
      finalizationErrors: ['TRIAL_FINALIZATION_FAILED'],
    });
    t.value.close();
  });
  it('writes the actual failure and halts if the final transport summary fails', async () => {
    const t = transport();
    const recorded: TurnOutcome[] = [];
    let reads = 0;
    const broken = {
      ...t.value,
      summary: () => {
        if (++reads > 1) throw Error('Unreadable state');
        return t.value.summary();
      },
    };
    const result = await runConversations({
      transport: broken,
      chat: async () => {
        throw Error('Bad response');
      },
      assess: () => ({}),
      beforeTurn: () => undefined,
      afterTurn: () => undefined,
      write: (o) => recorded.push(o),
      selectedCases: [cases[1], cases[2]],
    });
    expect(result.haltReason).toBe('TRANSPORT_SUMMARY_FAILED');
    expect(recorded[0]).toMatchObject({
      errorCode: 'CONVERSATION_ACCEPTANCE_EXECUTION_FAILED',
      finalizationErrors: ['TRANSPORT_SUMMARY_FAILED'],
    });
    t.value.close();
  });
  it('halts rather than making a second request when an outcome cannot be persisted', async () => {
    const t = transport();
    const chat = vi.fn(async () => ({ answer: 'Actual answer' }));
    await expect(
      runConversations({
        transport: t.value,
        chat,
        assess: () => ({}),
        beforeTurn: () => undefined,
        afterTurn: () => undefined,
        write: () => {
          throw Error('Disk failure');
        },
        selectedCases: [cases[1], cases[2]],
      }),
    ).rejects.toThrow('OUTCOME_PERSISTENCE_FAILED');
    expect(chat).toHaveBeenCalledTimes(1);
    t.value.close();
  });
});
