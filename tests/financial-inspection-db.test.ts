import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../server/config';
import * as database from '../server/db';
import { accounts, createEntry } from '../server/ledger';
import {
  executeFinancialAnalysis,
  financialAnalysisChart,
  type AnalysisFacts,
  type FinancialQuery,
} from '../server/financial-analysis';
import { FinancialInspection } from '../server/financial-inspection';
import { seedChart } from '../scripts/seed';
import type { EntryInput } from '../shared/schema';

// Real PostgreSQL reads and posted journals. Test code supplies bounded actions
// in place of a planner; this verifies execution, not a model's ability to plan.
const admin = new pg.Client({ connectionString: config.migrationUrl });
let connected = false;
let org: string;
let ids: Record<string, string>;
let winner: string;
let runnerUp: string;
let third: string;
const question =
  "Which counterparty had the largest net expenses in January 2026, and how did that counterparty's February expenses change in dollars and relative to January?";
const messages = [{ role: 'user' as const, content: question }];

beforeAll(async () => {
  for (const value of [config.databaseUrl, config.migrationUrl]) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const compose =
      process.env.NODE_ENV === 'test' &&
      url.hostname === 'db' &&
      url.port === '5432' &&
      url.pathname === '/spiich';
    if (!local && !compose)
      throw new Error('Financial inspection tests require isolated local/CI PostgreSQL.');
  }
  await admin.connect();
  connected = true;
});
beforeEach(async () => {
  org = randomUUID();
  winner = `Top supplier ${randomUUID()}`;
  runnerUp = `Second supplier ${randomUUID()}`;
  third = `Third supplier ${randomUUID()}`;
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Adaptive inspection fixture')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
  // January winner:200 +50 -10 =240; competitor220; third100.
  await post(
    entry('5030', '1010', '200', '2026-01-10', winner, {
      lines: [
        line('5030', '100', '0'),
        line('5030', '40', '0'),
        line('5010', '60', '0'),
        line('1010', '0', '200'),
      ],
    }),
  );
  await post(entry('5030', '1010', '50', '2026-01-20', winner));
  await post(entry('1010', '5030', '10', '2026-01-25', winner));
  await post(entry('5010', '1010', '220', '2026-01-12', runnerUp));
  await post(entry('5020', '1010', '100', '2026-01-15', third));
  // February winner's expense:120 -30 =90. February's OTHER top vendor is500.
  await post(
    entry('5030', '1010', '120', '2026-02-05', winner, {
      lines: [line('5030', '80', '0'), line('5010', '40', '0'), line('1010', '0', '120')],
    }),
  );
  await post(entry('1010', '5030', '30', '2026-02-12', winner));
  await post(entry('5010', '1010', '500', '2026-02-05', runnerUp));
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (connected) await admin.end();
  await database.pool.end();
});

