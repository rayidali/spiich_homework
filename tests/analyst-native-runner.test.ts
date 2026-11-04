import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runInitialNativeCases,
  INITIAL_NATIVE_CASES,
  type GlobalAnalystBudget,
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
    verifyFixture: async () => ({
      ...audit,
      fingerprintAfter: options.corruptAfter && ++audits > 1 ? 'd'.repeat(64) : audit.fingerprintAfter,
    }),
    readRuntime: async () => ({
      nativeHistory: ['actual scripted messages'],
      nativeTurn: { results: [], meter: { attempts: [] } },
    }),
    serviceFactory: (hooks) => {
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
  };
}

describe('bounded native capture runner — no inference', () => {
  it('uses only the frozen exact prompts, distinct case conversations and real preceding replies', async () => {
    const test = setup();
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
  });

  it('respects already-used global allowance and never resets a fresh budget for the next case', async () => {
    const test = setup({ consumed: 4_990_000_000 });
    const receipt = await runInitialNativeCases(test.config);
    expect(test.dispatches()).toBe(0);
    expect(test.consumed()).toBe(4_990_000_000);
    expect(receipt.dispatchedModelRequests).toBe(0);
    expect(receipt.completedTurns).toBe(0);
    const summary = JSON.parse(
      readFileSync(resolve(test.config.outputDirectory, 'capture-summary.json'), 'utf8'),
    );
    expect(summary.outcomes).toHaveLength(8);
    expect(
      summary.outcomes.some(
        (outcome: { errorCode: string }) => outcome.errorCode === 'GLOBAL_ANALYST_BUDGET_EXHAUSTED',
      ),
    ).toBe(true);
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
