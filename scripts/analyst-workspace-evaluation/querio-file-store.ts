import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnalystRecord, AnalystStore } from '../../server/analyst-store';
import type { AnalystProvider } from '../../shared/analyst';
import { AppError } from '../../server/errors';

type Saved = {
  record: AnalystRecord;
  lease: { token: string; expires: number } | null;
  closeRequested: boolean;
};
/** One process owns the cohort lock; each mutation is persisted before any remote call. */
export function createFileAnalystStore(directory: string, now: () => number = Date.now): AnalystStore {
  mkdirSync(directory, { mode: 0o700 });
  const file = (org: string, id: string, provider: AnalystProvider) => {
    if (![org, id].every((value) => /^[a-f0-9-]{36}$/i.test(value)) || provider !== 'querio')
      throw new Error('INVALID_PRIVATE_STORE_SCOPE');
    return join(directory, `${org}-${provider}-${id}.json`);
  };
  const read = (org: string, id: string, provider: AnalystProvider): Saved =>
    JSON.parse(readFileSync(file(org, id, provider), 'utf8'));
  const save = (org: string, id: string, provider: AnalystProvider, value: Saved) => {
    const target = file(org, id, provider),
      temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, target);
  };
  return {
    async create(org, state) {
      const record = {
        state: structuredClone(state),
        runtime: {},
        lastMessageId: null,
        lastMessageText: null,
      };
      writeFileSync(
        file(org, state.id, state.provider),
        JSON.stringify({ record, lease: null, closeRequested: false }),
        { mode: 0o600, flag: 'wx' },
      );
      return record;
    },
    async read(org, id, p) {
      return read(org, id, p).record;
    },
    async queue(org, id, p, messageId, text) {
      const saved = read(org, id, p),
        r = saved.record;
      const previous = r.state.messages.find((message) => message.id === messageId);
      if (previous) {
        if (previous.role !== 'user' || previous.content !== text)
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Message reference reused.');
        return r;
      }
      if ((saved.lease && saved.lease.expires > now()) || ['starting', 'running'].includes(r.state.status))
        throw new AppError(409, 'AI_BUSY', 'A turn is still active.');
      if (saved.closeRequested || r.runtime.pendingMutation || r.state.status === 'closed')
        throw new AppError(409, 'AI_REQUEST_REJECTED', 'This conversation cannot accept another turn.');
      if (r.runtime.environmentId || r.runtime.sessionId || r.runtime.agentId)
        throw new AppError(409, 'AI_BUSY', 'Prior resources still need closing.');
      const stamp = new Date(now()).toISOString();
      r.state.messages.push({ id: messageId, role: 'user', content: text, createdAt: stamp });
      if (r.state.messages.length === 1) r.state.title = text.slice(0, 100);
      r.state.status = 'starting';
      r.state.phase = 'Opening your analysis';
      r.state.updatedAt = stamp;
      r.state.error = null;
      r.runtime = { notebookId: r.runtime.notebookId, stage: 'environment', startedAt: stamp };
      r.lastMessageId = messageId;
      r.lastMessageText = text;
      save(org, id, p, saved);
      return r;
    },
    async claim(org, id, p) {
      const saved = read(org, id, p);
      if (saved.lease && saved.lease.expires > now()) return null;
      const token = randomUUID();
      saved.lease = { token, expires: now() + 75000 };
      save(org, id, p, saved);
      return { token, record: saved.record };
    },
    async save(org, id, token, record) {
      const saved = read(org, id, record.state.provider);
      if (saved.lease?.token !== token || saved.lease.expires <= now())
        throw new AppError(409, 'CONCURRENT_CHANGE', 'Lease expired.');
      if (saved.closeRequested) record.runtime.closeRequested = true;
      saved.record = record;
      save(org, id, record.state.provider, saved);
    },
    async release(org, id, token) {
      const saved = read(org, id, 'querio');
      if (saved.lease?.token === token) {
        saved.lease = null;
        save(org, id, 'querio', saved);
      }
    },
    async requestClose(org, id, p) {
      const saved = read(org, id, p);
      saved.closeRequested = true;
      saved.record.runtime.closeRequested = true;
      if (saved.record.state.status !== 'closed') {
        saved.record.state.status = 'running';
        saved.record.state.phase = 'Closing this analysis';
      }
      save(org, id, p, saved);
      return saved.record;
    },
  };
}
