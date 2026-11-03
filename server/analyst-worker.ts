import { query } from './db';
import { querioService } from './querio-service';

/** Advances already-requested work only. Never invents or repeats a user prompt. */
export async function processAnalystWork(org?: string) {
  if (!querioService.availability().available) return 0;
  const candidates = await query<{ id: string; organization_id: string }>(
    `SELECT id,organization_id FROM analyst_conversations
     WHERE provider='querio' AND state->>'status' IN ('starting','running')
       AND ($1::uuid IS NULL OR organization_id=$1)
       AND (lease_until IS NULL OR lease_until<now())
     ORDER BY updated_at,id LIMIT 2`,
    [org ?? null],
  );
  // Parallel leases remain independent; each conversation allows one runner across all instances.
  await Promise.all(candidates.map((row) => querioService.refresh(row.organization_id, row.id)));
  return candidates.length;
}
