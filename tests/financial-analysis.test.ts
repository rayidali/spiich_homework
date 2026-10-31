import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { accounts, createEntry, reverseEntry } from '../server/ledger';
import { seedChart } from '../scripts/seed';
import {
  compileFinancialQuery,
  executeFinancialAnalysis,
  financialAnalysisChart,
  financialAnalysisSchema,
  financialAnalysisTool,
  type AnalysisAccount,
  type FinancialQuery,
} from '../server/financial-analysis';
import type { EntryInput } from '../shared/schema';

function plan(change: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id: 'analysis',
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-03-01',
    to: '2026-03-31',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: 'total',
    accountCodes: [],
    cooccurringAccountCodes: [],
    counterparty: { mode: 'any', value: '' },
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
    order: 'label_asc',
    limit: 50,
    ...change,
  };
}
const compilerChart: AnalysisAccount[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    code: '5030',
    name: 'Supplies',
    type: 'EXPENSE',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    archived: false,
    is_cash: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    code: '1010',
    name: 'Bank',
    type: 'ASSET',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    archived: false,
    is_cash: false,
  },
];
describe('Financial analysis compiler (offline)', () => {
  it('binds text, accounts, dates and thresholds without accepting raw SQL or tenant fields', () => {
    const hostile = "O'Reilly %_'); DROP TABLE journal_entries; --";
    const compiled = compileFinancialQuery(
      '00000000-0000-4000-8000-000000000003',
      plan({
        accountCodes: ['5030'],
        cooccurringAccountCodes: ['1010'],
        counterparty: { mode: 'contains', value: hostile },
        descriptionSearch: hostile,
        minimumAmount: '-1.00',
        maximumAmount: '400.00',
      }),
      compilerChart,
    );
    expect(compiled.sql).not.toContain(hostile);
    expect(compiled.sql).not.toContain('400.00');
    expect(compiled.params).toContain(hostile);
    expect(compiled.params).toContain('400.00');
    expect(compiled.sql).toContain('count(DISTINCT m.entry_id)');
    expect(compiled.sql).toContain('co.organization_id=$1');
    expect(() => financialAnalysisSchema.parse({ queries: [{ ...plan(), sql: 'SELECT 1' }] })).toThrow();
    expect(() => financialAnalysisSchema.parse({ queries: [plan()], organizationId: 'other' })).toThrow();
    expect(() =>
      compileFinancialQuery('org', plan({ accountCodes: ["5030' OR true"] }), compilerChart),
    ).toThrow();
  });
  it('refuses unsupported accounting meanings and reversed bounds instead of relaxing filters', () => {
    for (const input of [
      plan({ metric: 'account_balance', accountCodes: ['1010'] }),
      plan({ metric: 'account_balance', accountCodes: ['1010'], from: null, status: 'DRAFT' }),
      plan({ metric: 'account_balance', accountCodes: ['1010'], from: null, groupBy: 'month' }),
      plan({
        metric: 'account_balance',
        accountCodes: ['1010'],
        from: null,
        counterparty: { mode: 'exact', value: 'Vendor' },
      }),
      plan({ metric: 'account_balance', accountCodes: ['1010'], from: null, descriptionSearch: 'deposit' }),
      plan({
        metric: 'account_balance',
        accountCodes: ['1010'],
        from: null,
        cooccurringAccountCodes: ['5030'],
      }),
      plan({
        metric: 'account_balance',
        accountCodes: ['1010'],
        from: null,
        aggregation: 'average_per_entry',
      }),
      plan({ metric: 'journal_total', groupBy: 'account' }),
      plan({ metric: 'journal_count', aggregation: 'average_per_entry' }),
      plan({ accountCodes: ['1010'] }),
      plan({ from: '2026-04-01' }),
      plan({ minimumAmount: '10', maximumAmount: '9' }),
      plan({ counterparty: { mode: 'exact', value: '' } }),
      plan({ groupBy: 'month', from: '2000-01-01' }),
    ])
      expect(() => compileFinancialQuery('org', input, compilerChart)).toThrow();
    expect(() => compileFinancialQuery('org', plan({ accountCodes: ['9999'] }), compilerChart)).toThrow(
      'workspace',
    );
    expect(() =>
      financialAnalysisSchema.parse({ queries: Array.from({ length: 5 }, () => plan()) }),
    ).toThrow();
  });
});

