import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Decimal } from '../../shared/money';
import { parseProviderErrorDiagnostics } from '../../server/provider-diagnostics';

const MODEL = 'gemini-3.5-flash-lite';
const RESPONSE_BYTES = 256 * 1024;
const OUTPUT_TOKENS = 4000;
let installationOwner: symbol | undefined;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
type Usage = { inputTokens: number; outputTokens: number; thinkingTokens: number; totalTokens: number };
type Trial = {
  caseId: string;
  route: 'composable' | 'adaptive' | 'complete';
  maxAttempts: number;
  state: 'active' | 'finished';
  failure: string | null;
};
type RecordEntry = {
  id: string;
  trial: string;
  reservedUsd: string;
  state: 'pending' | 'known' | 'unknown';
  costUsd: string | null;
  usage: Usage | null;
  requestSha256: string;
  responseSha256: string | null;
  httpStatus: number | null;
  failure: string | null;
  startedAt: string;
  finishedAt: string | null;
};
type Ledger = {
  version: 'completion-repair-evaluation-v1';
  manifestSha256: string;
  state: 'open' | 'closed';
  haltReason: string | null;
  trials: Record<string, Trial>;
  records: RecordEntry[];
};
export type EvaluationTransportConfig = {
  directory: string;
  model: string;
  apiKey: string;
  expectedKeySha256: string;
  ceilingUsd: string;
  maxAttempts: number;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  maxRequestBytes: number;
};
export type EvaluationTransportSummary = {
  state: 'open' | 'closed';
  attempts: number;
  knownUsd: string;
  unknownReservedUsd: string;
  chargedUsd: string;
  haltReason: string | null;
  pending: number;
  activeTrial: string | null;
};
function fail(code: string): never {
  throw new Error(`COMPLETENESS_EVALUATION_${code}`);
}
function decimal(value: string) {
  if (!/^\d+(?:\.\d{1,12})?$/.test(value)) fail('INVALID_CONFIG');
  return new Decimal(value);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function usageOf(raw: unknown, model: string): Usage | null {
  if (!object(raw) || raw.modelVersion !== model || !object(raw.usageMetadata)) return null;
  const u = raw.usageMetadata;
  if (
    (u.serviceTier !== undefined && u.serviceTier !== 'standard') ||
    (raw.serviceTier !== undefined && raw.serviceTier !== 'standard') ||
    (u.toolUsePromptTokenCount !== undefined && u.toolUsePromptTokenCount !== 0)
  )
    return null;
  const parts = [u.promptTokenCount, u.candidatesTokenCount, u.thoughtsTokenCount ?? 0, u.totalTokenCount];
  if (!parts.every((v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)) return null;
  const [inputTokens, outputTokens, thinkingTokens, totalTokens] = parts as number[];
  if (
    !Number.isSafeInteger(inputTokens + outputTokens + thinkingTokens) ||
    inputTokens + outputTokens + thinkingTokens !== totalTokens
  )
    return null;
  if (
    u.cachedContentTokenCount !== undefined &&
    (!Number.isSafeInteger(u.cachedContentTokenCount) ||
      Number(u.cachedContentTokenCount) < 0 ||
      Number(u.cachedContentTokenCount) > inputTokens)
  )
    return null;
  return { inputTokens, outputTokens, thinkingTokens, totalTokens };
}
function exclusive(path: string, bytes: string | Uint8Array) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function syncDirectory(path: string) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function bytes(path: string) {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) fail('STATE_CHANGED');
  return readFileSync(path);
}
async function boundedBody(response: Response, signal: AbortSignal) {
  const size = response.headers.get('content-length');
  if (size && /^\d+$/.test(size) && Number(size) > RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    fail('RESPONSE_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort(new Error('COMPLETENESS_EVALUATION_ABORTED'));
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      total += next.value.byteLength;
      if (total > RESPONSE_BYTES) fail('RESPONSE_TOO_LARGE');
      chunks.push(next.value);
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

/** Evaluation-only, single-process accounting. A new directory is mandatory;
 * an interrupted or closed cohort cannot be reset/resumed by this API. Local
 * trusted operator files are an audit boundary, not a hostile-user sandbox.
 * These ceilings are accounting limits, not spending authorization. The runner
 * must separately validate its approved phase permit before creating a cohort. */
export function createEvaluationTransport(
  config: EvaluationTransportConfig,
  nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis),
) {
  if (installationOwner !== undefined) fail('ALREADY_INSTALLED');
  config = Object.freeze({ ...config });
  const { apiKey, model } = config;
  if (
    model !== MODEL ||
    !apiKey ||
    apiKey.length > 4096 ||
    /[\r\n\0]/.test(apiKey) ||
    !/^[a-f0-9]{64}$/.test(config.expectedKeySha256) ||
    hash(apiKey) !== config.expectedKeySha256 ||
    !Number.isSafeInteger(config.maxAttempts) ||
    config.maxAttempts < 1 ||
    config.maxAttempts > 160 ||
    !Number.isSafeInteger(config.maxRequestBytes) ||
    config.maxRequestBytes < 1 ||
    config.maxRequestBytes > 256 * 1024 ||
    !decimal(config.ceilingUsd).gt(0) ||
    decimal(config.ceilingUsd).gt('0.62') ||
    !decimal(config.inputUsdPerMillion).eq('0.30') ||
    !decimal(config.outputUsdPerMillion).eq('2.50')
  )
    fail('INVALID_CONFIG');
  const directory = resolve(config.directory);
  const manifest = {
    version: 'completion-repair-evaluation-v1',
    model,
    expectedKeySha256: config.expectedKeySha256,
    ceilingUsd: decimal(config.ceilingUsd).toFixed(),
    maxAttempts: config.maxAttempts,
    inputUsdPerMillion: '0.30',
    outputUsdPerMillion: '2.50',
    maxRequestBytes: config.maxRequestBytes,
    maxOutputTokens: OUTPUT_TOKENS,
    maxResponseBytes: RESPONSE_BYTES,
    reservationBasis:
      'UTF-8 request bytes plus 2048 framing tokens; conservative estimate, not an invoice guarantee',
    createdAt: new Date().toISOString(),
  };
  mkdirSync(directory, { mode: 0o700 }); // Exclusive: never reopen an existing cohort.
  const manifestBytes = JSON.stringify(manifest, null, 2) + '\n';
  const manifestSha256 = hash(manifestBytes);
  exclusive(join(directory, 'manifest.json'), manifestBytes);
  mkdirSync(join(directory, 'attempts'), { mode: 0o700 });
  const ledger: Ledger = {
    version: 'completion-repair-evaluation-v1',
    manifestSha256,
    state: 'open',
    haltReason: null,
    trials: {},
    records: [],
  };
  const ledgerPath = join(directory, 'ledger.json');
  let ledgerHash = '';
  let activeTrial: string | null = null;
  let busy = false;
  let installed = false;
  const owner = Symbol('completeness-evaluation-transport');
  let sequence = 0;
  function persist(initial = false) {
    const content = JSON.stringify(ledger, null, 2) + '\n';
    try {
      if (initial) exclusive(ledgerPath, content);
      else {
        const temporary = join(directory, `ledger-${++sequence}.tmp`);
        exclusive(temporary, content);
        renameSync(temporary, ledgerPath);
      }
      syncDirectory(directory);
      ledgerHash = hash(content);
    } catch {
      ledger.haltReason = 'PERSISTENCE_FAILED';
      fail('PERSISTENCE_FAILED');
    }
  }
  persist(true);
  syncDirectory(dirname(directory));
  function checkState() {
    try {
      if (installed && globalThis.fetch !== wrappedFetch) fail('FETCH_CHANGED');
      if (
        hash(bytes(join(directory, 'manifest.json'))) !== manifestSha256 ||
        hash(bytes(ledgerPath)) !== ledgerHash
      )
        fail('STATE_CHANGED');
    } catch {
      ledger.haltReason = 'STATE_CHANGED';
      fail('STATE_CHANGED');
    }
  }
  function summary(): EvaluationTransportSummary {
    checkState();
    const known = ledger.records.reduce(
      (s, r) => s.plus(r.state === 'known' ? r.costUsd! : 0),
      new Decimal(0),
    );
    const unknown = ledger.records.reduce(
      (s, r) => s.plus(r.state === 'known' ? 0 : r.reservedUsd),
      new Decimal(0),
    );
    return {
      state: ledger.state,
      attempts: ledger.records.length,
      knownUsd: known.toFixed(),
      unknownReservedUsd: unknown.toFixed(),
      chargedUsd: known.plus(unknown).toFixed(),
      haltReason: ledger.haltReason,
      pending: ledger.records.filter((r) => r.state === 'pending').length,
      activeTrial,
    };
  }
  function halt(reason: string): never {
    ledger.haltReason ??= reason;
    persist();
    fail(reason);
  }
  function allowed() {
    checkState();
    if (ledger.state !== 'open' || ledger.haltReason) fail('HALTED');
  }
  const cost = (input: number, output: number) =>
    new Decimal(input).times('0.30').plus(new Decimal(output).times('2.50')).div(1e6).toFixed();
  const wrappedFetch: typeof fetch = async (input, init) => {
    allowed();
    if (busy) halt('CONCURRENT_REQUEST');
    if (!activeTrial) halt('NO_ACTIVE_TRIAL');
    if (ledger.trials[activeTrial].failure) fail('CELL_ALREADY_FAILED');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    let body: string;
    try {
      const headers = new Headers(init?.headers);
      if (
        (typeof input !== 'string' && !(input instanceof URL)) ||
        String(input) !== url ||
        init?.method !== 'POST' ||
        typeof init.body !== 'string' ||
        headers.get('x-goog-api-key') !== apiKey ||
        headers.get('content-type') !== 'application/json' ||
        [...headers.keys()].some((name) => !['x-goog-api-key', 'content-type'].includes(name)) ||
        !(init.signal instanceof AbortSignal) ||
        init.signal.aborted
      )
        fail('REQUEST_INVALID');
      body = init.body;
      if (Buffer.byteLength(body) > config.maxRequestBytes || body.includes(apiKey)) fail('REQUEST_INVALID');
      const parsed: unknown = JSON.parse(body);
      if (
        !object(parsed) ||
        JSON.stringify(parsed).includes(apiKey) ||
        !object(parsed.generationConfig) ||
        parsed.generationConfig.maxOutputTokens !== OUTPUT_TOKENS ||
        Object.keys(parsed.generationConfig).some(
          (key) => !['candidateCount', 'maxOutputTokens', 'thinkingConfig'].includes(key),
        ) ||
        (parsed.generationConfig.thinkingConfig !== undefined &&
          (!object(parsed.generationConfig.thinkingConfig) ||
            Object.keys(parsed.generationConfig.thinkingConfig).length !== 1 ||
            parsed.generationConfig.thinkingConfig.thinkingLevel !== 'LOW')) ||
        (parsed.generationConfig.candidateCount !== undefined &&
          parsed.generationConfig.candidateCount !== 1) ||
        Object.keys(parsed).some(
          (key) =>
            !['contents', 'systemInstruction', 'generationConfig', 'tools', 'toolConfig'].includes(key),
        ) ||
        !Array.isArray(parsed.contents) ||
        !Array.isArray(parsed.tools) ||
        parsed.tools.some(
          (tool) =>
            !object(tool) ||
            Object.keys(tool).some((key) => key !== 'functionDeclarations') ||
            !Array.isArray(tool.functionDeclarations),
        ) ||
        [...parsed.contents, ...(parsed.systemInstruction ? [parsed.systemInstruction] : [])].some(
          (content) =>
            !object(content) ||
            !Array.isArray(content.parts) ||
            content.parts.some(
              (part) => !object(part) || Object.keys(part).length !== 1 || typeof part.text !== 'string',
            ),
        )
      )
        fail('REQUEST_INVALID');
    } catch {
      halt('REQUEST_INVALID');
    }
    const trial = ledger.trials[activeTrial];
    if (ledger.records.filter((r) => r.trial === activeTrial).length >= trial.maxAttempts)
      halt('TRIAL_ATTEMPTS_EXHAUSTED');
    const reservedUsd = cost(Buffer.byteLength(body!) + 2048, OUTPUT_TOKENS);
    if (
      ledger.records.length >= config.maxAttempts ||
      new Decimal(summary().chargedUsd).plus(reservedUsd).gt(config.ceilingUsd)
    )
      halt('BUDGET_EXHAUSTED');
    const id = String(ledger.records.length + 1).padStart(4, '0');
    const attemptPath = join(directory, 'attempts', id);
    busy = true;
    const record: RecordEntry = {
      id,
      trial: activeTrial,
      reservedUsd,
      state: 'pending',
      costUsd: null,
      usage: null,
      requestSha256: hash(body!),
      responseSha256: null,
      httpStatus: null,
      failure: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    try {
      mkdirSync(attemptPath, { mode: 0o700 });
      exclusive(join(attemptPath, 'request.json'), body!);
      exclusive(join(attemptPath, 'reservation.json'), JSON.stringify(record) + '\n');
      syncDirectory(attemptPath);
      syncDirectory(join(directory, 'attempts'));
      ledger.records.push(record);
      persist(); // No network is permitted before this durable reservation.
      const signal = AbortSignal.any([init!.signal!, AbortSignal.timeout(25000)]);
      let response: Response | undefined;
      let responseBytes: Uint8Array | undefined;
      let raw: unknown;
      try {
        response = await nativeFetch(url, {
          method: 'POST',
          headers: init!.headers,
          body: body!,
          signal,
          redirect: 'error',
        });
        record.httpStatus = response.status;
        responseBytes = await boundedBody(response, signal);
        if (Buffer.from(responseBytes).includes(Buffer.from(apiKey))) {
          record.failure = 'CREDENTIAL_IN_RESPONSE';
          throw new Error('COMPLETENESS_EVALUATION_CREDENTIAL_IN_RESPONSE');
        }
        const responseText = new TextDecoder('utf-8', { fatal: true }).decode(responseBytes);
        if (responseText.includes(apiKey)) {
          raw = undefined;
          record.failure = 'CREDENTIAL_IN_RESPONSE';
        } else {
          raw = JSON.parse(responseText);
          if (JSON.stringify(raw).includes(apiKey)) {
            raw = undefined;
            record.failure = 'CREDENTIAL_IN_RESPONSE';
          } else if (object(raw) && 'error' in raw && response.status === 200) {
            record.failure = 'PROVIDER_ERROR_ENVELOPE';
          }
        }
      } catch (error) {
        record.failure ??= signal.aborted
          ? 'ABORTED'
          : error instanceof Error && error.message === 'COMPLETENESS_EVALUATION_RESPONSE_TOO_LARGE'
            ? 'RESPONSE_TOO_LARGE'
            : response
              ? 'RESPONSE_INVALID'
              : 'TRANSPORT_ERROR';
      }
      checkState();
      if (hash(bytes(join(attemptPath, 'request.json'))) !== record.requestSha256)
        halt('REQUEST_SNAPSHOT_CHANGED');
      const usage = usageOf(raw, model);
      record.usage = usage;
      record.costUsd = usage ? cost(usage.inputTokens, usage.outputTokens + usage.thinkingTokens) : null;
      record.state = usage ? 'known' : 'unknown';
      record.finishedAt = new Date().toISOString();
      // Retain every bounded response privately, including errors and malformed
      // JSON. The workflow encrypts the complete archive before uploading it.
      if (responseBytes && record.failure !== 'CREDENTIAL_IN_RESPONSE') {
        exclusive(join(attemptPath, raw === undefined ? 'response.bin' : 'response.json'), responseBytes);
        record.responseSha256 = hash(responseBytes);
      }
      if (
        usage &&
        (new Decimal(record.costUsd!).gt(reservedUsd) ||
          usage.outputTokens + usage.thinkingTokens > OUTPUT_TOKENS)
      )
        ledger.haltReason ??= 'RESERVATION_EXCEEDED';
      const diagnostic =
        responseBytes && response
          ? parseProviderErrorDiagnostics(responseBytes, { httpStatus: response.status, apiKey })
          : null;
      const globalFailure =
        !response ||
        signal.aborted ||
        ['CREDENTIAL_IN_RESPONSE', 'RESPONSE_TOO_LARGE', 'ABORTED', 'TRANSPORT_ERROR'].includes(
          record.failure ?? '',
        ) ||
        [401, 402, 403, 404, 429].includes(response.status) ||
        [
          'unauthenticated',
          'permission_denied',
          'quota_exceeded',
          'rate_limited',
          'rate_or_quota_limit',
          'model_not_found',
          'not_found',
        ].includes(diagnostic?.providerReason ?? '') ||
        diagnostic?.providerStatus === 'FAILED_PRECONDITION';
      if (globalFailure)
        ledger.haltReason ??= record.failure ?? (response ? 'PROVIDER_GLOBAL_ERROR' : 'TRANSPORT_ERROR');
      const cellFailure =
        record.failure ??
        (!usage ? 'USAGE_UNKNOWN' : response?.status !== 200 ? 'PROVIDER_HTTP_ERROR' : null);
      if (cellFailure) ledger.trials[activeTrial].failure = cellFailure;
      exclusive(join(attemptPath, 'completion.json'), JSON.stringify(record, null, 2) + '\n');
      syncDirectory(attemptPath);
      persist(); // Settle, including unknowns, before application continuation.
      if (ledger.haltReason) fail(ledger.haltReason);
      if (cellFailure) fail('CELL_PROVIDER_FAILURE');
      if (!response || (response.status === 200 && record.failure)) fail(record.failure ?? 'TRANSPORT_ERROR');
      if (response.status === 200 && responseBytes)
        return new Response(responseBytes as BodyInit, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (response.status < 200 || response.status > 599) fail('HTTP_STATUS_INVALID');
      return new Response(null, { status: response.status }); // No raw provider error body escapes accounting.
    } catch (error) {
      if (
        !ledger.haltReason &&
        !(error instanceof Error && /^COMPLETENESS_EVALUATION_CELL_/.test(error.message))
      ) {
        ledger.haltReason = 'ADAPTER_FAILED';
        persist();
      }
      // Never propagate provider errors, request bodies or file contents.
      const code =
        error instanceof Error && /^COMPLETENESS_EVALUATION_[A-Z_]+$/.test(error.message)
          ? error.message
          : 'COMPLETENESS_EVALUATION_ADAPTER_FAILED';
      throw new Error(code);
    } finally {
      busy = false;
    }
  };
  return {
    fetch: wrappedFetch,
    beginTrial(trial: Omit<Trial, 'state' | 'failure'>) {
      allowed();
      if (busy || activeTrial) fail('TRIAL_ACTIVE');
      if (
        !/^[A-Za-z0-9_-]{1,64}$/.test(trial.caseId) ||
        !['composable', 'adaptive', 'complete'].includes(trial.route) ||
        !Number.isSafeInteger(trial.maxAttempts) ||
        trial.maxAttempts < 1 ||
        trial.maxAttempts > (trial.route === 'composable' ? 2 : 3)
      )
        fail('TRIAL_INVALID');
      const key = `${trial.route}/${trial.caseId}`;
      if (Object.hasOwn(ledger.trials, key)) fail('TRIAL_REPLAY');
      ledger.trials[key] = { ...trial, state: 'active', failure: null };
      activeTrial = key;
      persist();
    },
    endTrial() {
      checkState();
      if (busy || !activeTrial) fail('TRIAL_NOT_IDLE');
      ledger.trials[activeTrial].state = 'finished';
      activeTrial = null;
      persist();
    },
    summary,
    close() {
      checkState();
      if (busy || activeTrial || installed) fail('NOT_IDLE');
      if (ledger.state === 'closed') fail('ALREADY_CLOSED');
      ledger.state = 'closed';
      persist();
      return summary();
    },
    install() {
      allowed();
      if (busy || installed || installationOwner !== undefined) fail('ALREADY_INSTALLED');
      const previous = globalThis.fetch;
      globalThis.fetch = wrappedFetch;
      installed = true;
      installationOwner = owner;
      return () => {
        if (busy || globalThis.fetch !== wrappedFetch) fail('RESTORE_NOT_IDLE');
        if (!installed || installationOwner !== owner) fail('ALREADY_RESTORED');
        globalThis.fetch = previous;
        installed = false;
        installationOwner = undefined;
      };
    },
  };
}
