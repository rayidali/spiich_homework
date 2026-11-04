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
import { AnalystModelError } from '../server/analyst-model';

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
        nativeFailures: r.runtime.nativeFailures,
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
  const failures: {
    code: ConstructorParameters<typeof AnalystModelError>[0];
    receipt: 'transport' | 'not-dispatched' | 'malformed' | 'http-error' | 'known';
  }[] = [];
  const modelCalls: Parameters<NonNullable<Parameters<typeof createNativeAnalystService>[0]['step']>>[0][] =
    [];
  const modelToolNames: string[][] = [];
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
  const diagnostic = vi.fn();
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
      modelToolNames.push(Object.keys(input.tools));
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
      const failure = failures.shift();
      if (failure && failure.receipt !== 'known') {
        await hooks!.afterResponse({
          ...attempt,
          kind: 'unknown',
          reason: ['transport', 'not-dispatched'].includes(failure.receipt)
            ? 'transport-error'
            : 'missing-usage',
          ...(['transport', 'not-dispatched'].includes(failure.receipt)
            ? { transportStarted: failure.receipt === 'transport' }
            : { httpStatus: failure.receipt === 'http-error' ? 429 : 200 }),
        });
        throw new AnalystModelError(failure.code);
      }
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
      if (failure) throw new AnalystModelError(failure.code);
      if (!outputs.length) throw new Error('Injected provider failure');
      return outputs.shift()!;
    },
    beforeDispatch: externalBefore,
    afterResponse: externalAfter,
    diagnostic,
  });
  return {
    ...memory,
    service,
    sql,
    outputs,
    modelCalls,
    modelToolNames,
    externalBefore,
    externalAfter,
    diagnostic,
    failures,
    setBeforeModel: (fn: () => Promise<void>) => {
      beforeModel = fn;
    },
    async start(text = 'What did we spend?') {
      await service.create('org-a', 'chat');
      await service.send('org-a', 'chat', 'm1', text);
    },
  };
}
async function atPublicationBoundary() {
  const f = fixture();
  await f.start();
  f.outputs.push(calls({ name: 'query_sql', input: { sql: 'SELECT amount FROM analytics.ledger' } }));
  await f.service.advance('org-a', 'chat');
  await f.service.advance('org-a', 'chat');
  // Resume with a saved source at the investigation boundary; each test varies
  // the actual final model/tool behavior rather than rerunning nine dummy reads.
  f.edit((record) => {
    (record.runtime.nativeTurn as NativeAnalystTurn).stepIndex = 10;
  });
  return f;
}
describe('durable native analyst service', () => {
  it('withholds an unsupported monetary aside and lets a later generation repair publication', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(
      calls({ name: 'query_sql', input: { sql: 'SELECT amount FROM analytics.ledger' } }),
      calls({
        name: 'publish_notebook',
        input: { ...publication, notes: 'Recorded $42.01; another draft $45.' },
      }),
      calls({ name: 'publish_notebook', input: publication }),
    );
    for (let step = 0; step < 4; step++) await f.service.advance('org-a', 'chat');
    expect(f.peek().state.notebook.cells).toHaveLength(0);
    expect(f.peek().state.messages).toHaveLength(1);
    expect(JSON.stringify(f.peek().runtime.nativeHistory)).toContain('ANALYST_UNSUPPORTED_FINANCIAL_LITERAL');
    await f.service.advance('org-a', 'chat');
    const final = await f.service.advance('org-a', 'chat');
    expect(final.status).toBe('completed');
    expect(final.messages.at(-1)?.content).toBe(publication.notes);
    expect(f.sql.query).toHaveBeenCalledTimes(1);
    expect(f.sql.reexecute).toHaveBeenCalledTimes(2);
  });
  it('also withholds unqueried financial figures from a plain-text completion', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(answer('Your cash balance is $45.'), answer('Which business account should I inspect?'));
    await f.service.advance('org-a', 'chat');
    expect(f.peek().state.messages).toHaveLength(1);
    expect(JSON.stringify(f.peek().runtime.nativeHistory)).toContain('numeric support check');
    const final = await f.service.advance('org-a', 'chat');
    expect(final.status).toBe('completed');
    expect(final.messages.at(-1)?.content).toBe('Which business account should I inspect?');
  });
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
  it('recovers a directly observed timeout on the next lease without replaying SQL or changing saved history', async () => {
    const f = await atPublicationBoundary();
    const before = f.peek().runtime.nativeHistory;
    f.failures.push({ code: 'ANALYST_MODEL_TIMEOUT', receipt: 'transport' });
    const recovering = await f.service.advance('org-a', 'chat', 'request-recovery');
    expect(recovering.status).toBe('running');
    expect(f.leases.size).toBe(0);
    expect(f.modelCalls).toHaveLength(2); // Initial query generation plus the failed request; no inline retry.
    expect(f.modelCalls[1].timeoutMs).toBe(40_000);
    expect(f.peek().runtime.nativeHistory).toEqual(before);
    expect(f.sql.query).toHaveBeenCalledTimes(1);
    const turn = f.peek().runtime.nativeTurn as NativeAnalystTurn;
    expect(turn).toMatchObject({ stepIndex: 10, recoveryCount: 1, pendingCalls: [] });
    expect(turn.pendingGeneration).toBeUndefined();
    expect(turn.meter.attempts[1]).toMatchObject({
      reservationNanoUsd: 1000,
      receipt: { kind: 'unknown', reason: 'transport-error', transportStarted: true },
    });
    expect(turn.generationFailures).toEqual([
      expect.objectContaining({ code: 'ANALYST_MODEL_TIMEOUT', attemptIds: ['a2'], recoveryScheduled: true }),
    ]);
    expect(f.diagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'ANALYST_MODEL_TIMEOUT',
        generationId: expect.any(String),
        elapsedMs: expect.any(Number),
        requestId: 'request-recovery',
      }),
    );
    f.outputs.push(calls({ name: 'publish_notebook', input: publication }));
    await f.service.advance('org-a', 'chat');
    expect(f.modelCalls[2].messages).toEqual(f.modelCalls[1].messages);
    expect((await f.service.advance('org-a', 'chat')).status).toBe('completed');
    expect(f.sql.query).toHaveBeenCalledTimes(1);
    expect(f.sql.reexecute).toHaveBeenCalledTimes(1);
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).stepIndex).toBe(11);
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).meter.attempts).toHaveLength(3);
    const savedFailures = f.peek().runtime.nativeFailures;
    await f.service.send('org-a', 'chat', 'm2', 'What is a draft?');
    expect(f.peek().runtime.nativeFailures).toEqual(savedFailures);
    expect(f.peek().runtime.nativeFailures).toEqual([
      expect.objectContaining({
        messageId: 'm1',
        code: 'ANALYST_MODEL_TIMEOUT',
        requestId: 'request-recovery',
      }),
    ]);
  });
  it('allows only one fresh inference after observed network failure and retains both unknown charges', async () => {
    const f = fixture();
    await f.start();
    f.failures.push(
      { code: 'ANALYST_MODEL_PROVIDER', receipt: 'transport' },
      { code: 'ANALYST_MODEL_PROVIDER', receipt: 'transport' },
    );
    expect((await f.service.advance('org-a', 'chat')).status).toBe('running');
    expect((await f.service.advance('org-a', 'chat')).error?.code).toBe('ANALYST_MODEL_PROVIDER');
    await f.service.advance('org-a', 'chat');
    const turn = f.peek().runtime.nativeTurn as NativeAnalystTurn;
    expect(turn.stepIndex).toBe(0);
    expect(turn.recoveryCount).toBe(1);
    expect(turn.generationFailures?.map((failure) => failure.recoveryScheduled)).toEqual([true, false]);
    expect(new Set(turn.generationFailures?.map((failure) => failure.generationId)).size).toBe(2);
    expect(turn.meter.attempts.map((attempt) => attempt.reservationNanoUsd)).toEqual([1000, 1000]);
    expect(f.modelCalls).toHaveLength(2);
    expect(f.sql.query).not.toHaveBeenCalled();
    expect(f.peek().state.messages).toHaveLength(1);
  });
  it('admits recovery through the original budget and retains the failed reservation when headroom is insufficient', async () => {
    const f = fixture();
    await f.start();
    f.failures.push({ code: 'ANALYST_MODEL_TIMEOUT', receipt: 'transport' });
    await f.service.advance('org-a', 'chat');
    f.edit((record) => {
      (record.runtime.nativeTurn as NativeAnalystTurn).meter.attempts[0].reservationNanoUsd = 9500;
    });
    const state = await f.service.advance('org-a', 'chat');
    expect(state.error?.code).toBe('ANALYST_BUDGET_LIMIT');
    expect(f.externalBefore).toHaveBeenCalledTimes(1);
    expect(f.externalAfter).toHaveBeenCalledTimes(1);
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).meter.attempts).toHaveLength(1);
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).meter.attempts[0].reservationNanoUsd).toBe(
      9500,
    );
  });
  it.each([
    ['ANALYST_MODEL_PROVIDER', 'http-error'],
    ['ANALYST_MODEL_PROVIDER', 'malformed'],
    ['ANALYST_MODEL_ACCOUNTING', 'transport'],
    ['ANALYST_MODEL_CANCELLED', 'transport'],
    ['ANALYST_MODEL_INPUT', 'known'],
    ['ANALYST_MODEL_BUDGET', 'known'],
    ['ANALYST_MODEL_TIMEOUT', 'not-dispatched'],
  ] as const)('does not recover %s with %s evidence', async (code, receipt) => {
    const f = fixture();
    await f.start();
    f.failures.push({ code, receipt });
    expect((await f.service.advance('org-a', 'chat')).error?.code).toBe(code);
    await f.service.advance('org-a', 'chat');
    expect(f.modelCalls).toHaveLength(1);
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).recoveryCount).toBeUndefined();
  });
  it('does not recover when the usage callback failed even though a local receipt was saved', async () => {
    const f = fixture();
    await f.start();
    f.failures.push({ code: 'ANALYST_MODEL_TIMEOUT', receipt: 'transport' });
    f.externalAfter.mockRejectedValueOnce(new AnalystModelError('ANALYST_MODEL_TIMEOUT'));
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('failed');
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).recoveryCount).toBeUndefined();
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).meter.attempts[0].receipt?.kind).toBe(
      'unknown',
    );
  });
  it('never repeats generation after a response arrived, even if saving that response reports a typed timeout', async () => {
    const f = fixture();
    await f.start();
    f.outputs.push(calls({ name: 'query_sql', input: { sql: 'SELECT 1' } }));
    const save = f.store.save;
    let failed = false;
    f.store.save = async (org, id, token, record) => {
      if (!failed && (record.runtime.nativeTurn as NativeAnalystTurn | undefined)?.pendingCalls.length) {
        failed = true;
        throw new AnalystModelError('ANALYST_MODEL_TIMEOUT');
      }
      await save(org, id, token, record);
    };
    expect((await f.service.advance('org-a', 'chat')).status).toBe('failed');
    await f.service.advance('org-a', 'chat');
    expect(f.modelCalls).toHaveLength(1);
    expect(f.sql.query).not.toHaveBeenCalled();
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).recoveryCount).toBeUndefined();
  });
  it('honors Stop during an inference failure and a Stop racing the saved recovery state', async () => {
    for (const raceDuringSave of [false, true]) {
      const f = fixture();
      await f.start();
      f.failures.push({ code: 'ANALYST_MODEL_TIMEOUT', receipt: 'transport' });
      if (raceDuringSave) {
        const save = f.store.save;
        f.store.save = async (org, id, token, record) => {
          if (record.state.phase === 'Recovering an interrupted model request')
            await f.service.close(org, id);
          await save(org, id, token, record);
        };
      } else
        f.setBeforeModel(async () => {
          await f.service.close('org-a', 'chat');
        });
      const state = await f.service.advance('org-a', 'chat');
      expect(state.status).toBe('closed');
      await f.service.advance('org-a', 'chat');
      expect(f.modelCalls).toHaveLength(1);
      expect(state.messages).toHaveLength(1);
      expect(f.sql.query).not.toHaveBeenCalled();
    }
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

  it('executes the tenth investigation result and reserves a publication generation to deliver its checked answer and chart', async () => {
    const f = fixture();
    await f.start();
    for (let index = 0; index < 10; index++) {
      f.outputs.push(calls({ name: 'query_sql', input: { sql: `SELECT ${index} AS amount` } }));
      await f.service.advance('org-a', 'chat');
      await f.service.advance('org-a', 'chat');
    }
    expect(f.sql.query).toHaveBeenCalledTimes(10);
    expect(f.modelCalls[9].instructions).toContain('including this generation when applicable): 1.');
    expect(f.modelToolNames[9]).toContain('query_sql');
    f.outputs.push(
      calls({
        name: 'publish_notebook',
        input: {
          ...publication,
          tables: [{ queryId: 'q10' }],
          charts: [{ ...publication.charts[0], queryId: 'q10' }],
        },
      }),
    );
    await f.service.advance('org-a', 'chat');
    expect(f.modelToolNames[10]).toEqual(['publish_notebook']);
    expect(f.modelCalls[10].instructions).toContain('Current phase: publication only.');
    expect(f.modelCalls[10].instructions).toContain('Saved CURRENT-TURN query IDs: q1, q2, q3');
    expect(f.modelCalls[10].instructions).toContain('q10.');
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('completed');
    expect(state.messages.at(-1)?.content).toBe(publication.notes);
    expect(state.notebook.cells.some((cell) => cell.outputs.some((output) => output.type === 'chart'))).toBe(
      true,
    );
    expect(f.sql.query).toHaveBeenCalledTimes(10);
    expect(f.sql.reexecute).toHaveBeenCalledTimes(1);
    expect(f.modelCalls).toHaveLength(11);
  });

  it('repairs invalid chart columns in the final publication generation without requesting new data', async () => {
    const f = await atPublicationBoundary();
    f.outputs.push(
      calls({
        name: 'publish_notebook',
        input: { ...publication, charts: [{ ...publication.charts[0], yColumns: ['missing_column'] }] },
      }),
      calls({ name: 'publish_notebook', input: publication }),
    );
    await f.service.advance('org-a', 'chat');
    const rejected = await f.service.advance('org-a', 'chat');
    expect(rejected.status).toBe('running');
    expect(rejected.notebook.cells).toHaveLength(0);
    await f.service.advance('org-a', 'chat');
    expect(JSON.stringify(f.modelCalls[2].messages)).toContain('missing_column');
    expect(f.modelCalls[2].instructions).toContain(
      'Remaining publication-only generations (including this generation when applicable): 1.',
    );
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('completed');
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).stepIndex).toBe(12);
    expect(f.sql.query).toHaveBeenCalledTimes(1);
  });

  it('uses the second reserved publication generation to revise changed evidence and recheck it again', async () => {
    const f = await atPublicationBoundary();
    f.outputs.push(
      calls({ name: 'publish_notebook', input: publication }),
      calls({
        name: 'publish_notebook',
        input: { ...publication, notes: 'The current recorded cost is99.01 USD.' },
      }),
    );
    vi.mocked(f.sql.reexecute).mockResolvedValueOnce({
      results: [{ ...result(), rows: [['2026-10', '99.01']], hash: 'changed' }],
      changedQueryIds: ['q1'],
    });
    await f.service.advance('org-a', 'chat');
    const changed = await f.service.advance('org-a', 'chat');
    expect(changed.status).toBe('running');
    expect(changed.notebook.cells).toHaveLength(0);
    await f.service.advance('org-a', 'chat');
    expect(JSON.stringify(f.modelCalls[2].messages)).toContain('ANALYST_SNAPSHOT_CHANGED');
    expect(JSON.stringify(f.modelCalls[2].messages)).toContain('99.01');
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('completed');
    expect(state.messages.at(-1)?.content).toContain('99.01');
    expect(JSON.stringify(state.notebook)).toContain('99.01');
    expect(f.sql.query).toHaveBeenCalledTimes(1);
    expect(f.sql.reexecute).toHaveBeenCalledTimes(2);
  });

  it('can remove an unrequested chart after duplicate coordinates are rejected, retaining the complete checked table', async () => {
    const f = await atPublicationBoundary();
    f.edit((record) => {
      const source = (record.runtime.nativeTurn as NativeAnalystTurn).results[0];
      source.rows = [
        ['2026-10', '42.01'],
        ['2026-10', '17.50'],
      ];
      source.rowCount = 2;
    });
    f.outputs.push(
      calls({ name: 'publish_notebook', input: publication }),
      calls({
        name: 'publish_notebook',
        input: { ...publication, notes: 'Here are both recorded costs.', charts: [] },
      }),
    );
    await f.service.advance('org-a', 'chat');
    await f.service.advance('org-a', 'chat');
    expect(f.peek().state.notebook.cells).toHaveLength(0);
    expect(JSON.stringify(f.peek().runtime.nativeHistory)).toContain('ANALYST_NOTEBOOK_DUPLICATE');
    await f.service.advance('org-a', 'chat');
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('completed');
    expect(JSON.stringify(state.notebook)).toContain('42.01');
    expect(JSON.stringify(state.notebook)).toContain('17.50');
    expect(state.notebook.cells.some((cell) => cell.outputs.some((output) => output.type === 'chart'))).toBe(
      false,
    );
    expect(f.sql.query).toHaveBeenCalledTimes(1);
  });

  it('enforces publication-only tools in the executor even if the model requests forbidden SQL or schema reads', async () => {
    const f = await atPublicationBoundary();
    const forbidden = calls(
      { name: 'query_sql', input: { sql: 'SELECT 900000 AS amount' } },
      { name: 'inspect_schema', input: {} },
    );
    forbidden.toolCalls[0].invalid = true;
    f.outputs.push(forbidden, calls({ name: 'publish_notebook', input: publication }));
    await f.service.advance('org-a', 'chat');
    await f.service.advance('org-a', 'chat');
    expect(f.modelToolNames[1]).toEqual(['publish_notebook']);
    expect(f.sql.query).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.peek().runtime.nativeHistory).match(/ANALYST_PUBLICATION_ONLY/g)).toHaveLength(2);
    await f.service.advance('org-a', 'chat');
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('completed');
    expect(f.sql.query).toHaveBeenCalledTimes(1);
  });

  it('replaces an SDK-generated invalid-call error with one durable safe result and can repair an all-invalid generation', async () => {
    const f = await atPublicationBoundary();
    const priorMessages = (f.peek().runtime.nativeHistory as unknown[]).length;
    const invalid = calls({ name: 'query_sql', input: { sql: 'SELECT 123' } });
    invalid.toolCalls[0].invalid = true;
    invalid.responseMessages.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 't0',
          toolName: 'query_sql',
          output: { type: 'error-text', value: 'SDK validation detail' },
        },
      ],
    });
    invalid.toolResults = [{ toolCallId: 't0', toolName: 'query_sql', kind: 'error' }];
    f.outputs.push(invalid, calls({ name: 'publish_notebook', input: publication }));
    await f.service.advance('org-a', 'chat');
    await f.service.advance('org-a', 'chat');
    const added = (f.peek().runtime.nativeHistory as { role: string; content: unknown }[]).slice(
      priorMessages,
    );
    expect(added.filter((message) => message.role === 'tool')).toHaveLength(1);
    expect(JSON.stringify(added)).toContain('opaque-signature');
    expect(JSON.stringify(added)).toContain('ANALYST_PUBLICATION_ONLY');
    expect(JSON.stringify(added)).not.toContain('SDK validation detail');
    expect(f.sql.query).toHaveBeenCalledTimes(1);
    await f.service.advance('org-a', 'chat');
    expect((await f.service.advance('org-a', 'chat')).status).toBe('completed');
  });

  it('rejects an unexpected SDK result for a valid call before executing or trusting that call', async () => {
    const f = fixture();
    await f.start();
    const unexpected = calls({ name: 'query_sql', input: { sql: 'SELECT 123' } });
    unexpected.responseMessages.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 't0',
          toolName: 'query_sql',
          output: { type: 'json', value: { amount: '123' } },
        },
      ],
    });
    unexpected.toolResults = [{ toolCallId: 't0', toolName: 'query_sql', kind: 'result' }];
    f.outputs.push(unexpected);
    const state = await f.service.advance('org-a', 'chat');
    expect(state.error?.code).toBe('ANALYST_INVALID_RESPONSE');
    expect(state.messages).toHaveLength(1);
    expect(f.sql.query).not.toHaveBeenCalled();
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).pendingCalls).toHaveLength(0);
  });

  it('stops after two unsuccessful publication generations without a thirteenth generation or an invented answer', async () => {
    const f = await atPublicationBoundary();
    f.outputs.push(
      calls({ name: 'publish_notebook', input: { title: 'Unsupported' } }),
      calls({ name: 'publish_notebook', input: { title: 'Still unsupported' } }),
    );
    for (let index = 0; index < 4; index++) await f.service.advance('org-a', 'chat');
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('failed');
    expect(state.error?.code).toBe('ANALYST_STEP_LIMIT');
    expect(state.error?.message).toContain('could not finish and check a complete answer');
    expect(state.messages).toHaveLength(1);
    expect(state.notebook.cells).toHaveLength(0);
    expect(f.modelCalls).toHaveLength(3);
    expect(f.peek().runtime.nativeTurn).toMatchObject({ stepIndex: 12, results: [{ id: 'q1' }] });
    await f.service.advance('org-a', 'chat');
    expect(f.modelCalls).toHaveLength(3);
  });

  it('honors Stop during a reserved publication generation and retains usage without publishing the late result', async () => {
    const f = await atPublicationBoundary();
    f.outputs.push(calls({ name: 'publish_notebook', input: publication }));
    f.setBeforeModel(async () => {
      await f.service.close('org-a', 'chat');
    });
    const state = await f.service.advance('org-a', 'chat');
    expect(state.status).toBe('closed');
    expect(state.messages).toHaveLength(1);
    expect(state.notebook.cells).toHaveLength(0);
    expect(f.sql.reexecute).not.toHaveBeenCalled();
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).meter.attempts.at(-1)?.receipt?.kind).toBe(
      'known',
    );
  });

  it('keeps the same per-turn allowance during reserved publication generations', async () => {
    const f = await atPublicationBoundary();
    f.edit((record) => {
      const prior = (record.runtime.nativeTurn as NativeAnalystTurn).meter.attempts[0];
      prior.receipt = undefined;
      prior.reservationNanoUsd = 9500;
    });
    f.outputs.push(calls({ name: 'publish_notebook', input: publication }));
    const state = await f.service.advance('org-a', 'chat');
    expect(state.error?.code).toBe('ANALYST_BUDGET_LIMIT');
    expect(f.externalBefore).toHaveBeenCalledTimes(1);
    expect(f.externalAfter).toHaveBeenCalledTimes(1);
    expect(f.sql.reexecute).not.toHaveBeenCalled();
    expect((f.peek().runtime.nativeTurn as NativeAnalystTurn).meter.attempts).toHaveLength(1);
  });
});
