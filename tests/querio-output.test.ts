import { describe, expect, it } from 'vitest';
import { normalizeQuerioOutput } from '../server/querio-output';

const completed = (presentation?: unknown, extra: Record<string, unknown> = {}) => ({
  status: 'completed',
  output: {
    finalAnswerMarkdown: 'Here are the recorded results.',
    cells: presentation ? [{ cellId: 'result', presentation }] : [],
    ...extra,
  },
});
const notebook = {
  serialization: {
    cells: [{ cell_id: 'result', name: 'Monthly results', code: 'result = cee.sql("SELECT ...")' }],
  },
};
const staticChart = (overrides: Record<string, unknown> = {}) => ({
  type: 'chart',
  format: 'vega-lite',
  title: 'Monthly expense',
  spec: {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.1.0.json',
    data: { name: 'query-result' },
    datasets: {
      'query-result': [
        { month_start: '2026-01-01', amount: '50.00' },
        { month_start: '2026-02-01', amount: null },
        { month_start: '2026-03-01', amount: '66.67' },
      ],
    },
    mark: { type: 'bar', color: '#1666FB' },
    encoding: {
      x: { field: 'month_start', type: 'ordinal', timeUnit: 'yearmonth', title: 'Month' },
      y: { field: 'amount', type: 'quantitative', title: 'Expense' },
      tooltip: [{ field: 'amount', type: 'quantitative' }],
    },
    ...overrides,
  },
});

