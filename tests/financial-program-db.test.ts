import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { accounts, createEntry } from '../server/ledger';
import { executeFinancialProgram } from '../server/financial-program';
import type { FinancialQuery } from '../server/financial-analysis';
import { seedChart } from '../scripts/seed';
import type { EntryInput } from '../shared/schema';

// Real PostgreSQL postings, query compiler and isolated generated computation.
// Programs are scripted: these tests do not measure a model's interpretation.
// All expected cents and fractions were specified independently of product code.
const admin = new pg.Client({
  connectionString: config.migrationUrl,
  connectionTimeoutMillis: 2000,
});
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
    if (!local && !compose) throw new Error('Financial program tests require isolated local/CI PostgreSQL.');
  }
  try {
    await admin.connect();
    connected = true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      process.env.CI ||
      process.env.FINANCIAL_PROGRAM_DB_REQUIRED === '1' ||
      !['ECONNREFUSED', 'ETIMEDOUT', 'EPERM', 'EACCES'].includes(code ?? '')
    )
      throw error;
    console.warn('Financial program database cases skipped: isolated local PostgreSQL is unavailable.');
  }
});
beforeEach(async (context) => {
  if (!connected) context.skip();
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Generated analysis fixture')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
});
afterAll(async () => {
  if (connected) await admin.end();
  await pool.end();
});

