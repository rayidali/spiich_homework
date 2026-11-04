import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Decimal } from 'decimal.js';
import { expect, test, type Page } from '@playwright/test';
import type { AnalystChart, AnalystConversation } from '../../shared/analyst';

// Actual saved answers, replayed through real UI components. This is neither a
// new model run nor evidence of a fresh hosted database/provider integration.
type Replay = {
  kind: string;
  caseId: 'A06' | 'A08' | 'A18';
  provider: 'daybook' | 'querio';
  businessDate: string;
  organizationId: string;
  provenance: {
    sourceCommit: string;
    modelId: string;
    captureSha256: string;
    sanitizedStateSha256: string;
    referenceHashes: Record<string, string>;
  };
  state: AnalystConversation;
};
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
const expectedBytes = readFileSync(resolve('tests/analyst-workspace-acceptance/expected.json'));
const facts = JSON.parse(expectedBytes.toString()).facts;
const cases = [
  ['daybook', 'A06'],
  ['daybook', 'A08'],
  ['daybook', 'A18'],
  ['querio', 'A06'],
  ['querio', 'A18'],
] as const;
const number = (value: string | null) => {
  if (value === null || !/^(?:USD\s*|[$€])?[-+]?\d[\d,]*(?:\.\d+)?%?$/.test(value.trim())) return null;
  return new Decimal(value.replace(/USD|[$€,%\s]/g, ''));
};
const near = (actual: string | null, expected: string, tolerance = '0.0051') =>
  number(actual)?.minus(expected).abs().lte(tolerance) ?? false;
const month = (value: string) => {
  const iso = value.match(/^(2026)-(\d{2})(?:-\d{2})?$/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const index = names.findIndex((name) => new RegExp(`\\b${name}[a-z]*\\b`, 'i').test(value));
  return index < 0 ? null : `2026-${String(index + 1).padStart(2, '0')}`;
};

async function recordedWorkspace(page: Page, fixture: Replay, origin: string) {
  const forbidden: string[] = [],
    errors: string[] = [],
    reads: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ org, provider, id }) => {
      sessionStorage.setItem(`daybook.${provider}.conversation.v1.${org}`, id);
      sessionStorage.setItem(`daybook.${provider}.conversation.v1.workspace`, id);
    },
    { org: fixture.organizationId, provider: fixture.provider, id: fixture.state.id },
  );
  await page.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin || request.method() !== 'GET') {
      forbidden.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    reads.push(url.pathname);
    if (url.pathname === '/api/meta')
      return route.fulfill({
        json: {
          organization: {
            id: fixture.organizationId,
            name: 'Recorded synthetic acceptance',
            base_currency: 'USD',
            timezone: 'America/New_York',
          },
          today: fixture.businessDate,
          ai: { available: true, analystAvailable: true, model: fixture.provenance.modelId },
          alertCount: 0,
          demo: false,
        },
      });
    if (url.pathname === '/api/accounts') return route.fulfill({ json: [] });
    if (url.pathname === '/api/health') return route.fulfill({ json: { status: 'ok' } });
    const status = url.pathname.match(/^\/api\/ai\/(daybook|querio)\/status$/);
    if (status)
      return route.fulfill({
        json: {
          available: true,
          provider: status[1],
          sourceLabel: fixture.state.sourceLabel,
          modelLabel: status[1] === fixture.provider ? fixture.provenance.modelId : 'Recorded replay',
        },
      });
    if (url.pathname === `/api/ai/${fixture.provider}/conversations/${fixture.state.id}`)
      return route.fulfill({ json: fixture.state });
    forbidden.push(`GET ${url.pathname}`);
    return route.abort('blockedbyclient');
  });
  return { forbidden, errors, reads };
}

