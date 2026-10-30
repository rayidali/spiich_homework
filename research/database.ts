import { createHash } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import type { HttpTransport } from './io';

export type QueryResult = {
  fields: { name: string; dataTypeID: number }[];
  rows: Record<string, unknown>[];
  rowCount: number;
};
const resultSchema = z.object({
  fields: z.array(z.object({ name: z.string(), dataTypeID: z.number() })),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z
    .number()
    .nullable()
    .transform((value) => value ?? 0),
});
export type ResearchDatabaseTransport = 'neon-http' | 'postgres';

function databaseError(error: unknown): Error {
  if (error instanceof Error && error.message === 'RESEARCH_DATABASE_RESPONSE') return error;
  const code = (error as { code?: unknown } | null)?.code;
  return new Error(
    `RESEARCH_DATABASE_ERROR:${typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : 'UNKNOWN'}`,
  );
}

function parseResult(value: unknown): QueryResult {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new Error('RESEARCH_DATABASE_RESPONSE');
  return parsed.data;
}

/** Credentials never enter model context. Runtime reader has no base-table privileges. */
export class ResearchDatabase {
  constructor(
    private readonly connectionString: string,
    private readonly http: HttpTransport,
    private readonly mode: ResearchDatabaseTransport = (process.env.RESEARCH_DB_TRANSPORT ??
      'neon-http') as ResearchDatabaseTransport,
  ) {
    let url: URL;
    try {
      url = new URL(connectionString);
    } catch {
      throw new Error('RESEARCH_DATABASE_TARGET');
    }
    if (
      !['neon-http', 'postgres'].includes(mode) ||
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      (mode === 'neon-http' && !url.hostname.endsWith('.neon.tech'))
    )
      throw new Error('RESEARCH_DATABASE_TARGET');
  }

  private async native<T>(operation: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({
      connectionString: this.connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
      application_name: 'daybook-research',
      types: {
        // Exact money/count strings and date strings match the HTTP result contract.
        // Do not mutate pg's process-global parsers or inherit a numeric -> float override.
        getTypeParser(oid, format) {
          if (format !== 'binary' && [20, 1700, 1082, 1114, 1184].includes(oid))
            return (value: string) => value;
          return pg.types.getTypeParser(oid, format);
        },
      },
    });
    try {
      await client.connect();
      return await operation(client);
    } catch (error) {
      throw databaseError(error);
    } finally {
      // Closing also cancels any still-running work after a client-side timeout.
      // Cleanup errors must not replace the original, safely classified failure.
      await client.end().catch(() => undefined);
    }
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    if (this.mode === 'postgres')
      return this.native(async (client) => parseResult(await client.query(sql, params)));
    const host = new URL(this.connectionString).hostname;
    const response = await this.http({
      url: `https://${host}/sql`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': this.connectionString },
      body: { query: sql, params },
      timeoutMs: 15000,
    });
    if (response.status !== 200) {
      const code = (response.json as { code?: unknown })?.code;
      throw new Error(
        `RESEARCH_DATABASE_ERROR:${typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : 'UNKNOWN'}`,
      );
    }
    const parsed = resultSchema.safeParse(response.json);
    if (!parsed.success) throw new Error('RESEARCH_DATABASE_RESPONSE');
    return parsed.data;
  }
  async batch(queries: { query: string; params: unknown[] }[], readOnly = true): Promise<QueryResult[]> {
    if (this.mode === 'postgres')
      return this.native(async (client) => {
        let transactionOpen = false;
        try {
          await client.query(
            `BEGIN ISOLATION LEVEL REPEATABLE READ ${readOnly ? 'READ ONLY' : 'READ WRITE'}`,
          );
          transactionOpen = true;
          const results: QueryResult[] = [];
          for (const { query, params } of queries)
            results.push(parseResult(await client.query(query, params)));
          await client.query('COMMIT');
          transactionOpen = false;
          return results;
        } catch (error) {
          if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
      });
    const host = new URL(this.connectionString).hostname;
    const response = await this.http({
      url: `https://${host}/sql`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Neon-Connection-String': this.connectionString,
        'Neon-Batch-Isolation-Level': 'RepeatableRead',
        'Neon-Batch-Read-Only': String(readOnly),
      },
      body: { queries },
      timeoutMs: 25000,
    });
    if (response.status !== 200) throw new Error('RESEARCH_DATABASE_BATCH_ERROR');
    const parsed = z.object({ results: z.array(resultSchema) }).safeParse(response.json);
    if (!parsed.success) throw new Error('RESEARCH_DATABASE_RESPONSE');
    return parsed.data.results;
  }
  async fingerprint() {
    const result = await this.batch([
      {
        query:
          'SELECT organization_id,entry_id,date::text,status,description,vendor,account_code,account_name,account_type,currency,is_cash,debit::text,credit::text,base_debit::text,base_credit::text,exchange_rate::text FROM research.scoped_ledger ORDER BY entry_id,account_code',
        params: [],
      },
      {
        query:
          'SELECT id,organization_id,title,version,effective_from::text,effective_to::text,text,content_hash,embedding::text FROM research.scoped_documents ORDER BY id',
        params: [],
      },
    ]);
    return createHash('sha256')
      .update(JSON.stringify(result.map((r) => r.rows)))
      .digest('hex');
  }
}
