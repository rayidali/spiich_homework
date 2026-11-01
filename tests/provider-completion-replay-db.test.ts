import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { accounts, createEntry } from '../server/ledger';
import { seedChart } from '../scripts/seed';
import { financialChat } from '../server/ai';
import { resetAiUsage, setAiBudget, type ModelMessages } from '../server/ai-provider';
import type { AnalysisFacts } from '../server/financial-analysis';
import type { AnswerContract, OutputBinding } from '../server/answer-contract';
import type { CompletionAssessment } from '../server/answer-completion';
import type { InsightEvidence } from '../shared/financial-evidence';

// Captured diagnostic multi function arguments only, without provider signatures
// or raw response metadata. Replay measures this regression, not model accuracy.
const messages: ModelMessages = [
  { role: 'user', content: 'For July 2026, show recorded Repair parts spending with Wheelhouse only.' },
  { role: 'assistant', content: 'I will keep Repair parts, Wheelhouse and posted entries as the filters.' },
  { role: 'user', content: 'Actually use August 2026 instead. Keep the same vendor and category.' },
];
const capturedArgs = {
  outputBindings: [
    { source: { rowId: 'total:total', kind: 'query_row', queryId: 'q1' }, outputId: 'repair_parts_august' },
  ],
  queries: [
    {
      aggregation: 'sum',
      id: 'q1',
      to: '2026-08-31',
      accountCodes: ['5030'],
      metric: 'net_expense',
      descriptionSearch: '',
      from: '2026-08-01',
      minimumAmount: null,
      groupBy: 'total',
      counterparty: { value: 'Wheelhouse', mode: 'exact' },
      maximumAmount: null,
      limit: 1,
      currencyMode: 'base',
      currency: null,
      order: 'value_desc',
      cooccurringAccountCodes: [],
      status: 'POSTED',
    },
  ],
  answerContract: [
    {
      id: 'repair_parts_august',
      requirement: {
        scope: {
          cooccurringAccountCodes: [],
          metric: 'net_expense',
          counterparty: { mode: 'exact', value: 'Wheelhouse' },
          to: '2026-08-31',
          minimumAmount: null,
          from: '2026-08-01',
          accountCodes: ['5030'],
          descriptionSearch: '',
          maximumAmount: null,
          status: 'POSTED',
          aggregation: 'sum',
          currencyMode: 'base',
          currency: null,
        },
        selectedAccountCode: null,
        counterpartyFrom: null,
        kind: 'value',
      },
      sourceQuotes: [
        { messageIndex: 2, quote: 'Actually use August 2026 instead. Keep the same vendor and category.' },
      ],
    },
  ],
};
const saved = { aiProvider: config.aiProvider, aiModel: config.aiModel, aiKey: config.aiKey };
const admin = new pg.Client({ connectionString: config.migrationUrl });
let connected = false;
beforeAll(async () => {
  for (const value of [config.databaseUrl, config.migrationUrl]) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const compose =
      process.env.NODE_ENV === 'test' &&
      url.hostname === 'db' &&
      url.port === '5432' &&
      url.pathname === '/spiich';
    if (!local && !compose) throw new Error('Provider replay requires isolated local/CI PostgreSQL.');
  }
  await admin.connect();
  connected = true;
});
afterEach(() => {
  Object.assign(config, saved);
  setAiBudget(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(async () => {
  if (connected) await admin.end();
  await pool.end();
});

it('replays the captured August correction through strict completion and actual posted ledger reads', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  Object.assign(config, {
    aiProvider: 'gemini',
    aiModel: 'gemini-3.5-flash-lite',
    aiKey: 'REPLAY_TEST_KEY_NOT_REAL',
  });
  setAiBudget(null);
  resetAiUsage();
  const fetchMock = vi.fn().mockRejectedValue(new Error('Unexpected second provider call'));
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ functionCall: { name: 'financial_analysis', args: capturedArgs } }] },
          },
        ],
        modelVersion: 'gemini-3.5-flash-lite',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          thoughtsTokenCount: 0,
          totalTokenCount: 15,
        },
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Captured completion replay')", [org]);
  await seedChart(org);
  await query("UPDATE accounts SET name='Repair parts' WHERE organization_id=$1 AND code='5030'", [org]);
  const ids = Object.fromEntries((await accounts(org)).map((a) => [a.code, a.id]));
  async function entry(date: string, amount: string, code = '5030', vendor = 'Wheelhouse', post = true) {
    await createEntry(
      org,
      {
        date,
        description: 'Synthetic provider replay fixture',
        counterparty: vendor,
        reference: '',
        source: 'MANUAL',
        lines: [
          { accountId: ids[code], debit: amount, credit: '0', exchangeRate: '1', memo: '' },
          { accountId: ids['1010'], debit: '0', credit: amount, exchangeRate: '1', memo: '' },
        ],
      },
      randomUUID(),
      { post },
    );
  }
  await entry('2026-07-15', '240');
  await entry('2026-08-01', '100');
  await entry('2026-08-31', '65');
  await entry('2026-08-15', '70', '5020');
  await entry('2026-08-15', '80', '5030', 'Other vendor');
  await entry('2026-08-15', '90', '5030', 'Wheelhouse', false);
  await entry('2026-09-01', '110');
  async function fingerprint() {
    const [row] = await query<{ snapshot: { entries: unknown[]; lines: unknown[]; accounts: unknown[] } }>(
      `SELECT jsonb_build_object(
        'entries',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM journal_entries e WHERE organization_id=$1),'[]'::jsonb),
        'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM journal_lines l WHERE organization_id=$1),'[]'::jsonb),
        'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM accounts a WHERE organization_id=$1),'[]'::jsonb)) AS snapshot`,
      [org],
    );
    return {
      hash: createHash('sha256').update(JSON.stringify(row.snapshot)).digest('hex'),
      entries: row.snapshot.entries.length,
      lines: row.snapshot.lines.length,
      accounts: row.snapshot.accounts.length,
      balances: (await accounts(org, '2026-09-30')).map(({ code, balance }) => ({ code, balance })),
    };
  }
  const before = await fingerprint();
  expect(before).toMatchObject({ entries: 7, lines: 14, accounts: 22 });
  const result = (await financialChat(org, messages, { route: 'complete' })) as unknown as {
    facts: AnalysisFacts[];
    evidence: InsightEvidence[];
    completion: CompletionAssessment;
    answerContract: { contract: AnswerContract };
    outputBindings: OutputBinding[];
  };
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.facts).toHaveLength(1);
  expect(result.facts[0]).toMatchObject({
    queryId: 'q1',
    rows: [{ rowId: 'total:total', value: '165.00' }],
    scope: { organizationId: org, resolvedAccountIds: [ids['5030']], plan: capturedArgs.queries[0] },
  });
  expect(result.answerContract.contract.outputs).toEqual(capturedArgs.answerContract);
  expect(result.answerContract.contract.outputs[0].sourceQuotes).toEqual([
    { messageIndex: 2, quote: messages[2].content },
  ]);
  expect(result.outputBindings).toEqual(capturedArgs.outputBindings);
  expect(result.completion).toMatchObject({
    status: 'fulfilled',
    completionBasis: 'model_declared',
    userIntentVerified: false,
    outputs: [{ outputId: 'repair_parts_august', status: 'fulfilled' }],
  });
  expect(result.completion.outputs[0].evidence.length).toBeGreaterThan(0);
  for (const location of result.completion.outputs[0].evidence) {
    const table = result.evidence[location.tableIndex];
    expect(table.source).toBe('posted');
    expect(table.rows[location.rowIndex!]).toMatchObject({
      value: '$165.00',
      factRef: capturedArgs.outputBindings[0].source,
    });
  }
  expect(result).not.toHaveProperty('limitation');
  expect(await fingerprint()).toEqual(before);
});
