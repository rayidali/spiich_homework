import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  choose: vi.fn(),
  query: vi.fn(),
  db: { query: vi.fn() },
}));
vi.mock('../server/ai-provider', async (original) => ({
  ...(await original<typeof import('../server/ai-provider')>()),
  chooseFinancialTool: mocks.choose,
}));
vi.mock('../server/db', () => ({ query: mocks.query, transaction: vi.fn() }));
vi.mock('../server/reports', async (original) => ({
  ...(await original<typeof import('../server/reports')>()),
  reportSnapshot: (read: (db: typeof mocks.db) => unknown) => read(mocks.db),
  today: () => '2026-10-31',
}));

import { financialChat, buildFinancialPlannerInput } from '../server/ai';
import { ALL_HISTORY_START } from '../server/date-scope';
import { compoundRowId } from '../server/financial-grouping';
import type { AnalysisAccount, FinancialQuery } from '../server/financial-analysis';

const dimensions = [
  { kind: 'month' as const, key: '2026-10', label: '2026-10' },
  {
    kind: 'account' as const,
    key: '5030',
    label: '5030 · Office supplies',
    accountId: '00000000-0000-4000-8000-000000000002',
  },
];
const org = '00000000-0000-4000-8000-000000000001';
const bank: AnalysisAccount = {
  id: '00000000-0000-4000-8000-000000000002',
  code: '5030',
  name: 'Office supplies',
  type: 'EXPENSE',
  currency: 'USD',
  parent_id: null,
  is_group: false,
  is_cash: false,
  archived: false,
};
function plan(changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id: 'cash_change',
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-10-01',
    to: '2026-10-31',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: ['month', 'account'],
    accountCodes: [],
    cooccurringAccountCodes: [],
    counterparty: { mode: 'any', value: '' },
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
    order: 'label_asc',
    limit: 50,
    ...changes,
  };
}
let selected: FinancialQuery;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  selected = plan();
  mocks.choose.mockImplementation(async () => ({
    call: { name: 'financial_analysis', args: { queries: [selected] } },
    ai: {
      provider: 'gemini',
      model: 'offline-fixture',
      durationMs: 1,
      usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0, totalTokens: 2 },
    },
  }));
  mocks.query.mockImplementation(async (sql: string) => {
    if (!sql.includes('journal_lines')) return [bank];
    return [
      {
        row_id: 'total',
        label: '2026-10 · 5030 · Office supplies',
        value: '210.00',
        entry_count: '3',
        period_from: '2026-10-01',
        period_to: '2026-10-31',
        dimensions,
        scope_overflow: false,
      },
    ];
  });
  mocks.db.query.mockResolvedValue({ rows: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('Compound grouping through chat with a stubbed planner', () => {
  it('advertises composition and returns an exact multi-dimension result from the real compiler', async () => {
    const planner = buildFinancialPlannerInput('composable', [], '2026-10-31');
    expect(planner.instructions).toContain('["month","account"]');
    expect(JSON.stringify(planner.tools)).toContain('anyOf');
    const result = await financialChat(org, [
      { role: 'user', content: 'Show monthly spending by category for October 2026.' },
    ]);
    expect(result).toHaveProperty('facts.0.grain', ['month', 'account']);
    expect(result).toHaveProperty('facts.0.rows.0.rowId', compoundRowId(dimensions));
    expect(result).toHaveProperty('facts.0.scope.groupingAccounts', [{ id: bank.id, code: '5030' }]);
    expect(result.evidence[0].rows[0].value).toBe('$210.00');
    expect(result.evidence[0].rows[0].label).toContain('2026-10 · 5030 · Office supplies');
    expect(result).not.toHaveProperty('scopeVerification');
    expect(mocks.choose).toHaveBeenCalledTimes(1);
    const read = mocks.query.mock.calls.find(([sql]) => String(sql).includes('journal_lines'))!;
    expect(read[0]).toContain('account_scope a');
    expect(read[2]).toBe(mocks.db);
  });
  it('withholds an incompatible account/counterparty balance before reading amounts', async () => {
    selected = plan({
      metric: 'account_balance',
      groupBy: ['account', 'counterparty'],
      accountCodes: ['5030'],
      from: null,
    });
    const result = await financialChat(org, [
      { role: 'user', content: 'Show balances by account and customer.' },
    ]);
    expect(result).toMatchObject({ evidence: [], limitation: { code: 'INVALID_ANALYSIS_SCOPE' } });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('journal_lines'))).toBe(false);
    expect(mocks.choose).toHaveBeenCalledTimes(1);
  });
  it('withholds every financial result when a later query exceeds the compound grid cap', async () => {
    mocks.choose.mockResolvedValue({
      call: { name: 'financial_analysis', args: { queries: [plan(), plan({ id: 'second' })] } },
      ai: {
        provider: 'gemini',
        model: 'offline-fixture',
        durationMs: 1,
        usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0, totalTokens: 2 },
      },
    });
    let reads = 0;
    const original = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, ...args: unknown[]) => {
      if (sql.includes('journal_lines') && ++reads === 2)
        return [
          {
            row_id: '',
            label: '',
            value: null,
            entry_count: '0',
            period_from: null,
            period_to: null,
            dimensions: null,
            scope_overflow: true,
          },
        ];
      return original(sql, ...args);
    });
    const result = await financialChat(org, [
      { role: 'user', content: 'Show monthly expenses by account and then by person.' },
    ]);
    expect(result).toMatchObject({ evidence: [], limitation: { code: 'INVALID_ANALYSIS_SCOPE' } });
    expect(result).not.toHaveProperty('facts');
    expect(result.answer).toContain('30000');
    expect(result.answer).not.toContain('210');
    expect(reads).toBe(2);
    expect(mocks.choose).toHaveBeenCalledTimes(1);
  });
  it('retains all-history normalization without discarding compound dimensions', async () => {
    selected = plan({ from: '2000-01-01', groupBy: ['account', 'counterparty'] });
    const pair = [dimensions[1], { kind: 'counterparty' as const, key: 'Acme', label: '"Acme"' }];
    mocks.query.mockImplementation(async (sql: string) =>
      !sql.includes('journal_lines')
        ? [bank]
        : [
            {
              row_id: '',
              label: '5030 · Office supplies · "Acme"',
              value: '210.00',
              entry_count: '3',
              period_from: null,
              period_to: null,
              dimensions: pair,
              scope_overflow: false,
            },
          ],
    );
    const result = await financialChat(org, [
      {
        role: 'user',
        content: 'Show spending by account and person across all recorded history through 2026-10-31.',
      },
    ]);
    expect(result).toHaveProperty('scopeNormalization.executedFrom', ALL_HISTORY_START);
    expect(result.query.args).toHaveProperty('queries.0.groupBy', ['account', 'counterparty']);
    expect(result).toHaveProperty('facts.0.rows.0.dimensions', pair);
    expect(result).toHaveProperty('facts.0.rows.0.from', ALL_HISTORY_START);
    expect(mocks.choose).toHaveBeenCalledTimes(1);
  });
});
