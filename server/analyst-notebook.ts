import Decimal from 'decimal.js';
import { z } from 'zod';
import type { AnalystCell, AnalystChart, AnalystOutput } from '../shared/analyst';
import type { AnalystSqlResult } from './analyst-sql';

export const ANALYST_NOTEBOOK_LIMITS = Object.freeze({
  queries: 4,
  tables: 4,
  charts: 4,
  rows: 200,
  points: 200,
  series: 12,
});
const identifier = z.string().min(1).max(100);
const title = z.string().trim().min(1).max(240);
const chartPublication = z
  .strictObject({
    queryId: identifier,
    kind: z.enum(['bar', 'line', 'area', 'pie', 'scatter']),
    title,
    xColumn: identifier,
    yColumns: z.array(identifier).min(1).max(ANALYST_NOTEBOOK_LIMITS.series),
    seriesColumn: identifier.optional(),
    format: z.enum(['number', 'currency', 'percent']),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    xScale: z.enum(['category', 'number', 'date']).optional(),
  })
  .superRefine((input, context) => {
    if (new Set(input.yColumns).size !== input.yColumns.length)
      context.addIssue({ code: 'custom', path: ['yColumns'], message: 'Select each numeric column once.' });
    if (input.format === 'currency' && !input.currency)
      context.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Declare the currency of the selected result values explicitly.',
      });
    if (input.format !== 'currency' && input.currency)
      context.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Currency applies only to currency-formatted values.',
      });
  });

/** Charts reference server result columns, never model-supplied arrays. Percent uses percentage points: 3 = 3%, not 300%. */
export const analystPublicationSchema = z
  .strictObject({
    title,
    notes: z.string().trim().min(1).max(6000).optional(),
    tables: z
      .array(z.strictObject({ queryId: identifier, title: title.optional() }))
      .max(ANALYST_NOTEBOOK_LIMITS.tables)
      .default([]),
    charts: z.array(chartPublication).max(ANALYST_NOTEBOOK_LIMITS.charts).default([]),
  })
  .superRefine((input, context) => {
    const references = new Set([...input.tables, ...input.charts].map((part) => part.queryId));
    if (references.size > ANALYST_NOTEBOOK_LIMITS.queries)
      context.addIssue({ code: 'custom', message: 'Publish at most four distinct query results.' });
    if (!references.size && !input.notes)
      context.addIssue({
        code: 'custom',
        message: 'Include executed query results or clearly labeled explanatory notes.',
      });
    if (new Set(input.tables.map((table) => table.queryId)).size !== input.tables.length)
      context.addIssue({ code: 'custom', path: ['tables'], message: 'Publish each query table once.' });
  });
export type AnalystPublication = z.infer<typeof analystPublicationSchema>;
export type AnalystChartPublication = AnalystPublication['charts'][number];

export class AnalystNotebookError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AnalystNotebookError';
  }
}
const fail = (code: string, message: string): never => {
  throw new AnalystNotebookError(code, message);
};
const numericKinds = new Set(['decimal', 'integer', 'float']);
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
function numeric(value: string, column: string): Decimal {
  if (!decimalPattern.test(value))
    return fail(
      'ANALYST_NOTEBOOK_VALUE',
      `Column "${column}" contains a non-numeric chart value. Return numeric SQL values or NULL.`,
    );
  const number = new Decimal(value);
  if (!number.isFinite())
    return fail('ANALYST_NOTEBOOK_VALUE', `Column "${column}" contains a non-finite chart value.`);
  return number;
}
function columnIndex(result: AnalystSqlResult, name: string, numericRequired = false) {
  const index = result.columns.findIndex((column) => column.name === name);
  if (index < 0)
    return fail(
      'ANALYST_NOTEBOOK_COLUMN',
      `Query "${result.id}" has no column "${name}". Use a returned column name.`,
    );
  if (numericRequired && !numericKinds.has(result.columns[index].kind))
    return fail(
      'ANALYST_NOTEBOOK_COLUMN',
      `Column "${name}" is not numeric. Cast or calculate it as a numeric SQL column before charting.`,
    );
  return index;
}
function validateResult(result: AnalystSqlResult, id: string) {
  if (result.id !== id)
    fail('ANALYST_NOTEBOOK_REFERENCE', `The saved result for "${id}" does not match its query reference.`);
  if (result.rows.length > ANALYST_NOTEBOOK_LIMITS.rows || result.columns.length > 40)
    fail(
      'ANALYST_NOTEBOOK_LIMIT',
      'This saved result is too large. Narrow or aggregate the query before publishing.',
    );
  if (
    !result.columns.length ||
    new Set(result.columns.map((column) => column.name)).size !== result.columns.length
  )
    fail(
      'ANALYST_NOTEBOOK_COLUMN',
      'Query output columns must have unique names. Add SQL aliases before publishing.',
    );
  if (
    result.rows.some(
      (row) =>
        row.length !== result.columns.length ||
        row.some((value) => value !== null && typeof value !== 'string'),
    )
  )
    fail(
      'ANALYST_NOTEBOOK_VALUE',
      'The saved result has malformed rows. Reexecute the query before publishing.',
    );
  if (!Number.isSafeInteger(result.rowCount) || result.rowCount !== result.rows.length)
    fail(
      'ANALYST_NOTEBOOK_VALUE',
      'The saved row count does not match the returned preview. Reexecute the query.',
    );
}

