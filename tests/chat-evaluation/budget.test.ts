import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatBudget, reserveEstimate, totals } from '../../scripts/chat-evaluation/budget';
import type { RecordedOutcome } from '../../scripts/chat-evaluation/types';
const dirs: string[] = [];
const h = 'a'.repeat(64);
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'chat-budget-'));
  dirs.push(dir);
  return ChatBudget.create(join(dir, 'ledger.json'), 'offline', h);
}
function result(b: ChatBudget, usage: RecordedOutcome['usage'] = null): RecordedOutcome {
  const r = b.read().records.at(-1)!;
  return {
    attemptId: r.id,
    slot: r.slot,
    route: 'authored',
    phase: 'development',
    caseId: 'D01',
    sourceHash: h,
    requestHash: h,
    httpStatus: 200,
    curlExit: 0,
    networkSeconds: 1,
    elapsedMs: 1000,
    responseHash: h,
    status: 'valid_plan',
    usage,
  };
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
describe('new chat comparison budget (offline)', () => {
  it('keeps unknown reservations across restart and rejects retry of a consumed slot', () => {
    const b = fresh(),
      r = b.reserve('development/authored/D01', h, h, '0.010000000000');
    b.claim(r.id);
    b.finish(r.id, result(b));
    const restarted = new ChatBudget(b.path, h);
    expect(totals(restarted.read())).toEqual({
      attempts: 1,
      knownUsd: '0.000000000000',
      unknownReservedUsd: '0.010000000000',
      chargedUsd: '0.010000000000',
    });
    expect(() => restarted.reserve('development/authored/D01', h, h, '0.010000000000')).toThrow(
      'CHAT_NO_RETRY',
    );
  });
  it('charges thinking tokens and retains usage even for an invalid plan', () => {
    const b = fresh(),
      r = b.reserve('development/authored/D01', h, h, '0.010000000000');
    const out = result(b, { inputTokens: 100, outputTokens: 20, thinkingTokens: 30, totalTokens: 150 });
    out.status = 'invalid_response';
    b.finish(r.id, out);
    expect(totals(b.read()).knownUsd).toBe('0.000155000000');
  });
  it('rejects simultaneous attempts and duplicate claims/completions', () => {
    const b = fresh(),
      r = b.reserve('development/authored/D01', h, h, '0.010000000000');
    expect(() => b.reserve('development/composable/D01', h, h, '0.010000000000')).toThrow(
      'CHAT_ATTEMPT_PENDING',
    );
    b.claim(r.id);
    expect(() => b.claim(r.id)).toThrow('CHAT_ALREADY_CLAIMED');
    b.finish(r.id, result(b));
    expect(() => b.finish(r.id, result(b))).toThrow('CHAT_ALREADY_FINISHED');
  });
  it('never clears a stale writer lock or overwrites corrupted ledger bytes', () => {
    const b = fresh();
    writeFileSync(`${b.path}.lock`, 'stale');
    expect(() => b.reserve('development/authored/D01', h, h, '0.010000000000')).toThrow();
    expect(readFileSync(`${b.path}.lock`, 'utf8')).toBe('stale');
    rmSync(`${b.path}.lock`);
    writeFileSync(b.path, '{ corrupt');
    expect(() => b.reserve('development/authored/D01', h, h, '0.010000000000')).toThrow();
    expect(readFileSync(b.path, 'utf8')).toBe('{ corrupt');
  });
  it('reserves against the dollar limit before spending and preserves a later reported overrun', () => {
    const b = fresh();
    expect(() => b.reserve('development/authored/D01', h, h, '0.500000000001')).toThrow(
      'CHAT_BUDGET_EXHAUSTED',
    );
    const r = b.reserve('development/authored/D01', h, h, '0.000001000000');
    b.finish(r.id, result(b, { inputTokens: 100, outputTokens: 0, thinkingTokens: 0, totalTokens: 100 }));
    expect(b.read().haltReason).toBe('CHAT_RESERVATION_EXCEEDED');
    expect(totals(b.read()).knownUsd).toBe('0.000030000000');
    expect(() => b.reserve('development/composable/D01', h, h, '0.010000000000')).toThrow(
      'CHAT_BUDGET_HALTED',
    );
  });
  it('requires 16 consumed development slots and a single immutable holdout freeze', () => {
    const b = fresh();
    expect(() => b.freezeHoldout(h)).toThrow('CHAT_FREEZE_NOT_READY');
    for (let i = 0; i < 16; i++) {
      const r = b.reserve(
        `development/${i % 2 ? 'composable' : 'authored'}/D0${Math.floor(i / 2) + 1}`,
        h,
        h,
        '0.000010000000',
      );
      b.finish(r.id, result(b));
    }
    b.freezeHoldout(h);
    expect(() => b.freezeHoldout(h)).toThrow();
    expect(() => b.reserve('holdout/authored/H01', h, 'b'.repeat(64), '0.000010000000')).toThrow(
      'CHAT_HOLDOUT_NOT_FROZEN',
    );
    expect(() => b.reserve('development/authored/D09', h, h, '0.000010000000')).toThrow(
      'CHAT_DEVELOPMENT_CLOSED',
    );
  });
  it('does not recreate an existing ledger and binds the run manifest', () => {
    const b = fresh();
    expect(() => ChatBudget.create(b.path, 'replacement', h)).toThrow();
    expect(() => new ChatBudget(b.path, 'b'.repeat(64)).read()).toThrow('CHAT_BUDGET_BINDING');
  });
  it('accounts for byte-size input and the complete 4000-token output allowance', () => {
    const body = (text: string) => JSON.stringify({ text, generationConfig: { maxOutputTokens: 4000 } });
    expect(Number(reserveEstimate(body('é')))).toBeGreaterThan(0.01);
    expect(Number(reserveEstimate(body('a'.repeat(100))))).toBeGreaterThan(
      Number(reserveEstimate(body('a'))),
    );
  });
});