describe('Financial analysis empty group compiler (offline)', () => {
  it('validates empty group identities before treating an empty expansion as zero', () => {
    const groups: AnalysisAccount[] = [
      {
        ...compilerChart[1],
        id: '00000000-0000-4000-8000-000000000004',
        code: '1000',
        name: 'Empty assets',
        is_group: true,
      },
      {
        ...compilerChart[1],
        id: '00000000-0000-4000-8000-000000000005',
        code: '4000',
        name: 'Empty revenue',
        type: 'REVENUE',
        is_group: true,
      },
      {
        ...compilerChart[0],
        id: '00000000-0000-4000-8000-000000000006',
        code: '5000',
        name: 'Empty expenses',
        is_group: true,
      },
    ];
    for (const metric of ['net_expense', 'net_revenue', 'net_profit'] as const)
      expect(() => compileFinancialQuery('org', plan({ metric, accountCodes: ['1000'] }), groups)).toThrow(
        'metric',
      );
    expect(() =>
      compileFinancialQuery(
        'org',
        plan({ metric: 'account_balance', accountCodes: ['1000', '4000'], from: null }),
        groups,
      ),
    ).toThrow('one account type');
    expect(compileFinancialQuery('org', plan({ accountCodes: ['5000'] }), groups).selected).toEqual([]);
  });
});

describe('Financial analysis currency and closing-balance compiler (offline)', () => {
  const euro: AnalysisAccount = {
    ...compilerChart[0],
    id: '00000000-0000-4000-8000-000000000007',
    code: '5070',
    currency: 'EUR',
  };
  it('accepts legacy base arguments but requires an explicit currency basis in the provider grammar', () => {
    const { currencyMode: _mode, currency: _currency, ...legacy } = plan();
    const parsed = financialAnalysisSchema.parse({ queries: [legacy] });
    expect(parsed.queries[0]).toMatchObject({ currencyMode: 'base', currency: null });
    const grammar = JSON.parse(JSON.stringify(financialAnalysisTool.parameters));
    expect(grammar.properties.queries.items.required).toEqual(
      expect.arrayContaining(['currencyMode', 'currency']),
    );
    expect(grammar.properties.queries.items.additionalProperties).toBe(false);
  });
  it('binds one native currency and rejects conflicting currencies and partial full-journal meanings', () => {
    const native = plan({ currencyMode: 'native', currency: 'EUR', accountCodes: ['5070'] });
    const compiled = compileFinancialQuery('org', native, [...compilerChart, euro]);
    expect(compiled.params[12]).toBe('EUR');
    expect(compiled.sql).toContain('(l.debit-l.credit) AS amount');
    expect(compiled.sql).toContain('a.currency=$13 AND l.currency=$13');
    expect(compiled.sql).not.toContain("'EUR'");
    for (const input of [
      plan({ currencyMode: 'base', currency: 'USD' }),
      plan({ currencyMode: 'native', currency: null }),
      plan({ currencyMode: 'native', currency: 'EUR', accountCodes: ['5030'] }),
      plan({ currencyMode: 'native', currency: 'EUR', metric: 'journal_total' }),
      plan({ currencyMode: 'native', currency: 'EUR', metric: 'journal_count' }),
    ])
      expect(() => compileFinancialQuery('org', input, [...compilerChart, euro])).toThrow();
    expect(() =>
      compileFinancialQuery('org', { ...native, currency: "EUR' OR true" }, [...compilerChart, euro]),
    ).toThrow();
  });
  it('uses inception history for closing series while retaining bounded display dates and normal types', () => {
    const series = plan({
      metric: 'account_balance',
      accountCodes: ['1010'],
      groupBy: 'month',
      from: '2026-01-15',
      to: '2026-04-10',
    });
    const compiled = compileFinancialQuery('org', series, compilerChart);
    expect(compiled.params[1]).toBe('2026-01-15');
    expect(compiled.sql).not.toContain('e.date >=');
    expect(compiled.sql).toContain('CROSS JOIN LATERAL');
    expect(compiled.sql).toContain('FROM metric_lines m WHERE m.date <= least(');
    expect(compiled.sql).toContain("date_trunc('month',$2::date)");
    for (const change of [
      { accountCodes: ['1010', '5030'] },
      { from: '2010-01-01' },
      { from: null },
      { status: 'DRAFT' as const },
      { minimumAmount: '1' },
      { descriptionSearch: 'opening' },
      { counterparty: { mode: 'exact' as const, value: 'Acme' } },
      { cooccurringAccountCodes: ['5030'] },
    ])
      expect(() => compileFinancialQuery('org', { ...series, ...change }, compilerChart)).toThrow();
  });
});

