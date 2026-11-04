import { expect, test, type Page } from '@playwright/test';
import type { AnalystConversation, AnalystProvider } from '../../shared/analyst';

// Browser-boundary responses test UI behavior only; this is not model-accuracy evidence.
const organizationId = '09b744d7-e0ad-49d6-99af-f920814a8a3c';
const start = Date.parse('2026-11-03T18:00:00.000Z');
const labels = { daybook: 'Daybook', querio: 'Querio' };
async function workspace(page: Page, options: { enabled?: boolean; loseNativeResponse?: boolean } = {}) {
  const records = new Map<string, AnalystConversation>();
  const activity = {
    creates: [] as { provider: AnalystProvider; id: string }[],
    sends: [] as { provider: AnalystProvider; id: string; clientMessageId: string; text: string }[],
    legacy: 0,
    nativeReads: 0,
    writesToBooks: 0,
  };
  let clock = 0;
  const stamp = () => new Date(start + ++clock * 1000).toISOString();
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() !== 'GET' && /\/api\/(accounts|entries|recurring)/.test(path)) activity.writesToBooks++;
    if (path.startsWith('/api/ai/daybook') && req.method() === 'GET') activity.nativeReads++;
    if (path === '/api/meta')
      return route.fulfill({
        json: {
          organization: {
            id: organizationId,
            name: 'UI test books',
            base_currency: 'USD',
            timezone: 'America/New_York',
          },
          today: '2026-11-03',
          ai: {
            available: true,
            model: 'scripted',
            ...(options.enabled === undefined ? {} : { analystAvailable: options.enabled }),
          },
          alertCount: 0,
          demo: false,
        },
      });
    if (path === '/api/accounts') return route.fulfill({ json: [] });
    if (path === '/api/ai/chat') {
      activity.legacy++;
      return route.fulfill({ json: { answer: 'Legacy Daybook answer.', evidence: [] } });
    }
    const matched = path.match(
      /^\/api\/ai\/(daybook|querio)\/(status|conversations)(?:\/([^/]+))?(?:\/(messages|refresh))?$/,
    );
    if (matched) {
      const provider = matched[1] as AnalystProvider,
        [, , kind, id, action] = matched;
      if (kind === 'status')
        return route.fulfill({
          json: {
            provider,
            available: true,
            sourceLabel: 'Daybook live books',
            modelLabel: `${labels[provider]} test model`,
          },
        });
      if (!id && req.method() === 'POST') {
        const { clientConversationId } = req.postDataJSON();
        activity.creates.push({ provider, id: clientConversationId });
        const state: AnalystConversation = {
          id: clientConversationId,
          provider,
          title: 'New conversation',
          sourceLabel: 'Daybook live books',
          status: 'idle',
          phase: null,
          messages: [],
          notebook: { cells: [], updatedAt: null },
          error: null,
          createdAt: stamp(),
          updatedAt: stamp(),
        };
        records.set(clientConversationId, state);
        return route.fulfill({ status: 201, json: state });
      }
      const state = records.get(id);
      if (!state || state.provider !== provider)
        return route.fulfill({
          status: 404,
          json: { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        });
      if (req.method() === 'DELETE') {
        state.status = 'closed';
        state.updatedAt = stamp();
        return route.fulfill({ status: 202, json: state });
      }
      if (action === 'messages' && req.method() === 'POST') {
        const message = req.postDataJSON();
        activity.sends.push({ provider, id, ...message });
        state.messages.push({
          id: message.clientMessageId,
          role: 'user',
          content: message.text,
          createdAt: stamp(),
        });
        state.status = 'running';
        state.phase = 'Reading the saved books';
        state.updatedAt = stamp();
        if (
          options.loseNativeResponse &&
          provider === 'daybook' &&
          activity.sends.filter((s) => s.provider === 'daybook').length === 1
        )
          return route.abort('failed');
        return route.fulfill({ status: 202, json: state });
      }
      if (action === 'refresh' && req.method() === 'POST' && state.status === 'running') {
        state.status = 'completed';
        state.phase = null;
        state.updatedAt = stamp();
        state.messages.push({
          id: `${provider}-${clock}`,
          role: 'assistant',
          content: `${labels[provider]} recorded expenses: **$12.34**.`,
          createdAt: stamp(),
        });
        state.notebook = {
          updatedAt: stamp(),
          cells: [
            {
              id: 'monthly',
              title: `${labels[provider]} monthly expenses`,
              code: 'SELECT month, amount FROM checked_expenses;',
              outputs: [
                {
                  type: 'table',
                  columns: ['Month', 'USD'],
                  rows: [['November', '12.34']],
                  totalRows: 1,
                  truncated: false,
                },
                {
                  type: 'chart',
                  chart: {
                    kind: 'bar',
                    title: `${labels[provider]} expenses`,
                    xLabel: 'Month',
                    yLabel: 'USD',
                    labels: ['November'],
                    series: [{ name: 'Expenses', values: ['12.34'] }],
                    format: 'currency',
                    currency: 'USD',
                  },
                },
              ],
            },
          ],
        };
      }
      return route.fulfill({ json: state });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Unexpected test route.' } },
    });
  });
  return activity;
}

