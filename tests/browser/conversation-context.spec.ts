import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

type Message = { role: 'user' | 'assistant'; content: string };
type Flow = 'insights' | 'entry';
const flows: Flow[] = ['insights', 'entry'];
const firstQuestion =
  'Use only Office supplies from Paper Shop between 2026-01-01 and 2026-03-31, with amounts above $340.25.';

// API responses are deliberately mocked. These tests prove exact conversation
// transport and visible state, not model interpretation or financial accuracy.
async function openFlow(page: Page, baseURL: string | undefined, flow: Flow) {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL!).hostname);
  const meta = await (await page.request.get('/api/meta')).json();
  await page.route('**/api/meta', (route) =>
    route.fulfill({ json: { ...meta, ai: { ...meta.ai, available: true } } }),
  );
  await page.goto(flow === 'insights' ? '/' : '/transactions');
  await page
    .getByRole('button', {
      name: flow === 'insights' ? 'Ask a question' : 'Record transaction',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', {
    name: flow === 'insights' ? 'Financial assistant' : 'Record transaction',
    exact: true,
  });
  if (flow === 'entry') await dialog.getByRole('button', { name: 'Describe it', exact: true }).click();
  return {
    dialog,
    input: dialog.getByLabel(flow === 'insights' ? 'Ask a financial question' : 'Describe your transaction'),
    send: dialog.getByRole('button', {
      name: flow === 'insights' ? 'Send question' : 'Prepare transaction',
      exact: true,
    }),
    reset: dialog.getByRole('button', { name: 'New conversation', exact: true }),
    messages: dialog.locator(flow === 'insights' ? '.chat-message' : '.ai-entry-message'),
  };
}

function response(flow: Flow, questions: string[]) {
  const content = questions.join('\n');
  return flow === 'insights'
    ? {
        answer: content,
        evidence: [
          {
            title: 'Mocked supporting records',
            period: '2026-01-01 → 2026-03-31',
            rows: [],
            href: '/reports',
          },
        ],
      }
    : { action: 'CLARIFY', explanation: '', questions, entry: null };
}

for (const flow of flows) {
  test(`${flow}: preserves the exact original scope past six turns and twelve messages`, async ({
    page,
    baseURL,
  }) => {
    const submissions: { messages: Message[]; date?: string }[] = [];
    const expected: Message[] = [];
    let releaseFirst!: () => void;
    const firstResponse = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    await page.route(`**/api/ai/${flow === 'insights' ? 'chat' : 'entry'}`, async (route) => {
      submissions.push(route.request().postDataJSON());
      if (submissions.length === 1) await firstResponse;
      await route.fulfill({
        json: response(flow, [`Clarification ${submissions.length}: keep that scope?`]),
      });
    });
    const ui = await openFlow(page, baseURL, flow);
    await expect(ui.input).toHaveAttribute('maxlength', '4000');
    for (let turn = 1; turn <= 7; turn++) {
      const content = turn === 1 ? firstQuestion : `Follow-up ${turn}: keep those same constraints.`;
      expected.push({ role: 'user', content });
      await ui.input.fill(content);
      await ui.send.click();
      if (turn === 1) {
        await expect.poll(() => submissions.length).toBe(1);
        await expect(ui.reset).toBeDisabled();
        releaseFirst();
      }
      const answer = `Clarification ${turn}: keep that scope?`;
      await expect(ui.messages.last()).toContainText(answer);
      expect(submissions.at(-1)?.messages).toEqual(expected);
      // UI evidence and any extra response properties never become messages.
      for (const message of submissions.at(-1)!.messages)
        expect(Object.keys(message).sort()).toEqual(['content', 'role']);
      expected.push({ role: 'assistant', content: answer });
    }
    expect(submissions[5].messages).toHaveLength(11);
    expect(submissions[6].messages).toHaveLength(13);
    expect(submissions[6].messages[0]).toEqual({ role: 'user', content: firstQuestion });
    await expect(ui.messages).toHaveCount(14);
    if (flow === 'entry') {
      // Selecting the already-active tab is not an implicit conversation reset.
      await ui.dialog.getByRole('button', { name: 'Describe it', exact: true }).click();
      await expect(ui.messages).toHaveCount(14);
    }
  });

  test(`${flow}: refuses an oversized conversation without a call or lost input and resets explicitly`, async ({
    page,
    baseURL,
  }) => {
    const submissions: { messages: Message[] }[] = [];
    // Four valid clarification questions, each below the 500-character limit,
    // create a 1,999-character assistant message in either flow.
    const questions = Array.from({ length: 4 }, (_, index) => `${index + 1}: ` + 'q'.repeat(496));
    expect(questions.join('\n')).toHaveLength(1999);
    await page.route(`**/api/ai/${flow === 'insights' ? 'chat' : 'entry'}`, (route) => {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({ json: response(flow, questions) });
    });
    const ui = await openFlow(page, baseURL, flow);
    for (let turn = 1; turn <= 8; turn++) {
      const content = `${firstQuestion} Turn ${turn}. `.padEnd(4000, 'x');
      await ui.input.fill(content);
      await ui.send.click();
      await expect(ui.messages).toHaveCount(turn * 2);
    }
    expect(submissions).toHaveLength(8);
    const draft = 'Keep every earlier account, date, vendor and amount constraint.';
    await ui.input.fill(draft);
    await ui.send.click();
    await expect(ui.dialog.getByText('This conversation is full.', { exact: false })).toBeVisible();
    await expect(ui.input).toHaveValue(draft);
    await expect(ui.messages).toHaveCount(16);
    await expect(ui.messages.first()).toContainText(firstQuestion);
    expect(submissions).toHaveLength(8);

    await ui.reset.click();
    await expect(ui.messages).toHaveCount(0);
    await expect(ui.input).toHaveValue(draft);
    await expect(ui.dialog.getByText('This conversation is full.', { exact: false })).toHaveCount(0);
    await ui.send.click();
    await expect(ui.messages).toHaveCount(2);
    expect(submissions).toHaveLength(9);
    expect(submissions.at(-1)?.messages).toEqual([{ role: 'user', content: draft }]);
  });
}

