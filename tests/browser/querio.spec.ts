import { expect, test, type Page } from '@playwright/test';
import type { AnalystConversation } from '../../shared/analyst';

// This suite checks the actual browser UI with scripted provider-boundary responses.
// It makes no provider calls and does not claim to measure Querio answer accuracy.
const organizationId = '00000000-0000-4000-8000-000000000001';
const initialDate = '2026-11-03T18:00:00.000Z';
const notebook = {
  updatedAt: '2026-11-03T18:00:02.000Z',
  cells: [
    {
      id: 'expenses',
      title: 'Expenses by month',
      code: 'SELECT month, expenses FROM monthly_expenses;',
      outputs: [
        {
          type: 'table' as const,
          columns: ['Month', 'Expenses'],
          rows: [
            ['October', '100.00'],
            ['November', '0.00'],
          ],
          totalRows: 2,
          truncated: false,
        },
        {
          type: 'chart' as const,
          chart: {
            kind: 'bar' as const,
            title: 'Monthly expenses',
            xLabel: 'Month',
            yLabel: 'USD',
            labels: ['October', 'November'],
            series: [{ name: 'Expenses', values: ['100.00', null] }],
            format: 'currency' as const,
            currency: 'USD',
          },
        },
      ],
    },
  ],
};
async function stubWorkspace(
  page: Page,
  options: { available?: boolean; loseFirstResponse?: boolean; failRun?: boolean } = {},
) {
  const counters = {
    creates: 0,
    sends: [] as { text: string; clientMessageId: string; conversationId: string }[],
    refreshes: 0,
    closes: 0,
    writesToBooks: 0,
  };
  const conversations = new Map<string, AnalystConversation>();
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && /\/api\/(entries|accounts|recurring)/.test(path))
      counters.writesToBooks++;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          organization: {
            id: organizationId,
            name: 'Browser test workspace',
            base_currency: 'USD',
            timezone: 'America/New_York',
          },
          today: '2026-11-03',
          ai: { available: true, model: 'scripted' },
          alertCount: 0,
        },
      });
    if (path === '/api/accounts') return route.fulfill({ json: [] });
    if (path === '/api/ai/querio/status')
      return route.fulfill({
        json: {
          available: options.available !== false,
          provider: 'querio',
          sourceLabel: 'Daybook LIVE — all records',
          modelLabel: 'Querio default',
        },
      });
    if (path === '/api/ai/querio/conversations' && request.method() === 'POST') {
      counters.creates++;
      const { clientConversationId: id } = request.postDataJSON();
      const record: AnalystConversation = {
        id,
        provider: 'querio',
        title: 'New conversation',
        sourceLabel: 'Daybook LIVE — all records',
        status: 'idle',
        phase: null,
        messages: [],
        notebook: { cells: [], updatedAt: null },
        error: null,
        createdAt: initialDate,
        updatedAt: initialDate,
      };
      conversations.set(id, record);
      return route.fulfill({ json: record });
    }
    const match = path.match(/^\/api\/ai\/querio\/conversations\/([^/]+)(?:\/(messages|refresh))?$/);
    if (match) {
      const [, id, action] = match,
        record = conversations.get(id);
      if (!record)
        return route.fulfill({
          status: 404,
          json: { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        });
      if (request.method() === 'DELETE') {
        counters.closes++;
        record.status = 'closed';
        return route.fulfill({ status: 202, json: record });
      }
      if (action === 'messages' && request.method() === 'POST') {
        const message = request.postDataJSON();
        counters.sends.push({ ...message, conversationId: id });
        record.messages.push({
          id: message.clientMessageId,
          role: 'user',
          content: message.text,
          createdAt: initialDate,
        });
        record.status = 'running';
        record.phase = 'Reading your records…';
        record.updatedAt = new Date(
          Date.parse(initialDate) + counters.sends.length * 2000 - 1000,
        ).toISOString();
        if (options.loseFirstResponse && counters.sends.length === 1) return route.abort('failed');
        return route.fulfill({ status: 202, json: record });
      }
      if (action === 'refresh' && request.method() === 'POST') {
        counters.refreshes++;
        if (record.status === 'running') {
          record.updatedAt = new Date(Date.parse(initialDate) + counters.sends.length * 2000).toISOString();
          record.phase = null;
          if (options.failRun) {
            record.status = 'failed';
            record.error = {
              code: 'QUERIO_RUN_FAILED',
              message: 'Querio could not finish this analysis. Your books were not changed.',
              requestId: 'a4653ba0-d0ec-40fa-902d-1fa8758a8941',
              retryable: false,
            };
          } else {
            record.status = 'completed';
            record.messages.push({
              id: `reply-${counters.sends.length}`,
              role: 'assistant',
              content:
                counters.sends.length === 1
                  ? '**Recorded expenses were $100.00.**\n\nThe notebook shows the monthly values. [Unsafe link](javascript:alert(1)) <img src="https://invalid.test/leak" onerror="alert(1)">'
                  : 'The follow-up uses the same conversation and live records.',
              createdAt: initialDate,
            });
            record.notebook = notebook;
          }
        }
        return route.fulfill({ json: record });
      }
      return route.fulfill({ json: record });
    }
    if (path === '/api/ai/chat')
      return route.fulfill({
        json: { answer: 'The original Daybook assistant is still available.', evidence: [] },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Unstubbed browser request.' } },
    });
  });
  return counters;
}

