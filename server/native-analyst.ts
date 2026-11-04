import { pool } from './db';
import { postgresAnalystStore } from './analyst-store';
import { createAnalystSql } from './analyst-sql';
import { createNativeAnalystService } from './native-analyst-service';

/** Direct provider access stays on the server. Existing entry/category models are unchanged. */
export const nativeAnalystService = createNativeAnalystService({
  store: postgresAnalystStore,
  sql: createAnalystSql({ connect: () => pool.connect() }),
  settings: () => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (process.env.NATIVE_ANALYST_ENABLED !== 'true' || !apiKey) return null;
    return {
      apiKey,
      modelId: process.env.ANALYST_MODEL?.trim() || 'gemini-3.8-flash',
      turnBudgetNanoUsd: 500_000_000,
    };
  },
  diagnostic: (event) => console.info(JSON.stringify({ event: 'native_analyst_progress', ...event })),
});
