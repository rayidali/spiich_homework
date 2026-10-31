import { EventEmitter } from 'node:events';
import type { Request, Response as ExpressResponse } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const database = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  listeners: new Map<string, (error: unknown) => void>(),
  release: vi.fn(),
}));
vi.mock('pg', () => ({
  default: {
    types: { setTypeParser: vi.fn() },
    Pool: class {
      query = database.query;
      connect = database.connect;
      on(event: string, handler: (error: unknown) => void) {
        database.listeners.set(event, handler);
        return this;
      }
    },
  },
}));

import { config } from '../server/config';
import { apiErrorHandler } from '../server/app';
import { financialChat, proposeEntry } from '../server/ai';
import { generateProposal, resetAiUsage, setAiBudget } from '../server/ai-provider';
import { diagnostic, requestDiagnostics, routeTemplate } from '../server/diagnostics';
import { AppError, failureStage } from '../server/errors';

const privateText = 'PRIVATE_ACCOUNTING_CONTENT_DO_NOT_LOG';
const fetchMock = vi.fn();
const saved = { aiProvider: config.aiProvider, aiKey: config.aiKey, aiModel: config.aiModel };
const userMessages = [{ role: 'user' as const, content: privateText }];
const org = '00000000-0000-4000-8000-000000000001';
const debitId = '00000000-0000-4000-8000-000000000002';
const creditId = '00000000-0000-4000-8000-000000000003';
const schema = z.strictObject({ amount: z.string() });

function providerResponse(parts: unknown[]) {
  return new Response(
    JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
    }),
    { status: 200 },
  );
}
function proposal(overrides: Record<string, unknown> = {}) {
  return {
    action: 'READY',
    description: privateText,
    date: '2026-10-31',
    counterparty: '',
    reference: '',
    explanation: '',
    questions: [],
    lines: [
      { accountId: debitId, debit: '25', credit: '0', exchangeRate: '1', memo: '' },
      { accountId: creditId, debit: '0', credit: '25', exchangeRate: '1', memo: '' },
    ],
    ...overrides,
  };
}
function logs() {
  return [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls].map(
    ([line]) => JSON.parse(String(line)) as Record<string, unknown>,
  );
}

