import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { accounts, createEntry, getEntry, postEntry, reverseEntry, updateDraft } from '../server/ledger';
import { getCategorizationContext, recordProposal, revokeCorrection } from '../server/categorization-memory';
import { seedChart } from '../scripts/seed';
import type { EntryInput } from '../shared/schema';

// These are real PostgreSQL tests, never live-provider tests. Refuse accidental
// execution against a hosted database even if the workspace .env points there.
const admin = new pg.Client({ connectionString: config.migrationUrl });
let org: string;
let ids: Record<string, string>;
beforeAll(async () => {
  for (const value of [config.databaseUrl, config.migrationUrl]) {
    const parsed = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    const compose =
      process.env.NODE_ENV === 'test' &&
      parsed.hostname === 'db' &&
      parsed.port === '5432' &&
      parsed.pathname === '/spiich';
    if (!local && !compose)
      throw new Error('Correction-memory tests require a disposable local/CI PostgreSQL database.');
  }
  await admin.connect();
});
beforeEach(async () => {
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Correction memory test')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
});
afterAll(async () => {
  await admin.end();
  await pool.end();
});

function entry(
  category = '5030',
  amount = '99',
  description = 'Lucid workspace monthly subscription',
): EntryInput {
  return {
    date: '2026-03-15',
    description,
    counterparty: 'Lucid Workspace',
    reference: '',
    source: 'AI',
    lines: [
      { accountId: ids[category], debit: amount, credit: '0', exchangeRate: '1', memo: '' },
      { accountId: ids['2100'], debit: '0', credit: amount, exchangeRate: '1', memo: '' },
    ],
  };
}
async function corrected(category = '5020', description?: string) {
  const proposalId = await recordProposal(org, entry('5030', '99', description));
  const draft = await createEntry(org, entry(category, '99', description), randomUUID(), { proposalId });
  return { proposalId, draft, posted: await postEntry(org, draft.id, draft.revision) };
}
const context = () =>
  getCategorizationContext(org, 'Lucid workspace monthly subscription paid with company card');

