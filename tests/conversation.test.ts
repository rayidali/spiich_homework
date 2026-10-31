import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  conversationBudgetError,
  conversationSchema,
  messagesSchema,
  type ConversationMessage,
} from '../shared/conversation';

const mocks = vi.hoisted(() => ({ choose: vi.fn(), chart: vi.fn() }));
vi.mock('../server/ai-provider', async (original) => ({
  ...(await original<typeof import('../server/ai-provider')>()),
  chooseFinancialTool: mocks.choose,
}));
vi.mock('../server/financial-analysis', async (original) => ({
  ...(await original<typeof import('../server/financial-analysis')>()),
  financialAnalysisChart: mocks.chart,
}));
import { financialChat } from '../server/ai';
import { evaluateFinancialScenario, type FinancialScenario } from '../server/financial-calculation';

function conversation(first: string): ConversationMessage[] {
  const messages: ConversationMessage[] = [{ role: 'user', content: first }];
  for (let turn = 0; turn < 7; turn++)
    messages.push(
      { role: 'assistant', content: 'Should I retain the original scope?' },
      { role: 'user', content: 'Yes, keep the original scope.' },
    );
  return messages;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chart.mockResolvedValue([]);
  mocks.choose.mockResolvedValue({
    call: {
      name: 'request_details',
      args: { reason: 'missing_period', subject: 'analysis', accountCodes: [], limitation: 'none' },
    },
    ai: { provider: 'gemini', model: 'gemini-3.5-flash-lite', durationMs: 1 },
  });
});

describe('Full conversation retention with a bounded input allowance', () => {
  it('keeps the first question and every original role/content beyond both previous turn limits', async () => {
    const first = 'Office supplies at Acme Corp from 2026-01-01 to 2026-10-31, posted USD only.';
    const messages = conversation(first);
    const original = structuredClone(messages);
    for (const message of messages) Object.freeze(message);
    Object.freeze(messages);
    expect(messages).toHaveLength(15);
    expect(conversationBudgetError(messages)).toBeUndefined();
    expect(messagesSchema.parse(messages)).toEqual(original);
    await financialChat('00000000-0000-4000-8000-000000000001', messages, { route: 'composable' });
    expect(mocks.choose).toHaveBeenCalledTimes(1);
    expect(mocks.choose.mock.calls[0][2]).toEqual(original);
    expect(mocks.choose.mock.calls[0][2][0]).toEqual({ role: 'user', content: first });
    expect(messages).toEqual(original);
  });

  it('allows many short follow-ups without increasing the former aggregate character allowance', () => {
    expect(
      messagesSchema.parse(Array.from({ length: 100 }, () => ({ role: 'user', content: 'x' }))),
    ).toHaveLength(100);
    const maximum = Array.from({ length: 12 }, () => ({ role: 'user' as const, content: 'x'.repeat(4000) }));
    expect(messagesSchema.parse(maximum)).toEqual(maximum);
    const over = [...maximum, { role: 'user' as const, content: 'x' }];
    expect(conversationBudgetError(over)).toContain('conversation is full');
    expect(messagesSchema.safeParse(over).success).toBe(false);
    expect(over[0].content).toHaveLength(4000);
    expect(over).toHaveLength(13);
  });

  it('counts transmitted whitespace and preserves original content instead of silently trimming the budget', () => {
    const padded = Array.from({ length: 20 }, () => ({
      role: 'user' as const,
      content: ' '.repeat(3999) + 'x',
    }));
    expect(conversationBudgetError(padded)).toContain('conversation is full');
    expect(messagesSchema.safeParse(padded).success).toBe(false);
    const original = [{ role: 'user' as const, content: '  Keep this exact question.\n' }];
    expect(conversationBudgetError(original)).toBeUndefined();
    expect(messagesSchema.parse(original)).toEqual(original);
    expect(messagesSchema.safeParse([{ role: 'user', content: ' \n\t ' }]).success).toBe(false);
  });

  it.each(['漢', '\u0000'])(
    'also bounds actual JSON/UTF-8 bytes for %j without dropping messages',
    (character) => {
      const messages = Array.from({ length: 12 }, () => ({
        role: 'user' as const,
        content: character.repeat(4000),
      }));
      const original = structuredClone(messages);
      expect(conversationBudgetError(messages)).toContain('conversation is full');
      expect(conversationSchema.safeParse(messages).success).toBe(false);
      expect(messages).toEqual(original);
    },
  );

  it.each([
    { messages: Array.from({ length: 101 }, () => ({ role: 'user' as const, content: 'x' })) },
    { messages: Array.from({ length: 13 }, () => ({ role: 'user' as const, content: 'x'.repeat(4000) })) },
    { messages: [{ role: 'user' as const, content: 'x'.repeat(4001) }] },
  ])('rejects an excessive request before chart loading or provider invocation', async ({ messages }) => {
    expect(Array.isArray(messages)).toBe(true);
    expect(conversationBudgetError(messages)).toBeDefined();
    await expect(
      financialChat('00000000-0000-4000-8000-000000000001', messages, { route: 'composable' }),
    ).rejects.toThrow();
    expect(mocks.chart).not.toHaveBeenCalled();
    expect(mocks.choose).not.toHaveBeenCalled();
  });

  it('retains original-user numeric evidence and exact spans after seven follow-ups', () => {
    const first = 'Calculate the cost of $6,000 per month for 3 months.';
    const messages = conversation(first);
    const plan: FinancialScenario = {
      queries: [],
      assumptions: [
        { id: 'salary', value: '6000', unit: 'USD_per_month', sourceText: '$6,000 per month' },
        { id: 'duration', value: '3', unit: 'months', sourceText: '3 months' },
      ],
      calculations: [
        {
          id: 'total',
          operation: 'multiply',
          operands: [
            { source: 'assumption', id: 'salary', rowId: null, field: 'value' },
            { source: 'assumption', id: 'duration', rowId: null, field: 'value' },
          ],
        },
      ],
    };
    const result = evaluateFinancialScenario(plan, [], messages);
    const fact = result.facts.find((value) => 'kind' in value && value.kind === 'scenario_calculation');
    expect(fact).toMatchObject({ value: '18000.00', unit: 'USD', source: 'scenario' });
    if (!fact || !('assumptions' in fact)) throw new Error('Missing calculation evidence');
    for (const assumption of fact.assumptions) {
      expect(assumption.userMessageIndex).toBe(0);
      expect(first.slice(assumption.sourceStart, assumption.sourceEnd)).toBe(assumption.sourceText);
    }
    expect(() => evaluateFinancialScenario(plan, [], messages.slice(-10))).toThrow();
  });
});
