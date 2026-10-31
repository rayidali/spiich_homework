import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { createEntry, getEntry } from '../server/ledger';
import { getCategorizationContext, recordProposal, revokeCorrection } from '../server/categorization-memory';
import { AppError } from '../server/errors';
import { evaluationCases, FIXTURE_VERSION, pair } from '../scripts/evaluation/cases';
import {
  assertEvaluationContextScope,
  createEvaluationFixture,
  journalFingerprint,
  resolveLines,
  withUnchangedEvaluationJournal,
} from '../scripts/evaluation/fixtures';
import type { EntryInput } from '../shared/schema';

let fixture: Awaited<ReturnType<typeof createEvaluationFixture>>;
beforeAll(async () => {
  // This suite exercises real PostgreSQL and real posting, never a provider.
  // Refuse a hosted URL even if a developer's .env contains one.
  for (const value of [config.databaseUrl, config.migrationUrl]) {
    const parsed = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    const compose =
      process.env.NODE_ENV === 'test' &&
      parsed.hostname === 'db' &&
      parsed.port === '5432' &&
      parsed.pathname === '/spiich';
    if (!local && !compose) throw new Error('Evaluation fixtures require disposable local/CI PostgreSQL.');
  }
  fixture = await createEvaluationFixture(`fixture-test-${randomUUID()}`, {
    correctionCases: evaluationCases.filter((c) => c.correction),
    repeats: 2,
  });
});
afterAll(async () => {
  await pool.end();
});

