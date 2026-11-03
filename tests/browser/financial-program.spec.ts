import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { InsightEvidence } from '../../shared/financial-evidence';

type Message = { role: 'user' | 'assistant'; content: string };

// Scripted chat replies establish presentation and exact conversation transport.
// They do not establish live model interpretation, code execution or arithmetic.
async function openAssistant(page: Page, baseURL: string | undefined) {
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL!).hostname);
  const meta = await (await page.request.get('/api/meta')).json();
  await page.route('**/api/meta', (route) =>
    route.fulfill({ json: { ...meta, ai: { ...meta.ai, available: true } } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Financial assistant', exact: true });
  return {
    dialog,
    input: dialog.getByLabel('Ask a financial question'),
    send: dialog.getByRole('button', { name: 'Send question', exact: true }),
  };
}

const programCode = `
const rent = tables.find(table => table.id === 'rent');
const expenses = tables.find(table => table.id === 'expenses');
return [{title:'Rent share by month',rows:calc.align(rent.rows,expenses.rows).map(({left,right}) => ({
  label:left.label,value:calc.div(left.value,right.value),format:'percent'
}))}];`.trim();
const unavailable = 'Not available — denominator is zero';
const monthLabels = Array.from({ length: 11 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`);
const percentages = [
  unavailable,
  unavailable,
  unavailable,
  unavailable,
  '30.12%',
  '28.94%',
  '27.85%',
  '26.84%',
  '25.90%',
  '49.43%',
  unavailable,
];
const rents = [
  '$0.00',
  '$0.00',
  '$0.00',
  '$0.00',
  '$2,400.00',
  '$2,400.00',
  '$2,400.00',
  '$2,400.00',
  '$2,400.00',
  '$7,200.00',
  '$0.00',
];
const expenses = [
  '$0.00',
  '$0.00',
  '$0.00',
  '$0.00',
  '$7,969.00',
  '$8,293.00',
  '$8,617.00',
  '$8,941.00',
  '$9,265.00',
  '$14,567.00',
  '$0.00',
];

function evidence(title: string, values: string[]): InsightEvidence {
  return {
    title,
    period: '2026-01-01 → 2026-11-03',
    source: 'posted',
    scope: 'Recorded entries through November 3. A percentage with a zero denominator is unavailable.',
    rows: values.map((value, index) => ({ label: monthLabels[index], value })),
    href: '/reports?from=2026-01-01&to=2026-11-03',
  };
}
function program(code = programCode) {
  return { code, codeHash: createHash('sha256').update(code).digest('hex'), operationCount: 11 };
}

test('generated monthly percentages precede source amounts and retain the request through year and category follow-ups', async ({
  page,
  baseURL,
}) => {
  const question = 'for a year how much % of total expenses am I spending monthly on rent';
  const clarification = 'Which year should I use, or do you mean the last twelve months?';
  const answer =
    'Calculated Rent share by month for this year through November 3. The source amounts are shown below.';
  const followUp = 'Same percentages and dates for office supplies.';
  const nextAnswer = 'I will use Office supplies with the same monthly total-expense denominator and dates.';
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
          : submissions.length === 2
            ? {
                answer,
                program: program(),
                evidence: [
                  evidence('Rent share by month', percentages),
                  evidence('Rent source amounts', rents),
                  evidence('Total expense source amounts', expenses),
                ],
              }
            : { answer: nextAnswer, evidence: [] },
    });
  });
  const { dialog, input, send } = await openAssistant(page, baseURL);
  await input.fill(question);
  await send.click();
  await expect(dialog.getByText(clarification, { exact: true })).toBeVisible();
  await expect(dialog.locator('.evidence-card')).toHaveCount(0);

  await input.fill('this year');
  await send.click();
  await expect(dialog.getByText(answer, { exact: true })).toBeVisible();
  const reply = dialog.locator('.chat-message.assistant').last();
  const cards = reply.locator('.evidence-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('h4')).toHaveText([
    'Rent share by month',
    'Rent source amounts',
    'Total expense source amounts',
  ]);
  await expect(cards.first().locator('.evidence-rows > div > span')).toHaveText(monthLabels);
  await expect(cards.first().locator('.evidence-rows > div > strong')).toHaveText(percentages);
  await expect(cards.first().getByText('0.00%', { exact: true })).toHaveCount(0);
  await expect(cards.nth(1).getByText('$7,200.00', { exact: true })).toBeVisible();
  await expect(cards.nth(2).getByText('$14,567.00', { exact: true })).toBeVisible();
  await expect(reply.locator('[data-analysis-program] pre')).not.toBeVisible();
  expect(submissions[1].messages).toEqual([
    { role: 'user', content: question },
    { role: 'assistant', content: clarification },
    { role: 'user', content: 'this year' },
  ]);

  await input.fill(followUp);
  await send.click();
  await expect(dialog.getByText(nextAnswer, { exact: true })).toBeVisible();
  expect(submissions[2].messages).toEqual([
    { role: 'user', content: question },
    { role: 'assistant', content: clarification },
    { role: 'user', content: 'this year' },
    { role: 'assistant', content: answer },
    { role: 'user', content: followUp },
  ]);
  // The client preserves original user instructions; generated code and input
  // evidence are not promoted to new user instructions in the next request.
  expect(JSON.stringify(submissions[2])).not.toContain(programCode);
  expect(entryWrites).toBe(0);
});

test('calculation inspection starts collapsed and renders generated code as inert text', async ({
  page,
  baseURL,
}) => {
  const inertMarkup = '<img src=x onerror="window.daybookProgramExecuted=true">';
  const scriptMarkup = '</code><script>window.daybookProgramExecuted=true</script>';
  const code = `// ${inertMarkup}\n// ${scriptMarkup}\n${programCode}`;
  await page.route('**/api/ai/chat', (route) =>
    route.fulfill({
      json: {
        answer: 'Calculated Rent share by month. Inspect the calculation for its source.',
        program: program(code),
        evidence: [evidence('Rent share by month', percentages)],
      },
    }),
  );
  const { dialog, input, send } = await openAssistant(page, baseURL);
  await input.fill('Show monthly rent as a percentage of total expenses this year.');
  await send.click();
  const disclosure = dialog.locator('[data-analysis-program]');
  await expect(disclosure.locator('summary')).toHaveText('Inspect the calculation');
  await expect(disclosure.locator('pre')).not.toBeVisible();
  await disclosure.locator('summary').click();
  await expect(disclosure.locator('pre')).toBeVisible();
  await expect(disclosure.locator('code')).toHaveText(code);
  await expect(disclosure.locator('img, script')).toHaveCount(0);
  expect(await page.evaluate(() => 'daybookProgramExecuted' in window)).toBe(false);
  await expect(dialog.locator('.evidence-card').first().getByText('30.12%', { exact: true })).toBeVisible();
  await disclosure.locator('summary').click();
  await expect(disclosure.locator('pre')).not.toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});
