import type { AnalystCell, AnalystChart, AnalystOutput } from '../shared/analyst';
import Decimal from 'decimal.js';

type ObjectValue = Record<string, unknown>;
const MAX_CELLS = 60;
const MAX_ROWS = 200;
const MAX_COLUMNS = 30;
const MAX_TEXT = 30_000;
const MAX_VALUE = 2_000;
const MAX_CODE = 60_000;
const MAX_CHART_POINTS = 200;
const MAX_SERIES = 12;
// Scaling a bounded source decimal by 100 must not round its significant digits.
const ChartDecimal = Decimal.clone({ precision: MAX_VALUE + 2 });

const object = (value: unknown): ObjectValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectValue) : null;
const string = (value: unknown) => (typeof value === 'string' ? value : '');
const own = (value: ObjectValue, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Text conversion only. Querio HTML is never forwarded to an HTML renderer. */
function plainHtml(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    pound: '£',
    euro: '€',
    copy: '©',
  };
  const decoded = value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (!code.startsWith('#'))
      return own(entities, code.toLowerCase()) ? entities[code.toLowerCase()] : entity;
    const number =
      code[1]?.toLowerCase() === 'x'
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number)
      : '�';
  });
  return decoded
    .replace(/<(script|style|iframe|object|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(?:br|hr)\b[^>]*>|<\/(?:p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<\/?[a-z!][^>]*>/gi, '')
    .replace(/<[^>\n]*$/g, '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function text(value: unknown, limit: number, warnings: string[], label: string): string {
  const result = plainHtml(string(value));
  if (result.length <= limit) return result;
  warnings.push(`${label} was shortened for display.`);
  return `${result.slice(0, limit)}…`;
}

function table(presentation: ObjectValue, warnings: string[]): AnalystOutput {
  const sourceColumns = Array.isArray(presentation.columns) ? presentation.columns : [];
  const sourceRows = Array.isArray(presentation.rows) ? presentation.rows : [];
  const columnNames = sourceColumns.map(
    (column, index) => string(column) || string(object(column)?.name) || `Column ${index + 1}`,
  );
  let shortenedValue = false;
  const scalar = (value: unknown) => {
    const raw =
      value === null || value === undefined
        ? ''
        : typeof value === 'string'
          ? value
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : '[Unsupported value]';
    if (raw.length > MAX_VALUE) shortenedValue = true;
    // Preserve decimal strings exactly. The UI renders these values as text nodes.
    return raw.length > MAX_VALUE ? `${raw.slice(0, MAX_VALUE)}…` : raw;
  };
  const columns = columnNames.slice(0, MAX_COLUMNS).map(scalar);
  const rows = sourceRows.slice(0, MAX_ROWS).map((row) => {
    const record = object(row);
    return columnNames
      .slice(0, MAX_COLUMNS)
      .map((column, index) =>
        scalar(Array.isArray(row) ? row[index] : record && own(record, column) ? record[column] : null),
      );
  });
  const declaredTotal = Number(presentation.totalRows);
  const totalRows =
    Number.isSafeInteger(declaredTotal) && declaredTotal >= 0
      ? Math.max(declaredTotal, sourceRows.length)
      : sourceRows.length;
  const declaredColumns = Number(presentation.totalColumns);
  const truncated =
    totalRows > rows.length ||
    (Number.isSafeInteger(declaredColumns) && declaredColumns > columns.length) ||
    sourceColumns.length > MAX_COLUMNS ||
    shortenedValue ||
    presentation.rowsTruncated === true ||
    presentation.columnsTruncated === true;
  if (truncated)
    warnings.push('A table is shortened for display; its row, column, or value preview is incomplete.');
  if (!columns.length && sourceRows.length) {
    return {
      type: 'notice',
      text: 'Querio returned table rows without column definitions. Inspect the notebook source.',
    };
  }
  return { type: 'table', columns, rows, totalRows, truncated };
}

function chart(presentation: ObjectValue): AnalystChart | null {
  const spec = object(presentation.spec);
  if (!spec || (presentation.format && presentation.format !== 'vega-lite')) return null;
  if (
    ['transform', 'layer', 'concat', 'hconcat', 'vconcat', 'facet', 'repeat', 'params', 'projection'].some(
      (key) => own(spec, key) && !(Array.isArray(spec[key]) && spec[key].length === 0),
    )
  )
    return null;
  const encoding = object(spec.encoding);
  const mark = typeof spec.mark === 'string' ? spec.mark : string(object(spec.mark)?.type);
  const kinds: Record<string, AnalystChart['kind']> = {
    bar: 'bar',
    line: 'line',
    area: 'area',
    arc: 'pie',
    point: 'scatter',
    circle: 'scatter',
  };
  const kind = own(kinds, mark) ? kinds[mark] : undefined;
  if (!kind || !encoding) return null;
  // Only these field channels are represented by our own inert chart contract.
  if (Object.keys(encoding).some((key) => !['x', 'y', 'theta', 'color', 'tooltip'].includes(key)))
    return null;
  const x = object(encoding.x),
    y = object(encoding.y),
    theta = object(encoding.theta);
  const color = object(encoding.color);
  const horizontal = kind !== 'pie' && x?.type === 'quantitative' && y?.type !== 'quantitative';
  const dimension = kind === 'pie' ? color : horizontal ? y : x;
  const measure = kind === 'pie' ? theta : horizontal ? x : y;
  if (!dimension || !measure || !string(dimension.field) || !string(measure.field)) return null;
  if (measure.type !== 'quantitative') return null;
  const xScale: AnalystChart['xScale'] =
    dimension.type === 'quantitative' ? 'number' : dimension.type === 'temporal' ? 'date' : 'category';
  const channels = [dimension, measure, ...(kind !== 'pie' && color ? [color] : [])];
  for (const channel of channels) {
    if (['aggregate', 'bin', 'condition', 'expr', 'datum'].some((key) => own(channel, key))) return null;
    if (channel.stack !== undefined && channel.stack !== null) return null;
    if (channel.sort !== undefined && channel.sort !== null) return null;
    const scale = object(channel.scale);
    if (scale && (own(scale, 'domain') || (scale.type !== undefined && scale.type !== 'linear'))) return null;
  }
  // Vega formats ratios as percentages; our inert chart contract stores percentage
  // points. Convert exactly once while leaving the source table/code untouched.
  const axis = object(measure.axis);
  const axisFormat = string(axis?.format);
  const percent = axisFormat.includes('%');
  if (
    percent &&
    (!/^\.[012]%$/.test(axisFormat) || (axis?.formatType !== undefined && axis.formatType !== 'number'))
  )
    return null;
  if (kind !== 'pie' && color && (color.type === 'quantitative' || !string(color.field))) return null;
  const unit = dimension.timeUnit;
  if (unit !== undefined && !['yearmonth', 'yearmonthdate', 'year'].includes(String(unit))) return null;
  if (measure.timeUnit !== undefined) return null;
  const source = object(spec.data);
  if (!source || own(source, 'url') || own(source, 'format')) return null;
  const datasets = object(spec.datasets);
  const data = Array.isArray(source.values)
    ? source.values
    : typeof source.name === 'string' && datasets && own(datasets, source.name)
      ? datasets[source.name]
      : null;
  if (!Array.isArray(data) || !data.length || data.length > MAX_CHART_POINTS) return null;
  const labels: string[] = [];
  const labelIndexes = new Map<string, number>();
  const series = new Map<string, Map<number, string | null>>();
  const numeric = (value: unknown): string | null | false => {
    if (value === null) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return false;
    const raw = String(value);
    return raw.length <= MAX_VALUE &&
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) &&
      Number.isFinite(Number(raw))
      ? raw
      : false;
  };
  for (const rawRow of data) {
    const row = object(rawRow);
    if (!row || !own(row, String(dimension.field)) || !own(row, String(measure.field))) return null;
    const rawLabel = row[String(dimension.field)];
    if (typeof rawLabel !== 'string' && typeof rawLabel !== 'number') return null;
    let label = String(rawLabel);
    if (label.length > MAX_VALUE) return null;
    if (unit !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(label)) return null;
      label = label.slice(0, unit === 'year' ? 4 : unit === 'yearmonth' ? 7 : 10);
    }
    if ((kind === 'scatter' || xScale === 'number') && numeric(rawLabel) === false) return null;
    if (xScale === 'date' && !Number.isFinite(Date.parse(label))) return null;
    let amount = numeric(row[String(measure.field)]);
    if (amount === false || (kind === 'pie' && amount !== null && Number(amount) < 0)) return null;
    if (percent && amount !== null) {
      amount = new ChartDecimal(amount).times(100).toString();
      if (!Number.isFinite(Number(amount))) return null;
    }
    const rawSeries = kind !== 'pie' && color ? row[String(color.field)] : (measure.title ?? measure.field);
    if (typeof rawSeries !== 'string' && typeof rawSeries !== 'number') return null;
    const seriesName = String(rawSeries);
    if (seriesName.length > MAX_VALUE) return null;
    let index = kind === 'scatter' ? undefined : labelIndexes.get(label);
    if (index === undefined) {
      index = labels.length;
      labels.push(label);
      labelIndexes.set(label, index);
    }
    const values = series.get(seriesName) ?? new Map<number, string | null>();
    // A duplicate coordinate would require aggregation or another unrepresented channel.
    if (values.has(index)) return null;
    values.set(index, amount);
    series.set(seriesName, values);
    if (series.size > MAX_SERIES) return null;
  }
  if (
    kind === 'pie' &&
    ![...series.values()].some((values) => [...values.values()].some((v) => v !== null && Number(v) > 0))
  )
    return null;
  // Vega stacks colored bars/areas by default. Our simple series contract has no
  // stack instruction, so accept multiple such series only when stacking is off.
  if ((kind === 'bar' || kind === 'area') && series.size > 1 && measure.stack !== null) return null;
  const titleValue = typeof spec.title === 'string' ? spec.title : string(object(spec.title)?.text);
  return {
    kind,
    title: plainHtml(string(presentation.title) || titleValue).slice(0, MAX_VALUE),
    xLabel: plainHtml(string(dimension.title) || String(dimension.field)).slice(0, MAX_VALUE),
    xScale,
    yLabel: plainHtml(string(measure.title) || String(measure.field)).slice(0, MAX_VALUE),
    ...(percent ? { format: 'percent' as const } : {}),
    labels,
    series: [...series].map(([name, values]) => ({
      name,
      values: labels.map((_, index) => values.get(index) ?? null),
    })),
  };
}