function journal(
  debit: string,
  credit: string,
  amount: string,
  date: string,
  counterparty = 'Fixture merchant',
  accountIds = ids,
): EntryInput {
  return {
    date,
    counterparty,
    description: 'Independent generated-analysis fixture',
    reference: '',
    source: 'MANUAL',
    lines: [
      { accountId: accountIds[debit], debit: amount, credit: '0', exchangeRate: '1', memo: '' },
      { accountId: accountIds[credit], debit: '0', credit: amount, exchangeRate: '1', memo: '' },
    ],
  };
}
const post = (input: EntryInput) => createEntry(org, input, randomUUID(), { post: true });
function plan(changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id: 'expenses',
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2025-01-01',
    to: '2025-12-31',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: 'month',
    accountCodes: [],
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

async function fingerprint(organizations = [org]) {
  const [row] = await query<{ snapshot: unknown }>(
    `SELECT jsonb_build_object(
      'entries',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id)
        FROM journal_entries e WHERE organization_id=ANY($1::uuid[])),'[]'::jsonb),
      'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id)
        FROM journal_lines l WHERE organization_id=ANY($1::uuid[])),'[]'::jsonb),
      'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id)
        FROM accounts a WHERE organization_id=ANY($1::uuid[])),'[]'::jsonb)) AS snapshot`,
    [organizations],
  );
  return createHash('sha256').update(JSON.stringify(row.snapshot)).digest('hex');
}
async function run(queries: FinancialQuery[], code: string, organizations = [org]) {
  const before = await fingerprint(organizations);
  try {
    return await executeFinancialProgram(org, { queries, code });
  } finally {
    expect(await fingerprint(organizations)).toBe(before);
  }
}

// Month, Rent, Software, Marketing. Each nonzero cell becomes one balanced entry.
// Net totals:0,200,400,100,400,-100,0,0,300,500,50,200; total2050.
// Rent totals1200. The three zero denominators include an offsetting-refund month.
const annualRows = [
  ['01', 0, 0, 0],
  ['02', 100, 50, 50],
  ['03', 100, 100, 200],
  ['04', 100, 0, 0],
  ['05', 200, 100, 100],
  ['06', 100, -200, 0],
  ['07', 0, 0, 0],
  ['08', 100, -100, 0],
  ['09', 100, 50, 150],
  ['10', 200, 100, 200],
  ['11', 100, -50, 0],
  ['12', 100, 50, 50],
] as const;
async function annualFixture() {
  for (const [month, rent, software, marketing] of annualRows) {
    for (const [code, amount] of [
      ['5010', rent],
      ['5020', software],
      ['5040', marketing],
    ] as const) {
      if (!amount) continue;
      await post(
        journal(
          amount > 0 ? code : '1010',
          amount > 0 ? '1010' : code,
          String(Math.abs(amount)),
          `2025-${month}-15`,
        ),
      );
    }
  }
}
const rentAndExpenses = () => [plan({ id: 'rent', accountCodes: ['5010'] }), plan()];
const monthlyShares = `
  const rent = tables.find(t => t.id === 'rent');
  const expenses = tables.find(t => t.id === 'expenses');
  return [{title: 'Monthly rent share', rows: calc.align(rent.rows, expenses.rows).map(({left, right}) => ({
    label: left.label, value: calc.div(left.value, right.value), format: 'percent'
  }))}];
`;

describe('Generated financial programs against actual PostgreSQL', () => {
  it('computes all twelve monthly percentages, preserving quiet months and signed refunds', async () => {
    await annualFixture();
    const result = await run(rentAndExpenses(), monthlyShares);
    const rows = result.program.tables[0].rows;
    expect(rows.map((row) => row.value)).toEqual([
      'Not available — denominator is zero',
      '50.00%',
      '25.00%',
      '100.00%',
      '50.00%',
      '-100.00%',
      'Not available — denominator is zero',
      'Not available — denominator is zero',
      '33.33%',
      '40.00%',
      '200.00%',
      '50.00%',
    ]);
    expect(rows.map((row) => row.label)).toEqual(annualRows.map(([month]) => `2025-${month}`));
    expect(rows[8].exact).toEqual({ numerator: '1', denominator: '3' });
    expect(rows[5].exact).toEqual({ numerator: '-1', denominator: '1' });
    expect(rows[10].exact).toEqual({ numerator: '2', denominator: '1' });
    for (const index of [0, 6, 7])
      expect(rows[index]).toMatchObject({ exact: null, reason: 'zero_denominator' });
    for (let index = 0; index < rows.length; index++) {
      expect(rows[index].source).toBe('posted');
      expect(rows[index].references).toEqual([
        { queryId: 'rent', rowId: `month:2025-${annualRows[index][0]}` },
        { queryId: 'expenses', rowId: `month:2025-${annualRows[index][0]}` },
      ]);
    }
    expect(result.evidence[0].rows.map((row) => row.value)).toEqual(rows.map((row) => row.value));
    expect(result.program.interpretationVerified).toBe(false);
  });

  it('preserves exact account, counterparty, date, organization and posted scope', async () => {
    await post(journal('5010', '1010', '100', '2026-01-15', 'Acme'));
    await post(journal('5010', '1010', '70', '2026-01-15', 'Other'));
    await post(journal('5020', '1010', '50', '2026-01-15', 'Acme'));
    await post(journal('5010', '1010', '30', '2026-02-01', 'Acme'));
    await post(journal('1010', '4010', '999', '2026-01-15', 'Acme'));
    await createEntry(org, journal('5010', '1010', '900', '2026-01-15', 'Acme'), randomUUID());
    const otherOrg = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Other analysis workspace')", [otherOrg]);
    await seedChart(otherOrg);
    const otherIds = Object.fromEntries(
      (await accounts(otherOrg)).map((account) => [account.code, account.id]),
    );
    await createEntry(
      otherOrg,
      journal('5010', '1010', '888', '2026-01-15', 'Acme', otherIds),
      randomUUID(),
      { post: true },
    );
    const dates = { from: '2026-01-01', to: '2026-01-31', groupBy: 'total' as const };
    const result = await run(
      [
        plan({
          ...dates,
          id: 'rent',
          accountCodes: ['5010'],
          counterparty: { mode: 'exact', value: 'Acme' },
        }),
        plan(dates),
      ],
      `const numerator = tables.find(t => t.id === 'rent').rows[0].value;
       const denominator = tables.find(t => t.id === 'expenses').rows[0].value;
       return [{title:'Scoped share',rows:[
         {label:'Acme rent',value:numerator,format:'money'},
         {label:'All expenses',value:denominator,format:'money'},
         {label:'Share',value:calc.div(numerator,denominator),format:'percent'}
       ]}];`,
      [org, otherOrg],
    );
    expect(result.program.tables[0].rows.map((row) => row.value)).toEqual(['$100.00', '$220.00', '45.45%']);
    expect(result.program.tables[0].rows[2].exact).toEqual({ numerator: '5', denominator: '11' });
    expect(result.facts[0].scope).toMatchObject({
      organizationId: org,
      resolvedAccountIds: [ids['5010']],
      plan: { ...dates, status: 'POSTED', counterparty: { mode: 'exact', value: 'Acme' } },
    });
    expect(result.facts.every((fact) => fact.scope.organizationId === org && !fact.truncated)).toBe(true);
  });

  it('distinguishes a weighted annual share from the mean of defined monthly shares', async () => {
    await annualFixture();
    const result = await run(
      rentAndExpenses(),
      `const rent = tables.find(t => t.id === 'rent').rows;
       const expenses = tables.find(t => t.id === 'expenses').rows;
       const shares = calc.align(rent,expenses).map(({left,right}) => calc.div(left.value,right.value));
       return [{title:'Two distinct summaries',rows:[
         {label:'Annual share',value:calc.div(calc.sum(rent.map(r=>r.value)),calc.sum(expenses.map(r=>r.value))),format:'percent'},
         {label:'Mean defined monthly share',value:calc.mean(shares.filter(v=>!calc.isNull(v))),format:'percent'}
       ]}];`,
    );
    expect(result.program.tables[0].rows.map((row) => row.value)).toEqual(['58.54%', '49.81%']);
    expect(result.program.tables[0].rows.map((row) => row.exact)).toEqual([
      { numerator: '24', denominator: '41' },
      { numerator: '269', denominator: '540' },
    ]);
  });

  it('composes a median and cumulative totals from complete calendar-month records', async () => {
    await annualFixture();
    const result = await run(
      [plan()],
      `const rows = [...tables[0].rows].sort((a,b)=>a.id.localeCompare(b.id));
       return [
         {title:'Monthly median',rows:[{label:'Median',value:calc.median(rows.map(r=>r.value)),format:'money'}]},
         {title:'Cumulative spending',rows:rows.map((row,index)=>({
           label:row.label,value:calc.sum(rows.slice(0,index+1).map(r=>r.value)),format:'money'
         }))}
       ];`,
    );
    expect(result.program.tables[0].rows[0]).toMatchObject({
      value: '$150.00',
      exact: { numerator: '150', denominator: '1' },
    });
    expect(result.program.tables[1].rows.map((row) => row.value)).toEqual([
      '$0.00',
      '$200.00',
      '$600.00',
      '$700.00',
      '$1,100.00',
      '$1,000.00',
      '$1,000.00',
      '$1,000.00',
      '$1,300.00',
      '$1,800.00',
      '$1,850.00',
      '$2,050.00',
    ]);
    expect(result.program.tables[1].rows[11].references).toHaveLength(12);
  });

  it('ranks generated results and computes a different period comparison without a named formula', async () => {
    await annualFixture();
    const result = await run(
      [plan(), plan({ id: 'quarters', groupBy: 'quarter' })],
      `const months=tables.find(t=>t.id==='expenses').rows;
       const quarters=tables.find(t=>t.id==='quarters').rows;
       const first=quarters.find(r=>r.id==='quarter:2025-Q1').value;
       const last=quarters.find(r=>r.id==='quarter:2025-Q4').value;
       const ranked=[...months].sort((a,b)=>calc.compare(b.value,a.value)||a.id.localeCompare(b.id)).slice(0,3);
       return [
         {title:'Top expense months',rows:ranked.map(r=>({label:r.label,value:r.value,format:'money'}))},
         {title:'Quarter growth',rows:[{label:'Q1 to Q4',value:calc.div(calc.sub(last,first),first),format:'percent'}]}
       ];`,
    );
    expect(result.program.tables[0].rows.map((row) => [row.label, row.value])).toEqual([
      ['2025-10', '$500.00'],
      ['2025-03', '$400.00'],
      ['2025-05', '$400.00'],
    ]);
    expect(result.program.tables[1].rows[0]).toMatchObject({
      value: '25.00%',
      exact: { numerator: '1', denominator: '4' },
    });
  });

  it('rejects a truncated source table instead of silently calculating a partial year', async () => {
    await post(journal('5010', '1010', '100', '2025-02-15'));
    await expect(
      run(
        [plan({ limit: 8 })],
        `return [{title:'Wrong partial total',rows:[{
        label:'Total',value:calc.sum(tables[0].rows.map(r=>r.value)),format:'money'
      }]}];`,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });
});