test('Querio runs inside Daybook, displays notebook and chart, and resumes without repeating a prompt', async ({
  page,
}) => {
  const calls = await stubWorkspace(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/analyst');
  await expect(page.getByRole('heading', { name: 'Ask your books' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask a question', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Querio', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(calls.creates).toBe(0);
  await page.getByLabel('Ask Querio a financial question').fill('Show monthly expenses.');
  await page.getByRole('button', { name: 'Send to Querio', exact: true }).click();
  await expect(page.getByText('Recorded expenses were $100.00.', { exact: true })).toBeVisible();
  const pane = page.getByRole('complementary', { name: 'Querio notebook' });
  await expect(pane.getByRole('heading', { name: 'Notebook', exact: true })).toBeVisible();
  await expect(pane.getByRole('img', { name: /Monthly expenses/ })).toBeVisible();
  await pane.getByText('View chart data', { exact: true }).click();
  await expect(pane.getByText('Not available', { exact: true })).toBeVisible();
  await pane.getByText('View query or calculation', { exact: true }).click();
  await expect(
    pane.getByText('SELECT month, expenses FROM monthly_expenses;', { exact: true }),
  ).toBeVisible();
  expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
  expect(await page.locator('img[src="https://invalid.test/leak"]').count()).toBe(0);
  expect(calls.sends).toHaveLength(1);
  expect(calls.refreshes).toBeGreaterThan(0);
  await page.getByRole('tab', { name: 'Daybook', exact: true }).click();
  await expect(page.getByLabel('Ask a financial question', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Querio', exact: true }).click();
  await expect(page.getByText('Recorded expenses were $100.00.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Recorded expenses were $100.00.', { exact: true })).toBeVisible();
  expect(calls.creates).toBe(1);
  expect(calls.sends).toHaveLength(1);
  await page.getByLabel('Ask Querio a financial question').fill('And how does that compare?');
  await page.getByRole('button', { name: 'Send to Querio', exact: true }).click();
  await expect(page.getByText('The follow-up uses the same conversation and live records.')).toBeVisible();
  expect(calls.sends[1].conversationId).toBe(calls.sends[0].conversationId);
  expect(calls.sends[1].clientMessageId).not.toBe(calls.sends[0].clientMessageId);
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(page.getByText('A question is a good place to start.')).toBeVisible();
  expect(calls.closes).toBe(1);
  expect(calls.writesToBooks).toBe(0);
  expect(errors).toEqual([]);
});

test('a lost send response reconciles the accepted turn without submitting it twice', async ({ page }) => {
  const calls = await stubWorkspace(page, { loseFirstResponse: true });
  await page.goto('/analyst');
  await page.getByLabel('Ask Querio a financial question').fill('Show monthly expenses.');
  await page.getByRole('button', { name: 'Send to Querio', exact: true }).click();
  await expect(page.getByText('Recorded expenses were $100.00.', { exact: true })).toBeVisible();
  expect(calls.sends).toHaveLength(1);
  expect(calls.writesToBooks).toBe(0);
});

for (const recovery of ['invalid stored UUID', 'rejected saved ID'] as const) {
  test(`${recovery} recovers without trapping the next conversation`, async ({ page }) => {
    const calls = await stubWorkspace(page);
    const staleId =
      recovery === 'invalid stored UUID'
        ? '11111111-1111-1111-1111-111111111111'
        : 'a4653ba0-d0ec-40fa-902d-1fa8758a8941';
    const staleRequests: string[] = [];
    await page.route(`**/api/ai/querio/conversations/${staleId}`, async (route) => {
      staleRequests.push(route.request().method());
      await route.fulfill({
        status: 400,
        json: { error: { code: 'VALIDATION_ERROR', message: 'Invalid conversation reference.' } },
      });
    });
    const storageKey = `daybook.querio.conversation.v1.${organizationId}`;
    await page.addInitScript(({ key, id }) => sessionStorage.setItem(key, id), {
      key: storageKey,
      id: staleId,
    });
    await page.goto('/analyst');
    await expect(page.getByLabel('Ask Querio a financial question')).toBeVisible();
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
    // React StrictMode replays the mount effect in the development browser build.
    // Its aborted GET can reach this route before the replacement GET; neither
    // may create, submit, close or refresh a conversation.
    if (recovery === 'invalid stored UUID') expect(staleRequests).toEqual([]);
    else {
      expect(staleRequests.length).toBeGreaterThanOrEqual(1);
      expect(staleRequests.length).toBeLessThanOrEqual(2);
      expect(staleRequests.every((method) => method === 'GET')).toBe(true);
    }
    const restoredRequestCount = staleRequests.length;
    await page.getByLabel('Ask Querio a financial question').fill('Show monthly expenses.');
    await page.getByRole('button', { name: 'Send to Querio', exact: true }).click();
    await expect(page.getByText('Recorded expenses were $100.00.', { exact: true })).toBeVisible();
    expect(calls.creates).toBe(1);
    expect(calls.sends).toHaveLength(1);
    expect(calls.sends[0].conversationId).not.toBe(staleId);
    expect(staleRequests).toHaveLength(restoredRequestCount);
    expect(calls.closes).toBe(0);
    expect(calls.writesToBooks).toBe(0);
  });
}

test('unavailable integration and failed analysis have clear non-posting states', async ({ page }) => {
  const calls = await stubWorkspace(page, { available: false });
  await page.goto('/analyst');
  await expect(
    page.getByText('Querio is not connected to this Daybook workspace yet.', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('Ask Querio a financial question').fill('Cash?');
  await expect(page.getByRole('button', { name: 'Send to Querio', exact: true })).toBeDisabled();
  expect(calls.creates).toBe(0);
  expect(calls.sends).toHaveLength(0);
});

test('terminal provider failure keeps the question and copyable diagnostic without retrying generation', async ({
  page,
}) => {
  const calls = await stubWorkspace(page, { failRun: true });
  await page.goto('/analyst');
  await page.getByLabel('Ask Querio a financial question').fill('Show monthly expenses.');
  await page.getByRole('button', { name: 'Send to Querio', exact: true }).click();
  await expect(
    page.getByText('Querio could not finish this analysis. Your books were not changed.'),
  ).toBeVisible();
  await expect(page.getByText('a4653ba0-d0ec-40fa-902d-1fa8758a8941', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy error reference' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to Querio', exact: true })).toBeDisabled();
  expect(calls.sends).toHaveLength(1);
});

test('phone layout switches between conversation and notebook without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await stubWorkspace(page);
  await page.goto('/analyst');
  await page.getByLabel('Ask Querio a financial question').fill('Show monthly expenses.');
  await page.getByRole('button', { name: 'Send to Querio', exact: true }).click();
  await expect(page.getByText('Recorded expenses were $100.00.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Notebook', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Querio notebook' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Monthly expenses/ })).toBeVisible();
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect(page.getByLabel('Ask Querio a financial question')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(calls.writesToBooks).toBe(0);
});

test('drawer analyst tabs support keyboard navigation and open the full workspace without creating provider resources', async ({
  page,
}) => {
  const calls = await stubWorkspace(page);
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Ask a question', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Financial assistant', exact: true });
  const daybook = dialog.getByRole('tab', { name: 'Daybook', exact: true });
  const querio = dialog.getByRole('tab', { name: 'Querio', exact: true });
  await expect(daybook).toHaveAttribute('aria-selected', 'true');
  await dialog.getByLabel('Ask a financial question', { exact: true }).fill('Keep this unfinished question.');
  await daybook.focus();
  await page.keyboard.press('ArrowRight');
  await expect(querio).toBeFocused();
  await expect(querio).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(daybook).toBeFocused();
  await expect(dialog.getByLabel('Ask a financial question', { exact: true })).toHaveValue(
    'Keep this unfinished question.',
  );
  await page.keyboard.press('End');
  await expect(querio).toBeFocused();
  await dialog.getByRole('link', { name: 'Open full workspace' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/analyst\?tab=querio$/);
  await expect(page.getByRole('button', { name: 'Ask a question', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Ask Querio a financial question')).toBeVisible();
  expect(calls.creates).toBe(0);
  expect(calls.sends).toHaveLength(0);
});
