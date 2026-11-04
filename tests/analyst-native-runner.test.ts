import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runInitialNativeCases,
  INITIAL_NATIVE_CASES,
  EXTENDED_NATIVE_CASES,
  type GlobalAnalystBudget,
  type NativeCaseSet,
  type NativeRunOptions,
} from '../scripts/analyst-workspace-evaluation/native-runner';
import { readReferences } from '../scripts/analyst-workspace-evaluation/references';
import type { AnalystConversation } from '../shared/analyst';
import specification from '../tests/analyst-workspace-acceptance/cases.json';

// Scripted service boundary validates runner control flow only. No provider, SQL or model accuracy claim.
const root = process.cwd(),
  directories: string[] = [];
const refs = readReferences(root);
const audit = {
  fingerprintBefore: 'a'.repeat(64),
  fingerprintAfter: 'a'.repeat(64),
  factChecks: 38,
  referenceHashes: refs.hashes,
};
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function setup(options: { consumed?: number; failTurn?: number; corruptAfter?: boolean } = {}) {
  mkdirSync(resolve(root, '.tools'), { recursive: true });
  const outputDirectory = resolve(root, '.tools', `native-runner-test-${randomUUID()}`);
  directories.push(outputDirectory);
  let consumed = options.consumed ?? 0,
    audits = 0,
    factories = 0,
    dispatches = 0,
    sends = 0;
  const requests: { org: string; id: string; prompt: string }[] = [],
    closures: string[] = [];
  const snapshots = new Map<string, AnalystConversation>();
  const budget: GlobalAnalystBudget = {
    snapshot: async () => ({
      scopeId: 'existing-five-dollar-task',
      limitNanoUsd: 5_000_000_000,
      consumedNanoUsd: consumed,
    }),
    beforeDispatch: async (attempt) => {
      consumed += attempt.reservationNanoUsd;
    },
    afterResponse: async (receipt) => {
      if (receipt.kind === 'known') consumed += receipt.costNanoUsd - receipt.reservationNanoUsd;
    },
  };
  let receivedContext = '';
  const config: NativeRunOptions = {
    root,
    outputDirectory,
    budget,
    binding: {
      sourceCommit: 'b'.repeat(40),
      modelId: 'test-provider-never-called',
      configurationSha256: 'c'.repeat(64),
    },
    verifyFixture: async () => {
      audits++;
      return {
        ...audit,
        fingerprintAfter: options.corruptAfter && audits > 1 ? 'd'.repeat(64) : audit.fingerprintAfter,
      };
    },
    readRuntime: async () => ({
      nativeHistory: ['actual scripted messages'],
      nativeTurn: { results: [], meter: { attempts: [] } },
    }),
    serviceFactory: (hooks) => {
      factories++;
      receivedContext = hooks.context;
      expect(hooks.now().toISOString().startsWith('2026-11-03')).toBe(true);
      return {
        create: async (org, id) => {
          expect(org).toBe(refs.fixture.organization_id);
          const state: AnalystConversation = {
            id,
            provider: 'daybook',
            title: 'Test',
            sourceLabel: 'Fixture',
            status: 'idle',
            phase: null,
            messages: [],
            notebook: { cells: [], updatedAt: null },
            error: null,
            createdAt: '2026-11-03T17:00:00.000Z',
            updatedAt: '2026-11-03T17:00:00.000Z',
          };
          snapshots.set(id, state);
          return structuredClone(state);
        },
        get: async (_org, id) => structuredClone(snapshots.get(id)!),
        send: async (org, id, messageId, prompt) => {
          sends++;
          requests.push({ org, id, prompt });
          const state = snapshots.get(id)!;
          state.status = 'running';
          state.messages.push({ id: messageId, role: 'user', content: prompt, createdAt: state.createdAt });
          return structuredClone(state);
        },
        advance: async (_org, id) => {
          const state = snapshots.get(id)!;
          if (state.status === 'closed') return structuredClone(state);
          const attempt = {
            attemptId: randomUUID(),
            modelId: 'test-provider-never-called',
            requestBytes: 100,
            requestSha256: 'e'.repeat(64),
            continuationCarryTokens: 0,
            inputTokenReservation: 1000,
            outputTokenReservation: 1000,
            reservationNanoUsd: 30_000_000,
            reservationUsd: '0.030000000',
          };
          await hooks.beforeDispatch(attempt);
          dispatches++;
          await hooks.afterResponse({
            ...attempt,
            kind: 'unknown',
            reason: 'missing-usage',
            httpStatus: 200,
          });
          if (options.failTurn === sends) {
            state.status = 'failed';
            state.error = {
              code: 'SCRIPTED_FAILURE',
              message: 'Scripted service failure.',
              retryable: false,
            };
          } else {
            state.status = 'completed';
            state.messages.push({
              id: randomUUID(),
              role: 'assistant',
              content: 'Actual scripted reply; not an oracle answer.',
              createdAt: state.createdAt,
            });
          }
          return structuredClone(state);
        },
        close: async (_org, id) => {
          closures.push(id);
          const state = snapshots.get(id)!;
          state.status = 'closed';
          return structuredClone(state);
        },
      };
    },
  };
  return {
    config,
    requests,
    closures,
    context: () => receivedContext,
    dispatches: () => dispatches,
    consumed: () => consumed,
    audits: () => audits,
    factories: () => factories,
  };
}

