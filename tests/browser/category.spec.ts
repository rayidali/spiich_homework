import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Entry } from '../../shared/schema';

function localDatabase(baseURL: string | undefined) {
  if (!baseURL || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname))
    throw new Error('Category browser checks require the local/CI application.');
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('Set an explicit disposable local DATABASE_URL.');
  const url = new URL(value),
    local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const compose =
    process.env.NODE_ENV === 'test' &&
    url.hostname === 'db' &&
    url.port === '5432' &&
    url.pathname === '/spiich';
  if ((!local && !compose) || url.username !== 'spiich_app')
    throw new Error('Category browser checks require the restricted disposable database.');
}
async function open(page: Page, description: string) {
  const meta = await (await page.request.get('/api/meta')).json();
  const chart = (await (await page.request.get('/api/accounts')).json()) as { id: string; code: string }[];
  const ids = Object.fromEntries(chart.map((a) => [a.code, a.id]));
  await page.route('**/api/meta', (route) =>
    route.fulfill({
      json: {
        ...meta,
        category: { available: true, provider: 'reference', model: 'exact-memory-label-rules-v1' },
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /Record money in or out/ }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Description', { exact: true }).fill(description);
  await form.getByLabel('Amount in USD', { exact: true }).fill('340');
  await form.getByRole('combobox', { name: 'Paid from / charged to', exact: true }).selectOption(ids['2100']);
  return { form, meta, ids };
}
test.beforeEach(async ({ baseURL }) => {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL!).hostname);
});

test('category suggestion clarifies purpose, preserves a category-only correction and learns only on reviewed posting', async ({
  page,
  baseURL,
}) => {
  localDatabase(baseURL);
  const { suggestCategory } = await import('../../server/category-service');
  const { query } = await import('../../server/db');
  let postedId: string | undefined;
  const description = `Office supplies paper ${randomUUID()}`;
  const { form, meta, ids } = await open(page, description);
  // The visible payment caption and accessible name must change together.
  await form.getByRole('button', { name: 'Money in', exact: true }).click();
  await expect(form.getByRole('combobox', { name: 'Received into', exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(form.getByRole('combobox', { name: 'From account', exact: true })).toBeVisible();
  await expect(form.getByRole('combobox', { name: 'To account', exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Money out', exact: true }).click();
  await form.getByRole('combobox', { name: 'Paid from / charged to', exact: true }).selectOption(ids['2100']);
  const proposals: string[] = [];
  await page.route('**/api/ai/category', async (route) => {
    // Exercise the real scoped service/repositories with its offline reference.
    // Only the browser transport is intercepted; no provider/key is used.
    const result = await suggestCategory(meta.organization.id, route.request().postDataJSON(), {
      provider: 'reference',
    });
    if (result.decision === 'SELECT') proposals.push(result.proposalId);
    await route.fulfill({ json: result });
  });
  try {
    await form.getByRole('button', { name: 'Suggest category', exact: true }).click();
    await expect(
      form.getByText('Was this for the business, personal use, a loan, or a transfer?', { exact: true }),
    ).toBeVisible();
    expect(proposals).toEqual([]);
    await form.getByRole('button', { name: 'Business expense or income', exact: true }).click();
    await expect(form.getByLabel('What was it for?', { exact: true })).toHaveValue(ids['5030']);
    expect(proposals).toHaveLength(1);
    expect(
      await query('SELECT id FROM journal_entries WHERE organization_id=$1 AND description=$2', [
        meta.organization.id,
        description,
      ]),
    ).toEqual([]);
    await form.getByLabel('What was it for?', { exact: true }).selectOption(ids['5020']);
    await form.getByRole('button', { name: 'Review entry', exact: true }).click();
    await expect(form.getByText('Software & subscriptions', { exact: true })).toBeVisible();
    const post = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/entries\/[^/]+\/post$/.test(new URL(response.url()).pathname),
    );
    await form.getByRole('button', { name: 'Confirm and post', exact: true }).click();
    const response = await post;
    expect(response.ok()).toBe(true);
    const entry = (await response.json()) as Entry;
    postedId = entry.id;
    expect(entry.source).toBe('AI');
    expect(entry.categorizationLearning?.status).toBe('LEARNED');
    const stored = await query<{ bound_entry_id: string }>(
      'SELECT bound_entry_id FROM ai_entry_proposals WHERE organization_id=$1 AND id=$2',
      [meta.organization.id, proposals[0]],
    );
    expect(stored).toEqual([{ bound_entry_id: entry.id }]);
    const memory = await query<{ corrected_lines: { accountId: string }[] }>(
      'SELECT corrected_lines FROM categorization_memories WHERE organization_id=$1 AND entry_id=$2',
      [meta.organization.id, entry.id],
    );
    expect(memory[0].corrected_lines.some((line) => line.accountId === ids['5020'])).toBe(true);
    expect(entry.lines.find((line) => line.account_id === ids['2100'])?.credit).toMatch(/^340(?:\.0+)?$/);
  } finally {
    if (postedId) {
      const response = await page.request.post(`/api/entries/${postedId}/reverse`, {
        data: { date: meta.today },
        headers: { 'Idempotency-Key': randomUUID() },
      });
      expect(response.ok()).toBe(true);
    }
    // This worker may run the learning suite next, which imports the same pool.
    // Do not close shared module state between browser files; the worker owns it.
  }
});

test('changed details ignore a late suggestion and discard a completed suggestion binding', async ({
  page,
}) => {
  const { form, meta, ids } = await open(page, 'Office supplies before change');
  let release: (() => Promise<void>) | undefined,
    seen: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    seen = resolve;
  });
  let calls = 0;
  await page.route('**/api/ai/category', async (route) => {
    calls++;
    const facts = route.request().postDataJSON();
    const fulfill = () =>
      route.fulfill({
        json: {
          decision: 'SELECT',
          accountId: ids['5030'],
          proposalId: randomUUID(),
          entry: {
            date: meta.today,
            description: facts.description,
            source: 'AI',
            counterparty: '',
            reference: '',
            lines: [],
          },
        },
      });
    if (calls === 1) {
      release = fulfill;
      seen();
    } else await fulfill();
  });
  await form.getByRole('button', { name: 'Suggest category', exact: true }).click();
  await pending;
  await form.getByLabel('Description', { exact: true }).fill('New transaction details');
  await form.getByLabel('What was it for?', { exact: true }).selectOption(ids['5020']);
  await release!().catch(() => {});
  await expect(form.getByLabel('Description', { exact: true })).toHaveValue('New transaction details');
  await expect(form.getByLabel('What was it for?', { exact: true })).toHaveValue(ids['5020']);
  await form.getByRole('button', { name: 'Suggest category', exact: true }).click();
  await expect(form.getByLabel('What was it for?', { exact: true })).toHaveValue(ids['5030']);
  await form.getByLabel('Amount in USD', { exact: true }).fill('350');
  let sent: Record<string, unknown> | undefined;
  await page.route('**/api/entries', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { ...sent, id: randomUUID(), revision: 1, status: 'DRAFT' } });
  });
  await form.getByRole('button', { name: 'Review entry', exact: true }).click();
  await form.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(form).not.toBeVisible();
  expect(sent?.source).toBe('MANUAL');
  expect(sent).not.toHaveProperty('proposalId');
});

test('category API errors retain the actual reference and entered details', async ({ page }) => {
  const { form } = await open(page, 'Office supplies failure reference');
  await page.route('**/api/ai/category', (route) =>
    route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), accounts: [] }) }),
  );
  const failure = page.waitForResponse((response) => response.url().endsWith('/api/ai/category'));
  await form.getByRole('button', { name: 'Suggest category', exact: true }).click();
  const response = await failure;
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.error.code).toBe('INVALID_INPUT');
  expect(response.headers()['x-request-id']).toBe(body.error.requestId);
  await expect(form.getByRole('alert')).toContainText(body.error.requestId);
  await expect(form.getByRole('button', { name: 'Copy error reference' })).toBeVisible();
  await expect(form.getByLabel('Description', { exact: true })).toHaveValue(
    'Office supplies failure reference',
  );
  await expect(form.getByLabel('Amount in USD', { exact: true })).toHaveValue('340');
});

