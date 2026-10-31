import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Decimal, formatCurrency } from '../../shared/money';
import type { Entry } from '../../shared/schema';

test('foreign currency journal reaches reports and reverses at its original rate through the UI', async ({
  page,
  baseURL,
}) => {
  if (!baseURL || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname))
    throw new Error('The currency browser workflow requires an isolated local application.');
  const meta = await (await page.request.get('/api/meta')).json();
  const date = meta.today as string;
  const description = `Browser EUR receipt ${randomUUID()}`;
  const chart = (await (await page.request.get('/api/accounts')).json()) as { id: string; code: string }[];
  const ids = Object.fromEntries(chart.map((account) => [account.code, account.id]));
  const reportPath = `/api/reports/income?from=${date}&to=${date}`;
  const before = await (await page.request.get(reportPath)).json();
  let entryId: string | undefined;
  try {
    await page.goto('/transactions');
    await page.getByRole('button', { name: 'Record transaction', exact: true }).click();
    const composer = page.getByRole('dialog', { name: 'Record transaction', exact: true });
    await composer.getByRole('button', { name: 'Journal entry', exact: true }).click();
    await composer.getByLabel('Description', { exact: true }).fill(description);
    await composer.getByLabel('Transaction date', { exact: true }).fill(date);
    await composer.getByLabel('Line 1 account', { exact: true }).selectOption(ids['1020']);
    await composer.getByLabel('Line 1 debit', { exact: true }).fill('50');
    await composer.getByLabel('Line 1 exchange rate', { exact: true }).fill('1.10');
    await composer.getByLabel('Line 2 account', { exact: true }).selectOption(ids['4020']);
    await composer.getByLabel('Line 2 credit', { exact: true }).fill('55');
    const posting = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/entries\/[^/]+\/post$/.test(new URL(response.url()).pathname),
    );
    await composer.getByRole('button', { name: 'Post entry', exact: true }).click();
    const postedResponse = await posting;
    expect(postedResponse.ok()).toBe(true);
    const posted = (await postedResponse.json()) as Entry;
    entryId = posted.id;
    expect(posted.status).toBe('POSTED');
    expect(posted.lines[0].currency).toBe('EUR');
    expect(new Decimal(posted.lines[0].debit).eq('50')).toBe(true);
    expect(new Decimal(posted.lines[0].base_debit).eq('55')).toBe(true);
    expect(new Decimal(posted.lines[0].exchange_rate).eq('1.1')).toBe(true);
    await expect(composer).not.toBeVisible();

    await page.goto(`/reports?tab=income&from=${date}&to=${date}`);
    await expect(page.locator('.net-income strong')).toHaveText(
      formatCurrency(new Decimal(before.netIncome).plus('55')),
    );
    const after = await (await page.request.get(reportPath)).json();
    expect(new Decimal(after.totalRevenue).minus(before.totalRevenue).toFixed(2)).toBe('55.00');
    expect(after.totalExpenses).toBe(before.totalExpenses);

    await page.goto('/transactions');
    await page.getByLabel('Search transactions', { exact: true }).fill(description);
    await page.getByText(description, { exact: true }).click();
    const detail = page.getByRole('dialog', { name: 'Journal entry', exact: true });
    await expect(detail.getByText(/1 EUR = 1\.1\d* USD/)).toBeVisible();
    await detail.getByRole('button', { name: 'Reverse entry', exact: true }).click();
    await detail.getByLabel('Reversal date', { exact: true }).fill(date);
    const reversing = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/entries/${entryId}/reverse`,
    );
    await detail.getByRole('button', { name: 'Post reversal', exact: true }).click();
    const reverseResponse = await reversing;
    expect(reverseResponse.ok()).toBe(true);
    const reversed = (await reverseResponse.json()) as Entry;
    expect(reversed.reverses_entry_id).toBe(entryId);
    expect(reversed.lines[0].exchange_rate).toBe(posted.lines[0].exchange_rate);
    expect(new Decimal(reversed.lines[0].credit).eq('50')).toBe(true);
    const original = (await (await page.request.get(`/api/entries/${entryId}`)).json()) as Entry;
    expect(original.lines).toEqual(posted.lines);
    expect(original.reversal_id).toBe(reversed.id);
    await page.goto(`/reports?tab=income&from=${date}&to=${date}`);
    await expect(page.locator('.net-income strong')).toHaveText(formatCurrency(before.netIncome));
    const restored = await (await page.request.get(reportPath)).json();
    expect(restored).toMatchObject({
      totalRevenue: before.totalRevenue,
      totalExpenses: before.totalExpenses,
      netIncome: before.netIncome,
    });
  } finally {
    // On failure, retain the immutable test record but restore aggregate values
    // for later browser workflows. Never run this fixture against a hosted app.
    if (entryId) {
      const response = await page.request.get(`/api/entries/${entryId}`);
      if (response.ok()) {
        const saved = (await response.json()) as Entry;
        if (saved.status === 'POSTED' && !saved.reversal_id) {
          const reversed = await page.request.post(`/api/entries/${entryId}/reverse`, {
            headers: { 'Idempotency-Key': randomUUID() },
            data: { date },
          });
          expect(reversed.ok()).toBe(true);
        }
      }
    }
  }
});
