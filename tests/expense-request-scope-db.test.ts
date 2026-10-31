import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({ choose: vi.fn() }));
vi.mock('../server/ai-provider', async (original) => ({
  ...(await original<typeof import('../server/ai-provider')>()),
  chooseFinancialTool: provider.choose,
}));

import { financialChat } from '../server/ai';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { accounts, createEntry } from '../server/ledger';
import { seedChart } from '../scripts/seed';
import type { FinancialQuery } from '../server/financial-analysis';
import type { EntryInput } from '../shared/schema';

// Model selection is synthetic. Account resolution, SQL, read snapshots and the
// resulting financial answers are the actual product implementations.
const admin = new pg.Client({ connectionString: config.migrationUrl });
let connected = false;
let org: string;
let ids: Record<string, string>;
const period = { from: '2026-03-01', to: '2026-03-31' };
const question = 'How much did we spend on Office supplies from 2026-03-01 to 2026-03-31?';
const ai = {
  provider: 'gemini',
  model: 'mocked-scope-planner',
  modelVersion: 'mocked-scope-planner',
  durationMs: 0,
  attempts: 1,
  usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0, totalTokens: 2 },
};

beforeAll(async () => {
  for (const value of [config.databaseUrl, config.migrationUrl]) {
    const parsed = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    const compose =
      process.env.NODE_ENV === 'test' &&
      parsed.hostname === 'db' &&
      parsed.port === '5432' &&
      parsed.pathname === '/spiich';
    if (!local && !compose)
      throw new Error('Expense request scope tests require isolated local/CI PostgreSQL.');
  }
  await admin.connect();
  connected = true;
});
beforeEach(async () => {
  provider.choose.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Expense request scope fixture')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
  await post('5030', '340', '2026-03-15');
  await post('5030', '80', '2026-02-28');
  await post('5030', '90', '2026-04-01');
  await createEntry(org, entry('5030', '9000', '2026-03-15'), randomUUID());
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (connected) await admin.end();
  await pool.end();
});

function entry(account: string, amount: string, date: string): EntryInput {
  return {
    date,
    description: 'Synthetic scope-bound expense',
    counterparty: 'Synthetic merchant',
    reference: '',
    source: 'MANUAL',
    lines: [
      { accountId: ids[account], debit: amount, credit: '0', exchangeRate: '1', memo: '' },
      { accountId: ids['2100'], debit: '0', credit: amount, exchangeRate: '1', memo: '' },
    ],
  };
}
const post = (account: string, amount: string, date = '2026-03-15') =>
  createEntry(org, entry(account, amount, date), randomUUID(), { post: true });

async function addAccount(code: string, name: string, parent = '5000', group = false) {
  const [created] = await query<{ id: string }>(
    `INSERT INTO accounts(organization_id,code,name,type,currency,parent_id,is_group)
     VALUES($1,$2,$3,'EXPENSE','USD',$4,$5) RETURNING id`,
    [org, code, name, ids[parent], group],
  );
  ids[code] = created.id;
}

function expensePlan(changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id: 'scoped_expenses',
    metric: 'net_expense',
    aggregation: 'sum',
    ...period,
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
    ...changes,
  };
}
type SelectedCall = { name: string; args: Record<string, unknown> };
const analysis = (changes: Partial<FinancialQuery> = {}): SelectedCall => ({
  name: 'financial_analysis',
  args: { queries: [expensePlan(changes)] },
});

async function booksFingerprint() {
  const [row] = await query<{
    snapshot: { entries: unknown[]; lines: unknown[]; accounts: unknown[] };
  }>(
    `SELECT jsonb_build_object(
      'entries',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM journal_entries e WHERE organization_id=$1),'[]'::jsonb),
      'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM journal_lines l WHERE organization_id=$1),'[]'::jsonb),
      'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM accounts a WHERE organization_id=$1),'[]'::jsonb)) AS snapshot`,
    [org],
  );
  return {
    sha256: createHash('sha256').update(JSON.stringify(row.snapshot)).digest('hex'),
    entries: row.snapshot.entries.length,
    lines: row.snapshot.lines.length,
    accounts: row.snapshot.accounts.length,
  };
}

async function checkedChat(call: SelectedCall, text = question) {
  const before = await booksFingerprint();
  const priorCalls = provider.choose.mock.calls.length;
  provider.choose.mockResolvedValueOnce({ call, ai });
  const result = await financialChat(org, [{ role: 'user', content: text }], { route: 'composable' });
  expect(provider.choose).toHaveBeenCalledTimes(priorCalls + 1);
  expect(await booksFingerprint()).toEqual(before);
  return result;
}

function expectWithheld(result: Awaited<ReturnType<typeof financialChat>>) {
  expect(result).toMatchObject({ limitation: { code: 'REQUEST_SCOPE_MISMATCH' }, evidence: [] });
  expect(result).not.toHaveProperty('scopeVerification');
  expect(result).not.toHaveProperty('facts');
  expect(result).not.toHaveProperty('calculations');
  expect(result.answer).not.toMatch(/\$\s*\d/);
}

