import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query, transaction, type Db } from './db';
import { AppError, markFailure } from './errors';

const limitsSchema = z.strictObject({
  requestsPerMinute: z.number().int().min(1).max(120),
  requestsPerDay: z.number().int().min(1).max(10000),
  maxActive: z.number().int().min(1).max(4),
  leaseSeconds: z.number().int().min(90).max(300),
});
export type AiAdmissionLimits = z.infer<typeof limitsSchema>;

/** Fixed UTC windows, shared across AI endpoints. These are request limits,
 * not a dollar budget; application processes must use the same configuration. */
export function readAiAdmissionLimits(env: NodeJS.ProcessEnv = process.env): AiAdmissionLimits {
  function integer(name: string, fallback: number, minimum: number, maximum: number) {
    const raw = env[name];
    if (raw === undefined) return fallback;
    if (!/^[1-9]\d{0,5}$/.test(raw.trim()))
      throw new Error(`Invalid ${name}: expected a bounded positive integer.`);
    const value = Number(raw.trim());
    if (value < minimum || value > maximum)
      throw new Error(`Invalid ${name}: value is outside its allowed range.`);
    return value;
  }
  return limitsSchema.parse({
    requestsPerMinute: integer('AI_REQUESTS_PER_MINUTE', 12, 1, 120),
    requestsPerDay: integer('AI_REQUESTS_PER_DAY', 100, 1, 10000),
    maxActive: integer('AI_MAX_ACTIVE_REQUESTS', 4, 1, 4),
    leaseSeconds: integer('AI_REQUEST_LEASE_SECONDS', 90, 90, 300),
  });
}

const decisionSchema = z.discriminatedUnion('allowed', [
  z.strictObject({ allowed: z.literal(true), leaseId: z.uuid() }),
  z.strictObject({
    allowed: z.literal(false),
    scope: z.enum(['minute', 'day', 'concurrency']),
    retryAfterSeconds: z.number().int().min(1).max(86400),
  }),
]);
type AdmissionDecision = z.infer<typeof decisionSchema>;
export type AiAdmissionStore = {
  acquire(org: string, limits: AiAdmissionLimits): Promise<AdmissionDecision>;
  release(org: string, leaseId: string): Promise<void>;
};
type AdmissionTransaction = <T>(read: (db: Db) => Promise<T>) => Promise<T>;
const databaseStateSchema = z.strictObject({
  minute_start_epoch: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  minute_count: z.number().int().nonnegative(),
  day_start_epoch: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  day_count: z.number().int().nonnegative(),
});
const boundedRetry = (seconds: number) => Math.min(86400, Math.max(1, Math.ceil(seconds)));

/** Each instance uses the same database lock and counters. No process clock or
 * process-local allowance participates in the admission decision. */
