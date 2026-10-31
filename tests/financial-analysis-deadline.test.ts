import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../server/db';
import {
  executeFinancialAnalysis,
  type AnalysisAccount,
  type FinancialQuery,
} from '../server/financial-analysis';

const org = '00000000-0000-4000-8000-000000000001';
const account: AnalysisAccount = {
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
const plan = (id: string): FinancialQuery => ({
  id,
  metric: 'net_expense',
  aggregation: 'sum',
  from: '2026-10-01',
  to: '2026-10-31',
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
  order: 'label_asc',
  limit: 50,
});
const timeoutSql = "SELECT set_config('statement_timeout', $1, true)";
const rows = [{ row_id: 'total', label: 'Total', value: '120.00', entry_count: '2' }];

// These exercise the real compiler/executor with synthetic DB rows and clocks.
// They verify statement budgets, not actual cancellation or an HTTP wall-time SLA.
function database(hooks: { chart?: () => void; amount?: () => void } = {}) {
  const events: string[] = [];
  const execute = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SET LOCAL')) return { rows: [] };
    if (sql === timeoutSql) {
      events.push(`timeout:${params?.[0]}`);
      return { rows: [] };
    }
    if (sql.startsWith('SELECT id,code,name,type,currency,parent_id,is_group,archived,is_cash')) {
      events.push('chart');
      hooks.chart?.();
      return { rows: [account] };
    }
    if (sql.startsWith('WITH typed_input')) {
      events.push('amount');
      hooks.amount?.();
      return { rows };
    }
    throw new Error('Unexpected offline database statement');
  });
  return { execute, events, snapshot: { query: execute } as unknown as Db };
}

afterEach(() => vi.restoreAllMocks());

describe('Financial analysis statement deadlines (offline)', () => {
  it('caps the chart and each amount statement at three seconds or the remaining time', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const db = database({
      chart: () => {
        now = 1500;
      },
      amount: () => {
        now = 4700;
      },
    });
    const result = await executeFinancialAnalysis(
      org,
      { queries: [plan('first'), plan('second')] },
      db.snapshot,
      { deadline: 5000 },
    );
    expect(db.events).toEqual([
      'timeout:3000ms',
      'chart',
      'timeout:3000ms',
      'amount',
      'timeout:300ms',
      'amount',
    ]);
    expect(result.facts.map((fact) => fact.rows[0].value)).toEqual(['120.00', '120.00']);
    expect(db.execute).toHaveBeenCalledWith("SET LOCAL statement_timeout='3s'");
    expect(db.execute).toHaveBeenCalledWith("SET LOCAL lock_timeout='1s'");
  });

  it('rejects an expired deadline before any chart or amount read', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    const db = database();
    await expect(
      executeFinancialAnalysis(org, { queries: [plan('first')] }, db.snapshot, { deadline: 5000 }),
    ).rejects.toMatchObject({ code: 'INSPECTION_LIMIT' });
    expect(db.events).toEqual([]);
  });

  it('stops after a late chart without reading monetary values', async () => {
    let now = 4800;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const db = database({
      chart: () => {
        now = 5001;
      },
    });
    await expect(
      executeFinancialAnalysis(org, { queries: [plan('first')] }, db.snapshot, { deadline: 5000 }),
    ).rejects.toMatchObject({ code: 'INSPECTION_LIMIT' });
    expect(db.events).toEqual(['timeout:200ms', 'chart']);
  });

  it('withholds the incomplete query batch and never starts its second amount read after expiry', async () => {
    let now = 4800;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const db = database({
      amount: () => {
        now = 5001;
      },
    });
    await expect(
      executeFinancialAnalysis(org, { queries: [plan('first'), plan('second')] }, db.snapshot, {
        deadline: 5000,
      }),
    ).rejects.toMatchObject({ code: 'INSPECTION_LIMIT' });
    expect(db.events).toEqual(['timeout:200ms', 'chart', 'timeout:200ms', 'amount']);
  });

  it('preserves ordinary execution and fixed statement limits when no deadline is supplied', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(50000);
    const db = database();
    const result = await executeFinancialAnalysis(
      org,
      { queries: [plan('first'), plan('second')] },
      db.snapshot,
    );
    expect(db.events).toEqual(['chart', 'amount', 'amount']);
    expect(db.execute).toHaveBeenCalledWith("SET LOCAL statement_timeout='3s'");
    expect(db.execute).toHaveBeenCalledWith("SET LOCAL lock_timeout='1s'");
    expect(db.execute.mock.calls.some(([sql]) => sql === timeoutSql)).toBe(false);
    expect(result.facts).toHaveLength(2);
  });
});
