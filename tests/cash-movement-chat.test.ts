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
import { ALL_HISTORY_START, normalizeAllHistoryFlow } from '../server/date-scope';
import type { AnalysisAccount, FinancialQuery } from '../server/financial-analysis';

const org = '00000000-0000-4000-8000-000000000001';
const bank: AnalysisAccount = {
  id: '00000000-0000-4000-8000-000000000002',
  code: '1010',
  name: 'Business bank',
  type: 'ASSET',
  currency: 'USD',
  parent_id: null,
  is_group: false,
  is_cash: true,
  archived: false,
};
function plan(changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id: 'cash_change',
    metric: 'net_cash_movement',
    aggregation: 'sum',
    from: '2026-10-01',
    to: '2026-10-31',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: 'total',
    accountCodes: [],
    cooccurringAccountCodes: [],
    counterparty: { mode: 'any', value: '' },
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
    order: 'label_asc',
    limit: 1,
    ...changes,
  };
}
let selected: FinancialQuery;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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
        label: 'Total',
        value: '-210.00',
        entry_count: '3',
        period_from: null,
        period_to: null,
      },
    ];
  });
  mocks.db.query.mockResolvedValue({ rows: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('Cash-movement chat execution with a stubbed planner, not a model-accuracy test', () => {
  it('advertises the distinct flow metric and executes its real compiler without a numeric model narrative', async () => {
    const instructions = buildFinancialPlannerInput('composable', [], '2026-10-31');
    expect(instructions.instructions).toContain('net_cash_movement');
    expect(instructions.instructions).toContain('loans and owner funding');
    expect(JSON.stringify(instructions.tools)).toContain('net_cash_movement');
    const result = await financialChat(org, [
      { role: 'user', content: 'How much did our cash change during October?' },
    ]);
    expect(result.answer).toContain('Net cash and bank movement: -$210.00');
    expect(result.answer).toContain('2026-10-01 to 2026-10-31');
    expect(result).not.toHaveProperty('scopeVerification');
    expect(result.evidence[0].scope).toContain('negative means a decrease');
    expect(result).toHaveProperty('facts.0.scope.cashMovementSource.accounts.0.id', bank.id);
    expect(mocks.choose).toHaveBeenCalledTimes(1);
    const read = mocks.query.mock.calls.find(([sql]) => String(sql).includes('journal_lines'))!;
    expect(read[0]).toContain('l.base_debit-l.base_credit');
    expect(read[1][4]).toEqual([bank.id]);
    expect(read[2]).toBe(mocks.db);
  });

  it.each([
    { accountCodes: ['1010'] },
    { status: 'DRAFT' as const },
    { from: null },
    { aggregation: 'average_per_entry' as const },
  ])('withholds invalid cash scope without reading money or trying a substitute: %j', async (changes) => {
    selected = plan(changes);
    const result = await financialChat(org, [{ role: 'user', content: 'How did our cash change?' }]);
    expect(result).toMatchObject({ evidence: [], limitation: { code: 'INVALID_ANALYSIS_SCOPE' } });
    expect(result).not.toHaveProperty('facts');
    expect(result.answer).not.toContain('210');
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('journal_lines'))).toBe(false);
    expect(mocks.choose).toHaveBeenCalledTimes(1);
  });

  it('preserves canonical all-history movement scope through chat execution', async () => {
    selected = plan({ from: '2000-01-01' });
    const result = await financialChat(org, [
      { role: 'user', content: 'Show net cash movement across all recorded history through 2026-10-31.' },
    ]);
    expect(result).toHaveProperty('scopeNormalization.executedFrom', ALL_HISTORY_START);
    expect(result).toHaveProperty('facts.0.scope.plan.from', ALL_HISTORY_START);
    expect(result.answer).toContain('All recorded history through 2026-10-31');
    expect(result.answer).not.toContain('2000');
    expect(mocks.choose).toHaveBeenCalledTimes(1);
  });

  it('does not widen explicit bounded or negated cash periods', () => {
    const args = { queries: [plan()] };
    for (const content of [
      'Show cash movement from 2026-10-01 to 2026-10-31.',
      'Do not use all-time cash movement; use October 2026.',
    ]) {
      expect(normalizeAllHistoryFlow('financial_analysis', args, [{ role: 'user', content }])).toEqual({
        args,
      });
    }
  });
});
