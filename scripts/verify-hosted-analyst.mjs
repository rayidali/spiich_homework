/** Read-only verification of one already-completed real analyst conversation. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { z } from 'zod';
import {
  validateTarget,
  requestStats,
  encryptBrowserArtifact,
  decryptBrowserArtifact,
} from './verify-hosted-browser.mjs';

const VERSION = 'daybook-hosted-analyst-v1';
const OUTPUT = '.tools/hosted-analyst-encrypted';
const MAX_REQUESTS = 100;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const requireValue = (value, code) => {
  if (!value) throw Error(code);
};

export function validateAnalystTarget(input) {
  const base = validateTarget(input);
  requireValue(z.uuid().safeParse(input.conversationId).success, 'CONVERSATION_ID_REQUIRED');
  const provider = input.provider === undefined ? 'querio' : input.provider;
  requireValue(['querio', 'daybook'].includes(provider), 'ANALYST_PROVIDER_REQUIRED');
  // Keep legacy Querio authenticated metadata byte-for-byte compatible.
  return {
    ...base,
    suite: VERSION,
    conversationSha256: digest(input.conversationId),
    ...(provider === 'daybook' ? { provider } : {}),
  };
}

/** No refresh, message, cancellation or other provider-driving endpoint is permitted. */
export function analystRequestPolicy(rawUrl, method, origin, conversationId, provider = 'querio') {
  if (!['querio', 'daybook'].includes(provider)) return { allowed: false, reason: 'provider' };
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'url' };
  }
  if (url.origin !== origin || url.username || url.password) return { allowed: false, reason: 'origin' };
  if (!['GET', 'HEAD'].includes(method)) return { allowed: false, reason: 'method' };
  if (!z.uuid().safeParse(conversationId).success) return { allowed: false, reason: 'conversation' };
  if (url.hash) return { allowed: false, reason: 'fragment' };
  const query = [...url.searchParams];
  const page =
    url.pathname === '/analyst' &&
    (query.length === 0 ||
      (query.length === 1 && query[0][0] === 'tab' && ['querio', 'daybook'].includes(query[0][1])));
  const asset =
    !url.search &&
    (url.pathname === '/favicon.svg' ||
      /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|svg|png|jpg|webp|woff2?)$/.test(url.pathname));
  const api =
    !url.search &&
    [
      '/api/health',
      '/api/meta',
      '/api/accounts',
      '/api/ai/querio/status',
      '/api/ai/daybook/status',
      `/api/ai/${provider}/conversations/${conversationId}`,
    ].includes(url.pathname);
  return page || asset || api
    ? { allowed: true, kind: api ? 'api' : page ? 'page' : 'asset' }
    : { allowed: false, reason: 'path' };
}

