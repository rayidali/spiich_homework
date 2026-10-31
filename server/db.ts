import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';
import { databaseCode, duringStage, markFailure } from './errors';
import { diagnostic } from './diagnostics';
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
  diagnostic('database_pool', {
    code: 'DATABASE_ERROR',
    stage: 'database',
    databaseCode: databaseCode(error),
  }),
);
export type Db = Pick<PoolClient, 'query'>;
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  db: Db = pool,
): Promise<T[]> {
  return duringStage('database', async () => (await db.query<T>(sql, values)).rows);
}
export async function transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await duringStage('database', () => pool.connect());
  let discardClient = false;
  try {
    await duringStage('database', () => client.query('BEGIN'));
    const result = await fn(client);
    await duringStage('database', () => client.query('COMMIT'));
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      discardClient = true;
      diagnostic('database_rollback_failed', {
        code: 'DATABASE_ERROR',
        stage: 'database',
        databaseCode: databaseCode(rollbackError),
      });
    }
    throw databaseCode(error) ? markFailure(error, 'database') : error;
  } finally {
    client.release(discardClient);
  }
}