describe('Server-issued, reviewed correction memory', () => {
  it('refuses invalid server proposals before any persistent binding is issued', async () => {
    const unbalanced = entry();
    unbalanced.lines[1].credit = '98';
    await expect(recordProposal(org, unbalanced)).rejects.toMatchObject({ code: 'UNBALANCED_ENTRY' });
    const unknown = entry();
    unknown.lines[0].accountId = randomUUID();
    await expect(recordProposal(org, unknown)).rejects.toMatchObject({ code: 'INVALID_ACCOUNT' });
    await query('UPDATE accounts SET archived=true WHERE organization_id=$1 AND id=$2', [org, ids['5030']]);
    await expect(recordProposal(org, entry())).rejects.toMatchObject({ code: 'INVALID_ACCOUNT' });
    expect(await query('SELECT id FROM ai_entry_proposals WHERE organization_id=$1', [org])).toEqual([]);
  });

  it('stores a validated proposal without a journal and learns only on the actual reviewed posting', async () => {
    const proposalId = await recordProposal(org, entry());
    expect(await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).toHaveLength(0);
    const draft = await createEntry(org, entry('5020'), randomUUID(), { proposalId });
    expect((await context()).corrections).toEqual([]);
    const posted = await postEntry(org, draft.id, draft.revision);
    expect(posted.categorizationLearning).toMatchObject({ status: 'LEARNED' });
    const examples = (await context()).corrections;
    expect(examples).toHaveLength(1);
    expect(examples[0]).toMatchObject({ entryId: posted.id, corrected_lines: entry('5020').lines });
    expect(await query('SELECT id FROM categorization_feedback WHERE organization_id=$1', [org])).toEqual([]);
  });

  it('ignores unverified legacy examples and unbound client-created AI journals', async () => {
    await query(
      'INSERT INTO categorization_feedback(organization_id,description,counterparty,proposed_lines,corrected_lines) VALUES($1,$2,$3,$4,$5)',
      [org, entry().description, 'Lucid Workspace', '[]', JSON.stringify(entry('5020').lines)],
    );
    const posted = await createEntry(org, entry('5020'), randomUUID(), { post: true });
    expect(posted.categorizationLearning).toEqual({ status: 'NOT_APPLICABLE' });
    expect((await context()).corrections).toEqual([]);
    expect((await context()).history.map((item) => item.id)).toEqual([posted.id]);
  });

  it('does not learn amount, memo, rate formatting or line-order edits as account corrections', async () => {
    const proposalId = await recordProposal(org, entry());
    const reviewed = entry('5030', '120');
    reviewed.lines = reviewed.lines
      .reverse()
      .map((line) => ({ ...line, memo: 'Reviewed receipt', exchangeRate: '1.0' }));
    const posted = await createEntry(org, reviewed, randomUUID(), { proposalId, post: true });
    expect(posted.categorizationLearning).toEqual({ status: 'NO_ACCOUNT_CHANGE' });
    expect((await context()).corrections).toEqual([]);
  });

  it('keeps ordinary draft editing and later posting bound even without sending the proposal again', async () => {
    const proposalId = await recordProposal(org, entry());
    const draft = await createEntry(org, entry(), randomUUID(), { proposalId });
    const revised = await updateDraft(org, draft.id, entry('5020', '110'), draft.revision);
    const posted = await postEntry(org, revised.id, revised.revision);
    expect(posted.categorizationLearning?.status).toBe('LEARNED');
    expect((await context()).corrections[0].corrected_lines).toEqual(entry('5020', '110').lines);
  });

  it('rejects unbalanced posting and keeps the memory empty until the draft is corrected', async () => {
    const proposalId = await recordProposal(org, entry());
    const invalid = entry('5020');
    invalid.lines[1].credit = '98';
    const draft = await createEntry(org, invalid, randomUUID(), { proposalId });
    await expect(postEntry(org, draft.id, draft.revision)).rejects.toMatchObject({
      code: 'UNBALANCED_ENTRY',
    });
    expect((await getEntry(org, draft.id)).status).toBe('DRAFT');
    expect((await context()).corrections).toEqual([]);
    const fixed = await updateDraft(org, draft.id, entry('5020'), draft.revision);
    expect((await postEntry(org, fixed.id, fixed.revision)).categorizationLearning.status).toBe('LEARNED');
  });

  it('rejects a saved entry changed outside its bound review and rolls posting back', async () => {
    const proposalId = await recordProposal(org, entry());
    const draft = await createEntry(org, entry('5020'), randomUUID(), { proposalId });
    await query('UPDATE journal_entries SET description=$3 WHERE organization_id=$1 AND id=$2', [
      org,
      draft.id,
      'Changed without review',
    ]);
    const changed = await getEntry(org, draft.id);
    await expect(postEntry(org, draft.id, changed.revision)).rejects.toMatchObject({
      code: 'CORRECTION_REVIEW_CHANGED',
    });
    expect((await getEntry(org, draft.id)).status).toBe('DRAFT');
    expect(
      await query('SELECT id FROM jobs WHERE organization_id=$1 AND entry_id=$2', [org, draft.id]),
    ).toEqual([]);
    const reviewed = await updateDraft(org, draft.id, entry('5020'), changed.revision);
    expect((await postEntry(org, draft.id, reviewed.revision)).categorizationLearning.status).toBe('LEARNED');
  });

  it('rolls back the posting and outbox if saving the correction fails', async () => {
    const proposalId = await recordProposal(org, entry());
    const draft = await createEntry(org, entry('5020'), randomUUID(), { proposalId });
    const constraint = `memory_failure_${randomUUID().replaceAll('-', '')}`;
    // Fixture-specific failure, removed in finally; no provider or production DB.
    await admin.query(
      `ALTER TABLE categorization_memories ADD CONSTRAINT ${constraint} CHECK (organization_id<>'${org}'::uuid) NOT VALID`,
    );
    try {
      await expect(postEntry(org, draft.id, draft.revision)).rejects.toMatchObject({ code: '23514' });
      expect((await getEntry(org, draft.id)).status).toBe('DRAFT');
      expect(
        await query('SELECT id FROM jobs WHERE organization_id=$1 AND entry_id=$2', [org, draft.id]),
      ).toEqual([]);
      expect((await context()).corrections).toEqual([]);
    } finally {
      await admin.query(`ALTER TABLE categorization_memories DROP CONSTRAINT ${constraint}`);
    }
    expect((await postEntry(org, draft.id, draft.revision)).categorizationLearning.status).toBe('LEARNED');
  });

  it('makes repeated create/post requests idempotent and binds the proposal into the request fingerprint', async () => {
    const proposalId = await recordProposal(org, entry());
    const key = randomUUID();
    const first = await createEntry(org, entry('5020'), key, { proposalId });
    const repeated = await createEntry(org, entry('5020'), key, { proposalId });
    expect(repeated.id).toBe(first.id);
    const otherProposal = await recordProposal(org, entry());
    await expect(createEntry(org, entry('5020'), key, { proposalId: otherProposal })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    const posted = await postEntry(org, first.id, first.revision);
    expect((await postEntry(org, first.id, first.revision)).categorizationLearning).toEqual(
      posted.categorizationLearning,
    );
    expect(
      await query('SELECT id FROM categorization_memories WHERE organization_id=$1', [org]),
    ).toHaveLength(1);
  });

  it('rejects proposal replay into another entry and refuses manual-source attachment atomically', async () => {
    const proposalId = await recordProposal(org, entry());
    await createEntry(org, entry('5020'), randomUUID(), { proposalId });
    await expect(createEntry(org, entry('5010'), randomUUID(), { proposalId })).rejects.toMatchObject({
      code: 'PROPOSAL_ALREADY_USED',
    });
    const another = await recordProposal(org, entry());
    await expect(
      createEntry(org, { ...entry(), source: 'MANUAL' }, randomUUID(), { proposalId: another }),
    ).rejects.toMatchObject({ code: 'PROPOSAL_BINDING_INVALID' });
    expect(await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).toHaveLength(1);
  });

  it('expires unbound proposals but preserves the binding of a draft posted later', async () => {
    const unused = await recordProposal(org, entry());
    await admin.query("UPDATE ai_entry_proposals SET expires_at=now()-interval '1 day' WHERE id=$1", [
      unused,
    ]);
    await expect(createEntry(org, entry('5020'), randomUUID(), { proposalId: unused })).rejects.toMatchObject(
      { code: 'PROPOSAL_EXPIRED' },
    );
    const proposalId = await recordProposal(org, entry());
    const draft = await createEntry(org, entry('5020'), randomUUID(), { proposalId });
    await admin.query("UPDATE ai_entry_proposals SET expires_at=now()-interval '1 day' WHERE id=$1", [
      proposalId,
    ]);
    await recordProposal(org, entry());
    expect(await query('SELECT id FROM ai_entry_proposals WHERE id=$1', [unused])).toEqual([]);
    expect((await postEntry(org, draft.id, draft.revision)).categorizationLearning.status).toBe('LEARNED');
  });

  it('supersedes only the same normalized context and keeps another purchase from the same vendor', async () => {
    const first = await corrected('5020');
    const different = await corrected('1200', 'Lucid Workspace durable conference camera');
    const latest = await corrected('5010', '  LUCID workspace   monthly subscription  ');
    const records = await query<{ entry_id: string; status: string }>(
      'SELECT entry_id,status FROM categorization_memories WHERE organization_id=$1',
      [org],
    );
    expect(records.find((row) => row.entry_id === first.posted.id)?.status).toBe('SUPERSEDED');
    expect(
      records
        .filter((row) => row.status === 'ACTIVE')
        .map((row) => row.entry_id)
        .sort(),
    ).toEqual([different.posted.id, latest.posted.id].sort());
    expect((await context()).corrections.map((row) => row.entryId)).not.toContain(first.posted.id);
    expect((await context()).history.map((row) => row.id)).not.toContain(first.posted.id);
  });

  it('serializes concurrent corrections to the same context without losing either posted journal', async () => {
    const firstProposal = await recordProposal(org, entry());
    const secondProposal = await recordProposal(org, entry());
    const first = await createEntry(org, entry('5020'), randomUUID(), { proposalId: firstProposal });
    const second = await createEntry(org, entry('5010'), randomUUID(), { proposalId: secondProposal });
    const posted = await Promise.all([
      postEntry(org, first.id, first.revision),
      postEntry(org, second.id, second.revision),
    ]);
    expect(posted.map((item) => item.status)).toEqual(['POSTED', 'POSTED']);
    const memories = await query<{ status: string }>(
      'SELECT status FROM categorization_memories WHERE organization_id=$1',
      [org],
    );
    expect(memories.map((item) => item.status).sort()).toEqual(['ACTIVE', 'SUPERSEDED']);
    expect((await context()).corrections).toHaveLength(1);
  });

  it('removes both a reversal and its original from useful history and revokes its correction', async () => {
    const { posted } = await corrected();
    const reversal = await reverseEntry(org, posted.id, '2026-03-16', randomUUID());
    const result = await context();
    expect(result.corrections).toEqual([]);
    expect(result.history.map((row) => row.id)).not.toContain(posted.id);
    expect(result.history.map((row) => row.id)).not.toContain(reversal.id);
    expect(
      (await query('SELECT status FROM categorization_memories WHERE organization_id=$1', [org]))[0].status,
    ).toBe('REVOKED');
  });

  it('revokes an archived-account example and does not resurrect it after unarchiving', async () => {
    await corrected();
    await query('UPDATE accounts SET archived=true WHERE organization_id=$1 AND id=$2', [org, ids['5020']]);
    expect((await context()).corrections).toEqual([]);
    expect((await context()).history).toEqual([]);
    await query('UPDATE accounts SET archived=false WHERE organization_id=$1 AND id=$2', [org, ids['5020']]);
    expect((await context()).corrections).toEqual([]);
    expect((await context()).history).toEqual([]);
  });

  it('supports explicit revocation without resurrecting it on an idempotent post', async () => {
    const { posted } = await corrected();
    const memoryId = posted.categorizationLearning.memoryId!;
    expect(await revokeCorrection(org, memoryId)).toEqual({ revoked: true });
    expect(await revokeCorrection(org, memoryId)).toEqual({ revoked: true });
    expect((await postEntry(org, posted.id)).categorizationLearning.status).toBe('REVOKED');
    expect((await context()).corrections).toEqual([]);
    expect((await context()).history).toEqual([]);
    expect((await getEntry(org, posted.id)).status).toBe('POSTED');
  });

  it('isolates actual competing workspace corrections, proposals and history', async () => {
    const originalOrg = org;
    const originalIds = ids;
    const first = await corrected();
    org = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Other correction workspace')", [org]);
    await seedChart(org);
    ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
    const other = await corrected('5010');
    await expect(
      createEntry(org, entry('5020'), randomUUID(), { proposalId: first.proposalId }),
    ).rejects.toMatchObject({ code: 'PROPOSAL_NOT_FOUND' });
    await expect(revokeCorrection(org, first.posted.categorizationLearning.memoryId!)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await context()).corrections.map((row) => row.entryId)).toEqual([other.posted.id]);
    org = originalOrg;
    ids = originalIds;
    const isolated = await context();
    expect(isolated.corrections.map((row) => row.entryId)).toEqual([first.posted.id]);
    expect(isolated.history.map((row) => row.id)).toEqual([first.posted.id]);
  });

  it('can replace a draft proposal before posting and learns only from the latest bound proposal', async () => {
    const oldProposal = await recordProposal(org, entry());
    const draft = await createEntry(org, entry('5010'), randomUUID(), { proposalId: oldProposal });
    const newProposal = await recordProposal(org, entry('5020'));
    const reviewed = await updateDraft(org, draft.id, entry('5020'), draft.revision, newProposal);
    expect((await postEntry(org, draft.id, reviewed.revision)).categorizationLearning.status).toBe(
      'NO_ACCOUNT_CHANGE',
    );
    expect(
      (await query('SELECT bound_entry_id FROM ai_entry_proposals WHERE id=$1', [oldProposal]))[0]
        .bound_entry_id,
    ).toBeNull();
  });
});
