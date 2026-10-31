import { expect, test } from '@playwright/test';

// A rendered-UI contract test with a stubbed chat response. It does not measure
// live model routing or SQL totals and must run only against the isolated app.
test('a supplies question retains its scope through clarification and shows only its supporting account', async ({
  page,
  baseURL,
}) => {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL!).hostname);
  const meta = await (await page.request.get('/api/meta')).json();
  await page.route('**/api/meta', (route) =>
    route.fulfill({ json: { ...meta, ai: { ...meta.ai, available: true } } }),
  );
  const submissions: { messages: { role: string; content: string }[] }[] = [];
  const question = 'How much do we spend on office supplies?';
  const clarification =
    'Which period should I use for office supplies: this month, this year, or all recorded history?';
  const answer =
    'You recorded $1,740.00 USD in Office supplies expenses from 2026-01-01 to 2026-10-31. Posted credits and reversals are included in this total.';
  const accountHref = '/accounts?account=00000000-0000-4000-8000-000000000003&from=2026-01-01&to=2026-10-31';
  let entryWrites = 0;
  page.on('request', (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/entries'))
      entryWrites++;
  });
  await page.route('**/api/ai/chat', async (route) => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({
      json:
        submissions.length === 1
          ? {
              answer: clarification,
              evidence: [],
            }
          : {
              answer,
              evidence: [
                {
                  title: 'Expenses · Office supplies',
                  period: '2026-01-01 → 2026-10-31',
                  rows: [{ label: 'Office supplies', value: '$1,740.00', href: accountHref }],
                  href: accountHref,
                },
              ],
            },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Financial assistant' });
  await expect(chat.getByText('Base currency: USD', { exact: true })).toBeVisible();
  const input = chat.getByLabel('Ask a financial question');
  await input.fill(question);
  await chat.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(chat.getByText(clarification, { exact: true })).toBeVisible();
  await expect(chat.locator('.evidence-card')).toHaveCount(0);
  await input.fill('This year.');
  await chat.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(chat.getByText(answer, { exact: true })).toBeVisible();
  expect(submissions).toEqual([
    { messages: [{ role: 'user', content: question }] },
    {
      messages: [
        { role: 'user', content: question },
        { role: 'assistant', content: clarification },
        { role: 'user', content: 'This year.' },
      ],
    },
  ]);
  const card = chat.locator('.evidence-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('heading', { name: 'Expenses · Office supplies' })).toBeVisible();
  await expect(card.locator('.evidence-rows > div')).toHaveCount(1);
  await expect(card.getByRole('link', { name: 'Office supplies', exact: true })).toHaveAttribute(
    'href',
    accountHref,
  );
  await expect(card.getByText('$1,740.00', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: 'View supporting records' })).toHaveAttribute(
    'href',
    accountHref,
  );
  await expect(chat).not.toContainText('Rent');
  await expect(chat).not.toContainText('$57,652.00');
  expect(entryWrites).toBe(0);
});

test('draft analysis is labeled separately and its calculation scope can be inspected', async ({
  page,
  baseURL,
}) => {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL!).hostname);
  const meta = await (await page.request.get('/api/meta')).json();
  await page.route('**/api/meta', (route) =>
    route.fulfill({ json: { ...meta, ai: { ...meta.ai, available: true } } }),
  );
  await page.route('**/api/ai/chat', (route) =>
    route.fulfill({
      json: {
        answer: 'Draft expenses: $300.00. These entries have not been posted.',
        evidence: [
          {
            title: 'Draft expenses',
            period: '2026-09-01 → 2026-09-30',
            source: 'draft',
            scope: 'Drafts only. Office supplies at Acme. These amounts have not been added to your books.',
            rows: [{ label: 'Office supplies', value: '$300.00' }],
            href: '/reports?from=2026-09-01&to=2026-09-30',
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Financial assistant' });
  await chat
    .getByLabel('Ask a financial question')
    .fill('Show draft office supplies expenses at Acme in September 2026.');
  await chat.getByRole('button', { name: 'Send question', exact: true }).click();
  const card = chat.locator('.evidence-card');
  await expect(card.getByText('DRAFTS · NOT POSTED', { exact: true })).toBeVisible();
  await expect(card.getByText('FROM YOUR BOOKS', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Open reports', exact: true })).toHaveAttribute(
    'href',
    '/reports?from=2026-09-01&to=2026-09-30',
  );
  await expect(card.getByRole('link', { name: 'View supporting records', exact: true })).toHaveCount(0);
  const scope = card.locator('.evidence-scope');
  await expect(scope.locator('p')).not.toBeVisible();
  await scope.locator('summary').click();
  await expect(scope.locator('p')).toContainText('have not been added to your books');
});
