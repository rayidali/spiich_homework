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
  return {
    store,
    peek: () => persisted(saved),
    enterPublication: () => {
      (saved.runtime.nativeTurn as NativeAnalystTurn).stepIndex = 10;
    },
  };
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

  it('narrows tools for publication, gives an SDK-rejected tool exactly one result, and preserves signed history through repair and follow-up', async () => {
    const db = memory(),
      sql = fakeSql(),
      requests: Record<string, unknown>[] = [];
    const replies = [
      reply([
        {
          functionCall: { name: 'query_sql', args: { sql: 'SELECT 42.01::numeric AS amount' } },
          thoughtSignature: 'signed-query',
        },
      ]),
      reply([
        {
          functionCall: { name: 'query_sql', args: { sql: 'SELECT 900000 AS amount' } },
          thoughtSignature: 'signed-unavailable-query',
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
          thoughtSignature: 'signed-publication',
        },
      ]),
      reply([{ text: 'This is a recorded amount, not proof of bank settlement.' }]),
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
    const declarations = (request: Record<string, unknown>) =>
      (request.tools as { functionDeclarations: { name: string }[] }[]).flatMap((tool) =>
        tool.functionDeclarations.map((fn) => fn.name),
      );
    await service.create('org', 'chat');
    await service.send('org', 'chat', 'm1', 'Show my posted amount.');
    await service.advance('org', 'chat');
    await service.advance('org', 'chat');
    db.enterPublication();
    await service.advance('org', 'chat');
    expect(declarations(requests[1])).toEqual(['publish_notebook']);
    expect(JSON.stringify(requests[1].systemInstruction)).toContain('Current phase: publication only.');
    const rejected = await service.advance('org', 'chat');
    expect(rejected.status).toBe('running');
    expect(sql.reads).toEqual(['q1']);
    const history = db.peek().runtime.nativeHistory as { role: string; content: unknown }[];
    const results = history
      .filter((message) => message.role === 'tool')
      .flatMap((message) => message.content as { toolCallId: string }[]);
    const resultCounts = results.reduce(
      (counts, result) => {
        counts[result.toolCallId] = (counts[result.toolCallId] ?? 0) + 1;
        return counts;
      },
      {} as Record<string, number>,
    );
    expect(Object.values(resultCounts)).toEqual([1, 1]);
    await service.advance('org', 'chat');
    const outgoing = JSON.stringify(requests[2]);
    expect(outgoing).toContain('signed-query');
    expect(outgoing).toContain('signed-unavailable-query');
    expect(outgoing).toContain('ANALYST_PUBLICATION_ONLY');
    expect(outgoing.match(/"functionResponse"/g)).toHaveLength(2);
    expect(outgoing).toContain('42.01');
    expect(declarations(requests[2])).toEqual(['publish_notebook']);
    const final = await service.advance('org', 'chat');
    expect(final.status).toBe('completed');
    expect(final.messages.at(-1)?.content).toBe('Recorded amount is $42.01.');
    expect((db.peek().runtime.nativeTurn as NativeAnalystTurn).stepIndex).toBe(12);
    await service.send('org', 'chat', 'm2', 'Does that mean the bank confirmed it?');
    expect((await service.advance('org', 'chat')).status).toBe('completed');
    expect(declarations(requests[3]).sort()).toEqual(['inspect_schema', 'publish_notebook', 'query_sql']);
    expect(JSON.stringify(requests[3].systemInstruction)).toContain('Current phase: investigation.');
    expect(JSON.stringify(requests[3])).toContain('signed-publication');
    expect(requests).toHaveLength(4);
    expect(sql.reads).toEqual(['q1']);
  });
});
