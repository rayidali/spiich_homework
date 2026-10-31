/** Finite, manually admitted operational recovery for holdout-v1 interruption 01.
 * No automatic retries, scoring changes, history repair or allowance renewal.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { StudyBudget, type UsageRecord } from '../research/budget';
import { sourceManifest } from '../research/manifest';
import { quotaProbeRequest, probeOutcome, recoveryHash } from '../research/recovery';
import { httpTransport, providerTransport } from '../research/io';
import type { ResearchRequest, ResearchResponse, ResearchTransport } from '../research/providers/transport';
import { transportProbeQuote, transportRecoveryOperations as op } from './recover-study-transport';

const digest = z.string().regex(/^[a-f0-9]{64}$/),
  stamp = z.string().datetime({ offset: true });
const bindingSchema = z.object({ path: z.string(), sha256: digest }).strict();
const reason = 'operator_reviewed_transport_recovery' as const;
const authorizationSchema = z
  .object({
    reason: z.literal(reason),
    confirmedAt: stamp,
    expiresAt: stamp,
    evidenceReference: z.string().min(1).max(500),
  })
  .strict();
const headerSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    incidentId: z.literal('holdout-v1-interruption-01'),
    createdAt: stamp,
    authorization: authorizationSchema,
    baselineCount: z.literal(3121),
    baselineHash: digest,
    requestHash: digest,
    sourceHash: digest,
    protocolHash: digest,
    runDirectory: z.string(),
    maximumAttempts: z.literal(3),
    maximumCumulativeReservationsUsd: z.literal(0.005),
    bindings: z.array(bindingSchema).min(10),
    initialDispatchers: z.array(bindingSchema).min(2),
  })
  .strict();
const reviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('operator_transport_review'),
    incidentId: z.literal('holdout-v1-interruption-01'),
    reviewedAt: stamp,
    diagnosis: z.string().min(1).max(2000),
    remediation: z.string().min(1).max(2000),
    transportMode: z.literal('approved_plain_curl_config'),
    connectivityEvidence: bindingSchema,
    incidentEvidence: bindingSchema,
  })
  .strict();
const admissionSchema = z
  .object({
    id: z.string().uuid(),
    at: stamp,
    expiresAt: stamp,
    authorization: authorizationSchema,
    review: bindingSchema,
    reviewValue: reviewSchema,
    usageCount: z.number().int().min(3121),
    usageHash: digest,
    requestHash: digest,
    dispatcherId: z.string().regex(/^operator-probe-[a-f0-9-]{36}$/),
    dispatcherBindings: z.array(bindingSchema).min(2),
  })
  .strict();
type Admission = z.infer<typeof admissionSchema>;
type Event = {
  sequence: number;
  previousHash: string | null;
  kind: string;
  at: string;
  payload: unknown;
  hash: string;
};
type Attempt = {
  admission: Admission;
  recordId: string;
  reserveUsd: number;
  state: 'pending' | 'failed' | 'success';
  finalHash?: string;
};
const fail = (code: string): never => {
  throw new Error(`RESEARCH_OPERATOR_RECOVERY_${code}`);
};
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const v = schema.safeParse(value);
  if (!v.success) return fail('INVALID_STATE');
  return v.data;
}
function read(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fail('INVALID_STATE');
  }
}
function bind(path: string) {
  try {
    return { path: resolve(path), sha256: sha(path) };
  } catch {
    return fail('MISSING_ARTIFACT');
  }
}
function checkBindings(bindings: { path: string; sha256: string }[]) {
  for (const b of bindings) if (bind(b.path).sha256 !== b.sha256) return fail('BINDING_CHANGED');
}
const paths = (usagePath: string) => ({
  journal: `${usagePath}.operator-recovery.jsonl`,
  marker: `${usagePath}.operator-recovery-required.json`,
});
function timeAllowed(value: z.infer<typeof authorizationSchema>, now: number) {
  const start = Date.parse(value.confirmedAt),
    end = Date.parse(value.expiresAt);
  if (now < start || now >= end || end <= start || end - start > 3600000) return fail('AUTHORIZATION_TIME');
}
function append(path: string, events: Event[], kind: string, payload: unknown, now: number) {
  const base = {
    sequence: events.length,
    previousHash: events.at(-1)?.hash ?? null,
    kind,
    at: new Date(now).toISOString(),
    payload,
  };
  const event = { ...base, hash: recoveryHash(base) };
  op.journalLine(path, event, events.length === 0);
  events.push(event);
  return event;
}
function readRegistry(usagePath: string) {
  const p = paths(usagePath);
  if (!existsSync(p.journal) || !existsSync(p.marker)) return fail('REGISTRY_INCOMPLETE');
  let events: Event[];
  try {
    events = readFileSync(p.journal, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  } catch {
    return fail('INVALID_STATE');
  }
  if (!events.length) return fail('INVALID_STATE');
  for (const [i, event] of events.entries()) {
    const { hash, ...base } = event;
    if (
      event.sequence !== i ||
      event.previousHash !== (i ? events[i - 1].hash : null) ||
      hash !== recoveryHash(base)
    )
      return fail('JOURNAL_CHANGED');
  }
  if (events[0].kind !== 'installed') return fail('INVALID_STATE');
  const header = parse(headerSchema, events[0].payload);
  const marker = parse(z.object({ cohortId: z.string(), headerHash: digest }).strict(), read(p.marker));
  if (marker.cohortId !== header.id || marker.headerHash !== events[0].hash) return fail('MARKER_CHANGED');
  const attempts: Attempt[] = [];
  const admissions: Admission[] = [];
  let available: Admission | null = null,
    closed = false;
  for (const event of events.slice(1)) {
    if (closed) return fail('EVENT_AFTER_SUCCESS');
    if (event.kind === 'admitted') {
      if (available || attempts.at(-1)?.state === 'pending') return fail('ADMISSION_STATE');
      const admission = parse(admissionSchema, event.payload);
      if (
        recoveryHash(admission.dispatcherBindings.map((b) => b.path)) !==
        recoveryHash(header.initialDispatchers.map((b) => b.path))
      )
        return fail('DISPATCHER_PATHS_CHANGED');
      if (admissions.some((a) => a.id === admission.id)) return fail('ADMISSION_REPLAY');
      admissions.push(admission);
      available = admission;
    } else if (event.kind === 'consumed') {
      const v = parse(
        z
          .object({ admissionId: z.string(), recordId: z.string(), reserveUsd: z.number().positive() })
          .strict(),
        event.payload,
      );
      if (!available || available.id !== v.admissionId) return fail('ADMISSION_STATE');
      attempts.push({
        admission: available,
        recordId: v.recordId,
        reserveUsd: v.reserveUsd,
        state: 'pending',
      });
      available = null;
    } else if (event.kind === 'failed' || event.kind === 'verified-success') {
      const v = parse(
        z.object({ recordId: z.string(), completedRecordHash: digest, receipt: z.unknown() }).strict(),
        event.payload,
      );
      const attempt = attempts.at(-1);
      if (!attempt || attempt.state !== 'pending' || attempt.recordId !== v.recordId)
        return fail('ADMISSION_STATE');
      attempt.state = event.kind === 'failed' ? 'failed' : 'success';
      attempt.finalHash = v.completedRecordHash;
      closed = attempt.state === 'success';
    } else return fail('UNKNOWN_EVENT');
  }
  if (attempts.length > 3 || attempts.reduce((sum, a) => sum + a.reserveUsd, 0) > 0.005)
    return fail('COHORT_EXHAUSTED');
  return { p, events, header, attempts, admissions, available, closed };
}
function verifyState(usagePath: string, request: ResearchRequest) {
  const state = readRegistry(usagePath),
    budget = new StudyBudget(usagePath),
    records = budget.records;
  const { header, attempts } = state;
  if (
    records.length < header.baselineCount ||
    recoveryHash(records.slice(0, header.baselineCount)) !== header.baselineHash
  )
    return fail('HISTORY_CHANGED');
  if (recoveryHash(request) !== header.requestHash) return fail('REQUEST_CHANGED');
  checkBindings(header.bindings);
  if (sourceManifest().hash !== header.sourceHash || sha('docs/PLAN.md') !== header.protocolHash)
    return fail('FROZEN_SOURCE_CHANGED');
  const suffix = records.slice(header.baselineCount);
  if (
    suffix.length > attempts.length ||
    suffix.length < attempts.length - (attempts.at(-1)?.state === 'pending' ? 1 : 0)
  )
    return fail('HISTORY_CHANGED');
  for (const [i, record] of suffix.entries()) {
    const attempt = attempts[i];
    if (
      !attempt ||
      record.id !== attempt.recordId ||
      record.episode !== `operator-probe:${header.id}:${attempt.admission.id}` ||
      record.reserveUsd < attempt.reserveUsd ||
      record.provider !== 'gemini' ||
      record.kind !== 'generate' ||
      record.model !== 'gemini-3.5-flash-lite' ||
      (attempt.state !== 'success' && record.estimatedUsd !== null) ||
      (attempt.state === 'failed' && recoveryHash(record) !== attempt.finalHash) ||
      (attempt.state === 'success' &&
        record.estimatedUsd !== null &&
        recoveryHash(record) !== attempt.finalHash)
    )
      return fail('HISTORY_CHANGED');
  }
  // Success is already terminal even if a crash prevented its known-cost ledger
  // publication; pending admissions similarly cannot be replaced automatically.
  return { ...state, budget, records };
}
function assertReady(state: ReturnType<typeof verifyState>, reserveUsd: number) {
  if (state.closed) return fail('COHORT_CLOSED');
  if (state.attempts.at(-1)?.state === 'pending') return fail('ATTEMPT_PENDING');
  const charges = state.attempts.reduce(
    (sum, attempt, i) => sum + Math.max(attempt.reserveUsd, state.records[3121 + i]?.reserveUsd ?? 0),
    0,
  );
  if (state.attempts.length >= 3 || charges + reserveUsd > 0.005) return fail('COHORT_EXHAUSTED');
}
function checkedReview(path: string, now: number) {
  const review = parse(reviewSchema, read(path));
  if (Date.parse(review.reviewedAt) > now || now - Date.parse(review.reviewedAt) > 3600000)
    return fail('REVIEW_STALE');
  checkBindings([review.connectivityEvidence, review.incidentEvidence]);
  return review;
}
export async function installOperatorRecovery(input: {
  usagePath: string;
  runDirectory: string;
  request: ResearchRequest;
  authorization: unknown;
  diagnosisPath: string;
  priorFailureReceiptPath: string;
  historicalSources: string[];
  dispatcherFiles: string[];
  now?: number;
}) {
  const usagePath = resolve(input.usagePath),
    p = paths(usagePath),
    now = input.now ?? Date.now();
  return op.exclusive(
    usagePath,
    async () => {
      if (existsSync(p.journal) || existsSync(p.marker)) return fail('ALREADY_INSTALLED');
      const authorization = parse(authorizationSchema, input.authorization);
      timeAllowed(authorization, now);
      const budget = op.installedState(usagePath, input.request, transportProbeQuote(input.request));
      if (
        budget.records.length !== 3121 ||
        budget.records.some((r) => r.episode.startsWith('operator-probe:'))
      )
        return fail('BASELINE_CHANGED');
      const original = `${usagePath}.transport-recovery.jsonl`,
        continuation = `${usagePath}.prelaunch-continuation.jsonl`;
      const oldEvents = (path: string) =>
        readFileSync(path, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line).event);
      if (
        recoveryHash(oldEvents(original)) !== recoveryHash(['consumed', 'reserved']) ||
        recoveryHash(oldEvents(continuation)) !==
          recoveryHash(['consumed', 'reserved', 'failed', 'ledger-committed'])
      )
        return fail('OLD_RECOVERY_NOT_SETTLED');
      const priorFailureValue = read(input.priorFailureReceiptPath);
      const priorFailure = parse(
        z
          .object({
            reason: z.literal('proven_prelaunch_rejection_continuation'),
            outcome: z.literal('TRANSPORT_ERROR'),
            previousUsageCount: z.literal(3120),
            previousUsageHash: digest,
            sourceHash: digest,
            countedUsd: z.number().positive(),
            priorRecordsUnchanged: z.literal(true),
            originalJournalUnchanged: z.literal(true),
            studyResumed: z.literal(false),
          })
          .passthrough(),
        priorFailureValue,
      );
      const oldContinuation = readFileSync(continuation, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const last = budget.records[3120];
      if (
        priorFailure.previousUsageHash !== recoveryHash(budget.records.slice(0, 3120)) ||
        last.estimatedUsd !== null ||
        last.status !== null ||
        last.reserveUsd !== priorFailure.countedUsd ||
        oldContinuation[2].recordId !== last.id ||
        recoveryHash(oldContinuation[2].receipt) !== recoveryHash(priorFailureValue) ||
        oldContinuation[3].usageHash !== recoveryHash(budget.records)
      )
        return fail('PRIOR_FAILURE_CHANGED');
      const manifest = parse(
        z.object({ runId: z.literal('holdout-v1'), sourceHash: digest, protocolHash: digest }),
        read(join(input.runDirectory, 'manifest.json')),
      );
      if (sourceManifest().hash !== manifest.sourceHash || sha('docs/PLAN.md') !== manifest.protocolHash)
        return fail('FROZEN_SOURCE_CHANGED');
      if (priorFailure.sourceHash !== manifest.sourceHash) return fail('PRIOR_FAILURE_CHANGED');
      const review = checkedReview(input.diagnosisPath, now);
      const required = [
        original,
        continuation,
        ...[
          '.policy.json',
          '.policy-required.json',
          '.study-policy.json',
          '.study-policy-required.json',
          '.recovery.json',
        ].map((s) => usagePath + s),
        join(input.runDirectory, 'manifest.json'),
        join(input.runDirectory, 'before.json'),
        join(input.runDirectory, 'source-manifest.json'),
        join(input.runDirectory, 'episodes.jsonl'),
        join(dirname(usagePath), 'index-state.json'),
        'docs/PLAN.md',
        'scripts/operator-recovery.ts',
        'scripts/recover-study-transport.ts',
        input.diagnosisPath,
        input.priorFailureReceiptPath,
        review.connectivityEvidence.path,
        review.incidentEvidence.path,
        ...input.historicalSources,
      ];
      if (input.historicalSources.length < 2 || input.dispatcherFiles.length < 2)
        return fail('SOURCE_EVIDENCE_REQUIRED');
      const header = parse(headerSchema, {
        schemaVersion: 1,
        id: randomUUID(),
        incidentId: 'holdout-v1-interruption-01',
        createdAt: new Date(now).toISOString(),
        authorization,
        baselineCount: 3121,
        baselineHash: recoveryHash(budget.records),
        requestHash: recoveryHash(input.request),
        sourceHash: manifest.sourceHash,
        protocolHash: manifest.protocolHash,
        runDirectory: resolve(input.runDirectory),
        maximumAttempts: 3,
        maximumCumulativeReservationsUsd: 0.005,
        bindings: [...new Set(required)].map(bind),
        initialDispatchers: input.dispatcherFiles.map(bind),
      });
      const events: Event[] = [];
      append(p.journal, events, 'installed', header, now);
      op.durableJson(p.marker, { cohortId: header.id, headerHash: events[0].hash });
      return {
        cohortId: header.id,
        maximumAttempts: 3,
        maximumCumulativeReservationsUsd: 0.005,
        providerCalls: 0,
      };
    },
    true,
  );
}
export async function admitOperatorRecovery(input: {
  usagePath: string;
  request: ResearchRequest;
  authorization: unknown;
  reviewPath: string;
  now?: number;
}) {
  const usagePath = resolve(input.usagePath),
    now = input.now ?? Date.now();
  return op.exclusive(
    usagePath,
    async () => {
      const state = verifyState(usagePath, input.request);
      assertReady(state, transportProbeQuote(input.request));
      if (state.available) return fail('ADMISSION_ALREADY_EXISTS');
      if (!state.attempts.length) checkBindings(state.header.initialDispatchers);
      const authorization = parse(authorizationSchema, input.authorization);
      timeAllowed(authorization, now);
      const review = checkedReview(input.reviewPath, now);
      if (state.admissions.some((a) => a.review.sha256 === bind(input.reviewPath).sha256))
        return fail('REVIEW_REUSED');
      if (state.attempts.at(-1) && Date.parse(review.reviewedAt) <= Date.parse(state.events.at(-1)!.at))
        return fail('REVIEW_PREDATES_FAILURE');
      op.installedState(usagePath, input.request, transportProbeQuote(input.request));
      const id = randomUUID();
      const admission = parse(admissionSchema, {
        id,
        at: new Date(now).toISOString(),
        expiresAt: authorization.expiresAt,
        authorization,
        review: bind(input.reviewPath),
        reviewValue: review,
        usageCount: state.records.length,
        usageHash: recoveryHash(state.records),
        requestHash: recoveryHash(input.request),
        dispatcherId: `operator-probe-${id}`,
        dispatcherBindings: state.header.initialDispatchers.map((item) => bind(item.path)),
      });
      append(state.p.journal, state.events, 'admitted', admission, now);
      return {
        admissionId: id,
        dispatcherId: admission.dispatcherId,
        expiresAt: admission.expiresAt,
        providerCalls: 0,
      };
    },
    true,
  );
}
export async function executeOperatorRecovery(input: {
  usagePath: string;
  admissionId: string;
  request: ResearchRequest;
  transport: ResearchTransport;
  now?: () => number;
  checkpoint?: (point: 'consumed' | 'reserved' | 'verified' | 'ledger-completed') => void;
}) {
  const usagePath = resolve(input.usagePath);
  return op.exclusive(usagePath, async () => {
    const now = input.now ?? Date.now,
      state = verifyState(usagePath, input.request),
      reserveUsd = transportProbeQuote(input.request);
    assertReady(state, reserveUsd);
    const admission = state.available;
    if (!admission || admission.id !== input.admissionId) return fail('ADMISSION_MISSING');
    timeAllowed(admission.authorization, now());
    checkBindings([admission.review]);
    checkBindings(admission.dispatcherBindings);
    checkedReview(admission.review.path, now());
    if (admission.usageHash !== recoveryHash(state.records) || admission.usageCount !== state.records.length)
      return fail('ADMISSION_HISTORY_CHANGED');
    const directory = dirname(usagePath),
      owner = op.dispatcher(directory, admission.dispatcherId);
    if (
      owner.phase !== 'waiting' ||
      owner.pending !== null ||
      owner.requests !== 0 ||
      owner.googleRequests !== 0 ||
      Date.parse(owner.startedAt) < Date.parse(admission.at)
    )
      return fail('DISPATCHER_NOT_FRESH');
    op.installedState(usagePath, input.request, reserveUsd);
    const record: UsageRecord = {
      id: randomUUID(),
      episode: `operator-probe:${state.header.id}:${admission.id}`,
      provider: 'gemini',
      kind: 'generate',
      model: 'gemini-3.5-flash-lite',
      at: new Date(now()).toISOString(),
      reserveUsd,
      estimatedUsd: null,
      status: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
    };
    append(
      state.p.journal,
      state.events,
      'consumed',
      { admissionId: admission.id, recordId: record.id, reserveUsd },
      now(),
    );
    input.checkpoint?.('consumed');
    const records = [...state.records, record],
      reservedHash = recoveryHash(records);
    op.durableJson(usagePath, records);
    input.checkpoint?.('reserved');
    let response: ResearchResponse | undefined;
    try {
      response = await input.transport(input.request);
      if (
        !Number.isInteger(response.status) ||
        response.status < 100 ||
        response.status > 599 ||
        !Number.isFinite(response.elapsedMs) ||
        response.elapsedMs < 0
      )
        response = undefined;
    } catch {
      /* Preserve unknown cost; no raw error/key/provider body. */
    }
    await op.drainedDispatcher(directory, admission.dispatcherId, owner.startedAt);
    const usage = op.reportedUsage(response);
    let outcome: ReturnType<typeof probeOutcome> | 'USAGE_EXCEEDS_RESERVATION' = probeOutcome(response);
    if (
      outcome === 'RECOVERED' &&
      (usage.estimatedUsd === null ||
        usage.estimatedUsd > reserveUsd ||
        (usage.outputTokens ?? Infinity) > 128 ||
        (usage.inputTokens ?? Infinity) > Buffer.byteLength(JSON.stringify(input.request.body)) + 2048)
    )
      outcome = 'USAGE_EXCEEDS_RESERVATION';
    record.status = response?.status ?? null;
    record.durationMs = response?.elapsedMs ?? null;
    record.inputTokens = usage.inputTokens;
    record.outputTokens = usage.outputTokens;
    record.reserveUsd = Math.max(reserveUsd, usage.estimatedUsd ?? 0);
    if (recoveryHash(new StudyBudget(usagePath).records) !== reservedHash) return fail('HISTORY_CHANGED');
    checkBindings(state.header.bindings);
    checkBindings([admission.review]);
    checkBindings(admission.dispatcherBindings);
    if (
      sourceManifest().hash !== state.header.sourceHash ||
      sha('docs/PLAN.md') !== state.header.protocolHash
    )
      return fail('FROZEN_SOURCE_CHANGED');
    const receipt = {
      schemaVersion: 1,
      kind: 'operator_recovery_probe',
      incidentId: state.header.incidentId,
      at: new Date(now()).toISOString(),
      outcome,
      status: record.status,
      durationMs: record.durationMs,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      reportedEstimatedUsd: usage.estimatedUsd,
      countedUsd: outcome === 'RECOVERED' ? usage.estimatedUsd : record.reserveUsd,
      attemptsConsumed: state.attempts.length + 1,
      cumulativeReservationUsd:
        state.attempts.reduce(
          (sum, a, i) => sum + Math.max(a.reserveUsd, records[3121 + i]?.reserveUsd ?? 0),
          0,
        ) + record.reserveUsd,
      cohortClosed: outcome === 'RECOVERED',
      baselineCount: 3121,
      baselinePreserved: true,
      previousUsageCount: state.records.length,
      sourceHash: state.header.sourceHash,
      operatorReviewSha256: admission.review.sha256,
      studyResumed: false,
    };
    if (outcome === 'RECOVERED') record.estimatedUsd = usage.estimatedUsd;
    // A verified-success event permanently closes this cohort BEFORE a known
    // row can reopen the unchanged runtime circuit. No later admission is legal.
    append(
      state.p.journal,
      state.events,
      outcome === 'RECOVERED' ? 'verified-success' : 'failed',
      { recordId: record.id, completedRecordHash: recoveryHash(record), receipt },
      now(),
    );
    input.checkpoint?.('verified');
    op.durableJson(usagePath, records);
    input.checkpoint?.('ledger-completed');
    return receipt;
  });
}

