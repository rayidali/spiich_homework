/** One continuation of the archived INVALID_DIRECTIVE_VALUE rejection.
 * Never retries a dispatched, ambiguous, or provider-failed request.
 * Original recovery implementation, journal and reservations stay untouched.
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
import { dirname, join, resolve, basename } from 'node:path';
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
import {
  httpTransport,
  parseQueueCompletion,
  providerTransport,
  QUEUE_COMPLETION_MARKER,
} from '../research/io';
import type { ResearchRequest, ResearchResponse, ResearchTransport } from '../research/providers/transport';
import { transportProbeQuote } from './recover-study-transport';

const digest = z.string().regex(/^[a-f0-9]{64}$/),
  stamp = z.string().datetime({ offset: true });
const artifact = z.object({ path: z.string().min(1), sha256: digest }).strict();
const limits = { gemini: 10, jev: 4, attempts: 10000 } as const;
const authorizationSchema = z
  .object({
    reason: z.literal('continue_authorized_call_after_proven_prelaunch_rejection'),
    confirmedAt: stamp,
    expiresAt: stamp,
    evidenceReference: z.string().min(1).max(500),
  })
  .strict();
const permitSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    createdAt: stamp,
    authorization: authorizationSchema,
    usagePath: z.string(),
    usageCount: z.literal(3120),
    usageHash: digest,
    requestHash: digest,
    sourceHash: digest,
    protocolHash: digest,
    originalPermitId: z.string().uuid(),
    originalRecordId: z.string(),
    originalJournalSha256: digest,
    rejectionEvidence: artifact,
    archiveManifest: artifact,
    proofDirectory: z.string(),
    bindings: z.array(artifact),
    dispatcherId: z.string().regex(/^prelaunch-continue-[a-f0-9-]{36}$/),
  })
  .strict();
export type PrelaunchPermit = z.infer<typeof permitSchema>;
const fail = (code: string): never => {
  throw new Error(`RESEARCH_PRELAUNCH_CONTINUATION_${code}`);
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
function lines(path: string): unknown[] {
  try {
    return readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((s) => JSON.parse(s));
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
function timeAllowed(authorization: { confirmedAt: string; expiresAt: string }, now: number) {
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

const rejectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('transport_recovery_probe_local_rejection'),
    at: stamp,
    permitId: z.string().uuid(),
    dispatcherId: z.string(),
    reason: z.literal('INVALID_DIRECTIVE_VALUE'),
    curlProcessExitCode: z.literal(2),
    configurationEmitted: z.literal(false),
    networkRequestDispatched: z.literal(false),
    launchReceiptPresent: z.literal(false),
    responseFilePresent: z.literal(false),
    headersFilePresent: z.literal(false),
    completionFooterPresent: z.literal(false),
    originalRequestBodyPresent: z.literal(true),
    studyResumed: z.literal(false),
    preservedUsageRecords: z.literal(3120),
    ledgerSha256: digest,
    journalSha256: digest,
    privateArchiveManifestSha256: digest,
    claimedMetadataSha256: digest,
    curlConfigurationSha256: digest,
    requestBodySha256: digest,
    stoppedControllerSha256: digest,
    metricsSha256: digest,
    launcherV1Sha256: digest,
    archivedRequestFiles: z.literal(3),
    archivedStaleLocks: z.literal(2),
    staleOwnerPidExited: z.literal(true),
    readyCount: z.literal(0),
    claimedWithoutDone: z.literal(0),
    retryPerformed: z.literal(false),
    reservationReduced: z.literal(false),
  })
  .passthrough();
type ProofInput = {
  usagePath: string;
  evidencePath: string;
  archiveManifestPath: string;
  proofDirectory: string;
  request: ResearchRequest;
};
function expectedQueuedConfig(request: ResearchRequest, stem: string) {
  const quote = JSON.stringify;
  return (
    [
      'no-fail',
      'silent',
      'show-error',
      'proto = "=https"',
      'max-redirs = 0',
      'max-time = 25',
      'max-filesize = 8000000',
      `url = ${quote(request.url)}`,
      `request = ${quote(request.method)}`,
      ...Object.entries(request.headers).map(([k, v]) => `header = ${quote(`${k}: ${v}`)}`),
      `data-binary = ${quote(`@${stem}.body`)}`,
      `output = ${quote(`${stem}.response`)}`,
      `dump-header = ${quote(`${stem}.headers`)}`,
      `write-out = ${quote(`%output{${stem}.done}%{http_code} %{time_total} %{exitcode} ${QUEUE_COMPLETION_MARKER}\n`)}`,
    ].join('\n') + '\n'
  );
}
/** Local evidence proves this particular guard rejection, not arbitrary lack of response. */
function originalProof(input: ProofInput) {
  const reserveUsd = transportProbeQuote(input.request);
  const budget = installedState(input.usagePath, input.request, reserveUsd);
  if (budget.records.length !== 3120) return fail('ORIGINAL_HISTORY_COUNT');
  const originalJournal = `${input.usagePath}.transport-recovery.jsonl`;
  const events = lines(originalJournal);
  if (events.length !== 2) return fail('ORIGINAL_ALREADY_ATTEMPTED');
  const first = parse(
    z
      .object({
        event: z.literal('consumed'),
        at: stamp,
        recordId: z.string(),
        permit: z
          .object({
            id: z.string().uuid(),
            usagePath: z.string(),
            usageCount: z.literal(3119),
            usageHash: digest,
            requestHash: digest,
            sourceHash: digest,
            dispatcherId: z.string(),
            bindings: z.array(artifact),
            runDirectory: z.string(),
          })
          .passthrough(),
      })
      .strict(),
    events[0],
  );
  const second = parse(
    z
      .object({ event: z.literal('reserved'), at: stamp, recordId: z.string(), reserveUsd: z.number() })
      .strict(),
    events[1],
  );
  if (
    first.permit.usagePath !== resolve(input.usagePath) ||
    first.recordId !== second.recordId ||
    first.permit.requestHash !== recoveryHash(input.request) ||
    second.reserveUsd !== reserveUsd ||
    recoveryHash(budget.records.slice(0, 3119)) !== first.permit.usageHash
  )
    return fail('ORIGINAL_REQUEST_OR_HISTORY_CHANGED');
  const latest = budget.records[3119];
  if (
    latest.id !== first.recordId ||
    latest.episode !== `transport-recovery-probe:${first.permit.id}` ||
    latest.provider !== 'gemini' ||
    latest.kind !== 'generate' ||
    latest.model !== 'gemini-3.5-flash-lite' ||
    latest.reserveUsd !== reserveUsd ||
    latest.estimatedUsd !== null ||
    latest.status !== null ||
    latest.inputTokens !== null ||
    latest.outputTokens !== null ||
    latest.durationMs !== null
  )
    return fail('ORIGINAL_PROBE_AMBIGUOUS');
  const evidence = parse(rejectionSchema, read(input.evidencePath));
  if (
    evidence.permitId !== first.permit.id ||
    evidence.dispatcherId !== first.permit.dispatcherId ||
    evidence.ledgerSha256 !== bytesHash(input.usagePath) ||
    evidence.journalSha256 !== bytesHash(originalJournal) ||
    evidence.privateArchiveManifestSha256 !== bytesHash(input.archiveManifestPath)
  )
    return fail('REJECTION_BINDING_CHANGED');
  const archive = parse(
    z
      .object({
        schemaVersion: z.literal(1),
        dispatcherId: z.string(),
        permitId: z.string(),
        pidExited: z.literal(true),
        ledgerAndJournal: z.object({ ledgerSha256: digest, journalSha256: digest }),
        absentOutputs: z.object({
          '.launch.json': z.literal(true),
          '.done': z.literal(true),
          '.response': z.literal(true),
          '.headers': z.literal(true),
        }),
        files: z
          .array(
            z
              .object({
                name: z.string(),
                bytes: z.number().int().nonnegative(),
                sha256: digest,
                originalPath: z.string(),
                archivePath: z.string(),
              })
              .passthrough(),
          )
          .length(5),
      })
      .passthrough(),
    read(input.archiveManifestPath),
  );
  if (
    archive.permitId !== first.permit.id ||
    archive.dispatcherId !== first.permit.dispatcherId ||
    archive.ledgerAndJournal.ledgerSha256 !== evidence.ledgerSha256 ||
    archive.ledgerAndJournal.journalSha256 !== evidence.journalSha256
  )
    return fail('ARCHIVE_CHANGED');
  for (const file of archive.files)
    if (bytesHash(file.archivePath) !== file.sha256 || readFileSync(file.archivePath).length !== file.bytes)
      return fail('ARCHIVE_CHANGED');
  const files = archive.files.filter((file) => /\.(body|curl|claimed)$/.test(file.name));
  if (files.length !== 3) return fail('ARCHIVE_CHANGED');
  const queued = Object.fromEntries(files.map((f) => [f.name.split('.').at(-1)!, f]));
  if (!queued.body || !queued.curl || !queued.claimed) return fail('ARCHIVE_CHANGED');
  const stem = queued.curl.originalPath.slice(0, -5),
    archivedStem = queued.curl.archivePath.slice(0, -5);
  if (
    dirname(stem) !== join(dirname(resolve(input.usagePath)), 'queue') ||
    !/^[a-f0-9-]{36}$/.test(basename(stem))
  )
    return fail('ARCHIVE_PATH');
  const expectedHashes = {
    body: evidence.requestBodySha256,
    curl: evidence.curlConfigurationSha256,
    claimed: evidence.claimedMetadataSha256,
  };
  for (const suffix of ['body', 'curl', 'claimed'] as const) {
    const file = queued[suffix];
    if (
      file.originalPath !== `${stem}.${suffix}` ||
      file.archivePath !== `${archivedStem}.${suffix}` ||
      file.sha256 !== expectedHashes[suffix] ||
      file.sha256 !== bytesHash(file.archivePath) ||
      readFileSync(file.archivePath).length !== file.bytes ||
      existsSync(file.originalPath)
    )
      return fail('ARCHIVE_CHANGED');
  }
  for (const suffix of ['.ready', '.launch.json', '.done', '.response', '.headers'])
    if (existsSync(stem + suffix) || existsSync(archivedStem + suffix))
      return fail('NETWORK_OR_REPLAY_EVIDENCE');
  const claim = parse(
    z.object({ id: z.string().uuid(), createdAt: stamp, expiresAt: z.number().finite() }).strict(),
    read(queued.claimed.archivePath),
  );
  if (
    claim.id !== basename(stem) ||
    claim.expiresAt > Date.parse(evidence.at) ||
    claim.expiresAt - Date.parse(claim.createdAt) > 25000 ||
    claim.expiresAt <= Date.parse(claim.createdAt)
  )
    return fail('CLAIM_CHANGED');
  if (
    readFileSync(queued.body.archivePath, 'utf8') !== JSON.stringify(input.request.body) ||
    readFileSync(queued.curl.archivePath, 'utf8') !== expectedQueuedConfig(input.request, stem)
  )
    return fail('FIXED_REQUEST_CHANGED');
  const proofFiles = {
    'launcher-v1.py': evidence.launcherV1Sha256,
    'stopped-controller.json': evidence.stoppedControllerSha256,
    'pump-metrics.jsonl': evidence.metricsSha256,
    'consumed-journal.jsonl': evidence.journalSha256,
    'reserved-usage.json': evidence.ledgerSha256,
  };
  for (const [name, hash] of Object.entries(proofFiles))
    if (bytesHash(join(input.proofDirectory, name)) !== hash) return fail('PROOF_CHANGED');
  const oldLauncher = first.permit.bindings.find(
    (entry) => entry.path === join(dirname(resolve(input.usagePath)), 'launch-config.py'),
  );
  if (!oldLauncher || oldLauncher.sha256 !== evidence.launcherV1Sha256) return fail('OLD_LAUNCHER_UNBOUND');
  const legacySource = readFileSync(join(input.proofDirectory, 'launcher-v1.py'), 'utf8');
  const validationAt = legacySource.indexOf('google = validated_config(config, stem)');
  const markerAt = legacySource.indexOf("write_exclusive(stem.with_suffix('.launch.json')");
  if (
    !legacySource.includes("'\\n' not in value") ||
    !legacySource.includes("'INVALID_DIRECTIVE_VALUE'") ||
    validationAt < 0 ||
    markerAt <= validationAt ||
    !legacySource.includes('sys.stdout.write(prepare_launch(ROOT, args.run_id))')
  )
    return fail('PRELAUNCH_CONTROL_FLOW_UNPROVED');
  // The exact fixed config above has JSON-escaped write-out newline. V1's
  // string check rejects it before the exclusive launch marker/stdout call.
  const writeOut = readFileSync(queued.curl.archivePath, 'utf8')
    .split('\n')
    .find((line) => line.startsWith('write-out = '));
  if (!writeOut || !(JSON.parse(writeOut.slice(12)) as string).endsWith('\n'))
    return fail('REJECTION_NOT_REPRODUCED');
  const controller = parse(
    z
      .object({
        runId: z.string(),
        phase: z.literal('stopped'),
        requests: z.literal(1),
        googleRequests: z.literal(1),
        pending: z.null(),
        statuses: z.object({ None: z.literal(1) }).strict(),
      })
      .passthrough(),
    read(join(input.proofDirectory, 'stopped-controller.json')),
  );
  const metrics = lines(join(input.proofDirectory, 'pump-metrics.jsonl'));
  if (metrics.length !== 1 || controller.runId !== first.permit.dispatcherId)
    return fail('DISPATCH_AMBIGUOUS');
  const metric = parse(
    z
      .object({
        runId: z.string(),
        google: z.literal(true),
        completeFooter: z.literal(false),
        status: z.null(),
        durationMs: z.null(),
        exitCode: z.literal(2),
      })
      .passthrough(),
    metrics[0],
  );
  if (metric.runId !== first.permit.dispatcherId) return fail('DISPATCH_AMBIGUOUS');
  const source = sourceManifest();
  if (source.hash !== first.permit.sourceHash) return fail('FROZEN_SOURCE_CHANGED');
  for (const bound of first.permit.bindings) {
    if (bound.path === oldLauncher.path) continue; // The corrected launcher is a disclosed operational amendment.
    if (bytesHash(bound.path) !== bound.sha256) return fail('ORIGINAL_BINDING_CHANGED');
  }
  if (bytesHash(oldLauncher.path) === oldLauncher.sha256) return fail('LAUNCHER_NOT_CORRECTED');
  return {
    budget,
    first,
    evidence,
    originalJournal,
    files: [
      ...archive.files.map((f) => f.archivePath),
      ...Object.keys(proofFiles).map((name) => join(input.proofDirectory, name)),
      originalJournal,
    ],
  };
}

