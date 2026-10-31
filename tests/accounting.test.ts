import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { seedChart } from '../scripts/seed';
import {
  accounts,
  createEntry,
  getEntry,
  postEntry,
  reverseEntry,
  updateDraft,
  listEntries,
} from '../server/ledger';
import { balanceSheet, incomeStatement, trialBalance, accountLedger, cashPosition } from '../server/reports';
import { createRecurring, generateRecurring, nextOccurrence, updateRecurring } from '../server/recurring';
import { analyzeEntry, processJobs } from '../server/anomalies';
import { runInsightTool } from '../server/ai';
import { createApp } from '../server/app';
import { Decimal, formatCurrency } from '../shared/money';
import type { EntryInput } from '../shared/schema';

const admin = new pg.Client({ connectionString: config.migrationUrl });
let org: string, ids: Record<string, string>;
beforeAll(() => admin.connect());
beforeEach(async () => {
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Isolated accounting test')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((a) => [a.code, a.id]));
});
afterAll(async () => {
  await admin.end();
  await pool.end();
});
const input = (debit = '5010', credit = '1010', amount = '2400', date = '2026-03-04'): EntryInput => ({
  date,
  description: 'Test transaction',
  counterparty: 'Test merchant',
  reference: '',
  source: 'MANUAL',
  lines: [
    { accountId: ids[debit], debit: amount, credit: '0', exchangeRate: '1', memo: '' },
    { accountId: ids[credit], debit: '0', credit: amount, exchangeRate: '1', memo: '' },
  ],
});
async function post(debit: string, credit: string, amount: string, date: string) {
  return createEntry(org, input(debit, credit, amount, date), randomUUID(), { post: true });
}
async function walkthrough() {
  await post('1010', '3010', '10000', '2026-03-01');
  await post('1100', '4010', '15000', '2026-03-02');
  await post('1010', '1100', '15000', '2026-03-03');
  await post('5010', '1010', '2400', '2026-03-04');
  await post('5030', '2100', '340', '2026-03-05');
}

describe('PostgreSQL financial invariants', () => {
  it('rejects an unbalanced direct SQL posting, retaining the original draft', async () => {
    const p = input();
    p.lines[1].credit = '2399.99';
    const e = await createEntry(org, p, randomUUID());
    await expect(
      query("UPDATE journal_entries SET status='POSTED',posted_at=now() WHERE id=$1", [e.id]),
    ).rejects.toThrow('equal base-currency');
    expect((await getEntry(org, e.id)).status).toBe('DRAFT');
  });
  it('rejects a directly inserted posted entry with no lines', async () => {
    await expect(
      query(
        "INSERT INTO journal_entries(organization_id,date,description,status,posted_at) VALUES($1,'2026-03-01','Empty posted entry','POSTED',now())",
        [org],
      ),
    ).rejects.toThrow('2 to 100 lines');
  });
  it('blocks changing or deleting posted headers and inserting, updating or deleting their lines', async () => {
    const e = await createEntry(org, input(), randomUUID(), { post: true });
    await expect(
      query("UPDATE journal_entries SET description='Changed' WHERE id=$1", [e.id]),
    ).rejects.toThrow('immutable');
    await expect(query('DELETE FROM journal_entries WHERE id=$1', [e.id])).rejects.toThrow('immutable');
    await expect(query("UPDATE journal_lines SET memo='Changed' WHERE entry_id=$1", [e.id])).rejects.toThrow(
      'immutable',
    );
    await expect(query('DELETE FROM journal_lines WHERE entry_id=$1', [e.id])).rejects.toThrow('immutable');
    await expect(
      query(
        "INSERT INTO journal_lines(organization_id,entry_id,account_id,position,currency,debit,credit) VALUES($1,$2,$3,9,'USD',1,0)",
        [org, e.id, ids['1010']],
      ),
    ).rejects.toThrow('immutable');
  });
  it('rejects both-sided, zero and over-precision lines in PostgreSQL', async () => {
    const e = await createEntry(org, input(), randomUUID());
    for (const [debit, credit] of [
      ['1', '1'],
      ['0', '0'],
      ['1.001', '0'],
    ])
      await expect(
        query('UPDATE journal_lines SET debit=$2,credit=$3 WHERE id=$1', [e.lines[0].id, debit, credit]),
      ).rejects.toThrow();
  });
  it('preserves exact decimal math and forbids reclassifying a used account', async () => {
    await post('5010', '1010', '0.10', '2026-03-01');
    await post('5010', '1010', '0.20', '2026-03-02');
    const rent = (await accounts(org)).find((a) => a.code === '5010')!;
    expect(new Decimal(rent.balance).equals('0.30')).toBe(true);
    await expect(query("UPDATE accounts SET type='ASSET' WHERE id=$1", [rent.id])).rejects.toThrow(
      'cannot change',
    );
  });
  it('rejects cross-organization references', async () => {
    const second = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Other tenant')", [second]);
    await seedChart(second);
    const foreign = (await accounts(second)).find((a) => a.code === '1010')!;
    const p = input();
    p.lines[1].accountId = foreign.id;
    await expect(createEntry(org, p, randomUUID())).rejects.toThrow('active posting account');
    const draft = await createEntry(org, input(), randomUUID());
    await expect(
      query('UPDATE journal_lines SET account_id=$2 WHERE id=$1', [draft.lines[0].id, foreign.id]),
    ).rejects.toThrow();
  });
  it('prevents account tree cycles and posting into groups', async () => {
    const parent = (await accounts(org)).find((a) => a.code === '5000')!;
    await expect(query('UPDATE accounts SET parent_id=id WHERE id=$1', [parent.id])).rejects.toThrow('cycle');
    await expect(createEntry(org, input('5000'), randomUUID())).rejects.toThrow('posting account');
  });
  it('uses a runtime role without superuser or schema privileges', async () => {
    const role = (await query('SELECT rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user'))[0];
    expect(role.rolsuper).toBe(false);
    expect(role.rolcreaterole).toBe(false);
    await expect(query('TRUNCATE journal_lines')).rejects.toThrow('permission denied');
  });
});

