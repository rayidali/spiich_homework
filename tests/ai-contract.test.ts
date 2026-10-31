import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// This fake tests our provider boundary, not a model's reasoning quality.
// Live model behavior is evaluated separately after a key is configured.
const provider = vi.hoisted(() => ({ parse: vi.fn(), create: vi.fn() }));
vi.mock('openai', () => {
  class APIError extends Error {
    status = 503;
  }
  return {
    default: class {
      static APIError = APIError;
      responses = provider;
    },
  };
});

import { config } from '../server/config';
import { pool, query } from '../server/db';
import { seedChart } from '../scripts/seed';
import { accounts, createEntry, postEntry } from '../server/ledger';
import { proposeEntry, financialChat } from '../server/ai';
import { recordProposal } from '../server/categorization-memory';

const admin = new pg.Client({ connectionString: config.migrationUrl });
const originalKey = config.aiKey;
const originalProvider = config.aiProvider;
const originalModel = config.aiModel;
let org: string, ids: Record<string, string>;
beforeAll(async () => {
  await admin.connect();
  config.aiKey = 'contract-test-key-never-sent';
  config.aiProvider = 'openai';
});
beforeEach(async () => {
  vi.clearAllMocks();
  config.aiProvider = 'openai';
  config.aiModel = 'gpt-6-luna';
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'AI contract test')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((a) => [a.code, a.id]));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  config.aiKey = originalKey;
  config.aiProvider = originalProvider;
  config.aiModel = originalModel;
  await admin.end();
  await pool.end();
});

function suggestion() {
  return {
    action: 'READY',
    description: 'Office supplies',
    date: '2026-03-01',
    counterparty: 'Staples',
    reference: '',
    explanation: 'Supplies expense paid using the company card.',
    questions: [],
    lines: [
      { accountId: ids['5030'], debit: '340', credit: '0', exchangeRate: '1', memo: '' },
      { accountId: ids['2100'], debit: '0', credit: '340', exchangeRate: '1', memo: '' },
    ],
  };
}
const messages = [
  { role: 'user' as const, content: 'Bought $340 of office supplies using the company credit card' },
];