describe('Financial analysis against real PostgreSQL', () => {
  const admin = new pg.Client({ connectionString: config.migrationUrl });
  let org: string, ids: Record<string, string>;
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
        throw new Error('Financial analysis tests require disposable local/CI PostgreSQL.');
    }
    await admin.connect();
  });
  beforeEach(async () => {
    org = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Composable finance test')", [org]);
    await seedChart(org);
    ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
  });
  afterAll(async () => {
    await admin.end();
    await pool.end();
  });
  function input(debit = '5030', credit = '2100', amount = '340', date = '2026-03-15'): EntryInput {
    return {
      date,
      description: 'Paper supplies purchase',
      counterparty: 'Office Depot',
      reference: '',
      source: 'MANUAL',
      lines: [
        { accountId: ids[debit], debit: amount, credit: '0', exchangeRate: '1', memo: '' },
        { accountId: ids[credit], debit: '0', credit: amount, exchangeRate: '1', memo: '' },
      ],
    };
  }
  const post = (entry = input()) => createEntry(org, entry, randomUUID(), { post: true });
  const run = (...queries: FinancialQuery[]) => executeFinancialAnalysis(org, { queries });
  const value = (result: Awaited<ReturnType<typeof run>>, i = 0) => result.facts[i].rows[0].value;
  async function splitEntry() {
    const entry = input();
    entry.lines = [
      { accountId: ids['5030'], debit: '200', credit: '0', exchangeRate: '1', memo: '' },
      { accountId: ids['5030'], debit: '140', credit: '0', exchangeRate: '1', memo: '' },
      { accountId: ids['5010'], debit: '2400', credit: '0', exchangeRate: '1', memo: '' },
      { accountId: ids['1010'], debit: '0', credit: '1000', exchangeRate: '1', memo: '' },
      { accountId: ids['2100'], debit: '0', credit: '1740', exchangeRate: '1', memo: '' },
    ];
    return post(entry);
  }

  it('distinguishes selected lines, complete journals and distinct counts for repeated-account lines', async () => {
    await splitEntry();
    const result = await run(
      plan({ id: 'supplies', accountCodes: ['5030'] }),
      plan({ id: 'journal', metric: 'journal_total', accountCodes: ['5030'] }),
      plan({ id: 'count', metric: 'journal_count', accountCodes: ['5030'] }),
      plan({ id: 'profit', metric: 'net_profit' }),
    );
    expect(result.facts.map((fact) => fact.rows[0].value)).toEqual(['340.00', '2740.00', '1', '-2740.00']);
    expect(result.facts.map((fact) => fact.rows[0].entryCount)).toEqual(['1', '1', '1', '1']);
    expect(result.facts[2].unit).toBe('count');
    expect(result.facts[0].scope.organizationId).toBe(org);
  });

  it('applies amount bounds to the per-entry measure, not individual lines or displayed groups', async () => {
    await splitEntry();
    const result = await run(
      plan({ id: 'included', accountCodes: ['5030'], minimumAmount: '300.00' }),
      plan({ id: 'excluded', accountCodes: ['5030'], minimumAmount: '400.00' }),
      plan({ id: 'count', metric: 'journal_count', accountCodes: ['5030'], minimumAmount: '2000' }),
      plan({ id: 'too_small', metric: 'journal_count', maximumAmount: '2700' }),
    );
    expect(result.facts.map((fact) => fact.rows[0].value)).toEqual(['340.00', '0.00', '1', '0']);
  });

  it('averages distinct entry amounts rather than lines and labels empty denominators N/A', async () => {
    await splitEntry();
    await post(input('5030', '2100', '100'));
    const result = await run(plan({ accountCodes: ['5030'], aggregation: 'average_per_entry' }));
    expect(value(result)).toBe('220.00');
    expect(result.facts[0].rows[0].entryCount).toBe('2');
    expect(result.answer).toContain('average per transaction');
    const empty = await run(plan({ aggregation: 'average_per_entry', from: '2025-01-01', to: '2025-01-31' }));
    expect(value(empty)).toBeNull();
    expect(empty.evidence[0].rows[0].value).toBe('No matching transactions');
  });

  it('filters literal counterparty/description text and exposes co-occurrence without invented payment allocation', async () => {
    await splitEntry();
    await post({
      ...input('5030', '2100', '999'),
      counterparty: 'Office Depot Annex',
      description: 'Ink supplies purchase',
    });
    await post({
      ...input('5030', '2100', '7'),
      counterparty: "O'Reilly %_",
      description: "quoted ' and %_",
    });
    const result = await run(
      plan({
        id: 'exact',
        accountCodes: ['5030'],
        counterparty: { mode: 'exact', value: 'office depot' },
        descriptionSearch: 'paper',
        cooccurringAccountCodes: ['1010'],
      }),
      plan({ id: 'contains', counterparty: { mode: 'contains', value: 'depot' } }),
      plan({ id: 'literal', counterparty: { mode: 'contains', value: '%_' }, descriptionSearch: "quoted '" }),
    );
    expect(result.facts.map((fact) => fact.rows[0].value)).toEqual(['340.00', '3739.00', '7.00']);
    expect(result.evidence[0].scope).toContain('Also uses at least one of these accounts');
    expect(result.evidence[0].scope).toContain('does not show how the payment was split');
    expect(result.evidence[0].scope).toContain('Description includes');
    expect(result.evidence[0].scope).toContain('Person or business name matches');
  });

  it('zero-fills month/quarter flows and reports clipped boundaries with dated reversals', async () => {
    const original = await post(input('5030', '2100', '100', '2026-03-31'));
    await reverseEntry(org, original.id, '2026-04-01', randomUUID());
    const result = await run(
      plan({ id: 'month', groupBy: 'month', from: '2026-03-10', to: '2026-05-15' }),
      plan({ id: 'quarter', groupBy: 'quarter', from: '2026-02-10', to: '2026-05-15' }),
    );
    expect(result.facts[0].rows.map((row) => [row.rowId, row.value, row.from, row.to])).toEqual([
      ['month:2026-03', '100.00', '2026-03-10', '2026-03-31'],
      ['month:2026-04', '-100.00', '2026-04-01', '2026-04-30'],
      ['month:2026-05', '0.00', '2026-05-01', '2026-05-15'],
    ]);
    expect(result.facts[1].rows.map((row) => [row.rowId, row.value, row.from, row.to])).toEqual([
      ['quarter:2026-Q1', '100.00', '2026-02-10', '2026-03-31'],
      ['quarter:2026-Q2', '-100.00', '2026-04-01', '2026-05-15'],
    ]);
  });

  it('uses all history for balances, including entries before1900, and separates drafts', async () => {
    await post(input('1010', '3010', '10', '1899-12-31'));
    await post(input('1010', '3010', '5', '2026-03-01'));
    await createEntry(org, input('5030', '2100', '99'), randomUUID());
    const result = await run(
      plan({ id: 'balance', metric: 'account_balance', from: null, accountCodes: ['1010'] }),
      plan({ id: 'posted' }),
      plan({ id: 'draft', status: 'DRAFT' }),
    );
    expect(result.facts.map((fact) => fact.rows[0].value)).toEqual(['15.00', '0.00', '99.00']);
    expect(result.facts[0].scope.plan.from).toBeNull();
    expect(result.evidence[2].scope).toContain(
      'Drafts only; these amounts have not been added to your books',
    );
  });

  it('expands account groups once, preserves archived accounts and exposes zero leaf balances', async () => {
    await splitEntry();
    await query('UPDATE accounts SET archived=true WHERE organization_id=$1 AND id=$2', [org, ids['5030']]);
    const result = await run(
      plan({ id: 'group', accountCodes: ['5000', '5030'] }),
      plan({ id: 'leaves', accountCodes: ['5030', '5020'], groupBy: 'account' }),
    );
    expect(value(result)).toBe('2740.00');
    expect(result.facts[1].rows.map((row) => row.value)).toEqual(['0.00', '340.00']);
    expect(new Set(result.facts[1].rows.map((row) => row.rowId)).size).toBe(2);
    const chart = await financialAnalysisChart(org);
    expect(chart.find((account) => account.code === '5030')?.archived).toBe(true);
    expect(chart.every((account) => !('balance' in account))).toBe(true);
  });

  it('reports exact recorded base FX and excludes another tenant with identical account codes', async () => {
    const euro = (
      await query<{ id: string }>(
        "INSERT INTO accounts(organization_id,code,name,type,currency,parent_id) VALUES($1,'5070','Euro supplies','EXPENSE','EUR',$2) RETURNING id",
        [org, ids['5000']],
      )
    )[0].id;
    const fx = input();
    fx.lines[0] = { accountId: euro, debit: '10.01', credit: '0', exchangeRate: '1.2345', memo: '' };
    fx.lines[1].credit = '12.36';
    await post(fx);
    const foreign = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Foreign analysis workspace')", [
      foreign,
    ]);
    await seedChart(foreign);
    const foreignIds = Object.fromEntries(
      (await accounts(foreign)).map((account) => [account.code, account.id]),
    );
    const other = input('5030', '2100', '9999');
    other.lines[0].accountId = foreignIds['5030'];
    other.lines[1].accountId = foreignIds['2100'];
    await createEntry(foreign, other, randomUUID(), { post: true });
    const result = await run(plan());
    expect(value(result)).toBe('12.36');
    expect(result.facts[0].currency).toBe('USD');
    expect(result.evidence[0].scope).toContain('exchange rates saved with each transaction');
    await expect(run(plan({ accountCodes: ['7777'] }))).rejects.toMatchObject({
      code: 'INVALID_ANALYSIS_ACCOUNT',
    });
  });

  it('separates native expense lines from base values and excludes other currencies even under a mixed group', async () => {
    const created = await query<{ id: string; code: string }>(
      `INSERT INTO accounts(organization_id,code,name,type,currency,parent_id) VALUES
      ($1,'5070','Euro supplies','EXPENSE','EUR',$2),($1,'5071','Unused euro expense','EXPENSE','EUR',$2),
      ($1,'5072','Yen supplies','EXPENSE','JPY',$2) RETURNING id,code`,
      [org, ids['5000']],
    );
    for (const a of created) ids[a.code] = a.id;
    const fx = input('5070', '2100', '10.01');
    fx.lines[0].exchangeRate = '1.2345';
    fx.lines[1].credit = '12.36';
    await post(fx);
    const yen = input('5072', '2100', '300');
    yen.lines[0].exchangeRate = '0.01';
    yen.lines[1].credit = '3';
    await post(yen);
    await post(input('5030', '2100', '900'));
    const result = await run(
      plan({ id: 'eur', currencyMode: 'native', currency: 'EUR', accountCodes: ['5000', '5070'] }),
      plan({ id: 'base', accountCodes: ['5070'] }),
      plan({
        id: 'eur_accounts',
        currencyMode: 'native',
        currency: 'EUR',
        accountCodes: ['5000'],
        groupBy: 'account',
      }),
      plan({ id: 'yen', currencyMode: 'native', currency: 'JPY', accountCodes: ['5072'] }),
    );
    expect(result.facts.map((f) => [f.currency, f.unit, f.rows.map((r) => r.value)])).toEqual([
      ['EUR', 'EUR', ['10.01']],
      ['USD', 'USD', ['12.36']],
      ['EUR', 'EUR', ['10.01', '0.00']],
      ['JPY', 'JPY', ['300']],
    ]);
    expect(result.evidence[0].rows[0].value).toBe('€10.01 EUR');
    expect(result.evidence[3].rows[0].value).toBe('¥300 JPY');
    expect(result.evidence[0].scope).toContain('no currency conversion');
    const zeros = await run(
      plan({ currencyMode: 'native', currency: 'JPY', from: '2025-01-01', to: '2025-01-31' }),
    );
    expect(value(zeros)).toBe('0');
    expect(zeros.evidence[0].rows[0].value).toBe('¥0 JPY');
  });

  it('computes closing month and quarter balances from inception, including quiet months, reversals and negative closes', async () => {
    await post(input('1010', '3010', '100', '1899-12-31'));
    await post(input('5030', '1010', '30', '2026-03-20'));
    const original = await post(input('1010', '3010', '20', '2026-04-05'));
    await reverseEntry(org, original.id, '2026-05-01', randomUUID());
    await post(input('5030', '1010', '200', '2026-05-20'));
    await createEntry(org, input('1010', '3010', '999', '2026-04-01'), randomUUID());
    const balance = plan({
      metric: 'account_balance',
      accountCodes: ['1010'],
      groupBy: 'month',
      from: '2026-02-10',
      to: '2026-05-10',
    });
    const result = await run(
      { ...balance, id: 'months' },
      { ...balance, id: 'quarters', groupBy: 'quarter' },
      { ...balance, id: 'negative', from: '2026-05-01', to: '2026-05-31' },
      { ...balance, id: 'bounded', limit: 2 },
    );
    expect(result.facts[0].rows.map((r) => [r.value, r.from, r.to, r.balanceAsOf, r.entryCount])).toEqual([
      ['100.00', '2026-02-10', '2026-02-28', '2026-02-28', '1'],
      ['70.00', '2026-03-01', '2026-03-31', '2026-03-31', '2'],
      ['90.00', '2026-04-01', '2026-04-30', '2026-04-30', '3'],
      ['70.00', '2026-05-01', '2026-05-10', '2026-05-10', '4'],
    ]);
    expect(result.facts[1].rows.map((r) => [r.value, r.from, r.to])).toEqual([
      ['70.00', '2026-02-10', '2026-03-31'],
      ['70.00', '2026-04-01', '2026-05-10'],
    ]);
    expect(value(result, 2)).toBe('-130.00');
    expect(result.facts[3].truncated).toBe(true);
    expect(result.facts[3].rows).toHaveLength(2);
    expect(result.evidence[0].rows[0].label).toContain('closing balance as of 2026-02-28');
    expect(result.evidence[0].scope).toContain('includes all earlier history');
    expect(result.facts[0].scope.amountBasis).toBe('inception_to_closing_date_base_lines');
  });

  it('keeps native closing balances distinct from recorded base carrying amounts at different FX rates', async () => {
    ids['1070'] = (
      await query<{ id: string }>(
        "INSERT INTO accounts(organization_id,code,name,type,currency,parent_id) VALUES($1,'1070','Euro bank','ASSET','EUR',$2) RETURNING id",
        [org, ids['1000']],
      )
    )[0].id;
    async function euroMovement(
      debit: string,
      credit: string,
      rate: string,
      baseAmount: string,
      date: string,
    ) {
      const entry = input('1070', '3010', debit === '0' ? credit : debit, date);
      entry.lines = [
        { accountId: ids['1070'], debit, credit, exchangeRate: rate, memo: '' },
        {
          accountId: ids['3010'],
          debit: debit === '0' ? baseAmount : '0',
          credit: debit === '0' ? '0' : baseAmount,
          exchangeRate: '1',
          memo: '',
        },
      ];
      return post(entry);
    }
    await euroMovement('100', '0', '1.1', '110', '2026-01-01');
    const original = await euroMovement('50', '0', '1.2', '60', '2026-03-01');
    await euroMovement('0', '50', '1.4', '70', '2026-03-02');
    await reverseEntry(org, original.id, '2026-04-01', randomUUID());
    await euroMovement('0', '100', '1.3', '130', '2026-04-15');
    const series = plan({
      metric: 'account_balance',
      accountCodes: ['1070'],
      groupBy: 'month',
      from: '2026-02-10',
      to: '2026-04-10',
    });
    const result = await run(
      { ...series, id: 'native', currencyMode: 'native', currency: 'EUR' },
      { ...series, id: 'base' },
      {
        ...series,
        id: 'negative_native',
        groupBy: 'total',
        from: null,
        to: '2026-04-20',
        currencyMode: 'native',
        currency: 'EUR',
      },
      { ...series, id: 'negative_base', groupBy: 'total', from: null, to: '2026-04-20' },
    );
    expect(result.facts[0].rows.map((r) => r.value)).toEqual(['100.00', '100.00', '50.00']);
    expect(result.facts[1].rows.map((r) => r.value)).toEqual(['110.00', '100.00', '40.00']);
    expect(value(result, 2)).toBe('-50.00');
    expect(value(result, 3)).toBe('-90.00');
    expect(result.facts[0].currency).toBe('EUR');
    expect(result.evidence[1].scope).toContain('not current-rate revaluation');
  });

  it('orders bounded groups and explicitly marks omitted results without presenting their partial sum as a total', async () => {
    for (let i = 1; i <= 4; i++)
      await post({ ...input('5030', '2100', String(i)), counterparty: `Merchant ${i}` });
    const result = await run(plan({ groupBy: 'counterparty', order: 'value_desc', limit: 2 }));
    expect(result.facts[0].rows.map((row) => [row.label, row.value])).toEqual([
      ['Merchant 4', '4.00'],
      ['Merchant 3', '3.00'],
    ]);
    expect(result.facts[0].truncated).toBe(true);
    expect(result.answer).toContain('these are not the complete results');
    expect(result.answer).not.toContain('$7.00');
  });

  it('does not change journal/account content and returns stable entry fact references', async () => {
    const saved = await post();
    const snapshot = () =>
      query(
        `SELECT jsonb_build_object(
      'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM journal_entries e WHERE organization_id=$1),
      'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM journal_lines l WHERE organization_id=$1),
      'accounts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM accounts a WHERE organization_id=$1)) AS snapshot`,
        [org],
      );
    const before = await snapshot();
    const result = await run(plan({ groupBy: 'entry' }));
    expect(result.facts[0].rows[0].rowId).toBe(`entry:${saved.id}`);
    expect(result.evidence[0].rows[0].href).toBe(`/transactions?entry=${saved.id}`);
    expect(await snapshot()).toEqual(before);
    await expect(run(plan(), plan())).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_SCOPE' });
  });
});
