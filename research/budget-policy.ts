import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { UsageRecord } from './budget';
import type { ResearchRequest } from './providers/transport';

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

const allowedModels = {
  gemini: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-embedding-001', 'file-search'],
  jev: ['jev-1.14.0'],
} as const;
const allowanceOptionsSchema = z
  .object({
    authorizationReference: z.string().min(1).max(500),
    credentialFingerprint: digest,
    additionalAllowanceUsd: z
      .object({
        gemini: z.number().finite().nonnegative().max(6.4),
        jev: z.number().finite().nonnegative().max(0.1),
      })
      .strict(),
    maximumAdditionalAttempts: z.number().int().min(1).max(7000),
  })
  .strict();
export type StudyAllowanceOptions = z.infer<typeof allowanceOptionsSchema>;
const studyPolicySchema = allowanceOptionsSchema
  .extend({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    mode: z.literal('bounded-study-allowance'),
    authorizationReason: z.literal('user_authorized_study_resumption'),
    parentPolicyHash: digest,
    baselineCount: z.number().int().positive(),
    baselineHash: digest,
    baselineSpendUsd: z
      .object({ gemini: z.number().finite().nonnegative(), jev: z.number().finite().nonnegative() })
      .strict(),
    globalCeilingUsd: z.object({ gemini: z.literal(10), jev: z.literal(4) }).strict(),
    allowedModels: z
      .object({
        gemini: z.tuple([
          z.literal(allowedModels.gemini[0]),
          z.literal(allowedModels.gemini[1]),
          z.literal(allowedModels.gemini[2]),
          z.literal(allowedModels.gemini[3]),
        ]),
        jev: z.tuple([z.literal(allowedModels.jev[0])]),
      })
      .strict(),
  })
  .strict();
export type StudyAllowancePolicy = z.infer<typeof studyPolicySchema>;

export function createStudyAllowancePolicy(
  records: UsageRecord[],
  parent: KeyCheckPolicy,
  options: StudyAllowanceOptions,
  now = Date.now(),
): StudyAllowancePolicy {
  validateKeyCheckPolicy(parent, records);
  const parsed = allowanceOptionsSchema.safeParse(options);
  if (!parsed.success || records.length !== parent.baselineCount + 1)
    throw new Error('RESEARCH_STUDY_POLICY_INVALID_TRANSITION');
  return studyPolicySchema.parse({
    ...parsed.data,
    schemaVersion: 1,
    id: randomUUID(),
    createdAt: new Date(now).toISOString(),
    mode: 'bounded-study-allowance',
    authorizationReason: 'user_authorized_study_resumption',
    parentPolicyHash: hash(parent),
    baselineCount: records.length,
    baselineHash: hash(records),
    baselineSpendUsd: { gemini: spend(records, 'gemini'), jev: spend(records, 'jev') },
    globalCeilingUsd: { gemini: 10, jev: 4 },
    allowedModels,
  });
}
export function validateStudyAllowancePolicy(
  value: unknown,
  records: UsageRecord[],
  parent: KeyCheckPolicy,
): StudyAllowancePolicy {
  const parsed = studyPolicySchema.safeParse(value);
  if (!parsed.success) throw new Error('RESEARCH_STUDY_POLICY_INVALID');
  validateKeyCheckPolicy(parent, records);
  const policy = parsed.data;
  if (hash(parent) !== policy.parentPolicyHash || policy.baselineCount !== parent.baselineCount + 1)
    throw new Error('RESEARCH_STUDY_POLICY_PARENT_CHANGED');
  const baseline = records.slice(0, policy.baselineCount);
  if (
    baseline.length !== policy.baselineCount ||
    hash(baseline) !== policy.baselineHash ||
    spend(baseline, 'gemini') !== policy.baselineSpendUsd.gemini ||
    spend(baseline, 'jev') !== policy.baselineSpendUsd.jev
  )
    throw new Error('RESEARCH_STUDY_POLICY_BASELINE_CHANGED');
  return policy;
}
export function studyAllowancePolicyMarker(policy: StudyAllowancePolicy) {
  return {
    schemaVersion: 1 as const,
    policyId: policy.id,
    policyHash: hash(policy),
    parentPolicyHash: policy.parentPolicyHash,
  };
}
export function validateStudyAllowancePolicyMarker(value: unknown, policy: StudyAllowancePolicy) {
  const parsed = markerSchema.extend({ parentPolicyHash: digest }).strict().safeParse(value);
  if (
    !parsed.success ||
    parsed.data.policyId !== policy.id ||
    parsed.data.policyHash !== hash(policy) ||
    parsed.data.parentPolicyHash !== policy.parentPolicyHash
  )
    throw new Error('RESEARCH_STUDY_POLICY_MARKER_MISMATCH');
}
export function assertStudyAllowanceReservation(input: {
  policy: StudyAllowancePolicy;
  records: UsageRecord[];
  parent: KeyCheckPolicy;
  request: ResearchRequest;
  reserveUsd: number;
}) {
  const policy = validateStudyAllowancePolicy(input.policy, input.records, input.parent);
  if (!(policy.allowedModels[input.request.provider] as readonly string[]).includes(input.request.model))
    throw new Error('RESEARCH_STUDY_POLICY_MODEL_FORBIDDEN');
  if (input.request.provider === 'gemini') {
    const key = input.request.headers['x-goog-api-key'];
    if (
      typeof key !== 'string' ||
      !key ||
      createHash('sha256').update(key).digest('hex') !== policy.credentialFingerprint
    )
      throw new Error('RESEARCH_STUDY_POLICY_KEY_MISMATCH');
  }
  const suffix = input.records.slice(policy.baselineCount);
  if (suffix.length >= policy.maximumAdditionalAttempts)
    throw new Error('RESEARCH_BUDGET_EXHAUSTED_STUDY_ATTEMPTS');
  if (
    !Number.isFinite(input.reserveUsd) ||
    input.reserveUsd < 0 ||
    spend(suffix, input.request.provider) + input.reserveUsd >
      policy.additionalAllowanceUsd[input.request.provider]
  )
    throw new Error('RESEARCH_BUDGET_EXHAUSTED_STUDY_ALLOWANCE');
  if (
    spend(input.records, input.request.provider) + input.reserveUsd >
    policy.globalCeilingUsd[input.request.provider]
  )
    throw new Error('RESEARCH_BUDGET_EXHAUSTED_GLOBAL_ALLOWANCE');
}
