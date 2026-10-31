import { createHash } from 'node:crypto';
import { z } from 'zod';
import { query, transaction, type Db } from './db';
import { AppError, required } from './errors';
import { validateLines, assertBalanced } from './ledger-validation';
import { entrySchema, type EntryInput, type LineInput } from '../shared/schema';
import { Decimal } from '../shared/money';

export type CategorizationLearning = {
  status: 'LEARNED' | 'NO_ACCOUNT_CHANGE' | 'NOT_APPLICABLE' | 'REVOKED' | 'SUPERSEDED';
  memoryId?: string;
};
type ProposalRow = {
  id: string;
  proposal: EntryInput;
  expired: boolean;
  bound_entry_id: string | null;
  bound_revision: number | null;
  bound_snapshot_hash: string | null;
};
type SavedEntry = EntryInput & { id: string; revision: number; status: string; reversed: boolean };
export type CorrectionExample = {
  id: string;
  entryId: string;
  description: string;
  counterparty: string;
  corrected_lines: LineInput[];
};
export type HistoryExample = { id: string; description: string; counterparty: string; lines: LineInput[] };

// Recheck eligibility on every read as well as retiring invalid rows. This
// prevents a concurrent reversal/archive between retirement and retrieval from
// exposing the stale example, without write-heavy repeatable-read conflicts.
const eligibleMemory = `EXISTS(SELECT 1 FROM journal_entries e WHERE e.organization_id=m.organization_id AND e.id=m.entry_id
  AND e.status='POSTED' AND e.source='AI' AND e.revision=m.entry_revision)
  AND NOT EXISTS(SELECT 1 FROM journal_entries r WHERE r.organization_id=m.organization_id AND r.reverses_entry_id=m.entry_id AND r.status='POSTED')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m.corrected_lines) l WHERE NOT EXISTS(
    SELECT 1 FROM accounts a WHERE a.organization_id=m.organization_id AND a.id::text=l->>'accountId'
    AND NOT a.archived AND NOT a.is_group))`;

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalizeContext = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Only account/direction choices are memory. Reordering, splitting an unchanged
 * account, changing an amount/rate, or editing a memo is not a new category. */
