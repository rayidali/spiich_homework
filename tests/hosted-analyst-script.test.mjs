import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAnalystTarget,
  analystRequestPolicy,
  completedConversation,
  guardedAnalystRequest,
} from '../scripts/verify-hosted-analyst.mjs';
import {
  requestStats,
  encryptBrowserArtifact,
  decryptBrowserArtifact,
} from '../scripts/verify-hosted-browser.mjs';

const conversationId = '0e3dbfd8-4781-4b61-bd86-02d99481279e';
const otherId = '7ba284f0-5167-43b1-979c-04e7a742f4d5';
const organizationId = 'fdc7fffc-068f-47e7-bef9-fcb033c81045';
const input = {
  url: 'https://daybook-ledger-synthetic-rayidalis-projects.vercel.app',
  sourceCommit: 'a'.repeat(40),
  verifierCommit: 'b'.repeat(40),
  deploymentId: 'dpl_SyntheticNotReal123456',
  runId: '123',
  runAttempt: '1',
  conversationId,
};
const binding = validateAnalystTarget(input);
const bypass = 'synthetic-bypass-not-a-credential';
function saved() {
  return {
    id: conversationId,
    provider: 'querio',
    status: 'completed',
    error: null,
    messages: [
      { role: 'user', content: 'Expenses?' },
      { role: 'assistant', content: '**Expenses were $12.34.**' },
    ],
    notebook: {
      cells: [
        {
          code: 'SELECT 12.34::numeric;',
          outputs: [
            { type: 'table', columns: ['Expenses'], rows: [['12.34']] },
            {
              type: 'chart',
              chart: { labels: ['January'], series: [{ name: 'Expenses', values: ['12.34'] }] },
            },
          ],
        },
      ],
    },
  };
}
function fakeRoute({
  path = `/api/ai/querio/conversations/${conversationId}`,
  method = 'GET',
  status = 200,
  body = saved(),
  error = false,
  origin = binding.origin,
} = {}) {
  const observed = { fetched: 0, aborted: [], fulfilled: 0, options: null };
  return {
    observed,
    request: () => ({
      url: () => `${origin}${path}`,
      method: () => method,
      headers: () => ({ accept: 'application/json' }),
    }),
    abort: async (code) => {
      observed.aborted.push(code);
    },
    fetch: async (options) => {
      observed.fetched++;
      observed.options = options;
      if (error) throw Error('private provider response and credential');
      return { status: () => status, json: async () => body };
    },
    fulfill: async () => {
      observed.fulfilled++;
    },
  };
}
const stats = () => ({ ...requestStats(), conversationReads: 0, querioVerified: false });

test('exact deployment binding includes a hash of the explicit conversation without exposing its ID', () => {
  assert.equal(binding.sourceCommit, input.sourceCommit);
  assert.notEqual(binding.sourceCommit, binding.verifierCommit);
  assert.match(binding.conversationSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(binding).includes(conversationId), false);
  for (const id of [
    undefined,
    '',
    '11111111-1111-1111-1111-111111111111',
    '../other',
    `${conversationId}?token=x`,
  ])
    assert.throws(() => validateAnalystTarget({ ...input, conversationId: id }), /CONVERSATION_ID_REQUIRED/);
  assert.throws(
    () => validateAnalystTarget({ ...input, url: 'https://daybook-ledger-delta.vercel.app' }),
    /INVALID_DEPLOYMENT_URL/,
  );
});

test('only the analyst page, required read-only bootstrap APIs and exact saved conversation are allowed', () => {
  for (const path of [
    '/analyst',
    '/analyst?tab=daybook',
    '/analyst?tab=querio',
    '/api/health',
    '/api/meta',
    '/api/accounts',
    '/api/ai/querio/status',
    `/api/ai/querio/conversations/${conversationId}`,
    '/assets/QuerioAssistant-hash.js',
    '/favicon.svg',
  ])
    assert.equal(
      analystRequestPolicy(`${binding.origin}${path}`, 'GET', binding.origin, conversationId).allowed,
      true,
      path,
    );
  assert.equal(
    analystRequestPolicy(`${binding.origin}/api/health`, 'HEAD', binding.origin, conversationId).allowed,
    true,
  );
});

test('provider-driving requests, other conversations, extra queries and unrelated ledger reads are refused', () => {
  for (const path of [
    '/',
    '/transactions',
    '/api/dashboard',
    '/api/entries',
    '/api/cron',
    '/api/ai/chat',
    '/api/ai/querio/conversations',
    `/api/ai/querio/conversations/${otherId}`,
    `/api/ai/querio/conversations/${conversationId}/refresh`,
    `/api/ai/querio/conversations/${conversationId}/messages`,
    `/api/ai/querio/conversations/${conversationId}?refresh=true`,
    '/analyst?tab=querio&token=private',
    '/analyst?tab=other',
    '/assets/test.js?token=private',
  ])
    assert.equal(
      analystRequestPolicy(`${binding.origin}${path}`, 'GET', binding.origin, conversationId).allowed,
      false,
      path,
    );
  for (const method of ['POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS', 'CONNECT'])
    assert.equal(
      analystRequestPolicy(
        `${binding.origin}/api/ai/querio/conversations/${conversationId}`,
        method,
        binding.origin,
        conversationId,
      ).allowed,
      false,
      method,
    );
});

