import { describe, expect, it } from 'vitest';
import { createNativeAnalystService, type NativeAnalystTurn } from '../server/native-analyst-service';
import { createNativeModel } from '../server/analyst-model';
import type { AnalystRecord, AnalystStore } from '../server/analyst-store';
import type { AnalystSqlResult, createAnalystSql } from '../server/analyst-sql';

const stamp = '2026-11-03T12:00:00.000Z';
const persisted = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function memory() {
  let saved: AnalystRecord;
  let lease: string | undefined;
  let closed = false;
  let saveIndex = 0;
  const store: AnalystStore = {
    async create(_org, state) {
      saved = persisted({ state, runtime: {}, lastMessageId: null, lastMessageText: null });
      return persisted(saved);
    },
    async read() {
      return persisted(saved);
    },
    async queue(_org, _id, _provider, messageId, text) {
      saved.state.messages.push({ id: messageId, role: 'user', content: text, createdAt: stamp });
      saved.state.status = 'starting';
      saved.state.error = null;
      saved.lastMessageId = messageId;
      saved.lastMessageText = text;
      saved.runtime = { nativeHistory: saved.runtime.nativeHistory ?? [] };
      return persisted(saved);
    },
    async claim() {
      if (lease) return null;
      lease = String(++saveIndex);
      return { token: lease, record: persisted(saved) };
    },
    async save(_org, _id, token, next) {
      if (lease !== token) throw new Error('Lost lease');
      if (closed) next.runtime.closeRequested = true;
      saved = persisted(next);
    },
    async release(_org, _id, token) {
      if (lease === token) lease = undefined;
    },
    async requestClose() {
      closed = true;
      saved.runtime.closeRequested = true;
      saved.state.status = 'running';
      return persisted(saved);
    },
  };
  return { store, peek: () => persisted(saved) };
}
const queryResult = (id: string): AnalystSqlResult => ({
  id,
  organizationId: 'org',
  sql: 'SELECT 42.01::numeric AS amount',
  params: [],
  executedAt: stamp,
  columns: [{ name: 'amount', oid: 1700, kind: 'decimal' }],
  rows: [['42.01']],
  rowCount: 1,
  truncated: false,
  hash: 'stable',
});
function fakeSql() {
  const reads: string[] = [];
  return {
    reads,
    sql: {
      query: async (_org: string, query: { id: string }) => {
        reads.push(query.id);
        return queryResult(query.id);
      },
      reexecute: async (_org: string, results: AnalystSqlResult[]) => ({
        results: persisted(results),
        changedQueryIds: [],
      }),
    } as unknown as ReturnType<typeof createAnalystSql>,
  };
}
const reply = (parts: unknown[]) =>
  Response.json({
    candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 10,
      totalTokenCount: 130,
    },
  });

describe('independent actual-SDK / durable-service contract', () => {
  it('round-trips signed calls and exact saved results into the next real SDK request and supports a follow-up', async () => {
    const db = memory(),
      sql = fakeSql(),
      requests: Record<string, unknown>[] = [];
    const replies = [
      reply([
        {
          functionCall: { name: 'query_sql', args: { sql: 'SELECT 42.01::numeric AS amount', params: [] } },
          thoughtSignature: 'opaque-first-signature',
        },
      ]),
      reply([
        {
          functionCall: {
            name: 'publish_notebook',
            args: {
              title: 'Recorded amount',
              notes: 'Recorded amount is $42.01.',
              tables: [{ queryId: 'q1' }],
              charts: [],
            },
          },
          thoughtSignature: 'opaque-second-signature',
        },
      ]),
      reply([{ text: 'It is the exact posted amount from your earlier query.' }]),
    ];
    const service = createNativeAnalystService({
      store: db.store,
      sql: sql.sql,
      settings: () => ({ apiKey: 'fake-never-transmitted', turnBudgetNanoUsd: 500_000_000 }),
      now: () => new Date(stamp),
      modelFactory: (options) =>
        createNativeModel({
          ...options,
          fetch: async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            const response = replies.shift();
            if (!response) throw new Error('Unexpected extra HTTP');
            return response;
          },
        }),
    });
    await service.create('org', 'chat');
    await service.send('org', 'chat', 'm1', 'Show my posted amount.');
    const first = await service.advance('org', 'chat');
    expect(first.status).toBe('running');
    expect(sql.reads).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(db.peek().runtime.nativeHistory)).toContain('opaque-first-signature');
    await service.advance('org', 'chat');
    expect(sql.reads).toEqual(['q1']);
    expect(requests).toHaveLength(1);
    await service.advance('org', 'chat');
    expect(requests).toHaveLength(2);
    const second = JSON.stringify(requests[1]);
    expect(second).toContain('opaque-first-signature');
    expect(second).toContain('functionResponse');
    expect(second).toContain('42.01');
    expect(second).toContain('q1');
    const complete = await service.advance('org', 'chat');
    expect(complete.status).toBe('completed');
    expect(complete.messages.at(-1)?.content).toBe('Recorded amount is $42.01.');
    expect(complete.notebook.cells.flatMap((c) => c.outputs)).toContainEqual(
      expect.objectContaining({ type: 'table', rows: [['42.01']] }),
    );
    const turn = db.peek().runtime.nativeTurn as NativeAnalystTurn;
    expect(turn.meter.attempts).toHaveLength(2);
    expect(turn.meter.attempts.every((a) => a.receipt?.kind === 'known')).toBe(true);
    await service.send('org', 'chat', 'm2', 'What does that mean?');
    expect((await service.advance('org', 'chat')).status).toBe('completed');
    const third = JSON.stringify(requests[2]);
    expect(third).toContain('opaque-second-signature');
    expect(third).toContain('Recorded amount is $42.01.');
    expect(third).toContain('What does that mean?');
    expect(requests).toHaveLength(3);
  });
});
