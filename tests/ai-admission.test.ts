import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAiAdmission,
  createPostgresAiAdmissionStore,
  readAiAdmissionLimits,
  type AiAdmissionStore,
} from '../server/ai-admission';
import { config } from '../server/config';
import { pool, query, transaction, type Db } from '../server/db';
import { AppError, failureStage } from '../server/errors';

const limits = readAiAdmissionLimits({});
const orgId = '00000000-0000-4000-8000-000000000001';

describe('AI admission units (no database or providers)', () => {
  function fixture() {
    const leaseId = randomUUID();
    const store: AiAdmissionStore = {
      acquire: vi.fn().mockResolvedValue({ allowed: true, leaseId }),
      release: vi.fn().mockResolvedValue(undefined),
    };
    return { store, leaseId, admit: createAiAdmission(store, limits) };
  }

  it('has explicit bounded defaults and accepts restrictive configured limits', () => {
    expect(limits).toEqual({ requestsPerMinute: 12, requestsPerDay: 100, maxActive: 4, leaseSeconds: 90 });
    expect(
      readAiAdmissionLimits({
        AI_REQUESTS_PER_MINUTE: '2',
        AI_REQUESTS_PER_DAY: '1',
        AI_MAX_ACTIVE_REQUESTS: '1',
        AI_REQUEST_LEASE_SECONDS: '120',
      }),
    ).toEqual({
      requestsPerMinute: 2,
      requestsPerDay: 1,
      maxActive: 1,
      leaseSeconds: 120,
    });
  });

  it.each([
    ['AI_REQUESTS_PER_MINUTE', '0'],
    ['AI_REQUESTS_PER_MINUTE', '121'],
    ['AI_REQUESTS_PER_DAY', '10001'],
    ['AI_MAX_ACTIVE_REQUESTS', '5'],
    ['AI_REQUEST_LEASE_SECONDS', '89'],
    ['AI_REQUEST_LEASE_SECONDS', '301'],
    ['AI_REQUESTS_PER_MINUTE', '1.5'],
    ['AI_REQUESTS_PER_DAY', 'Infinity'],
    ['AI_REQUESTS_PER_DAY', 'PRIVATE_CONFIG_VALUE'],
  ])('rejects unsafe configuration for %s without repeating its value', (name, value) => {
    expect(() => readAiAdmissionLimits({ [name]: value })).toThrow(`Invalid ${name}`);
    try {
      readAiAdmissionLimits({ [name]: value });
    } catch (error) {
      expect(String(error)).not.toContain('PRIVATE_CONFIG_VALUE');
    }
  });

  it('acquires before work and releases the exact lease after successful work', async () => {
    const { store, leaseId, admit } = fixture();
    const callback = vi.fn(async () => {
      expect(store.acquire).toHaveBeenCalledExactlyOnceWith(orgId, limits);
      expect(store.release).not.toHaveBeenCalled();
      return { answer: 'synthetic result' };
    });
    expect(await admit(orgId, callback)).toEqual({ answer: 'synthetic result' });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(store.release).toHaveBeenCalledExactlyOnceWith(orgId, leaseId);
  });

  it('releases on callback failure while preserving the original failure and never retrying', async () => {
    const { store, leaseId, admit } = fixture();
    const original = new AppError(504, 'AI_TIMEOUT', 'Synthetic timeout');
    const callback = vi.fn().mockRejectedValue(original);
    await expect(admit(orgId, callback)).rejects.toBe(original);
    expect(store.acquire).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(store.release).toHaveBeenCalledExactlyOnceWith(orgId, leaseId);
  });

  it.each(['minute', 'day', 'concurrency'] as const)(
    'returns a bounded %s retry delay without work or releasing another lease',
    async (scope) => {
      const { store, admit } = fixture();
      vi.mocked(store.acquire).mockResolvedValue({ allowed: false, scope, retryAfterSeconds: 42 });
      const callback = vi.fn();
      await expect(admit(orgId, callback)).rejects.toMatchObject({
        status: 429,
        code: 'AI_REQUEST_LIMIT',
        details: { scope, retryAfterSeconds: 42 },
      });
      expect(callback).not.toHaveBeenCalled();
      expect(store.release).not.toHaveBeenCalled();
    },
  );

  it('fails closed with sanitized errors when admission storage is unavailable', async () => {
    const { store, admit } = fixture();
    vi.mocked(store.acquire).mockRejectedValue(new Error('PRIVATE_DATABASE_DETAILS'));
    const callback = vi.fn();
    const error = await admit(orgId, callback).catch((error: unknown) => error);
    expect(error).toMatchObject({ status: 503, code: 'AI_ADMISSION_UNAVAILABLE' });
    expect(failureStage(error)).toBe('database');
    expect(JSON.stringify(error)).not.toContain('PRIVATE_DATABASE_DETAILS');
    expect(callback).not.toHaveBeenCalled();
    expect(store.release).not.toHaveBeenCalled();
  });

  it.each([0, 86401, 1.5, Number.NaN])(
    'fails closed on malformed persisted retry metadata: %s',
    async (retryAfterSeconds) => {
      const { store, admit } = fixture();
      vi.mocked(store.acquire).mockResolvedValue({ allowed: false, scope: 'minute', retryAfterSeconds });
      const callback = vi.fn();
      await expect(admit(orgId, callback)).rejects.toMatchObject({ code: 'AI_ADMISSION_UNAVAILABLE' });
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it('does not turn a successful callback into success when release fails', async () => {
    const { store, admit } = fixture();
    vi.mocked(store.release).mockRejectedValue(new Error('PRIVATE_RELEASE_ERROR'));
    const callback = vi.fn().mockResolvedValue('already completed once');
    await expect(admit(orgId, callback)).rejects.toMatchObject({ code: 'AI_ADMISSION_UNAVAILABLE' });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(store.release).toHaveBeenCalledTimes(1);
  });

  it('preserves a request failure if release also fails', async () => {
    const { store, admit } = fixture();
    vi.mocked(store.release).mockRejectedValue(new Error('PRIVATE_RELEASE_ERROR'));
    const original = new AppError(429, 'AI_RATE_LIMIT', 'Provider limit');
    await expect(
      admit(orgId, async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(store.release).toHaveBeenCalledTimes(1);
  });

  it('validates the server-owned workspace and copies configuration before using storage', async () => {
    const { store } = fixture();
    const configuration = { ...limits };
    const admit = createAiAdmission(store, configuration);
    configuration.requestsPerMinute = 120;
    const callback = vi.fn().mockResolvedValue(undefined);
    await expect(admit('arbitrary-client-tenant', callback)).rejects.toMatchObject({
      code: 'INVALID_WORKSPACE',
    });
    expect(store.acquire).not.toHaveBeenCalled();
    await admit(orgId, callback);
    expect(store.acquire).toHaveBeenCalledWith(orgId, limits);
    expect(Object.isFrozen(vi.mocked(store.acquire).mock.calls[0][1])).toBe(true);
  });
});

describe('AI admission PostgreSQL integration (isolated local/CI workspaces)', () => {
  const admin = new pg.Client({ connectionString: config.migrationUrl });
  const independentPool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
  let connected = false;
  let org: string;
  beforeAll(async () => {
    for (const value of [config.databaseUrl, config.migrationUrl]) {
      const url = new URL(value);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      const compose =
        process.env.NODE_ENV === 'test' &&
        url.hostname === 'db' &&
        url.port === '5432' &&
        url.pathname === '/spiich';
      if (!local && !compose)
        throw new Error('Admission integration tests require isolated local/CI PostgreSQL.');
    }
    await admin.connect();
    connected = true;
  });
  beforeEach(async () => {
    org = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Synthetic AI admission test')", [org]);
  });
  afterAll(async () => {
    if (connected) await admin.end();
    await independentPool.end();
    await pool.end();
  });

  async function independentTransaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
    const client = await independentPool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async function state() {
    return (
      await query<{ minute_count: number; day_count: number }>(
        'SELECT minute_count,day_count FROM ai_admission_state WHERE organization_id=$1',
        [org],
      )
    )[0];
  }

  it('serializes simultaneous admission across independent pools and never starts more than four callbacks', async () => {
    const one = createAiAdmission(createPostgresAiAdmissionStore(), {
      ...limits,
      requestsPerMinute: 120,
      requestsPerDay: 1000,
    });
    const two = createAiAdmission(createPostgresAiAdmissionStore(independentTransaction), {
      ...limits,
      requestsPerMinute: 120,
      requestsPerDay: 1000,
    });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const callback = vi.fn(() => gate);
    const failures: unknown[] = [];
    const attempts = Array.from({ length: 10 }, (_, index) =>
      (index % 2 ? one : two)(org, callback).catch((error: unknown) => {
        failures.push(error);
      }),
    );
    try {
      await vi.waitFor(
        () => {
          expect(callback).toHaveBeenCalledTimes(4);
          expect(failures).toHaveLength(6);
        },
        { timeout: 10000 },
      );
      expect(
        failures.every(
          (error) =>
            error instanceof AppError &&
            error.code === 'AI_REQUEST_LIMIT' &&
            (error.details as { scope: string }).scope === 'concurrency',
        ),
      ).toBe(true);
      expect((await query('SELECT id FROM ai_admission_leases WHERE organization_id=$1', [org])).length).toBe(
        4,
      );
      expect(await state()).toEqual({ minute_count: 4, day_count: 4 });
    } finally {
      finish();
      await Promise.all(attempts);
    }
    expect(await query('SELECT id FROM ai_admission_leases WHERE organization_id=$1', [org])).toEqual([]);
  });

  it('retains failed-request charges after release and across a new instance', async () => {
    const small = { ...limits, requestsPerDay: 2 };
    const first = createAiAdmission(createPostgresAiAdmissionStore(), small);
    const original = new AppError(504, 'AI_TIMEOUT', 'Synthetic provider timeout');
    await expect(
      first(org, async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    await first(org, async () => 'success');
    const restarted = createAiAdmission(createPostgresAiAdmissionStore(independentTransaction), small);
    const blocked = vi.fn();
    await expect(restarted(org, blocked)).rejects.toMatchObject({
      code: 'AI_REQUEST_LIMIT',
      details: { scope: 'day' },
    });
    expect(blocked).not.toHaveBeenCalled();
    expect((await state()).day_count).toBe(2);
    expect(await query('SELECT id FROM ai_admission_leases WHERE organization_id=$1', [org])).toEqual([]);
  });

  it('enforces the minute allowance independently of the day allowance, without refund on release', async () => {
    const admit = createAiAdmission(createPostgresAiAdmissionStore(), { ...limits, requestsPerMinute: 2 });
    await admit(org, async () => undefined);
    await admit(org, async () => undefined);
    // Put the already consumed window one minute ahead to make the boundary
    // assertion deterministic even if CI happens to cross a real minute here.
    await admin.query(
      'UPDATE ai_admission_state SET minute_start_epoch=floor(extract(epoch FROM clock_timestamp())/60)::bigint*60+60,minute_count=2 WHERE organization_id=$1',
      [org],
    );
    await expect(admit(org, async () => undefined)).rejects.toMatchObject({
      code: 'AI_REQUEST_LIMIT',
      details: { scope: 'minute' },
    });
    expect((await state()).day_count).toBe(2);
  });

  it('rolls only elapsed database-clock windows and preserves the current daily count', async () => {
    const admit = createAiAdmission(createPostgresAiAdmissionStore(), { ...limits, requestsPerMinute: 1 });
    await admit(org, async () => undefined);
    await admin.query(
      'UPDATE ai_admission_state SET minute_start_epoch=floor(extract(epoch FROM clock_timestamp())/60)::bigint*60-60 WHERE organization_id=$1',
      [org],
    );
    await admit(org, async () => undefined);
    expect(await state()).toEqual({ minute_count: 1, day_count: 2 });
    await admin.query(
      'UPDATE ai_admission_state SET minute_start_epoch=minute_start_epoch-60,day_start_epoch=day_start_epoch-86400 WHERE organization_id=$1',
      [org],
    );
    await admit(org, async () => undefined);
    expect(await state()).toEqual({ minute_count: 1, day_count: 1 });
  });

  it('does not reset future windows on clock rollback and clamps its Retry-After', async () => {
    const admit = createAiAdmission(createPostgresAiAdmissionStore(), limits);
    await admit(org, async () => undefined);
    await admin.query(
      'UPDATE ai_admission_state SET minute_start_epoch=minute_start_epoch+3600,minute_count=12,day_start_epoch=day_start_epoch+172800,day_count=100 WHERE organization_id=$1',
      [org],
    );
    await expect(admit(org, async () => undefined)).rejects.toMatchObject({
      code: 'AI_REQUEST_LIMIT',
      details: { scope: 'day', retryAfterSeconds: 86400 },
    });
    expect(await state()).toEqual({ minute_count: 12, day_count: 100 });
  });

  it('recovers expired leases without erasing their consumed counts or touching another workspace', async () => {
    const store = createPostgresAiAdmissionStore();
    const leases = await Promise.all(Array.from({ length: 4 }, () => store.acquire(org, limits)));
    expect(leases.every((lease) => lease.allowed)).toBe(true);
    await admin.query(
      "UPDATE ai_admission_leases SET acquired_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE organization_id=$1",
      [org],
    );
    const replacement = await store.acquire(org, limits);
    expect(replacement.allowed).toBe(true);
    expect((await state()).day_count).toBe(5);
    expect((await query('SELECT id FROM ai_admission_leases WHERE organization_id=$1', [org])).length).toBe(
      1,
    );
    if (replacement.allowed) {
      await store.release(randomUUID(), replacement.leaseId);
      expect((await query('SELECT id FROM ai_admission_leases WHERE organization_id=$1', [org])).length).toBe(
        1,
      );
      await store.release(org, replacement.leaseId);
      await store.release(org, replacement.leaseId);
      expect(await query('SELECT id FROM ai_admission_leases WHERE organization_id=$1', [org])).toEqual([]);
    }
  });

  it('keeps workspace counters and concurrency independent', async () => {
    const otherOrg = randomUUID();
    await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Other synthetic admission workspace')", [
      otherOrg,
    ]);
    const store = createPostgresAiAdmissionStore();
    const restricted = { ...limits, maxActive: 1 };
    const lease = await store.acquire(org, restricted);
    expect(lease.allowed).toBe(true);
    await expect(createAiAdmission(store, restricted)(otherOrg, async () => 'other success')).resolves.toBe(
      'other success',
    );
    await expect(createAiAdmission(store, restricted)(org, async () => undefined)).rejects.toMatchObject({
      details: { scope: 'concurrency' },
    });
    if (lease.allowed) await store.release(org, lease.leaseId);
  });

  it('cleans at most 64 expired leases per admission rather than sweeping global history', async () => {
    await admin.query(
      `INSERT INTO ai_admission_leases(id,organization_id,acquired_at,expires_at)
      SELECT gen_random_uuid(),$1,clock_timestamp()-interval '5 minutes',clock_timestamp()-interval '4 minutes' FROM generate_series(1,130)`,
      [org],
    );
    await createAiAdmission(createPostgresAiAdmissionStore(), limits)(org, async () => undefined);
    const [left] = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM ai_admission_leases WHERE organization_id=$1',
      [org],
    );
    expect(Number(left.count)).toBe(66);
    expect(await state()).toEqual({ minute_count: 1, day_count: 1 });
  });

  it('rolls back both reservation and counter if admission transaction completion fails', async () => {
    const rollback = async <T>(work: (db: Db) => Promise<T>): Promise<T> =>
      transaction(async (db) => {
        await work(db);
        throw new Error('Synthetic failure before commit');
      });
    const callback = vi.fn();
    await expect(
      createAiAdmission(createPostgresAiAdmissionStore(rollback), limits)(org, callback),
    ).rejects.toMatchObject({ code: 'AI_ADMISSION_UNAVAILABLE' });
    expect(callback).not.toHaveBeenCalled();
    expect(
      await query('SELECT organization_id FROM ai_admission_state WHERE organization_id=$1', [org]),
    ).toEqual([]);
    expect(await query('SELECT id FROM ai_admission_leases WHERE organization_id=$1', [org])).toEqual([]);
  });
});
