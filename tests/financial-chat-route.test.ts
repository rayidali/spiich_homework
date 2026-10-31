import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ choose: vi.fn(), allAccounts: vi.fn(), expenseAccounts: vi.fn() }));
vi.mock('../server/ai-provider', () => ({ chooseFinancialTool: mocks.choose, generateProposal: vi.fn() }));
vi.mock('../server/financial-analysis', async (original) => ({
  ...(await original<typeof import('../server/financial-analysis')>()),
  financialAnalysisChart: mocks.allAccounts,
}));
vi.mock('../server/reports', async (original) => ({
  ...(await original<typeof import('../server/reports')>()),
  expenseAccountChart: mocks.expenseAccounts,
}));
import { financialChat } from '../server/ai';

const org = '00000000-0000-4000-8000-000000000001';
const messages = [{ role: 'user' as const, content: 'Help me with my books.' }];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('FINANCIAL_CHAT_ROUTE', undefined);
  mocks.allAccounts.mockResolvedValue([]);
  mocks.expenseAccounts.mockResolvedValue([]);
  mocks.choose.mockImplementation(async (tools) => ({
    call: tools.some((tool: { name: string }) => tool.name === 'financial_analysis')
      ? {
          name: 'request_details',
          args: { reason: 'missing_period', subject: 'analysis', accountCodes: [], limitation: 'none' },
        }
      : { name: 'ask_clarification', args: { question: 'Which period should I use?' } },
    ai: { provider: 'gemini', model: 'mocked', durationMs: 1 },
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe('Product chat route selection without provider calls', () => {
  it('uses composable tools and all account identities when configuration is absent', async () => {
    const result = await financialChat(org, messages);
    expect(mocks.allAccounts).toHaveBeenCalledExactlyOnceWith(org);
    expect(mocks.expenseAccounts).not.toHaveBeenCalled();
    const tools = mocks.choose.mock.calls[0][0].map((tool: { name: string }) => tool.name);
    expect(tools).toEqual(
      expect.arrayContaining(['financial_analysis', 'financial_scenario', 'request_details']),
    );
    expect(result.query.name).toBe('request_details');
    expect(result.evidence).toEqual([]);
  });

  it('preserves authored as an explicit environment setting', async () => {
    vi.stubEnv('FINANCIAL_CHAT_ROUTE', 'authored');
    const result = await financialChat(org, messages);
    expect(mocks.expenseAccounts).toHaveBeenCalledExactlyOnceWith(org);
    expect(mocks.allAccounts).not.toHaveBeenCalled();
    expect(
      mocks.choose.mock.calls[0][0].some((tool: { name: string }) => tool.name === 'financial_analysis'),
    ).toBe(false);
    expect(result.query.name).toBe('ask_clarification');
  });

  it.each(['authored', 'composable'] as const)(
    'retains an explicit internal %s comparison route',
    async (route) => {
      vi.stubEnv('FINANCIAL_CHAT_ROUTE', route === 'authored' ? 'composable' : 'authored');
      const result = await financialChat(org, messages, { route });
      expect(result.query.name).toBe(route === 'authored' ? 'ask_clarification' : 'request_details');
      expect(
        route === 'authored' ? mocks.expenseAccounts : mocks.allAccounts,
      ).toHaveBeenCalledExactlyOnceWith(org);
    },
  );
});
