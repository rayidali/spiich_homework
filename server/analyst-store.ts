import { randomUUID } from 'node:crypto';
import type { AnalystConversation, AnalystProvider } from '../shared/analyst';
import { query, transaction } from './db';
import { AppError, required } from './errors';

export type AnalystRecord = {
  state: AnalystConversation;
  runtime: Record<string, unknown>;
  lastMessageId: string | null;
  lastMessageText: string | null;
};
export interface AnalystStore {
  create(org: string, state: AnalystConversation): Promise<AnalystRecord>;
  read(org: string, id: string, provider: AnalystProvider): Promise<AnalystRecord>;
  queue(
    org: string,
    id: string,
    provider: AnalystProvider,
    messageId: string,
    text: string,
  ): Promise<AnalystRecord>;
  claim(
    org: string,
    id: string,
    provider: AnalystProvider,
  ): Promise<{ token: string; record: AnalystRecord } | null>;
  save(org: string, id: string, token: string, record: AnalystRecord): Promise<void>;
  release(org: string, id: string, token: string): Promise<void>;
  requestClose(org: string, id: string, provider: AnalystProvider): Promise<AnalystRecord>;
}
type Row = {
  state: AnalystConversation;
  runtime: Record<string, unknown>;
  last_message_id: string | null;
  last_message_text: string | null;
  close_requested?: boolean;
};
const record = (row: Row): AnalystRecord => ({
  state: row.state,
  runtime: { ...row.runtime, ...(row.close_requested ? { closeRequested: true } : {}) },
  lastMessageId: row.last_message_id,
  lastMessageText: row.last_message_text,
});
export const postgresAnalystStore: AnalystStore = {
  async create(org, state) {
    return transaction(async (db) => {
      await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`analyst:${org}`], db);
      const existing = (
        await query<Row>(
          'SELECT state,runtime,last_message_id,last_message_text FROM analyst_conversations WHERE organization_id=$1 AND id=$2 AND provider=$3',
          [org, state.id, state.provider],
          db,
        )
      )[0];
      if (existing) return record(existing);
      const [count] = await query<{ count: string }>(
        'SELECT count(*)::text AS count FROM analyst_conversations WHERE organization_id=$1',
        [org],
        db,
      );
      if (Number(count.count) >= 500)
        throw new AppError(
          429,
          'AI_REQUEST_LIMIT',
          'This workspace has reached its saved conversation limit.',
        );
      const [saved] = await query<Row>(
        'INSERT INTO analyst_conversations(id,organization_id,provider,state) VALUES($1,$2,$3,$4::jsonb) RETURNING state,runtime,last_message_id,last_message_text',
        [state.id, org, state.provider, JSON.stringify(state)],
        db,
      );
      return record(saved);
    });
  },
  async read(org, id, provider) {
    return record(
      required(
        (
          await query<Row>(
            'SELECT state,runtime,last_message_id,last_message_text FROM analyst_conversations WHERE organization_id=$1 AND id=$2 AND provider=$3',
            [org, id, provider],
          )
        )[0],
        'Conversation not found.',
      ),
    );
  },
  async queue(org, id, provider, messageId, text) {
    return transaction(async (db) => {
      await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`analyst:${org}`], db);
      const row = required(
        (
          await query<Row & { busy: boolean }>(
            `SELECT state,runtime,last_message_id,last_message_text,close_requested,COALESCE(lease_until>now(),false) AS busy
         FROM analyst_conversations WHERE organization_id=$1 AND id=$2 AND provider=$3 FOR UPDATE`,
            [org, id, provider],
            db,
          )
        )[0],
        'Conversation not found.',
      );
      const current = record(row);
      const prior = current.state.messages.find((m) => m.id === messageId);
      if (prior) {
        if (prior.role !== 'user' || prior.content !== text)
          throw new AppError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This message reference was already used for different text.',
          );
        return current;
      }
      if (row.busy || ['starting', 'running'].includes(current.state.status))
        throw new AppError(409, 'AI_BUSY', 'Wait for this answer before sending another question.');
      if (current.state.status === 'closed' || row.close_requested)
        throw new AppError(409, 'AI_REQUEST_REJECTED', 'Start a new conversation to ask another question.');
      if (current.runtime.pendingMutation)
        throw new AppError(
          409,
          'AI_REQUEST_REJECTED',
          'The previous request needs reconciliation. Start a new conversation; it will not be resubmitted automatically.',
        );
      if (current.runtime.environmentId || current.runtime.sessionId || current.runtime.agentId)
        throw new AppError(
          409,
          'AI_BUSY',
          'The previous analysis is still closing. Refresh its status before sending another question.',
        );
      if (current.state.messages.length >= 80)
        throw new AppError(
          422,
          'AI_REQUEST_LIMIT',
          'Start a new conversation to keep the analysis manageable.',
        );
      const [active] = await query<{ count: string }>(
        `SELECT count(*)::text AS count FROM analyst_conversations WHERE organization_id=$1
         AND state->>'status' IN ('starting','running') AND updated_at>now()-interval '10 minutes'`,
        [org],
        db,
      );
      if (Number(active.count) >= 3)
        throw new AppError(429, 'AI_BUSY', 'Three analyses are already in progress. Wait for one to finish.');
      const now = new Date().toISOString();
      current.state.messages.push({ id: messageId, role: 'user', content: text, createdAt: now });
      if (current.state.messages.length === 1) current.state.title = text.slice(0, 100);
      current.state.status = 'starting';
      current.state.phase = 'Opening your analysis';
      current.state.error = null;
      current.state.updatedAt = now;
      // Completed turns close their compute. Follow-ups reopen the saved notebook/history.
      current.runtime = {
        notebookId: current.runtime.notebookId,
        stage: 'environment',
        startedAt: now,
      };
      current.lastMessageId = messageId;
      current.lastMessageText = text;
      await query(
        `UPDATE analyst_conversations SET state=$4::jsonb,runtime=$5::jsonb,last_message_id=$6,last_message_text=$7,
         updated_at=now() WHERE organization_id=$1 AND id=$2 AND provider=$3`,
        [org, id, provider, JSON.stringify(current.state), JSON.stringify(current.runtime), messageId, text],
        db,
      );
      return current;
    });
  },
  async claim(org, id, provider) {
    const token = randomUUID();
    const [row] = await query<Row>(
      `UPDATE analyst_conversations SET lease_token=$4,lease_until=now()+interval '75 seconds'
       WHERE organization_id=$1 AND id=$2 AND provider=$3 AND (lease_until IS NULL OR lease_until<now())
       RETURNING state,runtime,last_message_id,last_message_text,close_requested`,
      [org, id, provider, token],
    );
    return row ? { token, record: record(row) } : null;
  },
  async save(org, id, token, next) {
    const rows = await query<{ runtime: Record<string, unknown> }>(
      `UPDATE analyst_conversations SET state=$4::jsonb,
       runtime=$5::jsonb || CASE WHEN close_requested THEN '{"closeRequested":true}'::jsonb ELSE '{}'::jsonb END,
       updated_at=now()
       WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND lease_until>now() RETURNING runtime`,
      [org, id, token, JSON.stringify(next.state), JSON.stringify(next.runtime)],
    );
    if (!rows.length)
      throw new AppError(
        409,
        'CONCURRENT_CHANGE',
        'Analysis ownership changed. Refresh to see its current status.',
      );
    if (rows[0].runtime.closeRequested) next.runtime.closeRequested = true;
  },
  async release(org, id, token) {
    await query(
      'UPDATE analyst_conversations SET lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2 AND lease_token=$3',
      [org, id, token],
    );
  },
  async requestClose(org, id, provider) {
    const [row] = await query<Row>(
      `UPDATE analyst_conversations SET close_requested=true,updated_at=now(),
       runtime=jsonb_set(runtime,'{closeRequested}','true'::jsonb),
       state=CASE WHEN state->>'status'='closed' THEN state
         ELSE jsonb_set(jsonb_set(state,'{status}','"running"'::jsonb),'{phase}','"Closing this analysis"'::jsonb) END
       WHERE organization_id=$1 AND id=$2 AND provider=$3
       RETURNING state,runtime,last_message_id,last_message_text,close_requested`,
      [org, id, provider],
    );
    return record(required(row, 'Conversation not found.'));
  },
};