function assertRequestedFacts(
  caseId: Replay['caseId'],
  renderedTables: { columns: string[]; rows: string[][] }[],
  charts: AnalystChart[],
  answerText: string,
) {
  const financialFindings: { field: string; captured: string | null; expected: string; note: string }[] = [];
  if (caseId === 'A06') {
    const months = facts['rent.monthly_shares'].value as {
      month: string;
      rent: string;
      expenses: string;
      rent_pct: string | null;
    }[];
    const table = renderedTables.find(({ rows }) =>
      months.every((expected) => rows.some((row) => month(row[0]) === expected.month)),
    );
    expect(table, 'Actual supporting table must show every requested month').toBeDefined();
    for (const expected of months) {
      const row = table!.rows.find((row) => month(row[0]) === expected.month)!;
      expect(row.some((value) => near(value, expected.rent))).toBe(true);
      expect(row.some((value) => near(value, expected.expenses))).toBe(true);
      if (expected.rent_pct !== null) expect(row.some((value) => near(value, expected.rent_pct!))).toBe(true);
      // Preserve provider table spellings such as "nan"; the chart must use a real null gap.
    }
    const chart = charts.find(
      (candidate) =>
        candidate.labels.length === months.length &&
        candidate.labels.every((label, index) => month(label) === months[index].month),
    );
    expect(chart, 'The actual chart must retain all months, including undefined ratios').toBeDefined();
    expect(
      chart!.series.some((series) =>
        series.values.every((value, index) =>
          months[index].rent_pct === null ? value === null : near(value, months[index].rent_pct!),
        ),
      ),
    ).toBe(true);
    expect(
      `${chart!.title} ${chart!.yLabel} ${chart!.series.map((series) => series.name).join(' ')}`,
    ).toMatch(/%|percent|share/i);
  } else if (caseId === 'A08') {
    const months = facts['expenses.trailing_three'].value as { month: string; expenses: string }[];
    const table = renderedTables.find(({ rows }) =>
      months.every((expected) =>
        rows.some(
          (row) => month(row[0]) === expected.month && row.some((value) => near(value, expected.expenses)),
        ),
      ),
    );
    expect(table, 'The monthly totals must include the requested zero-activity month').toBeDefined();
    const chart = charts.find(
      (candidate) =>
        candidate.labels.length === months.length &&
        candidate.labels.every((label, index) => month(label) === months[index].month),
    );
    expect(chart, 'The actual chart must retain every completed calendar month').toBeDefined();
    expect(chart!.format).toBe('currency');
    expect(chart!.currency).toBe('USD');
    expect(
      chart!.series.some((series) =>
        series.values.every((value, index) => near(value, months[index].expenses)),
      ),
    ).toBe(true);
    // A requested statistic can be stated in the answer; a separate summary
    // table is an optional layout, not an additional financial requirement.
    for (const [label, key] of [
      [/\bmean\b|\baverage\b/i, 'expenses.trailing_mean'],
      [/\bmedian\b/i, 'expenses.trailing_median'],
    ] as const) {
      const correctLabeledValue = answerText
        .split('\n')
        .some(
          (line) =>
            label.test(line) &&
            [...line.matchAll(/(?:USD\s*|[$€])?[-+]?\d[\d,]*(?:\.\d+)?%?/g)].some((match) =>
              near(match[0], facts[key].value),
            ),
        );
      expect(correctLabeledValue, `The answer must label the correct ${key}`).toBe(true);
    }
    const summary = renderedTables.find(
      ({ columns }) =>
        columns.some((column) => /mean|average/i.test(column)) &&
        columns.some((column) => /median/i.test(column)),
    );
    if (summary) {
      const meanColumn = summary.columns.findIndex((column) => /mean|average/i.test(column));
      const medianColumn = summary.columns.findIndex((column) => /median/i.test(column));
      expect(
        summary.rows.some(
          (row) =>
            near(row[meanColumn], facts['expenses.trailing_mean'].value) &&
            near(row[medianColumn], facts['expenses.trailing_median'].value),
        ),
      ).toBe(true);
    }
  } else {
    const vendors = facts['vendors.top_three'].value as {
      vendor: string;
      expense: string;
      share_pct: string;
      cumulative_pct: string;
    }[];
    const table = renderedTables.find(
      ({ columns, rows }) =>
        columns.some((column) => /cumul/i.test(column) && /pct|percent|share/i.test(column)) &&
        vendors.every((expected) => rows.some((row) => row.includes(expected.vendor))),
    );
    expect(table, 'Actual supporting table must contain all three requested vendors').toBeDefined();
    for (const expected of vendors) {
      const row = table!.rows.find((row) => row.includes(expected.vendor))!;
      expect(row.some((value) => near(value, expected.expense))).toBe(true);
      expect(row.some((value) => near(value, expected.share_pct))).toBe(true);
      const cumulativeIndex = table!.columns.findIndex(
        (column) => /cumul/i.test(column) && /pct|percent|share/i.test(column),
      );
      const actual = row[cumulativeIndex] ?? null;
      if (!near(actual, expected.cumulative_pct))
        financialFindings.push({
          field: `${expected.vendor}.cumulative_share_pct`,
          captured: actual,
          expected: new Decimal(expected.cumulative_pct).toDecimalPlaces(2).toFixed(2),
          note: 'The UI faithfully renders this captured financial error; rendering success does not correct its independent accuracy score.',
        });
    }
    const chart = charts.find((candidate) =>
      vendors.every((vendor) => candidate.labels.includes(vendor.vendor)),
    );
    expect(chart, 'A rendered chart must include the actual top three vendors').toBeDefined();
    expect(
      chart!.series.some((series) =>
        ['expense', 'share_pct', 'cumulative_pct'].some((field) =>
          vendors.every((vendor) =>
            near(
              series.values[chart!.labels.indexOf(vendor.vendor)],
              vendor[field as 'expense' | 'share_pct' | 'cumulative_pct'],
            ),
          ),
        ),
      ),
      'Chart values must match independent amounts or shares, including the full-expense denominator',
    ).toBe(true);
    const totalColumns = table!.columns.flatMap((column, index) =>
      /total.*expense/i.test(column) ? [index] : [],
    );
    for (const column of totalColumns)
      for (const row of table!.rows) expect(near(row[column], facts['spend.total'].value)).toBe(true);
  }
  return financialFindings;
}

