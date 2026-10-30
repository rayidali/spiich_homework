import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { UsageRecord } from './budget';
import type { ResearchRequest, ResearchResponse } from './providers/transport';
import { validateKeyCheckPolicy } from './budget-policy';

export const QUOTA_PROBE_MODEL = 'gemini-3.5-flash-lite';
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const stamp = z.string().datetime({ offset: true });
const limitsSchema = z
  .object({
    gemini: z.number().positive(),
    jev: z.number().positive(),
    attempts: z.number().int().positive(),
  })
  .strict();
const authorizationSchema = z
  .object({
    reason: z.enum([
      'user_confirmed_billing_change',
      'documented_daily_quota_reset',
      'user_configured_key_change',
    ]),
    confirmedAt: stamp,
    notBefore: stamp,
    expiresAt: stamp,
    // Private audit reference; never copied into a public receipt.
    evidenceReference: z.string().min(1).max(500),
    keyChange: z
      .object({
        observedAt: stamp,
        previousFingerprint: hashSchema,
        currentFingerprint: hashSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export type RecoveryAuthorization = z.infer<typeof authorizationSchema>;
const quotaEvidenceSchema = z
  .object({
    runId: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
    recordedAt: stamp,
    quota: z
      .object({
        httpStatus: z.literal(429),
        providerStatus: z.literal('RESOURCE_EXHAUSTED'),
        quotaMetric: z.literal('generativelanguage.googleapis.com/generate_content_free_tier_requests'),
        quotaId: z.literal('GenerateRequestsPerDayPerProjectPerModel-FreeTier'),
        quotaValue: z.literal(500),
        responsesObserved: z.number().int().min(3),
      })
      .passthrough(),
  })
  .passthrough();
const permitSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    createdAt: stamp,
    provider: z.literal('gemini'),
    model: z.literal(QUOTA_PROBE_MODEL),
    requestHash: hashSchema,
    usageHash: hashSchema,
    usageCount: z.number().int().nonnegative(),
    recordBindings: z.array(z.object({ id: z.string(), hash: hashSchema }).strict()).length(3),
    quotaEvidenceHash: hashSchema,
    authorizationHash: hashSchema,
    authorization: authorizationSchema,
    limits: limitsSchema,
    policyHash: hashSchema.optional(),
  })
  .strict();
export type QuotaRecoveryPermit = z.infer<typeof permitSchema>;
export interface RecoveryJournalEntry {
  permit: QuotaRecoveryPermit;
  recordId: string;
  state: 'pending' | 'failed' | 'succeeded';
  consumedAt: string;
  completedAt?: string;
  receipt?: RecoveryReceipt;
}
export interface RecoveryReceipt {
  schemaVersion: 1;
  provider: 'gemini';
  model: typeof QUOTA_PROBE_MODEL;
  at: string;
  authorizationReason: RecoveryAuthorization['reason'];
  outcome: 'RECOVERED' | 'HTTP_ERROR' | 'TRANSPORT_ERROR' | 'INVALID_OUTPUT' | 'MISSING_USAGE';
  status: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedUsd: number | null;
  reserveUsd: number;
  preservedUnknownRecords: 3;
  priorReservationsUnchanged: true;
  quotaEvidenceHash: string;
}
export const recoveryHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Private evidence only; never publish credential fingerprints. */
export const credentialFingerprint = (key: string) => createHash('sha256').update(key).digest('hex');
function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('RESEARCH_RECOVERY_INVALID_ARTIFACT');
  return result.data;
}

/** Fixed same-model availability probe. The request hash also binds the private key. */
export function quotaProbeRequest(apiKey: string): ResearchRequest {
  if (!apiKey.trim()) throw new Error('RESEARCH_RECOVERY_KEY_MISSING');
  return {
    provider: 'gemini',
    model: QUOTA_PROBE_MODEL,
    kind: 'generate',
    url: `https://generativelanguage.googleapis.com/v1beta/models/${QUOTA_PROBE_MODEL}:generateContent`,
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: {
      systemInstruction: { parts: [{ text: 'Return exactly the requested JSON object.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Return {"ok":true}.' }] }],
      generationConfig: {
        maxOutputTokens: 128,
        temperature: 0,
        // Same current wire grammar as GeminiResearchClient.generate.
        responseFormat: {
          text: {
            mimeType: 'APPLICATION_JSON',
            schema: z.toJSONSchema(z.object({ ok: z.literal(true) }).strict()),
          },
        },
        thinkingConfig: { thinkingLevel: 'LOW' },
      },
    },
    timeoutMs: 25000,
  };
}
function isProbe(request: ResearchRequest) {
  const key = request.headers['x-goog-api-key'];
  return (
    typeof key === 'string' && key.trim() && recoveryHash(request) === recoveryHash(quotaProbeRequest(key))
  );
}
const generationKinds = new Set(['generate', 'critic', 'file-search-query']);
function quotaRecords(records: UsageRecord[], evidence: unknown) {
  const source = checked(quotaEvidenceSchema, evidence);
  const selected = records.filter((r) => r.provider === 'gemini' && generationKinds.has(r.kind)).slice(-3);
  if (
    selected.length !== 3 ||
    selected.some(
      (r) =>
        r.status !== 429 ||
        r.estimatedUsd !== null ||
        r.model !== QUOTA_PROBE_MODEL ||
        !r.episode.startsWith(`${source.runId}:`) ||
        !Number.isFinite(Date.parse(r.at)) ||
        Date.parse(r.at) > Date.parse(source.recordedAt),
    )
  )
    throw new Error('RESEARCH_RECOVERY_NOT_DAILY_QUOTA');
  return selected;
}

