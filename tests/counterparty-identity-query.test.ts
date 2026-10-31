import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), client: { query: vi.fn() } }));
vi.mock('../server/db', () => ({ query: mocks.query, transaction: vi.fn() }));
import {
  compileFinancialQuery,
  executeFinancialAnalysis,
  type FinancialQuery,
} from '../server/financial-analysis';

const org = '00000000-0000-4000-8000-000000000001';
const plan = (key = 'Acme'): FinancialQuery => ({
  id: 'detail',
  metric: 'net_expense',
  aggregation: 'sum',
  from: '2026-01-01',
  to: '2026-01-31',
  status: 'POSTED',
  currencyMode: 'base',
  currency: null,
  groupBy: 'total',
  accountCodes: [],
  cooccurringAccountCodes: [],
  counterparty: { mode: 'identity', value: key },
  descriptionSearch: '',
  minimumAmount: null,
  maximumAmount: null,
  order: 'label_asc',
  limit: 50,
});
const binding = (key: string) => ({
  queryId: 'discovery',
  rowId: `counterparty:${encodeURIComponent(key)}`,
  key,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.query.mockResolvedValue({ rows: [] });
  mocks.query.mockImplementation(async (sql: string) =>
    sql.includes('journal_lines')
      ? [
          {
            row_id: 'total',
            label: 'Total',
            value: '0.00',
            entry_count: '0',
            period_from: null,
            period_to: null,
          },
        ]
      : [],
  );
});
afterEach(() => vi.restoreAllMocks());

describe('Server-only counterparty identity SQL boundary', () => {
  it('refuses an internal identity mode without a server binding', () => {
    expect(() => compileFinancialQuery(org, plan(), [])).toThrow('server-resolved inspection reference');
  });
  it('refuses a mismatched raw key or an identity attached to a case-insensitive filter', () => {
    expect(() => compileFinancialQuery(org, plan(), [], binding('acme'))).toThrow();
    expect(() =>
      compileFinancialQuery(
        org,
        { ...plan(), counterparty: { mode: 'exact', value: 'Acme' } },
        [],
        binding('Acme'),
      ),
    ).toThrow('cannot silently alter');
  });
  it.each(['', ' Acme ', 'acme', 'Äcme', '(No counterparty)', "x'); SELECT secret; --"])(
    'binds exact stored identity %j without case folding, trimming or SQL interpolation',
    (key) => {
      const compiled = compileFinancialQuery(org, plan(key), [], binding(key));
      expect(compiled.params[6]).toBe(key);
      expect(compiled.plan.counterparty.value).toBe(key);
      expect(compiled.sql).toContain('e.counterparty COLLATE "C" = $7 COLLATE "C"');
      expect(compiled.sql).not.toContain('lower(e.counterparty)=lower($7)');
      if (key) expect(compiled.sql).not.toContain(key);
    },
  );
  it('cannot disguise filtered activity as a closing cash balance', () => {
    expect(() =>
      compileFinancialQuery(org, { ...plan(), metric: 'cash_balance', from: null }, [], binding('Acme')),
    ).toThrow();
  });
  it('does not read inherited object properties as bindings for ordinary query IDs', async () => {
    const input = { ...plan(), id: 'constructor', counterparty: { mode: 'any', value: '' } };
    const result = await executeFinancialAnalysis(org, { queries: [input] }, mocks.client, {
      counterpartyIdentities: {},
    });
    expect(result.facts[0].queryId).toBe('constructor');
    expect(result.facts[0].scope).not.toHaveProperty('counterpartyIdentity');
  });
  it('refuses bindings for query IDs that are not executed', async () => {
    await expect(
      executeFinancialAnalysis(org, { queries: [plan()] }, mocks.client, {
        counterpartyIdentities: { unrelated: binding('Acme') },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_SCOPE' });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('returns the exact server binding with the executed plan for downstream validation', async () => {
    const proof = binding(' Acme ');
    const result = await executeFinancialAnalysis(org, { queries: [plan(proof.key)] }, mocks.client, {
      counterpartyIdentities: { detail: proof },
    });
    expect(result.facts[0].scope).toMatchObject({
      counterpartyIdentity: proof,
      plan: { counterparty: { mode: 'identity', value: ' Acme ' } },
    });
  });
});
