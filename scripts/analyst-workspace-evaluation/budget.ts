import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { AnalystModelAttempt, AnalystModelReceipt } from '../../server/analyst-model';
import type { GlobalAnalystBudget } from './native-runner';
import { hash, requireFixture } from './references';

const LIMIT = 5_000_000_000;
/** Preserve the complete prior ledger while fitting the CI secret transport limit. */
export function decodeBudgetSeed(value: string): string {
  const maximum = 2 * 1024 * 1024;
  requireFixture(Buffer.byteLength(value) <= maximum, 'BUDGET_SEED_SIZE');
  const prefix = value.startsWith('gzip-base64:')
    ? 'gzip-base64:'
    : value.startsWith('brotli-base64:')
      ? 'brotli-base64:'
      : null;
  if (!prefix) return value;
  const encoded = value.slice(prefix.length);
  requireFixture(
    encoded.length > 0 &&
      encoded.length <= 48_000 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) &&
      Buffer.from(encoded, 'base64').toString('base64') === encoded,
    'BUDGET_SEED_ENCODING',
  );
  try {
    const decompress = prefix === 'gzip-base64:' ? gunzipSync : brotliDecompressSync;
    return decompress(Buffer.from(encoded, 'base64'), { maxOutputLength: maximum }).toString('utf8');
  } catch {
    requireFixture(false, 'BUDGET_SEED_ENCODING');
    throw new Error('Unreachable');
  }
}
export function nanoUsd(value: unknown): number {
  requireFixture(typeof value === 'string' && /^\d+(?:\.\d{1,9})?$/.test(value), 'INVALID_LEDGER_AMOUNT');
  const [whole, decimals = ''] = value.split('.');
  const amount = BigInt(whole) * 1_000_000_000n + BigInt(decimals.padEnd(9, '0'));
  requireFixture(amount <= BigInt(Number.MAX_SAFE_INTEGER), 'INVALID_LEDGER_AMOUNT');
  return Number(amount);
}
const dollars = (value: number) =>
  `${Math.floor(value / 1_000_000_000)}.${String(value % 1_000_000_000).padStart(9, '0')}`;
type NativeAttempt = AnalystModelAttempt & {
  provider: 'gemini';
  cohort: string;
  receipt?: AnalystModelReceipt;
};

/** One serial CI process owns this copy. The next cohort must import the complete encrypted final ledger. */
export function createFileBudget(options: {
  seed: string;
  seedSha256: string;
  path: string;
  scopeId: string;
  cohort: string;
}): GlobalAnalystBudget {
  requireFixture(hash(options.seed) === options.seedSha256, 'BUDGET_SEED_HASH');
  const seed = JSON.parse(options.seed) as Record<string, unknown>;
  requireFixture(
    seed && Array.isArray(seed.attempts) && nanoUsd(seed.limitUsd) === LIMIT,
    'BUDGET_SEED_SHAPE',
  );
  const priorKnown = nanoUsd(seed.knownEstimatedUsd),
    priorUnknown = nanoUsd(seed.unknownReservedUsd);
  requireFixture(
    priorKnown + priorUnknown <= LIMIT && !existsSync(options.path),
    'BUDGET_SEED_OR_OUTPUT_INVALID',
  );
  const current: NativeAttempt[] = [];
  const priorIds = new Set((seed.attempts as Record<string, unknown>[]).map((a) => a.attemptId ?? a.id));
  let locked = false;
  const totals = () => {
    let known = priorKnown,
      unknown = priorUnknown;
    for (const attempt of current) {
      if (attempt.receipt?.kind === 'known') known += attempt.receipt.costNanoUsd;
      else unknown += attempt.reservationNanoUsd;
    }
    requireFixture(Number.isSafeInteger(known + unknown), 'BUDGET_OVERFLOW');
    return { known, unknown };
  };
  const persist = () => {
    const { known, unknown } = totals();
    const next = {
      ...seed,
      knownEstimatedUsd: dollars(known),
      unknownReservedUsd: dollars(unknown),
      attempts: [...(seed.attempts as unknown[]), ...current],
      nativeLedgerReceipt: {
        scopeId: options.scopeId,
        cohort: options.cohort,
        seedSha256: options.seedSha256,
      },
    };
    const temporary = `${options.path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(next, null, 2) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, options.path);
  };
  const exclusive = (fn: () => void) => {
    requireFixture(!locked, 'BUDGET_CONCURRENT_MUTATION');
    const lockPath = `${options.path}.lock`;
    const fd = openSync(lockPath, 'wx', 0o600);
    locked = true;
    try {
      fn();
    } finally {
      locked = false;
      closeSync(fd);
      unlinkSync(lockPath);
    }
  };
  persist();
  return {
    async snapshot() {
      const { known, unknown } = totals();
      return { scopeId: options.scopeId, limitNanoUsd: LIMIT, consumedNanoUsd: known + unknown };
    },
    async beforeDispatch(attempt) {
      exclusive(() => {
        requireFixture(
          !priorIds.has(attempt.attemptId) && !current.some((a) => a.attemptId === attempt.attemptId),
          'BUDGET_DUPLICATE_ATTEMPT',
        );
        requireFixture(
          Number.isSafeInteger(attempt.reservationNanoUsd) &&
            attempt.reservationNanoUsd > 0 &&
            attempt.modelId === 'gemini-3.8-flash',
          'BUDGET_INVALID_ATTEMPT',
        );
        const { known, unknown } = totals();
        requireFixture(
          known + unknown + attempt.reservationNanoUsd <= LIMIT,
          'GLOBAL_ANALYST_BUDGET_EXHAUSTED',
        );
        current.push({ ...attempt, provider: 'gemini', cohort: options.cohort });
        persist(); // durable reservation must finish before the provider fetch is allowed
      });
    },
    async afterResponse(receipt) {
      exclusive(() => {
        const attempt = current.find((a) => a.attemptId === receipt.attemptId);
        requireFixture(
          attempt &&
            attempt.requestSha256 === receipt.requestSha256 &&
            attempt.reservationNanoUsd === receipt.reservationNanoUsd,
          'BUDGET_UNRESERVED_RECEIPT',
        );
        if (attempt.receipt) {
          requireFixture(
            JSON.stringify(attempt.receipt) === JSON.stringify(receipt),
            'BUDGET_CONFLICTING_RECEIPT',
          );
          return;
        }
        if (receipt.kind === 'known')
          requireFixture(
            Number.isSafeInteger(receipt.costNanoUsd) && receipt.costNanoUsd >= 0,
            'BUDGET_INVALID_RECEIPT',
          );
        attempt.receipt = receipt;
        persist(); // unknown usage keeps its whole reservation; actual excess remains recorded
      });
    },
  };
}

export function readBudgetReceipt(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}
