import { query } from './db';
import { querioService } from './querio-service';
import { nativeAnalystService } from './native-analyst';
import { randomUUID } from 'node:crypto';

/** Advances already-requested work only. Never invents or repeats a user prompt. */
export async function processAnalystWork(org?: string) {
  const providers = [
    ...(querioService.availability().available ? ['querio'] : []),
    ...(nativeAnalystService.availability().available ? ['daybook'] : []),
  ];
  const candidates = await query<{ id: string; organization_id: string; provider: string }>(
    `SELECT id,organization_id,provider FROM analyst_conversations
     WHERE (provider=ANY($2::text[]) OR (provider='daybook' AND close_requested))
       AND state->>'status' IN ('starting','running')
       AND ($1::uuid IS NULL OR organization_id=$1)
       AND (lease_until IS NULL OR lease_until<now())
     ORDER BY updated_at,id LIMIT 2`,
    [org ?? null, providers],
  );
  // Parallel leases remain independent; each conversation allows one runner across all instances.
  await Promise.all(
    candidates.map((row) =>
      row.provider === 'daybook'
        ? nativeAnalystService.advance(row.organization_id, row.id, randomUUID())
        : querioService.refresh(row.organization_id, row.id, randomUUID()),
    ),
  );
  return candidates.length;
}