export function createPostgresAiAdmissionStore(
  transact: AdmissionTransaction = transaction,
): AiAdmissionStore {
  return {
    acquire(org, limits) {
      return transact(async (db) => {
        await query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [`daybook:ai-admission:${org}`],
          db,
        );
        const [clock] = await query<{ seconds: string }>(
          'SELECT floor(extract(epoch FROM clock_timestamp()))::bigint::text AS seconds',
          [],
          db,
        );
        const now = z.coerce
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER - 86400)
          .parse(clock?.seconds);
        const minute = Math.floor(now / 60) * 60;
        const day = Math.floor(now / 86400) * 86400;
        const [row] = await query(
          `INSERT INTO ai_admission_state(organization_id,minute_start_epoch,minute_count,day_start_epoch,day_count,updated_at)
           VALUES($1,$2,0,$3,0,to_timestamp($4))
           ON CONFLICT(organization_id) DO UPDATE SET
             minute_count=CASE WHEN ai_admission_state.minute_start_epoch<$2 THEN 0 ELSE ai_admission_state.minute_count END,
             minute_start_epoch=greatest(ai_admission_state.minute_start_epoch,$2),
             day_count=CASE WHEN ai_admission_state.day_start_epoch<$3 THEN 0 ELSE ai_admission_state.day_count END,
             day_start_epoch=greatest(ai_admission_state.day_start_epoch,$3),updated_at=to_timestamp($4)
           RETURNING minute_start_epoch,minute_count,day_start_epoch,day_count`,
          [org, minute, day, now],
          db,
        );
        const state = databaseStateSchema.parse(row);
        // Bounded cleanup only touches expired operational leases for this workspace.
        await query(
          `DELETE FROM ai_admission_leases WHERE id IN (
             SELECT id FROM ai_admission_leases WHERE organization_id=$1 AND expires_at<=to_timestamp($2)
             ORDER BY expires_at,id LIMIT 64)`,
          [org, now],
          db,
        );
        if (state.day_count >= limits.requestsPerDay)
          return {
            allowed: false,
            scope: 'day',
            retryAfterSeconds: boundedRetry(state.day_start_epoch + 86400 - now),
          };
        if (state.minute_count >= limits.requestsPerMinute)
          return {
            allowed: false,
            scope: 'minute',
            retryAfterSeconds: boundedRetry(state.minute_start_epoch + 60 - now),
          };
        const [active] = await query<{ count: string; next_expiry: string | null }>(
          `SELECT count(*)::text AS count,min(extract(epoch FROM expires_at))::text AS next_expiry
           FROM ai_admission_leases WHERE organization_id=$1 AND expires_at>to_timestamp($2)`,
          [org, now],
          db,
        );
        const count = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(active?.count);
        if (count >= limits.maxActive) {
          const nextExpiry = z.coerce.number().finite().min(now).parse(active?.next_expiry);
          return { allowed: false, scope: 'concurrency', retryAfterSeconds: boundedRetry(nextExpiry - now) };
        }
        const leaseId = randomUUID();
        await query(
          `INSERT INTO ai_admission_leases(id,organization_id,acquired_at,expires_at)
           VALUES($1,$2,to_timestamp($3),to_timestamp($3)+$4*interval '1 second')`,
          [leaseId, org, now, limits.leaseSeconds],
          db,
        );
        await query(
          `UPDATE ai_admission_state SET minute_count=minute_count+1,day_count=day_count+1
           WHERE organization_id=$1`,
          [org],
          db,
        );
        return { allowed: true, leaseId };
      });
    },
    async release(org, leaseId) {
      await transact(async (db) => {
        await query('DELETE FROM ai_admission_leases WHERE organization_id=$1 AND id=$2', [org, leaseId], db);
      });
    },
  };
}

function unavailable() {
  return markFailure(
    new AppError(
      503,
      'AI_ADMISSION_UNAVAILABLE',
      'The assistant request limit could not be checked or released. Please try again shortly.',
    ),
    'database',
  );
}

/** Reject before invoking the callback. An admitted request consumes its count
 * even when the callback fails; release only frees its active lease. */
export function createAiAdmission(
  store: AiAdmissionStore,
  configuration: AiAdmissionLimits = readAiAdmissionLimits(),
) {
  const limits = Object.freeze(limitsSchema.parse(configuration));
  return async function withAdmission<T>(org: string, callback: () => Promise<T>): Promise<T> {
    if (!z.uuid().safeParse(org).success)
      throw new AppError(400, 'INVALID_WORKSPACE', 'A valid workspace is required.');
    let decision: AdmissionDecision;
    try {
      decision = decisionSchema.parse(await store.acquire(org, limits));
    } catch {
      throw unavailable();
    }
    if (!decision.allowed)
      throw new AppError(
        429,
        'AI_REQUEST_LIMIT',
        decision.scope === 'concurrency'
          ? 'The workspace already has several assistant requests running. Please try again shortly.'
          : 'This workspace has reached its assistant request allowance. Please try again later.',
        { scope: decision.scope, retryAfterSeconds: decision.retryAfterSeconds },
      );
    let failed = false;
    try {
      return await callback();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await store.release(org, decision.leaseId);
      } catch {
        // Preserve an existing request failure. A release failure after success
        // fails closed; the retained lease expires instead of allowing a retry.
        if (!failed) throw unavailable();
      }
    }
  };
}

export const withAiAdmission = createAiAdmission(createPostgresAiAdmissionStore());
