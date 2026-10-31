import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { accounts, createEntry, postEntry, updateDraft } from '../server/ledger';
import { getCategorizationContext, revokeCorrection } from '../server/categorization-memory';
import { suggestCategory } from '../server/category-service';
import { createApp } from '../server/app';
import { seedChart } from '../scripts/seed';

const admin = new pg.Client({ connectionString: config.migrationUrl });
const saved = { categoryProvider: config.categoryProvider, categoryKey: config.categoryKey };
let org: string, ids: Record<string, string>;
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
      throw new Error('Category service tests require a disposable local/CI PostgreSQL database.');
  }
  await admin.connect();
});
beforeEach(async () => {
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Category service test')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((a) => [a.code, a.id]));
  config.categoryProvider = 'reference';
  config.categoryKey = '';
});
afterAll(async () => {
  Object.assign(config, saved);
  await admin.end();
  await pool.end();
});
const facts = () => ({
  description: 'Office supplies paper order',
  counterparty: 'Paper Shop',
  direction: 'OUT',
  amount: '340',
  date: '2026-10-31',
  currency: 'USD',
  exchangeRate: '1',
  fundingAccountId: ids['2100'],
  purpose: 'BUSINESS',
  structure: 'SINGLE',
});
describe('category service with real PostgreSQL and no live model', () => {
  it('returns a validated server proposal, leaves journals empty, then learns the reviewed correction atomically', async () => {
    const response = await request(createApp(org)).post('/api/ai/category').send(facts());
    expect(response.status).toBe(200);
    const result = response.body;
    expect(result).toMatchObject({ decision: 'SELECT', accountId: ids['5030'], entry: { source: 'AI' } });
    expect(result.proposalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).toEqual([]);
    expect(await query('SELECT id FROM ai_entry_proposals WHERE organization_id=$1', [org])).toEqual([
      { id: result.proposalId },
    ]);
    const corrected = {
      ...result.entry,
      lines: result.entry.lines.map((line: { accountId: string }) => ({
        ...line,
        accountId: line.accountId === ids['5030'] ? ids['5020'] : line.accountId,
      })),
    };
    const posted = await createEntry(org, corrected, randomUUID(), {
      proposalId: result.proposalId,
      post: true,
    });
    expect(posted.categorizationLearning?.status).toBe('LEARNED');
    const next = await suggestCategory(org, facts());
    expect(next).toMatchObject({ decision: 'SELECT', accountId: ids['5020'], basis: 'correction' });
    await revokeCorrection(org, posted.categorizationLearning!.memoryId!);
    expect((await getCategorizationContext(org, facts().description)).corrections).toEqual([]);
    expect(await suggestCategory(org, facts())).toMatchObject({
      decision: 'SELECT',
      accountId: ids['5030'],
      basis: 'label_rule',
    });
  });
  it('can atomically discard a saved category binding after a failed posting and changed facts', async () => {
    const result = await suggestCategory(org, facts());
    if (result.decision !== 'SELECT') throw new Error('Expected selector proposal');
    const draft = await createEntry(org, result.entry, randomUUID(), { proposalId: result.proposalId });
    const unbalanced = {
      ...result.entry,
      description: 'Changed transaction facts',
      lines: result.entry.lines.map((line, index) => (index === 0 ? { ...line, debit: '350' } : line)),
    };
    const revised = await updateDraft(org, draft.id, unbalanced, draft.revision);
    await expect(postEntry(org, draft.id, revised.revision)).rejects.toMatchObject({
      code: 'UNBALANCED_ENTRY',
    });
    await expect(
      updateDraft(org, draft.id, result.entry, revised.revision, result.proposalId, true),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      updateDraft(
        org,
        draft.id,
        {
          ...result.entry,
          lines: result.entry.lines.map((line, index) =>
            index === 0 ? { ...line, accountId: randomUUID() } : line,
          ),
        },
        revised.revision,
        undefined,
        true,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ACCOUNT' });
    expect(
      await query('SELECT id FROM ai_entry_proposals WHERE organization_id=$1 AND bound_entry_id=$2', [
        org,
        draft.id,
      ]),
    ).toEqual([{ id: result.proposalId }]);
    const cleared = await updateDraft(
      org,
      draft.id,
      { ...result.entry, description: 'New independent transaction' },
      revised.revision,
      undefined,
      true,
    );
    expect(
      await query('SELECT id FROM ai_entry_proposals WHERE organization_id=$1 AND bound_entry_id=$2', [
        org,
        draft.id,
      ]),
    ).toEqual([]);
    const posted = await postEntry(org, draft.id, cleared.revision);
    expect(posted.categorizationLearning?.status).toBe('NOT_APPLICABLE');
    expect(
      await query('SELECT id FROM categorization_memories WHERE organization_id=$1 AND entry_id=$2', [
        org,
        draft.id,
      ]),
    ).toEqual([]);
    await expect(
      updateDraft(org, draft.id, result.entry, posted.revision, undefined, true),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_ENTRY' });
  });
  it('rejects client charts and providers, and has separate category availability', async () => {
    const app = createApp(org);
    for (const extra of [{ accounts: [] }, { provider: 'jev' }, { organizationId: randomUUID() }]) {
      const response = await request(app)
        .post('/api/ai/category')
        .send({ ...facts(), ...extra });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_INPUT');
      expect(response.headers['x-request-id']).toBe(response.body.error.requestId);
    }
    const meta = await request(app).get('/api/meta');
    expect(meta.body.category).toMatchObject({ available: true, provider: 'reference' });
    expect(await query('SELECT id FROM ai_entry_proposals WHERE organization_id=$1', [org])).toEqual([]);
  });
  it('asks about missing funding or personal purpose without a proposal or journal', async () => {
    expect(await suggestCategory(org, { ...facts(), fundingAccountId: null })).toMatchObject({
      decision: 'CLARIFY',
      topic: 'funding_account',
    });
    expect(await suggestCategory(org, { ...facts(), purpose: null })).toMatchObject({
      decision: 'CLARIFY',
      topic: 'purpose',
    });
    expect(await suggestCategory(org, { ...facts(), purpose: 'LOAN' })).toMatchObject({
      decision: 'UNSUPPORTED',
    });
    expect(await query('SELECT id FROM ai_entry_proposals WHERE organization_id=$1', [org])).toEqual([]);
    expect(await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).toEqual([]);
  });
  it('never exposes another organization chart to the provider or accepts its account', async () => {
    const foreignOrg = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Foreign category test')", [foreignOrg]);
    await seedChart(foreignOrg);
    const foreign = (await accounts(foreignOrg)).find((a) => a.code === '5030')!;
    let calls = 0;
    await expect(
      suggestCategory(org, facts(), {
        provider: 'gemini',
        apiKey: 'synthetic',
        transport: async (req) => {
          calls++;
          expect(req.body).not.toContain(foreign.id);
          expect(req.body).not.toContain(foreignOrg);
          return {
            status: 200,
            body: {
              candidates: [
                {
                  finishReason: 'STOP',
                  content: {
                    parts: [
                      { text: JSON.stringify({ choice: `account_${foreign.id.replaceAll('-', '')}` }) },
                    ],
                  },
                },
              ],
            },
          };
        },
      }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(calls).toBe(1);
    expect(await query('SELECT id FROM ai_entry_proposals WHERE organization_id=$1', [org])).toEqual([]);
  });
  it('rechecks an account archived while selection was running before recording a proposal', async () => {
    await expect(
      suggestCategory(org, facts(), {
        provider: 'gemini',
        apiKey: 'synthetic',
        transport: async () => {
          await query('UPDATE accounts SET archived=true WHERE organization_id=$1 AND id=$2', [
            org,
            ids['5030'],
          ]);
          return {
            status: 200,
            body: {
              candidates: [
                {
                  finishReason: 'STOP',
                  content: {
                    parts: [
                      { text: JSON.stringify({ choice: `account_${ids['5030'].replaceAll('-', '')}` }) },
                    ],
                  },
                },
              ],
            },
          };
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ACCOUNT' });
    expect(await query('SELECT id FROM ai_entry_proposals WHERE organization_id=$1', [org])).toEqual([]);
  });
});
