import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { ANALYST_SQL_LIMITS, createAnalystSql, validateAnalystSql } from '../server/analyst-sql';

const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
afterEach(() => vi.useRealTimers());
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const positive = [
  "SELECT sum(base_debit-base_credit) AS expense FROM analytics.ledger WHERE status='POSTED' AND account_type='EXPENSE'",
  "WITH expenses AS (SELECT account_id,sum(base_debit-base_credit) AS amount FROM analytics.ledger WHERE account_type='EXPENSE' GROUP BY account_id) SELECT a.name,e.amount FROM expenses e JOIN analytics.accounts a ON a.id=e.account_id ORDER BY e.amount DESC",
  "WITH months AS (SELECT generate_series(DATE '2026-01-01',DATE '2026-11-01',INTERVAL '1 month') AS month), totals AS (SELECT date_trunc('month',date) AS month,sum(base_debit-base_credit) AS total,sum(base_debit-base_credit) FILTER(WHERE account_code='5010') AS rent FROM analytics.ledger WHERE account_type='EXPENSE' AND status='POSTED' GROUP BY 1) SELECT m.month,coalesce(t.rent,0)::numeric/nullif(t.total,0)*100 AS percent FROM months m LEFT JOIN totals t USING(month)",
  'SELECT account_id,date,sum(base_debit-base_credit) OVER(PARTITION BY account_id ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running FROM analytics.ledger',
  'SELECT date,lag(base_debit) OVER(ORDER BY date) AS previous,row_number() OVER(ORDER BY date) AS rank FROM analytics.ledger',
  'SELECT DISTINCT ON (account_id) account_id,date FROM analytics.ledger ORDER BY account_id,date DESC',
  'SELECT e.id FROM analytics.entries e WHERE EXISTS(SELECT 1 FROM analytics.lines l WHERE l.entry_id=e.id AND l.base_debit>0)',
  "SELECT id,status FROM analytics.entries WHERE status='POSTED' UNION ALL SELECT id,status FROM analytics.entries WHERE status='DRAFT'",
  'SELECT account_id,sum(base_debit) AS total FROM analytics.ledger GROUP BY GROUPING SETS ((account_id),())',
  "SELECT current_date,extract(month FROM date) AS month,CASE WHEN status='POSTED' THEN base_debit ELSE 0 END AS amount FROM analytics.ledger",
  "SELECT evidence->>'amount' AS amount,jsonb_typeof(evidence) AS kind FROM analytics.alerts",
  "SELECT r.id,j.value->>'accountId' AS account FROM analytics.recurring r CROSS JOIN LATERAL jsonb_array_elements(r.lines) j(value)",
  "WITH assumptions AS (SELECT 1200.50::numeric AS monthly_cost) SELECT sum(l.base_debit-l.base_credit)-max(a.monthly_cost) AS hypothetical FROM analytics.ledger l CROSS JOIN assumptions a WHERE l.is_cash AND l.status='POSTED'",
  "SELECT 'DELETE; DROP TABLE public.accounts' AS description, /* ; UPDATE */ sum(base_debit) AS total FROM analytics.ledger; -- end",
  "SELECT \"account_name\" FROM analytics.ledger WHERE description ILIKE '%rent%' AND organization_id='22222222-2222-4222-8222-222222222222'",
  'WITH RECURSIVE tree AS (SELECT id,parent_id FROM analytics.accounts WHERE parent_id IS NULL UNION ALL SELECT a.id,a.parent_id FROM analytics.accounts a JOIN tree t ON a.parent_id=t.id) SELECT * FROM tree',
  'SELECT base_debit OPERATOR(pg_catalog.+) base_credit AS amount FROM analytics.ledger',
  'SELECT id FROM analytics.entries WHERE id=ANY($1::uuid[])',
  'SELECT a.id FROM analytics.accounts a CROSS JOIN (WITH x AS(SELECT 1 AS n) SELECT n FROM x) nested',
  "SELECT 1 AS assumption, 'αβ' AS label",
  "SELECT id FROM analytics.entries WHERE date BETWEEN DATE '2026-01-01' AND DATE '2026-11-03'",
  "SELECT id FROM analytics.entries WHERE date NOT BETWEEN DATE '2026-01-01' AND DATE '2026-11-03'",
  "SELECT id FROM analytics.entries WHERE date BETWEEN SYMMETRIC DATE '2026-11-03' AND DATE '2026-01-01'",
  "SELECT id FROM analytics.entries WHERE date NOT BETWEEN SYMMETRIC DATE '2026-11-03' AND DATE '2026-01-01'",
  "SELECT regexp_replace(counterparty,'[^a-z]','','g') AS normalized FROM analytics.entries WHERE counterparty ~* 'acme'",
  "SELECT description FROM analytics.entries WHERE description SIMILAR TO 'Rent%'",
  'SELECT name FROM analytics.accounts ORDER BY name COLLATE "C"',
  'SELECT ln(10::numeric) AS logarithm,log(100::numeric) AS log10',
];
const attacks = [
  'SELECT 1; SELECT 2',
  'DELETE FROM analytics.accounts',
  'WITH changed AS(DELETE FROM public.accounts RETURNING id) SELECT id FROM changed',
  "WITH changed AS(INSERT INTO public.organizations(name) VALUES('x') RETURNING id) SELECT id FROM changed",
  'SELECT * INTO TEMP stolen FROM analytics.accounts',
  'SELECT * FROM analytics.accounts FOR UPDATE',
  'SELECT * FROM public.accounts',
  'SELECT * FROM pg_catalog.pg_class',
  'SELECT * FROM information_schema.tables',
  'SELECT * FROM pg_temp.accounts',
  'SELECT * FROM database.analytics.accounts',
  "SELECT set_config('daybook.organization_id','other',true)",
  "SELECT CASE WHEN true THEN set_config('role','spiich_app',true) ELSE '' END",
  "WITH a AS(SELECT pg_catalog.set_config('role','spiich_app',true)) SELECT * FROM a",
  "SELECT current_setting('role')",
  'SELECT current_user',
  'SELECT session_user',
  'SELECT pg_sleep(3)',
  "SELECT dblink('x','SELECT 1')",
  "SELECT pg_read_file('/etc/passwd')",
  "SELECT lo_import('/etc/passwd')",
  "SELECT nextval('public.journal_entries_number_seq')",
  'SELECT public.sum(base_debit) FROM analytics.ledger',
  'SELECT 1 OPERATOR(public.+) 2',
  "SELECT 'x'::public.secret_domain",
  "SELECT 'accounts'::regclass",
  'SELECT * FROM analytics.analyst_conversations',
  "SELECT * FROM analytics.accounts a CROSS JOIN LATERAL pg_catalog.pg_ls_dir('/') d",
  'SELECT * FROM (WITH pg_class AS(SELECT 1 AS x) SELECT x FROM pg_class) x CROSS JOIN pg_class',
  'WITH a AS(SELECT * FROM pg_class),pg_class AS(SELECT 1 AS x) SELECT * FROM a',
  'SELECT * FROM analytics.accounts TABLESAMPLE SYSTEM(10)',
  "SELECT id FROM analytics.entries WHERE date BETWEEN current_date AND set_config('role','spiich_app',true)::date",
  'SELECT name FROM analytics.accounts ORDER BY name COLLATE public."C"',
];

