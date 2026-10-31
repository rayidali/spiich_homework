import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const repository = vi.hoisted(() => ({ query: vi.fn(), context: vi.fn(), record: vi.fn() }));
vi.mock('../server/db', () => ({
  query: repository.query,
  transaction: (fn: (db: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('../server/categorization-memory', () => ({
  getCategorizationContext: repository.context,
  recordProposal: repository.record,
}));
import { categoryAvailability, suggestCategory } from '../server/category-service';
import { config } from '../server/config';
import { withRequestContext } from '../server/diagnostics';
import { failureStage } from '../server/errors';
import type { CategoryTransport } from '../server/category-selector';
const org = '00000000-0000-4000-8000-000000000001',
  category = '00000000-0000-4000-8000-000000000002',
  bank = '00000000-0000-4000-8000-000000000003',
  proposalId = '00000000-0000-4000-8000-000000000004';
const facts = {
  description: 'Office supplies',
  counterparty: 'Paper Shop',
  direction: 'OUT',
  amount: '340',
  date: '2026-10-31',
  currency: 'USD',
  exchangeRate: '1',
  fundingAccountId: bank,
  purpose: 'BUSINESS',
  structure: 'SINGLE',
};
const saved = {
  categoryProvider: config.categoryProvider,
  categoryKey: config.categoryKey,
  aiKey: config.aiKey,
};
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  repository.query.mockReset();
  repository.context.mockReset();
  repository.record.mockReset();
  const common = { organizationId: org, currency: 'USD', archived: false, is_group: false };
  repository.query.mockImplementation(async (sql: string) =>
    sql.includes('organizations')
      ? [{ base_currency: 'USD' }]
      : [
          { ...common, id: category, code: '5030', name: 'Office supplies', type: 'EXPENSE', is_cash: false },
          { ...common, id: bank, code: '1010', name: 'Checking', type: 'ASSET', is_cash: true },
        ],
  );
  repository.context.mockResolvedValue({ corrections: [], history: [] });
  repository.record.mockResolvedValue(proposalId);
  config.categoryProvider = 'reference';
  config.categoryKey = '';
});
afterEach(() => {
  Object.assign(config, saved);
  vi.restoreAllMocks();
});
describe('category service boundary without sockets or providers', () => {
  it.each(['accounts', 'context', 'organizationId', 'provider', 'apiKey', 'lines'])(
    'rejects client-supplied %s before repository/provider work',
    async (field) => {
      await expect(suggestCategory(org, { ...facts, [field]: [] })).rejects.toThrow();
      expect(repository.query).not.toHaveBeenCalled();
      expect(repository.context).not.toHaveBeenCalled();
    },
  );
  it('builds fixed balanced lines and records a proposal without an entry write', async () => {
    const result = await suggestCategory(org, facts);
    expect(result).toMatchObject({
      decision: 'SELECT',
      accountId: category,
      proposalId,
      entry: {
        source: 'AI',
        date: facts.date,
        description: facts.description,
        lines: [
          { accountId: category, debit: '340', credit: '0', exchangeRate: '1' },
          { accountId: bank, debit: '0', credit: '340', exchangeRate: '1' },
        ],
      },
    });
    expect(repository.record).toHaveBeenCalledTimes(1);
    expect(repository.query.mock.calls.every(([sql]) => String(sql).trim().startsWith('SELECT'))).toBe(true);
    expect(repository.context).toHaveBeenCalledWith(org, 'Office supplies Paper Shop');
  });
  it('rejects a selected account whose classification changed before proposal storage', async () => {
    const original = repository.query.getMockImplementation()!;
    repository.query.mockImplementation(async (sql: string, ...args: unknown[]) => {
      const rows = await original(sql, ...args);
      return sql.includes('FOR SHARE')
        ? rows.map((row: { id: string }) => (row.id === category ? { ...row, type: 'ASSET' } : row))
        : rows;
    });
    await expect(suggestCategory(org, facts)).rejects.toMatchObject({ code: 'INVALID_ACCOUNT' });
    expect(repository.record).not.toHaveBeenCalled();
  });
  it('does not issue a proposal for clarification or unsupported input', async () => {
    expect(await suggestCategory(org, { ...facts, purpose: null })).toMatchObject({
      decision: 'CLARIFY',
      topic: 'purpose',
    });
    expect(await suggestCategory(org, { ...facts, purpose: 'LOAN' })).toMatchObject({
      decision: 'UNSUPPORTED',
    });
    expect(repository.record).not.toHaveBeenCalled();
  });
  it('separates category availability from the whole-entry provider', () => {
    config.aiKey = '';
    expect(categoryAvailability().available).toBe(true);
    config.categoryProvider = 'jev';
    expect(categoryAvailability().available).toBe(false);
    config.categoryKey = 'synthetic';
    expect(categoryAvailability()).toEqual({ available: true, provider: 'jev', model: 'jev-1.14.0' });
  });
  it('does not contact an unconfigured provider', async () => {
    config.categoryProvider = 'jev';
    await expect(suggestCategory(org, facts)).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(repository.query).not.toHaveBeenCalled();
  });
  it('logs safe Jev metadata with the request ID but no credentials or financial description', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    const requestId = '00000000-0000-4000-8000-000000000010';
    const transport = vi
      .fn<CategoryTransport>()
      .mockResolvedValue({ status: 529, body: { message: 'PRIVATE_BUSINESS_CONTENT' } });
    const error = await withRequestContext(
      { requestId, method: 'POST', route: () => '/api/ai/category' },
      () => suggestCategory(org, facts, { provider: 'jev', apiKey: 'PRIVATE_KEY', transport }),
    ).catch((e) => e);
    expect(error.code).toBe('AI_PROVIDER_ERROR');
    expect(failureStage(error)).toBe('provider_http');
    const log = JSON.parse(String(logger.mock.calls[0][0]));
    expect(log).toMatchObject({
      requestId,
      route: '/api/ai/category',
      provider: 'jev',
      model: 'jev-1.14.0',
      operation: 'category',
      upstreamStatus: 529,
    });
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(/PRIVATE|Paper Shop|Office supplies/);
    expect(repository.record).not.toHaveBeenCalled();
  });
  it('bounds concurrency and releases permits on every failure', async () => {
    const releases: Array<(value: { status: number; body: unknown }) => void> = [];
    const transport = vi
      .fn<CategoryTransport>()
      .mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
    const calls = Array.from({ length: 4 }, () =>
      suggestCategory(org, facts, { provider: 'gemini', apiKey: 'synthetic', transport }).catch((e) => e),
    );
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(4));
    await expect(
      suggestCategory(org, facts, { provider: 'gemini', apiKey: 'synthetic', transport }),
    ).rejects.toMatchObject({ code: 'AI_BUSY' });
    releases.forEach((release) => release({ status: 503, body: null }));
    await Promise.all(calls);
    expect(await suggestCategory(org, facts)).toMatchObject({ decision: 'SELECT' });
  });
});
