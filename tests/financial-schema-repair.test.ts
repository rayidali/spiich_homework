import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ chart: vi.fn(), cash: vi.fn(), analysis: vi.fn() }));
vi.mock('../server/financial-analysis', async (original) => ({
  ...(await original<typeof import('../server/financial-analysis')>()),
  financialAnalysisChart: db.chart,
  executeFinancialAnalysis: db.analysis,
}));
vi.mock('../server/reports', async (original) => ({
  ...(await original<typeof import('../server/reports')>()),
  expenseAccountChart: db.chart,
  cashPosition: db.cash,
  reportSnapshot: async (fn: (client: unknown) => unknown) => fn({}),
}));
import { config } from '../server/config';
import { financialChat, getFinancialChatFailureMetadata } from '../server/ai';
import { getAiUsage, resetAiUsage, setAiBudget } from '../server/ai-provider';
import { AppError } from '../server/errors';
import { diagnostic, safeSchemaIssues, withRequestContext } from '../server/diagnostics';
import { apiErrorHandler } from '../server/app';
import type { Request, Response as ExpressResponse } from 'express';
const org = '00000000-0000-4000-8000-000000000001';
const messages = [{ role: 'user' as const, content: 'What is my current cash balance?' }];
const saved = { aiProvider: config.aiProvider, aiKey: config.aiKey, aiModel: config.aiModel };
const fetchMock = vi.fn();
const secret = 'PRIVATE_CONTENT_NEVER_LOG';
const usage = {
  promptTokenCount: 100,
  candidatesTokenCount: 20,
  thoughtsTokenCount: 10,
  totalTokenCount: 130,
};
function response(args: unknown = { asOf: '2026-10-31' }, name = 'cash_position', reported: unknown = usage) {
  return new Response(
    JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name, args } }] } }],
      modelVersion: 'gemini-3.5-flash-lite',
      ...(reported === null ? {} : { usageMetadata: reported }),
    }),
    { status: 200 },
  );
}
function logs() {
  return [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].map(([line]) =>
    JSON.parse(String(line)),
  );
}
async function failure(operation: () => Promise<unknown>) {
  try {
    await operation();
    throw new Error('Expected failure');
  } catch (error) {
    return error;
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', fetchMock);
  config.aiProvider = 'gemini';
  config.aiModel = 'gemini-3.5-flash-lite';
  config.aiKey = secret;
  setAiBudget(null);
  resetAiUsage();
  db.chart.mockResolvedValue([]);
  db.cash.mockResolvedValue({ total: '12500.00', accounts: [] });
  db.analysis.mockResolvedValue({ answer: '', evidence: [], facts: [] });
});
afterEach(() => {
  Object.assign(config, saved);
  setAiBudget(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('One schema repair with real provider parsing and mocked HTTP/ledger', () => {
  it('executes a valid first plan once and reports its one actual attempt', async () => {
    fetchMock.mockResolvedValueOnce(response());
    const result = await financialChat(org, messages);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.cash).toHaveBeenCalledTimes(1);
    expect(result.ai).toMatchObject({
      attempts: 1,
      repairStatus: 'not_needed',
      unreportedAttempts: 0,
      usage: { inputTokens: 100, outputTokens: 20, thinkingTokens: 10, totalTokens: 130 },
    });
    expect(logs().filter((x) => x.event === 'ai_provider_usage')).toHaveLength(1);
  });
  it('repairs only schema-invalid arguments, uses the same tools and original messages, and sums usage once', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ asOf: secret }))
      .mockResolvedValueOnce(
        response(undefined, undefined, { ...usage, promptTokenCount: 140, totalTokenCount: 170 }),
      );
    const result = await financialChat(org, messages);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.cash).toHaveBeenCalledTimes(1);
    expect(result.ai).toMatchObject({
      attempts: 2,
      repairStatus: 'succeeded',
      unreportedAttempts: 0,
      usage: { inputTokens: 240, outputTokens: 40, thinkingTokens: 20, totalTokens: 300 },
      reportedUsage: { totalTokens: 300 },
    });
    expect(result.ai.durationMs).toBe(result.ai.attemptMetadata.reduce((sum, x) => sum + x.durationMs, 0));
    expect(getAiUsage()).toMatchObject({ attempts: 2, totalTokens: 300, unreportedUsage: 0 });
    const bodies = fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options.body)));
    expect(bodies[1].tools).toEqual(bodies[0].tools);
    expect(bodies[1].contents.slice(0, -1)).toEqual(bodies[0].contents);
    expect(bodies[1].contents.at(-1).role).toBe('user');
    expect(bodies[1].systemInstruction.parts[0].text).not.toContain(secret);
    expect(bodies[1].contents.at(-1).parts[0].text).toContain(secret);
    expect(JSON.stringify(logs())).not.toContain(secret);
    expect(logs().filter((x) => x.event === 'ai_schema_validation')[0].issues).toEqual([
      { code: 'invalid_format', path: ['asOf'] },
    ]);
  });
  it('stops after two invalid plans, preserves both known costs, and never executes a query', async () => {
    fetchMock.mockImplementation(async () => response({ asOf: secret }));
    const error = await failure(() => financialChat(org, messages));
    expect(error).toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.cash).not.toHaveBeenCalled();
    expect(getFinancialChatFailureMetadata(error)).toMatchObject({
      attempts: 2,
      repairStatus: 'failed',
      usage: { totalTokens: 260 },
      unreportedAttempts: 0,
    });
    expect(getAiUsage().attempts).toBe(2);
    expect(JSON.stringify(logs())).not.toContain(secret);
  });
  it.each([null, { ...usage, totalTokenCount: 999 }, { promptTokenCount: 100, totalTokenCount: 100 }])(
    'does not fund repair from unknown or inconsistent first usage: %j',
    async (reported) => {
      fetchMock.mockResolvedValueOnce(response({ asOf: secret }, undefined, reported));
      const error = await failure(() => financialChat(org, messages));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(db.cash).not.toHaveBeenCalled();
      expect(getFinancialChatFailureMetadata(error)).toMatchObject({
        attempts: 1,
        repairStatus: 'not_eligible',
        unreportedAttempts: 1,
        usage: { totalTokens: null },
      });
    },
  );
  it.each([401, 429, 503])('does not retry a first HTTP%s provider error', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: secret }), { status }));
    const error = await failure(() => financialChat(org, messages));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.cash).not.toHaveBeenCalled();
    expect(getFinancialChatFailureMetadata(error)).toMatchObject({
      attempts: 1,
      unreportedAttempts: 1,
      repairStatus: 'not_needed',
    });
    expect(JSON.stringify(logs())).not.toContain(secret);
  });
  it.each(['http', 'timeout', 'missing_usage'] as const)(
    'retains known first cost and unknown second usage: %s',
    async (problem) => {
      fetchMock.mockResolvedValueOnce(response({ asOf: secret }));
      if (problem === 'http') fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
      if (problem === 'timeout') fetchMock.mockRejectedValueOnce(new DOMException('private', 'TimeoutError'));
      if (problem === 'missing_usage')
        fetchMock.mockResolvedValueOnce(response({ asOf: secret }, undefined, null));
      const error = await failure(() => financialChat(org, messages));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(db.cash).not.toHaveBeenCalled();
      const ai = getFinancialChatFailureMetadata(error)!;
      expect(ai).toMatchObject({
        attempts: 2,
        repairStatus: 'failed',
        unreportedAttempts: 1,
        usage: { totalTokens: null },
        reportedUsage: { totalTokens: 130 },
      });
      expect(ai.attemptMetadata[0].usage.totalTokens).toBe(130);
      expect(ai.attemptMetadata[1].usage.totalTokens).toBeNull();
    },
  );
  it('retains an unknown second usage even if its valid plan can be executed safely', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ asOf: secret }))
      .mockResolvedValueOnce(response(undefined, undefined, null));
    const result = await financialChat(org, messages);
    expect(result.ai).toMatchObject({
      attempts: 2,
      repairStatus: 'succeeded',
      unreportedAttempts: 1,
      usage: { totalTokens: null },
      reportedUsage: { totalTokens: 130 },
    });
    expect(db.cash).toHaveBeenCalledTimes(1);
  });
  it('does not confuse an evaluation-budget refusal with a second dispatched request', async () => {
    setAiBudget({ maxAttempts: 1, maxTotalTokens: 10000 });
    fetchMock.mockResolvedValueOnce(response({ asOf: secret }));
    const error = await failure(() => financialChat(org, messages));
    expect(error).toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getFinancialChatFailureMetadata(error)).toMatchObject({
      attempts: 1,
      unreportedAttempts: 0,
      reportedUsage: { totalTokens: 130 },
    });
    expect(logs().filter((x) => x.event === 'ai_provider_usage')).toHaveLength(1);
  });
  it('does not retry provider-envelope, JSON or unsupported-tool errors', async () => {
    for (const raw of [
      new Response('{', { status: 200 }),
      response({}, 'execute_sql'),
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    ]) {
      fetchMock.mockClear();
      fetchMock.mockResolvedValueOnce(raw);
      await expect(financialChat(org, messages)).rejects.toBeInstanceOf(AppError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
  it('keeps unknown-account and database failures outside schema repair', async () => {
    fetchMock.mockResolvedValueOnce(response());
    db.cash.mockRejectedValueOnce(new AppError(422, 'INVALID_ACCOUNT', secret));
    await expect(financialChat(org, messages)).rejects.toMatchObject({ code: 'INVALID_ACCOUNT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(response());
    db.cash.mockRejectedValueOnce(Object.assign(new Error(secret), { code: '57014' }));
    await expect(financialChat(org, messages)).rejects.toMatchObject({ code: '57014' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs().filter((x) => x.event === 'ai_provider_usage')).toHaveLength(2);
  });
  it('never promotes invented model data in repair feedback into user assumptions', async () => {
    const invented = {
      queries: [],
      assumptions: [{ id: 'invented', value: '9999', unit: 'USD', sourceText: '$9,999 recruiting' }],
      calculations: [
        {
          id: 'sum',
          operation: 'add',
          operands: [
            { source: 'assumption', id: 'invented', rowId: null, field: 'value' },
            { source: 'assumption', id: 'invented', rowId: null, field: 'value' },
          ],
        },
      ],
    };
    fetchMock
      .mockResolvedValueOnce(response({ ...invented, extra: secret }, 'financial_scenario'))
      .mockResolvedValueOnce(response(invented, 'financial_scenario'));
    const result = await financialChat(org, [{ role: 'user', content: 'What would a hire cost?' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.analysis).not.toHaveBeenCalled();
    expect(result).toMatchObject({ limitation: { code: 'INVALID_SCENARIO' }, evidence: [] });
    expect(result.answer).not.toContain('19,998');
  });
  it('does not relax semantic cash-source validation after a schema repair', async () => {
    const plan = {
      queries: [
        {
          id: 'cash',
          metric: 'account_balance',
          aggregation: 'sum',
          from: null,
          to: '2026-10-31',
          status: 'POSTED',
          currencyMode: 'base',
          currency: null,
          groupBy: 'total',
          accountCodes: ['1000'],
          cooccurringAccountCodes: [],
          counterparty: { mode: 'any', value: '' },
          descriptionSearch: '',
          minimumAmount: null,
          maximumAmount: null,
          order: 'label_asc',
          limit: 50,
        },
      ],
      assumptions: [],
      calculations: [
        {
          id: 'double_cash',
          operation: 'add',
          operands: [
            { source: 'query', id: 'cash', rowId: 'total:total', field: 'value' },
            { source: 'query', id: 'cash', rowId: 'total:total', field: 'value' },
          ],
        },
      ],
    };
    fetchMock
      .mockResolvedValueOnce(response({ ...plan, extra: secret }, 'financial_scenario'))
      .mockResolvedValueOnce(response(plan, 'financial_scenario'));
    const result = await financialChat(org, messages);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.analysis).not.toHaveBeenCalled();
    expect(result).toMatchObject({ limitation: { code: 'INVALID_SCENARIO' } });
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(response(plan, 'financial_scenario'));
    const direct = await financialChat(org, messages);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(direct).toMatchObject({ limitation: { code: 'INVALID_SCENARIO' } });
  });
  it('serializes safe known/unknown attempt accounting on an HTTP error without leaking candidate content', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ asOf: secret }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: secret }), { status: 503 }));
    const error = await failure(() => financialChat(org, messages));
    const res = {
      locals: { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    };
    apiErrorHandler(
      error,
      { route: { path: '/api/ai/chat' } } as unknown as Request,
      res as unknown as ExpressResponse,
      vi.fn(),
    );
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({
      error: { code: 'AI_SERVICE_UNAVAILABLE' },
      ai: {
        attempts: 2,
        usageComplete: false,
        unreportedAttempts: 1,
        usage: { totalTokens: null },
        reportedUsage: { totalTokens: 130 },
      },
    });
    expect(
      body.ai.attemptMetadata.map((a: { attemptIndex: number; usageComplete: boolean }) => [
        a.attemptIndex,
        a.usageComplete,
      ]),
    ).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(body.ai.attemptMetadata[0].usage.totalTokens).toBe(130);
    expect(JSON.stringify(body)).not.toContain(secret);
  });
  it('retains the original maximum-length conversation and appends diagnostics without changing quote evidence', async () => {
    const conversation = Array.from({ length: 12 }, (_, i) => ({
      role: i === 11 ? ('user' as const) : ('assistant' as const),
      content: i === 11 ? 'Current cash?' : `Previous message ${i}`,
    }));
    fetchMock.mockResolvedValueOnce(response({ asOf: secret })).mockResolvedValueOnce(response());
    await financialChat(org, conversation);
    const [first, second] = fetchMock.mock.calls.map(([, opts]) => JSON.parse(opts.body));
    expect(first.contents).toHaveLength(12);
    expect(second.contents).toHaveLength(13);
    expect(second.contents.slice(0, 12)).toEqual(first.contents);
  });
  it('bounds feedback and never logs raw issue paths, candidate keys or values', async () => {
    fetchMock.mockResolvedValueOnce(response({ asOf: secret, private: secret.repeat(1000) }));
    const error = await failure(() => financialChat(org, messages));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getFinancialChatFailureMetadata(error)?.repairStatus).toBe('too_large');
    const issues = safeSchemaIssues(
      Array.from({ length: 50 }, () => ({ code: secret, path: ['queries', 0, secret, Symbol(secret)] })),
    );
    expect(issues).toHaveLength(12);
    expect(issues[0]).toEqual({ code: 'invalid_type', path: ['queries', 0, '?', '?'] });
    diagnostic('ai_schema_validation', { issues });
    expect(JSON.stringify(logs())).not.toContain(secret);
  });
  it('uses the remaining40-second planning deadline and skips repairs with under one second left', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock
      .mockImplementationOnce(async () => {
        now = 24500;
        return response({ asOf: secret });
      })
      .mockResolvedValueOnce(response());
    await financialChat(org, messages);
    expect(timeout.mock.calls.map((x) => x[0])).toEqual([25000, 15500]);
    fetchMock.mockClear();
    timeout.mockClear();
    now = 0;
    fetchMock.mockImplementationOnce(async () => {
      now = 39500;
      return response({ asOf: secret });
    });
    const error = await failure(() => financialChat(org, messages));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getFinancialChatFailureMetadata(error)?.repairStatus).toBe('deadline');
  });
  it('keeps concurrent request accounting and schema diagnostics in their own request context', async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      const original = body.contents[0].parts[0].text;
      return response(
        original === 'repair' && body.contents.length === 1 ? { asOf: secret } : { asOf: '2026-10-31' },
      );
    });
    const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const invoke = (requestId: string, text: string) =>
      withRequestContext({ requestId, method: 'POST', route: () => '/api/ai/chat' }, () =>
        financialChat(org, [{ role: 'user', content: text }]),
      );
    const results = await Promise.all([invoke(a, 'repair'), invoke(b, 'valid')]);
    expect(results.map((r) => r.ai.attempts)).toEqual([2, 1]);
    expect(logs().filter((x) => x.event === 'ai_provider_usage' && x.requestId === a)).toHaveLength(2);
    expect(logs().filter((x) => x.event === 'ai_provider_usage' && x.requestId === b)).toHaveLength(1);
    expect(
      logs()
        .filter((x) => x.event === 'ai_schema_validation')
        .map((x) => x.requestId),
    ).toEqual([a]);
  });
  it('rechecks the deadline after preparing feedback instead of starting a one-millisecond second call', async () => {
    // First request/metadata finish at0; feedback sees2s remaining; scheduling
    // pauses until only500ms remain immediately before the second dispatch.
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(38000)
      .mockReturnValue(39500);
    fetchMock.mockResolvedValueOnce(response({ asOf: secret }));
    const error = await failure(() => financialChat(org, messages));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAiUsage().attempts).toBe(1);
    expect(getFinancialChatFailureMetadata(error)).toMatchObject({
      attempts: 1,
      repairStatus: 'deadline',
      usageComplete: true,
      usage: { totalTokens: 130 },
    });
  });
});