export async function preparePrelaunchContinuation(
  input: ProofInput & { authorization: unknown; now?: number },
): Promise<PrelaunchPermit> {
  const usagePath = resolve(input.usagePath);
  return exclusive(
    usagePath,
    async () => {
      if (existsSync(`${usagePath}.prelaunch-continuation.jsonl`)) return fail('ALREADY_CONSUMED');
      const authorization = parse(authorizationSchema, input.authorization),
        now = input.now ?? Date.now();
      timeAllowed(authorization, now);
      const proof = originalProof({ ...input, usagePath });
      if (Date.parse(authorization.confirmedAt) < Date.parse(proof.evidence.at))
        return fail('STALE_AUTHORIZATION');
      const id = randomUUID();
      const paths = [
        input.evidencePath,
        input.archiveManifestPath,
        ...proof.files,
        ...proof.first.permit.bindings.map((item) => item.path),
        'scripts/continue-unlaunched-probe.ts',
      ];
      return parse(permitSchema, {
        schemaVersion: 1,
        id,
        createdAt: new Date(now).toISOString(),
        authorization,
        usagePath,
        usageCount: 3120,
        usageHash: recoveryHash(proof.budget.records),
        requestHash: recoveryHash(input.request),
        sourceHash: sourceManifest().hash,
        protocolHash: bytesHash('docs/PLAN.md'),
        originalPermitId: proof.first.permit.id,
        originalRecordId: proof.first.recordId,
        originalJournalSha256: bytesHash(proof.originalJournal),
        rejectionEvidence: binding(input.evidencePath),
        archiveManifest: binding(input.archiveManifestPath),
        proofDirectory: resolve(input.proofDirectory),
        bindings: [...new Set(paths.map((path) => resolve(path)))].map(binding),
        dispatcherId: `prelaunch-continue-${id}`,
      });
    },
    true,
  );
}

