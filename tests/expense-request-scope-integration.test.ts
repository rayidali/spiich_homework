import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  choose: vi.fn(),
  query: vi.fn(),
  snapshot: vi.fn(),
  snapshotDb: { query: vi.fn() },
}));
vi.mock('../server/ai-provider', async (original) => ({
  ...(await original<typeof import('../server/ai-provider')>()),
  chooseFinancialTool: mocks.choose,
}));
vi.mock('../server/db', () => ({ query: mocks.query, transaction: vi.fn() }));
vi.mock('../server/reports', async (original) => ({
  ...(await original<typeof import('../server/reports')>()),
  reportSnapshot: mocks.snapshot,
  today: () => '2026-10-31',
}));

import { financialChat, parseInsightArgs } from '../server/ai';
import type { AnalysisAccount, FinancialQuery } from '../server/financial-analysis';
import type { ModelMessages } from '../server/ai-provider';
import type { ExpenseScopeProof } from '../server/expense-request-scope';

const org = '00000000-0000-4000-8000-000000000001';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function account(
  n: number,
  code: string,
  name: string,
  changes: Partial<AnalysisAccount> = {},
): AnalysisAccount {
  return {
    id: id(n),
    code,
    name,
    type: 'EXPENSE',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    archived: false,
    is_cash: false,
    ...changes,
  };
}
const expenses = account(2, '5000', 'Expenses', { is_group: true });
const office = account(3, '5100', 'Office costs', { is_group: true, parent_id: expenses.id });
const supplies = account(4, '5030', 'Office supplies', { parent_id: office.id });
const printing = account(5, '5031', 'Printing', { parent_id: office.id, archived: true });
const rent = account(6, '5010', 'Rent', { parent_id: expenses.id });
const sales = account(7, '4000', 'Sales', { type: 'REVENUE' });
const chart = [expenses, office, supplies, printing, rent, sales];
const from = '2026-01-01',
  to = '2026-03-31';
const question = `How much did we spend on Office supplies from ${from} to ${to}?`;
const user = (content = question): ModelMessages => [{ role: 'user', content }];
const metadata = {
  provider: 'gemini',
  model: 'offline-plan-fixture',
  durationMs: 1,
  attempts: 1,
  usage: { inputTokens: 9, outputTokens: 1, thinkingTokens: 0, totalTokens: 10 },
};
let snapshotChart: AnalysisAccount[];
const amountReads: { sql: string; params: unknown[]; db: unknown }[] = [];

function plan(changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id: 'supplies',
    metric: 'net_expense',
    aggregation: 'sum',
    from,
    to,
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: 'total',
    accountCodes: ['5030'],
    cooccurringAccountCodes: [],
    counterparty: { mode: 'any', value: '' },
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
    order: 'value_desc',
    limit: 1,
    ...changes,
  };
}
function select(name: string, args: Record<string, unknown>) {
  // These adversarial plans pass the actual argument schema. The tested gate
  // must reject semantic scope, rather than benefiting from malformed JSON.
  expect(() => parseInsightArgs(name, args)).not.toThrow();
  mocks.choose.mockResolvedValue({ call: { name, args }, ai: metadata });
}
function narrow(accountCode = '5030', period = { from, to }) {
  select('expense_by_account', { accountCode, ...period });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  snapshotChart = structuredClone(chart);
  amountReads.length = 0;
  mocks.snapshotDb.query.mockResolvedValue({ rows: [] });
  mocks.snapshot.mockImplementation((read: (db: typeof mocks.snapshotDb) => unknown) =>
    read(mocks.snapshotDb),
  );
  mocks.query.mockImplementation(async (sql: string, params: unknown[] = [], db?: unknown) => {
    if (/\bFROM accounts\b/i.test(sql) && !/\bjournal_lines\b/.test(sql)) {
      const current = db === mocks.snapshotDb ? snapshotChart : chart;
      return structuredClone(
        sql.includes("type='EXPENSE'") ? current.filter((a) => a.type === 'EXPENSE') : current,
      );
    }
    if (/\bjournal_lines\b/.test(sql)) {
      amountReads.push({ sql, params, db });
      if (sql.includes('SELECT a.id,a.code,a.name,a.type')) {
        // Deliberately equal dollars for two different accounts. The fixture
        // must not reward a wrong identity merely because the total matches.
        return [supplies, rent].map((a) => ({ ...a, amount: '42.00' }));
      }
      return [
        {
          row_id: 'total',
          label: 'Total',
          value: '42.00',
          entry_count: '1',
          period_from: null,
          period_to: null,
        },
      ];
    }
    throw new Error('Unexpected test database operation');
  });
});
afterEach(() => vi.restoreAllMocks());

