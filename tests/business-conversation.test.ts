import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  businessConversationAnswer,
  businessConversationSchema,
  businessConversationTool,
  validateBusinessConversationContext,
} from '../server/business-conversation';

const db = vi.hoisted(() => ({ chart: vi.fn(), read: vi.fn(), snapshot: vi.fn(), income: vi.fn() }));
vi.mock('../server/financial-analysis', async (original) => ({
  ...(await original<typeof import('../server/financial-analysis')>()),
  financialAnalysisChart: db.chart,
  executeFinancialAnalysis: db.read,
}));
vi.mock('../server/reports', async (original) => ({
  ...(await original<typeof import('../server/reports')>()),
  reportSnapshot: db.snapshot,
  incomeStatement: db.income,
}));
import { buildFinancialPlannerInput, financialChat } from '../server/ai';
import { config } from '../server/config';
import { resetAiUsage, setAiBudget, type ModelMessages } from '../server/ai-provider';
import { diagnostic } from '../server/diagnostics';

const org = '00000000-0000-4000-8000-000000000001';
const saved = { aiProvider: config.aiProvider, aiKey: config.aiKey, aiModel: config.aiModel };
const fetchMock = vi.fn();
const reply = {
  kind: 'clarification',
  message: 'I can help compare the financial effects.',
  question: 'Do you mean the financial impact or whether you are allowed to do that?',
};
function response(name: string, args: unknown) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ functionCall: { name, args } }] }, finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 30,
        thoughtsTokenCount: 0,
        totalTokenCount: 130,
      },
    }),
    { status: 200 },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', fetchMock);
  config.aiProvider = 'gemini';
  config.aiModel = 'gemini-3.5-flash-lite';
  config.aiKey = 'PRIVATE_CONVERSATION_TEST_KEY';
  db.chart.mockResolvedValue([]);
  db.read.mockRejectedValue(new Error('Unexpected financial read'));
  db.snapshot.mockRejectedValue(new Error('Unexpected database snapshot'));
  setAiBudget(null);
  resetAiUsage();
});
afterEach(() => {
  Object.assign(config, saved);
  setAiBudget(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Conversational response contracts, not model-accuracy measurements', () => {
  it('exposes field-level instructions distinguishing a new follow-up from the original question', () => {
    const properties = businessConversationTool.parameters.properties as Record<
      string,
      { description: string }
    >;
    expect(properties.question.description).toContain('NEW focused question');
    expect(properties.question.description).toContain('never the original user question');
    expect(properties.message.description).toContain('Put any follow-up in question');
    // This checks the actual provider schema contract, not whether the model obeys it.
  });
  it('renders one focused question without invented evidence or a book-grounding claim', () => {
    expect(businessConversationAnswer(reply)).toEqual({
      answer: `${reply.message}\n\n${reply.question}`,
      evidence: [],
      conversation: { kind: 'clarification', grounding: 'user_context', verifiedFinancialData: false },
    });
    expect(businessConversationAnswer({ ...reply, message: '' }).answer).toBe(reply.question);
  });
  it('labels explanations as general knowledge and permits a complete answer without another question', () => {
    expect(
      businessConversationAnswer({
        kind: 'explanation',
        message: 'Profit and cash are different.',
        question: null,
      }),
    ).toMatchObject({
      evidence: [],
      conversation: { grounding: 'general_knowledge', verifiedFinancialData: false },
    });
  });
  it.each([
    { ...reply, question: null },
    { ...reply, question: '   ' },
    { ...reply, question: 'x'.repeat(501) },
    { ...reply, message: 'x'.repeat(1601) },
    { ...reply, kind: 'explanation', message: '   ' },
    { ...reply, kind: 'limitation', message: '' },
    { ...reply, kind: 'verified_book_answer' },
    { ...reply, evidence: [{ value: '$999999', source: 'posted' }] },
    { ...reply, verifiedFinancialData: true },
    { ...reply, query: 'DELETE FROM journal_entries' },
    { ...reply, sources: ['https://invented.invalid'] },
  ])('rejects malformed, oversized or forged response metadata %#', (value) => {
    expect(businessConversationSchema.safeParse(value).success).toBe(false);
  });
  it('does not pretend text validation establishes truth', () => {
    const untrusted = '<img src=x onerror=alert(1)> Your business is thriving.';
    const result = businessConversationAnswer({ kind: 'explanation', message: untrusted, question: null });
    expect(result.answer).toBe(untrusted);
    expect(result.conversation.verifiedFinancialData).toBe(false);
    expect(result.evidence).toEqual([]);
    // The browser renders text inertly; semantic correctness requires separate
    // live acceptance. There is deliberately no fake "hallucination detector".
  });
  it.each(['Can we take on another person?', '  CAN WE take on\n another person?  '])(
    'rejects an echoed latest question without substituting content: %s',
    (question) => {
      const args = { ...reply, question };
      const messages = [{ role: 'user', content: 'Can we take on another person?' }];
      let failure: unknown;
      try {
        validateBusinessConversationContext(args, messages);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        issues: [
          {
            code: 'custom',
            path: ['question'],
            params: { conversationIssue: 'repeated_user_question' },
          },
        ],
      });
      expect(JSON.stringify(failure)).not.toContain('Can we take on another person?');
      expect(args.question).toBe(question);
      expect(messages).toEqual([{ role: 'user', content: 'Can we take on another person?' }]);
    },
  );
  it('checks the latest user turn, retaining distinct questions and not claiming broader semantic validation', () => {
    const messages = [
      { role: 'user', content: 'What salary should we use?' },
      { role: 'assistant', content: 'What cost should the scenario assume?' },
      { role: 'user', content: 'What does the scenario need?' },
      { role: 'assistant', content: 'What salary should we use?' },
    ];
    const distinct = { ...reply, question: 'What salary should we use?' };
    expect(validateBusinessConversationContext(distinct, messages)).toEqual(distinct);
    const noFollowup = { kind: 'explanation', message: 'An unverified model explanation.', question: null };
    expect(validateBusinessConversationContext(noFollowup, messages)).toEqual(noFollowup);
    expect(validateBusinessConversationContext(reply, [])).toEqual(reply);
    // Similar or inaccurate prose is deliberately not classified by this mechanical guard.
    const similar = { ...reply, question: 'What does this scenario need from your records?' };
    expect(validateBusinessConversationContext(similar, messages)).toEqual(similar);
  });
  it('offers conversation on product and adaptive paths without modifying experimental grammars', () => {
    for (const route of ['composable', 'adaptive'] as const) {
      const input = buildFinancialPlannerInput(route, [], '2026-11-01');
      expect(input.tools.some((tool) => tool.name === 'discuss_business')).toBe(true);
      expect(input.instructions).toContain('Simple cost/savings arithmetic does NOT require');
    }
    for (const route of ['authored', 'complete'] as const) {
      const input = buildFinancialPlannerInput(route, [], '2026-11-01');
      expect(input.tools.some((tool) => tool.name === 'discuss_business')).toBe(false);
      expect(input.instructions).not.toContain('Use discuss_business');
    }
  });
});

