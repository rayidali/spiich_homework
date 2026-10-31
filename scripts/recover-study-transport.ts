/** One explicitly authorized operational probe; outside the frozen inference tree.
 * This is deliberately NOT a generic reset, a retry, or a quota-recovery alias.
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { StudyBudget, type UsageRecord } from '../research/budget';
import { assertStudyAllowanceReservation } from '../research/budget-policy';
import {
  assertRecoveryAllowsNormalCall,
  probeOutcome,
  quotaProbeRequest,
  recoveryHash,
  validateRecoveryJournal,
} from '../research/recovery';
import { sourceManifest } from '../research/manifest';
import { httpTransport, parseQueueCompletion, providerTransport } from '../research/io';
import type { ResearchRequest, ResearchResponse, ResearchTransport } from '../research/providers/transport';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const stamp = z.string().datetime({ offset: true });
const artifact = z.object({ path: z.string().min(1), sha256: digest }).strict();
const limits = { gemini: 10, jev: 4, attempts: 10000 } as const;
const generations = new Set(['generate', 'critic', 'file-search-query']);
const oldSuffixes = [
  '.policy.json',
  '.policy-required.json',
  '.study-policy.json',
  '.study-policy-required.json',
  '.recovery.json',
] as const;
const authorizationSchema = z
  .object({
    reason: z.literal('user_authorized_transport_stall_recovery'),
    confirmedAt: stamp,
    expiresAt: stamp,
    evidenceReference: z.string().min(1).max(500),
  })
  .strict();
const incidentSchema = z
  .object({
    schemaVersion: z.literal(1),
    reason: z.literal('dispatcher_completion_stall'),
    runId: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
    recordedAt: stamp,
    timeoutRecordIds: z.array(z.string().min(1)).length(3),
    dispatchAudit: artifact,
  })
  .strict();
const permitSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    createdAt: stamp,
    authorization: authorizationSchema,
    usagePath: z.string().min(1),
    usageCount: z.number().int().positive(),
    usageHash: digest,
    requestHash: digest,
    sourceHash: digest,
    bindings: z.array(artifact).min(12),
    incident: incidentSchema,
    runDirectory: z.string().min(1),
    dispatcherId: z.string().regex(/^transport-recovery-[a-f0-9-]{36}$/),
  })
  .strict();
export type TransportRecoveryAuthorization = z.infer<typeof authorizationSchema>;
export type TransportRecoveryPermit = z.infer<typeof permitSchema>;
export type TransportIncident = z.infer<typeof incidentSchema>;
type Checkpoint = 'consumed' | 'reserved' | 'verified' | 'ledger-completed';
export interface TransportRecoveryReceipt {
  schemaVersion: 1;
  reason: 'dispatcher_completion_stall';
  outcome: ReturnType<typeof probeOutcome> | 'USAGE_EXCEEDS_RESERVATION';
  provider: 'gemini';
  model: 'gemini-3.5-flash-lite';
  at: string;
  status: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reportedEstimatedUsd: number | null;
  countedUsd: number;
  previousUsageCount: number;
  previousUsageHash: string;
  preservedUnknownRecords: 3;
  priorRecordsUnchanged: true;
  sourceHash: string;
  incidentSha256: string;
  toolSha256: string;
  studyResumed: false;
}
const fail = (suffix: string): never => {
  throw new Error(`RESEARCH_TRANSPORT_RECOVERY_${suffix}`);
};
const bytesHash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) return fail('INVALID_ARTIFACT');
  return result.data;
}
function read(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fail('STATE_INVALID');
  }
}
function binding(path: string) {
  try {
    return { path: resolve(path), sha256: bytesHash(path) };
  } catch {
    return fail('BINDING_MISSING');
  }
}
/** Only this fixed payload/model is priced here. Tests compare it with frozen StudyBudget. */
export function transportProbeQuote(request: ResearchRequest): number {
  const key = request.headers['x-goog-api-key'];
  if (!key || recoveryHash(request) !== recoveryHash(quotaProbeRequest(key))) return fail('WRONG_REQUEST');
  return ((Buffer.byteLength(JSON.stringify(request.body)) + 2048) * 0.3 + 128 * 2.5) / 1e6;
}
function reportedUsage(response: ResearchResponse | undefined) {
  const metadata = (response?.json as { usageMetadata?: unknown } | undefined)?.usageMetadata;
  const parsed = z
    .object({
      promptTokenCount: z.number().int().nonnegative(),
      candidatesTokenCount: z.number().int().nonnegative(),
      thoughtsTokenCount: z.number().int().nonnegative().optional(),
    })
    .safeParse(metadata);
  if (!parsed.success) return { inputTokens: null, outputTokens: null, estimatedUsd: null };
  const inputTokens = parsed.data.promptTokenCount;
  const outputTokens = parsed.data.candidatesTokenCount + (parsed.data.thoughtsTokenCount ?? 0);
  const estimatedUsd = (inputTokens * 0.3 + outputTokens * 2.5) / 1e6;
  if (![inputTokens, outputTokens].every(Number.isSafeInteger) || !Number.isFinite(estimatedUsd))
    return { inputTokens: null, outputTokens: null, estimatedUsd: null };
  return { inputTokens, outputTokens, estimatedUsd };
}
function durableJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
function journalLine(path: string, value: unknown, create = false) {
  const fd = openSync(path, create ? 'wx' : 'a', 0o600);
  try {
    appendFileSync(fd, JSON.stringify(value) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // Persist creation before any reservation or provider operation.
  const directory = openSync(dirname(path), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
function outstandingWork(directory: string): boolean {
  const queue = join(directory, 'queue');
  if (!existsSync(queue)) return false;
  for (const name of readdirSync(queue)) {
    if (name.endsWith('.ready')) return true;
    if (name.endsWith('.claimed')) {
      const done = join(queue, name.replace(/\.claimed$/, '.done'));
      try {
        if (!existsSync(done) || !parseQueueCompletion(readFileSync(done, 'utf8'))) return true;
      } catch {
        return true;
      }
    }
  }
  return false;
}
async function exclusive<T>(usagePath: string, action: () => Promise<T>, preparing = false): Promise<T> {
  const directory = dirname(usagePath);
  const held: string[] = [];
  let entered = false;
  try {
    // During execution the separately activated, permit-bound dispatcher owns
    // pump-owner.lock. The helper owns budget and runner locks throughout.
    for (const path of [
      `${usagePath}.lock`,
      join(directory, 'runner.lock'),
      ...(preparing ? [join(directory, 'pump-owner.lock')] : []),
    ]) {
      let fd: number;
      try {
        fd = openSync(path, 'wx', 0o600);
      } catch {
        return fail('IN_USE');
      }
      held.push(path);
      try {
        writeFileSync(fd, String(process.pid));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    if (outstandingWork(directory)) return fail('OUTSTANDING_WORK');
    entered = true;
    return await action();
  } finally {
    // An unexpected active queue after the probe needs operator investigation;
    // never release ownership while the one request may still be in flight.
    if (!entered || !outstandingWork(directory)) for (const path of held.reverse()) unlinkSync(path);
  }
}
function dispatcher(directory: string, id: string, startedAt?: string) {
  try {
    if (
      readFileSync(join(directory, 'pump-owner.lock'), 'utf8').trim() !== id ||
      existsSync(join(directory, 'pump-stop'))
    )
      return fail('DISPATCHER_MISMATCH');
  } catch {
    return fail('DISPATCHER_MISMATCH');
  }
  const state = parse(
    z.object({
      runId: z.string(),
      phase: z.enum(['waiting', 'claimed', 'dispatching']),
      startedAt: stamp,
      requests: z.number().int().nonnegative().max(1),
      googleRequests: z.number().int().nonnegative().max(1),
      pending: z.unknown().nullable(),
    }),
    read(join(directory, 'pump-controller.json')),
  );
  if (state.runId !== id || (startedAt && state.startedAt !== startedAt)) return fail('DISPATCHER_MISMATCH');
  return state;
}
async function drainedDispatcher(directory: string, id: string, startedAt: string) {
  const end = performance.now() + 10000;
  while (true) {
    const state = dispatcher(directory, id, startedAt);
    if (
      state.phase === 'waiting' &&
      state.pending === null &&
      state.requests === 1 &&
      state.googleRequests === 1 &&
      !outstandingWork(directory)
    )
      return;
    if (performance.now() >= end) return fail('DISPATCHER_NOT_DRAINED');
    await new Promise((r) => setTimeout(r, 50));
  }
}
function timeAllowed(authorization: TransportRecoveryAuthorization, now: number) {
  const start = Date.parse(authorization.confirmedAt),
    end = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(now) || now < start || now >= end || end <= start || end - start > 3600000)
    return fail('AUTHORIZATION_TIME');
}
function installedState(path: string, request: ResearchRequest, reserveUsd: number) {
  if (!existsSync(path)) return fail('STATE_MISSING');
  const budget = new StudyBudget(path, limits);
  const parent = budget.keyCheckPolicy(),
    policy = budget.studyAllowancePolicy();
  if (!parent || !policy) return fail('FUNDED_POLICY_REQUIRED');
  assertRecoveryAllowsNormalCall(validateRecoveryJournal(read(`${path}.recovery.json`)), budget.records);
  assertStudyAllowanceReservation({ policy, parent, records: budget.records, request, reserveUsd });
  if (budget.records.length >= limits.attempts || budget.spend('gemini') + reserveUsd > limits.gemini)
    return fail('BUDGET_EXHAUSTED');
  return budget;
}
function verifyIncident(incident: TransportIncident, records: UsageRecord[], runDirectory: string) {
  const last = records.filter((r) => r.provider === 'gemini' && generations.has(r.kind)).slice(-3);
  if (
    last.length !== 3 ||
    new Set(incident.timeoutRecordIds).size !== 3 ||
    recoveryHash(last.map((r) => r.id)) !== recoveryHash(incident.timeoutRecordIds) ||
    last.some(
      (r) =>
        r.model !== 'gemini-3.5-flash-lite' ||
        r.estimatedUsd !== null ||
        r.status !== null ||
        !r.episode.startsWith(`${incident.runId}:`) ||
        !Number.isFinite(Date.parse(r.at)) ||
        Date.parse(r.at) > Date.parse(incident.recordedAt),
    )
  )
    return fail('INCIDENT_MISMATCH');
  let episodes: { id?: string; status?: string; error?: string }[];
  try {
    episodes = readFileSync(join(runDirectory, 'episodes.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return fail('EPISODES_INVALID');
  }
  for (const record of last) {
    const matching = episodes.filter((episode) => episode.id === record.episode);
    if (
      matching.length !== 1 ||
      matching[0].status !== 'error' ||
      matching[0].error !== 'RESEARCH_HTTP_TIMEOUT'
    )
      return fail('TIMEOUT_NOT_RECORDED');
  }
  if (binding(incident.dispatchAudit.path).sha256 !== incident.dispatchAudit.sha256)
    return fail('DISPATCH_AUDIT_CHANGED');
}
function currentBindings(usagePath: string, runDirectory: string, incidentPath: string) {
  return [
    ...oldSuffixes.map((suffix) => `${usagePath}${suffix}`),
    join(runDirectory, 'manifest.json'),
    join(runDirectory, 'source-manifest.json'),
    join(runDirectory, 'episodes.jsonl'),
    join(runDirectory, 'before.json'),
    'docs/PLAN.md',
    'research/budget.ts',
    incidentPath,
    'scripts/recover-study-transport.ts',
    join(dirname(usagePath), 'pump-support.py'),
    join(dirname(usagePath), 'launch-config.py'),
  ].map(binding);
}
function validateFrozen(runDirectory: string) {
  const manifest = parse(
    z.object({ runId: z.string(), sourceHash: digest, protocolHash: digest }),
    read(join(runDirectory, 'manifest.json')),
  );
  if (sourceManifest().hash !== manifest.sourceHash || bytesHash('docs/PLAN.md') !== manifest.protocolHash)
    return fail('FROZEN_SOURCE_CHANGED');
  return manifest;
}
export async function prepareTransportRecovery(input: {
  usagePath: string;
  runDirectory: string;
  incidentPath: string;
  request: ResearchRequest;
  authorization: unknown;
  now?: number;
}): Promise<TransportRecoveryPermit> {
  const usagePath = resolve(input.usagePath),
    runDirectory = resolve(input.runDirectory);
  return exclusive(
    usagePath,
    async () => {
      const authorization = parse(authorizationSchema, input.authorization),
        now = input.now ?? Date.now();
      timeAllowed(authorization, now);
      if (existsSync(`${usagePath}.transport-recovery.jsonl`)) return fail('ALREADY_CONSUMED');
      const reserveUsd = transportProbeQuote(input.request);
      const budget = installedState(usagePath, input.request, reserveUsd);
      const incident = parse(incidentSchema, read(input.incidentPath));
      verifyIncident(incident, budget.records, runDirectory);
      const manifest = validateFrozen(runDirectory);
      if (
        manifest.runId !== incident.runId ||
        Date.parse(authorization.confirmedAt) < Date.parse(incident.recordedAt)
      )
        return fail('INCIDENT_MISMATCH');
      const id = randomUUID();
      return parse(permitSchema, {
        schemaVersion: 1,
        id,
        createdAt: new Date(now).toISOString(),
        authorization,
        usagePath,
        usageCount: budget.records.length,
        usageHash: recoveryHash(budget.records),
        requestHash: recoveryHash(input.request),
        sourceHash: manifest.sourceHash,
        bindings: currentBindings(usagePath, runDirectory, input.incidentPath),
        incident,
        runDirectory,
        dispatcherId: `transport-recovery-${id}`,
      });
    },
    true,
  );
}
export async function executeTransportRecovery(input: {
  permit: unknown;
  request: ResearchRequest;
  transport: ResearchTransport;
  now?: () => number;
  /** Fault injection only; never repairs or retries a consumed operation. */
  checkpoint?: (point: Checkpoint) => void;
}): Promise<TransportRecoveryReceipt> {
  const permit = parse(permitSchema, input.permit);
  return exclusive(permit.usagePath, async () => {
    const now = input.now ?? Date.now;
    timeAllowed(permit.authorization, now());
    const directory = dirname(permit.usagePath);
    const owner = dispatcher(directory, permit.dispatcherId);
    if (
      owner.phase !== 'waiting' ||
      owner.pending !== null ||
      owner.requests !== 0 ||
      owner.googleRequests !== 0 ||
      Date.parse(owner.startedAt) < Date.parse(permit.createdAt)
    )
      return fail('DISPATCHER_NOT_FRESH');
    const journalPath = `${permit.usagePath}.transport-recovery.jsonl`;
    if (existsSync(journalPath)) return fail('ALREADY_CONSUMED');
    if (recoveryHash(input.request) !== permit.requestHash) return fail('REQUEST_CHANGED');
    const reserveUsd = transportProbeQuote(input.request);
    const budget = installedState(permit.usagePath, input.request, reserveUsd);
    if (budget.records.length !== permit.usageCount || recoveryHash(budget.records) !== permit.usageHash)
      return fail('HISTORY_CHANGED');
    for (const item of permit.bindings)
      if (binding(item.path).sha256 !== item.sha256) return fail('BINDING_CHANGED');
    const manifest = validateFrozen(permit.runDirectory);
    if (manifest.sourceHash !== permit.sourceHash || manifest.runId !== permit.incident.runId)
      return fail('FROZEN_SOURCE_CHANGED');
    verifyIncident(permit.incident, budget.records, permit.runDirectory);
    const record: UsageRecord = {
      id: randomUUID(),
      episode: `transport-recovery-probe:${permit.id}`,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      kind: 'generate',
      at: new Date(now()).toISOString(),
      reserveUsd,
      estimatedUsd: null,
      status: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
    };
    journalLine(journalPath, { event: 'consumed', at: record.at, permit, recordId: record.id }, true);
    input.checkpoint?.('consumed');
    const records = [...budget.records, record];
    durableJson(permit.usagePath, records);
    journalLine(journalPath, {
      event: 'reserved',
      at: new Date(now()).toISOString(),
      recordId: record.id,
      reserveUsd,
    });
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
      /* Safe diagnostic only: no provider body/key/raw error is persisted. */
    }
    // Provider completion can precede pump record bookkeeping. Wait only for the
    // same owner's single completed request; no second request is generated.
    await drainedDispatcher(directory, permit.dispatcherId, owner.startedAt);
    const usage = reportedUsage(response);
    let outcome: TransportRecoveryReceipt['outcome'] = probeOutcome(response);
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
    // Failed probes never become known-cost generations, even if usage was reported.
    // Their conservative charge cannot be reduced or silently understate an overrun.
    record.reserveUsd = Math.max(reserveUsd, usage.estimatedUsd ?? 0);
    const receipt: TransportRecoveryReceipt = {
      schemaVersion: 1,
      reason: 'dispatcher_completion_stall',
      outcome,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      at: new Date(now()).toISOString(),
      status: record.status,
      durationMs: record.durationMs,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      reportedEstimatedUsd: usage.estimatedUsd,
      countedUsd: outcome === 'RECOVERED' ? usage.estimatedUsd! : record.reserveUsd,
      previousUsageCount: permit.usageCount,
      previousUsageHash: permit.usageHash,
      preservedUnknownRecords: 3,
      priorRecordsUnchanged: true,
      sourceHash: permit.sourceHash,
      incidentSha256: recoveryHash(permit.incident),
      toolSha256: binding('scripts/recover-study-transport.ts').sha256,
      studyResumed: false,
    };
    // An injected transport cannot authorize unrelated mutations during the request.
    if (
      recoveryHash(new StudyBudget(permit.usagePath).records) !==
      recoveryHash([
        ...budget.records,
        { ...record, reserveUsd, status: null, durationMs: null, inputTokens: null, outputTokens: null },
      ])
    )
      return fail('HISTORY_CHANGED');
    for (const item of permit.bindings)
      if (binding(item.path).sha256 !== item.sha256) return fail('BINDING_CHANGED');
    const afterSource = validateFrozen(permit.runDirectory);
    if (afterSource.sourceHash !== permit.sourceHash || afterSource.runId !== permit.incident.runId)
      return fail('FROZEN_SOURCE_CHANGED');
    if (outcome === 'RECOVERED') {
      // Durable proof FIRST. No pending/failed journal state can open the circuit.
      journalLine(journalPath, { event: 'verified-success', receipt, recordId: record.id });
      input.checkpoint?.('verified');
      record.estimatedUsd = usage.estimatedUsd;
    } else journalLine(journalPath, { event: 'failed', receipt, recordId: record.id });
    durableJson(permit.usagePath, records);
    input.checkpoint?.('ledger-completed');
    journalLine(journalPath, {
      event: 'ledger-committed',
      recordId: record.id,
      outcome,
      usageHash: recoveryHash(records),
    });
    return receipt;
  });
}

/** Shared operational mechanics only. Historical one-shot admission rules above
 * remain unchanged; the finite operator registry owns its separate admission. */
export const transportRecoveryOperations = {
  reportedUsage,
  durableJson,
  journalLine,
  outstandingWork,
  exclusive,
  dispatcher,
  drainedDispatcher,
  installedState,
};

async function main() {
  await import('dotenv/config');
  const [mode, ...args] = process.argv.slice(2);
  if (!['prepare', 'execute'].includes(mode) || args.length % 2) return fail('ARGUMENTS');
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (
      !['--authorization', '--incident', '--run-directory', '--permit', '--receipt'].includes(args[i]) ||
      options.has(args[i])
    )
      return fail('ARGUMENTS');
    options.set(args[i], args[i + 1]);
  }
  const permitPath = resolve(options.get('--permit') ?? '');
  if (!permitPath.startsWith(`${resolve('.tools/research')}/`)) return fail('PRIVATE_PERMIT_REQUIRED');
  const request = quotaProbeRequest(process.env.GEMINI_API_KEY ?? '');
  if (mode === 'prepare') {
    if (
      existsSync(permitPath) ||
      !options.get('--authorization') ||
      !options.get('--incident') ||
      !options.get('--run-directory') ||
      options.has('--receipt')
    )
      return fail('ARGUMENTS');
    const authorizationPath = resolve(options.get('--authorization')!);
    if (!authorizationPath.startsWith(`${resolve('.tools/research')}/`))
      return fail('PRIVATE_AUTHORIZATION_REQUIRED');
    const permit = await prepareTransportRecovery({
      usagePath: '.tools/research/usage.json',
      runDirectory: options.get('--run-directory')!,
      incidentPath: options.get('--incident')!,
      authorization: read(authorizationPath),
      request,
    });
    // Exclusive creation; private request/key bindings never enter the public receipt.
    const fd = openSync(permitPath, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(permit, null, 2) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    console.log(
      JSON.stringify({ prepared: true, providerCalls: 0, expiresAt: permit.authorization.expiresAt }),
    );
    return;
  }
  if (!options.get('--receipt') || options.size !== 2) return fail('ARGUMENTS');
  if (process.env.RESEARCH_TRANSPORT !== 'queue') return fail('QUEUED_EXECUTION_REQUIRED');
  const receiptPath = resolve(options.get('--receipt')!);
  if (existsSync(receiptPath)) return fail('RECEIPT_EXISTS');
  const permit = parse(permitSchema, read(permitPath));
  if (permit.usagePath !== resolve('.tools/research/usage.json')) return fail('USAGE_PATH_MISMATCH');
  const receipt = await executeTransportRecovery({
    permit,
    request,
    transport: providerTransport(httpTransport()),
  });
  mkdirSync(dirname(receiptPath), { recursive: true });
  durableJson(receiptPath, receipt);
  console.log(JSON.stringify({ outcome: receipt.outcome, status: receipt.status, studyResumed: false }));
  if (receipt.outcome !== 'RECOVERED') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error: unknown) => {
    const message =
      error instanceof Error && /^RESEARCH_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'RESEARCH_TRANSPORT_RECOVERY_FAILED';
    console.error(JSON.stringify({ error: message, studyResumed: false }));
    process.exitCode = 1;
  });
