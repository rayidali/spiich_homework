import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  validateTarget,
  requestPolicy,
  requestStats,
  guardedRequest,
  encryptBrowserArtifact,
  decryptBrowserArtifact,
} from '../scripts/verify-hosted-browser.mjs';

const input = {
  url: 'https://daybook-ledger-synthetic-rayidalis-projects.vercel.app',
  sourceCommit: 'a'.repeat(40),
  verifierCommit: 'b'.repeat(40),
  deploymentId: 'dpl_SyntheticNotReal123456',
  runId: '123',
  runAttempt: '1',
};
const binding = validateTarget(input),
  key = 'd'.repeat(64),
  bypass = 'synthetic-bypass-never-valid';
const digest = (b) => createHash('sha256').update(b).digest('hex');
function fakeRoute({
  url = `${binding.origin}/api/meta`,
  method = 'GET',
  status = 200,
  throws = false,
} = {}) {
  const observed = { fetched: 0, aborted: [], fulfilled: 0, options: null };
  return {
    observed,
    request: () => ({
      url: () => url,
      method: () => method,
      headers: () => ({ accept: 'application/json' }),
    }),
    abort: async (code) => {
      observed.aborted.push(code);
    },
    fetch: async (options) => {
      observed.fetched++;
      observed.options = options;
      if (throws) throw Error('private response detail must not be stored');
      return {
        status: () => status,
        json: async () => ({ organization: { id: 'synthetic' }, today: '2026-11-01', status: 'ok' }),
      };
    },
    fulfill: async () => {
      observed.fulfilled++;
    },
  };
}

test('exact immutable deployment and separate verifier/source commits are retained', () => {
  assert.equal(binding.origin, input.url);
  assert.equal(binding.sourceCommit, input.sourceCommit);
  assert.notEqual(binding.sourceCommit, binding.verifierCommit);
});

test('aliases, external URLs, credentials, paths, ports and query tokens refuse', () => {
  for (const url of [
    'https://daybook-ledger-delta.vercel.app',
    'https://evil.example',
    'http://daybook-ledger-synthetic-rayidalis-projects.vercel.app',
    `${input.url}:8443`,
    `https://user:pass@${new URL(input.url).host}`,
    `${input.url}/reports`,
    `${input.url}?token=private`,
    `${input.url}#private`,
    `https://daybook-ledger-synthetic-rayidalis-projects.vercel.app.evil.test`,
  ])
    assert.throws(() => validateTarget({ ...input, url }), /INVALID_DEPLOYMENT_URL/);
});

test('branches, missing workflow identity and arbitrary deployment identifiers refuse', () => {
  for (const changes of [
    { sourceCommit: 'main' },
    { verifierCommit: 'head' },
    { runId: '0' },
    { runAttempt: '' },
    { deploymentId: 'other-project' },
  ])
    assert.throws(() => validateTarget({ ...input, ...changes }));
});

test('only named read APIs, pages and static assets are allowed', () => {
  for (const path of [
    '/',
    '/transactions',
    '/reports',
    '/settings',
    '/api/health',
    '/api/meta',
    '/api/dashboard?from=2026-11-01',
    '/api/accounts',
    '/api/entries?limit=6',
    '/api/reports/income',
    '/api/reports/trial',
    '/api/reports/balance',
    '/assets/index-abc.js',
  ])
    assert.equal(requestPolicy(`${binding.origin}${path}`, 'GET', binding.origin).allowed, true);
  assert.equal(requestPolicy(`${binding.origin}/api/health`, 'HEAD', binding.origin).allowed, true);
});

test('all mutation verbs and read-looking cron/model/action paths refuse', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT'])
    assert.equal(requestPolicy(`${binding.origin}/api/entries`, method, binding.origin).allowed, false);
  for (const path of [
    '/api/cron',
    '/api/ai/chat',
    '/api/ai/entry',
    '/api/ai/category',
    '/api/entries/example/post',
    '/api/alerts',
    '/api/unknown',
    '/assets/%2e%2e/api/cron',
  ])
    assert.equal(requestPolicy(`${binding.origin}${path}`, 'GET', binding.origin).allowed, false);
});

