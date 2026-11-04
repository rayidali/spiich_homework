import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AnalystChart } from '../shared/analyst';
import { AnalystChartView, AnalystNotebook } from '../web/src/AnalystNotebook';
import { AnalystMarkdown } from '../web/src/AnalystMarkdown';

const chart: AnalystChart = {
  kind: 'line',
  title: 'Actual result',
  xLabel: 'Month',
  yLabel: 'USD',
  labels: ['January', 'February', 'March'],
  series: [{ name: 'Net expense', values: ['100.00', null, '-50.00'] }],
  format: 'currency',
  currency: 'USD',
};
describe('analyst presentation of financial evidence', () => {
  it('simplifies labels and tucks only source metadata away while keeping evidence and warnings intact', () => {
    const provenance =
      'Captured 2026-11-03T18:00:00.000Z. Workspace reference: 00000000-0000-4000-8000-000000000001. Query reference: q7. Parameters in SQL placeholder order: ["5010"].';
    const cells = [
      {
        id: 'rent',
        title: 'Rent share',
        code: 'SELECT month_label, posted_rent_pct FROM monthly_expenses;',
        outputs: [
          { type: 'notice' as const, text: provenance },
          { type: 'notice' as const, text: 'Draft entries are excluded.' },
          { type: 'notice' as const, text: `${provenance} Warning: this result is incomplete.` },
          {
            type: 'table' as const,
            columns: ['month_label', 'posted_rent_pct'],
            rows: [['original_label', '30.1200']],
            totalRows: 1,
            truncated: false,
          },
          {
            type: 'chart' as const,
            chart: {
              ...chart,
              xLabel: 'month_label',
              yLabel: 'posted_rent_pct',
              series: [{ name: 'posted_rent_pct', values: ['30.1200', null, '0'] }],
              format: 'percent' as const,
            },
          },
        ],
      },
    ];
    const original = structuredClone(cells);
    const html = renderToStaticMarkup(createElement(AnalystNotebook, { cells, updatedAt: null }));
    expect(html).toContain('<th scope="col">Month label</th>');
    expect(html).toContain('<th scope="col">Posted rent (%)</th>');
    expect(html).toContain('>original_label</td>');
    expect(html).toContain('>30.1200</td>');
    expect(html).toContain('SELECT month_label, posted_rent_pct FROM monthly_expenses;');
    const disclosure = html.match(/<details class="analyst-source-details">[\s\S]*?<\/details>/g) ?? [];
    expect(disclosure).toHaveLength(1);
    expect(disclosure[0]).toContain('<summary>Source details</summary>');
    expect(disclosure[0]).not.toContain(' open');
    const outside = html.replace(disclosure[0]!, '');
    expect(outside).toContain('Draft entries are excluded.');
    expect(outside).toContain('Warning: this result is incomplete.');
    expect(cells).toEqual(original);
  });
  it('keeps an unavailable value separate from zero and breaks the line instead of bridging the gap', () => {
    const html = renderToStaticMarkup(createElement(AnalystChartView, { chart }));
    expect(html).toContain('Not available');
    expect(html).toContain('-$50.00');
    expect(html).not.toContain('<polyline');
    expect((html.match(/<circle /g) || []).length).toBe(2);
  });
  it('preserves exact large currency labels and the supplied percentage scale', () => {
    const money = renderToStaticMarkup(
      createElement(AnalystChartView, {
        chart: {
          ...chart,
          kind: 'bar',
          labels: ['Total'],
          series: [{ name: 'Total', values: ['90071992547409.93'] }],
        },
      }),
    );
    expect(money).toContain('$90,071,992,547,409.93');
    const percent = renderToStaticMarkup(
      createElement(AnalystChartView, {
        chart: {
          ...chart,
          format: 'percent',
          labels: ['Share'],
          series: [{ name: 'Share', values: ['0.03'] }],
        },
      }),
    );
    expect(percent).toContain('0.03%');
    expect(percent).not.toContain('3.00%');
  });
  it('positions a scatter chart by actual numeric x values rather than equally spaced labels', () => {
    const html = renderToStaticMarkup(
      createElement(AnalystChartView, {
        chart: {
          ...chart,
          kind: 'scatter',
          xScale: 'number',
          labels: ['1', '2', '11'],
          series: [{ name: 'Value', values: ['10', '20', '30'] }],
        },
      }),
    );
    const xs = [...html.matchAll(/<circle cx="([^"]+)"/g)].map((match) => Number(match[1]));
    expect(xs).toHaveLength(3);
    expect((xs[2] - xs[1]) / (xs[1] - xs[0])).toBeCloseTo(9);
  });
  it('uses a table explanation instead of an invalid pie with negative amounts', () => {
    const html = renderToStaticMarkup(createElement(AnalystChartView, { chart: { ...chart, kind: 'pie' } }));
    expect(html).toContain('A pie chart needs one series of non-negative values');
    expect(html).toContain('-$50.00');
    expect(html).not.toContain('<svg');
  });
  it('renders provider content without executable HTML, unsafe links, or remote images', () => {
    const html = renderToStaticMarkup(
      createElement(AnalystMarkdown, {
        text: '**Answer** <script>alert(1)</script> [run](javascript:alert(1)) ![secret](https://example.com/track)',
      }),
    );
    expect(html).toContain('<strong>Answer</strong>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<img');
    expect(html).toContain('[Image: secret]');
  });
  it('shows truncation and escaped source without executing or silently omitting a result', () => {
    const html = renderToStaticMarkup(
      createElement(AnalystNotebook, {
        updatedAt: null,
        externalUrl: 'javascript:alert(1)',
        cells: [
          {
            id: 'query',
            title: 'Query results',
            code: '<script>alert(1)</script>',
            outputs: [
              {
                type: 'table',
                columns: ['Description', 'Amount'],
                rows: [['<img onerror=alert(1)>', '25.00']],
                totalRows: 20,
                truncated: true,
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain('Showing 1 of 20 rows');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
  });
  it('gives internal notebook cell names useful headings without changing source code', () => {
    const cells = [
      {
        id: 'chart',
        title: '_',
        code: 'plot_exact_values()',
        outputs: [{ type: 'chart' as const, chart: { ...chart, title: 'Monthly rent share' } }],
      },
      {
        id: 'heading',
        title: 'cell_2',
        code: '',
        outputs: [
          {
            type: 'markdown' as const,
            text: '```python\n# Internal implementation\n```\n\n## **What changed**\nThe result is unchanged.',
          },
        ],
      },
      {
        id: 'table',
        title: '__',
        code: 'SELECT amount FROM ledger;',
        outputs: [
          { type: 'table' as const, columns: ['Amount'], rows: [['12.34']], totalRows: 1, truncated: false },
        ],
      },
      {
        id: 'notes',
        title: '_cell',
        code: '',
        outputs: [{ type: 'markdown' as const, text: 'Assumptions used in this calculation.' }],
      },
      { id: 'code', title: '', code: 'difference = current - previous', outputs: [] },
      { id: 'named', title: 'Rent reconciliation', code: 'compare_saved_rows()', outputs: [] },
    ];
    const before = structuredClone(cells);
    const html = renderToStaticMarkup(createElement(AnalystNotebook, { cells, updatedAt: null }));
    expect([...html.matchAll(/<h4>(.*?)<\/h4>/g)].map((match) => match[1])).toEqual([
      'Monthly rent share',
      'What changed',
      'Query results 3',
      'Notes 4',
      'Calculation 5',
      'Rent reconciliation',
    ]);
    expect(html).toContain('aria-label="Monthly rent share"');
    expect(html).toContain('plot_exact_values()');
    expect(html).toContain('SELECT amount FROM ledger;');
    expect(html).toContain('difference = current - previous');
    expect(cells).toEqual(before);
  });
});
