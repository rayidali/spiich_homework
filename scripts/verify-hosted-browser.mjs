/** Opt-in, read-only hosted visual check. Never run the mutating local browser suite here. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const VERSION = 'daybook-hosted-browser-v1';
const OUTPUT = '.tools/hosted-browser-encrypted';
const MAX_REQUESTS = 160;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const sha = (data) => createHash('sha256').update(data).digest('hex');
const fail = (code) => {
  throw new Error(code);
};
const requireValue = (value, code) => {
  if (!value) fail(code);
};

export function validateTarget({ url, sourceCommit, verifierCommit, deploymentId, runId, runAttempt }) {
  requireValue(
    /^[a-f0-9]{40}$/.test(sourceCommit ?? '') && /^[a-f0-9]{40}$/.test(verifierCommit ?? ''),
    'EXACT_COMMITS_REQUIRED',
  );
  requireValue(/^dpl_[A-Za-z0-9]{16,64}$/.test(deploymentId ?? ''), 'DEPLOYMENT_ID_REQUIRED');
  requireValue(
    /^[1-9]\d*$/.test(runId ?? '') && /^[1-9]\d*$/.test(runAttempt ?? ''),
    'WORKFLOW_IDENTITY_REQUIRED',
  );
  let target;
  try {
    target = new URL(url);
  } catch {
    fail('INVALID_DEPLOYMENT_URL');
  }
  requireValue(
    target.protocol === 'https:' &&
      !target.username &&
      !target.password &&
      !target.port &&
      /^daybook-ledger-[a-z0-9]+-rayidalis-projects\.vercel\.app$/.test(target.hostname) &&
      target.pathname === '/' &&
      !target.search &&
      !target.hash &&
      (url === target.origin || url === `${target.origin}/`),
    'INVALID_DEPLOYMENT_URL',
  );
  return { sourceCommit, verifierCommit, deploymentId, origin: target.origin, runId, runAttempt };
}

/** Explicit read endpoint allowlist also excludes state-changing GET cron routes. */
export function requestPolicy(rawUrl, method, origin) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'url' };
  }
  if (url.origin !== origin || url.username || url.password) return { allowed: false, reason: 'origin' };
  if (!['GET', 'HEAD'].includes(method)) return { allowed: false, reason: 'method' };
  const page = ['/', '/transactions', '/reports', '/settings', '/favicon.svg'].includes(url.pathname);
  const asset = /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|svg|png|jpg|webp|woff2?)$/.test(url.pathname);
  const api = [
    '/api/health',
    '/api/meta',
    '/api/dashboard',
    '/api/accounts',
    '/api/entries',
    '/api/reports/income',
    '/api/reports/trial',
    '/api/reports/balance',
  ].includes(url.pathname);
  return page || asset || api
    ? { allowed: true, kind: api ? 'api' : page ? 'page' : 'asset' }
    : { allowed: false, reason: 'path' };
}

export function requestStats() {
  return {
    attempted: 0,
    allowed: 0,
    blocked: 0,
    failed: 0,
    httpErrors: 0,
    redirectsBlocked: 0,
    nonReadBlocked: 0,
    foreignOriginBlocked: 0,
    webSocketsBlocked: 0,
    pageErrors: 0,
    consoleErrors: 0,
    browserRequestFailures: 0,
    apiResponses: 0,
    healthVerified: false,
    metaVerified: false,
  };
}

/** Attach the bypass only after origin/method/path validation. Never follow a redirect with it. */
export function guardedRequest(origin, bypass, stats) {
  return async (route) => {
    const request = route.request();
    const policy = requestPolicy(request.url(), request.method(), origin);
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
      // route.continue(extraHeaders) can forward headers through redirects. Fetch
      // with zero redirects, then fulfill, keeps the credential on this origin only.
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
      if (policy.kind === 'api' && status === 200) {
        stats.apiResponses++;
        const path = new URL(request.url()).pathname;
        if (path === '/api/health') stats.healthVerified = (await response.json()).status === 'ok';
        if (path === '/api/meta') {
          const meta = await response.json();
          stats.metaVerified =
            typeof meta.organization?.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meta.today ?? '');
        }
      }
      await route.fulfill({ response });
    } catch {
      stats.failed++;
      await route.abort('failed').catch(() => {});
    }
  };
}