describe('Concurrency, retries and reversal', () => {
  it('creates exactly one entry for concurrent identical request keys', async () => {
    const key = randomUUID(),
      p = input();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => createEntry(org, p, key, { post: true })),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect((await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).length).toBe(1);
    await expect(
      createEntry(org, { ...p, description: 'Different payload' }, key, { post: true }),
    ).rejects.toThrow('different contents');
  });
  it('cannot race a line edit past a posting transaction', async () => {
    const e = await createEntry(org, input(), randomUUID());
    const a = await pool.connect(),
      b = await pool.connect();
    try {
      await a.query('BEGIN');
      await a.query('SELECT id FROM journal_entries WHERE id=$1 FOR UPDATE', [e.id]);
      await b.query('BEGIN');
      const pending = b
        .query("UPDATE journal_lines SET memo='Racing edit' WHERE id=$1", [e.lines[0].id])
        .then(
          () => null,
          (error) => error,
        );
      await a.query("UPDATE journal_entries SET status='POSTED',posted_at=now() WHERE id=$1", [e.id]);
      await a.query('COMMIT');
      expect((await pending)?.message).toContain('immutable');
      await b.query('ROLLBACK');
      expect((await getEntry(org, e.id)).lines[0].memo).toBe('');
    } finally {
      await a.query('ROLLBACK');
      await b.query('ROLLBACK');
      a.release();
      b.release();
    }
  });
  it('reverses every original amount and preserves both posted records', async () => {
    const e = await createEntry(org, input(), randomUUID(), { post: true });
    const r = await reverseEntry(org, e.id, '2026-03-06', randomUUID());
    expect(r.reverses_entry_id).toBe(e.id);
    expect((await getEntry(org, e.id)).reversal_id).toBe(r.id);
    expect((await incomeStatement(org, '2026-03-01', '2026-03-31')).netIncome).toBe('0.00');
    expect((await incomeStatement(org, '2026-03-01', '2026-03-05')).netIncome).toBe('-2400.00');
    await expect(reverseEntry(org, e.id, '2026-03-07', randomUUID())).rejects.toThrow();
  });
  it('queues analysis in the same transaction and makes post retries harmless', async () => {
    const draft = await createEntry(org, input(), randomUUID());
    expect((await query('SELECT id FROM jobs WHERE entry_id=$1', [draft.id])).length).toBe(0);
    await Promise.all([postEntry(org, draft.id), postEntry(org, draft.id)]);
    expect((await query('SELECT id FROM jobs WHERE entry_id=$1', [draft.id])).length).toBe(1);
  });
  it('rejects stale edits and stale posting confirmations', async () => {
    const draft = await createEntry(org, input(), randomUUID());
    const changed = await updateDraft(
      org,
      draft.id,
      { ...input(), description: 'Reviewed change' },
      draft.revision,
    );
    expect(changed.revision).toBeGreaterThan(draft.revision);
    await expect(updateDraft(org, draft.id, input(), draft.revision)).rejects.toThrow('another session');
    await expect(postEntry(org, draft.id, draft.revision)).rejects.toThrow('after you opened');
    expect((await getEntry(org, draft.id)).status).toBe('DRAFT');
    expect((await postEntry(org, draft.id, changed.revision)).status).toBe('POSTED');
  });
});