for (const [provider, caseId] of cases)
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1050 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`recorded actual notebook ${provider} ${caseId} ${viewport.name}`, async ({ page }, testInfo) => {
      const bytes = readFileSync(
        new URL(`./fixtures/recorded-analyst/${provider}-${caseId.toLowerCase()}.json`, import.meta.url),
      );
      const fixture = JSON.parse(bytes.toString()) as Replay;
      expect(fixture.kind).toBe('recorded-actual-response-replay');
      expect(fixture.provider).toBe(provider);
      expect(fixture.caseId).toBe(caseId);
      expect(fixture.state.status).toBe('completed');
      expect(hash(canonical(fixture.state))).toBe(fixture.provenance.sanitizedStateSha256);
      expect(hash(expectedBytes)).toBe(fixture.provenance.referenceHashes['expected.json']);
      await page.setViewportSize(viewport);
      const activity = await recordedWorkspace(
        page,
        fixture,
        new URL(String(testInfo.project.use.baseURL)).origin,
      );
      await page.goto(`/analyst?tab=${provider}`);
      const label = provider === 'daybook' ? 'Daybook' : 'Querio';
      await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByLabel(`${label} answer`).last()).toBeVisible();
      const answerText = await page.getByLabel(`${label} answer`).last().innerText();
      if (viewport.name === 'mobile')
        await page.getByRole('button', { name: 'Notebook', exact: true }).click();
      const notebook = page.getByRole('complementary', { name: `${label} notebook`, exact: true });
      await expect(notebook).toBeVisible();
      const actualCharts = fixture.state.notebook.cells.flatMap((cell) =>
        cell.outputs.flatMap((output) => (output.type === 'chart' ? [output.chart] : [])),
      );
      const expectedTables = fixture.state.notebook.cells.flatMap((cell) =>
        cell.outputs.flatMap((output) => (output.type === 'table' ? [output] : [])),
      );
      const tables = notebook.getByRole('region', { name: 'Notebook results table', exact: true });
      await expect(tables).toHaveCount(expectedTables.length);
      const renderedTables: { columns: string[]; rows: string[][] }[] = [];
      for (let index = 0; index < expectedTables.length; index++) {
        const rows = tables.nth(index).locator('tbody tr');
        await expect(rows).toHaveCount(expectedTables[index].rows.length);
        const rendered: string[][] = [];
        for (let row = 0; row < expectedTables[index].rows.length; row++) {
          await rows.nth(row).scrollIntoViewIfNeeded();
          await expect(rows.nth(row)).toBeVisible();
          const values = await rows.nth(row).locator('td').allTextContents();
          expect(values).toEqual(expectedTables[index].rows[row].map((value) => value ?? '—'));
          rendered.push(values);
        }
        renderedTables.push({ columns: expectedTables[index].columns, rows: rendered });
      }
      const figures = notebook.locator('.analyst-chart-figure');
      await expect(figures).toHaveCount(actualCharts.length);
      expect(actualCharts.length).toBeGreaterThan(0);
      for (let index = 0; index < actualCharts.length; index++) {
        const chart = actualCharts[index],
          figure = figures.nth(index),
          svg = figure.getByRole('img');
        await figure.scrollIntoViewIfNeeded();
        await expect(svg).toBeVisible();
        await expect(figure.locator('figcaption')).toHaveText(chart.title || 'Chart');
        expect((await svg.boundingBox())!.width).toBeGreaterThan(100);
        expect(await svg.innerHTML()).not.toMatch(/(?:NaN|Infinity)/);
        if (chart.kind !== 'pie') {
          const textSize = await svg
            .locator('.analyst-chart-axis')
            .first()
            .evaluate((text) => {
              const matrix = (text as SVGGraphicsElement).getScreenCTM();
              return parseFloat(getComputedStyle(text).fontSize) * (matrix?.a ?? 0);
            });
          expect(
            textSize,
            'Chart text must remain readable at the actual rendered scale',
          ).toBeGreaterThanOrEqual(11);
        }
        await figure.getByText('View chart data', { exact: true }).click();
        const rows = figure.locator('tbody tr');
        await expect(rows).toHaveCount(chart.labels.length);
        for (let row = 0; row < chart.labels.length; row++) {
          await expect(rows.nth(row).locator('th')).toHaveText(chart.labels[row]);
          const shown = await rows.nth(row).locator('td').allTextContents();
          for (let series = 0; series < chart.series.length; series++) {
            const value = chart.series[series].values[row];
            if (value === null) expect(shown[series]).toBe('Not available');
            else expect(near(shown[series], value)).toBe(true);
          }
        }
        if (chart.kind !== 'pie') {
          const marks = svg.locator(chart.kind === 'bar' ? 'rect > title' : 'circle > title');
          const plotted = await marks.allTextContents();
          expect(plotted).toHaveLength(
            chart.series.reduce(
              (count, series) => count + series.values.filter((value) => value !== null).length,
              0,
            ),
          );
          for (const series of chart.series)
            for (let row = 0; row < chart.labels.length; row++) {
              const prefix = `${chart.labels[row]} · ${series.name}:`;
              expect(plotted.some((title) => title.startsWith(prefix))).toBe(series.values[row] !== null);
            }
          if (chart.kind === 'line' || chart.kind === 'area') {
            const runs = chart.series
              .flatMap((series) =>
                series.values.reduce<number[]>(
                  (segments, value) => {
                    if (value === null) segments.push(0);
                    else segments[segments.length - 1]++;
                    return segments;
                  },
                  [0],
                ),
              )
              .filter((length) => length > 1);
            const lines = await svg
              .locator('polyline')
              .evaluateAll((elements) =>
                elements.map((element) => (element.getAttribute('points') ?? '').trim().split(/\s+/).length),
              );
            expect(lines.sort()).toEqual(runs.sort());
          }
        }
      }
      const financialFindings = assertRequestedFacts(caseId, renderedTables, actualCharts, answerText);
      await figures
        .first()
        .evaluate((figure) => figure.scrollIntoView({ block: 'start', inline: 'nearest' }));
      await expect(figures.first().getByRole('img')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(activity.forbidden).toEqual([]);
      expect(activity.errors).toEqual([]);
      const screenshot = testInfo.outputPath(
        `${provider}-${caseId.toLowerCase()}-${viewport.name}-recorded-replay.png`,
      );
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach('recorded notebook screenshot', { path: screenshot, contentType: 'image/png' });
      const provenance = testInfo.outputPath('recorded-replay-provenance.json');
      writeFileSync(
        provenance,
        JSON.stringify(
          {
            kind: fixture.kind,
            provider,
            caseId,
            viewport: viewport.name,
            fixtureSha256: hash(bytes),
            provenance: fixture.provenance,
            allowedReadPaths: activity.reads,
            financialFindings,
            financialContentCertifiedByRendering: false,
            chartsAsserted: actualCharts.length,
            screenshotChartIndex: 0,
            renderedUiCommit: process.env.GITHUB_SHA ?? null,
            modelCalls: 0,
            liveHostedVerification: false,
          },
          null,
          2,
        ),
      );
      await testInfo.attach('recorded replay provenance', {
        path: provenance,
        contentType: 'application/json',
      });
    });
  }
