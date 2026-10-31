import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chooseFinancialTool: vi.fn(),
  expenseAccountChart: vi.fn(),
  expenseAccountSummary: vi.fn(),
  incomeStatement: vi.fn(),
  reportSnapshot: vi.fn(),
  cashPosition: vi.fn(),
  listEntries: vi.fn(),
  db: { query: vi.fn() },
}));
vi.mock('../server/ai-provider', () => ({
  chooseFinancialTool: mocks.chooseFinancialTool,
  generateProposal: vi.fn(),
}));
vi.mock('../server/reports', () => ({
  expenseAccountChart: mocks.expenseAccountChart,
  expenseAccountSummary: mocks.expenseAccountSummary,
  incomeStatement: mocks.incomeStatement,
  reportSnapshot: mocks.reportSnapshot,
  cashPosition: mocks.cashPosition,
  today: () => '2026-10-31',
}));
vi.mock('../server/ledger', () => ({
  accounts: vi.fn(),
  validateLines: vi.fn(),
  assertBalanced: vi.fn(),
  listEntries: mocks.listEntries,
}));
vi.mock('../server/categorization-memory', () => ({
  getCategorizationContext: vi.fn(),
  recordProposal: vi.fn(),
}));

import { financialChat as productFinancialChat } from '../server/ai';
// These regressions freeze the authored tool contract and expense-only context.
// The composable default has separate route-selection and query-engine tests.
const financialChat = (org: string, messages: Parameters<typeof productFinancialChat>[1]) =>
  productFinancialChat(org, messages, { route: 'authored' });
import { AppError } from '../server/errors';

const org = '00000000-0000-4000-8000-000000000001';
const parent = {
  id: '00000000-0000-4000-8000-000000000002',
  code: '5000',
  name: 'Office expenses',
  currency: 'USD',
  parent_id: null,
  is_group: true,
  archived: false,
};
const supplies = {
  id: '00000000-0000-4000-8000-000000000003',
  code: '5030',
  name: 'Office supplies',
  currency: 'USD',
  parent_id: parent.id,
  is_group: false,
  archived: false,
};
const archived = { ...supplies, id: '00000000-0000-4000-8000-000000000004', code: '5031', archived: true };
const period = { from: '2026-01-01', to: '2026-10-31' };
const ai = { provider: 'gemini', model: 'synthetic-offline-planner', durationMs: 1 };
const firstQuestion = { role: 'user' as const, content: 'How much do we spend on office supplies?' };

function selected(name: string, args: Record<string, unknown>) {
  return { call: { name, args }, ai };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.expenseAccountChart.mockResolvedValue([
    parent,
    // The planner must explicitly select identity fields, even if a future
    // report implementation accidentally includes an extra private field.
    { ...supplies, balance: 'PRIVATE_BALANCE_SENTINEL', journalMemo: 'PRIVATE_JOURNAL_SENTINEL' },
    archived,
  ]);
  mocks.reportSnapshot.mockImplementation((read: (db: typeof mocks.db) => unknown) => read(mocks.db));
  mocks.expenseAccountSummary.mockResolvedValue({
    ...period,
    currency: 'USD',
    account: supplies,
    totalExpenses: '1740.00',
    expenses: [{ id: supplies.id, code: supplies.code, name: supplies.name, amount: '1740.00' }],
  });
  mocks.incomeStatement.mockResolvedValue({
    ...period,
    currency: 'USD',
    expenses: [
      { id: 'rent-id', code: '5010', name: 'Rent', amount: '48000.00' },
      { id: supplies.id, code: supplies.code, name: supplies.name, amount: '1740.00' },
    ],
    totalExpenses: '57652.00',
  });
});
afterEach(() => vi.restoreAllMocks());