describe('Financial reports from the worked example', () => {
  beforeEach(walkthrough);
  it('reconciles all four reports and includes profit in balance sheet equity', async () => {
    const trial = await trialBalance(org, '2026-03-01', '2026-03-31');
    expect(trial.totalDebits).toBe('25340.00');
    expect(trial.totalCredits).toBe('25340.00');
    expect(trial.balanced).toBe(true);
    const income = await incomeStatement(org, '2026-03-01', '2026-03-31');
    expect(income.totalRevenue).toBe('15000.00');
    expect(income.totalExpenses).toBe('2740.00');
    expect(income.netIncome).toBe('12260.00');
    const balance = await balanceSheet(org, '2026-03-31');
    expect(balance.totalAssets).toBe('22600.00');
    expect(balance.totalLiabilities).toBe('340.00');
    expect(balance.totalEquity).toBe('22260.00');
    expect(balance.balanced).toBe(true);
    const ledger = await accountLedger(org, ids['1010'], '2026-03-04', '2026-03-31');
    expect(new Decimal(ledger.opening).eq(25000)).toBe(true);
    expect(new Decimal(ledger.items[0].running_balance).eq(22600)).toBe(true);
  });
  it('excludes drafts, respects as-of dates, and carries prior earnings into the next year', async () => {
    await createEntry(org, input('5010', '1010', '999999'), randomUUID());
    expect((await cashPosition(org, '2026-03-02')).total).toBe('10000.00');
    expect((await balanceSheet(org, '2027-01-01')).totalEquity).toBe('22260.00');
    expect((await incomeStatement(org, '2026-04-01', '2026-04-30')).netIncome).toBe('0.00');
  });
  it('answers an insight with SQL totals rather than model-generated numbers', async () => {
    const cash = await runInsightTool(org, 'cash_position', { asOf: '2026-03-31' });
    expect(cash.answer).toContain('$22,600.00');
    const expenses = await runInsightTool(org, 'expense_summary', { from: '2026-03-01', to: '2026-03-31' });
    expect(expenses.answer).toContain('$2,740.00');
    expect(expenses.evidence.rows[0].label).toBe('Rent');
    const comparison = await runInsightTool(org, 'revenue_comparison', {
      from: '2026-03-01',
      to: '2026-03-31',
      previousFrom: '2026-02-01',
      previousTo: '2026-02-28',
    });
    expect(comparison.answer).toContain('zero or negative');
  });
});

