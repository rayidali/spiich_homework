import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Records are scripted; original-user quote validation, opaque parameter handles,
// exact arithmetic, provenance and the isolated interpreter are real. No provider
// or database call is made by these tests.
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../server/financial-analysis', async (original) => ({
  ...(await original<typeof import('../server/financial-analysis')>()),
  executeFinancialAnalysis: mocks.read,
}));

import {
  executeFinancialProgram,
  financialProgramRepairSchema,
  prepareFinancialProgram,
} from '../server/financial-program';
import type { AnalysisFacts, FinancialQuery } from '../server/financial-analysis';
import type { ModelMessages } from '../server/ai-provider';

const org = '00000000-0000-4000-8000-000000000001';
function query(id: string, accountCodes: string[] = []): FinancialQuery {
  return {
    id,
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-01-01',
    to: '2026-03-31',
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    groupBy: 'month',
    accountCodes,
    cooccurringAccountCodes: [],
    counterparty: { mode: 'any', value: '' },
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
    order: 'label_asc',
    limit: 50,
  };
}
function fact(plan: FinancialQuery, values: string[]): AnalysisFacts {
  return {
    queryId: plan.id,
    metric: plan.metric,
    aggregation: 'sum',
    grain: 'month',
    unit: 'USD',
    currency: 'USD',
    truncated: false,
    rows: values.map((value, index) => ({
      rowId: `month:2026-0${index + 1}`,
      label: `2026-0${index + 1}`,
      value,
      entryCount: value === '0' ? '0' : '1',
      from: `2026-0${index + 1}-01`,
      to: `2026-0${index + 1}-${[31, 28, 31][index]}`,
    })),
    scope: {
      organizationId: org,
      plan,
      resolvedAccountIds: [],
      cooccurringAccountIds: [],
      amountBasis: 'Recorded USD',
      statusMeaning: 'Posted entries only',
    },
  };
}
const rent = query('rent', ['5010']);
const expenses = query('expenses');
const passthrough = `return [{title:'Recorded rent',rows:tables.find(t=>t.id==='rent').rows.map(row=>({
  label:row.label,value:row.value,format:'money'
}))}];`;
const scale = `
  const rate=tables.find(t=>t.id==='user_inputs').rows.find(r=>r.id==='rate').value;
  return [{title:'Rent with the proposed increase',rows:tables.find(t=>t.id==='rent').rows.map(row=>({
    label:row.label,value:calc.add(row.value,calc.mul(row.value,rate)),format:'money'
  }))}];`;
const threshold = { id: 'threshold', value: '0.5', unit: 'ratio' as const, sourceText: '50%' };
const rate = { id: 'rate', value: '0.1', unit: 'ratio' as const, sourceText: '10%' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.read.mockImplementation(async (_org: string, input: { queries: FinancialQuery[] }) => {
    const facts = input.queries.map((plan) =>
      fact(plan, plan.id === 'rent' ? ['40', '60', '0'] : ['100', '100', '0']),
    );
    return {
      answer: 'Scripted recorded amounts',
      facts,
      evidence: facts.map((item) => ({
        title: item.queryId,
        period: '2026-01-01 to 2026-03-31',
        source: 'posted' as const,
        href: '/reports',
        rows: item.rows.map((row) => ({ label: row.label, value: row.value! })),
      })),
    };
  });
});
afterEach(() => vi.restoreAllMocks());

