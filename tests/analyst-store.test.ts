import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AnalystConversation, AnalystProvider } from '../shared/analyst';
import { postgresAnalystStore as store, type AnalystRecord } from '../server/analyst-store';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { accounts, createEntry } from '../server/ledger';
import { seedChart } from '../scripts/seed';

// Actual PostgreSQL races and persisted state. No Querio/model requests occur here.
const admin = new pg.Client({ connectionString: config.migrationUrl, connectionTimeoutMillis: 2000 });
let connected = false;
let org = '';
let otherOrg = '';
let ledgerBefore: string | null = null;

function conversation(id: string = randomUUID(), provider: AnalystProvider = 'querio'): AnalystConversation {
  const stamp = new Date().toISOString();
  return {
    id,
    provider,
    title: 'Synthetic analyst test',
    sourceLabel: 'Isolated test books',
    status: 'idle',
    phase: null,
    messages: [],
    notebook: { cells: [], updatedAt: null },
    error: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

async function fingerprint() {
  const [row] = await query<{ snapshot: unknown }>(
    `SELECT jsonb_build_object(
      'entries',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id)
        FROM journal_entries e WHERE organization_id=ANY($1::uuid[])),'[]'::jsonb),
      'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id)
        FROM journal_lines l WHERE organization_id=ANY($1::uuid[])),'[]'::jsonb),
      'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id)
        FROM accounts a WHERE organization_id=ANY($1::uuid[])),'[]'::jsonb)) AS snapshot`,
    [[org, otherOrg]],
  );
  return createHash('sha256').update(JSON.stringify(row.snapshot)).digest('hex');
}

async function claim(id: string) {
  const ownership = await store.claim(org, id, 'querio');
  if (!ownership) throw new Error('Expected an available isolated test lease');
  return ownership;
}

async function persist(id: string, change: (record: AnalystRecord) => void) {
  const ownership = await claim(id);
  try {
    change(ownership.record);
    await store.save(org, id, ownership.token, ownership.record);
  } finally {
    await store.release(org, id, ownership.token);
  }
}

beforeAll(async () => {
  for (const value of [config.databaseUrl, config.migrationUrl]) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const compose =
      process.env.NODE_ENV === 'test' &&
      url.hostname === 'db' &&
      url.port === '5432' &&
      url.pathname === '/spiich';
    if (!local && !compose)
      throw new Error('Analyst-store integration tests require isolated local/CI PostgreSQL.');
  }
  try {
    await admin.connect();
    connected = true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      process.env.CI ||
      process.env.ANALYST_STORE_DB_REQUIRED === '1' ||
      !['ECONNREFUSED', 'ETIMEDOUT', 'EPERM', 'EACCES'].includes(code ?? '')
    )
      throw error;
    console.warn('Analyst-store database cases skipped: isolated local PostgreSQL is unavailable.');
  }
});

beforeEach(async (context) => {
  ledgerBefore = null;
  if (!connected) context.skip();
  org = randomUUID();
  otherOrg = randomUUID();
  await admin.query(
    "INSERT INTO organizations(id,name) VALUES($1,'Analyst store fixture'),($2,'Separate analyst fixture')",
    [org, otherOrg],
  );
  await seedChart(org);
  const chart = await accounts(org);
  for (const code of ['1010', '3010', '5030']) {
    const account = chart.find((candidate) => candidate.code === code);
    expect(account, `Store fixture requires seeded posting account ${code}`).toBeDefined();
    expect(account?.is_group, `Store fixture account ${code} must permit posting`).toBe(false);
    expect(account?.archived, `Store fixture account ${code} must be active`).toBe(false);
  }
  const ids = Object.fromEntries(chart.map((account) => [account.code, account.id]));
  for (const [debit, credit, amount] of [
    ['1010', '3010', '1000.00'],
    ['5030', '1010', '12.35'],
  ]) {
    await createEntry(
      org,
      {
        date: '2026-01-01',
        description: 'Immutable store-test accounting record',
        counterparty: 'Fixture only',
        reference: '',
        source: 'MANUAL',
        lines: [
          { accountId: ids[debit], debit: amount, credit: '0', exchangeRate: '1', memo: '' },
          { accountId: ids[credit], debit: '0', credit: amount, exchangeRate: '1', memo: '' },
        ],
      },
      randomUUID(),
      { post: true },
    );
  }
  ledgerBefore = await fingerprint();
});

