import { describe, expect, it, vi } from 'vitest';
import { createNativeAnalystService, type NativeAnalystTurn } from '../server/native-analyst-service';
import type { AnalystRecord, AnalystStore } from '../server/analyst-store';
import type {
  AnalystModelAttempt,
  AnalystModelReceipt,
  AnalystStepResult,
  NativeModelOptions,
} from '../server/analyst-model';
import type { AnalystSqlResult, createAnalystSql } from '../server/analyst-sql';
import type { AnalystProvider } from '../shared/analyst';
import { AppError } from '../server/errors';
import { AnalystSqlError } from '../server/analyst-sql';

const stamp = '2026-11-03T12:00:00.000Z';
const copy = <T>(x: T): T => structuredClone(x);
function memoryStore() {
  const records = new Map<string, AnalystRecord>(),
    leases = new Map<string, string>(),
    closes = new Set<string>();
  const key = (org: string, id: string, provider: AnalystProvider = 'daybook') => `${org}/${provider}/${id}`;
  const required = (org: string, id: string, provider: AnalystProvider = 'daybook') => {
    const found = records.get(key(org, id, provider));
    if (!found) throw new AppError(404, 'NOT_FOUND', 'Missing');
    return found;
  };
  let n = 0;
  const store: AnalystStore = {
    async create(org, state) {
      const k = key(org, state.id, state.provider);
      if (!records.has(k))
        records.set(k, { state: copy(state), runtime: {}, lastMessageId: null, lastMessageText: null });
      return copy(required(org, state.id, state.provider));
    },
    async read(org, id, p) {
      return copy(required(org, id, p));
    },
    async queue(org, id, p, messageId, text) {
      const r = required(org, id, p);
      const old = r.state.messages.find((m) => m.id === messageId);
      if (old) {
        if (old.content !== text) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Conflict');
        return copy(r);
      }
      if (leases.has(key(org, id, p)) || ['starting', 'running'].includes(r.state.status))
        throw new AppError(409, 'AI_BUSY', 'Busy');
      if (r.state.status === 'closed' || r.runtime.closeRequested || r.runtime.pendingMutation)
        throw new AppError(409, 'AI_REQUEST_REJECTED', 'Closed');
      r.state.messages.push({ id: messageId, role: 'user', content: text, createdAt: stamp });
      r.state.status = 'starting';
      r.lastMessageId = messageId;
      r.lastMessageText = text;
      r.runtime = {
        nativeHistory: r.runtime.nativeHistory,
        nativeUsageHistory: [
          ...((r.runtime.nativeUsageHistory as unknown[]) ?? []),
          (r.runtime.nativeTurn as NativeAnalystTurn | undefined)?.meter,
        ],
      };
      return copy(r);
    },
    async claim(org, id, p) {
      const k = key(org, id, p);
      if (leases.has(k)) return null;
      const token = String(++n);
      leases.set(k, token);
      return { token, record: copy(required(org, id, p)) };
    },
    async save(org, id, token, r) {
      const k = key(org, id, r.state.provider);
      if (leases.get(k) !== token) throw new AppError(409, 'LEASE_LOST', 'Lost');
      if (closes.has(k)) r.runtime.closeRequested = true;
      records.set(k, copy(r));
    },
    async release(org, id, token) {
      const k = key(org, id);
      if (leases.get(k) === token) leases.delete(k);
    },
    async requestClose(org, id, p) {
      const k = key(org, id, p),
        r = required(org, id, p);
      closes.add(k);
      r.runtime.closeRequested = true;
      r.state.status = 'running';
      return copy(r);
    },
  };
  return {
    store,
    peek: (org = 'org-a', id = 'chat') => copy(required(org, id)),
    edit: (fn: (r: AnalystRecord) => void) => fn(required('org-a', 'chat')),
    leases,
  };
}
function result(id = 'q1', organizationId = 'org-a'): AnalystSqlResult {
  return {
    id,
    organizationId,
    sql: 'SELECT date,amount FROM analytics.ledger',
    params: [],
    executedAt: stamp,
    columns: [
      { name: 'month', oid: 25, kind: 'text' },
      { name: 'amount', oid: 1700, kind: 'decimal' },
    ],
    rows: [['2026-10', '42.01']],
    rowCount: 1,
    truncated: false,
    hash: 'same',
  };
}
function answer(text: string): AnalystStepResult {
  return {
    text,
    finishReason: 'stop',
    responseMessages: [{ role: 'assistant', content: text }],
    usage: {},
    toolCalls: [],
    toolResults: [],
  };
}
function calls(...requested: { name: string; input: unknown }[]): AnalystStepResult {
  return {
    text: '',
    finishReason: 'tool-calls',
    responseMessages: [
      {
        role: 'assistant',
        content: requested.map((call, i) => ({
          type: 'tool-call' as const,
          toolCallId: `t${i}`,
          toolName: call.name,
          input: call.input,
          providerOptions: { google: { thoughtSignature: 'opaque-signature' } },
        })),
      },
    ],
    usage: {},
    toolCalls: requested.map((call, i) => ({
      toolCallId: `t${i}`,
      toolName: call.name,
      input: call.input,
      invalid: false,
    })),
    toolResults: [],
  };
}
const publication = {
  title: 'Monthly costs',
  notes: 'Recorded cost is42.01 USD for October2026.',
  tables: [{ queryId: 'q1' }],
  charts: [
    {
      queryId: 'q1',
      kind: 'bar',
      title: 'Monthly costs',
      xColumn: 'month',
      yColumns: ['amount'],
      format: 'currency',
      currency: 'USD',
    },
  ],
};
function fixture() {
  const memory = memoryStore();
  let hooks: NativeModelOptions | undefined;
  let attemptN = 0;
  const outputs: AnalystStepResult[] = [];
  const modelCalls: Parameters<NonNullable<Parameters<typeof createNativeAnalystService>[0]['step']>>[0][] =
    [];
  let beforeModel: (() => Promise<void>) | undefined;
  const sql = {
    query: vi.fn(async (org: string, q: { id: string }) => result(q.id, org)),
    batch: vi.fn(),
    reexecute: vi.fn(async (_org: string, rs: AnalystSqlResult[]) => ({
      results: copy(rs),
      changedQueryIds: [] as string[],
    })),
  } as unknown as ReturnType<typeof createAnalystSql>;
  const externalBefore = vi.fn(async (_a: AnalystModelAttempt) => {}),
    externalAfter = vi.fn(async (_r: AnalystModelReceipt) => {});
  const service = createNativeAnalystService({
    store: memory.store,
    sql,
    settings: () => ({ apiKey: 'private-fixture', turnBudgetNanoUsd: 10_000 }),
    now: () => new Date(stamp),
    modelFactory: (input) => {
      hooks = input;
      return {} as ReturnType<NonNullable<Parameters<typeof createNativeAnalystService>[0]['modelFactory']>>;
    },
    step: async (input) => {
      modelCalls.push(copy({ ...input, model: {}, tools: {} }) as typeof input);
      const attempt: AnalystModelAttempt = {
        attemptId: `a${++attemptN}`,
        modelId: 'gemini-3.8-flash',
        requestBytes: 20,
        requestSha256: 'hash',
        continuationCarryTokens: 0,
        inputTokenReservation: 20,
        outputTokenReservation: 10,
        reservationNanoUsd: 1000,
        reservationUsd: '0.000001000',
      };
      await hooks!.beforeDispatch(attempt);
      await beforeModel?.();
      await hooks!.afterResponse({
        ...attempt,
        kind: 'known',
        httpStatus: 200,
        usage: { promptTokenCount: 2, candidatesTokenCount: 2, totalTokenCount: 4 },
        inputTokens: 2,
        outputTokens: 2,
        unclassifiedOutputTokens: 0,
        costNanoUsd: 400,
        costUsd: '0.000000400',
      });
      if (!outputs.length) throw new Error('Injected provider failure');
      return outputs.shift()!;
    },
    beforeDispatch: externalBefore,
    afterResponse: externalAfter,
  });
  return {
    ...memory,
    service,
    sql,
    outputs,
    modelCalls,
    externalBefore,
    externalAfter,
    setBeforeModel: (fn: () => Promise<void>) => {
      beforeModel = fn;
    },
    async start(text = 'What did we spend?') {
      await service.create('org-a', 'chat');
      await service.send('org-a', 'chat', 'm1', text);
    },
  };
}
describe('durable native analyst service', () => {
  it('queues/read-refresh without a paid model call and preserves client idempotency', async () => {
    const f = fixture();
    await f.start();
    await f.service.send('org-a', 'chat', 'm1', 'What did we spend?');
    await f.service.refresh('org-a', 'chat');
    expect(f.modelCalls).toHaveLength(0);
    expect(f.peek().state.messages).toHaveLength(1);
    await expect(f.service.send('org-a', 'chat', 'm1', 'Changed')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
  it('executes one generation per lease, persists signed tool calls before any SQL, then publishes exact chart evidence from a fresh snapshot', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(
      calls({ name: 'query_sql', input: { sql: 'SELECT amount FROM analytics.ledger' } }),
      calls({ name: 'publish_notebook', input: publication }),
    );
    await f.service.advance('org-a', 'chat');
    expect(f.modelCalls).toHaveLength(1);
    expect(f.sql.query).not.toHaveBeenCalled();
    expect(JSON.stringify(f.peek().runtime.nativeHistory)).toContain('opaque-signature');
    await f.service.advance('org-a', 'chat');
    expect(f.modelCalls).toHaveLength(1);
    expect(f.sql.query).toHaveBeenCalledTimes(1);
    await f.service.advance('org-a', 'chat');
    const final = await f.service.advance('org-a', 'chat');
    expect(final.status).toBe('completed');
    expect(f.sql.reexecute).toHaveBeenCalledTimes(1);
    expect(final.messages.at(-1)?.content).toContain('42.01');
    expect(final.notebook.cells[1].outputs).toContainEqual(
      expect.objectContaining({
        type: 'chart',
        chart: expect.objectContaining({ series: [{ name: 'amount', values: ['42.01'] }] }),
      }),
    );
    expect(f.peek().runtime.nativeTurn).toMatchObject({
      stepIndex: 2,
      meter: {
        attempts: [
          { receipt: { kind: 'known', costNanoUsd: 400 } },
          { receipt: { kind: 'known', costNanoUsd: 400 } },
        ],
      },
    });
  });
  it('retains full signed history across follow-ups but never permits earlier-turn query IDs as new evidence', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(answer('What date range should I use?'));
    await f.service.advance('org-a', 'chat');
    await f.service.send('org-a', 'chat', 'm2', 'This year');
    f.outputs.push(calls({ name: 'publish_notebook', input: publication }));
    await f.service.advance('org-a', 'chat');
    await f.service.advance('org-a', 'chat');
    expect(f.modelCalls[1].messages).toContainEqual({
      role: 'assistant',
      content: 'What date range should I use?',
    });
    expect(f.modelCalls[1].messages.filter((m) => m.role === 'user')).toHaveLength(2);
    expect(JSON.stringify(f.peek().runtime.nativeHistory)).toContain('has not been executed in this turn');
    expect(f.sql.reexecute).not.toHaveBeenCalled();
  });
  it('does not replay an interrupted generation after a new worker claims the conversation', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(answer('Done'));
    await f.service.advance('org-a', 'chat');
    f.edit((r) => {
      r.state.status = 'running';
      (r.runtime.nativeTurn as NativeAnalystTurn).pendingGeneration = 'uncertain';
    });
    const state = await f.service.advance('org-a', 'chat');
    expect(state.error?.code).toBe('ANALYST_GENERATION_UNKNOWN');
    expect(f.modelCalls).toHaveLength(1);
  });
  it('holds a single lease during a model call and a concurrent refresh cannot dispatch twice', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(answer('Hello'));
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    f.setBeforeModel(async () => {
      entered();
      await gate;
    });
    const first = f.service.advance('org-a', 'chat');
    await ready;
    await f.service.advance('org-a', 'chat');
    expect(f.modelCalls).toHaveLength(1);
    release();
    await first;
    expect(f.leases.size).toBe(0);
  });
  it('honors Stop during the model request, retains metering and never publishes its late answer', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(answer('Late answer'));
    f.setBeforeModel(async () => {
      await f.service.close('org-a', 'chat');
    });
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('closed');
    expect(state.messages).toHaveLength(1);
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).meter.attempts[0].receipt?.kind).toBe('known');
  });
  it('handles SQL errors as actionable tool feedback without failing or exposing raw infrastructure messages', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(calls({ name: 'query_sql', input: { sql: 'SELECT missing FROM analytics.ledger' } }));
    vi.mocked(f.sql.query).mockRejectedValueOnce(
      new AnalystSqlError('ANALYST_SQL_QUERY', 'column missing does not exist'),
    );
    await f.service.advance('org-a', 'chat');
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('running');
    expect(JSON.stringify(f.peek().runtime.nativeHistory)).toContain('column missing does not exist');
  });
  it('returns changed fresh results for revision instead of publishing an old answer/chart', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(
      calls({ name: 'query_sql', input: { sql: 'SELECT amount FROM analytics.ledger' } }),
      calls({ name: 'publish_notebook', input: publication }),
    );
    await f.service.advance('org-a', 'chat');
    await f.service.advance('org-a', 'chat');
    await f.service.advance('org-a', 'chat');
    vi.mocked(f.sql.reexecute).mockResolvedValueOnce({
      results: [{ ...result(), rows: [['2026-10', '99.01']], hash: 'changed' }],
      changedQueryIds: ['q1'],
    });
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('running');
    expect(state.notebook.cells).toHaveLength(0);
    expect(JSON.stringify(f.peek().runtime.nativeHistory)).toContain('ANALYST_SNAPSHOT_CHANGED');
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).results[0].rows[0][1]).toBe('99.01');
  });
  it('keeps organizations independent and passes the caller organization to every read', async () => {
    const f = fixture();
    await f.start();
    await f.service.create('org-b', 'chat');
    await f.service.send('org-b', 'chat', 'm1', 'Other business');
    f.outputs.push(calls({ name: 'query_sql', input: { sql: 'SELECT 1' } }));
    await f.service.advance('org-b', 'chat');
    await f.service.advance('org-b', 'chat');
    expect(f.sql.query).toHaveBeenCalledWith('org-b', expect.anything(), expect.anything());
    expect(f.peek().state.status).toBe('starting');
    expect(f.peek('org-b').runtime.nativeTurn).toMatchObject({ results: [{ organizationId: 'org-b' }] });
  });
  it('retains an uncertain failed model reservation and cannot blindly retry on repeated advance', async () => {
    const f = fixture();
    await f.start();
    f.setBeforeModel(async () => {
      throw new Error('Connection lost after submit');
    });
    const first = await f.service.advance('org-a', 'chat');
    await f.service.advance('org-a', 'chat');
    expect(first.status).toBe('failed');
    expect(f.modelCalls).toHaveLength(1);
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).meter.attempts[0].receipt).toBeUndefined();
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).pendingGeneration).toBeTruthy();
  });
  it('stops a new HTTP attempt when its per-turn reservation would exceed the remaining allowance', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(answer('Hello'));
    await f.service.advance('org-a', 'chat');
    f.edit((r) => {
      r.state.status = 'running';
      const turn = r.runtime.nativeTurn as NativeAnalystTurn;
      turn.meter.attempts[0].receipt = undefined;
      turn.meter.attempts[0].reservationNanoUsd = 9500;
    });
    f.outputs.push(answer('Should not be sent'));
    const state = await f.service.advance('org-a', 'chat');
    expect(state.error?.code).toBe('ANALYST_BUDGET_LIMIT');
    expect(f.externalBefore).toHaveBeenCalledTimes(1);
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).meter.attempts).toHaveLength(1);
  });
  it('requires a publication after financial queries rather than presenting unverified model text as completed evidence', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(calls({ name: 'query_sql', input: { sql: 'SELECT 1' } }), answer('The total is123.'));
    await f.service.advance('org-a', 'chat');
    await f.service.advance('org-a', 'chat');
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('running');
    expect(state.messages).toHaveLength(1);
    expect(JSON.stringify(f.peek().runtime.nativeHistory)).toContain('[Daybook publication check]');
  });
  it('does not run model tools directly inside the SDK invocation', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(answer('Hello'));
    await f.service.advance('org-a', 'chat');
    const { NATIVE_ANALYST_TOOLS } = await import('../server/native-analyst-service');
    expect(Object.values(NATIVE_ANALYST_TOOLS).every((tool) => !tool.execute)).toBe(true);
  });
  it.each(['length', 'error', 'content-filter', 'other'] as const)(
    'does not treat %s finish with some text as a completed answer',
    async (finishReason) => {
      const f = fixture();
      await f.start();
      f.outputs.push({ ...answer('Partial answer'), finishReason });
      const state = await f.service.advance('org-a', 'chat');
      expect(state.error?.code).toBe('ANALYST_INCOMPLETE');
      expect(state.messages).toHaveLength(1);
    },
  );
  it('rejects a fabricated notes-only financial notebook and asks the model for query evidence', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(
      calls({ name: 'publish_notebook', input: { title: 'Cash', notes: 'You have one million dollars.' } }),
    );
    await f.service.advance('org-a', 'chat');
    const state = await f.service.advance('org-a', 'chat');
    expect(state.notebook.cells).toHaveLength(0);
    expect(state.status).toBe('running');
    expect(JSON.stringify(f.peek().runtime.nativeHistory)).toContain(
      'Publish at least one executed query result',
    );
  });
  it('recovers a saved successful publication without another paid generation or read', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(answer('Earlier answer'));
    await f.service.advance('org-a', 'chat');
    f.edit((r) => {
      r.state.status = 'running';
      r.runtime.nativeAnswer = 'Saved final answer';
      (r.runtime.nativeTurn as NativeAnalystTurn).published = true;
    });
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('completed');
    expect(state.messages.at(-1)?.content).toBe('Saved final answer');
    expect(f.modelCalls).toHaveLength(1);
  });
  it('bounds overproduced tool calls without running any of them', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(
      calls(...Array.from({ length: 17 }, () => ({ name: 'query_sql', input: { sql: 'SELECT 1' } }))),
    );
    const state = await f.service.advance('org-a', 'chat');
    expect(state.error?.code).toBe('ANALYST_INVALID_RESPONSE');
    expect(f.sql.query).not.toHaveBeenCalled();
  });
  it('does not execute partial tool calls from a truncated model response', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push({ ...calls({ name: 'query_sql', input: { sql: 'SELECT 1' } }), finishReason: 'length' });
    const state = await f.service.advance('org-a', 'chat');
    expect(state.error?.code).toBe('ANALYST_INCOMPLETE');
    expect(f.sql.query).not.toHaveBeenCalled();
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).pendingCalls).toHaveLength(0);
  });
  it('honors a durable Stop before the first model dispatch', async () => {
    const f = fixture();
    await f.start();
    await f.service.close('org-a', 'chat');
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('closed');
    expect(f.modelCalls).toHaveLength(0);
  });
  it('rejects a query result with a mismatched organization before retaining evidence', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(calls({ name: 'query_sql', input: { sql: 'SELECT 1' } }));
    vi.mocked(f.sql.query).mockResolvedValueOnce(result('q1', 'other-org'));
    await f.service.advance('org-a', 'chat');
    await f.service.advance('org-a', 'chat');
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).results).toHaveLength(0);
    expect(JSON.stringify(f.peek().runtime.nativeHistory)).not.toContain('other-org');
  });
  it('stops before the next read when Stop arrives during an active read', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(
      calls(
        { name: 'query_sql', input: { sql: 'SELECT 1' } },
        { name: 'query_sql', input: { sql: 'SELECT 2' } },
      ),
    );
    await f.service.advance('org-a', 'chat');
    vi.mocked(f.sql.query).mockImplementationOnce(async () => {
      await f.service.close('org-a', 'chat');
      return result();
    });
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('closed');
    expect(f.sql.query).toHaveBeenCalledTimes(1);
  });
  it('marks preview truncation explicitly while retaining exact server-held rows for publication', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(calls({ name: 'query_sql', input: { sql: 'SELECT amount FROM analytics.ledger' } }));
    vi.mocked(f.sql.query).mockResolvedValueOnce({
      ...result(),
      rows: Array.from({ length: 200 }, () => ['x'.repeat(1000), '12345678901234567890.01']),
      rowCount: 200,
      truncated: true,
    });
    await f.service.advance('org-a', 'chat');
    await f.service.advance('org-a', 'chat');
    const r = f.peek();
    expect((r.runtime.nativeTurn as NativeAnalystTurn).results[0].rows).toHaveLength(200);
    const history = r.runtime.nativeHistory as { role: string; content: unknown }[];
    const last = JSON.stringify(history.at(-1));
    expect(last.length).toBeLessThan(26000);
    expect(last).toContain('previewTruncated');
    expect(last).toContain('12345678901234567890.01');
  });
  it('keeps external budget rejections at zero new HTTP admissions and preserves their conservative reservation', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(answer('Never admitted'));
    f.externalBefore.mockRejectedValueOnce(new Error('Shared allowance exhausted'));
    const state = await f.service.advance('org-a', 'chat');
    expect(state.error?.code).toBe('ANALYST_BUDGET_LIMIT');
    expect(f.externalAfter).not.toHaveBeenCalled();
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).pendingGeneration).toBeUndefined();
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).meter.attempts[0].receipt).toBeUndefined();
  });
});