function buildChart(result: AnalystSqlResult, input: AnalystChartPublication): AnalystChart {
  if (result.truncated)
    return fail(
      'ANALYST_NOTEBOOK_TRUNCATED_CHART',
      `Query "${result.id}" has more rows than its preview. Aggregate or narrow the SQL to at most 200 rows before charting; a partial result is not a full distribution.`,
    );
  const xIndex = columnIndex(result, input.xColumn);
  const yIndexes = input.yColumns.map((name) => columnIndex(result, name, true));
  const groupIndex = input.seriesColumn ? columnIndex(result, input.seriesColumn) : null;
  const xKind = result.columns[xIndex].kind;
  const xScale =
    input.xScale ??
    (numericKinds.has(xKind) ? 'number' : ['date', 'timestamp'].includes(xKind) ? 'date' : 'category');
  if (xScale === 'number' && !numericKinds.has(xKind))
    return fail(
      'ANALYST_NOTEBOOK_COLUMN',
      `Column "${input.xColumn}" must be numeric for a numeric horizontal scale.`,
    );
  if (input.kind === 'scatter' && xScale === 'category')
    return fail(
      'ANALYST_NOTEBOOK_COLUMN',
      'A scatter chart needs a numeric or date horizontal column. Choose a bar chart for categories.',
    );
  if (input.kind === 'pie' && (input.yColumns.length !== 1 || groupIndex !== null))
    return fail(
      'ANALYST_NOTEBOOK_CHART',
      'A pie chart needs one numeric column and one category column. Aggregate groups in SQL first.',
    );
  const labels: string[] = [];
  const labelIndexes = new Map<string, number>();
  const series = new Map<string, { name: string; values: Map<number, string | null> }>();
  const displayNames = new Set<string>();
  const coordinates = new Set<string>();
  let positivePieValue = false;
  for (const row of result.rows) {
    const rawX = row[xIndex];
    const rawGroup = groupIndex === null ? undefined : row[groupIndex];
    if (rawX === null || rawGroup === null)
      return fail(
        'ANALYST_NOTEBOOK_VALUE',
        'Chart dimensions contain NULL. Label missing groups explicitly in SQL or publish the table instead.',
      );
    let dimensionKey = rawX;
    if (xScale === 'number') dimensionKey = numeric(rawX, input.xColumn).toString();
    else if (xScale === 'date') {
      if (!/^\d{4}(?:-\d{2}(?:-\d{2}(?:[ T].*)?)?)?$/.test(rawX) || !Number.isFinite(Date.parse(rawX)))
        return fail(
          'ANALYST_NOTEBOOK_VALUE',
          `Column "${input.xColumn}" contains a date that cannot be plotted. Return ISO dates or timestamps.`,
        );
      dimensionKey = String(Date.parse(rawX));
    }
    const coordinate = JSON.stringify([dimensionKey, rawGroup]);
    if (coordinates.has(coordinate))
      return fail(
        'ANALYST_NOTEBOOK_DUPLICATE',
        `Query "${result.id}" has repeated dimension/series coordinates. Aggregate explicitly in SQL; the notebook never guesses how to combine rows.`,
      );
    coordinates.add(coordinate);
    let position = labelIndexes.get(dimensionKey);
    if (position === undefined) {
      position = labels.length;
      labels.push(rawX);
      labelIndexes.set(dimensionKey, position);
    }
    for (const [yPosition, yIndex] of yIndexes.entries()) {
      const raw = row[yIndex];
      if (raw !== null) {
        const amount = numeric(raw, input.yColumns[yPosition]);
        if (input.kind === 'pie' && amount.isNegative() && !amount.isZero())
          return fail(
            'ANALYST_NOTEBOOK_CHART',
            'Pie chart values cannot be negative. Use a bar chart to show credits or negative balances.',
          );
        if (input.kind === 'pie' && amount.greaterThan(0)) positivePieValue = true;
      }
      const key = JSON.stringify([rawGroup, input.yColumns[yPosition]]);
      let current = series.get(key);
      if (!current) {
        const name =
          rawGroup === undefined
            ? input.yColumns[yPosition]
            : input.yColumns.length === 1
              ? rawGroup
              : `${rawGroup} · ${input.yColumns[yPosition]}`;
        if (displayNames.has(name))
          return fail(
            'ANALYST_NOTEBOOK_CHART',
            'Series labels collide. Give groups or numeric columns distinct SQL labels.',
          );
        displayNames.add(name);
        current = { name, values: new Map() };
        series.set(key, current);
        if (series.size > ANALYST_NOTEBOOK_LIMITS.series)
          return fail(
            'ANALYST_NOTEBOOK_LIMIT',
            'This chart has too many series. Aggregate or narrow the query to at most 12 series.',
          );
      }
      current.values.set(position, raw);
    }
  }
  if (labels.length > ANALYST_NOTEBOOK_LIMITS.points)
    return fail('ANALYST_NOTEBOOK_LIMIT', 'Return at most 200 chart points. Aggregate or narrow the query.');
  if (input.kind === 'pie' && !positivePieValue && result.rows.length)
    return fail(
      'ANALYST_NOTEBOOK_CHART',
      'A pie chart needs a positive total. Use a table or bar chart for zero or unavailable values.',
    );
  return {
    kind: input.kind,
    title: input.title,
    xLabel: input.xColumn,
    yLabel: input.yColumns.join(', '),
    xScale,
    labels,
    series: [...series.values()].map((item) => ({
      name: item.name,
      values: labels.map((_, i) => item.values.get(i) ?? null),
    })),
    format: input.format,
    ...(input.currency ? { currency: input.currency } : {}),
  };
}

