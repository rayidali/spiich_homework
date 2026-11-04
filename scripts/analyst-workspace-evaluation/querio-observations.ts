export type QuerioObservation = {
  id: string;
  sessionId: string;
  model: string | null;
  timestamp: string | null;
  usage: Record<string, number>;
  stopReason: string | null;
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const usageFields = [
  'input_tokens',
  'output_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
  'cumulative_tokens',
];
/** Observed assistant entries are a credit proxy, not authoritative billed model calls or USD. */
export function extractQuerioObservations(
  sessionId: string,
  raw: unknown,
): { available: boolean; observations: QuerioObservation[] } {
  const value = object(raw);
  if (!Array.isArray(value.entries)) return { available: false, observations: [] };
  const observations: QuerioObservation[] = [];
  for (const item of value.entries) {
    const entry = object(item),
      message = object(entry.message);
    if (entry.type !== 'message' || message.role !== 'assistant') continue;
    if (typeof entry.id !== 'string' || !entry.id) return { available: false, observations };
    const rawUsage = object(message.usage),
      usage: Record<string, number> = {};
    for (const key of usageFields) {
      const value = rawUsage[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) usage[key] = value;
    }
    observations.push({
      id: `${sessionId}:${entry.id}`,
      sessionId,
      model: typeof message.model === 'string' ? message.model : null,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null,
      usage,
      stopReason: typeof message.stop_reason === 'string' ? message.stop_reason : null,
    });
  }
  return { available: true, observations };
}
