import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from 'pg';
import { ResearchDatabase } from '../research/database';

const driver = vi.hoisted(() => ({
  client: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  parser: vi.fn(),
  configuration: undefined as ClientConfig | undefined,
}));
vi.mock('pg', () => ({
  default: {
    Client: driver.client,
    types: { getTypeParser: driver.parser },
  },
}));

const local = 'postgresql://reader:synthetic-secret@127.0.0.1:5433/daybook_research';
const neon = 'postgresql://reader:synthetic-secret@ep-unit.us-east-1.aws.neon.tech/daybook_research';
const result = (value = '9007199254740993.01') => ({
  fields: [{ name: 'value', dataTypeID: 1700 }],
  rows: [{ value }],
  rowCount: 1,
});
const command = () => ({ fields: [], rows: [], rowCount: null });

beforeEach(() => {
  vi.stubEnv('RESEARCH_DB_TRANSPORT', 'neon-http');
  vi.resetAllMocks();
  driver.configuration = undefined;
  driver.client.mockImplementation(function (configuration: ClientConfig) {
    driver.configuration = configuration;
    return { connect: driver.connect, query: driver.query, end: driver.end };
  });
  driver.connect.mockResolvedValue(undefined);
  driver.end.mockResolvedValue(undefined);
  driver.query.mockResolvedValue(command());
  driver.parser.mockReturnValue((value: string) => `fallback:${value}`);
});
afterEach(() => vi.unstubAllEnvs());