describe('Actual provider parsing with scripted responses and trapped financial reads', () => {
  it.each(['composable', 'adaptive'] as const)(
    'repairs an echoed user question on %s within the existing single repair allowance',
    async (route) => {
      const user = 'Can we take on another person?';
      const corrected = { ...reply, question: 'What monthly cost should the scenario use for the role?' };
      fetchMock
        .mockResolvedValueOnce(response('discuss_business', { ...reply, question: user }))
        .mockResolvedValueOnce(response('discuss_business', corrected));
      const value = await financialChat(org, [{ role: 'user', content: user }], { route });
      expect(value.answer).toBe(`${corrected.message}\n\n${corrected.question}`);
      expect(value.ai).toMatchObject({ attempts: 2, repairStatus: 'succeeded' });
      expect(value.evidence).toEqual([]);
      expect(db.read).not.toHaveBeenCalled();
      expect(db.snapshot).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const second = JSON.parse(fetchMock.mock.calls[1][1].body);
      const feedback = JSON.parse(second.contents.at(-1).parts[0].text);
      expect(feedback).toMatchObject({ conversationIssue: 'repeated_user_question' });
      expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(user);
    },
  );
  it.each(['composable', 'adaptive'] as const)(
    'withholds a second echo on %s after two attempts instead of accepting repair diagnostics as context',
    async (route) => {
      const user = 'Why did this change?';
      fetchMock.mockImplementation(async () => response('discuss_business', { ...reply, question: user }));
      await expect(financialChat(org, [{ role: 'user', content: user }], { route })).rejects.toMatchObject({
        code: 'AI_INVALID_RESPONSE',
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(db.read).not.toHaveBeenCalled();
      expect(db.snapshot).not.toHaveBeenCalled();
    },
  );
  it('answers a mixed concept and recorded profit question in one call, keeping explanation out of financial arguments', async () => {
    const explanation = 'Profit is recorded revenue minus expenses; it can differ from cash.';
    const snapshot = { query: vi.fn() };
    db.snapshot.mockImplementation((read) => read(snapshot));
    db.income.mockResolvedValue({ totalRevenue: '10000', totalExpenses: '1000', netIncome: '9000' });
    fetchMock.mockResolvedValueOnce(
      response('income_summary', {
        metric: 'profit',
        from: '2026-10-01',
        to: '2026-10-31',
        generalExplanation: explanation,
      }),
    );
    const value = await financialChat(
      org,
      [{ role: 'user', content: 'What is profit and what was ours last month?' }],
      {
        route: 'composable',
        asOfDate: '2026-11-01',
      },
    );
    expect(value.answer).toContain('$9,000.00');
    expect(value.answer).not.toContain(explanation);
    expect(value).toMatchObject({
      generalExplanation: {
        text: explanation,
        grounding: 'general_knowledge',
        verifiedFinancialData: false,
      },
    });
    expect(value.query.args).toEqual({ metric: 'profit', from: '2026-10-01', to: '2026-10-31' });
    expect(value.evidence[0]).toMatchObject({
      title: 'Net profit',
      rows: [{ label: 'Net profit', value: '$9,000.00' }],
    });
    expect(db.income).toHaveBeenCalledExactlyOnceWith(org, '2026-10-01', '2026-10-31', snapshot);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('does not allow a general explanation envelope to bypass financial validation or replace an error with success', async () => {
    fetchMock.mockResolvedValueOnce(
      response('financial_scenario', {
        queries: [],
        assumptions: [],
        calculations: [
          {
            id: 'invented',
            operation: 'add',
            operands: [
              { source: 'assumption', id: 'absent', rowId: null, field: 'value' },
              { source: 'assumption', id: 'absent', rowId: null, field: 'value' },
            ],
          },
        ],
        generalExplanation: 'This would be profitable.',
      }),
    );
    const value = await financialChat(
      org,
      [{ role: 'user', content: 'Explain cost reduction and calculate our saving.' }],
      { route: 'composable' },
    );
    expect(value).toMatchObject({ evidence: [], limitation: { code: 'INVALID_SCENARIO' } });
    expect(value).not.toHaveProperty('generalExplanation');
    expect(value.answer).not.toContain('This would be profitable.');
    expect(db.read).not.toHaveBeenCalled();
  });
  it('uses a validated internal clock for reproducible evaluations without changing ordinary request input', async () => {
    fetchMock.mockResolvedValueOnce(response('discuss_business', reply));
    await financialChat(org, [{ role: 'user', content: 'What does profit mean?' }], {
      route: 'composable',
      asOfDate: '2026-11-01',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).systemInstruction.parts[0].text).toContain(
      'Today is 2026-11-01',
    );
    vi.clearAllMocks();
    await expect(
      financialChat(org, [{ role: 'user', content: 'Help' }], { asOfDate: '2026-02-30' }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.chart).not.toHaveBeenCalled();
  });
  it.each(['composable', 'adaptive'] as const)(
    'handles a natural clarification on %s without reading amounts',
    async (route) => {
      fetchMock.mockResolvedValueOnce(response('discuss_business', reply));
      const messages: ModelMessages = [{ role: 'user', content: 'can I fire an emplyee?' }];
      const value = await financialChat(org, messages, { route });
      expect(value.answer).toContain(reply.question);
      expect(value).toMatchObject({ query: { name: 'discuss_business' }, evidence: [], ai: { attempts: 1 } });
      expect(db.read).not.toHaveBeenCalled();
      expect(db.snapshot).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );
  it('retains the real conversation and calculates supplied savings with the exact existing calculator', async () => {
    fetchMock.mockResolvedValueOnce(response('discuss_business', reply));
    const messages: ModelMessages = [{ role: 'user', content: 'can I fire an emplyee?' }];
    const first = await financialChat(org, messages, { route: 'composable' });
    messages.push(
      { role: 'assistant', content: first.answer },
      {
        role: 'user',
        content: 'Calculate a reduction of $4,000 per month for 3 months, minus a $2,000 one-time cost.',
      },
    );
    const ref = (source: string, id: string) => ({ source, id, rowId: null, field: 'value' });
    fetchMock.mockResolvedValueOnce(
      response('financial_scenario', {
        queries: [],
        assumptions: [
          { id: 'monthly', value: '4000', unit: 'USD_per_month', sourceText: '$4,000 per month' },
          { id: 'duration', value: '3', unit: 'months', sourceText: '3 months' },
          { id: 'one_time', value: '2000', unit: 'USD', sourceText: '$2,000 one-time cost' },
        ],
        calculations: [
          {
            id: 'gross',
            operation: 'multiply',
            operands: [ref('assumption', 'monthly'), ref('assumption', 'duration')],
          },
          {
            id: 'net',
            operation: 'subtract',
            operands: [ref('calculation', 'gross'), ref('assumption', 'one_time')],
          },
        ],
      }),
    );
    const second = await financialChat(org, messages, { route: 'composable' });
    expect(second.answer).toContain('$10,000.00');
    expect(second.evidence.length).toBeGreaterThan(0);
    expect(second.evidence.every((item) => item.source === 'scenario')).toBe(true);
    expect(second).not.toHaveProperty('conversation');
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(payload.contents).toEqual(
      messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    );
    expect(db.read).not.toHaveBeenCalled();
    expect(db.snapshot).not.toHaveBeenCalled();
  });
  it('uses the same single repair allowance for malformed conversational responses', async () => {
    fetchMock
      .mockResolvedValueOnce(response('discuss_business', { ...reply, evidence: ['forged'] }))
      .mockResolvedValueOnce(response('discuss_business', reply));
    const value = await financialChat(org, [{ role: 'user', content: 'Should I expand?' }], {
      route: 'composable',
    });
    expect(value.ai).toMatchObject({ attempts: 2, repairStatus: 'succeeded' });
    expect(value.evidence).toEqual([]);
    expect(db.read).not.toHaveBeenCalled();
  });
  it('logs finite reply/reason labels but never the conversational text', () => {
    diagnostic('ai_financial_query', { tool: 'discuss_business', replyKind: 'clarification' });
    diagnostic('ai_financial_query', { tool: 'request_details', clarificationReason: 'off_topic' });
    diagnostic('ai_financial_query', { tool: 'discuss_business', replyKind: reply.message });
    diagnostic('ai_financial_query', { tool: 'request_details', clarificationReason: reply.question });
    const logs = vi.mocked(console.log).mock.calls.map(([line]) => JSON.parse(line));
    expect(logs[0]).toMatchObject({ tool: 'discuss_business', replyKind: 'clarification' });
    expect(logs[1]).toMatchObject({ tool: 'request_details', clarificationReason: 'off_topic' });
    expect(logs[2]).not.toHaveProperty('replyKind');
    expect(logs[3]).not.toHaveProperty('clarificationReason');
    expect(JSON.stringify(logs)).not.toContain(reply.message);
    expect(JSON.stringify(logs)).not.toContain(reply.question);
  });
});