function expectWithheld(result: Awaited<ReturnType<typeof financialChat>>) {
  expect(result).toMatchObject({ evidence: [], limitation: { code: 'REQUEST_SCOPE_MISMATCH' } });
  expect(result).not.toHaveProperty('scopeVerification');
  expect(result.answer).not.toContain('42');
  expect(amountReads).toEqual([]);
  expect(mocks.choose).toHaveBeenCalledTimes(1);
}

describe('Original-user expense scope at the real chat/execution boundary (offline)', () => {
  it.each(['authored', 'composable'] as const)(
    'executes a correct narrow plan on the %s route, with original-user proof and one snapshot',
    async (route) => {
      narrow();
      const messages: ModelMessages = [
        { role: 'assistant', content: 'Ask about an expense account and include its date range.' },
        ...user(),
      ];
      const original = structuredClone(messages);
      const result = await financialChat(org, messages, { route });
      expect(result.answer).toContain('$42.00');
      expect(result).toMatchObject({
        scopeVerification: {
          rule: 'explicit_expense_scope_v1',
          userMessageIndex: 1,
          requestedAccount: { id: supplies.id, code: supplies.code, name: supplies.name },
          resolvedPostingAccountIds: [supplies.id],
          period: { requested: { from, to }, executed: { from, to } },
        },
      });
      const proof = (result as unknown as { scopeVerification: ExpenseScopeProof }).scopeVerification;
      expect(messages[1].content.slice(proof.accountSpan.start, proof.accountSpan.end)).toBe(
        'Office supplies',
      );
      const requested = proof.period.requested!;
      expect(messages[1].content.slice(requested.fromSpan.start, requested.fromSpan.end)).toBe(from);
      expect(messages[1].content.slice(requested.toSpan.start, requested.toSpan.end)).toBe(to);
      expect(proof.checkedFields).toEqual(expect.arrayContaining(['accountScope', 'from', 'to']));
      expect(messages).toEqual(original);
      expect(mocks.snapshot).toHaveBeenCalledTimes(1);
      expect(amountReads).toHaveLength(1);
      expect(amountReads[0].db).toBe(mocks.snapshotDb);
      expect(amountReads[0].params.slice(0, 3)).toEqual([org, from, to]);
    },
  );

  it('executes a correct composable plan with its proof and compiled account scope in the same snapshot', async () => {
    select('financial_analysis', { queries: [plan()] });
    const result = await financialChat(org, user(), { route: 'composable' });
    expect(result).toMatchObject({
      scopeVerification: { resolvedPostingAccountIds: [supplies.id] },
      facts: [{ scope: { resolvedAccountIds: [supplies.id], organizationId: org } }],
    });
    expect(result.answer).toContain('$42.00');
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(amountReads).toHaveLength(1);
    expect(amountReads[0].db).toBe(mocks.snapshotDb);
  });

  it('accepts all effective descendants instead of requiring the exact parent account code', async () => {
    select('financial_analysis', { queries: [plan({ accountCodes: ['5030', '5031'] })] });
    const result = await financialChat(
      org,
      user(`How much did we spend on Office costs from ${from} to ${to}?`),
    );
    expect(result).toMatchObject({
      scopeVerification: {
        requestedAccount: { id: office.id, code: office.code },
        resolvedPostingAccountIds: [supplies.id, printing.id],
      },
      facts: [{ scope: { resolvedAccountIds: [supplies.id, printing.id] } }],
    });
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(amountReads).toHaveLength(1);
  });

  it.each([
    ['wrong account with the same money', 'expense_by_account', { accountCode: '5010', from, to }],
    ['global expense total', 'expense_summary', { from, to, view: 'total', limit: null }],
    ['different metric', 'income_summary', { from, to, metric: 'profit' }],
    ['narrowed start', 'expense_by_account', { accountCode: '5030', from: '2026-02-01', to }],
    ['different end', 'expense_by_account', { accountCode: '5030', from, to: '2026-03-30' }],
  ] as const)('withholds a schema-valid %s before reading any amounts', async (_label, name, args) => {
    select(name, args);
    expectWithheld(await financialChat(org, user(), { route: 'composable' }));
  });

  it.each([
    ['all accounts', { accountCodes: [] }],
    ['a different account', { accountCodes: ['5010'] }],
    ['full journal totals', { metric: 'journal_total' }],
    ['a revenue calculation', { metric: 'net_revenue', accountCodes: ['4000'] }],
    ['unrequested drafts', { status: 'DRAFT' }],
    ['native instead of recorded base values', { currencyMode: 'native', currency: 'USD' }],
    ['a vendor filter', { counterparty: { mode: 'exact', value: 'Paper Shop' } }],
    ['a description filter', { descriptionSearch: 'paper' }],
    ['a payment co-occurrence filter', { cooccurringAccountCodes: ['5010'] }],
    ['a minimum amount', { minimumAmount: '10' }],
    ['a maximum amount', { maximumAmount: '100' }],
    ['a per-entry average', { aggregation: 'average_per_entry' }],
  ] satisfies [string, Partial<FinancialQuery>][])(
    'withholds a valid composable plan adding %s',
    async (_label, changes) => {
      select('financial_analysis', { queries: [plan(changes)] });
      expectWithheld(await financialChat(org, user(), { route: 'composable' }));
    },
  );

  it('resolves the requested name again if account identity changes after planning', async () => {
    narrow();
    const replacement = account(8, '5032', 'Office supplies', { parent_id: office.id });
    snapshotChart = [expenses, office, { ...supplies, name: 'Former supplies' }, replacement, rent];
    expectWithheld(await financialChat(org, user(), { route: 'composable' }));
    const chartReads = mocks.query.mock.calls.filter(([sql]) => /\bFROM accounts\b/.test(sql));
    expect(chartReads.some(([, , db]) => db === undefined)).toBe(true);
    expect(chartReads.some(([, , db]) => db === mocks.snapshotDb)).toBe(true);
  });

  it('withholds when a known requested account name disappears from the execution snapshot', async () => {
    narrow();
    snapshotChart = chart.map((a) => (a.id === supplies.id ? { ...a, name: 'Former office supplies' } : a));
    const result = await financialChat(org, user(), { route: 'composable' });
    expectWithheld(result);
    expect(result).toMatchObject({ limitation: { reason: 'account_scope' } });
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  });

  it('leaves an unknown name in both charts unassessed so a valid vendor query still executes', async () => {
    select('financial_analysis', {
      queries: [plan({ accountCodes: [], counterparty: { mode: 'exact', value: 'Acme' } })],
    });
    const result = await financialChat(org, user(`How much did we spend on Acme from ${from} to ${to}?`), {
      route: 'composable',
    });
    expect(result).not.toHaveProperty('scopeVerification');
    expect(result).not.toHaveProperty('limitation');
    expect(result.answer).toContain('$42.00');
    expect(result).toMatchObject({
      facts: [{ scope: { plan: { counterparty: { mode: 'exact', value: 'Acme' } } } }],
    });
    expect(amountReads).toHaveLength(1);
    expect(amountReads[0].params[6]).toBe('Acme');
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(mocks.choose).toHaveBeenCalledTimes(1);
  });

  it('withholds a global total when the user explicitly requests an unknown account code', async () => {
    select('expense_summary', { from, to, view: 'total', limit: null });
    const result = await financialChat(
      org,
      user(`How much did we spend on account 5999 from ${from} to ${to}?`),
      { route: 'composable' },
    );
    expectWithheld(result);
    expect(result).toMatchObject({ limitation: { reason: 'unknown_account' } });
  });

  it('does not use the planning chart when a duplicate expense name appears inside the snapshot', async () => {
    narrow();
    snapshotChart.push(account(8, '5032', 'Office supplies', { currency: 'EUR' }));
    expectWithheld(await financialChat(org, user(), { route: 'composable' }));
  });

  it('withholds shorthand that can also name a distinct account ending in expenses', async () => {
    narrow();
    snapshotChart.push(account(8, '5032', 'Office supplies expenses'));
    const result = await financialChat(org, user(`Office supplies expenses from ${from} to ${to}`), {
      route: 'composable',
    });
    expectWithheld(result);
    expect(result).toMatchObject({ limitation: { reason: 'ambiguous_account' } });
  });

  it('includes a newly added archived descendant in the requested group proof and compiled selection', async () => {
    const newChild = account(8, '5032', 'Stationery', { parent_id: office.id, archived: true });
    snapshotChart.push(newChild);
    select('financial_analysis', { queries: [plan({ accountCodes: ['5100'] })] });
    const result = await financialChat(
      org,
      user(`How much did we spend on Office costs from ${from} to ${to}?`),
      { route: 'composable' },
    );
    expect(result).toMatchObject({
      scopeVerification: { resolvedPostingAccountIds: [supplies.id, printing.id, newChild.id] },
      facts: [{ scope: { resolvedAccountIds: [supplies.id, printing.id, newChild.id] } }],
    });
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(amountReads).toHaveLength(1);
    expect(amountReads[0].db).toBe(mocks.snapshotDb);
  });

  it('rejects an omitted descendant even when the remaining selected account has the same amount', async () => {
    select('financial_analysis', { queries: [plan({ accountCodes: ['5030'] })] });
    expectWithheld(
      await financialChat(org, user(`How much did we spend on Office costs from ${from} to ${to}?`)),
    );
  });

  it.each([
    `How much did we spend on Office supplies from Paper Shop from ${from} to ${to}?`,
    `Do not include Rent. How much did we spend on Office supplies from ${from} to ${to}?`,
    `Compare Office supplies and Rent from ${from} to ${to}.`,
  ])('does not claim verification for unrecognized wording: %s', async (content) => {
    narrow();
    const result = await financialChat(org, user(content));
    expect(result).not.toHaveProperty('scopeVerification');
    expect(result).not.toHaveProperty('limitation');
    expect(amountReads).toHaveLength(1);
  });

  it.each([
    ['preserves the earlier vendor filter', { mode: 'exact', value: 'Acme' }],
    ['drops the earlier vendor filter', { mode: 'any', value: '' }],
  ] as const)('does not claim scope verification when a later plan %s', async (_label, counterparty) => {
    select('financial_analysis', { queries: [plan({ counterparty })] });
    const messages: ModelMessages = [
      { role: 'user', content: 'Only Acme transactions.' },
      { role: 'assistant', content: 'Which expense account and period should I use?' },
      ...user(),
    ];
    const original = structuredClone(messages);
    const result = await financialChat(org, messages, { route: 'composable' });
    expect(result).not.toHaveProperty('scopeVerification');
    expect(result).not.toHaveProperty('limitation');
    expect(amountReads).toHaveLength(1);
    expect(amountReads[0].params[6]).toBe(counterparty.value);
    expect(messages).toEqual(original);
    expect(mocks.choose).toHaveBeenCalledTimes(1);
    expect(mocks.choose.mock.calls[0][2]).toEqual(original);
  });

  it('preserves a supported clarification without amount reads or an invented verification claim', async () => {
    select('request_details', {
      reason: 'missing_period',
      subject: 'expenses',
      accountCodes: ['5030'],
      limitation: 'none',
    });
    const result = await financialChat(org, user('How much do we spend on Office supplies?'));
    expect(result.answer).toContain('Office supplies');
    expect(result.answer).toContain('Which period');
    expect(result).not.toHaveProperty('scopeVerification');
    expect(result.evidence).toEqual([]);
    expect(amountReads).toEqual([]);
  });

  it('does not claim date verification when the recognized user question gives no dates', async () => {
    narrow();
    const result = await financialChat(org, user('How much do we spend on Office supplies?'));
    const proof = (result as unknown as { scopeVerification: ExpenseScopeProof }).scopeVerification;
    expect(proof.requestedAccount.id).toBe(supplies.id);
    expect(proof.period).toEqual({ requested: null, executed: { from, to } });
    expect(proof.checkedFields).not.toContain('from');
    expect(proof.checkedFields).not.toContain('to');
  });
});
