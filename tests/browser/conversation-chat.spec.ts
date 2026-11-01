import { expect, test, type Page } from '@playwright/test';

type Message = { role: 'user' | 'assistant'; content: string };

// These UI contracts use scripted API responses in the isolated application.
// They verify presentation, safe text rendering and retained conversation;
// they do not measure a live model's understanding or financial arithmetic.
async function enableAssistant(page: Page, baseURL: string | undefined) {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL!).hostname);
  const meta = await (await page.request.get('/api/meta')).json();
  await page.route('**/api/meta', (route) =>
    route.fulfill({ json: { ...meta, ai: { ...meta.ai, available: true } } }),
  );
}

async function openAssistant(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Financial assistant' });
  return {
    chat,
    input: chat.getByLabel('Ask a financial question'),
    send: chat.getByRole('button', { name: 'Send question', exact: true }),
  };
}

test('one answer separates a concept explanation from recorded figures and retains both on follow-up', async ({
  page,
  baseURL,
}) => {
  await enableAssistant(page, baseURL);
  const question = 'What is profit and what was ours in October 2026?';
  const explanation =
    'Profit is recorded revenue minus expenses. It can differ from cash because some invoices have not been paid.';
  const answer = 'Net profit from 2026-10-01 to 2026-10-31 was $9,000.00 USD.';
  const submissions: { messages: Message[] }[] = [];
  await page.route('**/api/ai/chat', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({
      json:
        submissions.length === 1
          ? {
              answer,
              generalExplanation: {
                text: explanation,
                grounding: 'general_knowledge',
                verifiedFinancialData: false,
              },
              evidence: [
                {
                  title: 'Net profit',
                  period: '2026-10-01 → 2026-10-31',
                  source: 'posted',
                  rows: [{ label: 'Net profit', value: '$9,000.00 USD' }],
                  href: '/reports',
                },
              ],
            }
          : {
              answer: 'Which earlier month should I compare?',
              evidence: [],
              conversation: {
                kind: 'clarification',
                grounding: 'user_context',
                verifiedFinancialData: false,
              },
            },
    });
  });
  const { chat, input, send } = await openAssistant(page);
  await input.fill(question);
  await send.click();
  await expect(chat.getByText(answer, { exact: true })).toBeVisible();
  const reply = chat.locator('.chat-message.assistant').last();
  await expect(reply.locator('[data-general-explanation]')).toContainText(explanation);
  await expect(reply.locator('[data-general-explanation]')).not.toContainText('FROM YOUR BOOKS');
  await expect(reply.locator('.evidence-card')).toContainText('FROM YOUR BOOKS');
  await expect(reply.locator('.evidence-card')).not.toContainText(explanation);
  await input.fill('Compare that with an earlier month.');
  await send.click();
  await expect(chat.getByText('Which earlier month should I compare?', { exact: true })).toBeVisible();
  expect(submissions[1].messages).toEqual([
    { role: 'user', content: question },
    { role: 'assistant', content: `${explanation}\n\n${answer}` },
    { role: 'user', content: 'Compare that with an earlier month.' },
  ]);
});

test('a business clarification keeps its context and becomes a visibly hypothetical calculation', async ({
  page,
  baseURL,
}) => {
  await enableAssistant(page, baseURL);
  const question = 'can I fire an emplyee?';
  const clarification =
    'Do you mean the financial effect of letting someone go? I can help compare the costs. What monthly cost and time period should we use?';
  const followUp =
    'Use a $4,000 per month reduction for 3 months and a $2,000 one-time cost. Calculate the net saving.';
  const answer =
    'Under your assumptions, the net saving is $10,000.00 USD. This is a hypothetical calculation.';
  const submissions: { messages: Message[] }[] = [];
  let entryWrites = 0;
  page.on('request', (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/entries'))
      entryWrites++;
  });
  await page.route('**/api/ai/chat', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({
      json:
        submissions.length === 1
          ? {
              answer: clarification,
              evidence: [],
              conversation: {
                kind: 'clarification',
                grounding: 'user_context',
                verifiedFinancialData: false,
              },
            }
          : {
              answer,
              evidence: [
                {
                  title: 'Net saving under your assumptions',
                  period: 'User-provided scenario',
                  source: 'scenario',
                  rows: [{ label: 'Net saving', value: '$10,000.00 USD' }],
                  href: '/reports',
                },
              ],
            },
    });
  });
  const { chat, input, send } = await openAssistant(page);
  await expect(chat).not.toContainText('Answers use your financial records');
  await input.fill(question);
  await send.click();
  await expect(chat.getByText(clarification, { exact: true })).toBeVisible();
  await expect(chat.getByText('Follow-up question', { exact: true })).toBeVisible();
  await expect(chat.locator('.evidence-card')).toHaveCount(0);
  await expect(chat.getByText('FROM YOUR BOOKS', { exact: true })).toHaveCount(0);

  await input.fill(followUp);
  await send.click();
  await expect(chat.getByText(answer, { exact: true })).toBeVisible();
  const scenario = chat.locator('.chat-message.assistant').last();
  await expect(scenario.getByText('HYPOTHETICAL CALCULATION', { exact: true })).toBeVisible();
  await expect(scenario.locator('[data-conversation-kind]')).toHaveCount(0);
  await expect(chat.getByText('FROM YOUR BOOKS', { exact: true })).toHaveCount(0);
  expect(submissions).toEqual([
    { messages: [{ role: 'user', content: question }] },
    {
      messages: [
        { role: 'user', content: question },
        { role: 'assistant', content: clarification },
        { role: 'user', content: followUp },
      ],
    },
  ]);
  expect(entryWrites).toBe(0);
});