afterEach(async () => {
  if (connected && ledgerBefore !== null) expect(await fingerprint()).toBe(ledgerBefore);
});

afterAll(async () => {
  if (connected) await admin.end();
  await pool.end();
});

describe('Analyst conversation PostgreSQL lifecycle and isolation', () => {
  it('persists an idempotent create and isolates reads, messages and leases by organization/provider', async () => {
    const initial = conversation();
    const created = await store.create(org, initial);
    expect(created.state).toEqual(initial);
    expect((await store.create(org, { ...initial, title: 'Should not replace saved work' })).state).toEqual(
      initial,
    );
    await expect(store.read(otherOrg, initial.id, 'querio')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.read(org, initial.id, 'daybook')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      store.queue(otherOrg, initial.id, 'querio', randomUUID(), 'Cross-business attempt'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      store.queue(org, initial.id, 'daybook', randomUUID(), 'Wrong provider'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await store.claim(otherOrg, initial.id, 'querio')).toBeNull();
    expect(await store.claim(org, initial.id, 'daybook')).toBeNull();
    const owned = await claim(initial.id);
    await expect(store.save(otherOrg, initial.id, owned.token, owned.record)).rejects.toMatchObject({
      code: 'CONCURRENT_CHANGE',
    });
    await store.release(otherOrg, initial.id, owned.token);
    expect(await store.claim(org, initial.id, 'querio')).toBeNull();
    await store.release(org, initial.id, owned.token);
    expect((await store.read(org, initial.id, 'querio')).state).toEqual(initial);
  });

  it('queues a retried UUID once and rejects changed text even after later conversation turns', async () => {
    const initial = conversation();
    await store.create(org, initial);
    const messageId = randomUUID();
    const answers = await Promise.all(
      Array.from({ length: 6 }, () => store.queue(org, initial.id, 'querio', messageId, 'What is cash?')),
    );
    expect(answers.every((answer) => answer.state.messages.length === 1)).toBe(true);
    await expect(store.queue(org, initial.id, 'querio', messageId, 'Changed question')).rejects.toMatchObject(
      { code: 'IDEMPOTENCY_CONFLICT' },
    );
    await persist(initial.id, (record) => {
      record.state.status = 'completed';
      record.state.messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: 'Synthetic answer',
        createdAt: new Date().toISOString(),
      });
      record.runtime = { notebookId: 'saved-notebook', stage: 'done' };
    });
    const secondId = randomUUID();
    const second = await store.queue(org, initial.id, 'querio', secondId, 'And last month?');
    const replay = await store.queue(org, initial.id, 'querio', messageId, 'What is cash?');
    expect(replay).toEqual(second);
    expect(replay.lastMessageId).toBe(secondId);
    expect(replay.state.messages).toHaveLength(3);
    expect(replay.runtime.notebookId).toBe('saved-notebook');
    const assistantId = replay.state.messages[1].id;
    await expect(
      store.queue(org, initial.id, 'querio', assistantId, 'Synthetic answer'),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('admits only one different question and one polling lease during simultaneous requests', async () => {
    const initial = conversation();
    await store.create(org, initial);
    const submitted = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        store.queue(org, initial.id, 'querio', randomUUID(), `Question ${index}`),
      ),
    );
    expect(submitted.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of submitted) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'AI_BUSY' });
    }
    expect((await store.read(org, initial.id, 'querio')).state.messages).toHaveLength(1);
    const leases = await Promise.all(Array.from({ length: 8 }, () => store.claim(org, initial.id, 'querio')));
    const winners = leases.filter((lease) => lease !== null);
    expect(winners).toHaveLength(1);
    const winner = winners[0]!;
    winner.record.runtime = { environmentId: 'remote-environment', stage: 'session' };
    await store.save(org, initial.id, winner.token, winner.record);
    await store.release(org, initial.id, randomUUID());
    expect(await store.claim(org, initial.id, 'querio')).toBeNull();
    await store.release(org, initial.id, winner.token);
    expect((await store.read(org, initial.id, 'querio')).runtime).toEqual(winner.record.runtime);
  });

  it('recovers an expired lease without letting the former owner save or release the replacement', async () => {
    const initial = conversation();
    await store.create(org, initial);
    await store.queue(org, initial.id, 'querio', randomUUID(), 'Recover this analysis');
    const former = await claim(initial.id);
    former.record.runtime = {
      stage: 'run',
      environmentId: 'kept-environment',
      agentId: 'kept-agent',
      pendingMutation: 'submit',
    };
    await store.save(org, initial.id, former.token, former.record);
    await admin.query(
      "UPDATE analyst_conversations SET lease_until=now()-interval '1 second' WHERE organization_id=$1 AND id=$2",
      [org, initial.id],
    );
    await expect(store.save(org, initial.id, former.token, former.record)).rejects.toMatchObject({
      code: 'CONCURRENT_CHANGE',
    });
    const replacement = await claim(initial.id);
    expect(replacement.token).not.toBe(former.token);
    expect(replacement.record.runtime).toEqual(former.record.runtime);
    await store.release(org, initial.id, former.token);
    expect(await store.claim(org, initial.id, 'querio')).toBeNull();
    former.record.state.title = 'Stale overwrite';
    await expect(store.save(org, initial.id, former.token, former.record)).rejects.toMatchObject({
      code: 'CONCURRENT_CHANGE',
    });
    await store.release(org, initial.id, replacement.token);
    expect((await store.read(org, initial.id, 'querio')).state.title).not.toBe('Stale overwrite');
  });

  it('does not overwrite an uncertain or still-closing remote runtime with a fresh message', async () => {
    for (const runtime of [
      { stage: 'submit', pendingMutation: 'submit', notebookId: 'saved-notebook' },
      { stage: 'close-environment', environmentId: 'not-yet-closed' },
      { stage: 'close-session', sessionId: 'not-yet-closed' },
      { stage: 'close-agent', agentId: 'not-yet-closed' },
    ]) {
      const initial = conversation();
      await store.create(org, initial);
      await persist(initial.id, (record) => {
        record.state.status = 'failed';
        record.runtime = runtime;
      });
      const before = await store.read(org, initial.id, 'querio');
      await expect(
        store.queue(org, initial.id, 'querio', randomUUID(), 'Please try again'),
      ).rejects.toMatchObject({ status: 409 });
      expect(await store.read(org, initial.id, 'querio')).toEqual(before);
    }
  });

  it('keeps active state protected after a lease expires and does not turn a retry into another message', async () => {
    const initial = conversation();
    await store.create(org, initial);
    const messageId = randomUUID();
    await store.queue(org, initial.id, 'querio', messageId, 'Original request');
    const owned = await claim(initial.id);
    await admin.query(
      "UPDATE analyst_conversations SET lease_until=now()-interval '1 second',updated_at=now()-interval '1 hour' WHERE organization_id=$1 AND id=$2",
      [org, initial.id],
    );
    await expect(
      store.queue(org, initial.id, 'querio', randomUUID(), 'Different request'),
    ).rejects.toMatchObject({ code: 'AI_BUSY' });
    const replay = await store.queue(org, initial.id, 'querio', messageId, 'Original request');
    expect(replay.state.messages).toHaveLength(1);
    expect(replay.state.status).toBe('starting');
    await store.release(org, initial.id, owned.token);
  });

  it('retains a stop requested during a lease even when its stale holder saves, and keeps repeated closure terminal', async () => {
    const initial = conversation();
    await store.create(org, initial);
    await store.queue(org, initial.id, 'querio', randomUUID(), 'Analyze these books');
    const owned = await claim(initial.id);
    expect(owned.record.runtime.closeRequested).not.toBe(true);

    // Stop has its own persisted flag, so it must not wait for the polling lease.
    const requested = await store.requestClose(org, initial.id, 'querio');
    expect(requested.runtime.closeRequested).toBe(true);
    expect(requested.state.phase).toBe('Closing this analysis');
    expect(await store.claim(org, initial.id, 'querio')).toBeNull();

    // The lease holder still has a pre-stop snapshot and saves a completed turn.
    // Its stale runtime must neither clear the flag nor permit a new question.
    owned.record.state.status = 'completed';
    owned.record.state.phase = null;
    owned.record.runtime = { notebookId: 'retained-notebook', stage: 'done' };
    await store.save(org, initial.id, owned.token, owned.record);
    expect(owned.record.runtime.closeRequested).toBe(true);
    const [persisted] = await query<{ close_requested: boolean }>(
      'SELECT close_requested FROM analyst_conversations WHERE organization_id=$1 AND id=$2',
      [org, initial.id],
    );
    expect(persisted.close_requested).toBe(true);
    expect((await store.read(org, initial.id, 'querio')).runtime.closeRequested).toBe(true);
    await store.release(org, initial.id, owned.token);
    await expect(
      store.queue(org, initial.id, 'querio', randomUUID(), 'Start another paid request'),
    ).rejects.toMatchObject({ code: 'AI_REQUEST_REJECTED' });

    await persist(initial.id, (record) => {
      record.state.status = 'closed';
      record.state.phase = null;
    });
    const closed = await store.read(org, initial.id, 'querio');
    expect((await store.requestClose(org, initial.id, 'querio')).state).toEqual(closed.state);
    expect((await store.requestClose(org, initial.id, 'querio')).state).toEqual(closed.state);
    const final = await store.read(org, initial.id, 'querio');
    expect(final.state.status).toBe('closed');
    expect(final.state.phase).toBeNull();
    expect(final.state.messages).toHaveLength(1);
    expect(final.runtime.closeRequested).toBe(true);
  });

  it('enforces workspace concurrency atomically while leaving another workspace independent', async () => {
    const conversations = await Promise.all(
      Array.from({ length: 5 }, () => store.create(org, conversation())),
    );
    const results = await Promise.allSettled(
      conversations.map((record) =>
        store.queue(org, record.state.id, 'querio', randomUUID(), 'New analysis'),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 429, code: 'AI_BUSY' });
    }
    const isolated = await store.create(otherOrg, conversation());
    expect(
      (await store.queue(otherOrg, isolated.state.id, 'querio', randomUUID(), 'Independent analysis')).state
        .status,
    ).toBe('starting');
  });

  it('preserves closed conversations and refuses additional history at the message limit', async () => {
    const closed = conversation();
    closed.status = 'closed';
    await store.create(org, closed);
    await expect(
      store.queue(org, closed.id, 'querio', randomUUID(), 'Reopen silently'),
    ).rejects.toMatchObject({ code: 'AI_REQUEST_REJECTED' });
    const full = conversation();
    full.status = 'completed';
    full.messages = Array.from({ length: 80 }, (_, index) => ({
      id: randomUUID(),
      role: index % 2 ? 'assistant' : 'user',
      content: `Previous message ${index}`,
      createdAt: full.createdAt,
    }));
    await store.create(org, full);
    await expect(
      store.queue(org, full.id, 'querio', randomUUID(), 'One more question'),
    ).rejects.toMatchObject({ code: 'AI_REQUEST_LIMIT' });
    expect((await store.read(org, full.id, 'querio')).state.messages).toEqual(full.messages);
  });

  it('bounds saved conversations without preventing an idempotent read of an existing one', async () => {
    const base = conversation();
    await admin.query(
      `WITH ids AS (SELECT gen_random_uuid() AS id FROM generate_series(1,500))
       INSERT INTO analyst_conversations(id,organization_id,provider,state)
       SELECT id,$1,'querio',jsonb_set($2::jsonb,'{id}',to_jsonb(id::text)) FROM ids`,
      [org, JSON.stringify(base)],
    );
    const [{ id: existingId }] = await query<{ id: string }>(
      'SELECT id FROM analyst_conversations WHERE organization_id=$1 ORDER BY id LIMIT 1',
      [org],
    );
    expect((await store.create(org, conversation(existingId))).state.id).toBe(existingId);
    await expect(store.create(org, conversation())).rejects.toMatchObject({
      status: 429,
      code: 'AI_REQUEST_LIMIT',
    });
    const [{ count }] = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM analyst_conversations WHERE organization_id=$1',
      [org],
    );
    expect(count).toBe('500');
  });

  it('rolls back invalid UUID persistence without leaving a phantom queued question', async () => {
    const initial = conversation();
    await store.create(org, initial);
    const before = await store.read(org, initial.id, 'querio');
    await expect(
      store.queue(org, initial.id, 'querio', 'not-a-uuid', 'Invalid reference'),
    ).rejects.toMatchObject({ code: '22P02' });
    expect(await store.read(org, initial.id, 'querio')).toEqual(before);
  });
});
