import { describe, expect, it, vi } from 'vitest';
import { createQuerioService } from '../server/querio-service';
import type { AnalystRecord, AnalystStore } from '../server/analyst-store';
import type { AnalystProvider } from '../shared/analyst';
import type { QuerioRequest, QuerioSettings } from '../server/querio-client';
import { AppError } from '../server/errors';

vi.mock('../server/diagnostics', () => ({ diagnostic: vi.fn() }));

const initialTime = '2026-11-03T12:00:00.000Z';
const settings: QuerioSettings = {
  key: 'fixture-only',
  workspaceId: 'test-workspace',
  datasource: 'daybook-live',
  model: 'fixture-model',
};
const copy = <T>(value: T): T => structuredClone(value);

/** Contract fake: isolated records and exclusive claims, without a database or provider. */
function memoryStore() {
  const records = new Map<string, AnalystRecord>();
  const claims = new Map<string, string>();
  const closeRequests = new Set<string>();
  let sequence = 0;
  const key = (org: string, id: string, provider: AnalystProvider = 'querio') =>
    JSON.stringify([org, id, provider]);
  const required = (org: string, id: string, provider: AnalystProvider = 'querio') => {
    const found = records.get(key(org, id, provider));
    if (!found) throw new AppError(404, 'NOT_FOUND', 'Conversation not found.');
    return found;
  };
  const store: AnalystStore = {
    async create(org, state) {
      const k = key(org, state.id, state.provider);
      if (!records.has(k))
        records.set(k, { state: copy(state), runtime: {}, lastMessageId: null, lastMessageText: null });
      return copy(required(org, state.id, state.provider));
    },
    async read(org, id, provider) {
      return copy(required(org, id, provider));
    },
    async queue(org, id, provider, messageId, text) {
      const record = required(org, id, provider);
      const existing = record.state.messages.find((message) => message.id === messageId);
      if (existing) {
        if (existing.role !== 'user' || existing.content !== text)
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Message ID was reused.');
        return copy(record);
      }
      if (claims.has(key(org, id, provider)) || ['starting', 'running'].includes(record.state.status))
        throw new AppError(409, 'AI_BUSY', 'Answer in progress.');
      if (
        record.state.status === 'closed' ||
        record.runtime.pendingMutation ||
        closeRequests.has(key(org, id, provider))
      )
        throw new AppError(409, 'AI_REQUEST_REJECTED', 'Conversation cannot accept this turn.');
      record.state.messages.push({ id: messageId, role: 'user', content: text, createdAt: initialTime });
      if (record.state.messages.length === 1) record.state.title = text;
      record.state.status = 'starting';
      record.state.error = null;
      record.runtime = {
        notebookId: record.runtime.notebookId,
        stage: 'environment',
        startedAt: initialTime,
      };
      record.lastMessageId = messageId;
      record.lastMessageText = text;
      return copy(record);
    },
    async claim(org, id, provider) {
      const k = key(org, id, provider);
      if (claims.has(k)) return null;
      const token = `lease-${++sequence}`;
      claims.set(k, token);
      return { token, record: copy(required(org, id, provider)) };
    },
    async save(org, id, token, next) {
      const k = key(org, id, next.state.provider);
      if (claims.get(k) !== token) throw new AppError(409, 'CONCURRENT_CHANGE', 'Lease lost.');
      // A Stop arriving outside this lease must survive this older claimed snapshot.
      if (closeRequests.has(k)) next.runtime.closeRequested = true;
      records.set(k, copy(next));
    },
    async release(org, id, token) {
      const k = key(org, id);
      if (claims.get(k) === token) claims.delete(k);
    },
    async requestClose(org, id, provider) {
      const record = required(org, id, provider);
      closeRequests.add(key(org, id, provider));
      record.runtime.closeRequested = true;
      if (record.state.status !== 'closed') {
        record.state.status = 'running';
        record.state.phase = 'Closing this analysis';
      }
      return copy(record);
    },
  };
  return {
    store,
    peek: (org = 'org-a', id = 'conversation') => copy(required(org, id)),
    locked: () => claims.size > 0,
  };
}