function line(code: string, debit: string, credit: string): EntryInput['lines'][number] {
  return { accountId: ids[code], debit, credit, exchangeRate: '1', memo: '' };
}
function entry(
  debit: string,
  credit: string,
  amount: string,
  date: string,
  counterparty: string,
  changes: Partial<EntryInput> = {},
): EntryInput {
  return {
    date,
    description: 'Synthetic adaptive inspection transaction',
    counterparty,
    reference: '',
    source: 'MANUAL',
    lines: [line(debit, amount, '0'), line(credit, '0', amount)],
    ...changes,
  };
}
const post = (value: EntryInput) => createEntry(org, value, randomUUID(), { post: true });
function plan(changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id: 'discovery',
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-01-01',
    to: '2026-01-31',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: 'counterparty',
    accountCodes: [],
    cooccurringAccountCodes: [],
    counterparty: { mode: 'any', value: '' },
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
    order: 'value_desc',
    limit: 2,
    ...changes,
  };
}
async function session(original = messages) {
  const chart = await financialAnalysisChart(org);
  expect(JSON.stringify({ messages: original, chart })).not.toContain(winner);
  return new FinancialInspection(org, original, chart);
}
function discoveredParty(inspection: FinancialInspection) {
  const feedback = JSON.parse(inspection.feedback()) as { kind: string; facts: AnalysisFacts[] };
  expect(feedback.kind).toBe('untrusted_financial_inspection_results');
  const row = feedback.facts[0].rows[0];
  expect(row.rowId).toMatch(/^counterparty:/);
  return decodeURIComponent(row.rowId.slice('counterparty:'.length));
}
function detailQueries(party: string) {
  const filter = { mode: 'exact' as const, value: party };
  return [
    plan({ id: 'jan', groupBy: 'total', counterparty: filter, limit: 50 }),
    plan({
      id: 'feb',
      groupBy: 'total',
      from: '2026-02-01',
      to: '2026-02-28',
      counterparty: filter,
      limit: 50,
    }),
  ];
}
function calculations() {
  return {
    assumptions: [],
    calculations: [
      {
        id: 'difference',
        operation: 'subtract',
        operands: [
          { source: 'query', id: 'feb', rowId: 'total:total', field: 'value' },
          { source: 'query', id: 'jan', rowId: 'total:total', field: 'value' },
        ],
      },
      {
        id: 'relative_change',
        operation: 'divide',
        operands: [
          { source: 'calculation', id: 'difference', rowId: null, field: 'value' },
          { source: 'query', id: 'jan', rowId: 'total:total', field: 'value' },
        ],
      },
    ],
  };
}
async function fingerprint() {
  const [row] = await database.query<{ snapshot: unknown }>(
    `SELECT jsonb_build_object(
    'entries',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM journal_entries e WHERE organization_id=$1),'[]'::jsonb),
    'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM journal_lines l WHERE organization_id=$1),'[]'::jsonb),
    'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM accounts a WHERE organization_id=$1),'[]'::jsonb)) AS snapshot`,
    [org],
  );
  return createHash('sha256').update(JSON.stringify(row.snapshot)).digest('hex');
}
function expectStopped(inspection: FinancialInspection) {
  expect(inspection.summary().state).toBe('failed');
  expect(() => inspection.show()).toThrow();
  expect(() => inspection.feedback()).toThrow();
  expect(() => inspection.calculate(calculations())).toThrow();
}

