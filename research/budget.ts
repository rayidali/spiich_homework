import { existsSync, readFileSync, mkdirSync, openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson } from './io';
import type { ResearchRequest, ResearchResponse, ResearchTransport } from './providers/transport';
import {
  assertRecoveryAllowsNormalCall,
  probeOutcome,
  validateQuotaRecoveryPermit,
  validateRecoveryJournal,
  type QuotaRecoveryPermit,
  type RecoveryJournalEntry,
  type RecoveryReceipt,
  recoveryHash,
} from './recovery';
import {
  assertKeyCheckReservation,
  createKeyCheckPolicy,
  keyCheckPolicyMarker,
  validateKeyCheckPolicy,
  validateKeyCheckPolicyMarker,
  type KeyCheckPolicy,
  assertStudyAllowanceReservation,
  createStudyAllowancePolicy,
  studyAllowancePolicyMarker,
  validateStudyAllowancePolicy,
  validateStudyAllowancePolicyMarker,
  type StudyAllowanceOptions,
  type StudyAllowancePolicy,
} from './budget-policy';

export interface UsageRecord {
  id: string;
  episode: string;
  provider: 'gemini' | 'jev';
  kind: string;
  model: string;
  at: string;
  reserveUsd: number;
  estimatedUsd: number | null;
  status: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
}
const prices = { geminiInput: 0.25, geminiOutput: 1.5, embeddingInput: 0.15, jevInput: 0.042 };
function readState(path: string, code: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(code);
  }
}
function readUsage(path: string): UsageRecord[] {
  const records = readState(path, 'RESEARCH_BUDGET_STATE_INVALID');
  const nonnegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (
    !Array.isArray(records) ||
    records.some(
      (record) =>
        !record ||
        typeof record !== 'object' ||
        !['gemini', 'jev'].includes(record.provider) ||
        !['id', 'episode', 'kind', 'model', 'at'].every((key) => typeof record[key] === 'string') ||
        !nonnegative(record.reserveUsd) ||
        !(record.estimatedUsd === null || nonnegative(record.estimatedUsd)) ||
        !['inputTokens', 'outputTokens', 'durationMs', 'status'].every(
          (key) => record[key] === null || nonnegative(record[key]),
        ),
    )
  )
    throw new Error('RESEARCH_BUDGET_STATE_INVALID');
  return records as UsageRecord[];
}
function generationPrice(model: string) {
  return model === 'gemini-3.5-flash-lite'
    ? { input: 0.3, output: 2.5 }
    : { input: prices.geminiInput, output: prices.geminiOutput };
}
// Rates are USD/million tokens, official pricing inspected 2026-10-30.
// Paid-equivalent estimates, not a billing invoice/free-tier assumption.
export class StudyBudget {
  readonly records: UsageRecord[];
  episode = 'setup';
  constructor(
    readonly path: string,
    readonly limits = { gemini: 10, jev: 4, attempts: 10000 },
  ) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (!existsSync(path) && this.hasPolicyHistory()) throw new Error('RESEARCH_BUDGET_STATE_MISSING');
    this.records = existsSync(path) ? readUsage(path) : [];
  }
  private hasPolicyHistory() {
    return [
      '.policy.json',
      '.policy-required.json',
      '.study-policy.json',
      '.study-policy-required.json',
      '.recovery.json',
    ].some((suffix) => existsSync(`${this.path}${suffix}`));
  }
  spend(provider: 'gemini' | 'jev') {
    return this.records
      .filter((r) => r.provider === provider)
      .reduce((a, r) => a + (r.estimatedUsd ?? r.reserveUsd), 0);
  }
  wrap(transport: ResearchTransport): ResearchTransport {
    return async (request) =>
      this.withLock(async () => {
        if (request.provider === 'gemini')
          assertRecoveryAllowsNormalCall(this.recoveryJournal(), this.records);
        const reservation = this.reserve(request);
        const response = await transport(request);
        this.finish(reservation, request, response);
        return response;
      });
  }
  private recoveryJournal(): RecoveryJournalEntry[] {
    const path = `${this.path}.recovery.json`;
    return existsSync(path)
      ? validateRecoveryJournal(readState(path, 'RESEARCH_RECOVERY_STATE_INVALID'))
      : [];
  }
  /** An installed restriction applies to every caller of this shared usage ledger. */
  keyCheckPolicy(): KeyCheckPolicy | undefined {
    const policyPath = `${this.path}.policy.json`,
      markerPath = `${this.path}.policy-required.json`;
    const policyExists = existsSync(policyPath),
      markerExists = existsSync(markerPath);
    if (!policyExists && !markerExists) {
      if (this.recoveryJournal().some((entry) => entry.permit.policyHash))
        throw new Error('RESEARCH_POLICY_MISSING');
      return undefined;
    }
    if (!policyExists || !markerExists) throw new Error('RESEARCH_POLICY_INCOMPLETE');
    const policy = validateKeyCheckPolicy(readState(policyPath, 'RESEARCH_POLICY_INVALID'), this.records);
    validateKeyCheckPolicyMarker(readState(markerPath, 'RESEARCH_POLICY_INVALID'), policy);
    return policy;
  }
  /** Explicit offline installation; no automatic allowance reset and no overwrite. */
  async installKeyCheckPolicy(authorizationReference: string, now = Date.now()): Promise<KeyCheckPolicy> {
    return this.withLock(async () => {
      if (existsSync(`${dirname(this.path)}/runner.lock`)) throw new Error('RESEARCH_RECOVERY_RUNNER_ACTIVE');
      const policyPath = `${this.path}.policy.json`,
        markerPath = `${this.path}.policy-required.json`;
      if (
        existsSync(policyPath) ||
        existsSync(markerPath) ||
        this.recoveryJournal().some((entry) => entry.permit.policyHash)
      )
        throw new Error('RESEARCH_POLICY_ALREADY_INSTALLED');
      const policy = createKeyCheckPolicy(this.records, authorizationReference, now);
      // A crash between these two writes leaves an incomplete policy and fails closed.
      atomicJson(policyPath, policy);
      atomicJson(markerPath, keyCheckPolicyMarker(policy));
      return policy;
    });
  }
  studyAllowancePolicy(): StudyAllowancePolicy | undefined {
    const policyPath = `${this.path}.study-policy.json`,
      markerPath = `${this.path}.study-policy-required.json`;
    const policyExists = existsSync(policyPath),
      markerExists = existsSync(markerPath);
    if (!policyExists && !markerExists) return undefined;
    if (!policyExists || !markerExists) throw new Error('RESEARCH_STUDY_POLICY_INCOMPLETE');
    const parent = this.keyCheckPolicy();
    if (!parent) throw new Error('RESEARCH_STUDY_POLICY_PARENT_MISSING');
    const policy = validateStudyAllowancePolicy(
      readState(policyPath, 'RESEARCH_STUDY_POLICY_INVALID'),
      this.records,
      parent,
    );
    validateStudyAllowancePolicyMarker(readState(markerPath, 'RESEARCH_STUDY_POLICY_INVALID'), policy);
    return policy;
  }
  /** Explicit user-authorized transition; original policy, marker and journal stay unchanged. */
  async installStudyAllowance(
    options: StudyAllowanceOptions,
    now = Date.now(),
  ): Promise<StudyAllowancePolicy> {
    return this.withLock(async () => {
      if (existsSync(`${dirname(this.path)}/runner.lock`)) throw new Error('RESEARCH_RECOVERY_RUNNER_ACTIVE');
      const policyPath = `${this.path}.study-policy.json`,
        markerPath = `${this.path}.study-policy-required.json`;
      if (existsSync(policyPath) || existsSync(markerPath))
        throw new Error('RESEARCH_STUDY_POLICY_ALREADY_INSTALLED');
      const parent = this.keyCheckPolicy(),
        journal = this.recoveryJournal(),
        last = journal.at(-1);
      assertRecoveryAllowsNormalCall(journal, this.records);
      if (
        !parent ||
        !last ||
        last.state !== 'succeeded' ||
        last.permit.policyHash !== recoveryHash(parent) ||
        this.records.length !== parent.baselineCount + 1 ||
        this.records[parent.baselineCount]?.id !== last.recordId ||
        last.permit.authorization.reason !== 'user_configured_key_change'
      )
        throw new Error('RESEARCH_STUDY_POLICY_INVALID_TRANSITION');
      if (last.permit.authorization.keyChange?.currentFingerprint !== options.credentialFingerprint)
        throw new Error('RESEARCH_STUDY_POLICY_KEY_MISMATCH');
      const policy = createStudyAllowancePolicy(this.records, parent, options, now);
      // Both are additional artifacts. A crash after the first write fails closed.
      atomicJson(policyPath, policy);
      atomicJson(markerPath, studyAllowancePolicyMarker(policy));
      return policy;
    });
  }
  /** Explicit one-shot probe only. Does not start or resume any experiment. */
  async recoverQuota(input: {
    permit: QuotaRecoveryPermit;
    request: ResearchRequest;
    quotaEvidence: unknown;
    authorization: unknown;
    transport: ResearchTransport;
    now?: () => number;
  }): Promise<RecoveryReceipt> {
    return this.withLock(async () => {
      if (existsSync(`${dirname(this.path)}/runner.lock`)) throw new Error('RESEARCH_RECOVERY_RUNNER_ACTIVE');
      const now = input.now ?? Date.now;
      const journal = this.recoveryJournal();
      const permit = validateQuotaRecoveryPermit({
        ...input,
        records: this.records,
        limits: this.limits,
        journal,
        now: now(),
        policy: this.keyCheckPolicy(),
      });
      // Check caps before consuming the permit, but do not write a reservation yet.
      this.reserve(input.request, { probe: true, dryRun: true });
      const recordId = randomUUID();
      const entry: RecoveryJournalEntry = {
        permit,
        recordId,
        state: 'pending',
        consumedAt: new Date(now()).toISOString(),
      };
      journal.push(entry);
      // Consumed before reservation/network. A crash here permanently uses this permit.
      atomicJson(`${this.path}.recovery.json`, journal);
      const originalEpisode = this.episode;
      this.episode = `recovery-probe:${permit.id}`;
      let reservation: UsageRecord;
      try {
        reservation = this.reserve(input.request, { probe: true, id: recordId });
      } finally {
        this.episode = originalEpisode;
      }
      let response: ResearchResponse | undefined;
      try {
        response = await input.transport(input.request);
        if (
          !Number.isInteger(response.status) ||
          response.status < 100 ||
          response.status > 599 ||
          !Number.isFinite(response.elapsedMs) ||
          response.elapsedMs < 0
        ) {
          response = undefined;
          throw new Error('RESEARCH_RECOVERY_INVALID_TRANSPORT_METADATA');
        }
        this.finish(reservation, input.request, response);
      } catch {
        /* No raw error, URL, body or credential enters the receipt. */
      }
      let outcome = probeOutcome(response);
      if (outcome === 'RECOVERED' && reservation.estimatedUsd === null) outcome = 'MISSING_USAGE';
      const receipt: RecoveryReceipt = {
        schemaVersion: 1,
        provider: 'gemini',
        model: permit.model,
        at: new Date(now()).toISOString(),
        authorizationReason: permit.authorization.reason,
        outcome,
        status: reservation.status,
        durationMs: reservation.durationMs,
        inputTokens: reservation.inputTokens,
        outputTokens: reservation.outputTokens,
        estimatedUsd: reservation.estimatedUsd,
        reserveUsd: reservation.reserveUsd,
        preservedUnknownRecords: 3,
        priorReservationsUnchanged: true,
        quotaEvidenceHash: permit.quotaEvidenceHash,
      };
      // Persist measured usage before releasing the recovery latch. A crash stays blocked.
      atomicJson(this.path, this.records);
      entry.state = outcome === 'RECOVERED' && reservation.estimatedUsd !== null ? 'succeeded' : 'failed';
      entry.completedAt = receipt.at;
      entry.receipt = receipt;
      atomicJson(`${this.path}.recovery.json`, journal);
      return receipt;
    });
  }
  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    const lockPath = `${this.path}.lock`;
    // Never unlink a supposedly stale PID lock automatically. Another process may
    // have replaced it between inspection and unlink, allowing two budget writers.
    let lock: number;
    try {
      lock = openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('RESEARCH_BUDGET_IN_USE');
      throw error;
    }
    writeFileSync(lock, String(process.pid));
    let loaded = false;
    try {
      if (!existsSync(this.path) && (this.records.length > 0 || this.hasPolicyHistory()))
        throw new Error('RESEARCH_BUDGET_STATE_MISSING');
      if (existsSync(this.path)) this.records.splice(0, this.records.length, ...readUsage(this.path));
      loaded = true;
      return await action();
    } finally {
      // A corrupt/unreadable ledger must never be replaced with an older in-memory
      // snapshot from before this lock was acquired.
      if (loaded) atomicJson(this.path, this.records);
      closeSync(lock);
      unlinkSync(lockPath);
    }
  }
  private reserve(
    request: ResearchRequest,
    options: { probe?: boolean; dryRun?: boolean; id?: string } = {},
  ) {
    const inputBound = Buffer.byteLength(request.rawBody ?? JSON.stringify(request.body ?? {})) + 2048;
    if (
      request.provider === 'gemini' &&
      !['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-embedding-001', 'file-search'].includes(
        request.model,
      )
    )
      throw new Error('RESEARCH_UNPRICED_MODEL');
    const rate = generationPrice(request.model);
    const generations = this.records.filter(
      (r) =>
        r.provider === request.provider &&
        ['generate', 'critic', 'file-search-query', 'jev-systemone', 'jev-verify', 'jev-rerank'].includes(
          r.kind,
        ),
    );
    if (
      !options.probe &&
      generations.length >= 3 &&
      generations.slice(-3).every((r) => r.estimatedUsd === null)
    )
      throw new Error('RESEARCH_PROVIDER_CIRCUIT_OPEN');
    const data = request.body as
      | {
          generationConfig?: { maxOutputTokens?: number };
          generation_config?: { max_output_tokens?: number };
        }
      | undefined;
    const outputBound =
      data?.generationConfig?.maxOutputTokens ?? data?.generation_config?.max_output_tokens ?? 8000;
    const embed = request.kind === 'embed' || request.kind === 'file-index';
    const freeControl = ['file-store', 'file-poll'].includes(request.kind);
    // For managed retrieval, reserve a full 100k-token source allowance per query.
    const extraRetrieval = request.kind === 'file-search-query' ? 100000 : 0;
    const reserveUsd = freeControl
      ? 0
      : request.provider === 'jev'
        ? (inputBound * prices.jevInput) / 1e6
        : ((inputBound + extraRetrieval) * (embed ? prices.embeddingInput : rate.input) +
            (embed ? 0 : outputBound * rate.output)) /
          1e6;
    const policy = this.keyCheckPolicy(),
      studyPolicy = this.studyAllowancePolicy();
    if (studyPolicy && policy)
      assertStudyAllowanceReservation({
        policy: studyPolicy,
        parent: policy,
        records: this.records,
        request,
        reserveUsd,
      });
    else if (policy)
      assertKeyCheckReservation({
        policy,
        records: this.records,
        provider: request.provider,
        kind: request.kind,
        reserveUsd,
        isProbe: options.probe === true,
      });
    if (
      this.records.length >= this.limits.attempts ||
      this.spend(request.provider) + reserveUsd > this.limits[request.provider]
    )
      throw new Error('RESEARCH_BUDGET_EXHAUSTED');
    const record: UsageRecord = {
      id: options.id ?? randomUUID(),
      episode: this.episode,
      provider: request.provider,
      kind: request.kind,
      model: request.model,
      at: new Date().toISOString(),
      reserveUsd,
      estimatedUsd: freeControl ? 0 : null,
      status: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
    };
    if (!options.dryRun) {
      this.records.push(record);
      atomicJson(this.path, this.records);
    }
    return record;
  }
  private finish(record: UsageRecord, request: ResearchRequest, response: ResearchResponse) {
    record.status = response.status;
    record.durationMs = response.elapsedMs;
    const body = response.json as {
      usage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
        total_input_tokens?: unknown;
        total_output_tokens?: unknown;
        total_thought_tokens?: unknown;
        total_tool_use_tokens?: unknown;
      };
      usageMetadata?: {
        promptTokenCount?: unknown;
        candidatesTokenCount?: unknown;
        thoughtsTokenCount?: unknown;
      };
    } | null;
    const count = (x: unknown) => (Number.isSafeInteger(x) && Number(x) >= 0 ? Number(x) : null);
    let input = count(
      request.provider === 'jev'
        ? body?.usage?.input_tokens
        : (body?.usageMetadata?.promptTokenCount ?? body?.usage?.total_input_tokens),
    );
    if (input !== null && request.provider === 'gemini' && body?.usage?.total_input_tokens !== undefined)
      input += count(body.usage.total_tool_use_tokens) ?? 0;
    const output =
      request.provider === 'jev'
        ? count(body?.usage?.output_tokens)
        : count(body?.usageMetadata?.candidatesTokenCount ?? body?.usage?.total_output_tokens);
    const thinking =
      request.provider === 'jev'
        ? 0
        : (count(body?.usageMetadata?.thoughtsTokenCount ?? body?.usage?.total_thought_tokens) ?? 0);
    const rate = generationPrice(request.model);
    record.inputTokens = input;
    record.outputTokens = output === null ? null : output + thinking;
    if (input !== null && (output !== null || request.provider === 'jev')) {
      record.estimatedUsd =
        request.provider === 'jev'
          ? (input * prices.jevInput) / 1e6
          : (input * (request.kind === 'embed' ? prices.embeddingInput : rate.input) +
              (record.outputTokens ?? 0) * rate.output) /
            1e6;
    }
    // Unknown usage retains its reservation; failed requests are never claimed free.
  }
}
