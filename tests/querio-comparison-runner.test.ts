import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runQuerioComparison,
  type QuerioComparisonPermit,
} from '../scripts/analyst-workspace-evaluation/querio-runner';
import { extractQuerioObservations } from '../scripts/analyst-workspace-evaluation/querio-observations';
import { createFileAnalystStore } from '../scripts/analyst-workspace-evaluation/querio-file-store';
import { hash, readReferences } from '../scripts/analyst-workspace-evaluation/references';
import type { QuerioRequest } from '../server/querio-client';
import { AppError } from '../server/errors';

vi.mock('../server/diagnostics', () => ({ diagnostic: vi.fn() }));
const root = process.cwd(),
  tempRoot = resolve(root, '.tools/querio-comparison');
const directories: string[] = [];
afterEach(() => {
  for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true });
});
const settings = {
  key: 'fixture-key-not-real',
  workspaceId: 'workspace-fixture',
  datasource: 'daybook-acceptance-20261104',
  model: 'test-model',
};
const permit: QuerioComparisonPermit = {
  approved: true,
  approvalReference: 'offline-test-only',
  scopeId: 'offline-fixture',
  sourceCommit: 'a'.repeat(40),
  datasource: settings.datasource,
  workspaceId: settings.workspaceId,
  modelId: settings.model,
  businessDate: '2026-11-03',
  includedCreditHeadroom: 383,
  totalTurnReservation: 120,
  perTurnReservation: 15,
  stopAtObservedResponses: 12,
};
function fixture() {
  const fixturePermit = { ...permit, scopeId: `offline-${randomUUID()}` };
  directories.push(resolve(tempRoot, 'permit-claims', `${hash(fixturePermit.scopeId)}.json`));
  const output = resolve(tempRoot, `test-${randomUUID()}`);
  directories.push(output);
  const refs = readReferences(root),
    calls: { method: string; path: string; body: unknown }[] = [],
    agents = new Map<string, Record<string, unknown>[]>();
  let env = 0,
    notebook = 0,
    session = 0,
    run = 0,
    currentAgent = '',
    currentRun = '';
  let historyMissing = false,
    responsesPerRun = 2,
    runRunning = false,
    loseSubmission = false,
    loseSetup = false;
  const request: QuerioRequest = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'DELETE') return {};
    if (method === 'POST' && path === '/execution-environments') {
      if (loseSetup) throw new AppError(503, 'AI_CONNECTION_ERROR', 'Setup accepted, response lost');
      return { id: `env-${++env}` };
    }
    if (method === 'POST' && path === '/notebooks') return { id: `notebook-${++notebook}` };
    if (method === 'POST' && path === '/notebook-sessions') return { id: `session-${++session}` };
    if (method === 'POST' && path === '/agent-sessions') {
      currentAgent = String((body as { id: string }).id);
      agents.set(currentAgent, agents.get(currentAgent) ?? []);
      return { id: currentAgent };
    }
    if (method === 'GET' && path.startsWith('/notebook-sessions/')) return { state: 'ready' };
    if (method === 'GET' && path.endsWith('/runs?limit=100')) return { items: [] };
    if (method === 'GET' && path.startsWith('/agent-sessions/'))
      return {
        state: 'ready',
        ...(historyMissing && run > 0 ? {} : { entries: agents.get(path.split('/').at(-1)!) ?? [] }),
      };
    if (method === 'POST' && path.endsWith('/events')) {
      currentRun = `run-${++run}`;
      const entries = agents.get(currentAgent)!;
      for (let i = 0; i < responsesPerRun; i++)
        entries.push({
          id: `message-${run}-${i}`,
          type: 'message',
          message: {
            role: 'assistant',
            model: settings.model,
            usage: { input_tokens: 100, output_tokens: 20, cumulative_tokens: 120 },
            content: [{ type: 'text', text: 'Saved answer' }],
          },
        });
      if (loseSubmission) throw new AppError(503, 'AI_CONNECTION_ERROR', 'Injected lost response');
      return { runId: currentRun };
    }
    if (method === 'POST' && path.endsWith('/cancel')) {
      runRunning = false;
      return {};
    }
    if (method === 'GET' && path.startsWith('/runs/'))
      return {
        id: currentRun,
        status: runRunning ? 'running' : 'completed',
        output: { finalAnswerMarkdown: 'The recorded fixture answer.', cells: [], assistantMessages: [] },
      };
    if (method === 'GET' && path.startsWith('/notebooks/')) return { cells: [] };
    throw new Error(`Unexpected fake request ${method} ${path}`);
  };
  const verify = vi.fn(async () => ({
    fingerprintBefore: 'unchanged',
    fingerprintAfter: 'unchanged',
    factChecks: 38,
    referenceHashes: refs.hashes,
  }));
  let clock = Date.parse('2026-11-04T12:00:00Z');
  const options = {
    root,
    outputDirectory: output,
    settings,
    permit: fixturePermit,
    request,
    verifyFixture: verify,
    now: () => new Date(clock),
    wait: async (ms: number) => {
      clock += ms;
    },
  };
  return {
    output,
    calls,
    verify,
    options,
    setHistoryMissing: () => (historyMissing = true),
    setResponses: (n: number) => (responsesPerRun = n),
    setRunning: () => (runRunning = true),
    setLostSubmission: () => (loseSubmission = true),
    setLostSetup: () => (loseSetup = true),
  };
}
describe('paired Querio controller offline contracts', () => {
  it('extracts observed assistant entries and exact reported token fields, not cumulative totals as extra spending', () => {
    const x = extractQuerioObservations('s', {
      entries: [
        { id: 'u', type: 'message', message: { role: 'user' } },
        {
          id: 'm',
          type: 'message',
          message: {
            role: 'assistant',
            model: 'model',
            usage: {
              input_tokens: 100,
              output_tokens: 10,
              cumulative_tokens: 999,
              cache_read_input_tokens: 200,
            },
            stop_reason: 'stop',
          },
        },
      ],
    });
    expect(x).toMatchObject({
      available: true,
      observations: [
        {
          id: 's:m',
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            cumulative_tokens: 999,
            cache_read_input_tokens: 200,
          },
        },
      ],
    });
    expect(extractQuerioObservations('s', {}).available).toBe(false);
  });
  it('refuses an unapproved permit before any remote calls', async () => {
    const f = fixture();
    await expect(
      runQuerioComparison({ ...f.options, permit: { ...permit, approved: false } }),
    ).rejects.toMatchObject({ code: 'EXPLICIT_QUERIO_COMPARISON_APPROVAL_REQUIRED' });
    expect(f.calls).toHaveLength(0);
  });
  it.each([NaN, -1, 119, 120.5])(
    'refuses invalid or insufficient included-credit headroom (%s)',
    async (headroom) => {
      const f = fixture();
      await expect(
        runQuerioComparison({
          ...f.options,
          permit: { ...f.options.permit, includedCreditHeadroom: headroom },
        }),
      ).rejects.toMatchObject({ code: 'CREDIT_AND_DATE_PERMIT_CHANGED' });
      expect(f.calls).toHaveLength(0);
      expect(f.verify).not.toHaveBeenCalled();
    },
  );
  it('refuses a different datasource or unverified fixture before any remote calls', async () => {
    const f = fixture();
    await expect(
      runQuerioComparison({ ...f.options, settings: { ...settings, datasource: 'daybook-live' } }),
    ).rejects.toMatchObject({ code: 'PAIRED_DATASOURCE_MODEL_REQUIRED' });
    expect(f.calls).toHaveLength(0);
  });
  it('runs exact6conversations/8turns through the real service and captures repeated history without doublecounting', async () => {
    const f = fixture();
    f.options.permit.includedCreditHeadroom = 256;
    // The fresh reviewed headroom can differ from the historical run's estimate.
    directories.push(resolve(tempRoot, 'permit-claims', `${hash(f.options.permit.scopeId)}.json`));
    const result = await runQuerioComparison(f.options);
    expect(result).toMatchObject({
      completedTurns: 8,
      observedResponses: 16,
      reservedCredits: 120,
      haltReason: null,
      accuracyScore: null,
    });
    const posts = f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/events'));
    expect(posts).toHaveLength(8);
    expect(f.calls.filter((c) => c.method === 'POST' && c.path === '/notebooks')).toHaveLength(6);
    expect(f.calls.filter((c) => c.method === 'POST' && c.path === '/execution-environments')).toHaveLength(
      8,
    );
    expect(
      f.calls
        .filter((c) => c.method === 'POST' && c.path === '/agent-sessions')
        .every(
          (c) =>
            (c.body as { config: { datasourceSlugs: string[] } }).config.datasourceSlugs[0] ===
            settings.datasource,
        ),
    ).toBe(true);
    const first = JSON.parse(readFileSync(resolve(f.output, 'a01-turn-1.json'), 'utf8'));
    expect(first.prompt).toBe('What is the current cash balance?');
    expect(first.state.messages.at(-1).role).toBe('assistant');
    expect(first.finalHistoryAvailable).toBe(true);
    const context = JSON.parse(readFileSync(resolve(f.output, 'context.json'), 'utf8')).instructions;
    expect(context).toContain('2026-11-03');
    expect(context).not.toContain('requiredFacts');
    expect(context).not.toContain('USD60');
    expect(context).not.toContain('USD430');
    expect(f.verify).toHaveBeenCalledTimes(2);
    await expect(runQuerioComparison(f.options)).rejects.toMatchObject({ code: 'EEXIST' });
    const alternateOutput = `${f.output}-new-folder`;
    directories.push(alternateOutput);
    await expect(
      runQuerioComparison({ ...f.options, outputDirectory: alternateOutput }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    const reorderedPermit = Object.fromEntries(
      Object.entries(f.options.permit).reverse(),
    ) as QuerioComparisonPermit;
    await expect(
      runQuerioComparison({ ...f.options, permit: reorderedPermit, outputDirectory: alternateOutput }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(
      runQuerioComparison({
        ...f.options,
        permit: { ...f.options.permit, approvalReference: 'different-reference-same-cohort' },
        outputDirectory: alternateOutput,
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/events'))).toHaveLength(8);
  });
  it('preserves an answer but stops the cohort if final usage history is missing', async () => {
    const f = fixture();
    f.setHistoryMissing();
    const r = await runQuerioComparison(f.options);
    expect(r.haltReason).toBe('QUERIO_USAGE_OR_RUN_OUTCOME_UNKNOWN');
    expect(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/events'))).toHaveLength(1);
    expect(r.reservedCredits).toBe(15);
    expect(JSON.parse(readFileSync(resolve(f.output, 'a01-turn-1.json'), 'utf8')).state.status).toBe(
      'completed',
    );
  });
  it('requests cancellation at12observed responses and does not claim this was an upstream hard cap', async () => {
    const f = fixture();
    f.setResponses(12);
    f.setRunning();
    const r = await runQuerioComparison(f.options);
    expect(f.calls.some((c) => c.method === 'POST' && c.path.endsWith('/cancel'))).toBe(true);
    const stop = JSON.parse(readFileSync(resolve(f.output, 'stop-A01-1.json'), 'utf8'));
    expect(stop).toMatchObject({ count: 12, hardUpstreamLimit: false });
    expect(r.accuracyScore).toBeNull();
  });
  it('never resubmits an uncertain paid message and preserves its reservation', async () => {
    const f = fixture();
    f.setLostSubmission();
    const r = await runQuerioComparison(f.options);
    expect(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/events'))).toHaveLength(1);
    expect(r.reservedCredits).toBe(15);
    expect(r.haltReason).toBeTruthy();
  });
  it('does not confuse a locally closed unknown setup with confirmed remote resource cleanup', async () => {
    const f = fixture();
    f.setLostSetup();
    const r = await runQuerioComparison(f.options);
    expect(r.haltReason).toBe('QUERIO_RESOURCE_CLOSURE_UNCONFIRMED');
    expect(r.reservedCredits).toBe(0);
    expect(f.calls.filter((c) => c.method === 'POST' && c.path === '/execution-environments')).toHaveLength(
      1,
    );
    const closure = JSON.parse(readFileSync(resolve(f.output, 'a01-closure.json'), 'utf8'));
    expect(closure).toMatchObject({
      status: 'closed',
      uncertainSetup: true,
      beforeCloseRuntime: { pendingMutation: 'environment' },
    });
  });
  it('keeps an empty final history unresolved instead of recording a verified zero-credit answer', async () => {
    const f = fixture();
    f.setResponses(0);
    const r = await runQuerioComparison(f.options);
    expect(r.haltReason).toBe('QUERIO_USAGE_OR_RUN_OUTCOME_UNKNOWN');
    expect(r.reservedCredits).toBe(15);
    expect(r.observedResponses).toBe(0);
    expect(f.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/events'))).toHaveLength(1);
  });
  it('file store persists leases and paid-mutation guards to disk', async () => {
    const directory = resolve(tempRoot, `test-${randomUUID()}`);
    directories.push(directory);
    mkdirSync(directory, { mode: 0o700 });
    const target = resolve(directory, 'store');
    const org = randomUUID(),
      id = randomUUID(),
      store = createFileAnalystStore(target);
    await store.create(org, {
      id,
      provider: 'querio',
      title: 'Test',
      sourceLabel: 'Fixture',
      status: 'idle',
      phase: null,
      messages: [],
      notebook: { cells: [], updatedAt: null },
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await store.queue(org, id, 'querio', 'm', 'Prompt');
    const lease = await store.claim(org, id, 'querio');
    expect(lease).not.toBeNull();
    lease!.record.runtime.pendingMutation = 'submit';
    await store.save(org, id, lease!.token, lease!.record);
    await store.release(org, id, lease!.token);
    const same = await store.read(org, id, 'querio');
    expect(same.runtime.pendingMutation).toBe('submit');
    await expect(store.queue(org, id, 'querio', 'm2', 'Again')).rejects.toMatchObject({ code: 'AI_BUSY' });
  });
});
