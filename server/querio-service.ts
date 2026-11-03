import { randomUUID } from 'node:crypto';
import type { AnalystAvailability, AnalystConversation } from '../shared/analyst';
import { type AnalystStore, postgresAnalystStore } from './analyst-store';
import { AppError } from './errors';
import {
  createQuerioClient,
  object,
  querioSettings,
  remoteId,
  type QuerioRequest,
  type QuerioSettings,
} from './querio-client';
import { normalizeQuerioOutput } from './querio-output';
import { diagnostic } from './diagnostics';

const sourceLabel = 'Daybook live books';
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'canceled']);
const instructions = `You are the financial analyst inside Daybook. Use only the selected live Daybook datasource, never a synthetic benchmark or sample datasource. Read its accounting context. Use the organization's business timezone for today. Investigate freely with read-only SQL and calculations. Answer the user's actual question, retain conversation context, and state useful assumptions instead of asking repetitive questions. Inspect drafts when they explain missing records, but keep them separate from posted totals. Consulting income is not proof of zero consulting expenditure; explain the category ambiguity. Existing anomaly alerts are not an exhaustive search for every unusual transaction. For recorded figures, execute the queries and retain their tables, calculations and useful charts in this notebook. Use exact SQL NUMERIC or Decimal for financial arithmetic. Check your final prose against executed results. Do not edit shared workspace files. Saved notebook cells may need rerunning after a new session; do not assume live Python variables survived. Be clear and concise, and identify date range and datasource. Never claim a chart, table or calculation was created unless it is present in the saved notebook.`;