test('completed evidence requires actual saved answer, table and chart; active runs cannot mount', () => {
  assert.equal(completedConversation(saved(), conversationId).answers.length, 1);
  for (const status of ['running', 'starting', 'idle', 'closed', 'failed'])
    assert.throws(
      () => completedConversation({ ...saved(), status }, conversationId),
      /COMPLETED_CONVERSATION_REQUIRED/,
    );
  assert.throws(() => completedConversation(saved(), otherId), /COMPLETED_CONVERSATION_REQUIRED/);
  assert.throws(
    () => completedConversation({ ...saved(), messages: [] }, conversationId),
    /SAVED_ANSWER_REQUIRED/,
  );
  for (const outputs of [[saved().notebook.cells[0].outputs[0]], [saved().notebook.cells[0].outputs[1]], []])
    assert.throws(
      () => completedConversation({ ...saved(), notebook: { cells: [{ outputs }] } }, conversationId),
      /SAVED_TABLE_AND_CHART_REQUIRED/,
    );
});

test('foreign origins and all mutation verbs are blocked before any credential-bearing fetch', async () => {
  for (const settings of [
    { origin: 'https://app.querio.ai' },
    { origin: 'https://evil.example' },
    { method: 'POST' },
    { method: 'DELETE' },
  ]) {
    const route = fakeRoute(settings),
      counts = stats();
    await guardedAnalystRequest(binding.origin, conversationId, bypass, counts, {})(route);
    assert.equal(route.observed.fetched, 0);
    assert.equal(route.observed.options, null);
    assert.equal(counts.blocked, 1);
  }
});

test('real response is forwarded with redirect/retry disabled and its exact evidence retained in memory', async () => {
  const route = fakeRoute(),
    counts = stats(),
    observed = {};
  await guardedAnalystRequest(binding.origin, conversationId, bypass, counts, observed)(route);
  assert.equal(route.observed.options.headers['x-vercel-protection-bypass'], bypass);
  assert.equal(route.observed.options.maxRedirects, 0);
  assert.equal(route.observed.options.maxRetries, 0);
  assert.equal(route.observed.fulfilled, 1);
  assert.equal(counts.conversationReads, 1);
  assert.deepEqual(observed.conversation, saved());
  assert.equal(
    observed.evidence.snapshotSha256,
    completedConversation(saved(), conversationId).snapshotSha256,
  );
});

test('nonterminal and changed snapshots are not forwarded to an auto-polling UI', async () => {
  for (const body of [
    { ...saved(), status: 'running' },
    { ...saved(), messages: [...saved().messages, { role: 'assistant', content: 'Changed' }] },
  ]) {
    const counts = stats(),
      observed = { evidence: completedConversation(saved(), conversationId) },
      route = fakeRoute({ body });
    await guardedAnalystRequest(binding.origin, conversationId, bypass, counts, observed)(route);
    assert.equal(route.observed.fulfilled, 0);
    assert.equal(counts.failed, 1);
  }
});

test('organization identity is validated before sessionStorage restoration and cannot change mid-check', async () => {
  const counts = stats(),
    observed = {},
    valid = fakeRoute({
      path: '/api/meta',
      body: { organization: { id: organizationId }, today: '2026-11-03' },
    });
  await guardedAnalystRequest(binding.origin, conversationId, bypass, counts, observed)(valid);
  assert.equal(counts.metaVerified, true);
  assert.equal(observed.organizationId, organizationId);
  const changed = fakeRoute({
    path: '/api/meta',
    body: { organization: { id: otherId }, today: '2026-11-03' },
  });
  await guardedAnalystRequest(binding.origin, conversationId, bypass, counts, observed)(changed);
  assert.equal(changed.observed.fulfilled, 0);
  assert.equal(counts.failed, 1);
});

test('redirects never forward the bypass and request ceilings stop before fetch', async () => {
  for (const status of [301, 302, 307, 308]) {
    const counts = stats(),
      route = fakeRoute({ status });
    await guardedAnalystRequest(binding.origin, conversationId, bypass, counts, {})(route);
    assert.equal(route.observed.fulfilled, 0);
    assert.equal(counts.redirectsBlocked, 1);
  }
  const counts = { ...stats(), attempted: 100 },
    route = fakeRoute();
  await guardedAnalystRequest(binding.origin, conversationId, bypass, counts, {})(route);
  assert.equal(route.observed.fetched, 0);
  assert.equal(counts.blocked, 1);
});

test('transport failures expose counts only, never private error text or bypass', async () => {
  const counts = stats(),
    route = fakeRoute({ error: true });
  await guardedAnalystRequest(binding.origin, conversationId, bypass, counts, {})(route);
  assert.equal(counts.failed, 1);
  assert.equal(JSON.stringify(counts).includes('private'), false);
  assert.equal(JSON.stringify(counts).includes(bypass), false);
});

test('encrypted artifacts bind to the chosen conversation and cannot be reassigned to another', () => {
  const key = 'd'.repeat(64),
    envelope = encryptBrowserArtifact([], key, binding);
  assert.deepEqual(decryptBrowserArtifact(envelope, key, binding), []);
  assert.throws(() =>
    decryptBrowserArtifact(envelope, key, validateAnalystTarget({ ...input, conversationId: otherId })),
  );
});
