import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { AnalystConversation } from '../../shared/analyst';
import type { AnalystModelAttempt, AnalystModelReceipt } from '../../server/analyst-model';
import { readReferences, requireFixture, hash } from './references';

/** Frozen before execution: 6 conversations, 8 turns, 2 requested charts. Not the full 18-case suite. */
export const INITIAL_NATIVE_CASES = Object.freeze(['A01', 'A05', 'A06', 'A07', 'A11', 'A18']);
/** Separate predeclared extension: 10 conversations, 14 turns, 3 requested charts. */
export const EXTENDED_NATIVE_CASES = Object.freeze([...INITIAL_NATIVE_CASES, 'A08', 'A12', 'A14', 'A16']);
export type NativeCaseSet = 'matched' | 'extended';
export const NATIVE_CASE_SETS = Object.freeze({
  matched: Object.freeze({ caseIds: INITIAL_NATIVE_CASES, conversations: 6, turns: 8, requestedCharts: 2 }),
  extended: Object.freeze({
    caseIds: EXTENDED_NATIVE_CASES,
    conversations: 10,
    turns: 14,
    requestedCharts: 3,
  }),
});
type Service = {
  create(org: string, id: string): Promise<AnalystConversation>;
  send(org: string, id: string, messageId: string, text: string): Promise<AnalystConversation>;
  advance(org: string, id: string, requestId?: string): Promise<AnalystConversation>;
  get(org: string, id: string): Promise<AnalystConversation>;
  close(org: string, id: string): Promise<AnalystConversation>;
};
export type GlobalAnalystBudget = {
  /** Existing task ledger, including all prior known charges and unknown reservations; never reset per run. */
  snapshot(): Promise<{ scopeId: string; limitNanoUsd: number; consumedNanoUsd: number }>;
  beforeDispatch(attempt: AnalystModelAttempt): Promise<void>;
  afterResponse(receipt: AnalystModelReceipt): Promise<void>;
};
type FixtureAudit = {
  fingerprintBefore: string;
  fingerprintAfter: string;
  factChecks: number;
  referenceHashes: Record<string, string>;
};
type Binding = {
  sourceCommit: string;
  modelId: string;
  configurationSha256: string;
};
export type NativeRunOptions = {
  root?: string;
  /** Omitted preserves the original six-conversation matched subset. */
  caseSet?: NativeCaseSet;
  outputDirectory: string;
  binding: Binding;
  budget: GlobalAnalystBudget;
  /** Factory MUST forward both hooks to createNativeAnalystService's per-HTTP accounting hooks. */
  serviceFactory(options: {
    context: string;
    now: () => Date;
    beforeDispatch: (attempt: AnalystModelAttempt) => Promise<void>;
    afterResponse: (receipt: AnalystModelReceipt) => Promise<void>;
  }): Service;
  /** Read-only fixture verifier. It must never seed or reset during a model run. */
  verifyFixture(): Promise<FixtureAudit>;
  /** Return server-held query/results/meter/history evidence; never API keys or raw HTTP headers. */
  readRuntime(org: string, conversationId: string): Promise<unknown>;
};

const running = (state: AnalystConversation) => state.status === 'starting' || state.status === 'running';
const safeCode = (error: unknown) => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(code)
    ? code
    : 'NATIVE_EVALUATION_OPERATION_FAILED';
};
async function checkBudget(budget: GlobalAnalystBudget) {
  const value = await budget.snapshot();
  requireFixture(
    value.scopeId &&
      value.limitNanoUsd === 5_000_000_000 &&
      Number.isSafeInteger(value.consumedNanoUsd) &&
      value.consumedNanoUsd >= 0 &&
      value.consumedNanoUsd <= value.limitNanoUsd,
    'SHARED_FIVE_DOLLAR_BUDGET_REQUIRED',
  );
  return value;
}