for (const enabled of [undefined, false]) {
  test(`native capability ${enabled === false ? 'disabled' : 'absent'} preserves legacy full-page and drawer flow`, async ({
    page,
  }) => {
    const calls = await workspace(page, { enabled });
    await page.goto('/analyst?tab=daybook');
    await expect(page.getByLabel('Ask a financial question', { exact: true })).toBeVisible();
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Financial assistant', exact: true });
    await expect(dialog.getByLabel('Ask a financial question', { exact: true })).toBeVisible();
    expect(calls.nativeReads).toBe(0);
    expect(calls.creates).toHaveLength(0);
    expect(calls.sends).toHaveLength(0);
    expect(calls.writesToBooks).toBe(0);
  });
}

test('native and Querio keep distinct conversations and pending questions across tabs and reload', async ({
  page,
}) => {
  const calls = await workspace(page, { enabled: true });
  await page.goto('/analyst?tab=daybook');
  const daybook = page.getByLabel('Ask Daybook a financial question');
  await expect(daybook).toBeVisible();
  expect(calls.creates).toHaveLength(0);
  await daybook.fill('Keep my unfinished native question.');
  await page.getByRole('tab', { name: 'Querio', exact: true }).click();
  await page.getByLabel('Ask Querio a financial question').fill('Show expenses.');
  await page.getByRole('button', { name: 'Send to Querio', exact: true }).click();
  await expect(page.getByLabel('Querio answer')).toHaveText('Querio recorded expenses: $12.34.');
  await page.getByRole('tab', { name: 'Daybook', exact: true }).click();
  await expect(daybook).toHaveValue('Keep my unfinished native question.');
  await daybook.fill('Show expenses.');
  await page.getByRole('button', { name: 'Send to Daybook', exact: true }).click();
  await expect(page.getByLabel('Daybook answer')).toHaveText('Daybook recorded expenses: $12.34.');
  const notebook = page.getByRole('complementary', { name: 'Daybook notebook', exact: true });
  await expect(notebook).toBeVisible();
  await expect(notebook.getByRole('cell', { name: '12.34', exact: true })).toBeVisible();
  await expect(notebook.getByRole('img', { name: /Daybook expenses/ })).toBeVisible();
  await notebook.getByText('View query or calculation', { exact: true }).click();
  await expect(notebook.locator('code')).toContainText('SELECT month, amount');
  const ids = await page.evaluate(
    (org) => ({
      daybook: sessionStorage.getItem(`daybook.daybook.conversation.v1.${org}`),
      querio: sessionStorage.getItem(`daybook.querio.conversation.v1.${org}`),
    }),
    organizationId,
  );
  expect(ids.daybook).toBeTruthy();
  expect(ids.querio).toBeTruthy();
  expect(ids.daybook).not.toBe(ids.querio);
  await page.reload();
  await expect(page.getByLabel('Daybook answer')).toHaveText('Daybook recorded expenses: $12.34.');
  expect(calls.creates).toHaveLength(2);
  expect(calls.sends).toHaveLength(2);
  expect(calls.sends.map((s) => s.provider)).toEqual(['querio', 'daybook']);
  expect(calls.legacy).toBe(0);
  expect(calls.writesToBooks).toBe(0);
});

test('native lost-response recovery does not repeat a prompt and its notebook works on mobile', async ({
  page,
}) => {
  const calls = await workspace(page, { enabled: true, loseNativeResponse: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/analyst?tab=daybook');
  await page.getByLabel('Ask Daybook a financial question').fill('Show expenses.');
  await page.getByRole('button', { name: 'Send to Daybook', exact: true }).click();
  await expect(page.getByLabel('Daybook answer')).toHaveText('Daybook recorded expenses: $12.34.');
  await page.getByRole('button', { name: 'Notebook', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Daybook notebook', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /Daybook expenses/ })).toBeVisible();
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect(page.getByLabel('Ask Daybook a financial question')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(calls.creates).toHaveLength(1);
  expect(calls.sends).toHaveLength(1);
  expect(calls.legacy).toBe(0);
  expect(calls.writesToBooks).toBe(0);
});

test('enabled native drawer expands into the native workspace without a fresh submission', async ({
  page,
}) => {
  const calls = await workspace(page, { enabled: true });
  // The drawer owns this new conversation; expanding mounts the full-page workspace.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Financial assistant', exact: true });
  await expect(dialog.getByLabel('Ask Daybook a financial question')).toBeVisible();
  await dialog.getByLabel('Ask Daybook a financial question').fill('Show expenses.');
  await dialog.getByRole('button', { name: 'Send to Daybook', exact: true }).click();
  await expect(dialog.getByLabel('Daybook answer')).toHaveText('Daybook recorded expenses: $12.34.');
  await dialog.getByRole('link', { name: 'Open full workspace' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/analyst\?tab=daybook$/);
  await expect(page.getByLabel('Daybook answer')).toHaveText('Daybook recorded expenses: $12.34.');
  expect(calls.creates).toHaveLength(1);
  expect(calls.sends).toHaveLength(1);
  expect(calls.legacy).toBe(0);
  expect(calls.writesToBooks).toBe(0);
});
