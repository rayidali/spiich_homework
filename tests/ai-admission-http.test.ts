import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const callbacks = vi.hoisted(() => ({ chat: vi.fn(), entry: vi.fn(), category: vi.fn() }));
vi.mock('../server/ai', async (original) => ({
  ...(await original<typeof import('../server/ai')>()),
  financialChat: callbacks.chat,
  proposeEntry: callbacks.entry,
}));
vi.mock('../server/category-service', async (original) => ({
  ...(await original<typeof import('../server/category-service')>()),
  suggestCategory: callbacks.category,
}));
vi.mock('../server/ai-admission', async (original) => {
  const actual = await original<typeof import('../server/ai-admission')>();
  return {
    ...actual,
    withAiAdmission: actual.createAiAdmission(actual.createPostgresAiAdmissionStore(), {
      requestsPerDay: 3,
      requestsPerMinute: 120,
      maxActive: 4,
      leaseSeconds: 90,
    }),
  };
});

import { createApp } from '../server/app';
import { config } from '../server/config';
import { pool, query } from '../server/db';

const org = randomUUID();
const admin = new pg.Client({ connectionString: config.migrationUrl });
const savedConfig = {
  aiProvider: config.aiProvider,
  aiKey: config.aiKey,
  aiModel: config.aiModel,
  categoryProvider: config.categoryProvider,
  categoryKey: config.categoryKey,
};
let connected = false;