test('an unsupported replacement clears the saved category binding after a failed post', async ({ page }) => {
  const { form, meta, ids } = await open(page, 'Office supplies saved draft retry');
  const draftId = randomUUID(),
    proposalId = randomUUID();
  let categoryCalls = 0;
  await page.route('**/api/ai/category', (route) => {
    categoryCalls++;
    if (categoryCalls > 1)
      return route.fulfill({
        json: { decision: 'UNSUPPORTED', reason: 'unsupported_description', message: 'Use full review.' },
      });
    return route.fulfill({
      json: {
        decision: 'SELECT',
        accountId: ids['5030'],
        proposalId,
        entry: {
          date: meta.today,
          description: 'Office supplies saved draft retry',
          source: 'AI',
          counterparty: '',
          reference: '',
          lines: [],
        },
      },
    });
  });
  let created: Record<string, unknown> | undefined, updated: Record<string, unknown> | undefined;
  await page.route('**/api/entries', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    created = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { ...created, id: draftId, revision: 1, status: 'DRAFT' } });
  });
  await page.route(`**/api/entries/${draftId}/post`, (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'STALE_DRAFT',
          message: 'Review the saved draft before trying again.',
          requestId: randomUUID(),
        },
      },
    }),
  );
  await page.route(`**/api/entries/${draftId}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    updated = route.request().postDataJSON();
    await route.fulfill({ json: { ...updated, id: draftId, revision: 2, status: 'DRAFT' } });
  });
  await form.getByRole('button', { name: 'Suggest category', exact: true }).click();
  await expect(form.getByLabel('What was it for?', { exact: true })).toHaveValue(ids['5030']);
  await form.getByRole('button', { name: 'Review entry', exact: true }).click();
  await form.getByRole('button', { name: 'Confirm and post', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Review the saved draft');
  expect(created?.proposalId).toBe(proposalId);
  await form.getByRole('button', { name: 'Edit details', exact: true }).click();
  await form.getByRole('button', { name: 'Suggest category', exact: true }).click();
  await expect(
    form.getByText('This needs the full entry form. You can also choose the correct account yourself.', {
      exact: true,
    }),
  ).toBeVisible();
  await form.getByLabel('What was it for?', { exact: true }).selectOption(ids['5020']);
  await form.getByRole('button', { name: 'Review entry', exact: true }).click();
  await form.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(form).not.toBeVisible();
  expect(updated).toMatchObject({ clearProposal: true, expectedRevision: 1 });
  expect(updated).not.toHaveProperty('proposalId');
});