export type QuerioService = ReturnType<typeof createQuerioService>;
export function createQuerioService(
  options: {
    store?: AnalystStore;
    settings?: () => QuerioSettings | null;
    request?: QuerioRequest;
    now?: () => Date;
  } = {},
) {
  const store = options.store ?? postgresAnalystStore;
  const settings = options.settings ?? querioSettings;
  const now = options.now ?? (() => new Date());
  function configured() {
    const current = settings();
    if (!current)
      throw new AppError(
        503,
        'AI_NOT_CONFIGURED',
        'Querio is not connected to this Daybook installation yet.',
      );
    return { current, request: options.request ?? createQuerioClient(current) };
  }
  function availability(): AnalystAvailability {
    const current = settings();
    return {
      available: Boolean(current),
      provider: 'querio',
      sourceLabel,
      modelLabel: current?.model ?? (current ? 'Querio default model' : null),
    };
  }
  async function create(org: string, id: string): Promise<AnalystConversation> {
    configured();
    const stamp = now().toISOString();
    return (
      await store.create(org, {
        id,
        provider: 'querio',
        title: 'New analysis',
        sourceLabel,
        status: 'idle',
        phase: null,
        messages: [],
        notebook: { cells: [], updatedAt: null },
        error: null,
        createdAt: stamp,
        updatedAt: stamp,
      })
    ).state;
  }
  async function get(org: string, id: string) {
    return (await store.read(org, id, 'querio')).state;
  }
  async function send(org: string, id: string, messageId: string, text: string, requestId?: string) {
    configured();
    await store.queue(org, id, 'querio', messageId, text);
    return refresh(org, id, requestId);
  }

  async function refresh(org: string, id: string, requestId?: string): Promise<AnalystConversation> {
    const { current, request } = configured();
    const claimed = await store.claim(org, id, 'querio');
    if (!claimed) return get(org, id);
    const { token, record } = claimed;
    const runtime = record.runtime;
    const save = async () => {
      record.state.updatedAt = now().toISOString();
      await store.save(org, id, token, record);
      diagnostic('ai_analyst_operation', {
        provider: 'querio',
        conversationId: id,
        runId: typeof runtime.runId === 'string' ? runtime.runId : undefined,
        analystStage: typeof runtime.stage === 'string' ? runtime.stage : undefined,
        code: record.state.error?.code,
      });
    };
    const path = (kind: string, value: unknown, suffix = '') => `/${kind}/${remoteId(value)}${suffix}`;
    const mutate = async (stage: string, method: 'POST' | 'DELETE', endpoint: string, body?: unknown) => {
      runtime.pendingMutation = stage;
      await save();
      try {
        const response = await request(method, endpoint, body);
        if (['environment', 'notebook', 'session', 'agent'].includes(stage)) remoteId(response.id);
        if (stage === 'submit') remoteId(response.runId);
        delete runtime.pendingMutation;
        return response;
      } catch (error) {
        const status = error instanceof AppError ? object(error.details).upstreamStatus : undefined;
        // Owned resource deletion is idempotent. A lost prior DELETE response can leave a 404/410.
        if (method === 'DELETE' && (status === 404 || status === 410)) {
          delete runtime.pendingMutation;
          return {};
        }
        if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408)
          delete runtime.pendingMutation; // Explicit rejection, not an unknown accepted write.
        throw error;
      }
    };
    try {
      if (!['starting', 'running'].includes(record.state.status)) return record.state;
      if (runtime.closeRequested && runtime.pendingMutation) {
        // A deliberate stop may abandon uncertain setup, but never repeats its prompt.
        delete runtime.pendingMutation;
        runtime.stage = runtime.runId && !runtime.answerSaved ? 'cancel' : 'close-agent';
        await save();
      }
      if (
        ['close-agent', 'close-session', 'close-environment', 'cancel'].includes(
          String(runtime.pendingMutation),
        )
      ) {
        // These operations only stop owned resources. Repeating them cannot resubmit a prompt.
        delete runtime.pendingMutation;
        await save();
      }
      if (runtime.pendingMutation) {
        // A response may have been lost after upstream accepted a message. Reconcile, never replay it.
        if (runtime.pendingMutation === 'submit' && runtime.agentId) {
          const listed = await request('GET', path('agent-sessions', runtime.agentId, '/runs?limit=100'));
          const runs = Array.isArray(listed.items) ? listed.items.map(object) : [];
          const match = runs.filter((run) => {
            const input = object(run.input);
            return (
              (input.prompt === record.lastMessageText || input.text === record.lastMessageText) &&
              typeof run.createdAt === 'string' &&
              run.createdAt >= String(runtime.submittedAt)
            );
          });
          if (match.length === 1) {
            runtime.runId = remoteId(match[0].id);
            runtime.stage = 'run';
            delete runtime.pendingMutation;
            record.state.status = 'running';
            await save();
          }
        }
        if (runtime.pendingMutation) {
          if (
            runtime.pendingMutation === 'submit' &&
            now().getTime() - Date.parse(String(runtime.submittedAt)) < 30000
          )
            return record.state;
          throw new AppError(
            503,
            'AI_REQUEST_REJECTED',
            'The previous operation was interrupted before its result could be confirmed. Your question will not be sent again automatically. Start a new conversation or share this reference for investigation.',
          );
        }
      }
      const started = performance.now();
      // Each HTTP request advances at most two remote steps; long analyses survive serverless limits.
      for (let step = 0; step < 2 && performance.now() - started < 20000; step++) {
        if (!['starting', 'running'].includes(record.state.status)) break;
        if (
          runtime.closeRequested &&
          !['cancel', 'run', 'results', 'close-agent', 'close-session', 'close-environment', 'done'].includes(
            String(runtime.stage),
          )
        ) {
          runtime.stage = runtime.runId && !runtime.answerSaved ? 'cancel' : 'close-agent';
          record.state.status = 'running';
          record.state.phase = 'Closing this analysis';
        }
        if (runtime.closeRequested && runtime.stage === 'run' && !runtime.cancelRequested)
          runtime.stage = 'cancel';
        if (runtime.closeRequested && runtime.stage === 'done') runtime.stage = 'close-agent';
        const stage = runtime.stage;
        if (
          record.state.status === 'starting' &&
          now().getTime() - Date.parse(String(runtime.startedAt)) > 120000
        ) {
          runtime.failed = true;
          runtime.stage = 'close-agent';
          record.state.status = 'running';
          record.state.error = {
            code: 'AI_TIMEOUT',
            message: 'Querio took too long to open the analysis. No question was submitted.',
            requestId,
            retryable: true,
          };
          await save();
          continue;
        }
        if (stage === 'environment') {
          const response = await mutate('environment', 'POST', '/execution-environments', {});
          runtime.environmentId = remoteId(response.id);
          runtime.stage = runtime.notebookId ? 'session' : 'notebook';
        } else if (stage === 'notebook') {
          const response = await mutate('notebook', 'POST', '/notebooks', { title: record.state.title });
          runtime.notebookId = remoteId(response.id);
          runtime.stage = 'session';
        } else if (stage === 'session') {
          const response = await mutate('session', 'POST', '/notebook-sessions', {
            notebookId: remoteId(runtime.notebookId),
            environmentId: remoteId(runtime.environmentId),
            mode: 'edit',
            config: { datasourceSlugs: [current.datasource], variables: {} },
          });
          runtime.sessionId = remoteId(response.id);
          runtime.stage = 'session-ready';
        } else if (stage === 'session-ready') {
          const response = await request('GET', path('notebook-sessions', runtime.sessionId));
          if (response.state === 'failed' || response.state === 'closed')
            throw new AppError(502, 'AI_PROVIDER_ERROR', 'Querio could not open the analysis notebook.');
          if (response.state !== 'ready') break;
          runtime.stage = 'agent';
        } else if (stage === 'agent') {
          const response = await mutate('agent', 'POST', '/agent-sessions', {
            id: remoteId(runtime.notebookId),
            environmentId: remoteId(runtime.environmentId),
            notebookSessionId: remoteId(runtime.sessionId),
            config: {
              ...(current.model ? { model: current.model } : {}),
              instructions,
              datasourceSlugs: [current.datasource],
              extensions: [],
            },
          });
          runtime.agentId = remoteId(response.id);
          runtime.stage = 'agent-ready';
        } else if (stage === 'agent-ready') {
          const response = await request('GET', path('agent-sessions', runtime.agentId));
          if (response.state === 'failed' || response.state === 'closed')
            throw new AppError(502, 'AI_PROVIDER_ERROR', 'Querio could not start the analyst.');
          if (response.state && response.state !== 'ready' && response.state !== 'idle') break;
          runtime.stage = 'submit';
        } else if (stage === 'submit') {
          runtime.submittedAt = now().toISOString();
          const response = await mutate(
            'submit',
            'POST',
            path('agent-sessions', runtime.agentId, '/events'),
            {
              type: 'message',
              data: { text: record.lastMessageText },
            },
          );
          runtime.runId = remoteId(response.runId);
          runtime.stage = 'run';
          record.state.status = 'running';
          record.state.phase = 'Querio is checking your books';
        } else if (stage === 'run') {
          const response = await request('GET', path('runs', runtime.runId));
          if (!TERMINAL.has(String(response.status))) {
            if (
              !runtime.cancelRequested &&
              now().getTime() - Date.parse(String(runtime.submittedAt)) > 240000
            ) {
              runtime.stopRequested = true;
              runtime.stage = 'cancel';
              record.state.phase = 'Stopping an analysis that took too long';
              await save();
              continue;
            }
            break;
          }
          if (response.status !== 'completed') {
            runtime.failed = true;
            record.state.error = {
              code: 'AI_PROVIDER_ERROR',
              message: 'Querio could not finish this answer. Any previous results remain available.',
              requestId,
              retryable: true,
            };
            runtime.stage = 'close-agent';
          } else {
            // Keep only bounded renderable output; raw provider traces remain at Querio.
            runtime.output = response.output;
            runtime.stage = 'results';
            record.state.phase = 'Saving the answer and notebook';
          }
        } else if (stage === 'results') {
          const notebook = await request('GET', path('notebooks', runtime.notebookId));
          const normalized = normalizeQuerioOutput({ status: 'completed', output: runtime.output }, notebook);
          if (!normalized.answer.trim())
            throw new AppError(
              502,
              'AI_INVALID_RESPONSE',
              'Querio finished without a readable answer. Open its notebook to inspect the saved work.',
            );
          if (!runtime.answerSaved) {
            record.state.messages.push({
              id: randomUUID(),
              role: 'assistant',
              content: normalized.answer,
              createdAt: now().toISOString(),
            });
            runtime.answerSaved = true;
          }
          record.state.notebook = {
            cells: normalized.cells,
            updatedAt: now().toISOString(),
            externalUrl: `https://app.querio.ai/wx/${current.workspaceId}/explore/${remoteId(runtime.notebookId)}`,
          };
          if (normalized.warnings.length)
            record.state.notebook.cells.push({
              id: 'display-notices',
              title: 'Display notes',
              code: '',
              outputs: normalized.warnings.map((text) => ({ type: 'notice' as const, text })),
            });
          delete runtime.output;
          runtime.stage = 'close-agent';
        } else if (stage === 'cancel') {
          const existing = await request('GET', path('runs', runtime.runId));
          if (!TERMINAL.has(String(existing.status))) {
            try {
              await mutate('cancel', 'POST', path('runs', runtime.runId, '/cancel'), {});
            } catch (error) {
              if (!(error instanceof AppError) || object(error.details).upstreamStatus !== 409) throw error;
              delete runtime.pendingMutation;
            }
          }
          runtime.cancelRequested = true;
          runtime.stage = 'run';
        } else if (stage === 'close-agent') {
          if (runtime.agentId) await mutate('close-agent', 'DELETE', path('agent-sessions', runtime.agentId));
          delete runtime.agentId;
          runtime.stage = 'close-session';
        } else if (stage === 'close-session') {
          if (runtime.sessionId)
            await mutate('close-session', 'DELETE', path('notebook-sessions', runtime.sessionId));
          delete runtime.sessionId;
          runtime.stage = 'close-environment';
        } else if (stage === 'close-environment') {
          if (runtime.environmentId)
            await mutate(
              'close-environment',
              'DELETE',
              path('execution-environments', runtime.environmentId),
            );
          delete runtime.environmentId;
          runtime.stage = 'done';
          record.state.status = runtime.closeRequested ? 'closed' : runtime.failed ? 'failed' : 'completed';
          record.state.phase = null;
        } else break;
        if (!runtime.failed) record.state.error = null;
        await save();
      }
      return record.state;
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'AI_PROVIDER_ERROR';
      const canPollAgain =
        !runtime.pendingMutation && ['AI_CONNECTION_ERROR', 'AI_RATE_LIMIT'].includes(code);
      const reconcileSubmission =
        runtime.pendingMutation === 'submit' && ['AI_CONNECTION_ERROR', 'AI_INVALID_RESPONSE'].includes(code);
      const retryCleanup = ['close-agent', 'close-session', 'close-environment', 'cancel'].includes(
        String(runtime.pendingMutation),
      );
      const needsCleanup =
        !runtime.pendingMutation &&
        !canPollAgain &&
        !!(runtime.environmentId || runtime.sessionId || runtime.agentId) &&
        !String(runtime.stage).startsWith('close-');
      if (needsCleanup) {
        runtime.failed = true;
        runtime.stage = 'close-agent';
      }
      record.state.status =
        canPollAgain || reconcileSubmission || retryCleanup || needsCleanup ? 'running' : 'failed';
      record.state.phase = reconcileSubmission
        ? 'Checking whether Querio received your question'
        : needsCleanup || retryCleanup
          ? 'Closing the interrupted analysis'
          : canPollAgain
            ? 'Connection interrupted; checking the saved analysis'
            : null;
      record.state.error = {
        code,
        message:
          error instanceof AppError
            ? error.message
            : 'The analysis was interrupted. Your saved records have not changed.',
        requestId,
        retryable: canPollAgain || reconcileSubmission || retryCleanup,
      };
      await save();
      return record.state;
    } finally {
      await store.release(org, id, token);
    }
  }

  async function close(org: string, id: string, requestId?: string) {
    await store.requestClose(org, id, 'querio');
    return refresh(org, id, requestId);
  }
  return { availability, create, get, send, refresh, close };
}
export const querioService = createQuerioService();
