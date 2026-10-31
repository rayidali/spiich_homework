import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  fsyncSync,
  unlinkSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Decimal } from '../../shared/money';

export const CATEGORY_PRICE_DATE = '2026-10-31';
export const CATEGORY_PRICES = {
  gemini: { model: 'gemini-3.5-flash-lite', inputPerMillion: '0.30', outputPerMillion: '2.50' },
  jev: { model: 'jev-1.14.0', inputPerMillion: '0.042', outputPerMillion: '0' },
} as const;
export type BudgetProvider = keyof typeof CATEGORY_PRICES;
export const CATEGORY_LIMITS = {
  gemini: { usd: '0.50', attempts: 72 },
  jev: { usd: '0.03', attempts: 72 },
} as const;
export type CategoryTotals = Record<
  BudgetProvider,
  { attempts: number; knownUsd: string; unknownReservedUsd: string; chargedUsd: string }
>;
export type CategoryCarryOptions = {
  receiptPath: string;
  receiptSha256: string;
  keyFingerprints: Record<string, string>;
};
export type CategoryCarryReceipt = {
  schema: 'category-reviewed-carry-v1';
  approved: true;
  reason: 'gemini-additive-billing-metadata-compatibility' | 'jev-rounded-confidence-compatibility';
  fromRun: 'category-learning-20261031-v1' | 'category-learning-20261031-v2';
  toRun: 'category-learning-20261031-v2' | 'category-learning-20261031-v3';
  fromVersion: 'daybook-category-learning-v1' | 'daybook-category-learning-v2';
  toVersion: 'daybook-category-learning-v2' | 'daybook-category-learning-v3';
  ancestorReceipt?: Pick<CategoryCarryOptions, 'receiptPath' | 'receiptSha256'>;
  targetSourceHash: string;
  targetLedgerPath: string;
  predecessorLedgerSha256: string;
  predecessorSourceHash: string;
  predecessorProtocolSha256: string;
  artifactHashes: Record<string, string>;
  totals: CategoryTotals;
  limits: typeof CATEGORY_LIMITS;
  approvedAt: string;
};
export type CategoryOpeningCarry = {
  receiptSha256: string;
  fromRun: CategoryCarryReceipt['fromRun'];
  predecessorLedgerSha256: string;
  predecessorSourceHash: string;
  predecessorProtocolSha256: string;
  artifactHashes: Record<string, string>;
  totals: CategoryTotals;
  ancestorCarry?: CategoryOpeningCarry;
};
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
  version: 2;
  sourceHash: string;
  priceDate: typeof CATEGORY_PRICE_DATE;
  prices: typeof CATEGORY_PRICES;
  state: 'open' | 'closed';
  limits: Record<BudgetProvider, { usd: string; attempts: number }>;
  records: Reservation[];
  openingCarry: CategoryOpeningCarry | null;
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
export function categoryBudgetTotals(records: Reservation[]): CategoryTotals {
  return Object.fromEntries(
    (['gemini', 'jev'] as const).map((provider) => {
      const rows = records.filter((r) => r.provider === provider);
      const known = rows
        .filter((r) => r.state === 'known')
        .reduce((n, r) => n.plus(r.chargedUsd), new Decimal(0));
      const unknown = rows
        .filter((r) => r.state !== 'known')
        .reduce((n, r) => n.plus(r.chargedUsd), new Decimal(0));
      return [
        provider,
        {
          attempts: rows.length,
          knownUsd: known.toFixed(12),
          unknownReservedUsd: unknown.toFixed(12),
          chargedUsd: known.plus(unknown).toFixed(12),
        },
      ];
    }),
  ) as CategoryTotals;
}
export function addCategoryTotals(left: CategoryTotals, right: CategoryTotals): CategoryTotals {
  return Object.fromEntries(
    (['gemini', 'jev'] as const).map((provider) => [
      provider,
      {
        attempts: left[provider].attempts + right[provider].attempts,
        knownUsd: new Decimal(left[provider].knownUsd).plus(right[provider].knownUsd).toFixed(12),
        unknownReservedUsd: new Decimal(left[provider].unknownReservedUsd)
          .plus(right[provider].unknownReservedUsd)
          .toFixed(12),
        chargedUsd: new Decimal(left[provider].chargedUsd).plus(right[provider].chargedUsd).toFixed(12),
      },
    ]),
  ) as CategoryTotals;
}
function validateRecords(records: Reservation[], allowPending: boolean) {
  if (!Array.isArray(records)) throw new Error('BUDGET_RECORD');
  const ids = new Set<string>();
  try {
    for (const row of records) {
      if (
        !row ||
        !['gemini', 'jev'].includes(row.provider) ||
        typeof row.id !== 'string' ||
        ids.has(row.id) ||
        !/^[a-f0-9]{64}$/.test(row.requestSha256) ||
        !['pending', 'known', 'unknown'].includes(row.state) ||
        (!allowPending && row.state === 'pending') ||
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
      } else if (row.chargedUsd !== row.reservedUsd) throw new Error('BUDGET_RECORD');
    }
  } catch {
    throw new Error('BUDGET_RECORD');
  }
}

