import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { Decimal } from '../../shared/money';

test('dashboard loads real balances and all navigation works', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('Daybook · Accounting workspace');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.locator('.metric-value').first()).toContainText('$');
  await expect(page.locator('.recent-table tbody tr')).toHaveCount(6);
  await mkdir('docs/evidence', { recursive: true });
  await page.screenshot({ path: 'docs/evidence/dashboard.png', fullPage: true, animations: 'disabled' });
  await page.locator('.home-analysis > summary').click();
  await page.locator('.chart-data summary').click();
  await expect(page.locator('.chart-data tbody tr')).toHaveCount(6);
  await expect(page.locator('.chart-data tbody tr').last()).toContainText('$37,594.00');
  await page.locator('.chart-data summary').click();
  for (const [link, title] of [
    ['Transactions', 'Transactions'],
    ['Reports', 'Financial reports'],
    ['Settings', 'Settings'],
  ]) {
    await page.getByRole('navigation').getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.locator('main .loading-state')).toHaveCount(0);
    await page.screenshot({
      path: `docs/evidence/${link.toLowerCase().replaceAll(' ', '-')}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.getByRole('link', { name: 'Chart of accounts', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Chart of accounts', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Recurring payments', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Recurring transactions', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('manual entry posts, appears in the ledger and reverses with its history intact', async ({ page }) => {
  const label = `Browser verification ${Date.now()}`;
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Record transaction', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Record transaction', exact: true });
  await composer.getByRole('button', { name: 'Journal entry', exact: true }).click();
  await composer.getByLabel('Description', { exact: true }).fill(label);
  await composer.getByLabel('Line 1 debit', { exact: true }).fill('125.25');
  await composer.getByLabel('Line 2 credit', { exact: true }).fill('125.25');
  await expect(composer.getByText('Your books are balanced')).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/journal-form.png', fullPage: false, animations: 'disabled' });
  await composer.getByRole('button', { name: 'Post entry', exact: true }).click();
  await expect(composer).not.toBeVisible();
  await expect(page.locator('.toast')).toContainText('Entry posted');
  await page.getByLabel('Search transactions', { exact: true }).fill(label);
  await page.getByText(label, { exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'Journal entry' });
  await expect(detail.getByText('This record is immutable.', { exact: false })).toBeVisible();
  await detail.getByRole('button', { name: 'Reverse entry', exact: true }).click();
  await detail.getByRole('button', { name: 'Post reversal', exact: true }).click();
  await expect(detail.getByText('This entry reverses an earlier record.', { exact: false })).toBeVisible();
  await detail.getByRole('button', { name: 'View original', exact: false }).click();
  await expect(detail.getByText('This entry has been reversed.', { exact: false })).toBeVisible();
});

test('reports reconcile and account ledger exposes opening balances', async ({ page }) => {
  await page.goto('/reports');
  await expect(page.locator('.net-income')).toBeVisible();
  await page.getByRole('button', { name: 'Balance sheet', exact: true }).click();
  await expect(page.getByText('Assets equal liabilities plus equity')).toBeVisible();
  await page.getByRole('button', { name: 'Trial balance', exact: true }).click();
  await expect(page.getByText('Your books are balanced')).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/trial-balance.png', fullPage: true, animations: 'disabled' });
  await page.goto('/accounts');
  await page.getByRole('button', { name: 'Operating bank', exact: true }).click();
  await expect(page.getByText('Opening balance', { exact: true })).toBeVisible();
  await expect(page.getByText('Closing balance', { exact: true })).toBeVisible();
});

test('AI status is honest and the mobile layout stays inside the viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Financial assistant' })).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/assistant.png', fullPage: false, animations: 'disabled' });
  const meta = await (await page.request.get('/api/meta')).json();
  if (!meta.ai.available) {
    await expect(page.getByText('Assistant not connected', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send question' })).toBeDisabled();
  }
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.metric-value').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const table = page.locator('.recent-table');
  expect(await table.evaluate((element) => element.scrollWidth <= element.parentElement!.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'docs/evidence/mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Financial reports' })).toBeVisible();
});

test('keyboard focus and touch controls remain usable with reduced motion', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto('/');
  const ask = page.getByRole('button', { name: 'Ask a question', exact: true });
  await ask.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Financial assistant' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  expect(await dialog.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await page.keyboard.press('Escape');
  await expect(ask).toBeFocused();

  const touch = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });
  try {
    const phone = await touch.newPage();
    await phone.goto('/');
    await expect(phone.locator('.metric-value').first()).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const period = phone.getByLabel('Dashboard period');
    expect(
      await period.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    await phone.screenshot({
      path: 'docs/evidence/mobile-touch.png',
      fullPage: true,
      animations: 'disabled',
    });
    const menuButton = phone.getByRole('button', { name: 'Open navigation' });
    await menuButton.tap();
    const navigation = phone.getByRole('dialog', { name: 'Workspace navigation' });
    await expect(navigation).toBeVisible();
    await phone.getByRole('link', { name: 'Daybook overview' }).focus();
    await phone.keyboard.press('Shift+Tab');
    await expect(navigation.getByRole('button', { name: 'Workspace guide' })).toBeFocused();
    await phone.keyboard.press('Tab');
    await expect(phone.getByRole('link', { name: 'Daybook overview' })).toBeFocused();
    await phone.keyboard.press('Escape');
    await expect(menuButton).toBeFocused();
    await phone.getByRole('button', { name: /Record money in or out/ }).tap();
    const composer = phone.getByRole('dialog', { name: 'Record transaction', exact: true });
    await composer.getByRole('button', { name: 'Journal entry', exact: true }).tap();
    await expect(composer).toBeVisible();
    expect(await composer.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
    expect(
      await composer
        .locator('.composer-lines')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await composer
        .getByLabel('Description', { exact: true })
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    await phone.screenshot({
      path: 'docs/evidence/mobile-journal.png',
      fullPage: false,
      animations: 'disabled',
    });
    await phone.keyboard.press('Escape');
    for (const path of ['/transactions', '/accounts', '/reports', '/recurring', '/settings']) {
      await phone.goto(path);
      await expect(phone.locator('main .page-heading')).toBeVisible();
      await expect(phone.locator('main .loading-state')).toHaveCount(0);
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
        true,
      );
    }
  } finally {
    await touch.close();
  }
});

test('accounts can be created, edited, archived, restored and deleted when unused', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'Add an account' });
  await editor.getByLabel('Account code').fill('5071');
  await editor.getByLabel('Account name').fill('Browser professional services');
  await editor.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: 'Edit Browser professional services', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Edit account' });
  await editor.getByLabel('Account name').fill('Browser legal services');
  await editor.getByRole('button', { name: 'Save account', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: 'Archive Browser legal services', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Browser legal services', exact: true })).not.toBeVisible();
  await page.getByLabel('Show archived').check();
  await page.getByRole('button', { name: 'Restore Browser legal services', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Browser legal services', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Edit account' });
  await editor.getByRole('button', { name: 'Delete unused', exact: true }).click();
  await editor.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Browser legal services', exact: true })).not.toBeVisible();
});

test('recurring schedules can be created, edited and paused', async ({ page }) => {
  await page.goto('/recurring');
  await page.getByRole('button', { name: 'New schedule', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New recurring transaction' });
  await form.getByLabel('Template name').fill('Browser test schedule');
  await form.getByLabel('Description', { exact: true }).fill('Monthly workspace rental');
  const meta = await (await page.request.get('/api/meta')).json();
  const future = `${Number(meta.today.slice(0, 4)) + 1}-01-31`;
  await form.getByLabel('First occurrence').fill(future);
  await form.getByLabel('Line 1 debit', { exact: true }).fill('90');
  await form.getByLabel('Line 2 credit', { exact: true }).fill('90');
  await form.getByRole('button', { name: 'Create template', exact: true }).click();
  await expect(form).not.toBeVisible();
  await page.getByText('Browser test schedule', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit template', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit recurring transaction' });
  await edit.getByLabel('Line 1 debit', { exact: true }).fill('95');
  await edit.getByLabel('Line 2 credit', { exact: true }).fill('95');
  await edit.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(edit).not.toBeVisible();
  const row = page.locator('tr').filter({ hasText: 'Browser test schedule' });
  await expect(row).toContainText('$95.00');
  await row.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(row).toContainText('Paused');
});

test('anomaly alerts show historical evidence and preserve review decisions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Review alerts', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Review alerts' });
  const rent = drawer.locator('article').filter({ hasText: 'Rent is above its usual range' });
  await expect(rent).toContainText('median');
  await rent.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(rent).not.toBeVisible();
  await drawer.getByRole('button', { name: 'Reviewed', exact: true }).click();
  await expect(rent).toBeVisible();
  await rent.getByRole('button', { name: 'Reopen' }).click();
  await drawer.getByRole('button', { name: 'Needs review', exact: true }).click();
  await expect(rent).toBeVisible();
});

test('short form reviews the account effects before recording invoice and card payments', async ({
  page,
}) => {
  let writes = 0;
  let saveGate: Promise<void> = Promise.resolve();
  await page.route('**/api/entries', async (route) => {
    if (route.request().method() === 'POST') await saveGate;
    await route.continue();
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/entries')) writes++;
  });
  for (const scenario of [
    {
      direction: 'Money in',
      category: 'Accounts receivable',
      debit: '1010',
      credit: '1100',
      effect: 'Decreases by $125.25',
    },
    {
      direction: 'Money out',
      category: 'Company credit card',
      debit: '2100',
      credit: '1010',
      effect: 'Decreases by $125.25',
    },
  ]) {
    const label = `Short form ${scenario.category} ${Date.now()}`;
    await page.goto('/');
    await page.getByRole('button', { name: /Record money in or out/ }).click();
    const form = page.getByRole('dialog', { name: 'Record transaction', exact: true });
    await expect(form.locator('.composer-lines')).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Confirm and post' })).toHaveCount(0);
    await form.getByLabel('Description', { exact: true }).fill(label);
    await form.getByRole('button', { name: scenario.direction, exact: true }).click();
    await form.getByLabel('Amount in USD', { exact: true }).fill('125.25');
    await form.getByLabel('What was it for?', { exact: true }).selectOption({ label: scenario.category });
    const beforeReview = writes;
    await form.getByRole('button', { name: 'Review entry', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Review transaction', exact: true });
    await expect(review.getByRole('heading', { name: label, exact: true })).toBeFocused();
    await expect(review.locator('.review-line').filter({ hasText: scenario.category })).toContainText(
      scenario.effect,
    );
    expect(writes).toBe(beforeReview);
    let releaseSave!: () => void;
    saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await review.getByRole('button', { name: 'Confirm and post', exact: true }).click();
    await expect(review.getByRole('button', { name: 'Edit details', exact: true })).toBeDisabled();
    await expect(review.getByRole('button', { name: 'Short form', exact: true })).toBeDisabled();
    releaseSave();
    await expect(review).not.toBeVisible();
    await expect(page.locator('.toast')).toContainText('Entry posted');
    const result = await (await page.request.get(`/api/entries?search=${encodeURIComponent(label)}`)).json();
    expect(result.items).toHaveLength(1);
    const entry = await (await page.request.get(`/api/entries/${result.items[0].id}`)).json();
    expect(entry.status).toBe('POSTED');
    expect(
      entry.lines
        .map((line: { account_code: string; debit: string; credit: string }) => ({
          code: line.account_code,
          debit: new Decimal(line.debit).toFixed(2),
          credit: new Decimal(line.credit).toFixed(2),
        }))
        .sort((a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code)),
    ).toEqual(
      [
        { code: scenario.debit, debit: '125.25', credit: '0.00' },
        { code: scenario.credit, debit: '0.00', credit: '125.25' },
      ].sort((a, b) => a.code.localeCompare(b.code)),
    );
  }
});

test('AI clarification and prepared entry remain reviewable without automatic writes', async ({ page }) => {
  const meta = await (await page.request.get('/api/meta')).json();
  const chart: { id: string; code: string }[] = await (await page.request.get('/api/accounts')).json();
  const byCode = Object.fromEntries(chart.map((account) => [account.code, account.id]));
  await page.route('**/api/meta', (route) =>
    route.fulfill({ json: { ...meta, ai: { ...meta.ai, available: true } } }),
  );
  let calls = 0,
    writes = 0;
  let releasePreparation!: () => void;
  const preparationGate = new Promise<void>((resolve) => {
    releasePreparation = resolve;
  });
  await page.route('**/api/ai/entry', async (route) => {
    calls++;
    if (calls === 1) await preparationGate;
    return route.fulfill({
      json:
        calls === 1
          ? {
              action: 'CLARIFY',
              explanation: '',
              questions: ['Which account paid for the rent?'],
              entry: null,
            }
          : {
              action: 'READY',
              explanation: 'Rent increases and the bank balance decreases.',
              questions: [],
              entry: {
                date: meta.today,
                description: 'Rent review demonstration',
                counterparty: '',
                reference: '',
                source: 'AI',
                lines: [
                  { accountId: byCode['5010'], debit: '2400', credit: '0', exchangeRate: '1', memo: '' },
                  { accountId: byCode['1010'], debit: '0', credit: '2400', exchangeRate: '1', memo: '' },
                ],
              },
            },
    });
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/entries')) writes++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Record money in or out/ }).click();
  const form = page.getByRole('dialog', { name: 'Record transaction', exact: true });
  await form.getByRole('button', { name: 'Describe it', exact: true }).click();
  await form.getByLabel('Describe your transaction').fill('Paid $2,400 rent.');
  await form.getByRole('button', { name: 'Prepare transaction' }).click();
  await expect(form.getByLabel('Transaction date', { exact: true })).toBeDisabled();
  await expect(form.getByRole('button', { name: 'Journal entry', exact: true })).toBeDisabled();
  releasePreparation();
  await expect(form.getByText('Which account paid for the rent?', { exact: true })).toBeVisible();
  await expect(form.locator('.composer-lines')).toHaveCount(0);
  await form.getByLabel('Describe your transaction').fill('The operating bank.');
  await form.getByRole('button', { name: 'Prepare transaction' }).click();
  const review = page.getByRole('dialog', { name: 'Review transaction', exact: true });
  await expect(review.locator('.review-line').filter({ hasText: 'Rent' })).toContainText(
    'Increases by $2,400.00',
  );
  await expect(review.locator('.review-line').filter({ hasText: 'Operating bank' })).toContainText(
    'Decreases by $2,400.00',
  );
  await expect(review.getByRole('button', { name: 'Confirm and post' })).toBeEnabled();
  expect(calls).toBe(2);
  expect(writes).toBe(0);
  await review.getByRole('button', { name: 'Edit journal lines' }).click();
  await expect(form.getByLabel('Line 1 debit', { exact: true })).toHaveValue('2400');
  await expect(form.getByLabel('Line 2 credit', { exact: true })).toHaveValue('2400');
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toBe(0);
});