describe('Expense question scope is checked against real PostgreSQL accounts before reporting amounts', () => {
  it.each(['expense_by_account', 'financial_analysis'])(
    'returns the requested category and period through %s',
    async (name) => {
      await post('5010', '2400');
      const call =
        name === 'expense_by_account' ? { name, args: { accountCode: '5030', ...period } } : analysis();
      const result = await checkedChat(call);
      expect(result.answer).toContain('$340.00');
      expect(result.answer).not.toContain('$2,740.00');
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].rows.map((row) => row.value)).toEqual(['$340.00']);
      expect(result).toMatchObject({
        scopeVerification: {
          rule: 'explicit_expense_scope_v1',
          requestedAccount: { id: ids['5030'], code: '5030', name: 'Office supplies' },
          resolvedPostingAccountIds: [ids['5030']],
          period: { requested: period, executed: period },
        },
      });
      expect(result).not.toHaveProperty('limitation');
    },
  );

  it.each([
    ['wrong category', { name: 'expense_by_account', args: { accountCode: '5010', ...period } }, false],
    [
      'global report with other zero accounts',
      { name: 'expense_summary', args: { ...period, view: 'total', limit: null } },
      false,
    ],
    ['global composable query with other zero accounts', analysis({ accountCodes: [] }), false],
    ['extra zero-value account', analysis({ accountCodes: ['5030', '5020'] }), false],
    ['global query with nonzero unrelated rent', analysis({ accountCodes: [] }), true],
  ] as const)(
    'withholds %s even when a wrong scope can coincidentally have the right total',
    async (_label, call, addRent) => {
      if (addRent) await post('5010', '2400');
      expectWithheld(await checkedChat(call));
    },
  );

  it.each([
    { name: 'expense_by_account', args: { accountCode: '5030', from: '2026-02-01', to: period.to } },
    analysis({ to: '2026-04-30' }),
  ])('withholds a query that changes an explicit requested date boundary', async (call) => {
    expectWithheld(await checkedChat(call));
  });

  it('keeps nested and archived group descendants, accepting equivalent posting-account sets without duplicate amounts', async () => {
    await addAccount('5100', 'Office operations', '5000', true);
    await addAccount('5110', 'Paper operations', '5100', true);
    await addAccount('5111', 'Paper stock', '5110');
    await addAccount('5112', 'Old printing', '5110');
    await addAccount('5101', 'Postage', '5100');
    await post('5111', '90');
    await post('5112', '25');
    await post('5101', '15');
    await query('UPDATE accounts SET archived=true WHERE organization_id=$1 AND id=$2', [org, ids['5112']]);
    const text = 'How much did we spend on Office operations from 2026-03-01 to 2026-03-31?';
    for (const codes of [['5100'], ['5100', '5111'], ['5101', '5111', '5112']]) {
      const result = await checkedChat(analysis({ accountCodes: codes }), text);
      expect(result.answer).toContain('$130.00');
      expect(result.evidence[0].rows.map((row) => row.value)).toEqual(['$130.00']);
      expect(result).toMatchObject({ scopeVerification: { rule: 'explicit_expense_scope_v1' } });
      expect(result).not.toHaveProperty('limitation');
      expect(result).toMatchObject({
        facts: [
          { scope: { resolvedAccountIds: expect.arrayContaining([ids['5101'], ids['5111'], ids['5112']]) } },
        ],
        scopeVerification: {
          requestedAccount: { id: ids['5100'], code: '5100', name: 'Office operations' },
          resolvedPostingAccountIds: expect.arrayContaining([ids['5101'], ids['5111'], ids['5112']]),
        },
      });
      expect(result).toHaveProperty('facts.0.scope.resolvedAccountIds.length', 3);
      expect(result).toHaveProperty('scopeVerification.resolvedPostingAccountIds.length', 3);
    }
  });

  it('asks for account identity when two expense accounts share the requested name', async () => {
    await addAccount('5031', 'Office supplies');
    const result = await checkedChat(analysis());
    expectWithheld(result);
    expect(result).toMatchObject({ limitation: { reason: 'ambiguous_account' } });
    expect(result.answer.toLowerCase()).toContain('account');
  });

  it('uses the explicit account code to distinguish duplicate names without adding the other account', async () => {
    await addAccount('5031', 'Office supplies');
    await post('5031', '700');
    const result = await checkedChat(
      analysis(),
      'How much did we spend on account 5030 from 2026-03-01 to 2026-03-31?',
    );
    expect(result.answer).toContain('$340.00');
    expect(result.evidence[0].rows.map((row) => row.value)).toEqual(['$340.00']);
    expect(result).toMatchObject({ scopeVerification: { rule: 'explicit_expense_scope_v1' } });
  });
});