describe('AI proposals stay outside the posting boundary', () => {
  it('validates a structured proposal without creating any journal record', async () => {
    provider.parse.mockResolvedValue({ output_parsed: suggestion() });
    const result = await proposeEntry(org, messages, '2026-03-01');
    expect(result.entry?.lines[0].accountId).toBe(ids['5030']);
    expect((await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).length).toBe(0);
    expect(provider.parse.mock.calls[0][0].store).toBe(false);
  });
  it('passes the original purchase and every clarification beyond twelve messages to the provider', async () => {
    const conversation: { role: 'user' | 'assistant'; content: string }[] = [...messages];
    for (let turn = 0; turn < 7; turn++)
      conversation.push(
        { role: 'assistant', content: 'Should the original purchase facts stay the same?' },
        { role: 'user', content: 'Yes, keep the same amount, purpose and company card.' },
      );
    const original = structuredClone(conversation);
    provider.parse.mockResolvedValue({ output_parsed: suggestion() });
    const result = await proposeEntry(org, conversation, '2026-03-01');
    expect(provider.parse).toHaveBeenCalledTimes(1);
    expect(provider.parse.mock.calls[0][0].input).toEqual(original);
    expect(provider.parse.mock.calls[0][0].input).toHaveLength(15);
    expect(conversation).toEqual(original);
    expect(result.entry?.lines[0]).toMatchObject({ accountId: ids['5030'], debit: '340' });
    expect(await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).toEqual([]);
  });
  it('returns a clarification without silently choosing a payment account', async () => {
    provider.parse.mockResolvedValue({
      output_parsed: {
        ...suggestion(),
        action: 'CLARIFY',
        lines: [],
        questions: ['Which account paid for the supplies?'],
      },
    });
    const result = await proposeEntry(org, [{ role: 'user', content: 'Bought $340 supplies' }], '2026-03-01');
    expect(result.entry).toBeNull();
    expect(result.questions).toHaveLength(1);
    provider.parse.mockResolvedValue({
      output_parsed: { ...suggestion(), action: 'CLARIFY', lines: [], questions: [] },
    });
    await expect(proposeEntry(org, messages, '2026-03-01')).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
    });
  });
  it('rejects a balanced-looking proposal with an unknown account', async () => {
    const result = suggestion();
    result.lines[0].accountId = randomUUID();
    provider.parse.mockResolvedValue({ output_parsed: result });
    await expect(proposeEntry(org, messages, '2026-03-01')).rejects.toMatchObject({
      code: 'INVALID_ACCOUNT',
    });
  });
  it('rejects imbalance even if the model says the entry is ready', async () => {
    const result = suggestion();
    result.lines[1].credit = '339.99';
    provider.parse.mockResolvedValue({ output_parsed: result });
    await expect(proposeEntry(org, messages, '2026-03-01')).rejects.toMatchObject({
      code: 'UNBALANCED_ENTRY',
    });
  });
  it('retrieves an actual reviewed posting correction, excluding legacy and foreign-workspace examples', async () => {
    const wrong = suggestion();
    wrong.lines[0].accountId = ids['1200'];
    provider.parse.mockResolvedValue({ output_parsed: wrong });
    const proposed = await proposeEntry(org, messages, '2026-03-01');
    if (!proposed.entry || !('proposalId' in proposed)) throw new Error('Expected a stored proposal');
    const reviewed = { ...proposed.entry, lines: suggestion().lines };
    const draft = await createEntry(org, reviewed, randomUUID(), { proposalId: proposed.proposalId });
    const posted = await postEntry(org, draft.id, draft.revision);
    expect(posted.categorizationLearning.status).toBe('LEARNED');
    const foreignOrg = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Foreign correction scope')", [
      foreignOrg,
    ]);
    for (const scope of [org, foreignOrg]) {
      await query(
        'INSERT INTO categorization_feedback(organization_id,description,counterparty,proposed_lines,corrected_lines) VALUES($1,$2,$3,$4,$5)',
        [scope, 'UNVERIFIED_PRIVATE_EXAMPLE', 'Staples', '[]', JSON.stringify(suggestion().lines)],
      );
    }
    await seedChart(foreignOrg);
    const foreignIds = Object.fromEntries((await accounts(foreignOrg)).map((a) => [a.code, a.id]));
    const foreignProposal = {
      ...reviewed,
      description: 'FOREIGN_CONFIRMED_EXAMPLE',
      lines: [
        { accountId: foreignIds['1200'], debit: '340', credit: '0', exchangeRate: '1', memo: '' },
        { accountId: foreignIds['2100'], debit: '0', credit: '340', exchangeRate: '1', memo: '' },
      ],
    };
    const foreignProposalId = await recordProposal(foreignOrg, foreignProposal);
    const foreignDraft = await createEntry(
      foreignOrg,
      {
        ...foreignProposal,
        lines: foreignProposal.lines.map((l, i) => (i === 0 ? { ...l, accountId: foreignIds['5030'] } : l)),
      },
      randomUUID(),
      { proposalId: foreignProposalId },
    );
    expect(
      (await postEntry(foreignOrg, foreignDraft.id, foreignDraft.revision)).categorizationLearning.status,
    ).toBe('LEARNED');
    provider.parse.mockResolvedValue({ output_parsed: suggestion() });
    provider.parse.mockClear();
    const next = await proposeEntry(
      org,
      [{ role: 'user', content: 'Staples office supplies using the company card' }],
      '2026-03-01',
    );
    const prompt = provider.parse.mock.calls[0][0].instructions as string;
    expect(prompt).toContain('CONFIRMED CORRECTIONS: [{');
    expect(prompt).toContain('Staples');
    expect(prompt).toContain(ids['5030']);
    expect(prompt).not.toContain('UNVERIFIED_PRIVATE_EXAMPLE');
    expect(prompt).not.toContain('FOREIGN_CONFIRMED_EXAMPLE');
    expect(next.context.correctionIds).toEqual([posted.categorizationLearning.memoryId]);
  });
});

