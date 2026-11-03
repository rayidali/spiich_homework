import { describe, expect, it } from 'vitest';
import { executeAnalysisProgram, type AnalysisProgramInputTable } from '../server/analysis-program';

function table(
  id: string,
  amounts: (string | null)[],
  options: { unit?: 'USD' | 'count' | 'ratio'; source?: 'posted' | 'draft' } = {},
): AnalysisProgramInputTable {
  return {
    id,
    truncated: false,
    rows: amounts.map((value, index) => ({
      id: `month:2026-${String(index + 1).padStart(2, '0')}`,
      label: `2026-${String(index + 1).padStart(2, '0')}`,
      from: `2026-${String(index + 1).padStart(2, '0')}-01`,
      to: `2026-${String(index + 1).padStart(2, '0')}-${[31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][index]}`,
      value,
      unit: options.unit ?? 'USD',
      source: options.source ?? 'posted',
    })),
  };
}
const result = (expression: string, format = 'money') =>
  `return [{title:'Result',rows:[{label:'Answer',value:${expression},format:'${format}'}]}];`;
const ratios = `
  function percentRows(left, right) {
    return calc.align(left, right).map(({left,right}) => ({
      label:left.label, value:calc.div(left.value,right.value), format:'percent'
    }));
  }
  return [{title:'Monthly share',rows:percentRows(tables[0].rows,tables[1].rows)}];
`;

