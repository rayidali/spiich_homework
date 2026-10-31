import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ choose: vi.fn(), chart: vi.fn(), summary: vi.fn() }));
vi.mock('../server/ai-provider', async (original) => ({
  ...(await original<typeof import('../server/ai-provider')>()),
  chooseFinancialTool: mocks.choose,
}));
vi.mock('../server/financial-analysis', async (original) => ({
  ...(await original<typeof import('../server/financial-analysis')>()),
  financialAnalysisChart: mocks.chart,
}));
vi.mock('../server/reports', async (original) => ({
  ...(await original<typeof import('../server/reports')>()),
  expenseAccountChart: mocks.chart,
  expenseAccountSummary: mocks.summary,
  reportSnapshot: async (fn: (db: unknown) => unknown) => fn({}),
}));
import { explicitAllHistory, normalizeAllHistoryFlow, ALL_HISTORY_START } from '../server/date-scope';
import { financialChat, buildFinancialPlannerInput } from '../server/ai';
import type { ModelMessages } from '../server/ai-provider';
const question =
  'How much did we spend on Office supplies across all recorded history through October31,2026?';
const user = (content: string): ModelMessages => [{ role: 'user', content }];
const range = { accountCode: '5030', from: '2000-01-01', to: '2026-10-31' };
beforeEach(() => vi.clearAllMocks());
describe('Conservative explicit all-history recognition (offline)', () => {
  it.each([
    [question, 'all recorded history'],
    ['What have we spent over all time?', 'all time'],
    ['Total revenue for the entire history through 2026-10-31.', 'the entire history'],
    ['All-time.', 'All-time'],
    ['alltime', 'alltime'],
    ['All history!', 'All history'],
    ['Since the beginning.', 'Since the beginning'],
    ["What's our spending across all recorded history through today?", 'all recorded history'],
    [
      '📚 René’s supplies: spending across all recorded history through October31,2026?',
      'all recorded history',
    ],
    [
      'How much for “Office supplies” across all recorded history through 2026-10-31?',
      'all recorded history',
    ],
  ])('recognizes a fixed temporal phrase with its exact original span: %s', (text, span) => {
    const proof = explicitAllHistory(user(text))!;
    expect(proof).toBeDefined();
    expect(text.slice(proof.sourceStart, proof.sourceEnd)).toBe(span);
    expect(proof.userMessageIndex).toBe(0);
  });
  it.each([
    'Do not use all-time totals. Office supplies from2026-01-01 through2026-10-31.',
    'Do not use all time. Show expenses for 2026.',
    "Don't show expenses over all time; use last month.",
    'Show expenses for "All Time" supplies.',
    "Show expenses for 'All Time' supplies.",
    'Show expenses for “all recorded history” merchant.',
    'Show expenses for `all time`.',
    'Show expenses at All Time Supplies.',
    'Show expenses for "an unfinished all time quote.',
    'Expenses across all history since2020.',
    'Expenses across all history. Since2020 only.',
    'Expenses across all history since 2020.',
    'Expenses across all history from 2020-01-01.',
    'Expenses from "2020-01-01" for all time.',
    'Show Office supplies from "2020-01-01" through October 31, 2026 over all time.',
    'Show Office supplies from `2020-01-01` across all recorded history through October 31, 2026.',
    "Expenses after 'January2020' across all recorded history.",
    'Show Office supplies over all time of 2026.',
    'Show Office supplies over all time through 2026, limited to2020.',
    'Show Office supplies from [2020-01-01] over all time.',
    'Show spending from Acme over all time.',
    'In "2020", show Office supplies spending across all recorded history.',
    'During `2020`, show Office supplies spending across all recorded history.',
    'Expenses across all history after January2020.',
    'Expenses across all history starting in 2020.',
    'Expenses across all history in2026.',
    'Expenses across all history in 2026.',
    'Expenses across all history for2026.',
    'Expenses across all history, January2026.',
    'All-time revenue versus last month.',
    'Compare expenses over all time and previous quarter.',
    'Expenses across all history, but only this year.',
    'Expenses across all history, 2020–2026.',
    'Office supplies from2000-01-01 through2026-10-31.',
    'All expense accounts for October2026.',
    'Expenses for all time and rent for all time.',
  ])('does not widen a quoted, negated, conflicting or unproved scope: %s', (text) => {
    expect(explicitAllHistory(user(text))).toBeUndefined();
    expect(normalizeAllHistoryFlow('expense_by_account', range, user(text))).toEqual({ args: range });
  });
  it('reads only the latest actual user message, including an explicit one-word follow-up', () => {
    const messages: ModelMessages = [
      { role: 'user', content: question },
      { role: 'assistant', content: 'Which period?' },
      { role: 'user', content: 'alltime' },
    ];
    expect(explicitAllHistory(messages)).toEqual({ userMessageIndex: 2, sourceStart: 0, sourceEnd: 7 });
    messages[2] = { role: 'user', content: 'Last month.' };
    expect(explicitAllHistory(messages)).toBeUndefined();
    messages[2] = { role: 'user', content: 'What about Rent?' };
    expect(explicitAllHistory(messages)).toBeUndefined();
    expect(
      explicitAllHistory([
        { role: 'user', content: 'What period?' },
        { role: 'assistant', content: 'alltime' },
      ]),
    ).toBeUndefined();
    expect(
      explicitAllHistory([
        { role: 'assistant', content: question },
        { role: 'user', content: 'Office supplies?' },
      ]),
    ).toBeUndefined();
  });
  it('changes only one validated flow start, preserves the original plan, and records idempotent provenance', () => {
    const before = structuredClone(range),
      result = normalizeAllHistoryFlow('expense_by_account', range, user(question));
    expect(range).toEqual(before);
    expect(result.args).toEqual({ ...range, from: ALL_HISTORY_START });
    expect(result.normalization).toMatchObject({
      rule: 'explicit_all_history_v1',
      target: 'from',
      originalFrom: '2000-01-01',
      executedFrom: ALL_HISTORY_START,
      to: '2026-10-31',
      changed: true,
    });
    const again = normalizeAllHistoryFlow('expense_by_account', result.args, user(question));
    expect(again.args).toEqual(result.args);
    expect(again.normalization).toMatchObject({ originalFrom: ALL_HISTORY_START, changed: false });
    for (const name of ['expense_summary', 'income_summary', 'find_transactions'])
      expect(normalizeAllHistoryFlow(name, range, user(question)).args.from).toBe(ALL_HISTORY_START);
  });
  it('preserves every composable filter but never rewrites balances, multiple queries or a calculation DAG', () => {
    const flow = {
      id: 'supplies',
      metric: 'net_expense',
      from: '2000-01-01',
      to: '2026-10-31',
      accountCodes: ['5030'],
      status: 'DRAFT',
      counterparty: { mode: 'exact', value: 'Merchant' },
      descriptionSearch: 'paper',
      minimumAmount: '12.50',
      groupBy: 'total',
      limit: 7,
    };
    const input = { queries: [flow] };
    const result = normalizeAllHistoryFlow('financial_analysis', input, user(question));
    expect(result.args).toEqual({ queries: [{ ...flow, from: ALL_HISTORY_START }] });
    expect(input.queries[0].from).toBe('2000-01-01');
    expect(result.normalization?.target).toBe('queries[0].from');
    for (const metric of ['cash_balance', 'account_balance']) {
      for (const from of [null, '2026-01-01']) {
        const balance = { queries: [{ ...flow, metric, from }] };
        expect(normalizeAllHistoryFlow('financial_analysis', balance, user(question))).toEqual({
          args: balance,
        });
      }
    }
    const multi = { queries: [flow, { ...flow, id: 'other' }] };
    expect(normalizeAllHistoryFlow('financial_analysis', multi, user(question))).toEqual({ args: multi });
    expect(normalizeAllHistoryFlow('financial_scenario', input, user(question))).toEqual({ args: input });
    for (const name of ['period_comparison', 'revenue_comparison', 'cash_position', 'request_details'])
      expect(normalizeAllHistoryFlow(name, range, user(question))).toEqual({ args: range });
  });
});