describe('Querio output normalization', () => {
  it('joins observed run presentation with the saved notebook source', () => {
    const result = normalizeQuerioOutput(
      completed({
        type: 'table',
        columns: ['Category', 'Amount'],
        rows: [['Rent', '12345678901234567890.01']],
        totalRows: 1,
        totalColumns: 2,
        rowsTruncated: false,
        columnsTruncated: false,
      }),
      notebook,
    );
    expect(result.answer).toBe('Here are the recorded results.');
    expect(result.cells).toEqual([
      {
        id: 'result',
        title: 'Monthly results',
        code: 'result = cee.sql("SELECT ...")',
        outputs: [
          {
            type: 'table',
            columns: ['Category', 'Amount'],
            rows: [['Rent', '12345678901234567890.01']],
            totalRows: 1,
            truncated: false,
          },
        ],
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('prefers the final answer over intermediate assistant messages', () => {
    const result = normalizeQuerioOutput(
      completed(undefined, {
        finalAnswerMarkdown: 'The result is ready.',
        assistantMessages: [{ markdown: 'Let me inspect the books.' }],
      }),
      null,
    );
    expect(result.answer).toBe('The result is ready.');
  });

  it('uses the last actual assistant message when the final field is absent', () => {
    const result = normalizeQuerioOutput(
      completed(undefined, {
        finalAnswerMarkdown: null,
        assistantMessages: [{ markdown: 'Starting.' }, { markdown: 'Actual final text.' }, { markdown: '' }],
      }),
      null,
    );
    expect(result.answer).toBe('Actual final text.');
  });

  it.each(['pending', 'running', 'failed', 'cancelled', undefined])(
    'does not present an incomplete %s run as an answer',
    (status) => {
      expect(normalizeQuerioOutput({ ...completed(), status }, null).answer).toBe('');
    },
  );

  it('does not invent a completed answer when the provider returned none', () => {
    const result = normalizeQuerioOutput({ status: 'completed', output: { cells: [] } }, null);
    expect(result.answer).toBe('');
    expect(result.warnings.join(' ')).toContain('without a final text answer');
  });

  it('never reuses saved outputs as evidence of the current run', () => {
    const saved = {
      serialization: {
        cells: [{ cell_id: 'old', code: 'old_query()', output: { type: 'table', rows: [['999']] } }],
      },
    };
    expect(normalizeQuerioOutput(completed(), saved).cells[0].outputs).toEqual([]);
  });

  it('converts HTML and entities to inert readable text without scripts, styles, or active tags', () => {
    const result = normalizeQuerioOutput(
      completed({
        type: 'html',
        html: '<style>body{display:none}</style><script>alert(1)</script><p>Rent &amp; fees &#36;120.00</p><img src="https://hostile.invalid/a" onerror="alert(2)"><p>&#x20AC;10 &mdash; reviewed</p>',
      }),
      notebook,
    );
    expect(result.cells[0].outputs).toEqual([
      { type: 'markdown', text: 'Rent & fees $120.00\n€10 — reviewed' },
    ]);
    expect(JSON.stringify(result.cells[0].outputs)).not.toMatch(/script|style|img|onerror|hostile/);
  });

  it('removes encoded tags, unfinished executable blocks, and invalid Unicode entities', () => {
    const first = normalizeQuerioOutput(
      completed({
        type: 'html',
        html: '&lt;script&gt;bad()&lt;/script&gt;<p>A &#x110000;</p><script>unfinished',
      }),
      null,
    );
    expect(first.cells[0].outputs).toEqual([{ type: 'markdown', text: 'A �' }]);
  });

  it('supports tables with named columns and row objects without numeric coercion', () => {
    const result = normalizeQuerioOutput(
      completed({
        type: 'table',
        columns: [{ name: 'amount', type: 'string' }],
        rows: [{ amount: '0.0100' }],
      }),
      null,
    );
    expect(result.cells[0].outputs).toEqual([
      { type: 'table', columns: ['amount'], rows: [['0.0100']], totalRows: 1, truncated: false },
    ]);
  });

  it('marks row, column, and value truncation explicitly', () => {
    const result = normalizeQuerioOutput(
      completed({
        type: 'table',
        columns: Array.from({ length: 31 }, (_, i) => `C${i}`),
        rows: Array.from({ length: 205 }, () => Array.from({ length: 31 }, () => 'x'.repeat(2001))),
        totalRows: 300,
      }),
      null,
    );
    const value = result.cells[0].outputs[0];
    expect(value.type).toBe('table');
    if (value.type !== 'table') throw new Error('Expected table');
    expect(value.rows).toHaveLength(200);
    expect(value.columns).toHaveLength(30);
    expect(value.totalRows).toBe(300);
    expect(value.truncated).toBe(true);
    expect(value.rows[0][0]).toHaveLength(2001);
    expect(result.warnings.join(' ')).toContain('incomplete');
  });

  it('preserves provider-declared truncation even when the preview is small', () => {
    const result = normalizeQuerioOutput(
      completed({ type: 'table', columns: ['A'], rows: [['1']], totalRows: 1, columnsTruncated: true }),
      null,
    );
    expect(result.cells[0].outputs[0]).toMatchObject({ truncated: true });
  });

  it('normalizes the actual observed Vega-Lite bar presentation shape with null months', () => {
    const result = normalizeQuerioOutput(completed(staticChart()), notebook);
    expect(result.cells[0].outputs).toEqual([
      {
        type: 'chart',
        chart: {
          kind: 'bar',
          title: 'Monthly expense',
          xLabel: 'Month',
          xScale: 'category',
          yLabel: 'Expense',
          labels: ['2026-01', '2026-02', '2026-03'],
          series: [{ name: 'Expense', values: ['50.00', null, '66.67'] }],
        },
      },
    ]);
  });

  it.each(['line', 'area'])('supports static %s charts without interpreting code', (mark) => {
    const result = normalizeQuerioOutput(completed(staticChart({ mark })), null);
    expect(result.cells[0].outputs[0]).toMatchObject({ type: 'chart', chart: { kind: mark } });
  });

  it('aligns categorical series by label without filling missing values with invented zeroes', () => {
    const result = normalizeQuerioOutput(
      completed(
        staticChart({
          data: {
            values: [
              { month: 'Jan', amount: '12.30', category: 'Rent' },
              { month: 'Feb', amount: '4.20', category: 'Supplies' },
            ],
          },
          encoding: {
            x: { field: 'month', type: 'nominal' },
            y: { field: 'amount', type: 'quantitative', stack: null },
            color: { field: 'category', type: 'nominal' },
          },
        }),
      ),
      null,
    );
    expect(result.cells[0].outputs[0]).toMatchObject({
      type: 'chart',
      chart: {
        labels: ['Jan', 'Feb'],
        series: [
          { name: 'Rent', values: ['12.30', null] },
          { name: 'Supplies', values: [null, '4.20'] },
        ],
      },
    });
  });

  it('supports horizontal bar, pie, and scatter data shapes', () => {
    const common = { data: { values: [{ category: 'One', amount: 2 }] } };
    const horizontal = normalizeQuerioOutput(
      completed(
        staticChart({
          ...common,
          encoding: {
            x: { field: 'amount', type: 'quantitative' },
            y: { field: 'category', type: 'nominal' },
          },
        }),
      ),
      null,
    );
    expect(horizontal.cells[0].outputs[0]).toMatchObject({
      type: 'chart',
      chart: { labels: ['One'], xLabel: 'category', yLabel: 'amount' },
    });
    const pie = normalizeQuerioOutput(
      completed(
        staticChart({
          ...common,
          mark: 'arc',
          encoding: {
            theta: { field: 'amount', type: 'quantitative' },
            color: { field: 'category', type: 'nominal' },
          },
        }),
      ),
      null,
    );
    expect(pie.cells[0].outputs[0]).toMatchObject({
      type: 'chart',
      chart: { kind: 'pie', labels: ['One'], series: [{ name: 'amount', values: ['2'] }] },
    });
    const scatter = normalizeQuerioOutput(
      completed(
        staticChart({
          mark: 'point',
          data: {
            values: [
              { x: 1, y: 2 },
              { x: 1, y: 3 },
            ],
          },
          encoding: { x: { field: 'x', type: 'quantitative' }, y: { field: 'y', type: 'quantitative' } },
        }),
      ),
      null,
    );
    expect(scatter.cells[0].outputs[0]).toMatchObject({
      type: 'chart',
      chart: {
        kind: 'scatter',
        xScale: 'number',
        labels: ['1', '1'],
        series: [{ name: 'y', values: ['2', '3'] }],
      },
    });
  });

  it('preserves temporal and numeric axis spacing through the public chart contract', () => {
    const date = normalizeQuerioOutput(
      completed(
        staticChart({
          mark: 'line',
          data: {
            values: [
              { day: '2026-01-01', amount: 1 },
              { day: '2026-03-01', amount: 2 },
            ],
          },
          encoding: { x: { field: 'day', type: 'temporal' }, y: { field: 'amount', type: 'quantitative' } },
        }),
      ),
      null,
    );
    expect(date.cells[0].outputs[0]).toMatchObject({
      type: 'chart',
      chart: { xScale: 'date', labels: ['2026-01-01', '2026-03-01'] },
    });
    const numeric = normalizeQuerioOutput(
      completed(
        staticChart({
          mark: 'line',
          data: {
            values: [
              { quantity: 1, amount: 1 },
              { quantity: 10, amount: 2 },
            ],
          },
          encoding: {
            x: { field: 'quantity', type: 'quantitative' },
            y: { field: 'amount', type: 'quantitative' },
          },
        }),
      ),
      null,
    );
    expect(numeric.cells[0].outputs[0]).toMatchObject({
      type: 'chart',
      chart: { xScale: 'number', labels: ['1', '10'] },
    });
  });

  it.each([
    { transform: [{ calculate: 'datum.amount * 100', as: 'amount' }] },
    { data: { url: 'https://attacker.invalid/ledger' } },
    { data: { values: [{ month_start: 'Jan', amount: 'not a number' }] } },
    {
      encoding: {
        x: { field: 'month_start', type: 'ordinal' },
        y: { field: 'amount', type: 'quantitative', aggregate: 'sum' },
      },
    },
    {
      encoding: {
        x: { field: 'month_start', type: 'ordinal' },
        y: { field: 'amount', type: 'quantitative', axis: { format: '.1%' } },
      },
    },
    {
      encoding: {
        x: { field: 'month_start', type: 'ordinal' },
        y: { field: 'amount', type: 'quantitative', scale: { type: 'log' } },
      },
    },
    { layer: [{ mark: 'bar' }] },
    { params: [{ name: 'hostile', expr: 'fetch("https://attacker.invalid")' }] },
    { mark: 'geoshape' },
    { mark: 'constructor' },
    {
      data: {
        values: [
          { category: 'One', amount: 2, series: 'A' },
          { category: 'One', amount: 3, series: 'B' },
        ],
      },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'amount', type: 'quantitative' },
        color: { field: 'series', type: 'nominal' },
      },
    },
    { data: { values: Array.from({ length: 201 }, (_, i) => ({ month_start: String(i), amount: i })) } },
  ])('does not draw unsupported or potentially misleading chart %j', (spec) => {
    const result = normalizeQuerioOutput(completed(staticChart(spec)), notebook);
    expect(result.cells[0].code).toContain('cee.sql');
    expect(result.cells[0].outputs[0]).toMatchObject({ type: 'notice' });
    expect(result.warnings.join(' ')).toContain('cannot be displayed faithfully');
  });

  it('rejects duplicate category coordinates instead of silently overwriting or aggregating', () => {
    const result = normalizeQuerioOutput(
      completed(
        staticChart({
          data: {
            values: [
              { month_start: '2026-01-01', amount: 1 },
              { month_start: '2026-01-02', amount: 2 },
            ],
          },
        }),
      ),
      null,
    );
    expect(result.cells[0].outputs[0].type).toBe('notice');
  });

  it('does not use inherited row fields as chart values', () => {
    const row = Object.create({ month_start: '2026-01-01', amount: 1 });
    const result = normalizeQuerioOutput(completed(staticChart({ data: { values: [row] } })), null);
    expect(result.cells[0].outputs[0].type).toBe('notice');
  });

  it('bounds large text and cell collections with visible warnings', () => {
    const run = completed(undefined, {
      finalAnswerMarkdown: 'x'.repeat(30_001),
      cells: Array.from({ length: 70 }, (_, i) => ({
        cellId: `c${i}`,
        presentation: { type: 'text', text: String(i) },
      })),
    });
    const result = normalizeQuerioOutput(run, null);
    expect(result.answer).toHaveLength(30_001);
    expect(result.cells).toHaveLength(60);
    expect(result.warnings).toContain('Only the first 60 notebook cells are displayed.');
    expect(result.warnings).toContain('Answer was shortened for display.');
  });

  it.each([
    undefined,
    null,
    false,
    10,
    'unexpected',
    [],
    { output: null },
    { output: { cells: [null, 'bad'], assistantMessages: [null] } },
  ])('handles malformed response %j without executing or inventing output', (value) => {
    expect(() => normalizeQuerioOutput(value, { serialization: { cells: [null] } })).not.toThrow();
    expect(normalizeQuerioOutput(value, null).answer).toBe('');
  });
});