describe('Product evaluation V2 posted-correction fixtures', () => {
  it('preserves the original forty prompts, expected labels and split definitions', () => {
    expect(FIXTURE_VERSION).toBe('daybook-accounting-eval-v2-posted-corrections');
    expect(evaluationCases).toHaveLength(40);
    // Recorded before the fixture-path repair; it excludes the version constant.
    expect(createHash('sha256').update(JSON.stringify(evaluationCases)).digest('hex')).toBe(
      '0cd85c92897d1562978e4062954229ccfecabd602eedc63eb2e28207bcd3c44d',
    );
  });

  it('keeps financial gold independent of every teaching posting', async () => {
    const rows = await query<{ cash: string; expenses: string }>(
      `SELECT
      sum(CASE WHEN a.is_cash AND e.date<='2026-03-31' THEN l.base_debit-l.base_credit ELSE 0 END)::text cash,
      sum(CASE WHEN a.type='EXPENSE' AND e.date BETWEEN '2026-03-01' AND '2026-03-31'
        THEN l.base_debit-l.base_credit ELSE 0 END)::text expenses
      FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
      WHERE e.organization_id=$1 AND e.status='POSTED'`,
      [fixture.org],
    );
    expect(rows).toEqual([{ cash: '27377.00', expenses: '4020.00' }]);
    expect(
      await query('SELECT id FROM categorization_memories WHERE organization_id=$1', [fixture.org]),
    ).toEqual([]);
    expect(
      await query('SELECT id FROM categorization_feedback WHERE organization_id=ANY($1::uuid[])', [
        fixture.protectedOrganizations,
      ]),
    ).toEqual([]);
  });

  it('creates independent before/after pairs per case and repeat, with no correction leaking backwards', async () => {
    expect(fixture.learningPairs).toHaveLength(4);
    expect(new Set(fixture.protectedOrganizations).size).toBe(10);
    for (const p of fixture.learningPairs) {
      const item = evaluationCases.find((c) => c.id === p.caseId)!;
      const before = await getCategorizationContext(p.before.org, item.text);
      const after = await getCategorizationContext(p.after.org, item.text);
      expect(before.corrections).toEqual([]);
      expect(after.corrections.map((m) => m.id)).toEqual([p.teaching.memoryId]);
      expect(before.history.some((e) => e.id === p.teaching.entryId)).toBe(false);
      // Stored history and retrieved context are distinct. A short old-purpose
      // description can fall below the real trigram threshold for this long
      // question. Prove equal prior postings independently, then compare the
      // retrieved prior subset without forcing irrelevant records into context.
      const [storedBefore, storedAfter] = await Promise.all([
        query<{ id: string; source: string }>(
          "SELECT id,source FROM journal_entries WHERE organization_id=$1 AND status='POSTED'",
          [p.before.org],
        ),
        query<{ id: string; source: string }>(
          "SELECT id,source FROM journal_entries WHERE organization_id=$1 AND status='POSTED'",
          [p.after.org],
        ),
      ]);
      expect(storedBefore).toHaveLength(1);
      expect(storedBefore[0].source).toBe('MANUAL');
      expect(storedAfter).toHaveLength(2);
      expect(storedAfter.filter((e) => e.source === 'AI')).toEqual([
        { id: p.teaching.entryId, source: 'AI' },
      ]);
      const priorBefore = await getEntry(p.before.org, storedBefore[0].id);
      const priorAfter = await getEntry(p.after.org, storedAfter.find((e) => e.source === 'MANUAL')!.id);
      const posting = (entry: typeof priorBefore) => ({
        date: entry.date,
        description: entry.description,
        counterparty: entry.counterparty,
        lines: entry.lines.map((l) => ({
          code: l.account_code,
          debit: l.debit,
          credit: l.credit,
          rate: l.exchange_rate,
        })),
      });
      expect(posting(priorAfter)).toEqual(posting(priorBefore));
      expect(before.history.every((e) => storedBefore.some((stored) => stored.id === e.id))).toBe(true);
      expect(after.history.every((e) => storedAfter.some((stored) => stored.id === e.id))).toBe(true);
      const normalize = (rows: typeof before.history, codes: Record<string, string>) =>
        rows.map((row) => ({
          description: row.description,
          counterparty: row.counterparty,
          lines: row.lines.map((l) => ({
            code: codes[l.accountId],
            debit: l.debit,
            credit: l.credit,
            rate: l.exchangeRate,
          })),
        }));
      expect(
        normalize(
          after.history.filter((e) => e.id !== p.teaching.entryId),
          p.after.codesById,
        ),
      ).toEqual(normalize(before.history, p.before.codesById));
    }
  });

  it('binds every correction to a real wrong proposal and its exact reviewed posted revision', async () => {
    for (const p of fixture.learningPairs) {
      const rows = await query(
        `SELECT p.proposal,p.bound_entry_id,p.bound_revision,
        e.status,e.source,e.revision,m.status AS memory_status,m.entry_revision,m.proposal_id,m.corrected_lines
        FROM ai_entry_proposals p JOIN journal_entries e ON e.id=p.bound_entry_id
        JOIN categorization_memories m ON m.proposal_id=p.id
        WHERE p.organization_id=$1 AND p.id=$2`,
        [p.after.org, p.teaching.proposalId],
      );
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row).toMatchObject({
        bound_entry_id: p.teaching.entryId,
        status: 'POSTED',
        source: 'AI',
        memory_status: 'ACTIVE',
        proposal_id: p.teaching.proposalId,
      });
      expect(row.entry_revision).toBe(row.revision);
      expect(Number(row.bound_revision) + 1).toBe(row.revision);
      const proposed = row.proposal as EntryInput;
      const corrected = row.corrected_lines as EntryInput['lines'];
      expect(proposed.lines.map((l) => l.accountId)).not.toEqual(corrected.map((l) => l.accountId));
      expect((await getEntry(p.after.org, p.teaching.entryId)).lines).toHaveLength(2);
    }
  });

  it('uses a genuine foreign correction and rejects it and foreign history in the local context', async () => {
    const foreign = await getCategorizationContext(fixture.otherOrg, 'Nimbus handling');
    expect(foreign.corrections.map((m) => m.id)).toContain(fixture.foreignTeaching.memoryId);
    const own = await getCategorizationContext(fixture.org, 'Nimbus handling');
    expect(own.corrections).toEqual([]);
    await expect(
      assertEvaluationContextScope(fixture.otherOrg, {
        correctionIds: [fixture.foreignTeaching.memoryId],
        historyEntryIds: [fixture.foreignTeaching.entryId],
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertEvaluationContextScope(fixture.org, {
        correctionIds: [fixture.foreignTeaching.memoryId],
        historyEntryIds: [],
      }),
    ).rejects.toMatchObject({ code: 'EVALUATION_CONTEXT_SCOPE' });
    await expect(
      assertEvaluationContextScope(fixture.org, {
        correctionIds: [],
        historyEntryIds: [fixture.foreignTeaching.entryId],
      }),
    ).rejects.toMatchObject({ code: 'EVALUATION_CONTEXT_SCOPE' });
  });

  it('does not treat retired memory as a valid retrieved correction', async () => {
    const p = fixture.learningPairs[0];
    await revokeCorrection(p.after.org, p.teaching.memoryId);
    await expect(
      assertEvaluationContextScope(p.after.org, {
        correctionIds: [p.teaching.memoryId],
        historyEntryIds: [],
      }),
    ).rejects.toMatchObject({ code: 'EVALUATION_CONTEXT_SCOPE' });
  });

  const input = (): EntryInput => ({
    date: '2026-03-15',
    description: 'Guard test proposal',
    counterparty: '',
    reference: '',
    source: 'AI',
    lines: resolveLines(pair('5030', '2100', '15'), fixture.ids),
  });
  it('allows storing an unbound proposal but protects all financial history after fixture setup', async () => {
    const before = await journalFingerprint(fixture.protectedOrganizations);
    const proposalId = await withUnchangedEvaluationJournal(fixture.protectedOrganizations, () =>
      recordProposal(fixture.org, input()),
    );
    expect(proposalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await journalFingerprint(fixture.protectedOrganizations)).toBe(before);
    const ordinaryFailure = new AppError(502, 'AI_INVALID_RESPONSE', 'Synthetic contract failure.');
    await expect(
      withUnchangedEvaluationJournal(fixture.protectedOrganizations, async () => {
        throw ordinaryFailure;
      }),
    ).rejects.toBe(ordinaryFailure);
  });

  it.each([false, true])(
    'detects a forbidden financial write even when the invocation throws: %s',
    async (throws) => {
      const p = fixture.learningPairs.at(-1)!;
      const originalTeaching = await getEntry(p.after.org, p.teaching.entryId);
      await expect(
        withUnchangedEvaluationJournal(fixture.protectedOrganizations, async () => {
          await createEntry(fixture.org, input(), randomUUID());
          if (throws)
            throw new AppError(502, 'AI_INVALID_RESPONSE', 'Synthetic failure after forbidden write.');
          return 'not allowed';
        }),
      ).rejects.toMatchObject({ code: 'EVALUATION_JOURNAL_CHANGED' });
      // The guard detects, rather than hiding or deleting, an unexpected write.
      expect((await getEntry(p.after.org, p.teaching.entryId)).lines).toEqual(originalTeaching.lines);
    },
  );
});
