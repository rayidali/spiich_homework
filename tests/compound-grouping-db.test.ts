import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { accounts, createEntry, reverseEntry } from '../server/ledger';
import { executeFinancialAnalysis, type FinancialQuery } from '../server/financial-analysis';
import { executeFinancialScenario } from '../server/financial-calculation';
import { seedChart } from '../scripts/seed';
import type { EntryInput } from '../shared/schema';

// These fixtures and expected cents are independent of the query compiler.
// All SQL, posting constraints and calculator execution are real; no model runs.
const admin = new pg.Client({ connectionString: config.migrationUrl });
let connected = false;
let org: string;
let ids: Record<string, string>;

beforeAll(async () => {
  for (const value of [config.databaseUrl, config.migrationUrl]) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const compose =
      process.env.NODE_ENV === 'test' &&
      url.hostname === 'db' &&
      url.port === '5432' &&
      url.pathname === '/spiich';
    if (!local && !compose) throw new Error('Compound grouping tests require isolated local/CI PostgreSQL.');
  }
  await admin.connect();
  connected = true;
});
beforeEach(async () => {
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Compound grouping fixture')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
});
afterAll(async () => {
  if (connected) await admin.end();
  await pool.end();
});

function line(code: string, debit: string, credit: string, exchangeRate = '1'): EntryInput['lines'][number] {
  return { accountId: ids[code], debit, credit, exchangeRate, memo: '' };
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
    counterparty,
    description: 'Synthetic grouped transaction',
    reference: '',
    source: 'MANUAL',
    lines: [line(debit, amount, '0'), line(credit, '0', amount)],
    ...changes,
  };
}
const post = (value: EntryInput) => createEntry(org, value, randomUUID(), { post: true });
function plan(changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id: 'grouped',
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-01-01',
    to: '2026-03-31',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: ['account', 'counterparty', 'month'],
    accountCodes: ['5010', '5030'],
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
// The public row-ID contract, deliberately without importing its implementation.
const rowId = (...dimensions: [string, string][]) => `compound:${JSON.stringify(dimensions)}`;
const triple = (account: string, party: string, month: string) =>
  rowId(['account', account], ['counterparty', party], ['month', month]);
async function fingerprint() {
  const [row] = await query<{ snapshot: unknown }>(
    `SELECT jsonb_build_object(
    'entries',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM journal_entries e WHERE organization_id=$1),'[]'::jsonb),
    'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM journal_lines l WHERE organization_id=$1),'[]'::jsonb),
    'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM accounts a WHERE organization_id=$1),'[]'::jsonb)) AS snapshot`,
    [org],
  );
  return createHash('sha256').update(JSON.stringify(row.snapshot)).digest('hex');
}
async function run(...queries: FinancialQuery[]) {
  const before = await fingerprint();
  const result = await executeFinancialAnalysis(org, { queries });
  expect(await fingerprint()).toBe(before);
  return result;
}
type Result = Awaited<ReturnType<typeof run>>;
const amounts = (result: Result, index = 0) =>
  Object.fromEntries(result.facts[index].rows.map((row) => [row.rowId, row.value]));

async function coreFixture() {
  await post(
    entry('5030', '1010', '200', '2026-01-10', 'Acme', {
      lines: [
        line('5030', '100', '0'),
        line('5030', '40', '0'),
        line('5010', '60', '0'),
        line('1010', '0', '200'),
      ],
    }),
  );
  await post(entry('5030', '1010', '20', '2026-01-20', 'Acme'));
  await post(entry('5010', '1010', '30', '2026-01-25', 'Beta'));
  await post(entry('5030', '1010', '50', '2026-02-10', 'Gamma'));
  await post(entry('1010', '5030', '10', '2026-02-20', 'Acme'));
}

describe('Compound financial grouping against actual PostgreSQL', () => {
  it('groups repeated lines once and zero-fills only observed account and counterparty tuples', async () => {
    await coreFixture();
    const result = await run(plan());
    expect(amounts(result)).toEqual({
      [triple('5030', 'Acme', '2026-01')]: '160.00',
      [triple('5030', 'Acme', '2026-02')]: '-10.00',
      [triple('5030', 'Acme', '2026-03')]: '0.00',
      [triple('5010', 'Acme', '2026-01')]: '60.00',
      [triple('5010', 'Acme', '2026-02')]: '0.00',
      [triple('5010', 'Acme', '2026-03')]: '0.00',
      [triple('5010', 'Beta', '2026-01')]: '30.00',
      [triple('5010', 'Beta', '2026-02')]: '0.00',
      [triple('5010', 'Beta', '2026-03')]: '0.00',
      [triple('5030', 'Gamma', '2026-01')]: '0.00',
      [triple('5030', 'Gamma', '2026-02')]: '50.00',
      [triple('5030', 'Gamma', '2026-03')]: '0.00',
    });
    expect(result.facts[0].grain).toEqual(['account', 'counterparty', 'month']);
    expect(result.facts[0].rows.find((row) => row.rowId === triple('5030', 'Acme', '2026-01'))).toMatchObject(
      {
        entryCount: '2',
        from: '2026-01-01',
        to: '2026-01-31',
        dimensions: [
          { kind: 'account', key: '5030', label: expect.any(String), accountId: ids['5030'] },
          { kind: 'counterparty', key: 'Acme', label: '"Acme"' },
          { kind: 'month', key: '2026-01', label: '2026-01' },
        ],
      },
    );
    expect(result.facts[0].rows.every((row) => !('balanceAsOf' in row))).toBe(true);
    expect(result.facts[0].truncated).toBe(false);
  });

  it('preserves ordered dimensions and unambiguous row identities when the same grouping is reordered', async () => {
    await coreFixture();
    const result = await run(
      plan({ groupBy: ['account', 'counterparty'] }),
      plan({ id: 'reordered', groupBy: ['counterparty', 'account'] }),
    );
    expect(amounts(result)).toEqual({
      [rowId(['account', '5030'], ['counterparty', 'Acme'])]: '150.00',
      [rowId(['account', '5010'], ['counterparty', 'Acme'])]: '60.00',
      [rowId(['account', '5010'], ['counterparty', 'Beta'])]: '30.00',
      [rowId(['account', '5030'], ['counterparty', 'Gamma'])]: '50.00',
    });
    const rearranged = Object.fromEntries(
      result.facts[1].rows.map((row) => {
        expect(row.dimensions?.map((dimension) => dimension.kind)).toEqual(['counterparty', 'account']);
        return [
          rowId(['account', row.dimensions![1].key], ['counterparty', row.dimensions![0].key]),
          row.value,
        ];
      }),
    );
    expect(rearranged).toEqual(amounts(result));
    expect(result.facts[0].rows[0].rowId).not.toBe(result.facts[1].rows[0].rowId);
  });

  it('zero-fills the full account scope for account and month grouping, including unused and archived descendants', async () => {
    await coreFixture();
    await query('UPDATE accounts SET archived=true WHERE organization_id=$1 AND id=$2', [org, ids['5030']]);
    const result = await run(plan({ groupBy: ['month', 'account'], accountCodes: ['5000', '5030'] }));
    const codes = ['5010', '5020', '5030', '5040', '5050', '5060', '5090'];
    expect(result.facts[0].rows).toHaveLength(21);
    expect(new Set(result.facts[0].rows.map((row) => row.rowId)).size).toBe(21);
    const values = amounts(result);
    for (const month of ['2026-01', '2026-02', '2026-03']) {
      for (const code of codes) {
        const gold =
          code === '5010' && month === '2026-01'
            ? '90.00'
            : code === '5030' && month === '2026-01'
              ? '160.00'
              : code === '5030' && month === '2026-02'
                ? '40.00'
                : '0.00';
        expect(values[rowId(['month', month], ['account', code])]).toBe(gold);
      }
    }
  });

  it('averages distinct transactions within each vendor and month and leaves empty-period averages undefined', async () => {
    await coreFixture();
    const result = await run(plan({ groupBy: ['counterparty', 'month'], aggregation: 'average_per_entry' }));
    expect(result.facts[0].rows).toHaveLength(9);
    const jan = result.facts[0].rows.find(
      (row) => row.rowId === rowId(['counterparty', 'Acme'], ['month', '2026-01']),
    )!;
    expect(jan).toMatchObject({ value: '110.00', entryCount: '2' });
    const feb = result.facts[0].rows.find(
      (row) => row.rowId === rowId(['counterparty', 'Acme'], ['month', '2026-02']),
    )!;
    expect(feb).toMatchObject({ value: '-10.00', entryCount: '1' });
    const empty = result.facts[0].rows.find(
      (row) => row.rowId === rowId(['counterparty', 'Gamma'], ['month', '2026-01']),
    )!;
    expect(empty).toMatchObject({ value: null, entryCount: '0' });
    expect(result.evidence[0].rows.some((row) => row.value === 'No matching transactions')).toBe(true);
  });

  it('keeps full journal debit totals and distinct counts separate from filtered expense-line totals', async () => {
    await coreFixture();
    const basis = { accountCodes: ['5030'], groupBy: ['counterparty', 'month'] as FinancialQuery['groupBy'] };
    const result = await run(
      plan({ ...basis, metric: 'journal_total' }),
      plan({ ...basis, id: 'count', metric: 'journal_count' }),
    );
    expect(amounts(result)).toEqual({
      [rowId(['counterparty', 'Acme'], ['month', '2026-01'])]: '220.00',
      [rowId(['counterparty', 'Acme'], ['month', '2026-02'])]: '10.00',
      [rowId(['counterparty', 'Acme'], ['month', '2026-03'])]: '0.00',
      [rowId(['counterparty', 'Gamma'], ['month', '2026-01'])]: '0.00',
      [rowId(['counterparty', 'Gamma'], ['month', '2026-02'])]: '50.00',
      [rowId(['counterparty', 'Gamma'], ['month', '2026-03'])]: '0.00',
    });
    expect(result.facts[1].rows.map((row) => row.value).sort()).toEqual(['0', '0', '0', '1', '1', '2']);
    expect(result.facts[1].unit).toBe('count');
  });

  it('qualifies entire entries before constructing observed tuples and does not apply thresholds to individual cells', async () => {
    await coreFixture();
    const result = await run(plan({ minimumAmount: '100', maximumAmount: '200' }));
    expect(amounts(result)).toEqual({
      [triple('5030', 'Acme', '2026-01')]: '140.00',
      [triple('5030', 'Acme', '2026-02')]: '0.00',
      [triple('5030', 'Acme', '2026-03')]: '0.00',
      [triple('5010', 'Acme', '2026-01')]: '60.00',
      [triple('5010', 'Acme', '2026-02')]: '0.00',
      [triple('5010', 'Acme', '2026-03')]: '0.00',
    });
    expect(result.facts[0].rows.filter((row) => row.value !== '0.00').map((row) => row.entryCount)).toEqual([
      '1',
      '1',
    ]);
  });

  it('distinguishes blank counterparties from the display placeholder and preserves quotes and delimiters as data', async () => {
    const hostile = "A · B/%_'); DROP TABLE journal_entries; --";
    await post(entry('5030', '1010', '10', '2026-01-10', ''));
    await post(entry('5030', '1010', '20', '2026-01-10', '(No counterparty)'));
    await post(entry('5030', '1010', '30', '2026-01-10', hostile));
    const result = await run(
      plan({ groupBy: ['counterparty', 'account'] }),
      plan({
        id: 'literal',
        groupBy: ['counterparty', 'month'],
        counterparty: { mode: 'contains', value: '%_' },
      }),
    );
    expect(amounts(result)).toEqual({
      [rowId(['counterparty', ''], ['account', '5030'])]: '10.00',
      [rowId(['counterparty', '(No counterparty)'], ['account', '5030'])]: '20.00',
      [rowId(['counterparty', hostile], ['account', '5030'])]: '30.00',
    });
    expect(new Set(result.facts[0].rows.map((row) => row.rowId)).size).toBe(3);
    expect(result.facts[1].rows).toHaveLength(3);
    expect(result.facts[1].rows.every((row) => row.dimensions?.[0].key === hostile)).toBe(true);
  });

  it('preserves explicit dates, draft status and tenant boundaries while returning no unobserved vendor tuples', async () => {
    await post(entry('5030', '1010', '10', '2026-01-31', 'Acme'));
    await post(entry('5030', '1010', '20', '2026-02-01', 'Acme'));
    await post(entry('5030', '1010', '500', '2026-01-14', 'Outside dates'));
    await createEntry(org, entry('5030', '1010', '999', '2026-01-31', 'Draft vendor'), randomUUID());
    const foreignOrg = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Foreign grouping fixture')", [
      foreignOrg,
    ]);
    await seedChart(foreignOrg);
    const foreign = Object.fromEntries(
      (await accounts(foreignOrg)).map((account) => [account.code, account.id]),
    );
    const other = entry('5030', '1010', '777', '2026-01-31', 'Foreign vendor');
    other.lines[0].accountId = foreign['5030'];
    other.lines[1].accountId = foreign['1010'];
    await createEntry(foreignOrg, other, randomUUID(), { post: true });
    const range = { from: '2026-01-15', to: '2026-02-10' };
    const result = await run(
      plan({ ...range, groupBy: ['month', 'counterparty'] }),
      plan({ ...range, id: 'draft', groupBy: ['month', 'counterparty'], status: 'DRAFT' }),
    );
    expect(result.facts[0].rows.map((row) => [row.value, row.from, row.to])).toEqual([
      ['10.00', '2026-01-15', '2026-01-31'],
      ['20.00', '2026-02-01', '2026-02-10'],
    ]);
    expect(result.facts[0].rows.every((row) => row.dimensions?.[1].key === 'Acme')).toBe(true);
    expect(result.facts[1].rows.map((row) => row.value)).toEqual(['999.00', '0.00']);
    expect(result.facts[1].rows.every((row) => row.dimensions?.[1].key === 'Draft vendor')).toBe(true);
    expect(result.evidence[1].source).toBe('draft');
  });

  it('groups native currency and saved base values separately and periodizes reversals without losing quiet buckets', async () => {
    ids['5070'] = (
      await query<{ id: string }>(
        "INSERT INTO accounts(organization_id,code,name,type,currency,parent_id) VALUES($1,'5070','Euro expense','EXPENSE','EUR',$2) RETURNING id",
        [org, ids['5000']],
      )
    )[0].id;
    const original = await post(
      entry('5070', '1010', '10.01', '2026-03-31', 'Euro vendor', {
        lines: [line('5070', '10.01', '0', '1.2345'), line('1010', '0', '12.36')],
      }),
    );
    await reverseEntry(org, original.id, '2026-04-01', randomUUID());
    await post(entry('5030', '1010', '100', '2026-03-31', 'Euro vendor'));
    const range = {
      from: '2026-03-10',
      to: '2026-05-15',
      accountCodes: ['5070'],
      groupBy: ['account', 'month'] as FinancialQuery['groupBy'],
    };
    const result = await run(
      plan({ ...range, currencyMode: 'native', currency: 'EUR' }),
      plan({ ...range, id: 'base' }),
      plan({ ...range, id: 'closing', metric: 'account_balance', currencyMode: 'native', currency: 'EUR' }),
    );
    expect(result.facts[0].rows.map((row) => row.value)).toEqual(['10.01', '-10.01', '0.00']);
    expect(result.facts[1].rows.map((row) => row.value)).toEqual(['12.36', '-12.36', '0.00']);
    expect(result.facts[2].rows.map((row) => [row.value, row.balanceAsOf])).toEqual([
      ['10.01', '2026-03-31'],
      ['0.00', '2026-04-30'],
      ['0.00', '2026-05-15'],
    ]);
    expect(result.facts[0]).toMatchObject({ unit: 'EUR', currency: 'EUR' });
    expect(result.facts[0].rows[0]).toMatchObject({ from: '2026-03-10', to: '2026-03-31' });
    expect(result.facts[0].rows.every((row) => !('balanceAsOf' in row))).toBe(true);
  });

  it('computes each mixed-type account closing balance from inception for month and quarter dimensions', async () => {
    await post(entry('1010', '3010', '100', '1899-12-31', 'Owner'));
    await post(entry('1200', '2010', '50', '2026-01-01', 'Equipment supplier'));
    await post(entry('5030', '1010', '20', '2026-03-10', 'Supplies'));
    await post(entry('2010', '1010', '10', '2026-03-15', 'Equipment supplier'));
    await post(entry('1010', '3010', '5', '2026-04-15', 'Owner'));
    const basis = {
      metric: 'account_balance' as const,
      accountCodes: ['1010', '2010'],
      from: '2026-02-10',
      to: '2026-05-15',
    };
    const result = await run(
      plan({ ...basis, groupBy: ['month', 'account'] }),
      plan({ ...basis, id: 'quarter', groupBy: ['account', 'quarter'] }),
    );
    expect(amounts(result)).toEqual({
      [rowId(['month', '2026-02'], ['account', '1010'])]: '100.00',
      [rowId(['month', '2026-02'], ['account', '2010'])]: '50.00',
      [rowId(['month', '2026-03'], ['account', '1010'])]: '70.00',
      [rowId(['month', '2026-03'], ['account', '2010'])]: '40.00',
      [rowId(['month', '2026-04'], ['account', '1010'])]: '75.00',
      [rowId(['month', '2026-04'], ['account', '2010'])]: '40.00',
      [rowId(['month', '2026-05'], ['account', '1010'])]: '75.00',
      [rowId(['month', '2026-05'], ['account', '2010'])]: '40.00',
    });
    expect(amounts(result, 1)).toEqual({
      [rowId(['account', '1010'], ['quarter', '2026-Q1'])]: '70.00',
      [rowId(['account', '1010'], ['quarter', '2026-Q2'])]: '75.00',
      [rowId(['account', '2010'], ['quarter', '2026-Q1'])]: '40.00',
      [rowId(['account', '2010'], ['quarter', '2026-Q2'])]: '40.00',
    });
    expect(result.facts[0].rows.every((row) => row.balanceAsOf === row.to)).toBe(true);
    expect(result.facts[0].rows[0]).toMatchObject({ from: '2026-02-10', to: '2026-02-28' });
  });

  it('keeps transfer sides in their actual account and counterparty dimensions without fabricating unused cash pairs', async () => {
    ids['1030'] = (
      await query<{ id: string }>(
        "INSERT INTO accounts(organization_id,code,name,type,currency,parent_id,is_cash) VALUES($1,'1030','Petty cash','ASSET','USD',$2,true) RETURNING id",
        [org, ids['1000']],
      )
    )[0].id;
    await post(entry('1030', '1010', '50', '2026-02-10', 'Internal'));
    const result = await run(plan({ metric: 'net_cash_movement', accountCodes: [] }));
    expect(amounts(result)).toEqual({
      [triple('1010', 'Internal', '2026-01')]: '0.00',
      [triple('1010', 'Internal', '2026-02')]: '-50.00',
      [triple('1010', 'Internal', '2026-03')]: '0.00',
      [triple('1030', 'Internal', '2026-01')]: '0.00',
      [triple('1030', 'Internal', '2026-02')]: '50.00',
      [triple('1030', 'Internal', '2026-03')]: '0.00',
    });
    expect(result.facts[0].scope.cashMovementSource?.accounts.map((account) => account.code)).toEqual([
      '1010',
      '1020',
      '1030',
    ]);
    expect(result.facts[0].rows.some((row) => row.dimensions?.[0].key === '1020')).toBe(false);
  });

  it('calculates from actual compound cash rows while retaining only each operand account and its correct dates', async () => {
    await post(entry('1010', '3010', '100', '2026-02-28', 'Owner'));
    await post(entry('1010', '4010', '20', '2026-03-01', 'Customer'));
    await post(entry('5030', '1010', '5', '2026-03-15', 'Supplier'));
    const before = await fingerprint();
    const stockId = rowId(['account', '1010'], ['month', '2026-02']);
    const movementId = rowId(['account', '1010'], ['month', '2026-03']);
    const result = await executeFinancialScenario(
      org,
      {
        queries: [
          plan({
            id: 'opening',
            metric: 'cash_balance',
            accountCodes: [],
            groupBy: ['account', 'month'],
            from: '2026-02-01',
            to: '2026-02-28',
          }),
          plan({
            id: 'movement',
            metric: 'net_cash_movement',
            accountCodes: [],
            groupBy: ['account', 'month'],
            from: '2026-03-01',
            to: '2026-03-31',
          }),
        ],
        assumptions: [],
        calculations: [
          {
            id: 'closing',
            operation: 'add',
            operands: [
              { source: 'query', id: 'opening', rowId: stockId, field: 'value' },
              { source: 'query', id: 'movement', rowId: movementId, field: 'value' },
            ],
          },
        ],
      },
      [
        {
          role: 'user',
          content:
            'Add the Operating bank closing balance in February to its net cash movement in March 2026.',
        },
      ],
    );
    expect(await fingerprint()).toBe(before);
    expect(result.facts.at(-1)).toMatchObject({
      value: '115.00',
      exact: { numerator: '115', denominator: '1' },
      source: 'posted',
      hypothetical: false,
      cashSources: [{ queryId: 'opening', rowId: stockId, asOf: '2026-02-28', accountIds: [ids['1010']] }],
      cashMovementSources: [
        {
          queryId: 'movement',
          rowId: movementId,
          from: '2026-03-01',
          to: '2026-03-31',
          accountIds: [ids['1010']],
        },
      ],
    });
  });

  it('applies a global display limit after complete grouping rather than a separate limit per tuple', async () => {
    await coreFixture();
    const result = await run(plan({ order: 'value_desc', limit: 3 }));
    expect(result.facts[0].rows.map((row) => row.value)).toEqual(['160.00', '60.00', '50.00']);
    expect(result.facts[0].rows).toHaveLength(3);
    expect(result.facts[0].truncated).toBe(true);
    expect(result.answer).toContain('not the complete results');
  });

  it('rejects an oversized generated universe even when the requested display limit is one', async () => {
    const codes = ['5010', '5020', '5030', '5040', '5050', '5060', '5090'];
    // 36 observed vendors ×7 real account pairs ×120 months =30,240 cells.
    // Only36 balanced entries are needed; no direct mutation of posted history.
    for (let index = 0; index < 36; index++)
      await post(
        entry('5030', '1010', '7', '2026-03-15', `Vendor ${index}`, {
          lines: [...codes.map((code) => line(code, '1', '0')), line('1010', '0', '7')],
        }),
      );
    const before = await fingerprint();
    await expect(
      executeFinancialAnalysis(org, {
        queries: [plan({ accountCodes: ['5000'], from: '2017-01-01', to: '2026-12-31', limit: 1 })],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_SCOPE' });
    expect(await fingerprint()).toBe(before);
  });
});
