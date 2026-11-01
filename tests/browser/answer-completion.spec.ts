import { expect, test } from '@playwright/test';

// Scripted API responses check visible partial/withheld behavior, not model
// interpretation. Backend and PostgreSQL suites verify how these are produced.
test('a partial answer keeps the missing calculation visible above its supporting records', async ({
  page,
  baseURL,
}) => {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL!).hostname);
  const meta = await (await page.request.get('/api/meta')).json();
  await page.route('**/api/meta', (route) =>
    route.fulfill({ json: { ...meta, ai: { ...meta.ai, available: true } } }),
  );
  const question = 'Show January and February expenses and calculate the change.';
  const answer =
    'I could only complete part of this request. Still unresolved: “calculate the change”. Any available supporting results are shown below.';
  await page.route('**/api/ai/chat', (route) => {
    expect(route.request().postDataJSON()).toEqual({ messages: [{ role: 'user', content: question }] });
    return route.fulfill({
      json: {
        answer,
        limitation: { code: 'ANSWER_INCOMPLETE' },
        completion: {
          completionBasis: 'model_declared',
          userIntentVerified: false,
          status: 'partial',
          outputs: [],
        },
        evidence: [
          {
            title: 'Net expenses',
            period: '2026-01-01 → 2026-02-28',
            source: 'posted',
            href: '/reports',
            factSource: { kind: 'query_result', queryId: 'months', truncated: false },
            rows: [
              {
                label: 'January',
                value: '$240.00',
                factRef: { kind: 'query_row', queryId: 'months', rowId: 'month:2026-01' },
              },
              {
                label: 'February',
                value: '$90.00',
                factRef: { kind: 'query_row', queryId: 'months', rowId: 'month:2026-02' },
              },
            ],
          },
        ],
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Financial assistant', exact: true });
  await dialog.getByLabel('Ask a financial question').fill(question);
  await dialog.getByRole('button', { name: 'Send question', exact: true }).click();
  const message = dialog.locator('.chat-message.assistant');
  await expect(message.locator('.chat-message-content > p')).toHaveText(answer);
  await expect(message.getByText('$240.00', { exact: true })).toBeVisible();
  await expect(message.getByText('$90.00', { exact: true })).toBeVisible();
  await expect(message.getByText('-$150.00', { exact: true })).toHaveCount(0);
  await expect(message).not.toContainText('model_declared');
  await expect(message.locator('.evidence-card')).toHaveCount(1);
  const warning = await message.locator('.chat-message-content > p').boundingBox();
  const evidence = await message.locator('.evidence-card').boundingBox();
  expect(warning!.y + warning!.height).toBeLessThanOrEqual(evidence!.y);
});

test('a withheld answer displays its explanation without financial cards or internal bindings', async ({
  page,
  baseURL,
}) => {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL!).hostname);
  const meta = await (await page.request.get('/api/meta')).json();
  await page.route('**/api/meta', (route) =>
    route.fulfill({ json: { ...meta, ai: { ...meta.ai, available: true } } }),
  );
  const answer =
    "I couldn't verify that the results match the requested accounts, dates or calculations, so I haven't shown a financial answer. Please clarify the part you want to check.";
  await page.route('**/api/ai/chat', (route) =>
    route.fulfill({
      json: {
        answer,
        facts: [],
        evidence: [],
        limitation: { code: 'INVALID_ANSWER_BINDING' },
        completion: {
          completionBasis: 'model_declared',
          userIntentVerified: false,
          status: 'unassessed',
          outputs: [{ outputId: 'expense', status: 'invalid', evidence: [] }],
        },
        outputBindings: [
          {
            outputId: 'expense',
            source: { kind: 'query_row', queryId: 'wrong_account', rowId: 'total:total' },
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Financial assistant', exact: true });
  await dialog
    .getByLabel('Ask a financial question')
    .fill('How much did we spend on Office supplies in January?');
  await dialog.getByRole('button', { name: 'Send question', exact: true }).click();
  const message = dialog.locator('.chat-message.assistant');
  await expect(message.locator('.chat-message-content > p')).toHaveText(answer);
  await expect(message.locator('.evidence-card')).toHaveCount(0);
  await expect(message).not.toContainText(/wrong_account|total:total|model_declared|\$240/);
  await expect(dialog.getByLabel('Ask a financial question')).toBeEnabled();
});