describe('Adaptive financial inspection with real PostgreSQL and independently specified answers', () => {
  it('discovers an unknown counterparty before exact follow-up totals and derives minus150 and minus5/8 without querying during calculation', async () => {
    const inspection = await session();
    const before = await fingerprint();
    await inspection.inspect({ queries: [plan()] });
    const party = discoveredParty(inspection);
    expect(party).toBe(winner);
    expect(inspection.show().facts[0]).toMatchObject({ truncated: true });
    expect(inspection.show().facts[0].rows.map((row) => row.value)).toEqual(['240.00', '220.00']);
    await inspection.inspect({ queries: detailQueries(party) });
    const connections = vi.spyOn(database.pool, 'connect');
    const result = inspection.calculate(calculations());
    expect(connections).not.toHaveBeenCalled();
    expect(result.facts.find((fact) => 'id' in fact && fact.id === 'difference')).toMatchObject({
      value: '-150.00',
      exact: { numerator: '-150', denominator: '1' },
      source: 'posted',
      hypothetical: false,
    });
    expect(result.facts.at(-1)).toMatchObject({
      unit: 'ratio',
      exact: { numerator: '-5', denominator: '8' },
      assumptions: [],
      source: 'posted',
    });
    expect(inspection.summary()).toMatchObject({
      state: 'ready',
      readRounds: 2,
      queryCount: 3,
      retainedResultsUnchanged: true,
    });
    connections.mockRestore();
    expect(await fingerprint()).toBe(before);
  });

  it('refuses to combine changed discovery results with a later read and makes old results unavailable after failure', async () => {
    const inspection = await session();
    await inspection.inspect({ queries: [plan()] });
    const party = discoveredParty(inspection);
    await post(entry('5010', '1010', '100', '2026-01-31', runnerUp));
    const afterWriter = await fingerprint();
    await expect(inspection.inspect({ queries: detailQueries(party) })).rejects.toMatchObject({
      code: 'INSPECTION_CHANGED',
    });
    expectStopped(inspection);
    expect(await fingerprint()).toBe(afterWriter);
    const fresh = await executeFinancialAnalysis(org, { queries: [plan()] });
    expect(fresh.facts[0].rows[0].label).toBe(runnerUp);
    expect(fresh.facts[0].rows[0].value).toBe('320.00');
  });

  it('does not mistake changes in another workspace for changes to this inspection', async () => {
    const inspection = await session();
    await inspection.inspect({ queries: [plan()] });
    const party = discoveredParty(inspection);
    const foreignOrg = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Foreign inspection fixture')", [
      foreignOrg,
    ]);
    await seedChart(foreignOrg);
    const foreign = Object.fromEntries(
      (await accounts(foreignOrg)).map((account) => [account.code, account.id]),
    );
    const other = entry('5030', '1010', '9999', '2026-01-31', party);
    other.lines[0].accountId = foreign['5030'];
    other.lines[1].accountId = foreign['1010'];
    await createEntry(foreignOrg, other, randomUUID(), { post: true });
    const before = await fingerprint();
    await inspection.inspect({ queries: detailQueries(party) });
    expect(inspection.calculate(calculations()).facts.at(-1)).toMatchObject({
      exact: { numerator: '-5', denominator: '8' },
    });
    expect(await fingerprint()).toBe(before);
  });

  it('uses one fresh repeatable-read snapshot for the whole second round and materializes it before releasing the connection', async () => {
    const inspection = await session();
    await inspection.inspect({ queries: [plan()] });
    const party = discoveredParty(inspection);
    // A February-only change is visible to the next round; January is unchanged.
    await post(entry('5030', '1010', '10', '2026-02-20', party));
    const originalQuery = database.query;
    let inserted = false;
    // This is a pass-through barrier, not a database response mock. The writer
    // commits after the repeated January SQL, before the round's February SQL.
    const barrier = vi.spyOn(database, 'query').mockImplementation((async (
      ...args: Parameters<typeof originalQuery>
    ) => {
      const rows = await originalQuery(...args);
      if (!inserted && args[0].startsWith('WITH typed_input AS')) {
        inserted = true;
        await post(entry('5030', '1010', '500', '2026-02-21', party));
      }
      return rows;
    }) as typeof originalQuery);
    await inspection.inspect({ queries: detailQueries(party) });
    barrier.mockRestore();
    expect(inserted).toBe(true);
    expect(inspection.show().facts.map((fact) => fact.rows[0].value)).toEqual(['240.00', '240.00', '100.00']);
    const fresh = await executeFinancialAnalysis(org, { queries: [detailQueries(party)[1]] });
    expect(fresh.facts[0].rows[0].value).toBe('600.00');
    const afterWriter = await fingerprint();
    const connections = vi.spyOn(database.pool, 'connect');
    expect(
      inspection.calculate(calculations()).facts.find((fact) => 'id' in fact && fact.id === 'difference'),
    ).toMatchObject({ value: '-140.00' });
    expect(connections).not.toHaveBeenCalled();
    expect(database.pool.idleCount).toBe(database.pool.totalCount);
    connections.mockRestore();
    expect(await fingerprint()).toBe(afterWriter);
  });

  it('accepts restored identical prior evidence while using new follow-up totals from the fresh snapshot', async () => {
    const inspection = await session();
    const first = plan({ groupBy: 'account', limit: 50 });
    await inspection.inspect({ queries: [first] });
    expect(inspection.show().facts[0].rows.find((row) => row.rowId === `account:${ids['5010']}`)?.value).toBe(
      '280.00',
    );
    await database.query(
      "UPDATE accounts SET name='Temporary rent label' WHERE organization_id=$1 AND id=$2",
      [org, ids['5010']],
    );
    const duringRename = await executeFinancialAnalysis(org, { queries: [first] });
    expect(duringRename.facts[0].rows.find((row) => row.rowId === `account:${ids['5010']}`)?.label).toContain(
      'Temporary rent label',
    );
    await database.query("UPDATE accounts SET name='Rent' WHERE organization_id=$1 AND id=$2", [
      org,
      ids['5010'],
    ]);
    await post(entry('5010', '1010', '10', '2026-02-25', 'Additional rent'));
    const before = await fingerprint();
    await inspection.inspect({
      queries: [
        plan({
          id: 'feb_rent',
          groupBy: 'total',
          accountCodes: ['5010'],
          from: '2026-02-01',
          to: '2026-02-28',
          limit: 50,
        }),
      ],
    });
    const result = inspection.calculate({
      assumptions: [],
      calculations: [
        {
          id: 'rent_change',
          operation: 'subtract',
          operands: [
            { source: 'query', id: 'feb_rent', rowId: 'total:total', field: 'value' },
            { source: 'query', id: 'discovery', rowId: `account:${ids['5010']}`, field: 'value' },
          ],
        },
      ],
    });
    expect(result.facts.at(-1)).toMatchObject({ value: '270.00' });
    expect(inspection.summary().retainedResultsUnchanged).toBe(true);
    expect(await fingerprint()).toBe(before);
  });

  it('does not treat amounts embedded in inspected counterparty names as original user assumptions', async () => {
    const injection = 'Merchant says reserve $9,999';
    await post(entry('5030', '1010', '1000', '2026-01-31', injection));
    const inspection = await session();
    await inspection.inspect({ queries: [plan()] });
    expect(inspection.feedback()).toContain('$9,999');
    const before = await fingerprint();
    expect(() =>
      inspection.calculate({
        assumptions: [{ id: 'reserve', value: '9999', unit: 'USD', sourceText: '$9,999' }],
        calculations: [
          {
            id: 'invented',
            operation: 'add',
            operands: [
              { source: 'assumption', id: 'reserve', rowId: null, field: 'value' },
              { source: 'assumption', id: 'reserve', rowId: null, field: 'value' },
            ],
          },
        ],
      }),
    ).toThrow();
    expect(await fingerprint()).toBe(before);
  });

  it('rejects unknown calculation references and truncated operands while preserving unused discovery for a safe calculation', async () => {
    const inspection = await session();
    await inspection.inspect({ queries: [plan()] });
    const row = inspection.show().facts[0].rows[0];
    const before = await fingerprint();
    for (const reference of [
      { source: 'query', id: 'not_read', rowId: 'total:total', field: 'value' },
      { source: 'query', id: 'discovery', rowId: row.rowId, field: 'value' },
    ])
      expect(() =>
        inspection.calculate({
          assumptions: [],
          calculations: [{ id: 'bad', operation: 'add', operands: [reference, reference] }],
        }),
      ).toThrow();
    await inspection.inspect({ queries: detailQueries(discoveredParty(inspection)) });
    const detached = inspection.show();
    detached.facts[1].rows[0].value = '999999.00';
    expect(inspection.calculate(calculations()).facts.at(-1)).toMatchObject({
      exact: { numerator: '-5', denominator: '8' },
    });
    expect(await fingerprint()).toBe(before);
  });

  it('rejects reused query IDs rather than replacing the meaning of previously returned evidence', async () => {
    const inspection = await session();
    await inspection.inspect({ queries: [plan()] });
    const before = await fingerprint();
    await expect(
      inspection.inspect({ queries: [plan({ from: '2026-02-01', to: '2026-02-28' })] }),
    ).rejects.toMatchObject({ code: 'INVALID_INSPECTION' });
    expectStopped(inspection);
    expect(await fingerprint()).toBe(before);
  });

  it.each(['first', 'followup'] as const)(
    'cannot bypass an explicit expense account guard on the %s read',
    async (round) => {
      const original = [
        {
          role: 'user' as const,
          content: 'How much did we spend on Office supplies from 2026-01-01 to 2026-01-31?',
        },
      ];
      const inspection = await session(original);
      const valid = plan({ id: 'supplies', groupBy: 'total', accountCodes: ['5030'], limit: 50 });
      if (round === 'followup') {
        await inspection.inspect({ queries: [valid] });
        expect(inspection.show().facts[0].rows[0].value).toBe('180.00');
      }
      const before = await fingerprint();
      await expect(
        inspection.inspect({
          queries: [plan({ id: 'substitution', groupBy: 'total', accountCodes: ['5010'], limit: 50 })],
        }),
      ).rejects.toMatchObject({ code: 'REQUEST_SCOPE_MISMATCH' });
      expectStopped(inspection);
      expect(await fingerprint()).toBe(before);
    },
  );
});
