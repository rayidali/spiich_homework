import { useId } from 'react';
import { Code2, NotebookPen } from 'lucide-react';
import type { AnalystCell, AnalystChart, AnalystOutput } from '../../shared/analyst';
import { Decimal, formatCurrency } from '../../shared/money';
import { AnalystMarkdown } from './AnalystMarkdown';

const chartColors = ['#36584a', '#a65c3f', '#597690', '#b29756', '#80748e', '#739385'];

// Presentation only: retain the provider's column keys, values and SQL verbatim.
function displayLabel(value: string) {
  const label = value
    .replace(/_/g, ' ')
    .replace(/\bpct\b/gi, '(%)')
    .trim();
  return label ? label[0].toUpperCase() + label.slice(1) : label;
}

function sourceNotice(text: string) {
  // Only the complete native provenance envelope is collapsible. Warnings and
  // analyst-written notices, including text appended to this envelope, stay visible.
  const match = text.match(
    /^Captured \d{4}-\d{2}-\d{2}T[\d:.]+Z\. Workspace reference: [\da-f-]{36}\. Query reference: [\w-]+\. Parameters in SQL placeholder order: (\[.*\])\.$/i,
  );
  if (!match) return false;
  try {
    return Array.isArray(JSON.parse(match[1]));
  } catch {
    return false;
  }
}

function chartValue(value: string | null, chart: AnalystChart) {
  if (value === null) return 'Not available';
  try {
    if (chart.format === 'currency') return formatCurrency(value, chart.currency || 'USD');
    if (chart.format === 'percent') return `${new Decimal(value).toDecimalPlaces(2).toString()}%`;
  } catch {
    /* Preserve a provider value visibly instead of inventing a formatted replacement. */
  }
  return value;
}