export function accountSelection(lines: LineInput[]) {
  return [
    ...new Set(lines.map((line) => `${line.accountId}:${new Decimal(line.debit).gt(0) ? 'D' : 'C'}`)),
  ].sort();
}
export function hasAccountCorrection(proposed: LineInput[], reviewed: LineInput[]) {
  return JSON.stringify(accountSelection(proposed)) !== JSON.stringify(accountSelection(reviewed));
}
export function entrySnapshot(entry: EntryInput) {
  const parsed = entrySchema.parse(entry);
  return hash({
    date: parsed.date,
    description: parsed.description,
    counterparty: parsed.counterparty,
    reference: parsed.reference,
    source: parsed.source,
    lines: parsed.lines
      .map((line) => ({
        accountId: line.accountId,
        debit: new Decimal(line.debit).toString(),
        credit: new Decimal(line.credit).toString(),
        exchangeRate: new Decimal(line.exchangeRate).toString(),
        memo: line.memo,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
}

async function within<T>(db: Db | undefined, action: (connection: Db) => Promise<T>): Promise<T> {
  return db ? action(db) : transaction(action);
}
async function savedEntry(org: string, entryId: string, db: Db, lock = true): Promise<SavedEntry> {
  const row = required(
    (
      await query<SavedEntry>(
        `SELECT e.id,e.date,e.description,e.counterparty,e.reference,e.source,e.revision,e.status,
          EXISTS(SELECT 1 FROM journal_entries r WHERE r.organization_id=e.organization_id
            AND r.reverses_entry_id=e.id AND r.status='POSTED') AS reversed,
          coalesce((SELECT jsonb_agg(jsonb_build_object('accountId',l.account_id,
            'debit',l.debit::text,'credit',l.credit::text,'exchangeRate',l.exchange_rate::text,'memo',l.memo)
            ORDER BY l.position) FROM journal_lines l WHERE l.organization_id=e.organization_id AND l.entry_id=e.id),'[]') AS lines
        FROM journal_entries e WHERE e.organization_id=$1 AND e.id=$2 ${lock ? 'FOR UPDATE' : ''}`,
        [org, entryId],
        db,
      )
    )[0],
    'The reviewed entry was not found in this workspace.',
  );
  return row;
}

/** Called only by the server after a READY provider result passes validation.
 * Store the structured proposal, never the raw conversation or credentials. */
export async function recordProposal(org: string, entry: EntryInput, db?: Db): Promise<string> {
  const parsed = entrySchema.parse(entry);
  if (parsed.source !== 'AI')
    throw new AppError(422, 'INVALID_PROPOSAL', 'Only AI proposals can be recorded.');
  return within(db, async (connection) => {
    assertBalanced(await validateLines(org, parsed.lines, connection));
    // Bound drafts and learned examples are retained. Cleanup never touches the
    // financial ledger and is bounded so one proposal cannot create a long job.
    await query(
      `WITH expired AS (SELECT id FROM ai_entry_proposals WHERE organization_id=$1 AND bound_entry_id IS NULL
         AND expires_at<now() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)
       DELETE FROM ai_entry_proposals WHERE id IN (SELECT id FROM expired)`,
      [org],
      connection,
    );
    return (
      await query<{ id: string }>(
        'INSERT INTO ai_entry_proposals(organization_id,proposal) VALUES($1,$2) RETURNING id',
        [org, JSON.stringify(parsed)],
        connection,
      )
    )[0].id;
  });
}

/** Ledger create/update calls this INSIDE its transaction after writing the
 * actual draft. Without a new ID, edits refresh an existing binding. */
export async function bindProposalToEntry(
  org: string,
  input: { entryId: string; proposalId?: string; expectedRevision: number },
  db: Db,
) {
  z.uuid().parse(input.entryId);
  if (input.proposalId) z.uuid().parse(input.proposalId);
  const entry = await savedEntry(org, input.entryId, db);
  const proposal = (
    await query<ProposalRow>(
      `SELECT id,proposal,expires_at<now() AS expired,bound_entry_id,bound_revision,bound_snapshot_hash
       FROM ai_entry_proposals WHERE organization_id=$1 AND ${input.proposalId ? 'id=$2' : 'bound_entry_id=$2'} FOR UPDATE`,
      [org, input.proposalId ?? input.entryId],
      db,
    )
  )[0];
  if (!proposal && !input.proposalId) return;
  if (!proposal)
    throw new AppError(404, 'PROPOSAL_NOT_FOUND', 'This AI proposal was not found in this workspace.');
  if (entry.source !== 'AI' || entry.status !== 'DRAFT')
    throw new AppError(
      409,
      'PROPOSAL_BINDING_INVALID',
      'An AI proposal can only be linked while saving its AI draft.',
    );
  if (entry.revision !== input.expectedRevision)
    throw new AppError(409, 'STALE_DRAFT', 'Review the latest draft before saving its categorization.');
  if (proposal.bound_entry_id && proposal.bound_entry_id !== entry.id)
    throw new AppError(409, 'PROPOSAL_ALREADY_USED', 'This proposal is already linked to another entry.');
  if (!proposal.bound_entry_id && proposal.expired)
    throw new AppError(
      409,
      'PROPOSAL_EXPIRED',
      'This unsaved proposal expired. Prepare a new one or save manually.',
    );
  // A draft may be unbalanced while being edited. It is never learning evidence
  // until the ordinary posting transaction checks balance and confirms it.
  const snapshot = entrySnapshot(entry);
  if (input.proposalId)
    await query(
      `UPDATE ai_entry_proposals SET bound_entry_id=NULL,bound_revision=NULL,bound_snapshot_hash=NULL,bound_at=NULL
       WHERE organization_id=$1 AND bound_entry_id=$2 AND id<>$3`,
      [org, entry.id, proposal.id],
      db,
    );
  await query(
    `UPDATE ai_entry_proposals SET bound_entry_id=$3,bound_revision=$4,bound_snapshot_hash=$5,bound_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [org, proposal.id, entry.id, entry.revision, snapshot],
    db,
  );
}

/** Only the posting transaction calls this. No client-provided lines are accepted. */
export async function learnFromPostedEntry(
  org: string,
  entryId: string,
  db: Db,
): Promise<CategorizationLearning> {
  const entry = await savedEntry(org, entryId, db);
  const proposal = (
    await query<ProposalRow>(
      `SELECT id,proposal,expires_at<now() AS expired,bound_entry_id,bound_revision,bound_snapshot_hash
       FROM ai_entry_proposals WHERE organization_id=$1 AND bound_entry_id=$2 FOR UPDATE`,
      [org, entryId],
      db,
    )
  )[0];
  if (!proposal) return { status: 'NOT_APPLICABLE' };
  const prior = (
    await query<{ id: string; status: 'ACTIVE' | 'REVOKED' | 'SUPERSEDED' }>(
      'SELECT id,status FROM categorization_memories WHERE organization_id=$1 AND proposal_id=$2',
      [org, proposal.id],
      db,
    )
  )[0];
  if (prior) return { status: prior.status === 'ACTIVE' ? 'LEARNED' : prior.status, memoryId: prior.id };
  if (entry.status !== 'POSTED' || entry.source !== 'AI' || entry.reversed)
    throw new AppError(
      409,
      'CORRECTION_REQUIRES_POSTING',
      'Only a reviewed, posted AI entry can become a correction.',
    );
  if (
    entry.revision !== (proposal.bound_revision ?? 0) + 1 ||
    entrySnapshot(entry) !== proposal.bound_snapshot_hash
  )
    throw new AppError(
      409,
      'CORRECTION_REVIEW_CHANGED',
      'The entry changed after its AI proposal review. Reload and review the draft.',
    );
  assertBalanced(await validateLines(org, entry.lines, db));
  if (!hasAccountCorrection(entrySchema.parse(proposal.proposal).lines, entry.lines))
    return { status: 'NO_ACCOUNT_CHANGE' };
  const contextKey = hash([normalizeContext(entry.description), normalizeContext(entry.counterparty)]);
  // Serialize just this exact context. A vendor alone never supersedes every
  // purchase from that vendor. Similar but conflicting examples remain visible.
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${org}:${contextKey}`], db);
  await query(
    `UPDATE categorization_memories SET status='SUPERSEDED',reason='newer_confirmed_same_context',retired_at=now()
     WHERE organization_id=$1 AND context_key=$2 AND status='ACTIVE'`,
    [org, contextKey],
    db,
  );
  const memory = (
    await query<{ id: string }>(
      `INSERT INTO categorization_memories(organization_id,proposal_id,entry_id,entry_revision,description,counterparty,context_key,corrected_lines)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        org,
        proposal.id,
        entry.id,
        entry.revision,
        entry.description,
        entry.counterparty,
        contextKey,
        JSON.stringify(entry.lines),
      ],
      db,
    )
  )[0];
  return { status: 'LEARNED', memoryId: memory.id };
}

/** Reads the outcome for idempotent posting responses; never resurrects memory. */
export async function learningForEntry(
  org: string,
  entryId: string,
  db?: Db,
): Promise<CategorizationLearning> {
  const rows = await query<{ id: string | null; status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED' | null }>(
    `SELECT m.id,CASE WHEN m.status='ACTIVE' AND NOT (${eligibleMemory}) THEN 'REVOKED' ELSE m.status END AS status
     FROM ai_entry_proposals p LEFT JOIN categorization_memories m
     ON m.organization_id=p.organization_id AND m.proposal_id=p.id
     WHERE p.organization_id=$1 AND p.bound_entry_id=$2`,
    [org, entryId],
    db,
  );
  if (!rows[0]) return { status: 'NOT_APPLICABLE' };
  return rows[0].id
    ? { status: rows[0].status === 'ACTIVE' ? 'LEARNED' : rows[0].status!, memoryId: rows[0].id }
    : { status: 'NO_ACCOUNT_CHANGE' };
}

export async function revokeCorrection(org: string, memoryId: string) {
  z.uuid().parse(memoryId);
  const found = await query<{ id: string }>(
    `UPDATE categorization_memories SET status='REVOKED',reason='user_revoked',retired_at=coalesce(retired_at,now())
     WHERE organization_id=$1 AND id=$2 RETURNING id`,
    [org, memoryId],
  );
  required(found[0], 'The correction was not found in this workspace.');
  return { revoked: true };
}

/** Retire invalid examples permanently: unarchiving an account or reverting a
 * stale draft cannot silently restore an example that was withdrawn. */
async function retireInvalid(org: string, db: Db) {
  await query(
    `UPDATE categorization_memories m SET status='REVOKED',reason='source_no_longer_eligible',retired_at=now()
     WHERE m.organization_id=$1 AND m.status='ACTIVE' AND NOT (${eligibleMemory})`,
    [org],
    db,
  );
}

export async function getCategorizationContext(
  org: string,
  text: string,
): Promise<{
  corrections: CorrectionExample[];
  history: HistoryExample[];
}> {
  const boundedText = z.string().max(4000).parse(text);
  return transaction(async (db) => {
    await retireInvalid(org, db);
    const corrections = await query<CorrectionExample>(
      `SELECT m.id,m.entry_id AS "entryId",m.description,m.counterparty,m.corrected_lines
       FROM categorization_memories m WHERE m.organization_id=$1 AND m.status='ACTIVE' AND ${eligibleMemory}
       AND (similarity(m.description,$2)>0.12 OR (m.counterparty<>'' AND position(lower(m.counterparty) IN lower($2))>0))
       ORDER BY similarity(m.description,$2) DESC,m.created_at DESC,m.id DESC LIMIT 6`,
      [org, boundedText],
      db,
    );
    const history = await query<HistoryExample>(
      `SELECT e.id,e.description,e.counterparty,
         (SELECT jsonb_agg(jsonb_build_object('accountId',l.account_id,'debit',l.debit::text,
           'credit',l.credit::text,'exchangeRate',l.exchange_rate::text,'memo',l.memo) ORDER BY l.position)
          FROM journal_lines l WHERE l.organization_id=e.organization_id AND l.entry_id=e.id) AS lines
       FROM journal_entries e WHERE e.organization_id=$1 AND e.status='POSTED' AND e.source<>'REVERSAL'
       AND similarity(e.description,$2)>0.12
       AND NOT EXISTS(SELECT 1 FROM journal_entries r WHERE r.organization_id=e.organization_id AND r.reverses_entry_id=e.id AND r.status='POSTED')
       AND NOT EXISTS(SELECT 1 FROM categorization_memories m WHERE m.organization_id=e.organization_id
         AND m.entry_id=e.id AND m.status IN ('REVOKED','SUPERSEDED'))
       AND NOT EXISTS(SELECT 1 FROM journal_lines l JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
         WHERE l.organization_id=e.organization_id AND l.entry_id=e.id AND (a.archived OR a.is_group))
       ORDER BY similarity(e.description,$2) DESC,e.date DESC,e.id DESC LIMIT 6`,
      [org, boundedText],
      db,
    );
    return { corrections, history };
  });
}