describe('Chat executes the normalized scope without another provider call', () => {
  beforeEach(() => {
    mocks.chart.mockResolvedValue([]);
    mocks.choose.mockResolvedValue({
      call: { name: 'expense_by_account', args: { ...range } },
      ai: {
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        durationMs: 1,
        usage: { inputTokens: 10, outputTokens: 10, thinkingTokens: 0, totalTokens: 20 },
      },
    });
    mocks.summary.mockResolvedValue({
      account: { id: 'supplies', name: 'Office supplies', is_group: false },
      totalExpenses: '1740.00',
      expenses: [{ id: 'supplies', name: 'Office supplies', amount: '1740.00' }],
    });
  });
  it('uses the inception boundary in executed arguments while showing natural all-history wording', async () => {
    const result = await financialChat('org', user(question));
    expect(mocks.choose).toHaveBeenCalledTimes(1);
    expect(mocks.summary).toHaveBeenCalledExactlyOnceWith(
      'org',
      '5030',
      ALL_HISTORY_START,
      '2026-10-31',
      expect.anything(),
    );
    expect(result.query.args).toEqual({ ...range, from: ALL_HISTORY_START });
    expect(result).toHaveProperty('scopeNormalization.rule', 'explicit_all_history_v1');
    expect(result.answer).toContain('across all recorded history through 2026-10-31');
    expect(result.answer).not.toContain('0001');
    expect(result.evidence[0].period).toBe('All recorded history through 2026-10-31');
    expect(result.evidence[0].href).toContain('from=0001-01-01');
  });
  it('keeps bounded and negated requests intact and never rewrites an account name', async () => {
    mocks.summary.mockResolvedValue({
      account: { id: 'supplies', name: 'from0001-01-01', is_group: false },
      totalExpenses: '10.00',
      expenses: [],
    });
    for (const text of [
      'Office supplies from2000-01-01 throughOctober31,2026.',
      'Do not use all-time. Show Office supplies from2000-01-01 throughOctober31,2026.',
    ]) {
      const result = await financialChat('org', user(text));
      expect(result.query.args).toEqual(range);
      expect(result).not.toHaveProperty('scopeNormalization');
      expect(result.answer).toContain('from0001-01-01');
    }
  });
  it('advertises the same canonical all-history floor for authored tools', () => {
    const input = buildFinancialPlannerInput('authored', [], '2026-10-31');
    expect(input.instructions).toContain('0001-01-01');
    expect(input.instructions).not.toContain('1900-01-01');
  });
});