describe('native analyst PostgreSQL capability policy', () => {
  it.each(positive)('allows broad analytical composition: %s', async (sql) => {
    const validated = await validateAnalystSql({
      id: 'query',
      sql,
      params: sql.includes('$1') ? ['{}'] : [],
    });
    expect(validated.sql).toBeTruthy();
    expect(await validateAnalystSql(validated)).toEqual(validated);
  });
  it.each(attacks)('rejects capability escape: %s', async (sql) => {
    await expect(validateAnalystSql({ id: 'query', sql })).rejects.toMatchObject({
      code: 'ANALYST_SQL_POLICY',
    });
  });
  it('rejects unsupported syntax, absent parameters and oversized programs', async () => {
    await expect(validateAnalystSql({ id: 'query', sql: 'SELECT broken (' })).rejects.toMatchObject({
      code: 'ANALYST_SQL_PARSE',
    });
    await expect(validateAnalystSql({ id: 'query', sql: 'SELECT $1' })).rejects.toMatchObject({
      code: 'ANALYST_SQL_INPUT',
    });
    await expect(
      validateAnalystSql({ id: 'query', sql: ' '.repeat(ANALYST_SQL_LIMITS.sqlBytes + 1) }),
    ).rejects.toMatchObject({ code: 'ANALYST_SQL_LIMIT' });
  });
  it.each([0.1, 90071992547409.93, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    'requires decimal strings instead of lossy numeric parameter %s',
    async (value) => {
      await expect(
        validateAnalystSql({ id: 'q', sql: 'SELECT $1::numeric AS amount', params: [value] }),
      ).rejects.toMatchObject({ code: 'ANALYST_SQL_INPUT' });
    },
  );
  it('preserves decimal-string parameters without silently converting a financial amount', async () => {
    const value = '90071992547409.93';
    expect(
      (await validateAnalystSql({ id: 'q', sql: 'SELECT $1::numeric AS amount', params: [value] })).params,
    ).toEqual([value]);
    expect((await validateAnalystSql({ id: 'q', sql: 'SELECT $1 AS count', params: [100] })).params).toEqual([
      100,
    ]);
  });
});

function setupResult(input: unknown) {
  return {
    fields: [],
    rows: typeof input === 'string' && input.includes("set_config('TimeZone'") ? [['America/New_York']] : [],
  };
}
function fixture(result: { fields?: { name: string; dataTypeID: number }[]; rows?: unknown[][] } = {}) {
  let next = {
    fields: result.fields ?? [{ name: 'amount', dataTypeID: 1700 }],
    rows: result.rows ?? [['9007199254740993.01']],
  };
  const query = vi.fn(async (input: unknown) =>
    typeof input === 'string' || !input ? setupResult(input) : next,
  );
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }) as unknown as PoolClient);
  let time = 0;
  const sql = createAnalystSql({ connect, now: () => new Date(Date.UTC(2026, 10, 3, 0, 0, time++)) });
  return {
    sql,
    query,
    release,
    connect,
    setResult: (result: typeof next) => {
      next = result;
    },
  };
}
describe('native analyst query snapshots and materializations', () => {
  it('fails before generated SQL if the scoped organization is unavailable', async () => {
    const f = fixture();
    f.query.mockImplementation(async () => ({ fields: [], rows: [] }));
    await expect(f.sql.query(org, { id: 'q', sql: 'SELECT 1' })).rejects.toMatchObject({
      code: 'ANALYST_SQL_SCOPE',
    });
    expect(f.query.mock.calls.some(([arg]) => typeof arg === 'object')).toBe(false);
    expect(f.query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('executes exact strings only after transaction, scope and role setup', async () => {
    const f = fixture();
    const result = await f.sql.query(org, {
      id: 'q',
      sql: 'SELECT sum(base_debit) AS amount FROM analytics.ledger',
    });
    expect(result.rows).toEqual([['9007199254740993.01']]);
    expect(result.columns).toEqual([{ name: 'amount', oid: 1700, kind: 'decimal' }]);
    const calls = f.query.mock.calls.map(([arg]) => arg);
    expect(calls[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(String(calls[1])).toContain('daybook.organization_id');
    expect(calls[3]).toBe('SET LOCAL ROLE daybook_analyst_reader');
    expect(calls[5]).toBe(
      "SELECT set_config('TimeZone',timezone,true) AS timezone FROM analytics.organization",
    );
    expect(calls.some((call) => typeof call === 'string' && call.includes('public.organizations'))).toBe(
      false,
    );
    const generated = calls.findIndex((call) => typeof call === 'object');
    expect(generated).toBeGreaterThan(calls.indexOf('SET LOCAL ROLE daybook_analyst_reader'));
    expect(calls[generated]).toMatchObject({ rowMode: 'array', values: [] });
    expect(calls.at(-1)).toBe('COMMIT');
    expect(f.release).toHaveBeenCalledWith(false);
  });
  it('runs a final batch in one transaction and compares evidence without timestamp changes', async () => {
    const f = fixture();
    const queries = [
      { id: 'a', sql: 'SELECT 1 AS amount' },
      { id: 'b', sql: 'SELECT 2 AS amount' },
    ];
    const initial = await f.sql.batch(org, queries);
    f.query.mockClear();
    const repeat = await f.sql.reexecute(org, initial);
    expect(repeat.changedQueryIds).toEqual([]);
    expect(repeat.results[0].executedAt).not.toBe(initial[0].executedAt);
    expect(new Set(repeat.results.map((r) => r.executedAt)).size).toBe(1);
    expect(
      f.query.mock.calls.filter(([arg]) => arg === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'),
    ).toHaveLength(1);
    f.setResult({ fields: [{ name: 'amount', dataTypeID: 1700 }], rows: [['9007199254740993.02']] });
    expect((await f.sql.reexecute(org, initial)).changedQueryIds).toEqual(['a', 'b']);
  });
  it('rejects a cross-workspace result replay before any connection is acquired', async () => {
    const f = fixture();
    const original = await f.sql.query(org, { id: 'q', sql: 'SELECT 1' });
    f.connect.mockClear();
    await expect(f.sql.reexecute(other, [original])).rejects.toMatchObject({ code: 'ANALYST_SQL_INPUT' });
    expect(f.connect).not.toHaveBeenCalled();
  });
  it('reports preview truncation, preserving nulls and exact values', async () => {
    const f = fixture({ rows: Array.from({ length: 201 }, (_, i) => [i === 0 ? null : String(i)]) });
    const result = await f.sql.query(org, {
      id: 'q',
      sql: 'SELECT base_debit AS amount FROM analytics.ledger',
    });
    expect(result.rows).toHaveLength(200);
    expect(result.rowCount).toBe(200);
    expect(result.truncated).toBe(true);
    expect(result.rows[0]).toEqual([null]);
  });
  it('does not label an empty successful result a query failure', async () => {
    const f = fixture({ rows: [] });
    expect(await f.sql.query(org, { id: 'q', sql: 'SELECT 1 WHERE false' })).toMatchObject({
      rows: [],
      rowCount: 0,
      truncated: false,
    });
  });
  it.each([
    {
      fields: [
        { name: 'x', dataTypeID: 23 },
        { name: 'x', dataTypeID: 23 },
      ],
      rows: [['1', '2']],
    },
    { fields: [{ name: 'x', dataTypeID: 25 }], rows: [['x'.repeat(ANALYST_SQL_LIMITS.valueBytes + 1)]] },
  ])('rolls back unsupported result shapes without overwriting source values', async (value) => {
    const f = fixture(value);
    await expect(f.sql.query(org, { id: 'q', sql: 'SELECT 1' })).rejects.toThrow();
    expect(f.query).toHaveBeenCalledWith('ROLLBACK');
    expect(f.release).toHaveBeenCalledWith(false);
  });
  it('rolls back query errors and discards a connection if rollback fails', async () => {
    const f = fixture();
    f.query.mockImplementation(async (input) => {
      if (typeof input === 'object') throw Object.assign(new Error('division by zero'), { code: '22012' });
      if (input === 'ROLLBACK') throw new Error('closed');
      return setupResult(input);
    });
    await expect(f.sql.query(org, { id: 'q', sql: 'SELECT 1/0' })).rejects.toMatchObject({
      code: 'ANALYST_SQL_EXECUTION',
      sqlState: '22012',
      message: 'division by zero',
    });
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it('never returns transport credentials from an unexpected database failure', async () => {
    const f = fixture();
    f.query.mockRejectedValue(new Error('postgres://secret@host'));
    await expect(f.sql.query(org, { id: 'q', sql: 'SELECT 1' })).rejects.toMatchObject({
      message: 'The financial query could not be completed.',
    });
  });
  it('rejects five-query batches before opening a connection', async () => {
    const f = fixture();
    await expect(
      f.sql.batch(
        org,
        Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, sql: 'SELECT 1' })),
      ),
    ).rejects.toMatchObject({ code: 'ANALYST_SQL_LIMIT' });
    expect(f.connect).not.toHaveBeenCalled();
  });
  it('does no connection work after pre-abort or an expired deadline', async () => {
    const f = fixture(),
      controller = new AbortController();
    controller.abort();
    await expect(
      f.sql.query(org, { id: 'q', sql: 'SELECT 1' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ANALYST_SQL_CANCELLED' });
    await expect(
      f.sql.query(org, { id: 'q', sql: 'SELECT 1' }, { deadline: performance.now() - 1 }),
    ).rejects.toMatchObject({ code: 'ANALYST_SQL_TIMEOUT' });
    expect(f.connect).not.toHaveBeenCalled();
  });
  it('destroys active query work on abort and never returns that connection to the pool', async () => {
    const f = fixture(),
      controller = new AbortController(),
      started = deferred<void>();
    const running = deferred<{ fields: never[]; rows: never[] }>();
    let underlyingActive = false;
    f.query.mockImplementation(async (arg) => {
      if (typeof arg === 'object') {
        underlyingActive = true;
        started.resolve();
        return running.promise;
      }
      return setupResult(arg);
    });
    f.release.mockImplementation((discard) => {
      expect(discard).toBe(true);
      underlyingActive = false;
      running.reject(new Error('Connection terminated'));
    });
    const outcome = f.sql
      .query(org, { id: 'q', sql: 'SELECT 1' }, { signal: controller.signal })
      .catch((error) => error);
    await started.promise;
    expect(underlyingActive).toBe(true);
    controller.abort();
    expect(await outcome).toMatchObject({ code: 'ANALYST_SQL_CANCELLED' });
    expect(underlyingActive).toBe(false);
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.query).not.toHaveBeenCalledWith('COMMIT');
    expect(f.query).not.toHaveBeenCalledWith('ROLLBACK');
  });
  it('discards a late pool acquisition without beginning a transaction after abort', async () => {
    const f = fixture(),
      controller = new AbortController(),
      started = deferred<void>(),
      acquired = deferred<PoolClient>();
    f.connect.mockImplementation(async () => {
      started.resolve();
      return acquired.promise;
    });
    const outcome = f.sql
      .query(org, { id: 'q', sql: 'SELECT 1' }, { signal: controller.signal })
      .catch((error) => error);
    await started.promise;
    controller.abort();
    expect(await outcome).toMatchObject({ code: 'ANALYST_SQL_CANCELLED' });
    acquired.resolve({ query: f.query, release: f.release } as unknown as PoolClient);
    await acquired.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(f.query).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('enforces the twelve-second batch deadline by destroying active work', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fixture(),
      started = deferred<void>(),
      running = deferred<{ fields: never[]; rows: never[] }>();
    f.query.mockImplementation(async (arg) => {
      if (typeof arg === 'object') {
        started.resolve();
        return running.promise;
      }
      return setupResult(arg);
    });
    f.release.mockImplementation(() => running.reject(new Error('Connection terminated')));
    const outcome = f.sql.query(org, { id: 'q', sql: 'SELECT 1' }).catch((error) => error);
    await started.promise;
    await vi.advanceTimersByTimeAsync(ANALYST_SQL_LIMITS.batchMs);
    expect(await outcome).toMatchObject({ code: 'ANALYST_SQL_TIMEOUT' });
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('caps a hanging rollback and destroys the connection rather than keeping work alive', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fixture(),
      rollingBack = deferred<void>(),
      pending = deferred<{ fields: never[]; rows: never[] }>();
    f.query.mockImplementation(async (arg) => {
      if (typeof arg === 'object') throw Object.assign(new Error('division by zero'), { code: '22012' });
      if (arg === 'ROLLBACK') {
        rollingBack.resolve();
        return pending.promise;
      }
      return setupResult(arg);
    });
    f.release.mockImplementation(() => pending.reject(new Error('Connection terminated')));
    const outcome = f.sql.query(org, { id: 'q', sql: 'SELECT 1/0' }).catch((error) => error);
    await rollingBack.promise;
    await vi.advanceTimersByTimeAsync(ANALYST_SQL_LIMITS.cleanupMs);
    expect(await outcome).toMatchObject({ code: 'ANALYST_SQL_TIMEOUT' });
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('reduces the server statement timeout to the remaining overall deadline', async () => {
    const f = fixture();
    let elapsed = 0;
    f.query.mockImplementation(async (arg) => {
      if (typeof arg === 'object') elapsed += 3000;
      return typeof arg === 'object'
        ? { fields: [{ name: 'amount', dataTypeID: 1700 }], rows: [['1.00']] }
        : setupResult(arg);
    });
    const sql = createAnalystSql({ connect: f.connect, monotonicNow: () => elapsed });
    await expect(
      sql.batch(
        org,
        Array.from({ length: 4 }, (_, i) => ({ id: `q${i}`, sql: 'SELECT 1' })),
      ),
    ).rejects.toMatchObject({ code: 'ANALYST_SQL_TIMEOUT' });
    const deadlines = f.query.mock.calls.filter(
      ([arg]) => arg === "SELECT set_config('statement_timeout',$1,true)",
    );
    expect(deadlines).toHaveLength(4);
    expect(deadlines.at(-1)).toEqual(["SELECT set_config('statement_timeout',$1,true)", ['3000ms']]);
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
  });
});