/** Call only with the freshly reexecuted server snapshot after its hashes have been checked. */
export function buildAnalystNotebook(
  results: ReadonlyMap<string, AnalystSqlResult>,
  rawInput: unknown,
): AnalystCell[] {
  const parsed = analystPublicationSchema.safeParse(rawInput);
  if (!parsed.success)
    return fail('ANALYST_NOTEBOOK_INPUT', parsed.error.issues.map((issue) => issue.message).join(' '));
  const input = parsed.data;
  const references = [...new Set([...input.tables, ...input.charts].map((part) => part.queryId))];
  const selected = references.map((id) => {
    const result = results.get(id);
    if (!result)
      return fail(
        'ANALYST_NOTEBOOK_REFERENCE',
        `Query "${id}" has not been executed in this conversation. Run the query before publishing.`,
      );
    validateResult(result, id);
    return result;
  });
  if (new Set(selected.map((result) => result.organizationId)).size > 1)
    return fail(
      'ANALYST_NOTEBOOK_SCOPE',
      'The selected results belong to different workspaces. Reexecute them in the current workspace.',
    );
  const cells: AnalystCell[] = [
    {
      id: 'analysis-notes',
      title: input.title,
      code: '',
      outputs: [
        {
          type: 'notice',
          text: input.notes
            ? 'Analyst-written explanation and assumptions follow. They are not an independent verification of the queries or results.'
            : 'The tables and charts below use executed query results. Query logic, units and labels still require review.',
        },
        ...(input.notes ? [{ type: 'markdown' as const, text: input.notes }] : []),
      ],
    },
  ];
  for (const result of selected) {
    const table = input.tables.find((part) => part.queryId === result.id);
    const charts = input.charts.filter((part) => part.queryId === result.id);
    const outputs: AnalystOutput[] = [
      {
        type: 'notice',
        text: `Captured ${result.executedAt}. Workspace reference: ${result.organizationId}. Query reference: ${result.id}. Parameters in SQL placeholder order: ${JSON.stringify(result.params)}.`,
      },
    ];
    if (table)
      outputs.push({
        type: 'table',
        columns: result.columns.map((column) => column.name),
        rows: result.rows.map((row) => [...row]),
        totalRows: result.rowCount,
        totalRowsKnown: !result.truncated,
        truncated: result.truncated,
      });
    if (result.truncated)
      outputs.push({
        type: 'notice',
        text: `This is only the first ${result.rows.length} rows. More rows exist; their total count is not known. Narrow or aggregate the SQL to inspect the complete result.`,
      });
    if (!result.rows.length)
      outputs.push({
        type: 'notice',
        text: 'This query returned no rows. No values or zero balances have been inferred.',
      });
    for (const chart of charts) outputs.push({ type: 'chart', chart: buildChart(result, chart) });
    cells.push({
      id: `query-${result.id}`,
      title: table?.title ?? charts[0]?.title ?? result.id,
      code: result.sql,
      outputs,
    });
  }
  return cells;
}