function keyBytes(key) {
  requireValue(typeof key === 'string' && /^[a-f0-9]{64}$/.test(key), 'ARTIFACT_KEY_INVALID');
  return Buffer.from(key, 'hex');
}
export function encryptBrowserArtifact(files, key, binding) {
  const plain = Buffer.from(JSON.stringify(files));
  requireValue(plain.length <= MAX_ARTIFACT_BYTES, 'ARTIFACT_TOO_LARGE');
  const metadata = { version: VERSION, ...binding };
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  const ciphertext = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  return {
    metadata,
    algorithm: 'AES-256-GCM',
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('base64'),
  };
}
export function decryptBrowserArtifact(envelope, key, binding) {
  const metadata = { version: VERSION, ...binding };
  requireValue(
    JSON.stringify(envelope.metadata) === JSON.stringify(metadata) &&
      envelope.algorithm === 'AES-256-GCM' &&
      /^[a-f0-9]{24}$/.test(envelope.iv) &&
      /^[a-f0-9]{32}$/.test(envelope.tag) &&
      typeof envelope.ciphertext === 'string' &&
      envelope.ciphertext.length <= MAX_ARTIFACT_BYTES * 2,
    'ARTIFACT_BINDING_INVALID',
  );
  const cipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(envelope.iv, 'hex'));
  cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  cipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
  const compressed = Buffer.concat([
    cipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    cipher.final(),
  ]);
  const files = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_ARTIFACT_BYTES }).toString('utf8'));
  requireValue(
    Array.isArray(files) &&
      files.length <= 12 &&
      new Set(files.map((f) => f.path)).size === files.length &&
      files.every(
        (f) =>
          /^[a-z0-9-]+\.(png|json)$/.test(f.path) &&
          typeof f.data === 'string' &&
          sha(Buffer.from(f.data, 'base64')) === f.sha256,
      ),
    'ARTIFACT_CONTENT_INVALID',
  );
  return files;
}