beforeAll(async () => {
  for (const value of [config.databaseUrl, config.migrationUrl]) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const compose =
      process.env.NODE_ENV === 'test' &&
      url.hostname === 'db' &&
      url.port === '5432' &&
      url.pathname === '/spiich';
    if (!local && !compose) throw new Error('AI HTTP admission tests require isolated local/CI PostgreSQL.');
  }
  // No real provider configuration is needed by the three stubbed callbacks.
  Object.assign(config, {
    aiProvider: 'gemini',
    aiModel: 'gemini-3.5-flash-lite',
    aiKey: '',
    categoryProvider: 'reference',
    categoryKey: '',
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await admin.connect();
  connected = true;
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Isolated AI HTTP admission test')", [org]);
});

afterAll(async () => {
  try {
    if (connected) await admin.query('DELETE FROM organizations WHERE id=$1', [org]);
  } finally {
    Object.assign(config, savedConfig);
    vi.restoreAllMocks();
    if (connected) await admin.end();
    await pool.end();
  }
});

describe('Shared AI admission through HTTP with real PostgreSQL and stubbed model callbacks', () => {
  it('validates before charging, shares the daily allowance across all three routes, and releases every lease', async () => {
    const app = createApp(org);
    const messages = [{ role: 'user', content: 'Synthetic admission request' }];
    const category = {
      description: 'Synthetic supplies purchase',
      counterparty: 'Synthetic merchant',
      direction: 'OUT',
      amount: '340',
      date: '2026-10-31',
      currency: 'USD',
      exchangeRate: '1',
      fundingAccountId: randomUUID(),
      purpose: 'BUSINESS',
      structure: 'SINGLE',
    };
    const cases = [
      {
        path: '/api/ai/chat',
        input: { messages },
        malformed: { messages: [{ role: 'assistant', content: 'Cannot end with an assistant turn' }] },
        callback: callbacks.chat,
        callbackArgs: [org, messages],
        output: { answer: 'Synthetic chat result', evidence: [] },
      },
      {
        path: '/api/ai/entry',
        input: { messages, date: '2026-10-31' },
        malformed: { messages, date: '2026-02-30' },
        callback: callbacks.entry,
        callbackArgs: [org, messages, '2026-10-31'],
        output: { status: 'CLARIFY', question: 'Synthetic proposal callback result' },
      },
      {
        path: '/api/ai/category',
        input: category,
        malformed: { ...category, description: '   ' },
        callback: callbacks.category,
        callbackArgs: [org, category],
        output: { decision: 'CLARIFY', question: 'Synthetic category callback result' },
      },
    ];
    const requestIds = new Set<string>();
    function checkRequestId(response: Response) {
      const id = response.headers['x-request-id'];
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(requestIds.has(id)).toBe(false);
      requestIds.add(id);
      if (response.status >= 400) expect(response.body.error.requestId).toBe(id);
    }
    async function state() {
      return query<{ minute_count: number; day_count: number }>(
        'SELECT minute_count,day_count FROM ai_admission_state WHERE organization_id=$1',
        [org],
      );
    }
    async function leases() {
      return query<{ id: string }>('SELECT id FROM ai_admission_leases WHERE organization_id=$1', [org]);
    }
    for (const item of cases) {
      item.callback.mockImplementation(async () => {
        // Prove the HTTP route acquired the real operational lease before work.
        expect(await leases()).toHaveLength(1);
        return item.output;
      });
      const response = await request(app)
        .post(item.path)
        .set('X-Request-Id', 'client-selected-id')
        .send(item.malformed);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_INPUT');
      expect(response.headers['retry-after']).toBeUndefined();
      checkRequestId(response);
    }
    // The body is below Express's byte cap, but exceeds the shared character
    // budget before any trimming. Both conversation routes must reject it
    // before either a model callback or the shared allowance is touched.
    const paddedMessages = Array.from({ length: 20 }, () => ({
      role: 'user',
      content: ' '.repeat(3999) + 'x',
    }));
    for (const path of ['/api/ai/chat', '/api/ai/entry']) {
      const body = path.endsWith('/entry')
        ? { messages: paddedMessages, date: '2026-10-31' }
        : { messages: paddedMessages };
      const response = await request(app).post(path).send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_INPUT');
      expect(response.body.error.message).toContain('conversation is full');
      checkRequestId(response);
    }
    expect(await state()).toEqual([]);
    expect(await leases()).toEqual([]);
    for (const item of cases) expect(item.callback).not.toHaveBeenCalled();

    // Keep the real database-clock windows stable across a possible UTC minute
    // or day boundary. Only this isolated fixture's zero-count state is seeded.
    await admin.query(
      `INSERT INTO ai_admission_state(organization_id,minute_start_epoch,minute_count,day_start_epoch,day_count,updated_at)
       VALUES($1,floor(extract(epoch FROM clock_timestamp())/60)::bigint*60+60,0,
         floor(extract(epoch FROM clock_timestamp())/86400)::bigint*86400+86400,0,clock_timestamp())`,
      [org],
    );
    for (const [index, item] of cases.entries()) {
      const response = await request(app).post(item.path).send(item.input);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(item.output);
      expect(response.headers['retry-after']).toBeUndefined();
      checkRequestId(response);
      expect(item.callback).toHaveBeenCalledExactlyOnceWith(...item.callbackArgs);
      expect(await state()).toEqual([{ minute_count: index + 1, day_count: index + 1 }]);
      expect(await leases()).toEqual([]);
    }

    // These are valid requests: every channel must reject them before its callback,
    // even though each individual callback has only been used once.
    for (const item of cases) {
      const response = await request(app).post(item.path).send(item.input);
      expect(response.status).toBe(429);
      expect(response.body.error).toMatchObject({ code: 'AI_REQUEST_LIMIT', details: { scope: 'day' } });
      checkRequestId(response);
      const retryAfter = Number(response.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(86400);
      expect(retryAfter).toBe(response.body.error.details.retryAfterSeconds);
      expect(await state()).toEqual([{ minute_count: 3, day_count: 3 }]);
      expect(await leases()).toEqual([]);
    }
    expect(cases.reduce((total, item) => total + item.callback.mock.calls.length, 0)).toBe(3);
    expect(requestIds.size).toBe(11);
    expect(await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).toEqual([]);
  });
});