export async function executePrelaunchContinuation(input: {
  permit: unknown;
  request: ResearchRequest;
  transport: ResearchTransport;
  now?: () => number;
  checkpoint?: (point: 'consumed' | 'reserved' | 'verified' | 'ledger-completed') => void;
}) {
  const permit = parse(permitSchema, input.permit);
  return exclusive(permit.usagePath, async () => {
    const now = input.now ?? Date.now;
    timeAllowed(permit.authorization, now());
    const journalPath = `${permit.usagePath}.prelaunch-continuation.jsonl`;
    if (existsSync(journalPath)) return fail('ALREADY_CONSUMED');
    if (recoveryHash(input.request) !== permit.requestHash) return fail('REQUEST_CHANGED');
    const directory = dirname(permit.usagePath),
      owner = dispatcher(directory, permit.dispatcherId);
    if (
      owner.phase !== 'waiting' ||
      owner.pending !== null ||
      owner.requests !== 0 ||
      owner.googleRequests !== 0 ||
      Date.parse(owner.startedAt) < Date.parse(permit.createdAt)
    )
      return fail('DISPATCHER_NOT_FRESH');
    for (const item of permit.bindings)
      if (bytesHash(item.path) !== item.sha256) return fail('BINDING_CHANGED');
    const proof = originalProof({
      usagePath: permit.usagePath,
      evidencePath: permit.rejectionEvidence.path,
      archiveManifestPath: permit.archiveManifest.path,
      proofDirectory: permit.proofDirectory,
      request: input.request,
    });
    if (
      recoveryHash(proof.budget.records) !== permit.usageHash ||
      proof.first.permit.id !== permit.originalPermitId ||
      bytesHash(`${permit.usagePath}.transport-recovery.jsonl`) !== permit.originalJournalSha256 ||
      sourceManifest().hash !== permit.sourceHash ||
      bytesHash('docs/PLAN.md') !== permit.protocolHash
    )
      return fail('HISTORY_CHANGED');
    const reserveUsd = transportProbeQuote(input.request);
    const record: UsageRecord = {
      id: randomUUID(),
      episode: `prelaunch-continuation-probe:${permit.id}`,
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
    journalLine(journalPath, { event: 'consumed', permit, recordId: record.id, at: record.at }, true);
    input.checkpoint?.('consumed');
    const records = [...proof.budget.records, record],
      reservedHash = recoveryHash(records);
    durableJson(permit.usagePath, records);
    journalLine(journalPath, {
      event: 'reserved',
      recordId: record.id,
      reserveUsd,
      at: new Date(now()).toISOString(),
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
      /* No raw transport error is persisted. */
    }
    await drainedDispatcher(directory, permit.dispatcherId, owner.startedAt);
    const usage = reportedUsage(response);
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
    const receipt = {
      schemaVersion: 1,
      reason: 'proven_prelaunch_rejection_continuation',
      outcome,
      at: new Date(now()).toISOString(),
      provider: 'gemini',
      model: record.model,
      status: record.status,
      durationMs: record.durationMs,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      reportedEstimatedUsd: usage.estimatedUsd,
      countedUsd: outcome === 'RECOVERED' ? usage.estimatedUsd : record.reserveUsd,
      originalRejectedProbeReservationUsd: reserveUsd,
      previousUsageCount: 3120,
      previousUsageHash: permit.usageHash,
      priorRecordsUnchanged: true,
      originalJournalUnchanged: true,
      studyResumed: false,
      sourceHash: permit.sourceHash,
      rejectionEvidenceSha256: permit.rejectionEvidence.sha256,
      toolSha256: bytesHash('scripts/continue-unlaunched-probe.ts'),
    };
    if (recoveryHash(new StudyBudget(permit.usagePath).records) !== reservedHash)
      return fail('HISTORY_CHANGED');
    for (const item of permit.bindings)
      if (bytesHash(item.path) !== item.sha256) return fail('BINDING_CHANGED');
    if (sourceManifest().hash !== permit.sourceHash || bytesHash('docs/PLAN.md') !== permit.protocolHash)
      return fail('FROZEN_SOURCE_CHANGED');
    if (outcome === 'RECOVERED') {
      journalLine(journalPath, { event: 'verified-success', receipt, recordId: record.id });
      input.checkpoint?.('verified');
      record.estimatedUsd = usage.estimatedUsd;
    } else journalLine(journalPath, { event: 'failed', receipt, recordId: record.id });
    durableJson(permit.usagePath, records);
    input.checkpoint?.('ledger-completed');
    journalLine(journalPath, {
      event: 'ledger-committed',
      outcome,
      recordId: record.id,
      usageHash: recoveryHash(records),
    });
    return receipt;
  });
}

async function main() {
  await import('dotenv/config');
  const [mode, ...args] = process.argv.slice(2);
  if (!['prepare', 'execute'].includes(mode) || args.length % 2) return fail('ARGUMENTS');
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![
        '--authorization',
        '--evidence',
        '--archive-manifest',
        '--proof-directory',
        '--permit',
        '--receipt',
      ].includes(args[i]) ||
      options.has(args[i])
    )
      return fail('ARGUMENTS');
    options.set(args[i], args[i + 1]);
  }
  const privateRoot = resolve('.tools/research') + '/';
  const permitPath = resolve(options.get('--permit') ?? '');
  if (!permitPath.startsWith(privateRoot)) return fail('PRIVATE_PERMIT_REQUIRED');
  const request = quotaProbeRequest(process.env.GEMINI_API_KEY ?? '');
  if (mode === 'prepare') {
    if (
      options.size !== 5 ||
      existsSync(permitPath) ||
      !['--authorization', '--evidence', '--archive-manifest', '--proof-directory', '--permit'].every(
        (name) => options.has(name),
      )
    )
      return fail('ARGUMENTS');
    for (const name of ['--authorization', '--archive-manifest', '--proof-directory'])
      if (!resolve(options.get(name) ?? '').startsWith(privateRoot)) return fail('PRIVATE_ARTIFACT_REQUIRED');
    const permit = await preparePrelaunchContinuation({
      usagePath: '.tools/research/usage.json',
      evidencePath: options.get('--evidence')!,
      archiveManifestPath: options.get('--archive-manifest')!,
      proofDirectory: options.get('--proof-directory')!,
      authorization: read(options.get('--authorization')!),
      request,
    });
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
  if (options.size !== 2 || !options.get('--receipt') || process.env.RESEARCH_TRANSPORT !== 'queue')
    return fail('ARGUMENTS');
  const permit = parse(permitSchema, read(permitPath));
  if (permit.usagePath !== resolve('.tools/research/usage.json')) return fail('USAGE_PATH_MISMATCH');
  const receiptPath = resolve(options.get('--receipt')!);
  if (existsSync(receiptPath)) return fail('RECEIPT_EXISTS');
  const receipt = await executePrelaunchContinuation({
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
        : 'RESEARCH_PRELAUNCH_CONTINUATION_FAILED';
    console.error(JSON.stringify({ error: message, studyResumed: false }));
    process.exitCode = 1;
  });