export async function runHostedBrowser(env = process.env) {
  const binding = validateTarget({
    url: env.DAYBOOK_BROWSER_URL,
    sourceCommit: env.DAYBOOK_BROWSER_SOURCE_COMMIT,
    verifierCommit: env.DAYBOOK_BROWSER_VERIFIER_COMMIT,
    deploymentId: env.DAYBOOK_BROWSER_DEPLOYMENT_ID,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
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
  const bypass = env.DAYBOOK_BROWSER_BYPASS;
  requireValue(
    typeof bypass === 'string' && bypass.length >= 16 && bypass.length <= 4096 && !/[\r\n\0]/.test(bypass),
    'BYPASS_MISSING_OR_INVALID',
  );
  const key = env.DAYBOOK_BROWSER_ARTIFACT_KEY;
  keyBytes(key);
  // Encryption is exercised before any network access. Plain PNGs never touch disk.
  const probe = [{ path: 'check.json', data: Buffer.from('{}').toString('base64'), sha256: sha('{}') }];
  requireValue(
    JSON.stringify(decryptBrowserArtifact(encryptBrowserArtifact(probe, key, binding), key, binding)) ===
      JSON.stringify(probe),
    'ENCRYPTION_PREFLIGHT_FAILED',
  );
  mkdirSync('.tools', { recursive: true, mode: 0o700 });
  mkdirSync(OUTPUT, { mode: 0o700 }); // Exclusive directory; no replay/overwrite.
  const { chromium, expect } = await import('@playwright/test');
  const stats = requestStats(),
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
    files.push({ path: `${name}.png`, data: data.toString('base64'), sha256: sha(data) });
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
    await context.route('**/*', guardedRequest(binding.origin, bypass, stats));
    await context.routeWebSocket('**/*', async (socket) => {
      stats.webSocketsBlocked++;
      await socket.close();
    });
    const page = await context.newPage();
    page.on('requestfailed', () => {
      stats.browserRequestFailures++;
    });
    page.on('pageerror', () => {
      stats.pageErrors++;
    });
    page.on('console', (message) => {
      if (message.type() === 'error') stats.consoleErrors++;
    });
    const work = async () => {
      await page.goto(`${binding.origin}/api/health`, { waitUntil: 'domcontentloaded' });
      requireValue(stats.healthVerified, 'HEALTH_CHECK_FAILED');
      await page.goto(binding.origin, { waitUntil: 'networkidle' });
      await expect(page).toHaveTitle('Daybook · Accounting workspace');
      const inspect = async (name, heading) => {
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        await expect(page.locator('main .loading-state')).toHaveCount(0);
        await expect(page.locator('main .error-state')).toHaveCount(0);
        requireValue(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          'HORIZONTAL_OVERFLOW',
        );
        await capture(page, name);
        checks.push({ name, passed: true });
      };
      await expect(page.locator('.metric-value').first()).toBeVisible();
      await inspect('desktop-home', 'Home');
      for (const [label, heading] of [
        ['Transactions', 'Transactions'],
        ['Reports', 'Financial reports'],
        ['Settings', 'Settings'],
      ]) {
        await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click();
        await page.waitForLoadState('networkidle');
        await inspect(`desktop-${label.toLowerCase()}`, heading);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(binding.origin, { waitUntil: 'networkidle' });
      await expect(page.locator('.metric-value').first()).toBeVisible();
      await inspect('mobile-home', 'Home');
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('navigation').getByRole('link', { name: 'Reports', exact: true }).click();
      await page.waitForLoadState('networkidle');
      await inspect('mobile-reports', 'Financial reports');
      requireValue(stats.metaVerified && stats.apiResponses >= 4, 'APP_DATA_READS_INCOMPLETE');
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
        ].some((k) => stats[k]),
        'BROWSER_ERRORS_OBSERVED',
      );
    };
    await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('BROWSER_DEADLINE')), 180000);
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
    screenshots: files.map(({ path, sha256 }) => ({ path, sha256 })),
    providerCalls: 0,
    applicationMutationsDispatched: 0,
    sourceVerification:
      'Expected source/deployment supplied by operator control-plane audit; GET responses do not independently prove the deployed source.',
    limitations: [
      'Read-only rendered application checks, not financial/model accuracy or unchanged-ledger verification.',
      'Mobile viewport emulation is not a physical-device test.',
      'Screenshots require separate visual review and remain encrypted; no HAR, trace, video, storage state or raw console text was captured.',
    ],
  };
  const reportBytes = Buffer.from(JSON.stringify(report));
  files.push({ path: 'report.json', data: reportBytes.toString('base64'), sha256: sha(reportBytes) });
  const envelope = Buffer.from(JSON.stringify(encryptBrowserArtifact(files, key, binding)) + '\n');
  writeFileSync(`${OUTPUT}/artifact.json`, envelope, { flag: 'wx', mode: 0o600 });
  const receipt = {
    version: VERSION,
    ...binding,
    status: report.status,
    failure,
    checksPassed: checks.length,
    screenshotCount: files.length - 1,
    encrypted: true,
    algorithm: 'AES-256-GCM',
    archiveSha256: sha(envelope),
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
  runHostedBrowser().catch(() => {
    console.error(JSON.stringify({ status: 'REFUSED', error: 'HOSTED_BROWSER_SETUP_OR_ARCHIVE_FAILED' }));
    process.exitCode = 1;
  });
}