describe('isolated generated analysis programs', () => {
  it('creates a function that calculates twelve monthly percentages with cell-level undefined results', async () => {
    const rent = table('rent', ['0', ...Array(11).fill('100')]);
    const spend = table('spend', ['0', ...Array(11).fill('240')]);
    const actual = await executeAnalysisProgram({ code: ratios, tables: [rent, spend] });
    expect(actual.tables[0].rows).toHaveLength(12);
    expect(actual.tables[0].rows[0]).toMatchObject({
      value: 'Not available — denominator is zero',
      exact: null,
      reason: 'zero_denominator',
      unit: 'ratio',
    });
    expect(actual.tables[0].rows[1]).toMatchObject({
      value: '41.67%',
      exact: { numerator: '5', denominator: '12' },
      references: [
        { queryId: 'rent', rowId: 'month:2026-02' },
        { queryId: 'spend', rowId: 'month:2026-02' },
      ],
    });
    expect(actual.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(actual.operationCount).toBe(13);
  });

  it('aligns reordered source periods by their real identities', async () => {
    const rent = table('rent', ['100', '200', '300']);
    const spend = table('spend', ['200', '800', '3000']);
    spend.rows.reverse();
    const actual = await executeAnalysisProgram({ code: ratios, tables: [rent, spend] });
    expect(actual.tables[0].rows.map((row) => row.value)).toEqual(['50.00%', '25.00%', '10.00%']);
  });

  it('runs generated cumulative functions without scalar-step enumeration', async () => {
    const actual = await executeAnalysisProgram({
      tables: [
        table(
          'costs',
          Array.from({ length: 12 }, (_, i) => String(i + 1)),
        ),
      ],
      code: `const values=[]; return [{title:'Cumulative spending',rows:tables[0].rows.map(row => {
        values.push(row.value); return {label:row.label,value:calc.sum(values),format:'money'};
      })}];`,
    });
    expect(actual.tables[0].rows.at(-1)).toMatchObject({
      value: '$78.00',
      exact: { numerator: '78', denominator: '1' },
    });
    expect(actual.tables[0].rows.at(-1)!.references).toHaveLength(12);
  });

  it.each([
    ['median', ['$8.00', '$5.50']],
    ['mean', ['$7.00', '$6.00']],
    ['min', ['$3.00', '$3.00']],
    ['max', ['$10.00', '$10.00']],
    ['sum', ['$21.00', '$24.00']],
  ])('computes exact %s over odd and even lists', async (operation, expected) => {
    for (const [index, amounts] of [
      ['3', '10', '8'],
      ['3', '10', '8', '3'],
    ].entries()) {
      const actual = await executeAnalysisProgram({
        tables: [table('amounts', amounts)],
        code: result(`calc.${operation}(tables[0].rows.map(row => row.value))`),
      });
      expect(actual.tables[0].rows[0].value).toBe(expected[index]);
      expect(actual.tables[0].rows[0].references).toHaveLength(amounts.length);
    }
  });

  it('uses exact fractions through recurring divisions and only rounds the display', async () => {
    const actual = await executeAnalysisProgram({
      tables: [table('values', ['1', '3', '0.1', '0.2'])],
      code: `
      const [one,three,a,b]=tables[0].rows.map(row=>row.value);
      return [{title:'Exact values',rows:[
        {label:'Third',value:calc.div(one,three),format:'percent'},
        {label:'Recover one',value:calc.mul(calc.div(one,three),three),format:'money'},
        {label:'Decimal sum',value:calc.add(a,b),format:'money'}]}];`,
    });
    expect(actual.tables[0].rows.map((row) => row.value)).toEqual(['33.33%', '$1.00', '$0.30']);
    expect(actual.tables[0].rows[0].exact).toEqual({ numerator: '1', denominator: '3' });
  });

  it('supports rank/filter logic over exact comparisons without exposing native amounts', async () => {
    const actual = await executeAnalysisProgram({
      tables: [table('costs', ['10', '30', '20'])],
      code: `
      const sorted=[...tables[0].rows].sort((a,b)=>calc.compare(b.value,a.value));
      return [{title:'Largest two',rows:sorted.slice(0,2).map(row=>({label:row.label,value:row.value,format:'money'}))}];`,
    });
    expect(actual.tables[0].rows.map((row) => row.value)).toEqual(['$30.00', '$20.00']);
  });

  it('keeps zero numerators, negative refunds and shares over 100 percent', async () => {
    const actual = await executeAnalysisProgram({
      tables: [table('a', ['0', '-20', '300']), table('b', ['100', '100', '100'])],
      code: ratios,
    });
    expect(actual.tables[0].rows.map((row) => row.value)).toEqual(['0.00%', '-20.00%', '300.00%']);
  });

  it('preserves draft ancestry through aggregates and arithmetic', async () => {
    const actual = await executeAnalysisProgram({
      tables: [table('drafts', ['10', '20'], { source: 'draft' })],
      code: result('calc.sum(tables[0].rows.map(row=>row.value))'),
    });
    expect(actual.tables[0].rows[0]).toMatchObject({ source: 'draft', value: '$30.00' });
  });

  it('propagates missing values unless generated code explicitly filters them', async () => {
    const tables = [table('values', ['10', null, '20'])];
    const missing = await executeAnalysisProgram({
      tables,
      code: result('calc.mean(tables[0].rows.map(row=>row.value))'),
    });
    expect(missing.tables[0].rows[0]).toMatchObject({ exact: null, reason: 'missing_value' });
    const explicit = await executeAnalysisProgram({
      tables,
      code: result('calc.mean(tables[0].rows.map(row=>row.value).filter(value=>!calc.isNull(value)))'),
    });
    expect(explicit.tables[0].rows[0].value).toBe('$15.00');
  });

  it('distinguishes empty aggregates from an actual zero count', async () => {
    const actual = await executeAnalysisProgram({
      tables: [table('empty', [])],
      code: `return [{title:'Empty results',rows:[
      {label:'Mean',value:calc.mean([]),format:'number'},
      {label:'Count',value:calc.count([]),format:'number'}]}];`,
    });
    expect(actual.tables[0].rows[0]).toMatchObject({ exact: null, reason: 'empty_input' });
    expect(actual.tables[0].rows[1]).toMatchObject({
      value: '0',
      exact: { numerator: '0', denominator: '1' },
      unit: 'count',
    });
  });

  it('supports exact absolute difference and sample count', async () => {
    const actual = await executeAnalysisProgram({
      tables: [table('values', ['1', '3'])],
      code: `const values=tables[0].rows.map(r=>r.value);return [{title:'Changes',rows:[
      {label:'Absolute difference',value:calc.abs(calc.sub(values[0],values[1])),format:'money'},
      {label:'Sample count',value:calc.count(values),format:'number'}]}];`,
    });
    expect(actual.tables[0].rows.map((row) => row.value)).toEqual(['$2.00', '2']);
    expect(actual.tables[0].rows[1].references).toHaveLength(2);
  });

  it.each([
    '123',
    '"123"',
    '({numerator:"123",denominator:"1"})',
    'null',
    'calc.compare(tables[0].rows[0].value,tables[0].rows[0].value)',
  ])('rejects fabricated numeric output %s', async (value) => {
    await expect(
      executeAnalysisProgram({ tables: [table('values', ['1'])], code: result(value) }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it.each([
    'process.env',
    'require("node:fs")',
    'fetch("https://example.com")',
    'Function("return process")()',
    'import("node:fs")',
  ])('cannot access host facilities via %s', async (expression) => {
    await expect(
      executeAnalysisProgram({ tables: [table('values', ['1'])], code: `return ${expression};` }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it('does not expose raw amounts inside opaque values', async () => {
    await expect(
      executeAnalysisProgram({
        tables: [table('values', ['123'])],
        code: result('tables[0].rows[0].value.exact'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it.each(['tables[0].rows[0].value=123', 'tables[0].rows.push(tables[0].rows[0])', 'calc.div=()=>123'])(
    'keeps supplied capabilities and tables immutable: %s',
    async (mutation) => {
      await expect(
        executeAnalysisProgram({
          tables: [table('values', ['1'])],
          code: `${mutation};${result('tables[0].rows[0].value')}`,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
    },
  );

  it('keeps pristine shape validation even if guest mutates Array.isArray', async () => {
    await expect(
      executeAnalysisProgram({
        tables: [table('values', ['1'])],
        code: 'Array.isArray=()=>true;return {length:1,0:{title:"Fake",rows:[]}};',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it('cannot suppress invalid arithmetic by catching its guest exception', async () => {
    await expect(
      executeAnalysisProgram({
        tables: [table('values', ['1'])],
        code: `try {calc.add(tables[0].rows[0].value,123)} catch {} ${result('tables[0].rows[0].value')}`,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it.each([
    ['calc.add(tables[0].rows[0].value,tables[1].rows[0].value)', 'money'],
    ['calc.mul(tables[0].rows[0].value,tables[0].rows[0].value)', 'money'],
    ['tables[0].rows[0].value', 'percent'],
    ['tables[0].rows[0].value', 'number'],
    ['tables[1].rows[0].value', 'money'],
  ])('rejects incompatible units or display for %s', async (expression, format) => {
    await expect(
      executeAnalysisProgram({
        tables: [table('money', ['10']), table('count', ['2'], { unit: 'count' })],
        code: result(expression, format),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it.each(['missing', 'duplicate', 'period', 'unit', 'source', 'dimensions'])(
    'refuses mismatched alignment: %s',
    async (kind) => {
      const left = table('left', ['1', '2']);
      const right = table('right', ['3', '4']);
      if (kind === 'missing') right.rows.pop();
      if (kind === 'duplicate') right.rows[1] = { ...right.rows[0], id: 'other-id' };
      if (kind === 'period') right.rows[1].to = '2026-02-27';
      if (kind === 'unit') right.rows[1].unit = 'count';
      if (kind === 'source') right.rows[1].source = 'draft';
      if (kind === 'dimensions')
        right.rows[1].dimensions = [{ kind: 'account', key: '5010', accountId: 'rent' }];
      await expect(executeAnalysisProgram({ tables: [left, right], code: ratios })).rejects.toMatchObject({
        code: 'INVALID_ANALYSIS_PROGRAM',
      });
    },
  );

  it('does not trust modified row metadata during alignment', async () => {
    const left = table('left', ['1']);
    const right = table('right', ['2']);
    right.rows[0].to = '2026-01-30';
    await expect(
      executeAnalysisProgram({
        tables: [left, right],
        code: `const a=tables[0].rows; const b=tables[1].rows.map(r=>({...r,to:a[0].to}));return [{title:'Wrong join',rows:calc.align(a,b).map(({left,right})=>({label:left.label,value:calc.div(left.value,right.value),format:'percent'}))}];`,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it('rejects truncated or duplicate source identities before execution', async () => {
    const truncated = table('values', ['1']);
    truncated.truncated = true;
    await expect(
      executeAnalysisProgram({ tables: [truncated], code: result('tables[0].rows[0].value') }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
    const duplicate = table('values', ['1', '2']);
    duplicate.rows[1].id = duplicate.rows[0].id;
    await expect(
      executeAnalysisProgram({ tables: [duplicate], code: result('tables[0].rows[0].value') }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it('enforces source size, output count and label bounds', async () => {
    const tables = [table('values', ['1'])];
    await expect(
      executeAnalysisProgram({ tables, code: ' '.repeat(16385) + result('tables[0].rows[0].value') }),
    ).rejects.toMatchObject({ code: 'ANALYSIS_PROGRAM_LIMIT' });
    await expect(
      executeAnalysisProgram({
        tables,
        code: `return [{title:'Too many',rows:Array.from({length:65},()=>({label:'Value',value:tables[0].rows[0].value,format:'money'}))}];`,
      }),
    ).rejects.toMatchObject({ code: 'ANALYSIS_PROGRAM_LIMIT' });
    await expect(
      executeAnalysisProgram({
        tables,
        code: `return [{title:'Too long',rows:[{label:'x'.repeat(301),value:tables[0].rows[0].value,format:'money'}]}];`,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it('enforces a shared total output-row bound across tables', async () => {
    await expect(
      executeAnalysisProgram({
        tables: [table('values', ['1'])],
        code: `const rows=Array.from({length:40},()=>({label:'Value',value:tables[0].rows[0].value,format:'money'}));return [{title:'A',rows},{title:'B',rows}];`,
      }),
    ).rejects.toMatchObject({ code: 'ANALYSIS_PROGRAM_LIMIT' });
  });

  it('interrupts infinite execution at the outer monotonic deadline', async () => {
    await expect(
      executeAnalysisProgram({
        tables: [table('values', ['1'])],
        code: 'while(true) {}',
        deadline: performance.now() + 30,
      }),
    ).rejects.toMatchObject({ code: 'ANALYSIS_PROGRAM_LIMIT' });
  });

  it('limits host operations even if generated code catches exceptions', async () => {
    await expect(
      executeAnalysisProgram({
        tables: [table('values', ['1'])],
        code: `for(let i=0;i<6000;i++) {try {calc.abs(tables[0].rows[0].value)} catch {}}${result('tables[0].rows[0].value')}`,
      }),
    ).rejects.toMatchObject({ code: 'ANALYSIS_PROGRAM_LIMIT' });
  });

  it('contains guest allocation and stack exhaustion', async () => {
    const tables = [table('values', ['1'])];
    await expect(
      executeAnalysisProgram({
        tables,
        code: 'const big=[];while(true)big.push(new Array(10000).fill("allocated"));',
      }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(?:INVALID_ANALYSIS_PROGRAM|ANALYSIS_PROGRAM_LIMIT)$/),
    });
    await expect(
      executeAnalysisProgram({ tables, code: 'function recurse(){return recurse()}recurse();' }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it('enforces memory bounds for a single oversized allocation and remains usable', async () => {
    const tables = [table('values', ['1'])];
    await expect(
      executeAnalysisProgram({ tables, code: 'return new ArrayBuffer(32 * 1024 * 1024);' }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
    const next = await executeAnalysisProgram({ tables, code: result('tables[0].rows[0].value') });
    expect(next.tables[0].rows[0].value).toBe('$1.00');
  });

  it('bounds code executed by output getters during host extraction', async () => {
    await expect(
      executeAnalysisProgram({
        tables: [table('values', ['1'])],
        deadline: performance.now() + 30,
        code: `return [{title:'Getter',rows:[{label:'Value',get value(){while(true){}},format:'money'}]}];`,
      }),
    ).rejects.toMatchObject({ code: 'ANALYSIS_PROGRAM_LIMIT' });
  });

  it('rejects throwing output getters without leaking guest error text or handles', async () => {
    const tables = [table('values', ['1'])];
    await expect(
      executeAnalysisProgram({
        tables,
        code: `return [{title:'Getter',rows:[{get label(){throw new Error('untrusted private error')},value:tables[0].rows[0].value,format:'money'}]}];`,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_ANALYSIS_PROGRAM',
      message: expect.not.stringContaining('untrusted private error'),
    });
    const next = await executeAnalysisProgram({ tables, code: result('tables[0].rows[0].value') });
    expect(next.tables[0].rows[0].value).toBe('$1.00');
  });

  it('rejects a numeric constructor disguised as a source array', async () => {
    await expect(
      executeAnalysisProgram({
        tables: [table('values', ['1'])],
        code: result('calc.count([1,2,3])', 'number'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it.each(['Array(123).fill(tables[0].rows[0].value)', '[calc.abs(tables[0].rows[0].value)]'])(
    'does not manufacture a count from duplicated or computed values: %s',
    async (items) => {
      await expect(
        executeAnalysisProgram({
          tables: [table('values', ['1'])],
          code: result(`calc.count(${items})`, 'number'),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
    },
  );

  it.each(['[]', '[{title:"Empty answer",rows:[]}]'])(
    'rejects an empty final answer: %s',
    async (expression) => {
      await expect(
        executeAnalysisProgram({ tables: [table('values', ['1'])], code: `return ${expression};` }),
      ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
    },
  );

  it('rejects amounts or computations beyond exact magnitude bounds', async () => {
    await expect(
      executeAnalysisProgram({
        tables: [table('values', ['999999999999999999'])],
        code: result('tables[0].rows[0].value'),
      }),
    ).rejects.toMatchObject({ code: 'ANALYSIS_PROGRAM_LIMIT' });
    await expect(
      executeAnalysisProgram({
        tables: [table('values', ['999999999999999'])],
        code: result('calc.sum([tables[0].rows[0].value,tables[0].rows[0].value])'),
      }),
    ).rejects.toMatchObject({ code: 'ANALYSIS_PROGRAM_LIMIT' });
  });

  it('supports a verified point-in-time cash balance without dropping its as-of date', async () => {
    const cash = table('cash', ['1500']);
    cash.rows[0] = {
      ...cash.rows[0],
      id: 'total:total',
      from: null,
      to: '2026-11-03',
      balanceAsOf: '2026-11-03',
    };
    const actual = await executeAnalysisProgram({
      tables: [cash, table('expenses', ['300'])],
      code: result('calc.sub(tables[0].rows[0].value,tables[1].rows[0].value)'),
    });
    expect(actual.tables[0].rows[0]).toMatchObject({
      value: '$1,200.00',
      references: [
        { queryId: 'cash', rowId: 'total:total' },
        { queryId: 'expenses', rowId: 'month:2026-01' },
      ],
    });
  });

  it.each(['missing', 'mismatch'])('rejects an invalid point balance marker: %s', async (kind) => {
    const cash = table('cash', ['1500']);
    cash.rows[0].from = null;
    if (kind === 'mismatch') cash.rows[0].balanceAsOf = '2026-01-30';
    await expect(
      executeAnalysisProgram({ tables: [cash], code: result('tables[0].rows[0].value') }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it('does not align a closing balance with period activity as the same kind of row', async () => {
    const balance = table('balance', ['1500']);
    balance.rows[0].balanceAsOf = balance.rows[0].to!;
    await expect(
      executeAnalysisProgram({ tables: [balance, table('activity', ['300'])], code: ratios }),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_PROGRAM' });
  });

  it('aligns account rows by account identity even when their dates are identical', async () => {
    const left = table('left', ['100', '200']);
    const right = table('right', ['400', '1000']);
    for (const item of [left, right])
      item.rows = item.rows.map((row, index) => ({
        ...row,
        id: `account:${index}`,
        from: '2026-01-01',
        to: '2026-12-31',
      }));
    right.rows.reverse();
    const actual = await executeAnalysisProgram({ tables: [left, right], code: ratios });
    expect(actual.tables[0].rows.map((row) => row.value)).toEqual(['25.00%', '20.00%']);
  });

  it('bounds serialized output including expanded source references', async () => {
    const values = table('values', ['1']);
    values.rows = Array.from({ length: 50 }, (_, i) => ({
      ...values.rows[0],
      id: `entry:${i}:${'x'.repeat(980)}`,
    }));
    await expect(
      executeAnalysisProgram({
        tables: [values],
        code: `const sum=calc.sum(tables[0].rows.map(r=>r.value));return [{title:'Large references',rows:Array.from({length:64},()=>({label:'Sum',value:sum,format:'money'}))}];`,
      }),
    ).rejects.toMatchObject({ code: 'ANALYSIS_PROGRAM_LIMIT' });
  });
});