async function main() {
  await import('dotenv/config');
  const [mode, ...args] = process.argv.slice(2);
  const options = new Map<string, string>();
  if (!['install', 'admit', 'execute'].includes(mode) || args.length % 2) return fail('ARGUMENTS');
  for (let i = 0; i < args.length; i += 2) {
    if (options.has(args[i])) return fail('ARGUMENTS');
    options.set(args[i], args[i + 1]);
  }
  const usagePath = '.tools/research/usage.json',
    request = quotaProbeRequest(process.env.GEMINI_API_KEY ?? '');
  if (mode === 'install') {
    const configPath = resolve(options.get('--config') ?? '');
    if (options.size !== 1 || !configPath.startsWith(resolve('.tools/research') + '/'))
      return fail('ARGUMENTS');
    const config = parse(
      z
        .object({
          runDirectory: z.string(),
          authorization: authorizationSchema,
          diagnosisPath: z.string(),
          priorFailureReceiptPath: z.string(),
          historicalSources: z.array(z.string()),
          dispatcherFiles: z.array(z.string()),
        })
        .strict(),
      read(configPath),
    );
    console.log(JSON.stringify(await installOperatorRecovery({ ...config, usagePath, request })));
    return;
  }
  if (mode === 'admit') {
    const configPath = resolve(options.get('--config') ?? '');
    if (options.size !== 1 || !configPath.startsWith(resolve('.tools/research') + '/'))
      return fail('ARGUMENTS');
    const config = parse(
      z.object({ authorization: authorizationSchema, reviewPath: z.string() }).strict(),
      read(configPath),
    );
    console.log(JSON.stringify(await admitOperatorRecovery({ ...config, usagePath, request })));
    return;
  }
  if (
    options.size !== 2 ||
    !options.get('--admission') ||
    !options.get('--receipt') ||
    process.env.RESEARCH_TRANSPORT !== 'queue'
  )
    return fail('ARGUMENTS');
  const receiptPath = resolve(options.get('--receipt')!);
  if (existsSync(receiptPath)) return fail('RECEIPT_EXISTS');
  const receipt = await executeOperatorRecovery({
    usagePath,
    request,
    admissionId: options.get('--admission')!,
    transport: providerTransport(httpTransport()),
  });
  op.durableJson(receiptPath, receipt);
  console.log(JSON.stringify({ outcome: receipt.outcome, studyResumed: false }));
  if (receipt.outcome !== 'RECOVERED') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((e: unknown) => {
    console.error(
      JSON.stringify({
        error:
          e instanceof Error && /^RESEARCH_[A-Z_]+$/.test(e.message)
            ? e.message
            : 'RESEARCH_OPERATOR_RECOVERY_FAILED',
      }),
    );
    process.exitCode = 1;
  });
