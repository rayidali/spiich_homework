import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The planner and database responses are scripted. Parsing, financial query
// compilation, program execution, arithmetic and answer construction are real.
// These checks establish the integration contract, not Gemini accuracy.
const mocks = vi.hoisted(() => ({ choose: vi.fn(), query: vi.fn(), db: { query: vi.fn() } }));
vi.mock('../server/ai-provider', async (original) => ({
  ...(await original<typeof import('../server/ai-provider')>()),
  chooseFinancialTool: mocks.choose,
}));
vi.mock('../server/db', () => ({ query: mocks.query, transaction: vi.fn() }));
vi.mock('../server/reports', async (original) => ({
  ...(await original<typeof import('../server/reports')>()),
  reportSnapshot: (read: (db: typeof mocks.db) => unknown) => read(mocks.db),
  today: () => '2026-11-03',
}));

import { buildFinancialPlannerInput, financialChat } from '../server/ai';
import type { AnalysisAccount, FinancialQuery } from '../server/financial-analysis';
import type { FinancialTool } from '../server/ai-provider';

const org = '00000000-0000-4000-8000-000000000001';
const rent: AnalysisAccount = {
  id: '00000000-0000-4000-8000-000000000002',
  code: '5010',
  name: 'Rent',
  type: 'EXPENSE',
  currency: 'USD',
  parent_id: null,
  is_group: false,
  is_cash: false,
  archived: false,
};
const supplies: AnalysisAccount = {
  ...rent,
  id: '00000000-0000-4000-8000-000000000003',
  code: '5030',
  name: 'Office supplies',
};
const other: AnalysisAccount = {
  ...rent,
  id: '00000000-0000-4000-8000-000000000004',
  code: '5090',
  name: 'Other expenses',
};

function query(id: string, changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
    id,
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-01-01',
    to: '2026-12-31',
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

// Independent recorded monthly inputs. Other expenses are the remainder after
// rent and supplies, so the account-filtered and all-expenses fixtures reconcile.
const rents = ['0', '0', '0', '0', '2400', '2400', '2400', '2400', '2400', '7200', '0', '0'];
const totals = ['0', '0', '0', '0', '7969', '8293', '8617', '8941', '9265', '14567', '0', '0'];
const supplyAmounts = ['0', '0', '0', '0', '100', '200', '300', '0', '0', '0', '0', '0'];
const monthEnds = ['31', '28', '31', '30', '31', '30', '31', '31', '30', '31', '30', '31'];

const monthlyShare = `
const category = tables.find(t => t.id === 'rent');
const total = tables.find(t => t.id === 'expenses');
function share(left, right) { return calc.div(left.value, right.value); }
return [{title:'Rent share by month',rows:calc.align(category.rows,total.rows).map(({left,right}) => ({
  label:left.label, value:share(left,right), format:'percent'
}))}];`;

let selected: { queries: FinancialQuery[]; code: string };
let reverseDenominator: boolean;
function providerResponse(name: string, args: unknown, knownUsage = true) {
  return {
    call: { name, args },
    ai: {
      provider: 'gemini',
      model: 'offline-fixture',
      durationMs: 1,
      ...(knownUsage
        ? { usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0, totalTokens: 2 } }
        : {}),
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  reverseDenominator = false;
  selected = {
    queries: [query('rent', { accountCodes: ['5010'] }), query('expenses')],
    code: monthlyShare,
  };
  mocks.choose.mockImplementation(async (tools: FinancialTool[]) =>
    tools.some((tool) => tool.name === 'repair_financial_program')
      ? providerResponse('repair_financial_program', { code: selected.code })
      : providerResponse('financial_program', selected),
  );
  mocks.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (!sql.includes('journal_lines')) return [rent, supplies, other];
    const ids = params[4] as string[];
    const values =
      ids.length === 1 && ids[0] === rent.id
        ? rents
        : ids.length === 1 && ids[0] === supplies.id
          ? supplyAmounts
          : totals;
    const from = String(params[1]);
    const to = String(params[2]);
    const rows = values.flatMap((value, index) => {
      const month = `2026-${String(index + 1).padStart(2, '0')}`;
      const start = `${month}-01`;
      const end = `${month}-${monthEnds[index]}`;
      if (end < from || start > to) return [];
      return [
        {
          row_id: month,
          label: month,
          value,
          entry_count: value === '0' ? '0' : '1',
          period_from: start < from ? from : start,
          period_to: end > to ? to : end,
        },
      ];
    });
    return reverseDenominator && values === totals ? rows.reverse() : rows;
  });
  mocks.db.query.mockResolvedValue({ rows: [] });
});
afterEach(() => vi.restoreAllMocks());

