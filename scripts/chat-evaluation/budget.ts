import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Decimal } from '../../shared/money';
import { exclusiveJson, privateJson, readJson, withLock } from './io';
import type { RecordedOutcome, TokenUsage } from './types';
export const LIMITS = { usd: '0.50', attempts: 60 } as const;
export const PRICES = {
  model: 'gemini-3.5-flash-lite',
  inputPerMillion: '0.30',
  outputPerMillion: '2.50',
  asOf: '2026-10-31',
} as const;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const money = z.string().regex(/^\d+\.\d{12}$/);
const usageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  thinkingTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
const recordSchema = z.strictObject({
  id: z.uuid(),
  slot: z.string().regex(/^(setup|development|holdout)\/(authored|composable)\/[A-Za-z0-9_-]{1,64}$/),
  requestHash: sha,
  sourceHash: sha,
  reservedUsd: money,
  chargedUsd: money,
  state: z.enum(['pending', 'known', 'unknown']),
  reservedAt: z.string(),
  claimedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  usage: usageSchema.nullable(),
  outcome: z.unknown().nullable(),
});
const ledgerSchema = z.strictObject({
  version: z.literal('daybook-chat-budget-v1'),
  runId: z.string(),
  bindingHash: sha,
  prices: z.object({
    model: z.literal(PRICES.model),
    inputPerMillion: z.literal('0.30'),
    outputPerMillion: z.literal('2.50'),
    asOf: z.literal('2026-10-31'),
  }),
  limits: z.object({ usd: z.literal('0.50'), attempts: z.literal(60) }),
  state: z.enum(['open', 'closed']),
  haltReason: z.string().nullable(),
  holdoutSource: sha.nullable(),
  records: z.array(recordSchema).max(60),
});
export type BudgetRecord = z.infer<typeof recordSchema>;
export type ChatLedger = z.infer<typeof ledgerSchema>;
export function cost(usage: TokenUsage) {
  return new Decimal(usage.inputTokens)
    .times(PRICES.inputPerMillion)
    .plus(new Decimal(usage.outputTokens + usage.thinkingTokens).times(PRICES.outputPerMillion))
    .div(1e6)
    .toFixed(12);
}
export function reserveEstimate(body: string) {
  // UTF-8 byte count plus fixed framing allowance is deliberately conservative, not a billing guarantee.
  const parsed = JSON.parse(body) as { generationConfig?: { maxOutputTokens?: number } };
  const cap = parsed.generationConfig?.maxOutputTokens;
  if (!Number.isSafeInteger(cap) || !cap || cap < 1 || cap > 4000) throw Error('CHAT_OUTPUT_CAP');
  return cost({
    inputTokens: Buffer.byteLength(body) + 2048,
    outputTokens: cap,
    thinkingTokens: 0,
    totalTokens: 0,
  });
}
export function totals(ledger: ChatLedger) {
  const known = ledger.records
    .filter((r) => r.state === 'known')
    .reduce((s, r) => s.plus(r.chargedUsd), new Decimal(0));
  const unknown = ledger.records
    .filter((r) => r.state !== 'known')
    .reduce((s, r) => s.plus(r.chargedUsd), new Decimal(0));
  return {
    attempts: ledger.records.length,
    knownUsd: known.toFixed(12),
    unknownReservedUsd: unknown.toFixed(12),
    chargedUsd: known.plus(unknown).toFixed(12),
  };
}
function validate(value: unknown): ChatLedger {
  const ledger = ledgerSchema.parse(value);
  const ids = new Set<string>(),
    slots = new Set<string>();
  for (const r of ledger.records) {
    if (ids.has(r.id) || slots.has(r.slot) || new Decimal(r.reservedUsd).lte(0))
      throw Error('CHAT_BUDGET_CORRUPT');
    ids.add(r.id);
    slots.add(r.slot);
    if (r.state === 'known') {
      if (
        !r.usage ||
        r.usage.inputTokens + r.usage.outputTokens + r.usage.thinkingTokens !== r.usage.totalTokens ||
        cost(r.usage) !== r.chargedUsd
      )
        throw Error('CHAT_BUDGET_CORRUPT');
    } else if (r.chargedUsd !== r.reservedUsd || r.usage !== null) throw Error('CHAT_BUDGET_CORRUPT');
    if (
      (r.state === 'pending') !== (r.finishedAt === null) ||
      (r.state === 'pending') !== (r.outcome === null)
    )
      throw Error('CHAT_BUDGET_CORRUPT');
  }
  if (ledger.records.some((r) => r.state === 'unknown') && !ledger.haltReason)
    throw Error('CHAT_BUDGET_CORRUPT');
  if (ledger.records.filter((r) => r.state === 'pending').length > 1) throw Error('CHAT_BUDGET_CORRUPT');
  return ledger;
}
export class ChatBudget {
  constructor(
    readonly path: string,
    readonly bindingHash: string,
  ) {}
  static create(path: string, runId: string, bindingHash: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    exclusiveJson(path, {
      version: 'daybook-chat-budget-v1',
      runId,
      bindingHash,
      prices: PRICES,
      limits: LIMITS,
      state: 'open',
      haltReason: null,
      holdoutSource: null,
      records: [],
    });
    return new ChatBudget(path, bindingHash);
  }
  read() {
    const l = validate(readJson(this.path));
    if (l.bindingHash !== this.bindingHash) throw Error('CHAT_BUDGET_BINDING');
    return l;
  }
  private mutate<T>(fn: (ledger: ChatLedger) => T): T {
    return withLock(`${this.path}.lock`, () => {
      const ledger = this.read();
      const result = fn(ledger);
      validate(ledger);
      privateJson(this.path, ledger);
      return result;
    });
  }
  reserve(slot: string, requestHash: string, sourceHash: string, reservedUsd: string) {
    return this.mutate((l) => {
      if (l.state !== 'open' || l.haltReason) throw Error('CHAT_BUDGET_HALTED');
      if (l.records.some((r) => r.slot === slot)) throw Error('CHAT_NO_RETRY');
      if (l.records.some((r) => r.state === 'pending')) throw Error('CHAT_ATTEMPT_PENDING');
      if (slot.startsWith('holdout/') && l.holdoutSource !== sourceHash)
        throw Error('CHAT_HOLDOUT_NOT_FROZEN');
      if (l.holdoutSource && !slot.startsWith('holdout/')) throw Error('CHAT_DEVELOPMENT_CLOSED');
      if (l.records.length >= 60 || new Decimal(totals(l).chargedUsd).plus(reservedUsd).gt('0.50'))
        throw Error('CHAT_BUDGET_EXHAUSTED');
      const phase = slot.split('/')[0],
        cap = phase === 'setup' ? 4 : phase === 'development' ? 16 : 40;
      if (l.records.filter((r) => r.slot.startsWith(`${phase}/`)).length >= cap)
        throw Error('CHAT_PHASE_EXHAUSTED');
      const record: BudgetRecord = {
        id: randomUUID(),
        slot,
        requestHash,
        sourceHash,
        reservedUsd,
        chargedUsd: reservedUsd,
        state: 'pending',
        reservedAt: new Date().toISOString(),
        claimedAt: null,
        finishedAt: null,
        usage: null,
        outcome: null,
      };
      l.records.push(record);
      return record;
    });
  }
  claim(id: string) {
    return this.mutate((l) => {
      const r = l.records.find((r) => r.id === id);
      if (!r || r.state !== 'pending' || r.claimedAt) throw Error('CHAT_ALREADY_CLAIMED');
      r.claimedAt = new Date().toISOString();
      return r;
    });
  }
  finish(id: string, outcome: RecordedOutcome, haltReason: string | null = null) {
    return this.mutate((l) => {
      const r = l.records.find((r) => r.id === id);
      if (!r || r.state !== 'pending') throw Error('CHAT_ALREADY_FINISHED');
      if (
        outcome.attemptId !== id ||
        outcome.requestHash !== r.requestHash ||
        outcome.sourceHash !== r.sourceHash ||
        outcome.slot !== r.slot
      )
        throw Error('CHAT_OUTCOME_BINDING');
      r.state = outcome.usage ? 'known' : 'unknown';
      r.usage = outcome.usage;
      r.chargedUsd = outcome.usage ? cost(outcome.usage) : r.reservedUsd;
      r.finishedAt = new Date().toISOString();
      r.outcome = outcome;
      if (!outcome.usage) l.haltReason = 'CHAT_USAGE_UNKNOWN';
      if (haltReason) l.haltReason = haltReason;
      if (outcome.usage && new Decimal(r.chargedUsd).gt(r.reservedUsd))
        l.haltReason = 'CHAT_RESERVATION_EXCEEDED';
      if (new Decimal(totals(l).chargedUsd).gt('0.50')) l.haltReason = 'CHAT_BUDGET_EXCEEDED';
      return r;
    });
  }
  freezeHoldout(sourceHash: string) {
    this.mutate((l) => {
      if (
        l.state !== 'open' ||
        l.haltReason ||
        l.holdoutSource ||
        l.records.some((r) => r.state === 'pending') ||
        l.records.filter((r) => r.slot.startsWith('development/')).length !== 16
      )
        throw Error('CHAT_FREEZE_NOT_READY');
      l.holdoutSource = sourceHash;
    });
  }
  close() {
    this.mutate((l) => {
      if (l.records.some((r) => r.state === 'pending')) throw Error('CHAT_ATTEMPT_PENDING');
      l.state = 'closed';
    });
  }
}
export function budgetExists(path: string) {
  return existsSync(path);
}