type Call = { method: 'GET' | 'POST' | 'DELETE'; path: string; body?: unknown };
function fixture() {
  const memory = memoryStore();
  const calls: Call[] = [];
  let timestamp = Date.parse(initialTime);
  let environmentCount = 0,
    notebookCount = 0,
    runCount = 0;
  const accepted: { id: string; createdAt: string; input: { text: string } }[] = [];
  const runStatuses: string[] = [];
  const failures = new Map<string, () => never>();
  const responses = new Map<string, Record<string, unknown>>();
  let beforeRequest: ((call: Call) => Promise<void>) | undefined;
  const request: QuerioRequest = async (method, path, body) => {
    const call = { method, path, body: copy(body) };
    calls.push(call);
    if (beforeRequest) await beforeRequest(call);
    const failure = failures.get(`${method} ${path}`);
    if (failure) {
      failures.delete(`${method} ${path}`);
      failure();
    }
    const response = responses.get(`${method} ${path}`);
    if (response) {
      responses.delete(`${method} ${path}`);
      return copy(response);
    }
    if (method === 'POST' && path === '/execution-environments') return { id: `env-${++environmentCount}` };
    if (method === 'POST' && path === '/notebooks') return { id: `notebook-${++notebookCount}` };
    if (method === 'POST' && path === '/notebook-sessions')
      return { id: (body as { notebookId: string }).notebookId };
    if (method === 'GET' && /^\/notebook-sessions\//.test(path)) return { state: 'ready' };
    if (method === 'POST' && path === '/agent-sessions')
      return { id: (body as { notebookSessionId: string }).notebookSessionId };
    if (method === 'GET' && /\/agent-sessions\/[^/]+\/runs/.test(path)) return { items: copy(accepted) };
    if (method === 'GET' && /^\/agent-sessions\//.test(path)) return { state: 'ready' };
    if (method === 'POST' && /\/agent-sessions\/[^/]+\/events$/.test(path)) {
      const run = {
        id: `run-${++runCount}`,
        createdAt: new Date(timestamp).toISOString(),
        input: { text: (body as { data: { text: string } }).data.text },
      };
      accepted.push(run);
      return { success: true, runId: run.id };
    }
    if (method === 'GET' && /^\/runs\//.test(path))
      return {
        status: runStatuses.shift() ?? 'completed',
        output: {
          finalAnswerMarkdown: 'Recorded rent was $120.00. The chart shows its monthly amounts.',
          cells: [
            {
              cellId: 'chart',
              presentation: {
                type: 'chart',
                format: 'vega-lite',
                title: 'Monthly rent',
                spec: {
                  data: { values: [{ month: 'Jan', amount: '120.00' }] },
                  mark: 'bar',
                  encoding: {
                    x: { field: 'month', type: 'nominal' },
                    y: { field: 'amount', type: 'quantitative' },
                  },
                },
              },
            },
          ],
        },
      };
    if (method === 'GET' && /^\/notebooks\//.test(path))
      return {
        serialization: {
          cells: [{ cell_id: 'chart', name: 'Monthly rent', code: 'monthly = cee.sql("SELECT ...")' }],
        },
      };
    if (method === 'DELETE' || (method === 'POST' && /\/cancel$/.test(path))) return {};
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  };
  const service = createQuerioService({
    store: memory.store,
    settings: () => settings,
    request,
    now: () => new Date(timestamp),
  });
  const count = (method: Call['method'], fragment: string) =>
    calls.filter((call) => call.method === method && call.path.includes(fragment)).length;
  const advance = async (until: () => boolean, org = 'org-a', id = 'conversation') => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (until()) return;
      await service.refresh(org, id, 'trace-fixture');
    }
    throw new Error(
      `Lifecycle did not reach expected outcome: ${JSON.stringify(memory.peek(org, id).state.error)}`,
    );
  };
  const begin = async () => {
    await service.create('org-a', 'conversation');
    return service.send('org-a', 'conversation', 'message-1', 'Show rent by month');
  };
  const finish = () => advance(() => memory.peek().state.status === 'completed');
  return {
    ...memory,
    service,
    calls,
    count,
    advance,
    begin,
    finish,
    accepted,
    runStatuses,
    failures,
    responses,
    intercept: (callback: (call: Call) => Promise<void>) => {
      beforeRequest = callback;
    },
    elapse: (milliseconds: number) => {
      timestamp += milliseconds;
    },
  };
}

describe('Querio conversation lifecycle (no provider or database)', () => {
  it('creates an empty saved conversation without spending on a provider turn', async () => {
    const f = fixture();
    const state = await f.service.create('org-a', 'conversation');
    expect(state).toMatchObject({
      provider: 'querio',
      status: 'idle',
      sourceLabel: 'Daybook live books',
      messages: [],
    });
    expect(f.calls).toHaveLength(0);
  });

  it('persists the answer and actual chart, then closes its own remote resources', async () => {
    const f = fixture();
    await f.begin();
    await f.finish();
    const state = await f.service.get('org-a', 'conversation');
    expect(state.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(state.messages[1].content).toContain('$120.00');
    expect(state.notebook.cells[0]).toMatchObject({
      code: 'monthly = cee.sql("SELECT ...")',
      outputs: [{ type: 'chart', chart: { labels: ['Jan'], series: [{ values: ['120.00'] }] } }],
    });
    expect(f.count('POST', '/events')).toBe(1);
    expect(f.calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual([
      '/agent-sessions/notebook-1',
      '/notebook-sessions/notebook-1',
      '/execution-environments/env-1',
    ]);
    expect(f.peek().runtime).not.toHaveProperty('environmentId');
    expect(f.locked()).toBe(false);
  });

  it('uses the configured live datasource for both execution and model context', async () => {
    const f = fixture();
    await f.begin();
    await f.finish();
    const openings = f.calls.filter(
      (call) => call.method === 'POST' && ['/agent-sessions', '/notebook-sessions'].includes(call.path),
    );
    expect(openings).toHaveLength(2);
    for (const call of openings)
      expect(call.body).toMatchObject({ config: { datasourceSlugs: ['daybook-live'] } });
    expect(openings.find((call) => call.path === '/agent-sessions')?.body).toMatchObject({
      config: { model: 'fixture-model' },
    });
  });

  it('persists startup ownership and resource IDs before dependent requests occur', async () => {
    const f = fixture();
    const seen: AnalystRecord[] = [];
    f.intercept(async (call) => {
      if (call.method === 'POST') seen.push(f.peek());
    });
    await f.begin();
    await f.finish();
    expect(seen.every((record) => typeof record.runtime.pendingMutation === 'string')).toBe(true);
    const sessionCreation = seen.find((record) => record.runtime.environmentId && record.runtime.notebookId);
    expect(sessionCreation?.runtime).toMatchObject({ environmentId: 'env-1', notebookId: 'notebook-1' });
    expect(f.peek().state.status).toBe('completed');
  });

  it('does not treat an accepted or running model turn as a completed answer', async () => {
    const f = fixture();
    f.runStatuses.push('running', 'running', 'running');
    await f.begin();
    await f.advance(() => f.count('GET', '/runs/run-1') >= 1);
    expect(f.peek().state.status).toBe('running');
    expect(f.peek().state.messages.filter((message) => message.role === 'assistant')).toEqual([]);
    expect(f.count('DELETE', '/')).toBe(0);
    await f.finish();
    expect(f.peek().state.status).toBe('completed');
  });

  it('repeated message IDs never dispatch a paid turn twice, including after completion', async () => {
    const f = fixture();
    await f.begin();
    await f.service.send('org-a', 'conversation', 'message-1', 'Show rent by month');
    await f.finish();
    await f.service.send('org-a', 'conversation', 'message-1', 'Show rent by month');
    expect(f.count('POST', '/events')).toBe(1);
    expect(f.peek().state.messages).toHaveLength(2);
    await expect(
      f.service.send('org-a', 'conversation', 'message-1', 'Different text'),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(f.count('POST', '/events')).toBe(1);
  });

  it('reopens the same saved notebook with fresh compute for a follow-up', async () => {
    const f = fixture();
    await f.begin();
    await f.finish();
    await f.service.send('org-a', 'conversation', 'message-2', 'Compare that with last month');
    await f.finish();
    expect(f.count('POST', '/execution-environments')).toBe(2);
    expect(f.calls.filter((call) => call.method === 'POST' && call.path === '/notebooks')).toHaveLength(1);
    const sessions = f.calls.filter((call) => call.method === 'POST' && call.path === '/notebook-sessions');
    expect(sessions.map((call) => call.body)).toEqual([
      expect.objectContaining({ notebookId: 'notebook-1', environmentId: 'env-1' }),
      expect.objectContaining({ notebookId: 'notebook-1', environmentId: 'env-2' }),
    ]);
    expect(f.peek().state.messages).toHaveLength(4);
    expect(f.accepted.map((run) => run.input.text)).toEqual([
      'Show rent by month',
      'Compare that with last month',
    ]);
  });

  it('keeps conversation reads and records scoped to the supplied organization', async () => {
    const f = fixture();
    await f.service.create('org-a', 'conversation');
    await expect(f.service.get('org-b', 'conversation')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await f.service.create('org-b', 'conversation');
    await f.service.send('org-a', 'conversation', 'message-1', 'Org A question');
    expect((await f.service.get('org-b', 'conversation')).messages).toEqual([]);
    expect(f.peek('org-a').state.messages[0].content).toBe('Org A question');
  });

  it('a concurrent refresh cannot acquire the same lease and duplicate provider mutations', async () => {
    const f = fixture();
    let unblock!: () => void;
    let entered!: () => void;
    const wait = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.intercept(async (call) => {
      if (call.path === '/execution-environments') {
        entered();
        await wait;
      }
    });
    await f.service.create('org-a', 'conversation');
    const sending = f.service.send('org-a', 'conversation', 'message-1', 'Show rent by month');
    await started;
    const refreshing = await f.service.refresh('org-a', 'conversation');
    expect(refreshing.messages).toHaveLength(1);
    expect(f.count('POST', '/execution-environments')).toBe(1);
    unblock();
    await sending;
    await f.finish();
    expect(f.count('POST', '/events')).toBe(1);
  });

  it('accepts Stop while startup holds the lease and does not submit a model turn afterward', async () => {
    const f = fixture();
    let releaseRequest!: () => void;
    let markStarted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    f.intercept(async (call) => {
      if (call.method === 'POST' && call.path === '/execution-environments') {
        markStarted();
        await blocked;
      }
    });
    await f.service.create('org-a', 'conversation');
    const sending = f.service.send('org-a', 'conversation', 'message-1', 'Do not submit after Stop');
    await started;
    await expect(f.service.close('org-a', 'conversation')).resolves.toMatchObject({ status: 'running' });
    expect(f.peek().runtime.closeRequested).toBe(true);
    releaseRequest();
    await sending;
    await f.advance(() => f.peek().state.status === 'closed');
    expect(f.count('POST', '/events')).toBe(0);
    expect(f.count('POST', '/execution-environments')).toBe(1);
    expect(f.count('DELETE', '/execution-environments')).toBe(1);
    expect(f.peek().runtime.closeRequested).toBe(true);
  });

  it('accepts Stop during an in-flight submit and cancels the one accepted turn without replay', async () => {
    const f = fixture();
    let releaseRequest!: () => void;
    let markStarted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    f.intercept(async (call) => {
      if (call.method === 'POST' && call.path.endsWith('/events')) {
        markStarted();
        await blocked;
      }
    });
    await f.begin();
    const progressing = f.advance(() => f.peek().state.status === 'closed');
    await started;
    await expect(f.service.close('org-a', 'conversation')).resolves.toMatchObject({ status: 'running' });
    f.runStatuses.push('running', 'cancelled');
    releaseRequest();
    await progressing;
    expect(f.count('POST', '/events')).toBe(1);
    expect(f.count('POST', '/cancel')).toBe(1);
    expect(f.peek().state.status).toBe('closed');
    expect(f.peek().state.messages.filter((message) => message.role === 'assistant')).toEqual([]);
    expect(f.count('DELETE', '/execution-environments')).toBe(1);
  });

  it('a transient read failure preserves the active run and allows polling without paid replay', async () => {
    const f = fixture();
    f.failures.set('GET /runs/run-1', () => {
      throw new AppError(503, 'AI_CONNECTION_ERROR', 'Read timed out.');
    });
    await f.begin();
    await f.advance(() => f.count('GET', '/runs/run-1') >= 1);
    expect(f.peek().runtime.runId).toBe('run-1');
    expect(f.count('POST', '/events')).toBe(1);
    await f.finish();
    expect(f.count('POST', '/events')).toBe(1);
    expect(f.peek().state.error).toBeNull();
    expect(f.peek().state.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
  });

  it('retries a failed notebook read after model completion without asking the model again', async () => {
    const f = fixture();
    f.failures.set('GET /notebooks/notebook-1', () => {
      throw new AppError(503, 'AI_CONNECTION_ERROR', 'Notebook response interrupted.');
    });
    await f.begin();
    await f.finish();
    expect(f.count('POST', '/events')).toBe(1);
    expect(f.count('GET', '/notebooks/notebook-1')).toBe(2);
    expect(f.peek().state.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(f.peek().state.error).toBeNull();
  });

  it('recovers a lost submit response from existing run history without submitting again', async () => {
    const f = fixture();
    let interrupted = false;
    f.intercept(async (call) => {
      if (!interrupted && call.method === 'POST' && call.path.endsWith('/events')) {
        interrupted = true;
        f.accepted.push({
          id: 'accepted-run',
          createdAt: initialTime,
          input: { text: 'Show rent by month' },
        });
        throw new AppError(503, 'AI_CONNECTION_ERROR', 'Response lost after acceptance.');
      }
    });
    await f.begin();
    await f.advance(() => interrupted);
    expect(f.peek().runtime.pendingMutation).toBeTruthy();
    await f.finish();
    expect(f.count('POST', '/events')).toBe(1);
    expect(f.count('GET', '/runs?limit=100')).toBeGreaterThan(0);
    expect(f.peek().state.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(f.peek().state.error).toBeNull();
  });

  it.each(['malformed-response', 'broken-body'])(
    'reconciles an accepted submit with %s before any possible replay',
    async (mode) => {
      const f = fixture();
      let interrupted = false;
      f.intercept(async (call) => {
        if (!interrupted && call.method === 'POST' && call.path.endsWith('/events')) {
          interrupted = true;
          f.accepted.push({
            id: 'accepted-run',
            createdAt: initialTime,
            input: { text: 'Show rent by month' },
          });
          if (mode === 'broken-body')
            throw new AppError(502, 'AI_INVALID_RESPONSE', 'Response stream interrupted.');
        }
      });
      if (mode === 'malformed-response') f.responses.set('POST /agent-sessions/notebook-1/events', {});
      await f.begin();
      await f.advance(() => interrupted);
      expect(f.peek().runtime.pendingMutation).toBeTruthy();
      await f.finish();
      expect(f.count('POST', '/events')).toBe(1);
      expect(f.peek().state.error).toBeNull();
    },
  );

  it('preserves the previous good answer and notebook if a later model turn fails, then cleans up', async () => {
    const f = fixture();
    await f.begin();
    await f.finish();
    const previous = copy(f.peek().state.notebook);
    f.runStatuses.push('failed');
    await f.service.send('org-a', 'conversation', 'message-2', 'An unsuccessful follow-up');
    await f.advance(() => f.peek().state.status === 'failed' && !f.peek().runtime.environmentId);
    expect(f.peek().state.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(f.peek().state.notebook).toEqual(previous);
    expect(f.count('POST', '/events')).toBe(2);
    expect(f.count('DELETE', '/execution-environments')).toBe(2);
  });

  it('does not invent an answer for a completed empty result and still releases compute', async () => {
    const f = fixture();
    f.responses.set('GET /runs/run-1', { status: 'completed', output: { cells: [] } });
    await f.begin();
    await f.advance(() => f.peek().state.status === 'failed' && !f.peek().runtime.environmentId);
    expect(f.peek().state.messages.filter((message) => message.role === 'assistant')).toEqual([]);
    expect(f.peek().state.error?.code).toBe('AI_INVALID_RESPONSE');
    expect(f.count('DELETE', '/execution-environments')).toBe(1);
  });

  it.each([404, 410])('accepts HTTP %s when owned cleanup resources are already gone', async (status) => {
    const f = fixture();
    for (const path of [
      '/agent-sessions/notebook-1',
      '/notebook-sessions/notebook-1',
      '/execution-environments/env-1',
    ]) {
      f.failures.set(`DELETE ${path}`, () => {
        throw new AppError(502, 'AI_PROVIDER_ERROR', 'Already closed.', { upstreamStatus: status });
      });
    }
    await f.begin();
    await f.finish();
    expect(f.peek().state.error).toBeNull();
    expect(f.count('POST', '/events')).toBe(1);
    expect(f.count('DELETE', '/')).toBe(3);
  });

  it('retries an uncertain cleanup deletion without repeating the completed model turn', async () => {
    const f = fixture();
    const endpoint = 'DELETE /agent-sessions/notebook-1';
    f.failures.set(endpoint, () => {
      f.failures.set(endpoint, () => {
        throw new AppError(502, 'AI_PROVIDER_ERROR', 'Already closed.', { upstreamStatus: 404 });
      });
      throw new AppError(503, 'AI_CONNECTION_ERROR', 'Cleanup response lost.');
    });
    await f.begin();
    await f.finish();
    expect(f.count('DELETE', '/agent-sessions')).toBe(2);
    expect(f.count('POST', '/events')).toBe(1);
    expect(f.peek().state.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(f.peek().state.error).toBeNull();
  });

  it('closes an idle conversation without creating compute or submitting anything', async () => {
    const f = fixture();
    await f.service.create('org-a', 'conversation');
    await f.service.close('org-a', 'conversation');
    await f.advance(() => f.peek().state.status === 'closed');
    expect(f.calls).toEqual([]);
    expect(f.peek().state.messages).toEqual([]);
  });

  it('does not resend an uncertain submit when no accepted run can be found', async () => {
    const f = fixture();
    f.failures.set('POST /agent-sessions/notebook-1/events', () => {
      throw new AppError(503, 'AI_CONNECTION_ERROR', 'Unknown submission outcome.');
    });
    await f.begin();
    await f.advance(() => f.count('POST', '/events') === 1);
    for (let i = 0; i < 3; i++) await f.service.refresh('org-a', 'conversation');
    expect(f.count('POST', '/events')).toBe(1);
    expect(f.peek().state.error).not.toBeNull();
    expect(f.peek().runtime.pendingMutation).toBeTruthy();
    expect(f.locked()).toBe(false);
  });

  it('does not replay an uncertain startup mutation or begin a model turn', async () => {
    const f = fixture();
    f.failures.set('POST /execution-environments', () => {
      throw new AppError(503, 'AI_CONNECTION_ERROR', 'Startup response lost.');
    });
    await f.begin();
    await f.service.refresh('org-a', 'conversation');
    expect(f.count('POST', '/execution-environments')).toBe(1);
    expect(f.count('POST', '/events')).toBe(0);
    expect(f.peek().state.error).not.toBeNull();
  });

  it('handles cancellation losing a race to successful completion without a duplicate answer', async () => {
    const f = fixture();
    f.runStatuses.push('running', 'running', 'running');
    f.failures.set('POST /runs/run-1/cancel', () => {
      throw new AppError(502, 'AI_PROVIDER_ERROR', 'Already terminal.', { upstreamStatus: 409 });
    });
    await f.begin();
    await f.advance(() => f.count('GET', '/runs/run-1') >= 1);
    f.elapse(241_000);
    await f.finish();
    expect(f.count('POST', '/cancel')).toBe(1);
    expect(f.count('POST', '/events')).toBe(1);
    expect(f.peek().state.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(f.count('DELETE', '/execution-environments')).toBe(1);
  });
});
