import { expect, test } from '@playwright/test';

// Actual API validation errors; no provider request and no posting. Keep this
// acceptance suite on the isolated development/CI app, not the hosted demo.
test.beforeEach(async ({ baseURL }) => {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL!).hostname);
});

test('entry failure keeps the real API reference, copies it, and retries without duplicating the conversation', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const meta = await (await page.request.get('/api/meta')).json();
  await page.route('**/api/meta', (route) =>
    route.fulfill({ json: { ...meta, ai: { ...meta.ai, available: true } } }),
  );
  const submissions: { messages: { role: string; content: string }[] }[] = [];
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/entries')) writes++;
  });
  await page.route('**/api/ai/entry', async (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      // Reach the real server's validation/error middleware without contacting AI.
      await route.continue({ postData: JSON.stringify({ messages: [], date: meta.today }) });
    } else {
      // This retry tests the UI only; it is not a live clarification score.
      await route.fulfill({
        json: {
          action: 'CLARIFY',
          entry: null,
          explanation: '',
          questions: ['Which account paid the rent?'],
        },
      });
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Record money in or out/ }).click();
  const form = page.getByRole('dialog', { name: 'Record transaction', exact: true });
  await form.getByRole('button', { name: 'Describe it', exact: true }).click();
  const input = form.getByLabel('Describe your transaction');
  const prompt = 'Paid $2400 rent; please help me choose the account.';
  await input.fill(prompt);
  const failedResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/ai/entry') && response.request().method() === 'POST',
  );
  await form.getByRole('button', { name: 'Prepare transaction' }).click();
  const response = await failedResponse;
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.error.code).toBe('INVALID_INPUT');
  expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.headers()['x-request-id']).toBe(body.error.requestId);
  await expect(form.getByRole('alert')).toContainText(body.error.requestId);
  await expect(input).toHaveValue(prompt);
  await form.getByRole('button', { name: 'Copy error reference' }).click();
  await expect(form.getByText('Reference copied.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(body.error.requestId);
  await form.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(form.getByText('Which account paid the rent?', { exact: true })).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[1].messages).toEqual([{ role: 'user', content: prompt }]);
  expect(writes).toBe(0);
});

test('financial chat retains the real failure reference and the question for recovery', async ({ page }) => {
  const meta = await (await page.request.get('/api/meta')).json();
  await page.route('**/api/meta', (route) =>
    route.fulfill({ json: { ...meta, ai: { ...meta.ai, available: true } } }),
  );
  await page.route('**/api/ai/chat', (route) =>
    route.continue({ postData: JSON.stringify({ messages: [] }) }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Financial assistant' });
  const input = chat.getByRole('textbox');
  await input.fill('What is my cash position?');
  const failedResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/ai/chat') && response.request().method() === 'POST',
  );
  await chat.getByRole('button', { name: 'Send question', exact: true }).click();
  const response = await failedResponse;
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(response.headers()['x-request-id']).toBe(body.error.requestId);
  await expect(chat.getByRole('alert')).toContainText(body.error.requestId);
  await expect(input).toHaveValue('What is my cash position?');
});