// These are application contract tests with a stub planner, not measurements
// of a live model's ability to choose the right account or ask a question.
describe('account-scoped financial chat', () => {
  it('offers an account/date tool and chart identities including groups and archived accounts, without balances', async () => {
    mocks.chooseFinancialTool.mockResolvedValue(
      selected('ask_clarification', { question: 'Which period for office supplies?' }),
    );
    await financialChat(org, [firstQuestion]);
    expect(mocks.expenseAccountChart).toHaveBeenCalledExactlyOnceWith(org);
    const [tools, context] = mocks.chooseFinancialTool.mock.calls[0] as [
      {
        name: string;
        parameters: {
          properties: Record<string, unknown>;
          required: string[];
          additionalProperties: boolean;
        };
      }[],
      string,
    ];
    const scoped = tools.find((tool) => tool.name === 'expense_by_account')!;
    expect(Object.keys(scoped.parameters.properties).sort()).toEqual(['accountCode', 'from', 'to']);
    expect([...scoped.parameters.required].sort()).toEqual(['accountCode', 'from', 'to']);
    expect(scoped.parameters.additionalProperties).toBe(false);
    const chart = JSON.parse(context.slice(context.lastIndexOf('\n') + 1).replace(/^EXPENSE CHART: /, ''));
    expect(chart).toEqual([
      {
        code: parent.code,
        name: parent.name,
        currency: 'USD',
        group: true,
        parentCode: null,
        archived: false,
      },
      {
        code: supplies.code,
        name: supplies.name,
        currency: 'USD',
        group: false,
        parentCode: parent.code,
        archived: false,
      },
      {
        code: archived.code,
        name: archived.name,
        currency: 'USD',
        group: false,
        parentCode: parent.code,
        archived: true,
      },
    ]);
    expect(context).not.toContain('PRIVATE_BALANCE_SENTINEL');
    expect(context).not.toContain('PRIVATE_JOURNAL_SENTINEL');
    expect(context).not.toContain(supplies.id);
    expect(mocks.reportSnapshot).not.toHaveBeenCalled();
  });

  it('answers only the selected account from one report snapshot, with supporting account links', async () => {
    mocks.chooseFinancialTool.mockResolvedValue(
      selected('expense_by_account', { accountCode: supplies.code, ...period }),
    );
    const result = await financialChat(org, [
      { role: 'user', content: 'Office supplies expenses from January 1 through October 31, 2026?' },
    ]);
    expect(mocks.reportSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.expenseAccountSummary).toHaveBeenCalledExactlyOnceWith(
      org,
      supplies.code,
      period.from,
      period.to,
      mocks.db,
    );
    expect(mocks.incomeStatement).not.toHaveBeenCalled();
    expect(result.answer).toContain('$1,740.00');
    expect(result.answer).toContain('USD');
    expect(result.answer).toContain(supplies.name);
    expect(result.answer).not.toMatch(/57,652|Rent|cash paid/i);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].rows).toEqual([
      {
        label: supplies.name,
        value: '$1,740.00',
        href: `/accounts?account=${supplies.id}&from=${period.from}&to=${period.to}`,
      },
    ]);
    expect(result.query).toEqual({
      name: 'expense_by_account',
      args: { accountCode: supplies.code, ...period },
    });
  });

  it('preserves an invalid-account error without substituting all expenses or zero', async () => {
    mocks.chooseFinancialTool.mockResolvedValue(
      selected('expense_by_account', { accountCode: '5999', ...period }),
    );
    mocks.expenseAccountSummary.mockRejectedValue(
      new AppError(422, 'INVALID_EXPENSE_ACCOUNT', 'Choose an expense account in this workspace.'),
    );
    await expect(financialChat(org, [firstQuestion])).rejects.toMatchObject({
      code: 'INVALID_EXPENSE_ACCOUNT',
      status: 422,
    });
    expect(mocks.expenseAccountSummary).toHaveBeenCalledTimes(1);
    expect(mocks.incomeStatement).not.toHaveBeenCalled();
    expect(mocks.chooseFinancialTool).toHaveBeenCalledTimes(1);
  });

  it('keeps the category in the clarification conversation and passes the period follow-up intact', async () => {
    const clarification =
      'Which period should I use for office supplies: this month, this year, or all recorded history?';
    mocks.chooseFinancialTool.mockResolvedValueOnce(
      selected('ask_clarification', { question: clarification }),
    );
    const first = await financialChat(org, [firstQuestion]);
    expect(first.answer).toBe(clarification);
    expect(first.evidence).toEqual([]);
    expect(mocks.expenseAccountSummary).not.toHaveBeenCalled();
    expect(mocks.incomeStatement).not.toHaveBeenCalled();
    const messages = [
      firstQuestion,
      { role: 'assistant' as const, content: first.answer },
      { role: 'user' as const, content: 'This year.' },
    ];
    mocks.chooseFinancialTool.mockResolvedValueOnce(
      selected('expense_by_account', { accountCode: supplies.code, ...period }),
    );
    const followUp = await financialChat(org, messages);
    expect(mocks.chooseFinancialTool.mock.calls[1][2]).toEqual(messages);
    expect(followUp.query).toEqual({
      name: 'expense_by_account',
      args: { accountCode: supplies.code, ...period },
    });
    expect(followUp.answer).toContain(supplies.name);
    expect(mocks.expenseAccountSummary).toHaveBeenCalledTimes(1);
  });

  it('can ask which same-name account without reading either account amount', async () => {
    mocks.expenseAccountChart.mockResolvedValue([supplies, { ...archived, currency: 'EUR' }]);
    const question = 'Do you mean Office supplies 5030 (USD) or 5031 (EUR)?';
    mocks.chooseFinancialTool.mockResolvedValue(selected('ask_clarification', { question }));
    const result = await financialChat(org, [
      { role: 'user', content: 'Office supplies expenses this year?' },
    ]);
    expect(result.answer).toBe(question);
    expect(result.evidence).toEqual([]);
    expect(mocks.reportSnapshot).not.toHaveBeenCalled();
    expect(mocks.expenseAccountSummary).not.toHaveBeenCalled();
  });

  it.each([
    { accountCode: supplies.code, from: '2026-10-31', to: '2026-01-01' },
    { accountCode: supplies.code, from: '2026-02-30', to: '2026-10-31' },
    { accountCode: supplies.code, ...period, organizationId: 'foreign-workspace' },
    { from: period.from, to: period.to },
  ])('rejects malformed scoped arguments before any financial query: %j', async (args) => {
    mocks.chooseFinancialTool.mockResolvedValue(selected('expense_by_account', args));
    await expect(financialChat(org, [firstQuestion])).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(mocks.reportSnapshot).not.toHaveBeenCalled();
    expect(mocks.expenseAccountSummary).not.toHaveBeenCalled();
    expect(mocks.incomeStatement).not.toHaveBeenCalled();
  });

  it('keeps from/to-only broad requests compatible while advertising explicit view and nullable limit arguments', async () => {
    mocks.chooseFinancialTool.mockResolvedValue(selected('expense_summary', period));
    const result = await financialChat(org, [
      { role: 'user', content: 'What are my top expense categories this year?' },
    ]);
    expect(mocks.incomeStatement).toHaveBeenCalledExactlyOnceWith(org, period.from, period.to, mocks.db);
    expect(mocks.expenseAccountSummary).not.toHaveBeenCalled();
    expect(result.answer).toContain('$57,652.00');
    expect(result.evidence[0].rows.map((row) => row.label)).toEqual(['Rent', supplies.name]);
    const tools = mocks.chooseFinancialTool.mock.calls[0][0] as {
      name: string;
      parameters: { properties: Record<string, unknown>; required: string[] };
    }[];
    const broad = tools.find((tool) => tool.name === 'expense_summary')!;
    expect(Object.keys(broad.parameters.properties).sort()).toEqual(['from', 'limit', 'to', 'view']);
    expect([...broad.parameters.required].sort()).toEqual(['from', 'limit', 'to', 'view']);
    expect(broad.parameters.properties.limit).toMatchObject({
      type: ['integer', 'null'],
      minimum: 1,
      maximum: 20,
    });
    expect(result.query.args).toEqual(period);
  });

  it.each([
    { args: {}, expected: 5 },
    { args: { view: 'top', limit: null }, expected: 5 },
    { args: { view: 'top', limit: 3 }, expected: 3 },
    { args: { view: 'top', limit: 20 }, expected: 6 },
  ])(
    'honors top counts using decimal ranking, retaining five for legacy requests: %j',
    async ({ args, expected }) => {
      const expenses = ['2.01', '100.00', '2.10', '-5.00', '9.00', '0.00'].map((amount, index) => ({
        id: `account-${index}`,
        code: `51${index}0`,
        name: `Expense ${index}`,
        amount,
      }));
      mocks.incomeStatement.mockResolvedValue({
        ...period,
        currency: 'USD',
        totalExpenses: '108.11',
        expenses,
      });
      mocks.chooseFinancialTool.mockResolvedValue(selected('expense_summary', { ...period, ...args }));
      const result = await financialChat(org, [
        { role: 'user', content: 'Show my largest expense categories this year.' },
      ]);
      expect(result.evidence[0].rows.map((row) => row.label)).toEqual(
        ['Expense 1', 'Expense 4', 'Expense 2', 'Expense 0', 'Expense 5', 'Expense 3'].slice(0, expected),
      );
      expect(result.answer).toContain('$108.11');
      expect(result.answer).toContain('USD');
      expect(mocks.expenseAccountChart).toHaveBeenCalledExactlyOnceWith(org);
      expect(mocks.reportSnapshot).toHaveBeenCalledTimes(1);
    },
  );

  it('returns one total row without pretending a zero net balance means no activity', async () => {
    mocks.incomeStatement.mockResolvedValue({
      ...period,
      currency: 'USD',
      totalExpenses: '0.00',
      expenses: [{ id: supplies.id, code: supplies.code, name: supplies.name, amount: '0.00' }],
    });
    mocks.chooseFinancialTool.mockResolvedValue(
      selected('expense_summary', { ...period, view: 'total', limit: null }),
    );
    const result = await financialChat(org, [
      { role: 'user', content: 'What was our total recorded expense this year?' },
    ]);
    expect(result.answer).toContain('$0.00 USD');
    expect(result.answer).not.toMatch(/no posted|largest|cash paid/i);
    expect(result.evidence[0]).toMatchObject({
      title: 'Total expenses',
      rows: [{ label: 'Net recorded expenses (USD)', value: '$0.00' }],
    });
    expect(mocks.expenseAccountChart).toHaveBeenCalledExactlyOnceWith(org);
    expect(mocks.expenseAccountSummary).not.toHaveBeenCalled();
  });

  it('returns every posting account at the chart boundary, including archived and unused accounts, from the amount snapshot', async () => {
    const postingAccounts = Array.from({ length: 249 }, (_, index) => ({
      ...supplies,
      id: `snapshot-account-${index}`,
      code: String(6000 + index),
      name: `Expense account ${index}`,
      archived: index === 248,
      currency: index === 248 ? 'EUR' : 'USD',
    }));
    const snapshotChart = [parent, ...postingAccounts];
    // The pre-planner chart is not the amount snapshot: newly visible identities
    // must come from the chart reread within the same transaction as the report.
    mocks.expenseAccountChart.mockResolvedValueOnce([parent, supplies]).mockResolvedValueOnce(snapshotChart);
    mocks.incomeStatement.mockResolvedValue({
      ...period,
      currency: 'USD',
      totalExpenses: '95.00',
      expenses: [
        { ...postingAccounts[0], amount: '100.00' },
        { ...postingAccounts[248], amount: '-5.00' },
      ],
    });
    mocks.chooseFinancialTool.mockResolvedValue(
      selected('expense_summary', { ...period, view: 'all', limit: null }),
    );
    const result = await financialChat(org, [
      { role: 'user', content: 'Show all expense accounts this year, including those with zero.' },
    ]);
    expect(mocks.expenseAccountChart.mock.calls).toEqual([[org], [org, mocks.db]]);
    expect(mocks.incomeStatement).toHaveBeenCalledExactlyOnceWith(org, period.from, period.to, mocks.db);
    expect(mocks.reportSnapshot).toHaveBeenCalledTimes(1);
    expect(result.evidence[0].title).toBe('All expense accounts');
    expect(result.evidence[0].rows.map((row) => row.label)).toEqual(
      postingAccounts.map((account) => account.name),
    );
    expect(result.evidence[0].rows[0].value).toBe('$100.00');
    expect(result.evidence[0].rows[1].value).toBe('$0.00');
    expect(result.evidence[0].rows[248].value).toBe('-$5.00');
    expect(result.answer).toContain('$95.00 USD');
    expect(result.answer).not.toContain('largest');
  });

  it('fails closed if the snapshot chart exceeds the account limit instead of returning a truncated all view', async () => {
    mocks.expenseAccountChart
      .mockResolvedValueOnce([supplies])
      .mockRejectedValueOnce(
        new AppError(422, 'CHART_TOO_LARGE', 'Expense chart exceeds the supported bound.'),
      );
    mocks.chooseFinancialTool.mockResolvedValue(
      selected('expense_summary', { ...period, view: 'all', limit: null }),
    );
    await expect(financialChat(org, [firstQuestion])).rejects.toMatchObject({ code: 'CHART_TOO_LARGE' });
    expect(mocks.reportSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.incomeStatement).toHaveBeenCalledTimes(1);
    expect(mocks.chooseFinancialTool).toHaveBeenCalledTimes(1);
  });

  it.each([
    { view: 'top', limit: 0 },
    { view: 'top', limit: 21 },
    { view: 'top', limit: 1.5 },
    { view: 'top', limit: '3' },
    { view: 'all', limit: 3 },
    { view: 'total', limit: 3 },
    { view: 'average', limit: null },
    { view: null, limit: null },
  ])('rejects unsupported summary modes and misleading limits before querying: %j', async (args) => {
    mocks.chooseFinancialTool.mockResolvedValue(selected('expense_summary', { ...period, ...args }));
    await expect(financialChat(org, [firstQuestion])).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(mocks.reportSnapshot).not.toHaveBeenCalled();
    expect(mocks.incomeStatement).not.toHaveBeenCalled();
  });
});
