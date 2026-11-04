import { describe, expect, it } from 'vitest';
import type { AnalystCell, AnalystOutput } from '../shared/analyst';
import type { AnalystSqlResult } from '../server/analyst-sql';
import { analystPublicationSchema, buildAnalystNotebook } from '../server/analyst-notebook';

const organization = '09b744d7-e0ad-49d6-99af-f920814a8a3c';
function result(changes: Partial<AnalystSqlResult> = {}): AnalystSqlResult {
  return {
    id: 'monthly',
    sql: 'SELECT month, expense, share FROM analytics.accounts WHERE code = $1',
    params: ['5010'],
    organizationId: organization,
    executedAt: '2026-11-03T18:00:00.000Z',
    columns: [
      { name: 'month', oid: 1082, kind: 'date' },
      { name: 'expense', oid: 1700, kind: 'decimal' },
      { name: 'share', oid: 1700, kind: 'decimal' },
    ],
    rows: [
      ['2026-01-01', '9007199254740993.23', null],
      ['2026-02-01', '0.00', '3.0000'],
    ],
    rowCount: 2,
    truncated: false,
    hash: 'a'.repeat(64),
    ...changes,
  };
}
const input = () => ({
  title: 'Monthly spending',
  tables: [{ queryId: 'monthly', title: 'Executed amounts' }],
  charts: [
    {
      queryId: 'monthly',
      kind: 'line' as const,
      title: 'Monthly expenses',
      xColumn: 'month',
      yColumns: ['expense'],
      format: 'currency' as const,
      currency: 'USD',
    },
  ],
});
const map = (...results: AnalystSqlResult[]) => new Map(results.map((r) => [r.id, r]));
function outputs<T extends AnalystOutput['type']>(
  cells: AnalystCell[],
  type: T,
): Extract<AnalystOutput, { type: T }>[] {
  return cells.flatMap((cell) => cell.outputs).filter((output) => output.type === type) as Extract<
    AnalystOutput,
    { type: T }
  >[];
}
const chartInput = (change: Record<string, unknown> = {}) => ({
  ...input(),
  charts: [{ ...input().charts[0], ...change }],
});