describe('explicit native PostgreSQL research transport', () => {
  it('keeps HTTP as the default and refuses non-Neon targets without opting in', async () => {
    const http = vi.fn().mockResolvedValue({ status: 200, json: result(), elapsedMs: 1 });
    expect(() => new ResearchDatabase(local, http)).toThrow('RESEARCH_DATABASE_TARGET');
    expect((await new ResearchDatabase(neon, http).execute('SELECT 1')).rows).toEqual(result().rows);
    expect(http.mock.calls[0][0].url).toBe('https://ep-unit.us-east-1.aws.neon.tech/sql');
    expect(driver.client).not.toHaveBeenCalled();
  });

  it('accepts environment opt-in but lets an explicit mode override it', async () => {
    vi.stubEnv('RESEARCH_DB_TRANSPORT', 'postgres');
    await new ResearchDatabase(local, vi.fn()).execute('SELECT 1');
    expect(driver.client).toHaveBeenCalledTimes(1);
    expect(() => new ResearchDatabase(local, vi.fn(), 'neon-http')).toThrow('RESEARCH_DATABASE_TARGET');
  });

  it('rejects unknown transports and malformed or non-Postgres URLs safely', () => {
    for (const url of ['https://127.0.0.1/sql', 'postgresql:///database', 'secret not a URL'])
      expect(() => new ResearchDatabase(url, vi.fn(), 'postgres')).toThrow('RESEARCH_DATABASE_TARGET');
    vi.stubEnv('RESEARCH_DB_TRANSPORT', 'guess-host');
    expect(() => new ResearchDatabase(neon, vi.fn())).toThrow('RESEARCH_DATABASE_TARGET');
    expect(driver.client).not.toHaveBeenCalled();
  });

  it('uses a bounded private connection, parameter binding and exact decimal strings', async () => {
    const http = vi.fn();
    const sql = 'SELECT base_debit AS value FROM research.scoped_ledger WHERE description=$1';
    const params = ["rent'; DELETE FROM research.ledger; --"];
    driver.query.mockResolvedValueOnce(result());
    const answer = await new ResearchDatabase(local, http, 'postgres').execute(sql, params);
    expect(answer).toEqual(result());
    expect(driver.configuration).toMatchObject({
      connectionString: local,
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
      application_name: 'daybook-research',
    });
    expect(driver.configuration?.statement_timeout).toBeUndefined();
    expect(driver.query).toHaveBeenCalledExactlyOnceWith(sql, params);
    expect(driver.connect).toHaveBeenCalledOnce();
    expect(driver.end).toHaveBeenCalledOnce();
    expect(http).not.toHaveBeenCalled();
  });

  it('keeps numeric, bigint and date parsers local and exact', async () => {
    await new ResearchDatabase(local, vi.fn(), 'postgres').execute('SELECT 1');
    const parser = driver.configuration!.types!.getTypeParser;
    for (const [oid, value] of [
      [1700, '99999999999999999999.99'],
      [20, '9007199254740993'],
      [1082, '2026-09-30'],
      [1114, '2026-09-30 12:15:16'],
      [1184, '2026-09-30 12:15:16+00'],
    ] as const)
      expect(parser(oid, 'text')(value)).toBe(value);
    expect(driver.parser).not.toHaveBeenCalled();
    expect(parser(23, 'text')('12')).toBe('fallback:12');
    expect(driver.parser).toHaveBeenCalledExactlyOnceWith(23, 'text');
  });

  it('normalizes command row counts and strips unrelated driver result metadata', async () => {
    driver.query.mockResolvedValueOnce({ ...command(), command: 'CREATE', oid: 0 });
    expect(await new ResearchDatabase(local, vi.fn(), 'postgres').execute('CREATE SCHEMA research')).toEqual({
      fields: [],
      rows: [],
      rowCount: 0,
    });
  });

  it('closes on connection failure without leaking the connection or driver message', async () => {
    driver.connect.mockRejectedValueOnce(new Error(`Failed connection ${local}`));
    await expect(new ResearchDatabase(local, vi.fn(), 'postgres').execute('SELECT 1')).rejects.toThrow(
      'RESEARCH_DATABASE_ERROR:UNKNOWN',
    );
    expect(driver.query).not.toHaveBeenCalled();
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it('preserves safe PostgreSQL error codes while hiding SQL and secret messages', async () => {
    driver.query.mockRejectedValueOnce(Object.assign(new Error(`denied ${local}`), { code: '42501' }));
    driver.end.mockRejectedValueOnce(new Error('cleanup detail'));
    await expect(new ResearchDatabase(local, vi.fn(), 'postgres').execute('SELECT secret')).rejects.toThrow(
      /^RESEARCH_DATABASE_ERROR:42501$/,
    );
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it('runs the whole read-only batch in one repeatable-read transaction', async () => {
    driver.query
      .mockResolvedValueOnce(command())
      .mockResolvedValueOnce(result('1.00'))
      .mockResolvedValueOnce(result('2.00'))
      .mockResolvedValueOnce(command());
    const db = new ResearchDatabase(local, vi.fn(), 'postgres');
    expect(
      await db.batch([
        { query: 'SELECT $1', params: ['1.00'] },
        { query: 'SELECT $1', params: ['2.00'] },
      ]),
    ).toEqual([result('1.00'), result('2.00')]);
    expect(driver.query.mock.calls).toEqual([
      ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'],
      ['SELECT $1', ['1.00']],
      ['SELECT $1', ['2.00']],
      ['COMMIT'],
    ]);
    expect(driver.client).toHaveBeenCalledOnce();
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it('requires an explicit writable batch request for provisioning transactions', async () => {
    await new ResearchDatabase(local, vi.fn(), 'postgres').batch(
      [{ query: 'INSERT INTO research.ledger VALUES ($1)', params: ['fixture'] }],
      false,
    );
    expect(driver.query.mock.calls[0]).toEqual(['BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE']);
    expect(driver.query.mock.calls.at(-1)).toEqual(['COMMIT']);
  });

  it('rolls back a failing statement and does not run later statements', async () => {
    driver.query
      .mockResolvedValueOnce(command())
      .mockRejectedValueOnce(Object.assign(new Error('bad statement'), { code: '25006' }))
      .mockResolvedValueOnce(command());
    await expect(
      new ResearchDatabase(local, vi.fn(), 'postgres').batch([
        { query: 'UPDATE forbidden', params: [] },
        { query: 'SELECT later', params: [] },
      ]),
    ).rejects.toThrow('RESEARCH_DATABASE_ERROR:25006');
    expect(driver.query.mock.calls).toEqual([
      ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'],
      ['UPDATE forbidden', []],
      ['ROLLBACK'],
    ]);
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it('keeps the original failure if rollback itself fails', async () => {
    driver.query
      .mockResolvedValueOnce(command())
      .mockRejectedValueOnce(Object.assign(new Error('original'), { code: '42501' }))
      .mockRejectedValueOnce(new Error('rollback disconnected'));
    await expect(
      new ResearchDatabase(local, vi.fn(), 'postgres').batch([{ query: 'SELECT forbidden', params: [] }]),
    ).rejects.toThrow(/^RESEARCH_DATABASE_ERROR:42501$/);
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it('attempts rollback when commit fails', async () => {
    driver.query
      .mockResolvedValueOnce(command())
      .mockResolvedValueOnce(result())
      .mockRejectedValueOnce(Object.assign(new Error('commit failed'), { code: '40001' }))
      .mockResolvedValueOnce(command());
    await expect(
      new ResearchDatabase(local, vi.fn(), 'postgres').batch([{ query: 'SELECT value', params: [] }]),
    ).rejects.toThrow('RESEARCH_DATABASE_ERROR:40001');
    expect(driver.query.mock.calls.slice(-2)).toEqual([['COMMIT'], ['ROLLBACK']]);
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it('closes without querying after a failed BEGIN', async () => {
    driver.query.mockRejectedValueOnce(Object.assign(new Error('begin failed'), { code: '08006' }));
    await expect(
      new ResearchDatabase(local, vi.fn(), 'postgres').batch([{ query: 'SELECT value', params: [] }]),
    ).rejects.toThrow('RESEARCH_DATABASE_ERROR:08006');
    expect(driver.query).toHaveBeenCalledOnce();
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it('rejects malformed or multi-statement result shapes and rolls back the batch', async () => {
    driver.query
      .mockResolvedValueOnce(command())
      .mockResolvedValueOnce([result(), result()])
      .mockResolvedValueOnce(command());
    await expect(
      new ResearchDatabase(local, vi.fn(), 'postgres').batch([{ query: 'SELECT 1; SELECT 2', params: [] }]),
    ).rejects.toThrow('RESEARCH_DATABASE_RESPONSE');
    expect(driver.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
    expect(driver.end).toHaveBeenCalledOnce();
  });
});
