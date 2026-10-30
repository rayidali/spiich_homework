import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';
// DATE is a business calendar date, not a local-midnight JavaScript timestamp.
pg.types.setTypeParser(1082, (value) => value);
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 10000,
  application_name: 'daybook-api',
});
pool.on('error', (error) =>
  console.error(JSON.stringify({ level: 'error', event: 'database_pool', message: error.message })),
);
export type Db = Pick<PoolClient, 'query'>;
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  db: Db = pool,
): Promise<T[]> {
  return (await db.query<T>(sql, values)).rows;
}
export async function transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