describe('notebook publication bound to server query results', () => {
  it('preserves exact amounts, SQL, parameters, workspace and captured time without mutating saved results', () => {
    const saved = result(),
      before = structuredClone(saved);
    const notebook = buildAnalystNotebook(map(saved), input());
    expect(outputs(notebook, 'table')[0]).toEqual({
      type: 'table',
      columns: ['month', 'expense', 'share'],
      rows: [
        ['2026-01-01', '9007199254740993.23', null],
        ['2026-02-01', '0.00', '3.0000'],
      ],
      totalRows: 2,
      totalRowsKnown: true,
      truncated: false,
    });
    expect(outputs(notebook, 'chart')[0].chart.series).toEqual([
      { name: 'expense', values: ['9007199254740993.23', '0.00'] },
    ]);
    expect(outputs(notebook, 'chart')[0].chart.currency).toBe('USD');
    expect(notebook[1].code).toBe(saved.sql);
    const notices = outputs(notebook, 'notice')
      .map((notice) => notice.text)
      .join('\n');
    expect(notices).toContain(organization);
    expect(notices).toContain(saved.executedAt);
    expect(notices).toContain('["5010"]');
    expect(notices).toContain('monthly');
    outputs(notebook, 'table')[0].rows[0][1] = 'changed outside the server';
    expect(saved).toEqual(before);
  });

  it('keeps NULL distinct from zero and keeps percentage-point units without multiplying or rounding', () => {
    const notebook = buildAnalystNotebook(
      map(result()),
      chartInput({ yColumns: ['share'], format: 'percent', currency: undefined }),
    );
    const chart = outputs(notebook, 'chart')[0].chart;
    expect(chart.format).toBe('percent');
    expect(chart.series).toEqual([{ name: 'share', values: [null, '3.0000'] }]);
    expect(chart).not.toHaveProperty('currency');
    expect(chart.xScale).toBe('date');
  });

  it.each([
    { ...input(), rows: [['invented', '999']] },
    { ...input(), tables: [{ queryId: 'monthly', rows: [['999']] }] },
    chartInput({ values: ['999'], labels: ['invented'] }),
    chartInput({ queryId: 'monthly', series: [{ name: 'invented', values: ['999'] }] }),
  ])('refuses model-supplied result arrays or extra publication fields', (publication) => {
    expect(analystPublicationSchema.safeParse(publication).success).toBe(false);
    expect(() => buildAnalystNotebook(map(result()), publication)).toThrow(/Unrecognized key/);
  });

  it('cannot publish an unknown query ID or a map entry whose saved identity changed', () => {
    expect(() => buildAnalystNotebook(map(), input())).toThrow(/has not been executed/);
    expect(() => buildAnalystNotebook(new Map([['monthly', result({ id: 'other' })]]), input())).toThrow(
      /does not match its query reference/,
    );
  });

  it('does not copy unselected query results into the notebook', () => {
    const hidden = result({
      id: 'not-selected',
      sql: 'PRIVATE UNSELECTED QUERY',
      rows: [['2026-01-01', '123456789', '2']],
      rowCount: 1,
    });
    const serialized = JSON.stringify(buildAnalystNotebook(map(result(), hidden), input()));
    expect(serialized).not.toContain('PRIVATE UNSELECTED');
    expect(serialized).not.toContain('123456789');
  });

  it('refuses to mix workspaces even when the caller supplies both query IDs', () => {
    const other = result({ id: 'other', organizationId: 'd890edc4-9997-45fd-b5f9-89ab7c3500ee' });
    expect(() =>
      buildAnalystNotebook(map(result(), other), {
        title: 'Both',
        tables: [{ queryId: 'monthly' }, { queryId: 'other' }],
      }),
    ).toThrow(/different workspaces/);
  });

  it('labels model notes separately and never upgrades explanatory prose into query evidence', () => {
    const notebook = buildAnalystNotebook(map(), {
      title: 'Explanation',
      notes: 'Assume the future salary is $5,000 each month.',
    });
    expect(outputs(notebook, 'table')).toEqual([]);
    expect(outputs(notebook, 'chart')).toEqual([]);
    expect(outputs(notebook, 'markdown')).toEqual([
      { type: 'markdown', text: 'Assume the future salary is $5,000 each month.' },
    ]);
    expect(outputs(notebook, 'notice')[0].text).toMatch(/Analyst-written.*not an independent verification/);
  });

  it('retains an empty query as no rows, without fabricating a zero amount', () => {
    const notebook = buildAnalystNotebook(map(result({ rows: [], rowCount: 0 })), input());
    expect(outputs(notebook, 'table')[0].rows).toEqual([]);
    expect(outputs(notebook, 'table')[0].totalRows).toBe(0);
    expect(outputs(notebook, 'chart')[0].chart.labels).toEqual([]);
    expect(outputs(notebook, 'chart')[0].chart.series).toEqual([]);
    expect(
      outputs(notebook, 'notice')
        .map((n) => n.text)
        .join(' '),
    ).toContain('No values or zero balances have been inferred.');
  });

  it('shows an honest truncated table preview whose total row count is unknown', () => {
    const rows = Array.from({ length: 200 }, (_, i) => [String(i), '1.00', null]);
    const notebook = buildAnalystNotebook(map(result({ rows, rowCount: 200, truncated: true })), {
      title: 'Preview',
      tables: [{ queryId: 'monthly' }],
    });
    expect(outputs(notebook, 'table')[0]).toMatchObject({
      totalRows: 200,
      totalRowsKnown: false,
      truncated: true,
    });
    expect(outputs(notebook, 'table')[0].rows).toHaveLength(200);
    expect(
      outputs(notebook, 'notice')
        .map((n) => n.text)
        .join(' '),
    ).toContain('More rows exist; their total count is not known.');
  });

  it('refuses to draw an incomplete distribution from a truncated query', () => {
    expect(() => buildAnalystNotebook(map(result({ truncated: true })), input())).toThrow(
      /Aggregate or narrow the SQL/,
    );
  });

  it.each([{ xColumn: 'missing' }, { yColumns: ['missing'] }, { seriesColumn: 'missing' }])(
    'refuses unknown chart column references',
    (change) => {
      expect(() => buildAnalystNotebook(map(result()), chartInput(change))).toThrow(
        /has no column "missing"/,
      );
    },
  );

  it('refuses text-valued money columns even if they resemble numeric strings', () => {
    const saved = result();
    saved.columns[1] = { name: 'expense', oid: 25, kind: 'text' };
    expect(() => buildAnalystNotebook(map(saved), input())).toThrow(/not numeric/);
  });

  it.each(['NaN', 'Infinity', '-Infinity', '$123.45', '1,234', ' 123 ', 'null', '', '1e99999999999999999'])(
    'refuses invalid chart numbers: %s',
    (amount) => {
      const saved = result();
      saved.rows[0][1] = amount;
      expect(() => buildAnalystNotebook(map(saved), input())).toThrow(/non-numeric|non-finite/);
    },
  );

  it('requires explicit currency and rejects incompatible format declarations', () => {
    expect(() => buildAnalystNotebook(map(result()), chartInput({ currency: undefined }))).toThrow(
      /Declare the currency/,
    );
    expect(() => buildAnalystNotebook(map(result()), chartInput({ format: 'percent' }))).toThrow(
      /Currency applies only/,
    );
    expect(() => buildAnalystNotebook(map(result()), chartInput({ currency: 'usd' }))).toThrow();
  });

  it('refuses duplicate dimensions rather than silently summing, choosing one row, or inventing an average', () => {
    const saved = result({
      rows: [
        ['2026-01-01', '5.00', null],
        ['2026-01-01', '7.00', null],
      ],
    });
    expect(() => buildAnalystNotebook(map(saved), input())).toThrow(/Aggregate explicitly in SQL/);
  });

  it('recognizes equal numeric coordinates despite different decimal spellings', () => {
    const saved = result();
    saved.columns[0] = { name: 'month', oid: 1700, kind: 'decimal' };
    saved.rows = [
      ['1.0', '5.00', null],
      ['1.00', '7.00', null],
    ];
    expect(() => buildAnalystNotebook(map(saved), chartInput({ xScale: 'number' }))).toThrow(
      /repeated dimension\/series/,
    );
  });

  it('groups multiple series by returned keys, preserving gaps as NULL and original values as strings', () => {
    const saved = result({
      columns: [
        { name: 'month', oid: 25, kind: 'text' },
        { name: 'category', oid: 25, kind: 'text' },
        { name: 'amount', oid: 1700, kind: 'decimal' },
      ],
      rows: [
        ['January', 'Rent', '2400.00'],
        ['January', 'Supplies', '300.00'],
        ['February', 'Rent', '2400.00'],
      ],
      rowCount: 3,
    });
    const notebook = buildAnalystNotebook(
      map(saved),
      chartInput({ seriesColumn: 'category', yColumns: ['amount'] }),
    );
    expect(outputs(notebook, 'chart')[0].chart).toMatchObject({
      labels: ['January', 'February'],
      series: [
        { name: 'Rent', values: ['2400.00', '2400.00'] },
        { name: 'Supplies', values: ['300.00', null] },
      ],
    });
    saved.rows.push(['February', 'Rent', '25.00']);
    saved.rowCount++;
    expect(() =>
      buildAnalystNotebook(map(saved), chartInput({ seriesColumn: 'category', yColumns: ['amount'] })),
    ).toThrow(/repeated dimension\/series/);
  });

  it('preserves multiple numeric measures without merging or recomputing them', () => {
    const notebook = buildAnalystNotebook(
      map(result()),
      chartInput({ yColumns: ['expense', 'share'], format: 'number', currency: undefined }),
    );
    expect(outputs(notebook, 'chart')[0].chart.series).toEqual([
      { name: 'expense', values: ['9007199254740993.23', '0.00'] },
      { name: 'share', values: [null, '3.0000'] },
    ]);
  });

  it('leaves negative values available to line/bar charts but refuses invalid pies', () => {
    const saved = result();
    saved.rows[0][1] = '-123.4500';
    expect(outputs(buildAnalystNotebook(map(saved), input()), 'chart')[0].chart.series[0].values[0]).toBe(
      '-123.4500',
    );
    expect(() => buildAnalystNotebook(map(saved), chartInput({ kind: 'pie' }))).toThrow(/cannot be negative/);
    saved.rows[0][1] = '0.00';
    expect(() => buildAnalystNotebook(map(saved), chartInput({ kind: 'pie' }))).toThrow(/positive total/);
  });

  it('uses actual numeric scatter coordinates and validates unavailable dimensions', () => {
    const saved = result();
    saved.columns[0] = { name: 'month', oid: 1700, kind: 'decimal' };
    saved.rows = [
      ['1.000', '5.00', null],
      ['100.00', '7.00', null],
    ];
    const chart = outputs(buildAnalystNotebook(map(saved), chartInput({ kind: 'scatter' })), 'chart')[0]
      .chart;
    expect(chart.xScale).toBe('number');
    expect(chart.labels).toEqual(['1.000', '100.00']);
    saved.rows[1][0] = null;
    expect(() => buildAnalystNotebook(map(saved), input())).toThrow(/dimensions contain NULL/);
  });

  it('rejects more than four distinct references even when each section is individually within bounds', () => {
    const publication = {
      title: 'Too many',
      tables: ['a', 'b', 'c', 'd'].map((queryId) => ({ queryId })),
      charts: [{ ...input().charts[0], queryId: 'e' }],
    };
    expect(() => buildAnalystNotebook(map(), publication)).toThrow(/at most four distinct/);
  });

  it('rejects too many rows, inconsistent row counts and duplicate columns', () => {
    const saved = result({
      rows: Array.from({ length: 201 }, () => ['2026-01-01', '1', null]),
      rowCount: 201,
    });
    expect(() => buildAnalystNotebook(map(saved), input())).toThrow(/too large/);
    expect(() => buildAnalystNotebook(map(result({ rowCount: 3 })), input())).toThrow(/row count/);
    const duplicate = result();
    duplicate.columns[1].name = 'month';
    expect(() => buildAnalystNotebook(map(duplicate), input())).toThrow(/unique names/);
  });
});