describe('Original-user parameters for generated financial programs', () => {
  it('rejects invented, assistant-only, mismatched and incorrectly typed quantities before reading records', async () => {
    const cases: {
      parameter: typeof threshold | { id: string; value: string; unit: 'USD'; sourceText: string };
      messages: ModelMessages;
    }[] = [
      { parameter: threshold, messages: [{ role: 'user', content: 'Show monthly rent shares.' }] },
      {
        parameter: threshold,
        messages: [
          { role: 'assistant', content: 'Use a 50% threshold.' },
          { role: 'user', content: 'Show the months above that threshold.' },
        ],
      },
      {
        parameter: { ...threshold, value: '0.6' },
        messages: [{ role: 'user', content: 'Only include shares above 50%.' }],
      },
      {
        parameter: { ...threshold, unit: 'USD' },
        messages: [{ role: 'user', content: 'Only include shares above 50%.' }],
      },
      {
        parameter: { ...threshold, sourceText: '$50', unit: 'USD', value: '50' },
        messages: [{ role: 'user', content: 'Use $50 per month.' }],
      },
    ];
    for (const { parameter, messages } of cases) {
      await expect(
        executeFinancialProgram(
          org,
          { queries: [rent], code: passthrough, parameters: [parameter] },
          { messages },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_SCENARIO' });
      expect(mocks.read).not.toHaveBeenCalled();
    }
  });

  it('uses an exact quoted 50% threshold to filter recorded monthly percentages', async () => {
    const content =
      'Show months in the first quarter where rent exceeds 50% of total expenses; omit undefined shares.';
    const result = await executeFinancialProgram(
      org,
      {
        queries: [rent, expenses],
        parameters: [threshold],
        code: `
          const threshold=tables.find(t=>t.id==='user_inputs').rows.find(r=>r.id==='threshold').value;
          const rent=tables.find(t=>t.id==='rent').rows;
          const expenses=tables.find(t=>t.id==='expenses').rows;
          const rows=calc.align(rent,expenses).map(({left,right})=>({
            label:left.label,value:calc.div(left.value,right.value),format:'percent'
          })).filter(row=>!calc.isNull(row.value)&&calc.compare(row.value,threshold)>0);
          return [{title:'Recorded months above the supplied threshold',rows}];`,
      },
      { messages: [{ role: 'user', content }] },
    );
    expect(result.program.tables[0].rows).toHaveLength(1);
    expect(result.program.tables[0].rows[0]).toMatchObject({
      label: '2026-02',
      value: '60.00%',
      exact: { numerator: '3', denominator: '5' },
      source: 'posted',
    });
    expect(result.program.parameters[0]).toMatchObject({
      ...threshold,
      userMessageIndex: 0,
      sourceStart: content.indexOf('50%'),
      sourceEnd: content.indexOf('50%') + 3,
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    // Filtering recorded rows changes selection; it does not change their values
    // into hypothetical amounts. The supplied selection parameter stays visible.
    expect(result.evidence[0].source).toBe('posted');
  });

  it('keeps an exact user-supplied 10% increase hypothetical through arithmetic and display', async () => {
    const result = await executeFinancialProgram(
      org,
      { queries: [rent], parameters: [rate], code: scale },
      {
        messages: [
          { role: 'user', content: 'What would each monthly rent amount become with a 10% increase?' },
        ],
      },
    );
    expect(result.program.tables[0].rows.map((row) => row.value)).toEqual(['$44.00', '$66.00', '$0.00']);
    for (const row of result.program.tables[0].rows) {
      expect(row.source).toBe('scenario');
      expect(row.references).toContainEqual({ queryId: 'user_inputs', rowId: 'rate' });
    }
    expect(result.program.tables[0].rows[0].exact).toEqual({ numerator: '44', denominator: '1' });
    expect(result.evidence[0].source).toBe('scenario');
    expect(result.evidence[1].source).toBe('posted');
    expect(result.program.parameters[0]).toMatchObject({ ...rate, userMessageIndex: 0 });
    expect(result.answer).not.toContain('These figures use recorded entries.');
    expect(result.program.interpretationVerified).toBe(false);
  });

  it('rejects duplicate parameter IDs and the reserved input-table query name before database work', async () => {
    const messages: ModelMessages = [{ role: 'user', content: 'Use a 10% increase.' }];
    await expect(
      prepareFinancialProgram(org, { queries: [rent], parameters: [rate, rate], code: scale }, { messages }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
    await expect(
      prepareFinancialProgram(
        org,
        { queries: [{ ...rent, id: 'user_inputs' }], parameters: [rate], code: scale },
        { messages },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('freezes validated parameters and materialized records for code-only repair', async () => {
    const args = { queries: [structuredClone(rent)], parameters: [{ ...rate }], code: 'return 123;' };
    const messages: ModelMessages = [{ role: 'user', content: 'Use a 10% increase.' }];
    const prepared = await prepareFinancialProgram(org, args, { messages });
    expect(prepared.shapes).toEqual([
      { id: 'rent', rows: 3 },
      { id: 'user_inputs', rows: 1 },
    ]);
    await expect(prepared.run(prepared.code)).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
    args.parameters[0].value = '0.9';
    args.parameters[0].sourceText = '90%';
    args.queries[0].accountCodes = ['5030'];
    messages[0].content = 'Use a 90% increase.';
    expect(() => financialProgramRepairSchema.parse({ code: scale, parameters: args.parameters })).toThrow();
    const result = await prepared.run(financialProgramRepairSchema.parse({ code: scale }).code);
    expect(result.program.tables[0].rows.map((row) => row.value)).toEqual(['$44.00', '$66.00', '$0.00']);
    expect(result.program.parameters[0]).toMatchObject({ ...rate, userMessageIndex: 0 });
    expect(result.facts[0].scope.plan.accountCodes).toEqual(['5010']);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});