describe('Insight tools compute their own financial answers', () => {
  it('uses an allowed read-only tool and returns the database total with evidence', async () => {
    await createEntry(
      org,
      {
        date: '2026-03-01',
        description: 'Investment',
        counterparty: 'Owner',
        reference: '',
        source: 'MANUAL',
        lines: [
          { accountId: ids['1010'], debit: '10000.25', credit: '0', exchangeRate: '1', memo: '' },
          { accountId: ids['3010'], debit: '0', credit: '10000.25', exchangeRate: '1', memo: '' },
        ],
      },
      randomUUID(),
      { post: true },
    );
    provider.create.mockResolvedValue({
      output: [
        { type: 'function_call', name: 'cash_position', arguments: JSON.stringify({ asOf: '2026-03-31' }) },
      ],
    });
    const response = await financialChat(org, [{ role: 'user', content: 'What is my cash balance?' }]);
    expect(response.answer).toContain('$10,000.25');
    expect(response.evidence[0].rows[0].href).toContain('to=2026-03-31');
    expect(provider.create.mock.calls[0][0].parallel_tool_calls).toBe(false);
  });
  it('rejects a model-invented SQL tool without changing the journal', async () => {
    provider.create.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          name: 'execute_sql',
          arguments: JSON.stringify({ sql: 'DELETE FROM journal_entries' }),
        },
      ],
    });
    await expect(financialChat(org, messages)).rejects.toMatchObject({ code: 'UNSUPPORTED_TOOL' });
    expect((await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).length).toBe(0);
  });
  it('turns malformed tool arguments into a recoverable error', async () => {
    provider.create.mockResolvedValue({
      output: [{ type: 'function_call', name: 'cash_position', arguments: 'not-json' }],
    });
    await expect(financialChat(org, messages)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
      status: 502,
    });
  });
});

function geminiResult(parts: unknown[]) {
  config.aiProvider = 'gemini';
  config.aiModel = 'gemini-3.8-flash';
  const transport = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, totalTokenCount: 200 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', transport);
  return transport;
}

describe('Gemini uses the same real accounting validation', () => {
  it('returns a validated proposal without creating a journal record', async () => {
    const transport = geminiResult([{ text: JSON.stringify(suggestion()) }]);
    const result = await proposeEntry(org, messages, '2026-03-01');
    expect(result.entry?.lines).toEqual(suggestion().lines);
    expect(result.ai.provider).toBe('gemini');
    expect(result.context).toEqual({ correctionIds: [], historyEntryIds: [] });
    expect((await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).length).toBe(0);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('returns missing-account clarification without a ready entry', async () => {
    geminiResult([
      {
        text: JSON.stringify({
          ...suggestion(),
          action: 'CLARIFY',
          lines: [],
          questions: ['Which account paid?'],
        }),
      },
    ]);
    const result = await proposeEntry(org, messages, '2026-03-01');
    expect(result.entry).toBeNull();
    expect(result.questions).toEqual(['Which account paid?']);
  });
  it.each(['unknown account', 'unbalanced amount'])(
    'rejects %s using shared ledger checks',
    async (scenario) => {
      const data = suggestion();
      if (scenario === 'unknown account') data.lines[0].accountId = randomUUID();
      else data.lines[1].credit = '339';
      geminiResult([{ text: JSON.stringify(data) }]);
      await expect(proposeEntry(org, messages, '2026-03-01')).rejects.toMatchObject({
        code: scenario === 'unknown account' ? 'INVALID_ACCOUNT' : 'UNBALANCED_ENTRY',
      });
      expect((await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).length).toBe(0);
    },
  );
  it('rejects unexpected organization arguments instead of allowing model-selected scope', async () => {
    geminiResult([
      { functionCall: { name: 'cash_position', args: { asOf: '2026-03-31', organizationId: randomUUID() } } },
    ]);
    await expect(financialChat(org, messages)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });
  it('returns the validated read query with SQL evidence', async () => {
    geminiResult([{ functionCall: { name: 'cash_position', args: { asOf: '2026-03-31' } } }]);
    const result = await financialChat(org, messages);
    expect(result.query).toEqual({ name: 'cash_position', args: { asOf: '2026-03-31' } });
    expect(result.answer).toContain('$0.00');
    expect(result.evidence[0].period).toBe('As of 2026-03-31');
  });
});
