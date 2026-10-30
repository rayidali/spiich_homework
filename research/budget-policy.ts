import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { UsageRecord } from './budget';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const policySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    authorizationReference: z.string().min(1).max(500),
    mode: z.literal('fixed-key-probe-only'),
    baselineCount: z.number().int().nonnegative(),
    baselineHash: digest,
    baselineSpendUsd: z
      .object({ gemini: z.number().finite().nonnegative(), jev: z.number().finite().nonnegative() })
      .strict(),
    additionalAllowanceUsd: z.object({ gemini: z.literal(0.01), jev: z.literal(0) }).strict(),
    maximumAdditionalAttempts: z.literal(1),
  })
  .strict();
export type KeyCheckPolicy = z.infer<typeof policySchema>;
const markerSchema = z
  .object({ schemaVersion: z.literal(1), policyId: z.string().uuid(), policyHash: digest })
  .strict();

function spend(records: UsageRecord[], provider: 'gemini' | 'jev') {
  return records
    .filter((record) => record.provider === provider)
    .reduce((sum, record) => {
      const cost = record.estimatedUsd ?? record.reserveUsd;
      if (!Number.isFinite(cost) || cost < 0) throw new Error('RESEARCH_POLICY_INVALID_USAGE');
      return sum + cost;
    }, 0);
}
export function createKeyCheckPolicy(
  records: UsageRecord[],
  authorizationReference: string,
  now = Date.now(),
): KeyCheckPolicy {
  return policySchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    createdAt: new Date(now).toISOString(),
    authorizationReference,
    mode: 'fixed-key-probe-only',
    baselineCount: records.length,
    baselineHash: hash(records),
    baselineSpendUsd: { gemini: spend(records, 'gemini'), jev: spend(records, 'jev') },
    additionalAllowanceUsd: { gemini: 0.01, jev: 0 },
    maximumAdditionalAttempts: 1,
  });
}
export function validateKeyCheckPolicy(value: unknown, records: UsageRecord[]): KeyCheckPolicy {
  const parsed = policySchema.safeParse(value);
  if (!parsed.success) throw new Error('RESEARCH_POLICY_INVALID');
  const policy = parsed.data;
  const baseline = records.slice(0, policy.baselineCount);
  if (
    baseline.length !== policy.baselineCount ||
    hash(baseline) !== policy.baselineHash ||
    spend(baseline, 'gemini') !== policy.baselineSpendUsd.gemini ||
    spend(baseline, 'jev') !== policy.baselineSpendUsd.jev
  )
    throw new Error('RESEARCH_POLICY_BASELINE_CHANGED');
  return policy;
}
export function keyCheckPolicyMarker(policy: KeyCheckPolicy) {
  return { schemaVersion: 1 as const, policyId: policy.id, policyHash: hash(policy) };
}
export function validateKeyCheckPolicyMarker(value: unknown, policy: KeyCheckPolicy) {
  const parsed = markerSchema.safeParse(value);
  if (!parsed.success || parsed.data.policyId !== policy.id || parsed.data.policyHash !== hash(policy))
    throw new Error('RESEARCH_POLICY_MARKER_MISMATCH');
}
export function assertKeyCheckReservation(input: {
  policy: KeyCheckPolicy;
  records: UsageRecord[];
  provider: 'gemini' | 'jev';
  kind: string;
  reserveUsd: number;
  isProbe: boolean;
}) {
  const policy = validateKeyCheckPolicy(input.policy, input.records);
  if (!input.isProbe || input.provider !== 'gemini' || input.kind !== 'generate')
    throw new Error('RESEARCH_POLICY_PROBE_ONLY');
  const suffix = input.records.slice(policy.baselineCount);
  if (suffix.length >= policy.maximumAdditionalAttempts)
    throw new Error('RESEARCH_POLICY_ATTEMPTS_EXHAUSTED');
  if (
    !Number.isFinite(input.reserveUsd) ||
    input.reserveUsd < 0 ||
    spend(suffix, input.provider) + input.reserveUsd > policy.additionalAllowanceUsd[input.provider]
  )
    throw new Error('RESEARCH_POLICY_ALLOWANCE_EXHAUSTED');
}
