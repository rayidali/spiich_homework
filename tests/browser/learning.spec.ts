import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Entry, EntryInput } from '../../shared/schema';

function localTestDatabase(baseURL: string | undefined) {
  if (!baseURL || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname))
    throw new Error('The correction workflow browser test requires a local application.');
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('Set an explicit local test DATABASE_URL before running this workflow.');
  const db = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(db.hostname);
  const compose =
    process.env.NODE_ENV === 'test' &&
    db.hostname === 'db' &&
    db.port === '5432' &&
    db.pathname === '/spiich';
  if ((!local && !compose) || db.username !== 'spiich_app')
    throw new Error('The correction workflow requires the restricted local/Compose test database role.');
  return value;
}

test('mocked AI proposal uses real draft binding, posting, correction memory and forgetting', async ({
  page,
  baseURL,
}) => {
  // Only generation is mocked. The structured proposal is issued by the real
  // server service, and every ledger/memory write goes through the real API.
  // Guard before importing server configuration or making any request/write.
  const connectionString = localTestDatabase(baseURL);
  const client = new pg.Client({ connectionString });
  const { recordProposal, getCategorizationContext } = await import('../../server/categorization-memory');
  const { pool } = await import('../../server/db');
  let entryId: string | undefined;
  let transactionDate = '';
  await client.connect();
  try {
    const metaResponse = await page.request.get('/api/meta');
    expect(metaResponse.ok()).toBe(true);
    const meta = (await metaResponse.json()) as {
      organization: { id: string };
      today: string;
      ai: { available: boolean };
    };
    transactionDate = meta.today;
    const org = meta.organization.id;
    expect(org).toMatch(/^[a-f0-9-]{36}$/);
    const chartResponse = await page.request.get('/api/accounts');
    expect(chartResponse.ok()).toBe(true);
    const chart = (await chartResponse.json()) as { id: string; code: string }[];
    const ids = Object.fromEntries(chart.map((account) => [account.code, account.id]));
    for (const code of ['1200', '5030', '2100']) expect(ids[code]).toBeTruthy();
    // Ensure this explicit database is the same test workspace as the server.
    const matching = await client.query(
      'SELECT id FROM accounts WHERE organization_id=$1 AND id=ANY($2::uuid[])',
      [org, [ids['1200'], ids['5030'], ids['2100']]],
    );
    expect(matching.rows).toHaveLength(3);
    const marker = randomUUID();
    const description = `Learning printer paper ${marker}`;
    const counterparty = `Paper Shop ${marker}`;
    const original: EntryInput = {
      date: transactionDate,
      description,
      counterparty,
      reference: '',
      source: 'AI',
      lines: [
        { accountId: ids['1200'], debit: '340', credit: '0', exchangeRate: '1', memo: '' },
        { accountId: ids['2100'], debit: '0', credit: '340', exchangeRate: '1', memo: '' },
      ],
    };
    await client.query('BEGIN');
    let proposalId: string;
    try {
      proposalId = await recordProposal(org, original, client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    await page.route('**/api/meta', (route) =>
      route.fulfill({ json: { ...meta, ai: { ...meta.ai, available: true } } }),
    );
    let generationCalls = 0;
    await page.route('**/api/ai/entry', (route) => {
      generationCalls++;
      return route.fulfill({
        json: {
          action: 'READY',
          explanation: 'Review the proposed accounts before posting.',
          questions: [],
          entry: original,
          proposalId,
        },
      });
    });

    await page.goto('/transactions');
    await page.getByRole('button', { name: 'Record transaction', exact: true }).click();
    const composer = page.getByRole('dialog', { name: 'Record transaction', exact: true });
    await composer.getByRole('button', { name: 'Describe it', exact: true }).click();
    await composer
      .getByLabel('Describe your transaction')
      .fill(
        `Bought USD 340 printer paper, used immediately, from ${counterparty} using Company credit card.`,
      );
    await composer.getByRole('button', { name: 'Prepare transaction', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Review transaction', exact: true });
    await expect(review.getByText('Equipment', { exact: true })).toBeVisible();
    await review.getByRole('button', { name: 'Edit journal lines', exact: true }).click();
    await composer.getByLabel('Line 1 account', { exact: true }).selectOption(ids['5030']);
    const saving = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/entries',
    );
    await composer.getByRole('button', { name: 'Save draft', exact: true }).click();
    const saveResponse = await saving;
    expect(saveResponse.status()).toBe(201);
    const draft = (await saveResponse.json()) as Entry;
    entryId = draft.id;
    expect(draft.status).toBe('DRAFT');
    await expect(composer).not.toBeVisible();
    await expect(page.locator('.toast')).toContainText('Draft saved');
    const binding = await client.query(
      'SELECT bound_entry_id,bound_revision FROM ai_entry_proposals WHERE organization_id=$1 AND id=$2',
      [org, proposalId],
    );
    expect(binding.rows).toEqual([{ bound_entry_id: entryId, bound_revision: draft.revision }]);
    const memoriesBefore = await client.query(
      'SELECT id FROM categorization_memories WHERE organization_id=$1 AND entry_id=$2',
      [org, entryId],
    );
    expect(memoriesBefore.rows).toEqual([]);
    const draftContext = await getCategorizationContext(org, `${description} ${counterparty}`);
    expect(draftContext.corrections.some((item) => item.entryId === entryId)).toBe(false);
    expect(draftContext.history.some((item) => item.id === entryId)).toBe(false);

    // Lose the composer state: later posting must use the persisted binding.
    await page.reload();
    await page.getByLabel('Search transactions', { exact: true }).fill(description);
    await page.getByText(description, { exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Journal entry', exact: true });
    await expect(details.getByText('Draft', { exact: true })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Forget this example', exact: true })).toHaveCount(0);
    const posting = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/entries/${entryId}/post`,
    );
    await details.getByRole('button', { name: 'Post entry', exact: true }).click();
    const postResponse = await posting;
    expect(postResponse.ok()).toBe(true);
    const posted = (await postResponse.json()) as Entry;
    expect(posted.status).toBe('POSTED');
    expect(posted.categorizationLearning?.status).toBe('LEARNED');
    const memoryId = posted.categorizationLearning?.memoryId;
    expect(memoryId).toBeTruthy();
    await expect(details.getByText(/^Your category choice is remembered/)).toBeVisible();
    const stored = await client.query(
      'SELECT entry_id,entry_revision,corrected_lines,status FROM categorization_memories WHERE organization_id=$1 AND id=$2',
      [org, memoryId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({
      entry_id: entryId,
      entry_revision: posted.revision,
      status: 'ACTIVE',
    });
    expect(stored.rows[0].corrected_lines[0].accountId).toBe(ids['5030']);
    const learned = await getCategorizationContext(org, `${description} ${counterparty}`);
    expect(learned.corrections.some((item) => item.id === memoryId && item.entryId === entryId)).toBe(true);

    const forgetting = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname === `/api/ai/corrections/${memoryId}`,
    );
    await details.getByRole('button', { name: 'Forget this example', exact: true }).click();
    expect((await forgetting).ok()).toBe(true);
    await expect(
      details.getByText('This example is no longer used for suggestions.', { exact: true }),
    ).toBeVisible();
    await expect(details.getByRole('button', { name: 'Forget this example', exact: true })).toHaveCount(0);
    const forgotten = await getCategorizationContext(org, `${description} ${counterparty}`);
    expect(forgotten.corrections.some((item) => item.entryId === entryId)).toBe(false);
    expect(forgotten.history.some((item) => item.id === entryId)).toBe(false);
    const after = (await (await page.request.get(`/api/entries/${entryId}`)).json()) as Entry;
    expect(after.status).toBe('POSTED');
    expect(after.revision).toBe(posted.revision);
    expect(after.lines).toEqual(posted.lines);
    expect(after.categorizationLearning?.status).toBe('REVOKED');
    expect(generationCalls).toBe(1);
  } finally {
    // Preserve immutable history while restoring seed aggregates for later
    // browser checks. This is a local test fixture, never a production cleanup.
    try {
      if (entryId) {
        const existing = await page.request.get(`/api/entries/${entryId}`);
        if (existing.ok()) {
          const saved = (await existing.json()) as Entry;
          if (saved.status === 'POSTED' && !saved.reversal_id) {
            const reversed = await page.request.post(`/api/entries/${entryId}/reverse`, {
              headers: { 'Idempotency-Key': randomUUID() },
              data: { date: transactionDate },
            });
            expect(reversed.ok()).toBe(true);
          }
        }
      }
    } finally {
      await client.end();
      await pool.end();
    }
  }
});