function output(value: unknown, warnings: string[]): AnalystOutput[] {
  const presentation = object(value);
  if (!presentation) return [];
  if (presentation.type === 'table') return [table(presentation, warnings)];
  if (presentation.type === 'chart') {
    const normalized = chart(presentation);
    if (normalized) return [{ type: 'chart', chart: normalized }];
    const notice =
      'This chart uses a data shape or Vega feature that cannot be displayed faithfully here. Inspect the notebook source in Querio.';
    warnings.push(notice);
    return [{ type: 'notice', text: notice }];
  }
  if (presentation.type === 'html' || presentation.type === 'markdown' || presentation.type === 'text') {
    const content = text(
      presentation.html ?? presentation.markdown ?? presentation.text,
      MAX_TEXT,
      warnings,
      'Notebook text',
    );
    return content ? [{ type: 'markdown', text: content }] : [];
  }
  return [
    { type: 'notice', text: 'This notebook output is not supported here. Inspect its source in Querio.' },
  ];
}

/** Normalize provider evidence only; never execute code, fetch assets, or invent an answer. */
export function normalizeQuerioOutput(
  run: unknown,
  notebook: unknown,
): {
  answer: string;
  cells: AnalystCell[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const rawRun = object(run);
  const result = object(rawRun?.output);
  const saved = object(object(notebook)?.serialization);
  const rawSavedCells = Array.isArray(saved?.cells) ? saved.cells : [];
  const rawResultCells = Array.isArray(result?.cells) ? result.cells : [];
  if (Array.isArray(result?.warnings)) {
    for (const warning of result.warnings.slice(0, 20)) {
      const message = text(warning, MAX_VALUE, warnings, 'Provider warning');
      if (message) warnings.push(message);
    }
  }
  const cells = new Map<string, AnalystCell>();
  const add = (raw: ObjectValue, savedCell: boolean, index: number) => {
    const id = string(raw.cell_id) || string(raw.cellId) || `output-${index + 1}`;
    if (!cells.has(id) && cells.size >= MAX_CELLS) {
      warnings.push('Only the first 60 notebook cells are displayed.');
      return;
    }
    const existing = cells.get(id);
    const rawCode = string(raw.code) || string(raw.source) || existing?.code || '';
    if (rawCode.length > MAX_CODE) warnings.push('Notebook source was shortened for display.');
    const code =
      rawCode.length > MAX_CODE ? `${rawCode.slice(0, MAX_CODE)}\n# Source shortened for display` : rawCode;
    const title = text(raw.name ?? raw.title ?? existing?.title ?? '', MAX_VALUE, warnings, 'Cell title');
    cells.set(id, {
      id,
      title,
      code,
      // Saved code is useful, but stored old outputs must not masquerade as this run's evidence.
      outputs: savedCell ? (existing?.outputs ?? []) : output(raw.presentation, warnings),
    });
  };
  rawSavedCells.slice(0, MAX_CELLS + 1).forEach((value, index) => {
    const raw = object(value);
    if (raw) add(raw, true, index);
  });
  rawResultCells.slice(0, MAX_CELLS + 1).forEach((value, index) => {
    const raw = object(value);
    if (raw) add(raw, false, index);
  });
  let answer = '';
  if (rawRun?.status === 'completed') {
    answer = text(result?.finalAnswerMarkdown, MAX_TEXT, warnings, 'Answer');
    if (!answer && Array.isArray(result?.assistantMessages)) {
      for (const message of [...result.assistantMessages].reverse()) {
        answer = text(object(message)?.markdown, MAX_TEXT, warnings, 'Answer');
        if (answer) break;
      }
    }
    if (!answer)
      warnings.push(
        'Querio completed the run without a final text answer. Available notebook results are shown.',
      );
  }
  return { answer, cells: [...cells.values()], warnings: [...new Set(warnings)] };
}
