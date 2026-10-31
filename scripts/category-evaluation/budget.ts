import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  fsyncSync,
  unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Decimal } from '../../shared/money';

export const CATEGORY_PRICE_DATE = '2026-10-31';
export const CATEGORY_PRICES = {
  gemini: { model: 'gemini-3.5-flash-lite', inputPerMillion: '0.30', outputPerMillion: '2.50' },
  jev: { model: 'jev-1.14.0', inputPerMillion: '0.042', outputPerMillion: '0' },
} as const;
export type BudgetProvider = keyof typeof CATEGORY_PRICES;
type Reservation = {
  id: string;
  provider: BudgetProvider;
  requestSha256: string;
  reservedUsd: string;
  chargedUsd: string;
  state: 'pending' | 'known' | 'unknown';
  reservedAt: string;
  finishedAt?: string;
  usage?: { inputTokens: number; outputTokens: number };
};
type Ledger = {
  version: 1;
  sourceHash: string;
  priceDate: typeof CATEGORY_PRICE_DATE;
  prices: typeof CATEGORY_PRICES;
  state: 'open' | 'closed';
  limits: Record<BudgetProvider, { usd: string; attempts: number }>;
  records: Reservation[];
};
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const count = (v: number) => Number.isSafeInteger(v) && v >= 0;
function cost(provider: BudgetProvider, input: number, output: number) {
  const prices = CATEGORY_PRICES[provider];
  return new Decimal(input)
    .times(prices.inputPerMillion)
    .plus(new Decimal(output).times(prices.outputPerMillion))
    .div(1_000_000);
}
function atomic(path: string, value: Ledger) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const descriptor = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temp, path);
}

/** Single writer, explicit start/resume. A pending request is never replayed:
 * crash recovery retains its entire reservation as unknown and consumes its ID.
 * This ledger is independent of the closed architecture-study budget. */