describe('bounded native capture runner — no inference', () => {
  it.each([undefined, 'matched'] as const)(
    'preserves the matched subset with caseSet %s',
    async (caseSet) => {
      const test = setup();
      test.config.caseSet = caseSet;
      const receipt = await runInitialNativeCases(test.config);
      const expected = INITIAL_NATIVE_CASES.flatMap((id) =>
        specification.cases.find((entry) => entry.id === id)!.turns.map((turn) => turn.prompt),
      );
      expect(test.requests.map((request) => request.prompt)).toEqual(expected);
      expect(new Set(test.requests.map((request) => request.id)).size).toBe(6);
      expect(test.closures).toHaveLength(6);
      expect(receipt).toMatchObject({
        conversations: 6,
        turns: 8,
        completedTurns: 8,
        dispatchedModelRequests: 8,
        accuracyScore: null,
        caseSet: 'matched',
      });
      expect(test.context()).not.toContain('23427.65');
      expect(test.context()).not.toContain('requiredFacts');
      expect(test.context()).not.toContain('rent.monthly_shares');
      const secondTurn = JSON.parse(
        readFileSync(resolve(test.config.outputDirectory, 'a01-turn-2.json'), 'utf8'),
      );
      expect(secondTurn.state.messages[1].content).toBe('Actual scripted reply; not an oracle answer.');
      expect(
        secondTurn.state.messages.filter((message: { role: string }) => message.role === 'assistant'),
      ).toHaveLength(2);
      expect(test.consumed()).toBe(240_000_000); // All eight unknown receipts keep their full reservations.
      const binding = JSON.parse(readFileSync(resolve(test.config.outputDirectory, 'binding.json'), 'utf8'));
      expect(binding).toMatchObject({
        caseSet: 'matched',
        caseIds: [...INITIAL_NATIVE_CASES],
        expectedConversations: 6,
        expectedTurns: 8,
        requestedCharts: 2,
      });
    },
  );

  it('adds exactly the declared six turns and keeps every successful follow-up in its own conversation', async () => {
    const test = setup({ consumed: 921_913_500 });
    test.config.caseSet = 'extended';
    const receipt = await runInitialNativeCases(test.config);
    const ids = ['A01', 'A05', 'A06', 'A07', 'A11', 'A18', 'A08', 'A12', 'A14', 'A16'];
    expect(EXTENDED_NATIVE_CASES).toEqual(ids);
    const expected = ids.flatMap((id) =>
      specification.cases.find((entry) => entry.id === id)!.turns.map((turn) => turn.prompt),
    );
    expect(test.requests.map((request) => request.prompt)).toEqual(expected);
    expect(new Set(test.requests.map((request) => request.id)).size).toBe(10);
    expect(test.closures).toHaveLength(10);
    expect(test.dispatches()).toBe(14); // No extra/unused cases or skipped successful follow-ups.
    expect(receipt).toMatchObject({
      caseSet: 'extended',
      conversations: 10,
      turns: 14,
      completedTurns: 14,
      dispatchedModelRequests: 14,
      accuracyScore: null,
    });
    for (const id of ids) {
      const turns = specification.cases.find((entry) => entry.id === id)!.turns;
      let conversationId: string | undefined;
      for (const [index, turn] of turns.entries()) {
        const artifact = JSON.parse(
          readFileSync(
            resolve(test.config.outputDirectory, `${id.toLowerCase()}-turn-${index + 1}.json`),
            'utf8',
          ),
        );
        conversationId ??= artifact.conversationId;
        expect(artifact.conversationId).toBe(conversationId);
        expect(artifact.prompt).toBe(turn.prompt);
        expect(artifact.state.messages.map((message: { role: string }) => message.role)).toEqual(
          Array.from({ length: index + 1 }, () => ['user', 'assistant']).flat(),
        );
        expect(
          artifact.state.messages
            .filter((message: { role: string }) => message.role === 'user')
            .map((message: { content: string }) => message.content),
        ).toEqual(turns.slice(0, index + 1).map((value) => value.prompt));
      }
    }
    const context = readFileSync(
      resolve(root, 'tests/analyst-workspace-acceptance/shared-context.md'),
      'utf8',
    );
    expect(test.context()).toBe(
      `${context}\nFixed evaluation business date: 2026-11-03. Treat this as today in the organization's timezone.\n`,
    ); // No per-case rubrics, expected facts or answers enter the service.
    const summary = JSON.parse(
      readFileSync(resolve(test.config.outputDirectory, 'capture-summary.json'), 'utf8'),
    );
    expect(summary).toMatchObject({
      caseSet: 'extended',
      caseIds: ids,
      expectedConversations: 10,
      expectedTurns: 14,
      requestedCharts: 3,
      budgetBefore: { consumedNanoUsd: 921_913_500 },
      budgetAfter: { consumedNanoUsd: 1_341_913_500 },
    });
    expect(summary.outcomes).toHaveLength(14);
    expect(
      summary.outcomes.filter((outcome: { chartRequired: boolean }) => outcome.chartRequired),
    ).toHaveLength(3);
    expect(test.audits()).toBe(2);
  });

  it.each([null, 'all', 'Matched', {}, []].map((caseSet) => ({ caseSet })))(
    'rejects an undeclared caseSet before any service or fixture operation: $caseSet',
    async ({ caseSet }) => {
      const test = setup();
      test.config.caseSet = caseSet as NativeCaseSet;
      await expect(runInitialNativeCases(test.config)).rejects.toMatchObject({
        code: 'NATIVE_CASE_SET_REQUIRED',
      });
      expect(test.audits()).toBe(0);
      expect(test.factories()).toBe(0);
      expect(test.requests).toHaveLength(0);
      expect(test.dispatches()).toBe(0);
    },
  );

  it.each(['matched', 'extended'] as const)(
    'keeps the already-used global allowance for caseSet %s',
    async (caseSet) => {
      const test = setup({ consumed: 4_990_000_000 });
      test.config.caseSet = caseSet;
      const receipt = await runInitialNativeCases(test.config);
      expect(test.dispatches()).toBe(0);
      expect(test.consumed()).toBe(4_990_000_000);
      expect(receipt.dispatchedModelRequests).toBe(0);
      expect(receipt.completedTurns).toBe(0);
      const summary = JSON.parse(
        readFileSync(resolve(test.config.outputDirectory, 'capture-summary.json'), 'utf8'),
      );
      expect(summary.outcomes).toHaveLength(caseSet === 'extended' ? 14 : 8);
      expect(
        summary.outcomes.some(
          (outcome: { errorCode: string }) => outcome.errorCode === 'GLOBAL_ANALYST_BUDGET_EXHAUSTED',
        ),
      ).toBe(true);
    },
  );

  it('preserves an extended follow-up failure, skips its dependent next turn and never retries the failed prompt', async () => {
    const test = setup({ failTurn: 11 }); // A12's second turn after the original eight plus A08.
    test.config.caseSet = 'extended';
    const receipt = await runInitialNativeCases(test.config);
    const summary = JSON.parse(
      readFileSync(resolve(test.config.outputDirectory, 'capture-summary.json'), 'utf8'),
    );
    const a12 = specification.cases.find((entry) => entry.id === 'A12')!;
    expect(summary.outcomes.filter((outcome: { caseId: string }) => outcome.caseId === 'A12')).toMatchObject([
      { turn: 1, status: 'completed' },
      { turn: 2, status: 'failed' },
      { turn: 3, status: 'not_run_after_failure' },
    ]);
    expect(test.requests.filter((request) => request.prompt === a12.turns[1].prompt)).toHaveLength(1);
    expect(test.requests.some((request) => request.prompt === a12.turns[2].prompt)).toBe(false);
    expect(test.dispatches()).toBe(13);
    expect(test.closures).toHaveLength(10);
    expect(receipt).toMatchObject({ turns: 14, completedTurns: 12, dispatchedModelRequests: 13 });
    expect(
      summary.outcomes
        .slice(-2)
        .map((outcome: { caseId: string; status: string }) => [outcome.caseId, outcome.status]),
    ).toEqual([
      ['A14', 'completed'],
      ['A16', 'completed'],
    ]);
  });

  it('keeps the original failed turn and does not repeat it to improve the score', async () => {
    const test = setup({ failTurn: 1 });
    const receipt = await runInitialNativeCases(test.config);
    const summary = JSON.parse(
      readFileSync(resolve(test.config.outputDirectory, 'capture-summary.json'), 'utf8'),
    );
    expect(summary.outcomes[0]).toMatchObject({ caseId: 'A01', turn: 1, status: 'failed' });
    expect(summary.outcomes[1]).toMatchObject({ caseId: 'A01', turn: 2, status: 'not_run_after_failure' });
    expect(test.requests.filter((request) => request.id === test.requests[0].id)).toHaveLength(1);
    expect(receipt.turns).toBe(8);
    expect(receipt.accuracyScore).toBeNull();
  });

  it('fails the run when the independent after-fingerprint changes, while retaining captured evidence', async () => {
    const test = setup({ corruptAfter: true });
    await expect(runInitialNativeCases(test.config)).rejects.toThrow('EVALUATION_CHANGED_BOOKS');
    expect(
      JSON.parse(readFileSync(resolve(test.config.outputDirectory, 'capture-summary.json'), 'utf8'))
        .fingerprintAfter,
    ).toBe('d'.repeat(64));
  });
});