function ChartTable({ chart }: { chart: AnalystChart }) {
  return (
    <div
      className="analyst-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={`${chart.title || 'Chart'} values`}
    >
      <table>
        <thead>
          <tr>
            <th scope="col">{displayLabel(chart.xLabel || 'Category')}</th>
            {chart.series.map((series, index) => (
              <th key={index} scope="col">
                {displayLabel(series.name || chart.yLabel || 'Value')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.labels.map((label, index) => (
            <tr key={index}>
              <th scope="row">{label}</th>
              {chart.series.map((series, seriesIndex) => (
                <td key={seriesIndex}>{chartValue(series.values[index] ?? null, chart)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartGraphic({ chart }: { chart: AnalystChart }) {
  const titleId = useId();
  const values = chart.series.map((series) =>
    series.values.map((value) => (value === null ? null : Number(value))),
  );
  const all = values.flat().filter((value): value is number => value !== null && Number.isFinite(value));
  if (!chart.labels.length || !all.length || !chart.series.length)
    return <p className="muted">No values to plot. The table retains any unavailable results.</p>;
  if (
    values.some((series) =>
      series.some((value) => value !== null && (!Number.isFinite(value) || Math.abs(value) > 1e100)),
    )
  )
    return <p className="muted">These values cannot be drawn at this scale. See the exact values below.</p>;
  const width = 620,
    height = 310,
    left = 68,
    right = 22,
    top = 18,
    bottom = 70;
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom;
  if (chart.kind === 'pie') {
    if (values.length !== 1 || all.some((value) => value < 0) || all.every((value) => value === 0))
      return (
        <p className="muted">
          A pie chart needs one series of non-negative values with a positive total. See the table for this
          result.
        </p>
      );
    const max = Math.max(...all),
      weights = values[0].map((value) => (value ?? 0) / max),
      total = weights.reduce((sum, value) => sum + value, 0);
    let angle = -Math.PI / 2;
    const radius = 105,
      centerX = width / 2,
      centerY = height / 2;
    return (
      <>
        <svg
          className="analyst-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={titleId}
        >
          <title id={titleId}>
            {`${chart.title || 'Category breakdown'}. Exact values are in the chart table.`}
          </title>
          {weights.map((weight, index) => {
            const start = angle,
              end = angle + (weight / total) * Math.PI * 2;
            angle = end;
            if (weight === 0) return null;
            const color = chartColors[index % chartColors.length];
            const label = `${chart.labels[index]}: ${chartValue(chart.series[0].values[index] ?? null, chart)}`;
            if (weight === total)
              return (
                <circle key={index} cx={centerX} cy={centerY} r={radius} fill={color}>
                  <title>{label}</title>
                </circle>
              );
            const d = `M ${centerX} ${centerY} L ${centerX + radius * Math.cos(start)} ${centerY + radius * Math.sin(start)} A ${radius} ${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${centerX + radius * Math.cos(end)} ${centerY + radius * Math.sin(end)} Z`;
            return (
              <path key={index} d={d} fill={color} stroke="#fff" strokeWidth={2}>
                <title>{label}</title>
              </path>
            );
          })}
        </svg>
        <ul className="analyst-chart-legend">
          {chart.labels.map((label, index) => (
            <li key={index}>
              <span style={{ background: chartColors[index % chartColors.length] }} />
              {label}
            </li>
          ))}
        </ul>
      </>
    );
  }
  const minimum = Math.min(0, ...all),
    maximum = Math.max(0, ...all),
    span = maximum - minimum || 1;
  const y = (value: number) => top + ((maximum - value) / span) * plotHeight;
  const zero = y(0),
    slot = plotWidth / chart.labels.length;
  const xScale =
    chart.xScale ??
    (chart.kind === 'scatter' && chart.labels.every((label) => label.trim() && Number.isFinite(Number(label)))
      ? 'number'
      : 'category');
  const xValues = chart.labels.map((label, index) =>
    xScale === 'date' ? Date.parse(label) : xScale === 'number' ? Number(label) : index,
  );
  if (xValues.some((value) => !Number.isFinite(value)))
    return (
      <p className="muted">
        The horizontal values cannot be plotted on this scale. See the exact values below.
      </p>
    );
  const xMinimum = Math.min(...xValues),
    xMaximum = Math.max(...xValues);
  const x = (index: number) =>
    xScale === 'category'
      ? left + slot * (index + 0.5)
      : xMaximum === xMinimum
        ? left + plotWidth / 2
        : left + slot / 2 + ((xValues[index] - xMinimum) / (xMaximum - xMinimum)) * (plotWidth - slot);
  const orderedIndices = chart.labels.map((_, index) => index).sort((a, b) => xValues[a] - xValues[b]);
  const gaps = orderedIndices
    .slice(1)
    .map((index, position) => x(index) - x(orderedIndices[position]))
    .filter((gap) => gap > 0);
  const barSlot = xScale === 'category' || !gaps.length ? slot : Math.min(slot, ...gaps);
  const tickIndices = chart.labels
    .map((_, index) => index)
    .filter(
      (index) =>
        index % Math.max(1, Math.ceil(chart.labels.length / 6)) === 0 || index === chart.labels.length - 1,
    );
  const tickLabel = (value: number) =>
    new Intl.NumberFormat('en-US', {
      notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
      maximumFractionDigits: 1,
    }).format(value) + (chart.format === 'percent' ? '%' : '');
  return (
    <>
      <svg className="analyst-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId}>
        <title id={titleId}>
          {`${chart.title || 'Financial chart'}. ${displayLabel(chart.xLabel)} by ${displayLabel(chart.yLabel)}. Exact values are in the chart table.`}
        </title>
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = minimum + (span * tick) / 4;
          return (
            <g key={tick}>
              <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#e9e9e3" />
              <text x={left - 10} y={y(value) + 4} textAnchor="end" className="analyst-chart-axis">
                {tickLabel(value)}
              </text>
            </g>
          );
        })}
        <line x1={left} x2={width - right} y1={zero} y2={zero} stroke="#a7aaa0" />
        {chart.series.map((series, seriesIndex) => {
          const color = chartColors[seriesIndex % chartColors.length],
            seriesValues = values[seriesIndex];
          if (chart.kind === 'bar') {
            const barWidth = Math.min(36, (barSlot * 0.78) / chart.series.length);
            return (
              <g key={seriesIndex}>
                {seriesValues.map((value, index) =>
                  value === null ? null : (
                    <rect
                      key={index}
                      x={x(index) - (barWidth * chart.series.length) / 2 + seriesIndex * barWidth}
                      y={Math.min(zero, y(value))}
                      width={Math.max(1, barWidth - 1)}
                      height={Math.abs(y(value) - zero)}
                      fill={color}
                    >
                      <title>
                        {`${chart.labels[index]} · ${series.name}: ${chartValue(series.values[index], chart)}`}
                      </title>
                    </rect>
                  ),
                )}
              </g>
            );
          }
          const segments: { index: number; value: number }[][] = [];
          for (const index of orderedIndices) {
            const value = seriesValues[index];
            if (value === null) {
              if (segments.at(-1)?.length) segments.push([]);
              continue;
            }
            if (!segments.length) segments.push([]);
            segments[segments.length - 1].push({ index, value });
          }
          return (
            <g key={seriesIndex}>
              {chart.kind !== 'scatter' &&
                segments
                  .filter((segment) => segment.length > 1)
                  .map((segment, index) => {
                    const points = segment.map((point) => `${x(point.index)},${y(point.value)}`).join(' ');
                    return (
                      <g key={index}>
                        {chart.kind === 'area' && (
                          <polygon
                            points={`${x(segment[0].index)},${zero} ${points} ${x(segment.at(-1)!.index)},${zero}`}
                            fill={color}
                            opacity={0.12}
                          />
                        )}
                        <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
                      </g>
                    );
                  })}
              {seriesValues.map((value, index) =>
                value === null ? null : (
                  <circle
                    key={index}
                    cx={x(index)}
                    cy={y(value)}
                    r={chart.kind === 'scatter' ? 4 : 3}
                    fill={color}
                  >
                    <title>
                      {`${chart.labels[index]} · ${series.name}: ${chartValue(series.values[index], chart)}`}
                    </title>
                  </circle>
                ),
              )}
            </g>
          );
        })}
        {tickIndices.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={height - bottom + 20}
            textAnchor="middle"
            className="analyst-chart-axis"
          >
            {chart.labels[index].length > 15 ? `${chart.labels[index].slice(0, 14)}…` : chart.labels[index]}
          </text>
        ))}
        <text x={left + plotWidth / 2} y={height - 12} textAnchor="middle" className="analyst-chart-axis">
          {displayLabel(chart.xLabel)}
        </text>
      </svg>
      <ul className="analyst-chart-legend">
        {chart.series.map((series, index) => (
          <li key={index}>
            <span style={{ background: chartColors[index % chartColors.length] }} />
            {displayLabel(series.name || chart.yLabel)}
          </li>
        ))}
      </ul>
    </>
  );
}

export function AnalystChartView({ chart }: { chart: AnalystChart }) {
  return (
    <figure className="analyst-chart-figure">
      <figcaption>{chart.title || 'Chart'}</figcaption>
      <div
        className={`analyst-chart-scroll${chart.kind === 'pie' ? ' analyst-chart-fit' : ''}`}
        tabIndex={0}
        role="region"
        aria-label={`${chart.title || 'Chart'} graphic; scroll horizontally if needed`}
      >
        <ChartGraphic chart={chart} />
      </div>
      {chart.kind !== 'pie' && (
        <p className="analyst-chart-scroll-hint">Scroll across the chart to see every month or category.</p>
      )}
      <details className="analyst-chart-data">
        <summary>View chart data</summary>
        <ChartTable chart={chart} />
      </details>
    </figure>
  );
}

function CellOutput({ output }: { output: AnalystOutput }) {
  if (output.type === 'markdown') return <AnalystMarkdown text={output.text} />;
  if (output.type === 'notice')
    return sourceNotice(output.text) ? (
      <details className="analyst-source-details">
        <summary>Source details</summary>
        <p className="analyst-output-note">{output.text}</p>
      </details>
    ) : (
      <p className="analyst-output-note">{output.text}</p>
    );
  if (output.type === 'chart') return <AnalystChartView chart={output.chart} />;
  return (
    <>
      <div className="analyst-table-scroll" tabIndex={0} role="region" aria-label="Notebook results table">
        <table>
          <thead>
            <tr>
              {output.columns.map((column, index) => (
                <th scope="col" key={index}>
                  {displayLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {output.rows.map((row, index) => (
              <tr key={index}>
                {output.columns.map((_, column) => (
                  <td key={column}>{row[column] ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="analyst-table-count">
        {output.truncated
          ? output.totalRowsKnown === false
            ? `Showing the first ${output.rows.length} rows. More rows exist; the total count is not known. Narrow or aggregate the query to see the complete result.`
            : `Showing ${output.rows.length} of ${output.totalRows} rows. Ask for a narrower result to inspect more detail.`
          : `${output.totalRows} ${output.totalRows === 1 ? 'row' : 'rows'}`}
      </p>
    </>
  );
}

function meaningfulCellTitle(title: string) {
  const text = title.trim();
  return text && !/^(?:_+|_?cell(?:[_\s-]*\d+)?)$/i.test(text) ? text : null;
}

function notebookCellTitle(cell: AnalystCell, index: number) {
  const supplied = meaningfulCellTitle(cell.title);
  if (supplied) return supplied;
  for (const output of cell.outputs) {
    if (output.type === 'chart') {
      const chartTitle = meaningfulCellTitle(output.chart.title);
      if (chartTitle) return chartTitle;
    }
  }
  for (const output of cell.outputs) {
    if (output.type !== 'markdown') continue;
    let fence: string | null = null;
    for (const line of output.text.split('\n')) {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1][0];
        else if (fence === marker[1][0]) fence = null;
        continue;
      }
      if (fence) continue;
      const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/)?.[1];
      if (!heading) continue;
      const title = meaningfulCellTitle(
        heading.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|~~|`)(.*?)\1/g, '$2'),
      );
      if (title) return title.slice(0, 240);
    }
  }
  const category = cell.outputs.some((output) => output.type === 'table')
    ? 'Query results'
    : cell.outputs.some((output) => output.type === 'markdown') || !cell.code
      ? 'Notes'
      : 'Calculation';
  return `${category} ${index + 1}`;
}

export function AnalystNotebook({
  cells,
  updatedAt,
  externalUrl,
}: {
  cells: AnalystCell[];
  updatedAt: string | null;
  externalUrl?: string;
}) {
  const safeExternalUrl =
    externalUrl && /^https:\/\/app\.querio\.ai\//.test(externalUrl) ? externalUrl : undefined;
  return (
    <div className="analyst-notebook">
      <div className="analyst-notebook-heading">
        <div>
          <NotebookPen size={17} />
          <h3>Notebook</h3>
        </div>
        {safeExternalUrl && (
          <a className="text-button" href={safeExternalUrl} target="_blank" rel="noopener noreferrer">
            Open in Querio ↗
          </a>
        )}
      </div>
      <p className="analyst-notebook-intro">
        The queries, calculations and results behind the answer.
        {updatedAt &&
          ` Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`}
      </p>
      {!cells.length && (
        <p className="analyst-output-note">Supporting work will appear here after Querio runs an analysis.</p>
      )}
      {cells.map((cell, index) => (
        <section className="analyst-notebook-cell" key={cell.id} aria-label={notebookCellTitle(cell, index)}>
          <div className="analyst-cell-heading">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <h4>{notebookCellTitle(cell, index)}</h4>
          </div>
          {cell.outputs.map((output, outputIndex) => (
            <CellOutput key={outputIndex} output={output} />
          ))}
          {cell.code && (
            <details className="analyst-cell-source">
              <summary>
                <Code2 size={13} /> View query or calculation
              </summary>
              <pre>
                <code>{cell.code}</code>
              </pre>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}