test('insights: input is disabled during a request and a failure restores the original question', async ({
  page,
  baseURL,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route('**/api/ai/chat', async (route) => {
    calls++;
    await pending;
    await route.fulfill({
      status: 503,
      json: {
        error: { code: 'AI_SERVICE_UNAVAILABLE', message: 'The assistant is temporarily unavailable.' },
      },
    });
  });
  const ui = await openFlow(page, baseURL, 'insights');
  await ui.input.fill(firstQuestion);
  await ui.send.click();
  await expect.poll(() => calls).toBe(1);
  await expect(ui.input).toBeDisabled();
  release();
  await expect(ui.dialog.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(ui.input).toBeEnabled();
  await expect(ui.input).toHaveValue(firstQuestion);
  await expect(ui.messages).toHaveCount(0);
  expect(calls).toBe(1);
});

for (const action of ['reset_then_manual', 'keep_then_correct', 'reset_then_replace'] as const) {
  test(`entry: ${action} preserves the intended saved proposal binding after posting fails`, async ({
    page,
    baseURL,
  }) => {
    const ui = await openFlow(page, baseURL, 'entry');
    const meta = await (await page.request.get('/api/meta')).json();
    const chart = (await (await page.request.get('/api/accounts')).json()) as {
      id: string;
      code: string;
    }[];
    const ids = Object.fromEntries(chart.map((account) => [account.code, account.id]));
    for (const code of ['5030', '5020', '2100']) expect(ids[code]).toBeTruthy();
    const draftId = randomUUID(),
      proposalIds = [randomUUID(), randomUUID()];
    let proposals = 0;
    await page.route('**/api/ai/entry', (route) => {
      const proposalId = proposalIds[proposals++];
      return route.fulfill({
        json: {
          action: 'READY',
          explanation: 'Review Office supplies and Company credit card before posting.',
          questions: [],
          proposalId,
          entry: {
            date: meta.today,
            description: 'Printer paper from Paper Shop',
            counterparty: 'Paper Shop',
            reference: '',
            source: 'AI',
            lines: [
              { accountId: ids['5030'], debit: '340', credit: '0', exchangeRate: '1', memo: '' },
              { accountId: ids['2100'], debit: '0', credit: '340', exchangeRate: '1', memo: '' },
            ],
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
        json: { error: { code: 'STALE_DRAFT', message: 'Review the saved draft before trying again.' } },
      }),
    );
    await page.route(`**/api/entries/${draftId}`, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      updated = route.request().postDataJSON();
      await route.fulfill({ json: { ...updated, id: draftId, revision: 2, status: 'DRAFT' } });
    });
    await ui.input.fill('Bought $340 printer paper from Paper Shop with Company credit card.');
    await ui.send.click();
    const form = page.getByRole('dialog');
    await form.getByRole('button', { name: 'Confirm and post', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('Review the saved draft');
    expect(created?.proposalId).toBe(proposalIds[0]);

    if (action === 'keep_then_correct') {
      await form.getByRole('button', { name: 'Edit journal lines', exact: true }).click();
    } else {
      await form.getByRole('button', { name: 'New conversation', exact: true }).click();
      if (action === 'reset_then_replace') {
        await form.getByLabel('Describe your transaction').fill('A new $340 supplies purchase on the card.');
        await form.getByRole('button', { name: 'Prepare transaction', exact: true }).click();
      } else {
        await form.getByRole('button', { name: 'Journal entry', exact: true }).click();
      }
    }
    if (action !== 'reset_then_replace')
      await form.getByLabel('Line 1 account', { exact: true }).selectOption(ids['5020']);
    await form.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(form).not.toBeVisible();
    expect(updated).toMatchObject({ expectedRevision: 1 });
    if (action === 'reset_then_manual') {
      expect(updated).toMatchObject({ clearProposal: true });
      expect(updated).not.toHaveProperty('proposalId');
    } else {
      expect(updated?.proposalId).toBe(proposalIds[action === 'keep_then_correct' ? 0 : 1]);
      expect(updated).not.toHaveProperty('clearProposal');
    }
    expect(proposals).toBe(action === 'reset_then_replace' ? 2 : 1);
  });
}