/** Only reviewed v1→v2 and v2→v3 continuations. This is not a generic refill API.
 * Receipt/path/hash bindings are rechecked before every reservation. */
export function verifyCategoryCarry(
  path: string,
  sourceHash: string,
  options: CategoryCarryOptions,
  depth = 0,
): CategoryOpeningCarry {
  try {
    const raw = readFileSync(options.receiptPath, 'utf8');
    if (!/^[a-f0-9]{64}$/.test(options.receiptSha256) || sha(raw) !== options.receiptSha256)
      throw new Error();
    const receipt = JSON.parse(raw) as CategoryCarryReceipt;
    const first =
      receipt.fromRun === 'category-learning-20261031-v1' &&
      receipt.toRun === 'category-learning-20261031-v2' &&
      receipt.fromVersion === 'daybook-category-learning-v1' &&
      receipt.toVersion === 'daybook-category-learning-v2' &&
      receipt.reason === 'gemini-additive-billing-metadata-compatibility';
    const second =
      receipt.fromRun === 'category-learning-20261031-v2' &&
      receipt.toRun === 'category-learning-20261031-v3' &&
      receipt.fromVersion === 'daybook-category-learning-v2' &&
      receipt.toVersion === 'daybook-category-learning-v3' &&
      receipt.reason === 'jev-rounded-confidence-compatibility';
    if (
      !Number.isInteger(depth) ||
      depth < 0 ||
      depth > 1 ||
      (!first && !second) ||
      (depth === 1 && !first) ||
      (first && receipt.ancestorReceipt !== undefined) ||
      (second && !receipt.ancestorReceipt) ||
      receipt.schema !== 'category-reviewed-carry-v1' ||
      receipt.approved !== true ||
      receipt.targetSourceHash !== sourceHash ||
      receipt.targetLedgerPath !== resolve(path) ||
      basename(dirname(resolve(path))) !== receipt.toRun ||
      basename(path) !== 'budget.json' ||
      JSON.stringify(receipt.limits) !== JSON.stringify(CATEGORY_LIMITS) ||
      !Number.isFinite(Date.parse(receipt.approvedAt))
    )
      throw new Error();
    const predecessor = join(dirname(dirname(resolve(path))), receipt.fromRun);
    if (existsSync(join(predecessor, 'budget.json.lock')) || existsSync(join(predecessor, 'runner.lock')))
      throw new Error();
    const ledgerRaw = readFileSync(join(predecessor, 'budget.json'), 'utf8');
    if (sha(ledgerRaw) !== receipt.predecessorLedgerSha256) throw new Error();
    const ledger = JSON.parse(ledgerRaw) as Omit<Ledger, 'version'> & { version: number };
    if (
      ledger.version !== (first ? 1 : 2) ||
      ledger.state !== 'closed' ||
      ledger.sourceHash !== receipt.predecessorSourceHash ||
      !/^[a-f0-9]{64}$/.test(ledger.sourceHash) ||
      ledger.priceDate !== CATEGORY_PRICE_DATE ||
      JSON.stringify(ledger.prices) !== JSON.stringify(CATEGORY_PRICES) ||
      JSON.stringify(ledger.limits) !== JSON.stringify(CATEGORY_LIMITS) ||
      (first ? ledger.openingCarry !== undefined : !ledger.openingCarry)
    )
      throw new Error();
    validateRecords(ledger.records, false);
    if (!ledger.records.length) throw new Error();
    const ancestorCarry = second
      ? verifyCategoryCarry(
          join(predecessor, 'budget.json'),
          ledger.sourceHash,
          { ...receipt.ancestorReceipt!, keyFingerprints: options.keyFingerprints },
          depth + 1,
        )
      : undefined;
    if (ancestorCarry && JSON.stringify(ledger.openingCarry) !== JSON.stringify(ancestorCarry))
      throw new Error();
    const totals = addCategoryTotals(
      categoryBudgetTotals(ledger.records),
      ancestorCarry?.totals ?? categoryBudgetTotals([]),
    );
    if (
      JSON.stringify(totals) !== JSON.stringify(receipt.totals) ||
      Object.values(totals).some((t) => !count(t.attempts))
    )
      throw new Error();
    for (const provider of ['gemini', 'jev'] as const)
      if (
        totals[provider].attempts > CATEGORY_LIMITS[provider].attempts ||
        new Decimal(totals[provider].chargedUsd).gt(CATEGORY_LIMITS[provider].usd)
      )
        throw new Error();
    // An overrun cannot be cleared merely by opening a new version.
    if (ledger.records.some((r) => new Decimal(r.chargedUsd).gt(r.reservedUsd))) throw new Error();
    const required = [
      'manifest.json',
      'private-config.json',
      'halt.json',
      'closure.json',
      ...readdirSync(join(predecessor, 'observations'))
        .sort()
        .map((name) => `observations/${name}`),
    ].sort();
    if (JSON.stringify(Object.keys(receipt.artifactHashes).sort()) !== JSON.stringify(required))
      throw new Error();
    for (const [file, expected] of Object.entries(receipt.artifactHashes)) {
      if (
        !/^(manifest\.json|private-config\.json|halt\.json|closure\.json|observations\/\d{4}\.json)$/.test(
          file,
        ) ||
        !/^[a-f0-9]{64}$/.test(expected) ||
        sha(readFileSync(join(predecessor, file), 'utf8')) !== expected
      )
        throw new Error();
    }
    const manifest = JSON.parse(readFileSync(join(predecessor, 'manifest.json'), 'utf8'));
    if (
      manifest.run !== receipt.fromRun ||
      manifest.version !== receipt.fromVersion ||
      manifest.source.sourceHash !== receipt.predecessorSourceHash ||
      manifest.source.files['docs/CATEGORIZATION_PROTOCOL.md'] !== receipt.predecessorProtocolSha256 ||
      !/^[a-f0-9]{64}$/.test(receipt.predecessorProtocolSha256)
    )
      throw new Error();
    const previousConfig = JSON.parse(readFileSync(join(predecessor, 'private-config.json'), 'utf8'));
    if (
      ancestorCarry &&
      (JSON.stringify(manifest.openingCarry) !== JSON.stringify(ancestorCarry) ||
        JSON.stringify(previousConfig.openingCarry) !== JSON.stringify(ancestorCarry))
    )
      throw new Error();
    if (
      JSON.stringify(previousConfig.keyFingerprints) !== JSON.stringify(options.keyFingerprints) ||
      Object.values(options.keyFingerprints).some((hash) => !/^[a-f0-9]{64}$/.test(hash)) ||
      Object.keys(options.keyFingerprints).sort().join(',') !== 'gemini,jev'
    )
      throw new Error();
    return {
      receiptSha256: options.receiptSha256,
      fromRun: receipt.fromRun,
      predecessorLedgerSha256: receipt.predecessorLedgerSha256,
      predecessorSourceHash: receipt.predecessorSourceHash,
      predecessorProtocolSha256: receipt.predecessorProtocolSha256,
      artifactHashes: receipt.artifactHashes,
      totals,
      ...(ancestorCarry ? { ancestorCarry } : {}),
    };
  } catch {
    throw new Error('BUDGET_CARRY_BINDING');
  }
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
    private carryOptions?: CategoryCarryOptions,
  ) {
    if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('BUDGET_SOURCE_HASH');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.lock = path + '.lock';
    closeSync(openSync(this.lock, 'wx', 0o600));
    try {
      const openingCarry = carryOptions ? verifyCategoryCarry(path, sourceHash, carryOptions) : null;
      if (mode === 'create') {
        // Exclusive creation refuses to overwrite or reset any earlier spend.
        closeSync(openSync(path, 'wx', 0o600));
        this.ledger = {
          version: 2,
          sourceHash,
          priceDate: CATEGORY_PRICE_DATE,
          prices: CATEGORY_PRICES,
          state: 'open',
          limits: structuredClone(CATEGORY_LIMITS),
          records: [],
          openingCarry,
        };
      } else {
        this.ledger = JSON.parse(readFileSync(path, 'utf8')) as Ledger;
        if (
          this.ledger.version !== 2 ||
          this.ledger.sourceHash !== sourceHash ||
          this.ledger.state !== 'open' ||
          this.ledger.priceDate !== CATEGORY_PRICE_DATE ||
          JSON.stringify(this.ledger.prices) !== JSON.stringify(CATEGORY_PRICES) ||
          JSON.stringify(this.ledger.limits) !== JSON.stringify(CATEGORY_LIMITS) ||
          JSON.stringify(this.ledger.openingCarry) !== JSON.stringify(openingCarry) ||
          !Array.isArray(this.ledger.records)
        )
          throw new Error('BUDGET_BINDING');
        validateRecords(this.ledger.records, true);
        for (const row of this.ledger.records) {
          if (row.state === 'pending') {
            row.state = 'unknown';
            row.finishedAt = new Date().toISOString();
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
    if (
      this.carryOptions &&
      JSON.stringify(verifyCategoryCarry(this.path, this.ledger.sourceHash, this.carryOptions)) !==
        JSON.stringify(this.ledger.openingCarry)
    )
      throw new Error('BUDGET_CARRY_BINDING');
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
    const opening = this.ledger.openingCarry?.totals[provider];
    const charged = rows.reduce(
      (total, r) => total.plus(r.chargedUsd),
      new Decimal(opening?.chargedUsd ?? 0),
    );
    const limit = this.ledger.limits[provider];
    if (
      rows.length + (opening?.attempts ?? 0) >= limit.attempts ||
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
  accounting() {
    if (
      this.carryOptions &&
      JSON.stringify(verifyCategoryCarry(this.path, this.ledger.sourceHash, this.carryOptions)) !==
        JSON.stringify(this.ledger.openingCarry)
    )
      throw new Error('BUDGET_CARRY_BINDING');
    const currentRun = categoryBudgetTotals(this.ledger.records);
    const predecessor = this.ledger.openingCarry?.totals ?? categoryBudgetTotals([]);
    const cumulative = Object.fromEntries(
      (['gemini', 'jev'] as const).map((p) => [
        p,
        {
          attempts: currentRun[p].attempts + predecessor[p].attempts,
          knownUsd: new Decimal(currentRun[p].knownUsd).plus(predecessor[p].knownUsd).toFixed(12),
          unknownReservedUsd: new Decimal(currentRun[p].unknownReservedUsd)
            .plus(predecessor[p].unknownReservedUsd)
            .toFixed(12),
          chargedUsd: new Decimal(currentRun[p].chargedUsd).plus(predecessor[p].chargedUsd).toFixed(12),
        },
      ]),
    ) as CategoryTotals;
    return {
      predecessor,
      currentRun,
      cumulative,
      limits: structuredClone(CATEGORY_LIMITS),
      openingCarry: this.ledger.openingCarry,
    };
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