/** Next midnight in America/Los_Angeles, followed by a conservative one-minute margin. */
export function documentedQuotaResetAfter(at: string): number {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new Error('RESEARCH_RECOVERY_INVALID_TIME');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const parts = (value: Date) =>
    Object.fromEntries(formatter.formatToParts(value).map((p) => [p.type, p.value]));
  const local = parts(date);
  const next = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day) + 1);
  for (const offset of [7, 8]) {
    const candidate = new Date(next + offset * 3600000);
    const p = parts(candidate);
    if (Number(p.hour) === 0) return candidate.getTime() + 60000;
  }
  throw new Error('RESEARCH_RECOVERY_INVALID_TIME');
}
function checkAuthorization(value: unknown, selected: UsageRecord[], now: number, requireReady: boolean) {
  const authorization = checked(authorizationSchema, value);
  const confirmed = Date.parse(authorization.confirmedAt),
    start = Date.parse(authorization.notBefore),
    end = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(now) || confirmed > now || end <= start || end - start > 3600000 || now >= end)
    throw new Error('RESEARCH_RECOVERY_INVALID_TIME');
  if (
    authorization.reason === 'documented_daily_quota_reset' &&
    start < documentedQuotaResetAfter(selected.at(-1)!.at)
  )
    throw new Error('RESEARCH_RECOVERY_BEFORE_RESET');
  if (
    ['user_confirmed_billing_change', 'user_configured_key_change'].includes(authorization.reason) &&
    confirmed < Date.parse(selected.at(-1)!.at)
  )
    throw new Error('RESEARCH_RECOVERY_STALE_AUTHORIZATION');
  if (authorization.reason !== 'user_configured_key_change' && authorization.keyChange)
    throw new Error('RESEARCH_RECOVERY_INVALID_ARTIFACT');
  if (requireReady && now < start) throw new Error('RESEARCH_RECOVERY_TOO_EARLY');
  return authorization;
}
function checkKeyChange(
  authorization: RecoveryAuthorization,
  request: ResearchRequest,
  policy: unknown,
  records: UsageRecord[],
  now: number,
) {
  if (authorization.reason !== 'user_configured_key_change') return;
  const change = authorization.keyChange;
  if (
    !change ||
    change.previousFingerprint === change.currentFingerprint ||
    change.currentFingerprint !== credentialFingerprint(request.headers['x-goog-api-key']) ||
    Date.parse(change.observedAt) < Date.parse(authorization.confirmedAt) ||
    Date.parse(change.observedAt) > now
  )
    throw new Error('RESEARCH_RECOVERY_KEY_CHANGE_UNVERIFIED');
  if (!policy) throw new Error('RESEARCH_RECOVERY_RESTRICTIVE_POLICY_REQUIRED');
  validateKeyCheckPolicy(policy, records);
}
export function createQuotaRecoveryPermit(input: {
  records: UsageRecord[];
  request: ResearchRequest;
  quotaEvidence: unknown;
  authorization: unknown;
  limits: { gemini: number; jev: number; attempts: number };
  now?: number;
  policy?: unknown;
}): QuotaRecoveryPermit {
  const now = input.now ?? Date.now();
  if (!isProbe(input.request)) throw new Error('RESEARCH_RECOVERY_WRONG_REQUEST');
  const selected = quotaRecords(input.records, input.quotaEvidence);
  const authorization = checkAuthorization(input.authorization, selected, now, false);
  checkKeyChange(authorization, input.request, input.policy, input.records, now);
  return checked(permitSchema, {
    schemaVersion: 1,
    id: randomUUID(),
    createdAt: new Date(now).toISOString(),
    provider: 'gemini',
    model: QUOTA_PROBE_MODEL,
    requestHash: recoveryHash(input.request),
    usageHash: recoveryHash(input.records),
    usageCount: input.records.length,
    recordBindings: selected.map((r) => ({ id: r.id, hash: recoveryHash(r) })),
    quotaEvidenceHash: recoveryHash(input.quotaEvidence),
    authorizationHash: recoveryHash(authorization),
    authorization,
    limits: input.limits,
    ...(input.policy
      ? { policyHash: recoveryHash(validateKeyCheckPolicy(input.policy, input.records)) }
      : {}),
  });
}
export function validateQuotaRecoveryPermit(input: {
  permit: unknown;
  records: UsageRecord[];
  request: ResearchRequest;
  quotaEvidence: unknown;
  authorization: unknown;
  limits: { gemini: number; jev: number; attempts: number };
  journal: RecoveryJournalEntry[];
  now?: number;
  policy?: unknown;
}): QuotaRecoveryPermit {
  const permit = checked(permitSchema, input.permit),
    now = input.now ?? Date.now();
  if (input.journal.some((e) => e.permit.id === permit.id))
    throw new Error('RESEARCH_RECOVERY_ALREADY_CONSUMED');
  if (input.journal.at(-1)?.state === 'pending') throw new Error('RESEARCH_RECOVERY_PENDING');
  if (!isProbe(input.request) || recoveryHash(input.request) !== permit.requestHash)
    throw new Error('RESEARCH_RECOVERY_WRONG_REQUEST');
  if (
    recoveryHash(input.records) !== permit.usageHash ||
    input.records.length !== permit.usageCount ||
    recoveryHash(input.limits) !== recoveryHash(permit.limits)
  )
    throw new Error('RESEARCH_RECOVERY_SNAPSHOT_CHANGED');
  const selected = quotaRecords(input.records, input.quotaEvidence);
  const authorization = checkAuthorization(input.authorization, selected, now, true);
  checkKeyChange(authorization, input.request, input.policy, input.records, now);
  if (
    permit.policyHash !==
    (input.policy ? recoveryHash(validateKeyCheckPolicy(input.policy, input.records)) : undefined)
  )
    throw new Error('RESEARCH_RECOVERY_POLICY_CHANGED');
  if (
    recoveryHash(selected.map((r) => ({ id: r.id, hash: recoveryHash(r) }))) !==
      recoveryHash(permit.recordBindings) ||
    recoveryHash(input.quotaEvidence) !== permit.quotaEvidenceHash ||
    recoveryHash(authorization) !== permit.authorizationHash ||
    recoveryHash(permit.authorization) !== permit.authorizationHash
  )
    throw new Error('RESEARCH_RECOVERY_EVIDENCE_CHANGED');
  return permit;
}
export function validateRecoveryJournal(value: unknown): RecoveryJournalEntry[] {
  const schema = z.array(
    z
      .object({
        permit: permitSchema,
        recordId: z.string().uuid(),
        state: z.enum(['pending', 'failed', 'succeeded']),
        consumedAt: stamp,
        completedAt: stamp.optional(),
        receipt: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  );
  const journal = checked(schema, value) as unknown as RecoveryJournalEntry[];
  if (
    new Set(journal.map((r) => r.permit.id)).size !== journal.length ||
    journal.some(
      (entry) =>
        entry.state === 'succeeded' && (entry.receipt?.outcome !== 'RECOVERED' || !entry.completedAt),
    )
  )
    throw new Error('RESEARCH_RECOVERY_INVALID_JOURNAL');
  return journal;
}
export function assertRecoveryAllowsNormalCall(journal: RecoveryJournalEntry[], records: UsageRecord[]) {
  const latest = journal.at(-1);
  if (!latest) return;
  if (latest.state !== 'succeeded') throw new Error('RESEARCH_RECOVERY_NOT_RELEASED');
  const prefix = records.slice(0, latest.permit.usageCount),
    record = records[latest.permit.usageCount];
  if (
    recoveryHash(prefix) !== latest.permit.usageHash ||
    record?.id !== latest.recordId ||
    record.estimatedUsd === null ||
    record.inputTokens === null ||
    record.outputTokens === null ||
    record.status === null ||
    record.status < 200 ||
    record.status >= 300
  )
    throw new Error('RESEARCH_RECOVERY_JOURNAL_MISMATCH');
}
export function probeOutcome(response: ResearchResponse | undefined): RecoveryReceipt['outcome'] {
  if (!response) return 'TRANSPORT_ERROR';
  if (response.status < 200 || response.status >= 300) return 'HTTP_ERROR';
  const body = z
    .object({
      candidates: z
        .array(
          z.object({
            finishReason: z.literal('STOP'),
            content: z.object({
              parts: z.array(
                z.object({
                  text: z.string().optional(),
                  thought: z.boolean().optional(),
                  functionCall: z.unknown().optional(),
                }),
              ),
            }),
          }),
        )
        .length(1),
      usageMetadata: z
        .object({
          promptTokenCount: z.number().int().positive(),
          candidatesTokenCount: z.number().int().positive(),
          thoughtsTokenCount: z.number().int().nonnegative().optional(),
          totalTokenCount: z.number().int().nonnegative().optional(),
        })
        .optional(),
    })
    .safeParse(response.json);
  if (!body.success) {
    const usage = (response.json as { usageMetadata?: unknown } | null)?.usageMetadata;
    return usage === undefined ? 'MISSING_USAGE' : 'INVALID_OUTPUT';
  }
  const usage = body.data.usageMetadata;
  if (!usage) return 'MISSING_USAGE';
  if (
    usage.totalTokenCount !== undefined &&
    usage.totalTokenCount !==
      usage.promptTokenCount + usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0)
  )
    return 'MISSING_USAGE';
  try {
    const parts = body.data.candidates[0].content.parts.filter((part) => !part.thought);
    if (
      parts.length !== 1 ||
      parts[0].text === undefined ||
      body.data.candidates[0].content.parts.some((part) => part.functionCall !== undefined)
    )
      return 'INVALID_OUTPUT';
    const result = z
      .object({ ok: z.literal(true) })
      .strict()
      .safeParse(JSON.parse(parts.map((part) => part.text).join('')));
    return result.success ? 'RECOVERED' : 'INVALID_OUTPUT';
  } catch {
    return 'INVALID_OUTPUT';
  }
}
