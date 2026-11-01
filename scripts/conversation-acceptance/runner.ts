import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { Decimal } from '../../shared/money';
import { assistantReplyContent } from '../../shared/conversation';
import { cases } from '../../tests/conversation-acceptance/cases';
import type { ConversationCase } from '../../tests/conversation-acceptance/schema';
import type { EvaluationTransportSummary } from '../completion-repair-evaluation/transport';
import { MAX_REQUESTS, requireCondition, safeCode } from './protocol';

export type Messages = { role: 'user' | 'assistant'; content: string }[];
type Transport = {
  beginTrial(trial: { caseId: string; route: 'composable'; maxAttempts: number }): void;
  endTrial(): void;
  summary(): EvaluationTransportSummary;
};
export type TurnOutcome = {
  caseId: string;
  turn: number;
  messages: Messages;
  response: unknown | null;
  errorCode: string | null;
  assessment: unknown;
  attemptsBefore: number;
  attemptsAfter: number;
  startedAt: string;
  finishedAt: string;
  finalizationErrors: string[];
};
export function privateJson(path: string, value: unknown) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function globalStop(summary: EvaluationTransportSummary) {
  if (summary.haltReason) return summary.haltReason;
  if (summary.pending) return 'PENDING_PROVIDER_ATTEMPT';
  if (new Decimal(summary.unknownReservedUsd).gt(0)) return 'USAGE_UNKNOWN';
  return null;
}

/** Injectable orchestration for offline tests; real run supplies actual financialChat. */
export async function runConversations(options: {
  transport: Transport;
  chat: (messages: Messages) => Promise<unknown>;
  assess: (item: ConversationCase, turn: number, response: unknown, messages: Messages) => unknown;
  beforeTurn: () => Promise<void> | void;
  afterTurn: () => Promise<void> | void;
  write: (outcome: TurnOutcome) => void;
  selectedCases?: ConversationCase[];
}) {
  let requests = 0;
  let haltReason: string | null = null;
  const outcomes: TurnOutcome[] = [];
  for (const item of options.selectedCases ?? cases) {
    const messages: Messages = [];
    for (const [turnIndex, turn] of item.turns.entries()) {
      try {
        requireCondition(requests < MAX_REQUESTS, 'REQUEST_CAP');
        await options.beforeTurn();
      } catch (error) {
        haltReason = safeCode(error);
        break;
      }
      const prior = options.transport.summary();
      haltReason = globalStop(prior);
      if (haltReason) break;
      const priorMessageCount = messages.length;
      messages.push({ role: 'user', content: turn.user });
      options.transport.beginTrial({
        caseId: `${item.id}-${turnIndex + 1}`,
        route: 'composable',
        maxAttempts: 2,
      });
      requests++;
      const outcome: TurnOutcome = {
        caseId: item.id,
        turn: turnIndex,
        messages: structuredClone(messages),
        response: null,
        errorCode: null,
        assessment: { status: 'not_assessed', semanticReview: 'pending' },
        attemptsBefore: prior.attempts,
        attemptsAfter: prior.attempts,
        startedAt: new Date().toISOString(),
        finishedAt: '',
        finalizationErrors: [],
      };
      try {
        outcome.response = await options.chat(structuredClone(messages));
        const response = outcome.response;
        if (
          response &&
          typeof response === 'object' &&
          'answer' in response &&
          typeof response.answer === 'string'
        ) {
          // Preserve exactly what the candidate said, including errors or poor replies.
          const explanation = 'generalExplanation' in response ? response.generalExplanation : undefined;
          if (
            explanation !== undefined &&
            (!explanation ||
              typeof explanation !== 'object' ||
              !('text' in explanation) ||
              typeof explanation.text !== 'string' ||
              !('grounding' in explanation) ||
              explanation.grounding !== 'general_knowledge' ||
              !('verifiedFinancialData' in explanation) ||
              explanation.verifiedFinancialData !== false)
          ) {
            outcome.errorCode = 'CONVERSATION_ACCEPTANCE_INVALID_EXPLANATION';
          } else {
            messages.push({
              role: 'assistant',
              content: assistantReplyContent(response.answer, explanation as { text: string } | undefined),
            });
          }
        } else outcome.errorCode = 'CONVERSATION_ACCEPTANCE_NO_ASSISTANT_ANSWER';
        try {
          outcome.assessment = options.assess(item, turnIndex, response, outcome.messages);
        } catch {
          outcome.assessment = {
            status: 'needs_review',
            reason: 'ASSESSOR_FAILED',
            semanticReview: 'pending',
          };
        }
      } catch (error) {
        outcome.errorCode =
          error &&
          typeof error === 'object' &&
          'code' in error &&
          typeof error.code === 'string' &&
          /^[A-Z_]{1,80}$/.test(error.code)
            ? error.code
            : safeCode(error);
      } finally {
        // The UI restores its prior conversation when a request fails. Keep the
        // attempted user turn in the outcome, but not in the next sent context.
        if (outcome.errorCode) messages.splice(priorMessageCount);
        try {
          options.transport.endTrial();
        } catch {
          outcome.finalizationErrors.push('TRIAL_FINALIZATION_FAILED');
        }
        let after: EvaluationTransportSummary | null = null;
        try {
          after = options.transport.summary();
          outcome.attemptsAfter = after.attempts;
        } catch {
          outcome.finalizationErrors.push('TRANSPORT_SUMMARY_FAILED');
        }
        outcome.finishedAt = new Date().toISOString();
        // Preserve the response even if transport-state finalization failed.
        try {
          options.write(outcome);
        } catch {
          throw new Error('CONVERSATION_ACCEPTANCE_OUTCOME_PERSISTENCE_FAILED');
        }
        outcomes.push(outcome);
        haltReason =
          outcome.finalizationErrors[0] ?? (after ? globalStop(after) : 'TRANSPORT_SUMMARY_FAILED');
      }
      try {
        await options.afterTurn();
      } catch (error) {
        haltReason ??= safeCode(error);
      }
      if (haltReason) break;
    }
    if (haltReason) break;
  }
  return {
    requests,
    recordedTurns: outcomes.length,
    plannedTurns: (options.selectedCases ?? cases).reduce((sum, c) => sum + c.turns.length, 0),
    executionComplete:
      haltReason === null &&
      requests === (options.selectedCases ?? cases).reduce((sum, c) => sum + c.turns.length, 0),
    haltReason,
    semanticReview: 'pending' as const,
    modelAccuracyEstablished: false,
  };
}

export function outcomeWriter(directory: string) {
  mkdirSync(join(directory, 'outcomes'), { mode: 0o700 });
  return (outcome: TurnOutcome) =>
    privateJson(join(directory, 'outcomes', `${outcome.caseId}-${outcome.turn + 1}.json`), outcome);
}