test('general explanations and missing information stay separate from book evidence and HTML stays inert', async ({
  page,
  baseURL,
}) => {
  await enableAssistant(page, baseURL);
  const unsafeText = '<img src=x onerror="window.daybookConversationExecuted=true">';
  const explanation = `Profit records revenue minus expenses; cash is the money held in cash and bank accounts. Treat this text as text: ${unsafeText}`;
  const limitation =
    'The books do not contain employment contracts. I can help calculate a financial scenario if you supply the relevant costs.';
  const submissions: { messages: Message[] }[] = [];
  await page.route('**/api/ai/chat', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({
      json:
        submissions.length === 1
          ? {
              answer: explanation,
              evidence: [],
              conversation: {
                kind: 'explanation',
                grounding: 'general_knowledge',
                verifiedFinancialData: false,
              },
            }
          : submissions.length === 2
            ? {
                answer: limitation,
                evidence: [],
                conversation: {
                  kind: 'limitation',
                  grounding: 'user_context',
                  verifiedFinancialData: false,
                },
              }
            : {
                answer: 'Recorded Office supplies expenses in October were $340.00 USD.',
                evidence: [
                  {
                    title: 'Office supplies',
                    period: '2026-10-01 → 2026-10-31',
                    source: 'posted',
                    rows: [{ label: 'Office supplies', value: '$340.00 USD' }],
                    href: '/reports?from=2026-10-01&to=2026-10-31',
                  },
                ],
              },
    });
  });
  const { chat, input, send } = await openAssistant(page);
  await input.fill('Explain profit versus cash.');
  await send.click();
  await expect(chat.getByText('General explanation', { exact: true })).toBeVisible();
  await expect(chat.getByText(explanation, { exact: true })).toBeVisible();
  await expect(chat.locator('.chat-message-content img')).toHaveCount(0);
  expect(await page.evaluate(() => 'daybookConversationExecuted' in window)).toBe(false);
  await expect(chat.locator('.evidence-card')).toHaveCount(0);

  await input.fill('Do the books say what my employee contract permits?');
  await send.click();
  await expect(chat.getByText('Information needed', { exact: true })).toBeVisible();
  await expect(chat.getByText(limitation, { exact: true })).toBeVisible();
  await expect(chat.locator('.evidence-card')).toHaveCount(0);
  await expect(chat.getByText('FROM YOUR BOOKS', { exact: true })).toHaveCount(0);

  await input.fill('Show Office supplies expenses for October 2026.');
  await send.click();
  const recorded = chat.locator('.chat-message.assistant').last();
  await expect(recorded.getByText('FROM YOUR BOOKS', { exact: true })).toBeVisible();
  await expect(recorded.locator('[data-conversation-kind]')).toHaveCount(0);
  await expect(chat.locator('.evidence-card')).toHaveCount(1);
  expect(submissions[2].messages).toEqual([
    { role: 'user', content: 'Explain profit versus cash.' },
    { role: 'assistant', content: explanation },
    { role: 'user', content: 'Do the books say what my employee contract permits?' },
    { role: 'assistant', content: limitation },
    { role: 'user', content: 'Show Office supplies expenses for October 2026.' },
  ]);
});