/** Runs actual service operations. No ideal answers, alternate prompts or automatic failed-case retries. */
export async function runInitialNativeCases(options: NativeRunOptions) {
  const root = resolve(options.root ?? process.cwd());
  const output = resolve(options.outputDirectory);
  const caseSet = options.caseSet === undefined ? 'matched' : options.caseSet;
  requireFixture(caseSet === 'matched' || caseSet === 'extended', 'NATIVE_CASE_SET_REQUIRED');
  const selected = NATIVE_CASE_SETS[caseSet];
  requireFixture(output.startsWith(resolve(root, '.tools') + sep), 'PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
  requireFixture(
    /^[a-f0-9]{40}$/.test(options.binding.sourceCommit) &&
      /^[a-f0-9]{64}$/.test(options.binding.configurationSha256),
    'EXACT_SOURCE_AND_CONFIG_REQUIRED',
  );
  const refs = readReferences(root);
  const directory = resolve(root, 'tests/analyst-workspace-acceptance');
  const specification = JSON.parse(readFileSync(resolve(directory, 'cases.json'), 'utf8')) as {
    cases: { id: string; turns: { prompt: string; chartRequired: boolean }[] }[];
  };
  // Extract only actual user words. Requirements, forbidden answers and expected facts never enter the service.
  const cases = selected.caseIds.map((id) => {
    const entry = specification.cases.find((candidate) => candidate.id === id);
    requireFixture(entry, 'FROZEN_CASE_MISSING');
    return {
      id,
      turns: entry.turns.map((turn) => ({ prompt: turn.prompt, chartRequired: Boolean(turn.chartRequired) })),
    };
  });
  requireFixture(
    cases.length === selected.conversations &&
      cases.flatMap((entry) => entry.turns).length === selected.turns &&
      cases.flatMap((entry) => entry.turns).filter((turn) => turn.chartRequired).length ===
        selected.requestedCharts,
    'FROZEN_SUBSET_CHANGED',
  );
  const before = await options.verifyFixture();
  requireFixture(
    before.factChecks === 38 &&
      before.fingerprintBefore === before.fingerprintAfter &&
      JSON.stringify(before.referenceHashes) === JSON.stringify(refs.hashes),
    'FIXTURE_NOT_VERIFIED',
  );
  const budgetBefore = await checkBudget(options.budget);
  const sharedContext = readFileSync(resolve(directory, 'shared-context.md'), 'utf8');
  const context = `${sharedContext}\nFixed evaluation business date: ${refs.fixture.business_date}. Treat this as today in the organization's timezone.\n`;
  const attempted = new Set<string>();
  const hooks = {
    context,
    now: () => new Date(`${refs.fixture.business_date}T17:00:00.000Z`),
    beforeDispatch: async (attempt: AnalystModelAttempt) => {
      const snapshot = await checkBudget(options.budget);
      requireFixture(
        snapshot.scopeId === budgetBefore.scopeId &&
          !attempted.has(attempt.attemptId) &&
          Number.isSafeInteger(attempt.reservationNanoUsd) &&
          attempt.reservationNanoUsd > 0,
        'INVALID_GENERATION_RESERVATION',
      );
      requireFixture(
        snapshot.consumedNanoUsd + attempt.reservationNanoUsd <= snapshot.limitNanoUsd,
        'GLOBAL_ANALYST_BUDGET_EXHAUSTED',
      );
      // Root's ledger hook persists/locks the reservation before this resolves; unknown dispatches retain it.
      await options.budget.beforeDispatch(attempt);
      attempted.add(attempt.attemptId);
    },
    afterResponse: async (receipt: AnalystModelReceipt) => {
      requireFixture(attempted.has(receipt.attemptId), 'UNRESERVED_GENERATION_RECEIPT');
      await options.budget.afterResponse(receipt);
      await checkBudget(options.budget);
    },
  };
  const service = options.serviceFactory(hooks);
  mkdirSync(output, { mode: 0o700 }); // Exclusive cohort directory; never overwrite a previous run.
  const save = (name: string, data: unknown) =>
    writeFileSync(resolve(output, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const binding = {
    ...options.binding,
    referenceHashes: refs.hashes,
    organizationId: refs.fixture.organization_id,
    businessDate: refs.fixture.business_date,
    caseSet,
    caseIds: [...selected.caseIds],
    expectedConversations: selected.conversations,
    expectedTurns: selected.turns,
    requestedCharts: selected.requestedCharts,
    contextSha256: hash(context),
    budgetScopeId: budgetBefore.scopeId,
  };
  save('binding.json', binding);
  const outcomes: {
    caseId: string;
    turn: number;
    status: string;
    errorCode: string | null;
    elapsedMs: number;
    artifact: string | null;
    chartRequired: boolean;
  }[] = [];
  const startedAt = new Date().toISOString();
  let after: FixtureAudit | null = null;
  try {
    for (const entry of cases) {
      const conversationId = randomUUID();
      let caseFailed = false,
        created = false;
      try {
        await service.create(refs.fixture.organization_id, conversationId);
        created = true;
        for (const [index, turn] of entry.turns.entries()) {
          if (caseFailed) {
            outcomes.push({
              caseId: entry.id,
              turn: index + 1,
              status: 'not_run_after_failure',
              errorCode: null,
              elapsedMs: 0,
              artifact: null,
              chartRequired: turn.chartRequired,
            });
            continue;
          }
          const started = performance.now(),
            messageId = randomUUID();
          let state: AnalystConversation | null = null,
            errorCode: string | null = null;
          try {
            state = await service.send(refs.fixture.organization_id, conversationId, messageId, turn.prompt);
            let advances = 0;
            while (running(state) && advances < 64 && performance.now() - started < 300_000) {
              state = await service.advance(refs.fixture.organization_id, conversationId);
              advances++;
            }
            if (running(state)) errorCode = 'NATIVE_EVALUATION_DEADLINE';
            const userIndex = state.messages.findIndex(
              (message) => message.id === messageId && message.role === 'user',
            );
            if (
              state.status === 'completed' &&
              (userIndex < 0 ||
                !state.messages
                  .slice(userIndex + 1)
                  .some((message) => message.role === 'assistant' && message.content.trim()))
            )
              errorCode = 'MISSING_DELIVERED_ANSWER';
          } catch (error) {
            errorCode = safeCode(error);
          }
          state = await service.get(refs.fixture.organization_id, conversationId).catch(() => state);
          const artifact = `${entry.id.toLowerCase()}-turn-${index + 1}.json`;
          save(artifact, {
            ...binding,
            caseId: entry.id,
            turn: index + 1,
            conversationId,
            messageId,
            prompt: turn.prompt,
            state,
            runtime: await options.readRuntime(refs.fixture.organization_id, conversationId),
            errorCode,
          });
          const status = errorCode ? 'runner_error' : (state?.status ?? 'unavailable');
          outcomes.push({
            caseId: entry.id,
            turn: index + 1,
            status,
            errorCode,
            elapsedMs: Math.round(performance.now() - started),
            artifact,
            chartRequired: turn.chartRequired,
          });
          caseFailed = status !== 'completed';
        }
      } catch (error) {
        // Preserve failures including setup/trace failures. Never print raw provider or database errors.
        save(`${entry.id.toLowerCase()}-failure.json`, {
          caseId: entry.id,
          conversationId,
          code: safeCode(error),
        });
        for (const [index, turn] of entry.turns.entries())
          if (!outcomes.some((outcome) => outcome.caseId === entry.id && outcome.turn === index + 1))
            outcomes.push({
              caseId: entry.id,
              turn: index + 1,
              status: 'not_run_after_failure',
              errorCode: safeCode(error),
              elapsedMs: 0,
              artifact: null,
              chartRequired: turn.chartRequired,
            });
      } finally {
        if (created) {
          const state = await service.close(refs.fixture.organization_id, conversationId);
          const closed = running(state)
            ? await service.advance(refs.fixture.organization_id, conversationId)
            : state;
          save(`${entry.id.toLowerCase()}-closure.json`, { conversationId, status: closed.status });
          requireFixture(closed.status === 'closed', 'NATIVE_CONVERSATION_CLOSURE_REQUIRED');
        }
      }
    }
  } finally {
    after = await options.verifyFixture();
    const budgetAfter = await options.budget.snapshot();
    save('capture-summary.json', {
      ...binding,
      startedAt,
      finishedAt: new Date().toISOString(),
      outcomes,
      budgetBefore,
      budgetAfter,
      fingerprintBefore: before.fingerprintBefore,
      fingerprintAfter: after.fingerprintAfter,
      scoring:
        'UNREVIEWED. Completion is not correctness. Requested chart delivery remains pending actual browser/render evidence.',
    });
  }
  requireFixture(after?.fingerprintAfter === before.fingerprintBefore, 'EVALUATION_CHANGED_BOOKS');
  return {
    outputDirectory: output,
    caseSet,
    conversations: cases.length,
    turns: outcomes.length,
    completedTurns: outcomes.filter((outcome) => outcome.status === 'completed').length,
    dispatchedModelRequests: attempted.size,
    accuracyScore: null,
    status: 'CAPTURED_AWAITING_REVIEW' as const,
  };
}