describe('Foreign currency and recurring drafts', () => {
  it('rejects fractional yen in both application and direct SQL, preserving whole-yen conversion', async () => {
    const yen = (
      await query<{ id: string }>(
        "INSERT INTO accounts(organization_id,code,name,type,currency,is_cash) VALUES($1,'1030','Yen bank','ASSET','JPY',true) RETURNING id",
        [org],
      )
    )[0].id;
    const p = input('1020', '4010', '100');
    p.lines[0] = { ...p.lines[0], accountId: yen, debit: '100.5', exchangeRate: '0.0067' };
    p.lines[1].credit = '0.67';
    await expect(createEntry(org, p, randomUUID())).rejects.toMatchObject({ code: 'CURRENCY_PRECISION' });
    p.lines[0].debit = '100';
    const draft = await createEntry(org, p, randomUUID());
    await expect(
      query('UPDATE journal_lines SET debit=100.5 WHERE id=$1', [draft.lines[0].id]),
    ).rejects.toThrow('decimal places');
    const posted = await postEntry(org, draft.id, draft.revision);
    expect(posted.lines[0].base_debit).toBe('0.67');
    const bank = (await accounts(org)).find((a) => a.id === yen)!;
    expect(new Decimal(bank.native_balance).eq('100')).toBe(true);
    expect(new Decimal(bank.balance).eq('0.67')).toBe(true);
    await reverseEntry(org, posted.id, '2026-03-05', randomUUID());
    expect((await balanceSheet(org, '2026-03-31')).totalAssets).toBe('0.00');
  });
  it('rounds each stored FX line before summing and rejects aggregate-rounding imbalance', async () => {
    const p = input('1020', '4010', '0.01');
    p.lines[0].exchangeRate = '1.5';
    p.lines.splice(1, 0, { ...p.lines[0] });
    // EUR .01 × 1.5 = USD .015, stored as .02 for each line.
    // Rounding the EUR .02 aggregate would give .03, which must not balance .04.
    p.lines[2].credit = '0.03';
    await expect(createEntry(org, p, randomUUID(), { post: true })).rejects.toMatchObject({
      code: 'UNBALANCED_ENTRY',
    });
    expect(await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).toEqual([]);
    p.lines[2].credit = '0.04';
    const posted = await createEntry(org, p, randomUUID(), { post: true });
    expect(posted.lines.map((l) => l.base_debit)).toEqual(['0.02', '0.02', '0.00']);
    const trial = await trialBalance(org, '2026-03-01', '2026-03-31');
    expect(trial.totalDebits).toBe('0.04');
    expect(trial.totalCredits).toBe('0.04');
    expect((await incomeStatement(org, '2026-03-01', '2026-03-31')).totalRevenue).toBe('0.04');
    await reverseEntry(org, posted.id, '2026-03-05', randomUUID());
    expect((await balanceSheet(org, '2026-03-31')).totalAssets).toBe('0.00');
  });
  it('balances mixed currency lines in USD and reverses at the original rate', async () => {
    const p = input('1020', '4010', '100');
    p.lines[0].exchangeRate = '1.1';
    p.lines[1].credit = '110';
    const e = await createEntry(org, p, randomUUID(), { post: true });
    expect(new Decimal(e.total).eq(110)).toBe(true);
    const euro = (await accounts(org)).find((a) => a.code === '1020')!;
    expect(new Decimal(euro.native_balance).eq(100)).toBe(true);
    await reverseEntry(org, e.id, '2026-03-06', randomUUID());
    expect((await balanceSheet(org, '2026-03-31')).totalAssets).toBe('0.00');
  });
  it('retains month-end and leap-day anchors', () => {
    expect(nextOccurrence('2026-01-31', '2026-01-31', 'MONTHLY')).toBe('2026-02-28');
    expect(nextOccurrence('2026-02-28', '2026-01-31', 'MONTHLY')).toBe('2026-03-31');
    expect(nextOccurrence('2027-02-28', '2024-02-29', 'YEARLY')).toBe('2028-02-29');
  });
  it('catches up schedules exactly once, including simultaneous worker runs', async () => {
    await createRecurring(org, {
      name: 'Rent',
      description: 'Rent',
      counterparty: 'Landlord',
      frequency: 'MONTHLY',
      anchorDate: '2026-01-31',
      endDate: null,
      lines: input().lines,
    });
    await Promise.all([generateRecurring(org, '2026-03-31'), generateRecurring(org, '2026-03-31')]);
    await generateRecurring(org, '2026-03-31');
    const entries = await query(
      'SELECT date,status FROM journal_entries WHERE organization_id=$1 ORDER BY date',
      [org],
    );
    expect(entries.map((e) => e.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(entries.every((e) => e.status === 'DRAFT')).toBe(true);
    expect((await trialBalance(org, '2026-01-01', '2026-03-31')).totalDebits).toBe('0.00');
  });
});

describe('Anomalies and API failure behavior', () => {
  it('flags a doubled recurring expense using evidence and keeps dismissals on reanalysis', async () => {
    for (const month of ['01', '02', '03', '04']) await post('5010', '1010', '1000', `2026-${month}-01`);
    const e = await post('5010', '1010', '2000', '2026-05-01');
    await analyzeEntry(org, e.id);
    const alerts = await query('SELECT * FROM alerts WHERE entry_id=$1', [e.id]);
    expect(alerts[0].evidence.median).toBe('1000.00');
    expect(alerts[0].evidence.sampleCount).toBe(4);
    await query("UPDATE alerts SET status='DISMISSED' WHERE id=$1", [alerts[0].id]);
    await analyzeEntry(org, e.id);
    expect((await query('SELECT status FROM alerts WHERE id=$1', [alerts[0].id]))[0].status).toBe(
      'DISMISSED',
    );
  });
  it('flags likely duplicate transactions without silently deleting either', async () => {
    await post('5020', '2100', '89', '2026-03-01');
    const second = await post('5020', '2100', '89', '2026-03-02');
    await analyzeEntry(org, second.id);
    expect(
      (await query("SELECT * FROM alerts WHERE entry_id=$1 AND rule='POSSIBLE_DUPLICATE'", [second.id]))
        .length,
    ).toBe(1);
    expect((await query('SELECT id FROM journal_entries WHERE organization_id=$1', [org])).length).toBe(2);
  });
  it('returns useful validation errors, unavailable AI, and a working manual path', async () => {
    const app = createApp(org);
    const malformed = await request(app)
      .post('/api/entries')
      .set('Content-Type', 'application/json')
      .send('{broken');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    expect(malformed.body.error.requestId).toBe(malformed.headers['x-request-id']);
    const bad = await request(app)
      .post('/api/entries')
      .set('Idempotency-Key', randomUUID())
      .send({ description: 'Missing fields' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_INPUT');
    const created = await request(app)
      .post('/api/entries')
      .set('Idempotency-Key', randomUUID())
      .send(input());
    expect(created.status).toBe(201);
    const posted = await request(app)
      .post(`/api/entries/${created.body.id}/post`)
      .send({ expectedRevision: created.body.revision });
    expect(posted.status).toBe(200);
    const remove = await request(app).delete(`/api/accounts/${ids['5010']}`);
    expect(remove.status).toBe(409);
    if (!config.aiKey) {
      const ai = await request(app)
        .post('/api/ai/chat')
        .send({ messages: [{ role: 'user', content: 'Cash position?' }] });
      expect(ai.status).toBe(503);
      expect(ai.body.error.code).toBe('AI_NOT_CONFIGURED');
    }
  });
});

describe('Recovery and boundary cases', () => {
  it('formats large balances without dropping cents through floating point', () => {
    expect(formatCurrency('99999999999999.99')).toBe('$99,999,999,999,999.99');
    expect(formatCurrency('-0.01')).toBe('-$0.01');
    expect(formatCurrency('1000', 'JPY')).toBe('¥1,000');
  });
  it('isolates a broken recurring template and allows correction before resuming', async () => {
    const schedule = {
      name: 'Broken rent',
      description: 'Rent',
      counterparty: 'Landlord',
      frequency: 'MONTHLY' as const,
      anchorDate: '2026-01-31',
      endDate: null,
      lines: input().lines,
    };
    const broken = await createRecurring(org, schedule);
    await createRecurring(org, { ...schedule, name: 'Healthy supplies', lines: input('5030').lines });
    await query('UPDATE accounts SET archived=true WHERE id=$1', [ids['5010']]);
    const result = await generateRecurring(org, '2026-02-28');
    expect(result).toEqual({ generated: 2, failed: 1 });
    const paused = (await query('SELECT * FROM recurring_templates WHERE id=$1', [broken.id]))[0];
    expect(paused.active).toBe(false);
    expect(paused.next_date).toBe('2026-01-31');
    expect(paused.last_error).toContain('active posting account');
    expect(
      (await query('SELECT id FROM journal_entries WHERE recurring_template_id=$1', [broken.id])).length,
    ).toBe(0);
    await query('UPDATE accounts SET archived=false WHERE id=$1', [ids['5010']]);
    await updateRecurring(
      org,
      broken.id,
      { ...schedule, lines: input('5010', '1010', '2500').lines },
      paused.revision,
    );
    await query('UPDATE recurring_templates SET active=true WHERE id=$1', [broken.id]);
    expect(await generateRecurring(org, '2026-02-28')).toEqual({ generated: 2, failed: 0 });
  });
  it('makes template creation retry-safe and keeps existing occurrence amounts on edit', async () => {
    const schedule = {
        name: 'Rent',
        description: 'Rent',
        counterparty: 'Landlord',
        frequency: 'MONTHLY' as const,
        anchorDate: '2026-01-31',
        endDate: null,
        lines: input().lines,
      },
      key = randomUUID();
    const [first, retry] = await Promise.all([
      createRecurring(org, schedule, key),
      createRecurring(org, schedule, key),
    ]);
    expect(first.id).toBe(retry.id);
    await generateRecurring(org, '2026-01-31');
    const current = (await query('SELECT * FROM recurring_templates WHERE id=$1', [first.id]))[0];
    await expect(updateRecurring(org, first.id, schedule, first.revision)).rejects.toThrow(
      'schedule changed',
    );
    await updateRecurring(
      org,
      first.id,
      { ...schedule, lines: input('5010', '1010', '3000').lines },
      current.revision,
    );
    await generateRecurring(org, '2026-02-28');
    const occurrences = await listEntries(org, { limit: 10 });
    expect(occurrences.items.map((e) => new Decimal(e.total).toFixed(2))).toEqual(['3000.00', '2400.00']);
  });
  it('paginates equal-date entries and preserves account running balances across pages', async () => {
    for (let i = 0; i < 55; i++) await post('1010', '3010', '0.10', '2026-03-01');
    const page1 = await listEntries(org, { limit: 25 }),
      page2 = await listEntries(org, { limit: 25, cursor: page1.nextCursor! }),
      page3 = await listEntries(org, { limit: 25, cursor: page2.nextCursor! });
    expect(new Set([...page1.items, ...page2.items, ...page3.items].map((e) => e.id)).size).toBe(55);
    expect(page3.nextCursor).toBeNull();
    const ledger1 = await accountLedger(org, ids['1010'], '2026-03-01', '2026-03-31');
    const ledger2 = await accountLedger(org, ids['1010'], '2026-03-01', '2026-03-31', ledger1.nextCursor!);
    expect(new Decimal(ledger1.items.at(-1)!.running_balance).toFixed(2)).toBe('5.00');
    expect(new Decimal(ledger2.items[0].running_balance).toFixed(2)).toBe('5.10');
    expect(new Decimal(ledger2.closing).toFixed(2)).toBe('5.50');
    const badCursor = Buffer.from(JSON.stringify(['2026-02-31', 'invalid', 'invalid'])).toString('base64url');
    expect(
      (await request(createApp(org)).get(`/api/accounts/${ids['1010']}/ledger`).query({ cursor: badCursor }))
        .status,
    ).toBe(400);
    expect((await request(createApp(org)).get('/api/entries').query({ cursor: badCursor })).status).toBe(400);
  });
  it('accepts historical balance-sheet as-of dates without imposing a current-month start', async () => {
    await walkthrough();
    const response = await request(createApp(org)).get('/api/reports/balance').query({ to: '2026-03-31' });
    expect(response.status).toBe(200);
    expect(response.body.totalAssets).toBe('22600.00');
  });
  it('requires explicit rate review for each foreign-currency recurring draft', async () => {
    const lines = input('1020', '4010', '100').lines;
    lines[0].exchangeRate = '1.1';
    lines[1].credit = '110';
    await createRecurring(org, {
      name: 'EUR consulting',
      description: 'Consultation',
      counterparty: 'Atelier',
      frequency: 'MONTHLY',
      anchorDate: '2026-03-01',
      endDate: null,
      lines,
    });
    await generateRecurring(org, '2026-03-01');
    const e = (await listEntries(org)).items[0],
      app = createApp(org);
    expect(
      (await request(app).post(`/api/entries/${e.id}/post`).send({ expectedRevision: e.revision })).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post(`/api/entries/${e.id}/post`)
          .send({ expectedRevision: e.revision, exchangeRatesConfirmed: true })
      ).status,
    ).toBe(200);
  });
  it('reclaims an expired analysis lease and stops retries after the final crashed attempt', async () => {
    const e = await createEntry(org, input(), randomUUID(), { post: true });
    await query(
      "UPDATE jobs SET status='RUNNING',attempts=1,locked_at=now()-interval '5 minutes' WHERE entry_id=$1",
      [e.id],
    );
    await processJobs(org);
    expect((await query('SELECT status FROM jobs WHERE entry_id=$1', [e.id]))[0].status).toBe('DONE');
    await query(
      "UPDATE jobs SET status='RUNNING',attempts=5,locked_at=now()-interval '5 minutes' WHERE entry_id=$1",
      [e.id],
    );
    await processJobs(org);
    expect((await query('SELECT status FROM jobs WHERE entry_id=$1', [e.id]))[0].status).toBe('FAILED');
  });
});