const ask = (
  content = 'For the full calendar year 2026, show rent as a percentage of total expenses for each month.',
) => financialChat(org, [{ role: 'user' as const, content }], { route: 'composable' });

describe('Generated financial analysis through chat (scripted planner, real isolated execution)', () => {
  it('advertises generated computation on composable/adaptive routes without altering the complete experiment', () => {
    for (const route of ['composable', 'adaptive'] as const) {
      const input = buildFinancialPlannerInput(route, [], '2026-11-03');
      expect(input.tools.some((tool) => tool.name === 'financial_program')).toBe(true);
      expect(input.instructions).toContain('percentages');
      expect(input.instructions).toContain('follow-ups');
    }
    const complete = buildFinancialPlannerInput('complete', [], '2026-11-03');
    expect(complete.tools.some((tool) => tool.name === 'financial_program')).toBe(false);
  });

  it('returns all twelve monthly percentages, including unavailable zero-denominator months', async () => {
    const result = await ask();
    expect(result.query.name).toBe('financial_program');
    expect(result.evidence[0].title).toBe('Rent share by month');
    expect(result.evidence[0].source).toBe('posted');
    expect(result.evidence[0].rows).toHaveLength(12);
    expect(result.evidence[0].rows.slice(4, 10).map((row) => row.value)).toEqual([
      '30.12%',
      '28.94%',
      '27.85%',
      '26.84%',
      '25.90%',
      '49.43%',
    ]);
    for (const index of [0, 1, 2, 3, 10, 11]) {
      expect(result.evidence[0].rows[index].value).toBe('Not available — denominator is zero');
      expect(result.evidence[0].rows[index].value).not.toBe('0.00%');
    }
    expect(result.evidence[1].rows[4].value).toBe('$2,400.00');
    expect(result.evidence[2].rows[4].value).toBe('$7,969.00');
    expect(result).toHaveProperty('program.code', monthlyShare);
    expect(result).toHaveProperty('program.interpretationVerified', false);
    expect(result).toHaveProperty('program.tables.0.rows.4.exact', {
      numerator: '2400',
      denominator: '7969',
    });
    expect(result).toHaveProperty('program.tables.0.rows.4.references', [
      { queryId: 'rent', rowId: 'month:2026-05' },
      { queryId: 'expenses', rowId: 'month:2026-05' },
    ]);
    expect(result).toHaveProperty('program.tables.0.rows.0.exact', null);
    expect(result).toHaveProperty('program.tables.0.rows.0.reason', 'zero_denominator');
    expect(mocks.choose).toHaveBeenCalledTimes(1);
    const reads = mocks.query.mock.calls.filter(([sql]) => String(sql).includes('journal_lines'));
    expect(reads).toHaveLength(2);
    expect(reads.every(([, , db]) => db === mocks.db)).toBe(true);
  });

  it('matches months by identity rather than the order of the two result arrays', async () => {
    reverseDenominator = true;
    const result = await ask();
    expect(result.evidence[0].rows.find((row) => row.label === '2026-05')?.value).toBe('30.12%');
    expect(result.evidence[0].rows.find((row) => row.label === '2026-10')?.value).toBe('49.43%');
  });

  it('computes the weighted annual share from totals rather than averaging monthly percentages', async () => {
    selected.code = `
const rent = tables.find(t=>t.id==='rent');
const expenses = tables.find(t=>t.id==='expenses');
return [{title:'Annual rent share',rows:[{label:'Full calendar year',
  value:calc.div(calc.sum(rent.rows.map(r=>r.value)),calc.sum(expenses.rows.map(r=>r.value))),
  format:'percent'
}]}];`;
    const result = await ask('What percentage of all 2026 expenses was rent?');
    expect(result.evidence[0].rows[0].value).toBe('33.30%');
    expect(result).toHaveProperty('program.tables.0.rows.0.exact', {
      numerator: '4800',
      denominator: '14413',
    });
  });

  it('executes a direct generated program on the adaptive route without an unnecessary inspection call', async () => {
    const result = await financialChat(
      org,
      [{ role: 'user', content: 'Show each 2026 month’s rent as a percentage of total expenses.' }],
      { route: 'adaptive' },
    );
    expect(result.evidence[0].rows[4].value).toBe('30.12%');
    expect(mocks.choose).toHaveBeenCalledTimes(1);
  });

  it('retains the percentage question across a short year clarification and clips the current month', async () => {
    selected.queries = selected.queries.map((item) => ({ ...item, to: '2026-11-03' }));
    const messages = [
      {
        role: 'user' as const,
        content: 'for a year how much % of all expenses am I spending monthly on rent',
      },
      { role: 'assistant' as const, content: 'Which year should I use?' },
      { role: 'user' as const, content: 'this year' },
    ];
    const result = await financialChat(org, messages, { route: 'composable' });
    const suppliedMessages = mocks.choose.mock.calls[0][2];
    expect(suppliedMessages).toEqual(messages);
    expect(result.evidence[0].rows).toHaveLength(11);
    expect(result.evidence[0].rows[4].value).toBe('30.12%');
    expect(result.evidence[0].period).toContain('2026-11-03');
    expect(result).toHaveProperty('facts.0.rows.10.to', '2026-11-03');
  });

  it('executes a newly generated function for both a median and cumulative monthly spending', async () => {
    selected = {
      queries: [query('supplies', { accountCodes: ['5030'], from: '2026-05-01', to: '2026-07-31' })],
      code: `
const rows = tables[0].rows.slice().sort((a,b) => a.from.localeCompare(b.from));
function cumulative(items) {
  return items.map((row,index) => ({label:row.label,value:calc.sum(items.slice(0,index+1).map(r=>r.value)),format:'money'}));
}
return [
  {title:'Median monthly supplies',rows:[{label:'Median',value:calc.median(rows.map(r=>r.value)),format:'money'}]},
  {title:'Cumulative supplies',rows:cumulative(rows)}
];`,
    };
    const result = await ask(
      'Show the median monthly supplies spend and the running total from May through July 2026.',
    );
    expect(result.evidence[0].rows[0].value).toMatch(/^\$200\.00(?: USD)?$/);
    expect(result.evidence[1].rows.map((row) => row.value.replace(/ USD$/, ''))).toEqual([
      '$100.00',
      '$300.00',
      '$600.00',
    ]);
    expect(mocks.choose).toHaveBeenCalledTimes(1);
  });

  it.each([
    `return [{title:'Invented amount',rows:[{label:'Total',value:99999,format:'money'}]}];`,
    `return [{title:'Invented amount',rows:[{label:'Total',value:'99999.00',format:'money'}]}];`,
    `return [{title:'Invented amount',rows:[{label:'Total',value:calc.add(tables[0].rows[4].value,'100000'),format:'money'}]}];`,
  ])('withholds forged numeric outputs rather than displaying the input tables as success', async (code) => {
    selected.code = code;
    const result = await ask();
    expect(result.evidence).toEqual([]);
    expect(result).toHaveProperty('limitation');
    expect(result).not.toHaveProperty('program');
    expect(result.answer).not.toContain('$2,400');
    expect(result.answer).not.toContain('99999');
    expect(mocks.choose).toHaveBeenCalledTimes(2);
  });

  it('refuses truncated financial inputs instead of calculating an apparently complete year', async () => {
    selected.queries[1].limit = 5;
    const result = await ask();
    expect(result.evidence).toEqual([]);
    expect(result).toHaveProperty('limitation');
    expect(result).not.toHaveProperty('program');
    expect(result.answer).toMatch(/incomplete|narrow|truncat/i);
    expect(mocks.choose).toHaveBeenCalledTimes(1);
  });

  it('does not align unequal date intervals just because both rows have the same month label', async () => {
    selected.queries = [
      query('rent', { accountCodes: ['5010'], from: '2026-05-01', to: '2026-05-31' }),
      query('expenses', { from: '2026-05-02', to: '2026-05-31' }),
    ];
    const result = await ask();
    expect(result.evidence).toEqual([]);
    expect(result).toHaveProperty('limitation');
    expect(result).not.toHaveProperty('program');
  });

  it('refuses to mix posted rent and draft expense denominators before reading financial amounts', async () => {
    selected.queries[1].status = 'DRAFT';
    const result = await ask();
    expect(result.evidence).toEqual([]);
    expect(result).toHaveProperty('limitation');
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('journal_lines'))).toBe(false);
  });

  it('withholds a throwing program without returning the successfully retrieved dollar tables', async () => {
    selected.code = `throw new Error('wrong-program');`;
    const result = await ask();
    expect(result.evidence).toEqual([]);
    expect(result).toHaveProperty('limitation');
    expect(result).not.toHaveProperty('facts');
    expect(result).not.toHaveProperty('program');
    expect(result.answer).not.toContain('Net expenses');
    expect(mocks.choose).toHaveBeenCalledTimes(2);
  });

  it.each(['return [', 'return missingProgramFunction(tables);'])(
    'repairs a program failure using the same snapshot and the existing second attempt: %s',
    async (badCode) => {
      selected.code = badCode;
      mocks.choose.mockImplementation(async (tools: FinancialTool[]) =>
        tools.some((tool) => tool.name === 'repair_financial_program')
          ? providerResponse('repair_financial_program', { code: monthlyShare })
          : providerResponse('financial_program', selected),
      );
      const result = await ask();
      expect(result.evidence[0].title).toBe('Rent share by month');
      expect(result.evidence[0].rows[4].value).toBe('30.12%');
      expect(result).toHaveProperty('program.code', monthlyShare);
      expect(mocks.choose).toHaveBeenCalledTimes(2);
      const [repairTools, , repairMessages] = mocks.choose.mock.calls[1];
      expect(repairTools.map((tool: FinancialTool) => tool.name)).toEqual(['repair_financial_program']);
      expect(repairMessages[0]).toEqual({
        role: 'user',
        content:
          'For the full calendar year 2026, show rent as a percentage of total expenses for each month.',
      });
      expect(JSON.stringify(repairTools)).not.toContain('accountCodes');
      // The two original queries are read once. Code repair cannot re-read or
      // widen them, even though it creates a new isolated interpreter.
      expect(mocks.query.mock.calls.filter(([sql]) => String(sql).includes('journal_lines'))).toHaveLength(2);
    },
  );

  it('does not repair program execution when the first generation has unknown usage', async () => {
    selected.code = 'return missingProgramFunction(tables);';
    mocks.choose.mockResolvedValue(providerResponse('financial_program', selected, false));
    const result = await ask();
    expect(result.evidence).toEqual([]);
    expect(result).toHaveProperty('limitation');
    expect(result).not.toHaveProperty('program');
    expect(mocks.choose).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls.filter(([sql]) => String(sql).includes('journal_lines'))).toHaveLength(2);
  });

  it('rejects a repair that attempts to replace the frozen queries', async () => {
    selected.code = 'return missingProgramFunction(tables);';
    mocks.choose.mockResolvedValueOnce(providerResponse('financial_program', selected)).mockResolvedValueOnce(
      providerResponse('repair_financial_program', {
        code: monthlyShare,
        queries: [query('expenses', { from: '2000-01-01' })],
      }),
    );
    await expect(ask()).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(mocks.choose).toHaveBeenCalledTimes(2);
    const reads = mocks.query.mock.calls.filter(([sql]) => String(sql).includes('journal_lines'));
    expect(reads).toHaveLength(2);
    expect(reads.every(([, params]) => params[1] === '2026-01-01' && params[2] === '2026-12-31')).toBe(true);
  });

  it('does not add a third attempt when schema repair already used the remaining generation', async () => {
    selected.code = 'return missingProgramFunction(tables);';
    mocks.choose
      .mockResolvedValueOnce(providerResponse('financial_program', { queries: selected.queries }))
      .mockResolvedValueOnce(providerResponse('financial_program', selected));
    const result = await ask();
    expect(result.evidence).toEqual([]);
    expect(result).toHaveProperty('limitation');
    expect(result).not.toHaveProperty('program');
    expect(mocks.choose).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls.filter(([sql]) => String(sql).includes('journal_lines'))).toHaveLength(2);
  });

  it('does not accept model-supplied assumptions as program query data', async () => {
    Object.assign(selected, {
      assumptions: [{ id: 'salary', value: '100000', unit: 'USD', sourceText: 'not in the user question' }],
    });
    await expect(ask()).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('journal_lines'))).toBe(false);
  });
});