// Exercise the actual middleware/handler without opening a socket or making a provider call.
function requestFlow(operation: () => Promise<unknown>, route = '/api/ai/entry') {
  const headers = new Map<string, string>();
  const res = Object.assign(new EventEmitter(), {
    locals: {} as Record<string, unknown>,
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    status(value: number) {
      this.statusCode = value;
      return this;
    },
    json(value: unknown) {
      this.body = value;
      (this as unknown as EventEmitter).emit('finish');
      return this;
    },
  });
  const req = {
    method: 'POST',
    path: '/' + privateText,
    originalUrl: '/?' + privateText,
    headers: { 'x-request-id': privateText, authorization: privateText },
    route: { path: route },
  } as unknown as Request;
  const done = new Promise<void>((resolve) => {
    requestDiagnostics(req, res as unknown as ExpressResponse, () => {
      void operation()
        .then(() => {
          res.json({ ok: true });
          resolve();
        })
        .catch((error: unknown) => {
          apiErrorHandler(error, req, res as unknown as ExpressResponse, () => {});
          resolve();
        });
    });
  });
  return { headers, res, done };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'a'.repeat(40));
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_syntheticdeployment');
  vi.stubGlobal('fetch', fetchMock);
  config.aiProvider = 'gemini';
  config.aiModel = 'gemini-3.5-flash-lite';
  config.aiKey = 'PRIVATE_PROVIDER_KEY_DO_NOT_LOG';
  database.query.mockResolvedValue({ rows: [] });
  database.connect.mockResolvedValue({ query: database.query, release: database.release });
  setAiBudget(null);
  resetAiUsage();
});
afterEach(() => {
  Object.assign(config, saved);
  setAiBudget(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Request-correlated diagnostics without business content', () => {
  it('records the selected financial query with the request reference, without conversation or arguments', async () => {
    fetchMock.mockResolvedValue(
      providerResponse([{ functionCall: { name: 'ask_clarification', args: { question: privateText } } }]),
    );
    const flow = requestFlow(() => financialChat(org, userMessages), '/api/ai/chat');
    await flow.done;
    expect(flow.res.statusCode).toBe(200);
    expect(logs().find((entry) => entry.event === 'ai_financial_query')).toMatchObject({
      requestId: flow.headers.get('X-Request-Id'),
      tool: 'ask_clarification',
      provider: 'gemini',
      operation: 'financial_tool',
      deploymentRevision: 'a'.repeat(40),
    });
    expect(JSON.stringify(logs())).not.toContain(privateText);
    expect(logs().every((entry) => !('args' in entry))).toBe(true);
  });

  it('rejects unrecognized query names in diagnostics and preserves the safe expense-account failure code', () => {
    diagnostic('ai_financial_query', { tool: privateText });
    diagnostic('request_error', { code: 'INVALID_EXPENSE_ACCOUNT', stage: 'financial_tool' });
    expect(logs().find((entry) => entry.event === 'ai_financial_query')).not.toHaveProperty('tool');
    expect(logs().find((entry) => entry.event === 'request_error')).toMatchObject({
      code: 'INVALID_EXPENSE_ACCOUNT',
      stage: 'financial_tool',
    });
    expect(JSON.stringify(logs())).not.toContain(privateText);
  });

  it('keeps two interleaved provider failures bound to the matching response/header/HTTP event', async () => {
    const pending: ((value: Response) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
    const first = requestFlow(() => generateProposal(schema, privateText, userMessages));
    const second = requestFlow(() => generateProposal(schema, privateText, userMessages));
    const firstId = first.headers.get('X-Request-Id'),
      secondId = second.headers.get('X-Request-Id');
    expect(firstId).not.toBe(secondId);
    expect(firstId).not.toBe(privateText);
    pending[1](new globalThis.Response(JSON.stringify({ error: { message: privateText } }), { status: 429 }));
    await second.done;
    pending[0](new globalThis.Response(JSON.stringify({ error: { message: privateText } }), { status: 503 }));
    await first.done;
    for (const [flow, id, status] of [
      [first, firstId, 503],
      [second, secondId, 429],
    ] as const) {
      expect(flow.res.body).toMatchObject({ error: { requestId: id } });
      const matching = logs().filter((entry) => entry.requestId === id);
      expect(matching).toHaveLength(3);
      expect(matching.find((entry) => entry.event === 'ai_provider_failure')).toMatchObject({
        upstreamStatus: status,
        stage: 'provider_http',
        operation: 'proposal',
        route: '/api/ai/entry',
        deploymentRevision: 'a'.repeat(40),
        deploymentId: 'dpl_syntheticdeployment',
      });
      expect(matching.find((entry) => entry.event === 'http_request')).toMatchObject({ status });
    }
    expect(JSON.stringify(logs())).not.toContain(privateText);
    expect(JSON.stringify(logs())).not.toContain(config.aiKey);
    diagnostic('worker_error', { code: 'WORKER_ERROR', stage: 'background' });
    expect(logs().find((entry) => entry.event === 'worker_error')).not.toHaveProperty('requestId');
  });

  it('logs only registered route templates and selected safe fields', () => {
    diagnostic('request_error', {
      code: privateText,
      stage: 'internal',
      transportCode: privateText,
      databaseCode: privateText,
      model: config.aiKey,
      message: privateText,
      headers: { authorization: config.aiKey },
    } as Parameters<typeof diagnostic>[1]);
    expect(logs()[0]).toMatchObject({ code: 'UNKNOWN_ERROR', model: 'invalid' });
    expect(JSON.stringify(logs())).not.toContain('PRIVATE_');
    expect(routeTemplate('/api/entries/:id/post')).toBe('/api/entries/:id/post');
    expect(routeTemplate('/private/account?secret=' + privateText)).toBe('unmatched');
  });

  it('retains the new reviewed-posting/correction codes while rejecting arbitrary code text', () => {
    const codes = [
      'INVALID_PROPOSAL',
      'PROPOSAL_NOT_FOUND',
      'PROPOSAL_BINDING_INVALID',
      'PROPOSAL_ALREADY_USED',
      'PROPOSAL_EXPIRED',
      'CORRECTION_REQUIRES_POSTING',
      'CORRECTION_REVIEW_CHANGED',
      'REVIEWED_POSTING_REQUIRED',
      'ALERT_RESOLVED',
    ];
    for (const code of codes) diagnostic('request_error', { code, stage: 'application_validation' });
    expect(logs().map((entry) => entry.code)).toEqual(codes);
    diagnostic('request_error', { code: privateText });
    expect(logs().at(-1)?.code).toBe('UNKNOWN_ERROR');
  });

  it('bounds worker references to real bigint IDs and known operations', () => {
    for (const jobId of [123, '9223372036854775807'])
      diagnostic('worker_error', { code: 'WORKER_ERROR', operation: 'anomaly_analysis', jobId });
    expect(logs().map((entry) => entry.jobId)).toEqual(['123', '9223372036854775807']);
    for (const jobId of [
      privateText,
      '9223372036854775808',
      '12.5',
      '1e2',
      '-1',
      0,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      diagnostic('worker_error', { code: 'WORKER_ERROR', operation: 'anomaly_heartbeat', jobId });
    expect(
      logs()
        .slice(2)
        .every((entry) => !('jobId' in entry)),
    ).toBe(true);
    diagnostic('worker_error', { operation: privateText } as unknown as Parameters<typeof diagnostic>[1]);
    expect(logs().at(-1)).not.toHaveProperty('operation');
    expect(JSON.stringify(logs())).not.toContain(privateText);
  });

  it('does not log a raw database error, SQL parameters, or untrusted exception text', async () => {
    const error = Object.assign(new Error(privateText), {
      code: '23514',
      detail: config.aiKey,
      query: privateText,
    });
    const flow = requestFlow(async () => {
      throw error;
    }, '/api/entries');
    await flow.done;
    expect(flow.res.body).toMatchObject({
      error: { code: 'ACCOUNTING_RULE', message: 'This operation violates an accounting rule' },
    });
    expect(JSON.stringify(logs())).not.toContain(privateText);
    expect(JSON.stringify(logs())).not.toContain(config.aiKey);
    expect(logs().find((entry) => entry.event === 'request_error')).toMatchObject({
      stage: 'database',
      databaseCode: '23514',
    });
  });

  it('records disconnects without inventing a completed HTTP response', () => {
    const res = Object.assign(new EventEmitter(), { locals: {}, setHeader: vi.fn(), statusCode: 200 });
    requestDiagnostics({ method: 'POST' } as Request, res as unknown as ExpressResponse, () => {});
    res.emit('close');
    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({ event: 'request_error', code: 'REQUEST_ABORTED', route: 'unmatched' });
    expect(logs()[0]).not.toHaveProperty('status');
  });

  it('keeps a reference on 404 and malformed-request errors without logging the input', async () => {
    for (const error of [
      new AppError(404, 'NOT_FOUND', 'API route not found'),
      new SyntaxError(privateText),
    ]) {
      const flow = requestFlow(async () => {
        throw error;
      }, '/unknown/' + privateText);
      await flow.done;
      expect(flow.res.body).toMatchObject({ error: { requestId: flow.headers.get('X-Request-Id') } });
    }
    expect(logs().every((entry) => entry.route === 'unmatched')).toBe(true);
    expect(JSON.stringify(logs())).not.toContain(privateText);
  });
});

describe('Failure stages preserve the real boundary', () => {
  it.each([
    ['invalid JSON', '{' + privateText, 'model_json'],
    ['invalid schema', JSON.stringify({ amount: 25, extra: privateText }), 'model_schema'],
  ])('classifies %s without retaining the response', async (_name, text, stage) => {
    fetchMock.mockResolvedValue(providerResponse([{ text }]));
    const flow = requestFlow(() => generateProposal(schema, privateText, userMessages));
    await flow.done;
    expect(flow.res.body).toMatchObject({ error: { code: 'AI_INVALID_RESPONSE' } });
    expect(logs().find((entry) => entry.event === 'request_error')).toMatchObject({ stage });
    expect(JSON.stringify(logs())).not.toContain(privateText);
  });

  it('classifies missing clarification questions as semantic validation', async () => {
    fetchMock.mockResolvedValue(
      providerResponse([{ text: JSON.stringify(proposal({ action: 'CLARIFY', lines: [] })) }]),
    );
    const flow = requestFlow(() => proposeEntry(org, userMessages, '2026-10-31'));
    await flow.done;
    expect(flow.res.body).toMatchObject({ error: { code: 'AI_INVALID_RESPONSE' } });
    expect(logs().find((entry) => entry.event === 'request_error')).toMatchObject({
      stage: 'model_semantic',
    });
  });

  it('preserves an unknown-account rejection and distinguishes it from provider/schema failure', async () => {
    fetchMock.mockResolvedValue(providerResponse([{ text: JSON.stringify(proposal()) }]));
    const flow = requestFlow(() => proposeEntry(org, userMessages, '2026-10-31'));
    await flow.done;
    expect(flow.res.body).toMatchObject({ error: { code: 'INVALID_ACCOUNT' } });
    expect(logs().find((entry) => entry.event === 'request_error')).toMatchObject({
      stage: 'account_validation',
    });
  });

  it('does not convert a financial-query database timeout into invalid AI output', async () => {
    fetchMock.mockResolvedValue(
      providerResponse([{ functionCall: { name: 'cash_position', args: { asOf: '2026-10-31' } } }]),
    );
    const databaseFailure = Object.assign(new Error(privateText), { code: '57014' });
    database.query.mockRejectedValue(databaseFailure);
    const flow = requestFlow(() => financialChat(org, userMessages), '/api/ai/chat');
    await flow.done;
    expect(failureStage(databaseFailure)).toBe('database');
    expect(flow.res.body).toMatchObject({ error: { code: 'QUERY_TIMEOUT' } });
    expect(flow.res.statusCode).toBe(503);
    expect(logs().find((entry) => entry.event === 'request_error')).toMatchObject({
      stage: 'database',
      databaseCode: '57014',
    });
    expect(JSON.stringify(logs())).not.toContain(privateText);
  });

  it('distinguishes deterministic report calculation failures from model validation', async () => {
    fetchMock.mockResolvedValue(
      providerResponse([
        { functionCall: { name: 'expense_summary', args: { from: '2026-10-01', to: '2026-10-31' } } },
      ]),
    );
    database.query.mockResolvedValue({
      rows: [{ id: debitId, code: '5030', name: privateText, type: 'EXPENSE', amount: privateText }],
    });
    const flow = requestFlow(() => financialChat(org, userMessages), '/api/ai/chat');
    await flow.done;
    expect(flow.res.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(logs().find((entry) => entry.event === 'request_error')).toMatchObject({
      stage: 'financial_tool',
    });
    expect(JSON.stringify(logs())).not.toContain(privateText);
  });

  it('logs no raw pool error and preserves the original failure when rollback also fails', async () => {
    const { transaction } = await import('../server/db');
    const poolHandler = database.listeners.get('error');
    expect(poolHandler).toBeDefined();
    poolHandler!(Object.assign(new Error(privateText), { code: 'ECONNRESET' }));
    expect(logs().find((entry) => entry.event === 'database_pool')).toMatchObject({
      databaseCode: 'ECONNRESET',
    });
    const original = new AppError(422, 'UNBALANCED_ENTRY', privateText);
    database.query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') throw Object.assign(new Error(privateText), { code: 'ECONNRESET' });
      return { rows: [] };
    });
    await expect(
      transaction(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(database.release).toHaveBeenCalledOnce();
    expect(database.release).toHaveBeenCalledWith(true);
    expect(logs().find((entry) => entry.event === 'database_rollback_failed')).toMatchObject({
      databaseCode: 'ECONNRESET',
    });
    expect(JSON.stringify(logs())).not.toContain(privateText);
  });
});