export class CategoryBudget {
  private ledger: Ledger;
  private lock: string;
  private released = false;
  constructor(
    private path: string,
    sourceHash: string,
    mode: 'create' | 'resume',
  ) {
    if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('BUDGET_SOURCE_HASH');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.lock = path + '.lock';
    closeSync(openSync(this.lock, 'wx', 0o600));
    try {
      if (mode === 'create') {
        // Exclusive creation refuses to overwrite or reset any earlier spend.
        closeSync(openSync(path, 'wx', 0o600));
        this.ledger = {
          version: 1,
          sourceHash,
          priceDate: CATEGORY_PRICE_DATE,
          prices: CATEGORY_PRICES,
          state: 'open',
          limits: { gemini: { usd: '0.50', attempts: 72 }, jev: { usd: '0.03', attempts: 72 } },
          records: [],
        };
      } else {
        this.ledger = JSON.parse(readFileSync(path, 'utf8')) as Ledger;
        if (
          this.ledger.version !== 1 ||
          this.ledger.sourceHash !== sourceHash ||
          this.ledger.state !== 'open' ||
          this.ledger.priceDate !== CATEGORY_PRICE_DATE ||
          JSON.stringify(this.ledger.prices) !== JSON.stringify(CATEGORY_PRICES) ||
          JSON.stringify(this.ledger.limits) !==
            JSON.stringify({ gemini: { usd: '0.50', attempts: 72 }, jev: { usd: '0.03', attempts: 72 } }) ||
          !Array.isArray(this.ledger.records)
        )
          throw new Error('BUDGET_BINDING');
        const ids = new Set<string>();
        for (const row of this.ledger.records) {
          if (
            !row ||
            !['gemini', 'jev'].includes(row.provider) ||
            typeof row.id !== 'string' ||
            ids.has(row.id) ||
            !/^[a-f0-9]{64}$/.test(row.requestSha256) ||
            !['pending', 'known', 'unknown'].includes(row.state) ||
            !new Decimal(row.reservedUsd).isFinite() ||
            new Decimal(row.reservedUsd).lte(0) ||
            !new Decimal(row.chargedUsd).isFinite() ||
            new Decimal(row.chargedUsd).lt(0)
          )
            throw new Error('BUDGET_RECORD');
          ids.add(row.id);
          if (row.state === 'known') {
            if (
              !row.usage ||
              !count(row.usage.inputTokens) ||
              !count(row.usage.outputTokens) ||
              !cost(row.provider, row.usage.inputTokens, row.usage.outputTokens).eq(row.chargedUsd)
            )
              throw new Error('BUDGET_RECORD');
          } else {
            if (row.chargedUsd !== row.reservedUsd) throw new Error('BUDGET_RECORD');
            if (row.state === 'pending') {
              row.state = 'unknown';
              row.finishedAt = new Date().toISOString();
            }
          }
        }
      }
      atomic(path, this.ledger);
    } catch (error) {
      unlinkSync(this.lock);
      throw error;
    }
  }
  reserve(id: string, provider: BudgetProvider, body: string) {
    if (this.released || this.ledger.state !== 'open') throw new Error('BUDGET_CLOSED');
    if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(id) || this.ledger.records.some((r) => r.id === id))
      throw new Error('BUDGET_REQUEST_USED');
    if (this.ledger.records.some((r) => r.state === 'pending')) throw new Error('BUDGET_IN_FLIGHT');
    const request = JSON.parse(body);
    if (
      (provider === 'jev' || request.model !== undefined) &&
      request.model !== CATEGORY_PRICES[provider].model
    )
      throw new Error('BUDGET_MODEL');
    if (provider === 'gemini' && (request.generationConfig?.maxOutputTokens !== 256 || request.tools))
      throw new Error('BUDGET_OUTPUT_BOUND');
    if (provider === 'jev' && Object.keys(request.questions ?? {}).length !== 1)
      throw new Error('BUDGET_QUESTION_BOUND');
    const bytes = Buffer.byteLength(body);
    if (bytes > 128 * 1024) throw new Error('BUDGET_REQUEST_BOUND');
    // Byte-based text allowance plus protocol overhead is deliberately conservative.
    // Price/usage reconciliation is still an estimate, never a provider invoice.
    const reserved = cost(provider, bytes + 1024, provider === 'gemini' ? 256 : 0);
    const rows = this.ledger.records.filter((r) => r.provider === provider);
    const charged = rows.reduce((total, r) => total.plus(r.chargedUsd), new Decimal(0));
    const limit = this.ledger.limits[provider];
    if (
      rows.length >= limit.attempts ||
      charged.plus(reserved).gt(limit.usd) ||
      this.ledger.records.some((r) => new Decimal(r.chargedUsd).gt(r.reservedUsd))
    )
      throw new Error('BUDGET_EXHAUSTED');
    this.ledger.records.push({
      id,
      provider,
      requestSha256: sha(body),
      reservedUsd: reserved.toFixed(12),
      chargedUsd: reserved.toFixed(12),
      state: 'pending',
      reservedAt: new Date().toISOString(),
    });
    atomic(this.path, this.ledger);
  }
  settle(id: string, usage: { inputTokens: number; outputTokens: number } | null) {
    if (this.released) throw new Error('BUDGET_CLOSED');
    const row = this.ledger.records.find((r) => r.id === id);
    if (!row || row.state !== 'pending') throw new Error('BUDGET_SETTLEMENT');
    if (usage && (!count(usage.inputTokens) || !count(usage.outputTokens))) throw new Error('BUDGET_USAGE');
    row.state = usage ? 'known' : 'unknown';
    if (usage) {
      row.usage = usage;
      row.chargedUsd = cost(row.provider, usage.inputTokens, usage.outputTokens).toFixed(12);
    }
    row.finishedAt = new Date().toISOString();
    atomic(this.path, this.ledger);
    if (new Decimal(row.chargedUsd).gt(row.reservedUsd)) throw new Error('BUDGET_RESERVATION_EXCEEDED');
  }
  snapshot() {
    return structuredClone(this.ledger);
  }
  release(close = false) {
    if (this.released) return;
    if (close && this.ledger.records.some((r) => r.state === 'pending')) throw new Error('BUDGET_IN_FLIGHT');
    if (close) {
      this.ledger.state = 'closed';
      atomic(this.path, this.ledger);
    }
    unlinkSync(this.lock);
    this.released = true;
  }
}