export function completedConversation(value, conversationId, provider = 'querio') {
  requireValue(
    ['querio', 'daybook'].includes(provider) &&
      value?.id === conversationId &&
      value.provider === provider &&
      value.status === 'completed',
    'COMPLETED_CONVERSATION_REQUIRED',
  );
  requireValue(
    value.error === null &&
      Array.isArray(value.messages) &&
      value.messages.length <= 80 &&
      value.messages.every((m) => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string'),
    'INVALID_SAVED_CONVERSATION',
  );
  const answers = value.messages.filter((m) => m.role === 'assistant');
  requireValue(answers.length > 0 && answers.every((m) => m.content.trim()), 'SAVED_ANSWER_REQUIRED');
  requireValue(
    Array.isArray(value.notebook?.cells) &&
      value.notebook.cells.length <= 61 &&
      value.notebook.cells.every((cell) => Array.isArray(cell.outputs)),
    'SAVED_NOTEBOOK_REQUIRED',
  );
  const tables = value.notebook.cells
    .flatMap((c, cellIndex) => c.outputs.map((o, outputIndex) => ({ o, cellIndex, outputIndex })))
    .filter(
      ({ o }) =>
        o.type === 'table' &&
        Array.isArray(o.columns) &&
        o.columns.length &&
        Array.isArray(o.rows) &&
        o.rows.length,
    );
  const charts = value.notebook.cells
    .flatMap((c, cellIndex) => c.outputs.map((o, outputIndex) => ({ o, cellIndex, outputIndex })))
    .filter(
      ({ o }) =>
        o.type === 'chart' &&
        Array.isArray(o.chart?.labels) &&
        o.chart.labels.length &&
        Array.isArray(o.chart.series) &&
        o.chart.series.length,
    );
  requireValue(tables.length > 0 && charts.length > 0, 'SAVED_TABLE_AND_CHART_REQUIRED');
  return { answers, tables, charts, snapshotSha256: digest(JSON.stringify(value)) };
}

/** Live response forwarding only: no synthetic API data, credentials on same-origin reads only. */
export function guardedAnalystRequest(origin, conversationId, bypass, stats, observed, provider = 'querio') {
  return async (route) => {
    const request = route.request();
    const policy = analystRequestPolicy(request.url(), request.method(), origin, conversationId, provider);
    stats.attempted++;
    if (!policy.allowed || stats.attempted > MAX_REQUESTS) {
      stats.blocked++;
      if (policy.reason === 'method') stats.nonReadBlocked++;
      if (policy.reason === 'origin') stats.foreignOriginBlocked++;
      await route.abort('blockedbyclient');
      return;
    }
    stats.allowed++;
    try {
      const response = await route.fetch({
        headers: { ...request.headers(), 'x-vercel-protection-bypass': bypass },
        maxRedirects: 0,
        maxRetries: 0,
        timeout: 15000,
      });
      const status = response.status();
      if (status >= 300 && status < 400) {
        stats.redirectsBlocked++;
        await route.abort('blockedbyclient');
        return;
      }
      if (status >= 400) stats.httpErrors++;
      if (policy.kind === 'api' && status === 200 && request.method() === 'GET') {
        stats.apiResponses++;
        const path = new URL(request.url()).pathname;
        if (path === '/api/health') stats.healthVerified = (await response.json()).status === 'ok';
        if (path === '/api/meta') {
          const meta = await response.json();
          requireValue(z.uuid().safeParse(meta.organization?.id).success, 'ORGANIZATION_ID_REQUIRED');
          if (observed.organizationId)
            requireValue(observed.organizationId === meta.organization.id, 'WORKSPACE_CHANGED');
          observed.organizationId = meta.organization.id;
          observed.nativeEnabled = meta.ai?.analystAvailable === true;
          if (provider === 'daybook') requireValue(observed.nativeEnabled, 'NATIVE_ANALYST_NOT_ENABLED');
          stats.metaVerified = /^\d{4}-\d{2}-\d{2}$/.test(meta.today ?? '');
        }
        for (const candidate of ['querio', 'daybook'])
          if (path === `/api/ai/${candidate}/status`) {
            const state = await response.json();
            stats[`${candidate}Verified`] = state.available === true && state.provider === candidate;
            observed.availability ??= {};
            observed.availability[candidate] = {
              available: state.available === true,
              provider: state.provider,
              configuredModelLabel: typeof state.modelLabel === 'string' ? state.modelLabel : null,
              sourceLabel: typeof state.sourceLabel === 'string' ? state.sourceLabel : null,
            };
          }
        if (path === `/api/ai/${provider}/conversations/${conversationId}`) {
          const value = await response.json();
          const evidence = completedConversation(value, conversationId, provider);
          if (observed.evidence)
            requireValue(
              observed.evidence.snapshotSha256 === evidence.snapshotSha256,
              'SAVED_CONVERSATION_CHANGED',
            );
          observed.conversation = value;
          observed.evidence = evidence;
          stats.conversationReads++;
        }
      }
      await route.fulfill({ response });
    } catch {
      stats.failed++;
      await route.abort('failed').catch(() => {});
    }
  };
}

export async function runHostedAnalyst(env = process.env) {
  const conversationId = env.DAYBOOK_ANALYST_CONVERSATION_ID;
  const provider = env.DAYBOOK_ANALYST_PROVIDER ?? 'querio';
  const label = provider === 'daybook' ? 'Daybook' : 'Querio';
  const otherProvider = provider === 'daybook' ? 'querio' : 'daybook';
  const otherLabel = otherProvider === 'daybook' ? 'Daybook' : 'Querio';
  const binding = validateAnalystTarget({
    url: env.DAYBOOK_BROWSER_URL,
    sourceCommit: env.DAYBOOK_BROWSER_SOURCE_COMMIT,
    verifierCommit: env.DAYBOOK_BROWSER_VERIFIER_COMMIT,
    deploymentId: env.DAYBOOK_BROWSER_DEPLOYMENT_ID,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    conversationId,
    provider,
  });
  requireValue(
    env.GITHUB_ACTIONS === 'true' &&
      env.GITHUB_REPOSITORY === 'rayidali/spiich_homework' &&
      env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      env.GITHUB_SHA === binding.verifierCommit,
    'EXACT_MANUAL_WORKFLOW_REQUIRED',
  );
  requireValue(
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() === binding.verifierCommit,
    'VERIFIER_CHECKOUT_MISMATCH',
  );
  const bypass = env.DAYBOOK_BROWSER_BYPASS,
    key = env.DAYBOOK_BROWSER_ARTIFACT_KEY;
  requireValue(
    typeof bypass === 'string' && bypass.length >= 16 && bypass.length <= 4096 && !/[\r\n\0]/.test(bypass),
    'BYPASS_MISSING_OR_INVALID',
  );
  const probe = [{ path: 'check.json', data: Buffer.from('{}').toString('base64'), sha256: digest('{}') }];
  requireValue(
    JSON.stringify(decryptBrowserArtifact(encryptBrowserArtifact(probe, key, binding), key, binding)) ===
      JSON.stringify(probe),
    'ENCRYPTION_PREFLIGHT_FAILED',
  );
  mkdirSync('.tools', { recursive: true, mode: 0o700 });
  mkdirSync(OUTPUT, { mode: 0o700 }); // Refuse replay/overwrite.
  const { chromium, expect } = await import('@playwright/test');
  const stats = { ...requestStats(), querioVerified: false, daybookVerified: false, conversationReads: 0 };
  const observed = {},
    files = [],
    checks = [];
  let browser,
    failure = null,
    timer;
  const startedAt = new Date().toISOString();
  const capture = async (page, name) => {
    const visible = await page.locator('body').innerText();
    const inputs = await page
      .locator('input,textarea')
      .evaluateAll((elements) => elements.map((e) => e.value).join('\n'));
    requireValue(
      ![visible, inputs].some(
        (text) => text.includes(bypass) || text.includes(key) || /postgres(?:ql)?:\/\//i.test(text),
      ),
      'VISIBLE_SECRET_REFUSED',
    );
    const data = await page.screenshot({ fullPage: true, animations: 'disabled', timeout: 15000 });
    requireValue(data.length <= 4 * 1024 * 1024, 'SCREENSHOT_TOO_LARGE');
    files.push({ path: `${name}.png`, data: data.toString('base64'), sha256: digest(data) });
  };
  try {
    browser = await chromium.launch({ headless: true, timeout: 20000 });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      serviceWorkers: 'block',
      acceptDownloads: false,
      reducedMotion: 'reduce',
    });
    context.setDefaultTimeout(15000);
    await context.route(
      '**/*',
      guardedAnalystRequest(binding.origin, conversationId, bypass, stats, observed, provider),
    );
    await context.routeWebSocket('**/*', async (socket) => {
      stats.webSocketsBlocked++;
      await socket.close();
    });
    const page = await context.newPage();
    page.on('requestfailed', () => stats.browserRequestFailures++);
    page.on('pageerror', () => stats.pageErrors++);
    page.on('console', (message) => {
      if (message.type() === 'error') stats.consoleErrors++;
    });
    const work = async () => {
      // Inspect the real saved snapshot before mounting an application that can poll active runs.
      for (const path of ['/api/health', '/api/meta', `/api/ai/${provider}/conversations/${conversationId}`])
        await page.goto(`${binding.origin}${path}`, { waitUntil: 'domcontentloaded' });
      requireValue(stats.healthVerified && stats.metaVerified && observed.evidence, 'LIVE_PREFLIGHT_FAILED');
      await context.addInitScript(
        ({ origin, key, id }) => {
          if (location.origin === origin) sessionStorage.setItem(key, id);
        },
        {
          origin: binding.origin,
          key: `daybook.${provider}.conversation.v1.${observed.organizationId}`,
          id: conversationId,
        },
      );
      const assertLayout = async (name) => {
        await expect(page.getByRole('heading', { name: 'Ask your books', exact: true })).toBeVisible();
        await expect(page.locator('main .error-state')).toHaveCount(0);
        requireValue(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          'HORIZONTAL_OVERFLOW',
        );
        await capture(page, name);
        checks.push({ name, passed: true });
      };
      const checkAnswer = async () => {
        const answers = page.locator(`article[aria-label="${label} answer"]`);
        await expect(answers).toHaveCount(observed.evidence.answers.length);
        const latest = observed.evidence.answers.at(-1).content;
        const html = renderToStaticMarkup(
          createElement(
            ReactMarkdown,
            {
              remarkPlugins: [remarkGfm],
              skipHtml: true,
              components: {
                img: ({ alt }) => createElement('span', null, alt ? `[Image: ${alt}]` : '[Image]'),
              },
            },
            latest,
          ),
        );
        const expected = await page.evaluate(
          (markup) => new DOMParser().parseFromString(markup, 'text/html').body.textContent,
          html,
        );
        await expect(answers.last().locator('.chat-message-content')).toHaveText(expected);
        await expect(answers.last()).toBeVisible();
      };
      const checkNotebook = async () => {
        const notebook = page.getByRole('complementary', { name: `${label} notebook`, exact: true });
        await expect(notebook).toBeVisible();
        await expect(notebook.locator('.analyst-notebook-cell')).toHaveCount(
          observed.conversation.notebook.cells.length,
        );
        const firstTable = observed.evidence.tables[0];
        const cell = notebook.locator('.analyst-notebook-cell').nth(firstTable.cellIndex);
        // Compare one complete saved table, including exact decimal strings, to rendered cells.
        const tablesBefore = observed.conversation.notebook.cells[firstTable.cellIndex].outputs
          .slice(0, firstTable.outputIndex)
          .filter((o) => o.type === 'table' || o.type === 'chart').length;
        const table = cell.locator('table').nth(tablesBefore);
        await expect(table.locator('thead th')).toHaveText(firstTable.o.columns);
        await expect(table.locator('tbody td')).toHaveText(
          firstTable.o.rows.flatMap((row) => firstTable.o.columns.map((_, i) => row[i] ?? '—')),
        );
        await expect(notebook.locator('svg.analyst-chart').first()).toBeVisible();
        const source = notebook.locator('details.analyst-cell-source').first();
        await expect(source).toBeVisible();
        await source.locator('summary').click();
        await expect(source.locator('code')).toBeVisible();
        await source.locator('summary').click();
        await notebook.locator('svg.analyst-chart').first().scrollIntoViewIfNeeded();
      };
      await page.goto(`${binding.origin}/analyst?tab=${provider}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await checkAnswer();
      await checkNotebook();
      await assertLayout(`desktop-${provider}`);
      await page.getByRole('tab', { name: label, exact: true }).focus();
      await page.keyboard.press(provider === 'querio' ? 'Home' : 'End');
      await expect(page.getByRole('tab', { name: otherLabel, exact: true })).toBeFocused();
      const otherPrompt =
        otherProvider === 'daybook' && !observed.nativeEnabled
          ? 'Ask a financial question'
          : `Ask ${otherLabel} a financial question`;
      await expect(page.getByLabel(otherPrompt, { exact: true })).toBeVisible();
      if (otherProvider === 'querio' || observed.nativeEnabled)
        await expect.poll(() => stats[`${otherProvider}Verified`]).toBe(true);
      await assertLayout(`desktop-${otherProvider}-tab`);
      await page.keyboard.press(provider === 'querio' ? 'End' : 'Home');
      await expect(page.getByRole('tab', { name: label, exact: true })).toBeFocused();
      await checkAnswer();
      await page.reload({ waitUntil: 'networkidle' });
      await checkAnswer();
      checks.push({ name: 'completed-conversation-reloads-without-generation', passed: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await checkAnswer();
      await assertLayout(provider === 'querio' ? 'mobile-conversation' : 'mobile-daybook-conversation');
      await page.getByRole('button', { name: 'Notebook', exact: true }).click();
      await checkNotebook();
      await assertLayout(provider === 'querio' ? 'mobile-notebook' : 'mobile-daybook-notebook');
      await page.getByRole('button', { name: 'Conversation', exact: true }).click();
      await checkAnswer();
      requireValue(
        stats[`${provider}Verified`] && stats.conversationReads >= 3,
        'SAVED_ANALYST_READS_INCOMPLETE',
      );
      requireValue(
        ![
          'blocked',
          'failed',
          'httpErrors',
          'redirectsBlocked',
          'webSocketsBlocked',
          'pageErrors',
          'consoleErrors',
          'browserRequestFailures',
        ].some((name) => stats[name]),
        'BROWSER_ERRORS_OBSERVED',
      );
    };
    await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('BROWSER_DEADLINE')), 180000);
      }),
    ]);
  } catch (error) {
    failure = /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.message ?? '') ? error.message : 'BROWSER_CHECK_FAILED';
  } finally {
    clearTimeout(timer);
    if (browser)
      await browser.close().catch(() => {
        failure ??= 'BROWSER_CLOSE_FAILED';
      });
  }
  const report = {
    version: VERSION,
    ...binding,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: failure ? 'FAILED' : 'PASSED',
    failure,
    checks,
    stats,
    snapshotSha256: observed.evidence?.snapshotSha256 ?? null,
    selectedProvider: provider,
    selectedAvailability: observed.availability?.[provider] ?? null,
    nativeFeatureEnabled: observed.nativeEnabled === true,
    screenshots: files.map(({ path, sha256 }) => ({ path, sha256 })),
    providerCalls: 0,
    applicationMutationsDispatched: 0,
    sourceVerification:
      'Expected source/deployment supplied by operator control-plane audit; GET responses do not independently prove deployed source.',
    limitations: [
      'This checks rendering of a saved real answer, not model or financial accuracy.',
      'Mobile viewport emulation is not a physical-device test.',
      'Screenshots need separate visual review; no plain screenshots, HAR, trace, browser state or response bodies were saved.',
    ],
  };
  const reportBytes = Buffer.from(JSON.stringify(report));
  files.push({ path: 'report.json', data: reportBytes.toString('base64'), sha256: digest(reportBytes) });
  const envelope = Buffer.from(JSON.stringify(encryptBrowserArtifact(files, key, binding)) + '\n');
  writeFileSync(`${OUTPUT}/artifact.json`, envelope, { flag: 'wx', mode: 0o600 });
  const receipt = {
    version: VERSION,
    ...binding,
    status: report.status,
    failure,
    checksPassed: checks.length,
    selectedProvider: provider,
    selectedAvailability: observed.availability?.[provider] ?? null,
    screenshotCount: files.length - 1,
    encrypted: true,
    algorithm: 'AES-256-GCM',
    archiveSha256: digest(envelope),
    providerCalls: 0,
    applicationMutationsDispatched: 0,
    sourceVerification: report.sourceVerification,
  };
  writeFileSync(`${OUTPUT}/receipt.json`, JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(JSON.stringify(receipt));
  if (failure) process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runHostedAnalyst().catch(() => {
    console.error(JSON.stringify({ status: 'REFUSED', error: 'HOSTED_ANALYST_SETUP_OR_ARCHIVE_FAILED' }));
    process.exitCode = 1;
  });
}
