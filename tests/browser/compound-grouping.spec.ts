import { expect, test } from '@playwright/test';
import type { InsightEvidence } from '../../server/ai';

// The API reply is deliberately stubbed: this checks the existing chat UI's
// request transport and evidence rendering, not model accuracy or SQL arithmetic.
test('insights: renders compound rows, refunds and zero activity with a global truncation warning', async ({
  page,
  baseURL,
}) => {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL!).hostname);
  const question =
    'Show posted net expenses by month, account and counterparty from 2026-01-01 to 2026-03-31. Show the first 3 rows across the whole result, in date/name order.';
  const answer =
    'Net expenses. 2026-01-01 to 2026-03-31. Showing 3 results. There are more; these are not the complete results.';
  const scope =
    '2026-01-01 to 2026-03-31, including both dates. Recorded transactions; corrections count on their own dates. By month and By account and By person or business; in name or date order. Missing periods are filled only for account/person combinations observed in matching transactions after the entry amount filters; unrelated combinations are not invented. The 3-row limit applies to the complete grouped result, not separately to each account or person. Named counterparties are quoted and retain their exact header spelling; blank names are separate. Amounts are in USD, using the exchange rates saved with each transaction.';
  const rows = [
    {
      label: '2026-01 · 5030 · Office supplies · "Acme" · 2026-01-01 to 2026-01-31',
      value: '$100.00',
    },
    {
      label: '2026-02 · 5030 · Office supplies · "Acme" · 2026-02-01 to 2026-02-28',
      value: '-$20.00',
    },
    {
      label: '2026-03 · 5030 · Office supplies · "Acme" · 2026-03-01 to 2026-03-31',
      value: '$0.00',
    },
  ];
  const evidence: InsightEvidence = {
    title: 'Net expenses',
    period: '2026-01-01 → 2026-03-31',
    source: 'posted',
    scope,
    rows,
    href: '/reports?from=2026-01-01&to=2026-03-31',
  };
  const submissions: unknown[] = [];
  const meta = await (await page.request.get('/api/meta')).json();
  await page.route('**/api/meta', (route) =>
    route.fulfill({ json: { ...meta, ai: { ...meta.ai, available: true } } }),
  );
  await page.route('**/api/ai/chat', (route) => {
    expect(route.request().method()).toBe('POST');
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { answer, evidence: [evidence] } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Financial assistant', exact: true });
  await dialog.getByLabel('Ask a financial question').fill(question);
  await dialog.getByRole('button', { name: 'Send question', exact: true }).click();

  await expect(dialog.locator('.chat-message.assistant > .chat-message-content > p')).toHaveText(answer);
  expect(submissions).toEqual([{ messages: [{ role: 'user', content: question }] }]);
  await expect(dialog.locator('.chat-message.user')).toHaveText(question);
  await expect(dialog.getByText('FROM YOUR BOOKS', { exact: true })).toBeVisible();
  const card = dialog.locator('.evidence-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('heading', { name: 'Net expenses', exact: true })).toBeVisible();
  await expect(card.locator('.evidence-rows > div')).toHaveCount(3);
  await expect(card.locator('.evidence-rows > div > span')).toHaveText(rows.map((row) => row.label));
  await expect(card.locator('.evidence-rows > div > strong')).toHaveText(rows.map((row) => row.value));
  await expect(card.getByText('-$20.00', { exact: true })).toBeVisible();
  await expect(card.getByText('$0.00', { exact: true })).toBeVisible();

  // Scope is deliberately behind the existing disclosure, but the global
  // truncation warning remains in the visible answer before opening it.
  await expect(card.locator('.evidence-scope > p')).not.toBeVisible();
  await expect(dialog.getByText(answer, { exact: true })).toBeVisible();
  await card.locator('summary').filter({ hasText: 'What this includes' }).click();
  await expect(card.locator('.evidence-scope > p')).toBeVisible();
  await expect(card.locator('.evidence-scope > p')).toHaveText(scope);
  await expect(card.locator('.evidence-scope')).toContainText('not separately to each account or person');
  await expect(card.locator('.evidence-scope')).toContainText('unrelated combinations are not invented');
  await expect(card.getByRole('link', { name: 'Open reports', exact: true })).toHaveAttribute(
    'href',
    '/reports?from=2026-01-01&to=2026-03-31',
  );
  // The visible three rows are an incomplete slice. The UI must not sum them
  // into an overall $80 answer or turn the limit into a per-vendor ranking.
  await expect(dialog.getByText('$80.00', { exact: true })).toHaveCount(0);
  await expect(card.locator('.evidence-rows')).not.toContainText(
    /overall total|grand total|top 3|3 per vendor/i,
  );
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});