test('cross-origin/subdomain and non-HTTP browser requests never receive credentials', async () => {
  for (const url of [
    'https://example.com/api/meta',
    'https://other.vercel.app/api/meta',
    'data:text/html,private',
    'file:///etc/passwd',
    'ws://localhost/socket',
  ]) {
    const stats = requestStats(),
      route = fakeRoute({ url });
    await guardedRequest(binding.origin, bypass, stats)(route);
    assert.equal(route.observed.fetched, 0);
    assert.equal(route.observed.options, null);
    assert.equal(stats.blocked, 1);
  }
});

test('allowed fetch adds bypass only at validated origin with no redirects or retries', async () => {
  const stats = requestStats(),
    route = fakeRoute();
  await guardedRequest(binding.origin, bypass, stats)(route);
  assert.equal(route.observed.options.headers['x-vercel-protection-bypass'], bypass);
  assert.equal(route.observed.options.maxRedirects, 0);
  assert.equal(route.observed.options.maxRetries, 0);
  assert.equal(route.observed.options.timeout, 15000);
  assert.equal(route.observed.fulfilled, 1);
  assert.equal(stats.metaVerified, true);
});

test('redirect responses are never fulfilled or followed', async () => {
  for (const status of [301, 302, 307, 308]) {
    const stats = requestStats(),
      route = fakeRoute({ status });
    await guardedRequest(binding.origin, bypass, stats)(route);
    assert.equal(route.observed.fetched, 1);
    assert.equal(route.observed.fulfilled, 0);
    assert.equal(stats.redirectsBlocked, 1);
    assert.deepEqual(route.observed.aborted, ['blockedbyclient']);
  }
});

test('request-count ceiling blocks before fetching the next request', async () => {
  const stats = { ...requestStats(), attempted: 160 },
    route = fakeRoute();
  await guardedRequest(binding.origin, bypass, stats)(route);
  assert.equal(route.observed.fetched, 0);
  assert.equal(stats.blocked, 1);
});

test('transport failures retain counts without raw bodies, headers or errors', async () => {
  const stats = requestStats(),
    route = fakeRoute({ throws: true });
  await guardedRequest(binding.origin, bypass, stats)(route);
  assert.equal(stats.failed, 1);
  assert.equal(JSON.stringify(stats).includes('private'), false);
  assert.equal(JSON.stringify(stats).includes(bypass), false);
});

test('encrypted screenshot roundtrip requires exact source/deployment/run binding', () => {
  const bytes = Buffer.from('synthetic PNG contents, no real data');
  const files = [{ path: 'desktop-home.png', data: bytes.toString('base64'), sha256: digest(bytes) }];
  const envelope = encryptBrowserArtifact(files, key, binding);
  assert.deepEqual(decryptBrowserArtifact(envelope, key, binding), files);
  assert.equal(JSON.stringify(envelope).includes('synthetic PNG contents'), false);
  assert.throws(() => decryptBrowserArtifact(envelope, key, { ...binding, sourceCommit: 'c'.repeat(40) }));
  assert.throws(() => decryptBrowserArtifact(envelope, 'e'.repeat(64), binding));
  const mutated = structuredClone(envelope);
  mutated.tag = '0'.repeat(32);
  assert.throws(() => decryptBrowserArtifact(mutated, key, binding));
});

test('encryption rejects missing keys and decryption rejects unsafe archive paths', () => {
  assert.throws(() => encryptBrowserArtifact([], '', binding), /ARTIFACT_KEY_INVALID/);
  const bytes = Buffer.from('{}');
  const envelope = encryptBrowserArtifact(
    [{ path: '../secret.json', data: bytes.toString('base64'), sha256: digest(bytes) }],
    key,
    binding,
  );
  assert.throws(() => decryptBrowserArtifact(envelope, key, binding), /ARTIFACT_CONTENT_INVALID/);
});
