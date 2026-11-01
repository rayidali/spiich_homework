import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Decimal } from '../shared/money';
import { parseProviderErrorDiagnostics } from '../server/provider-diagnostics';
import { geminiFunctionCallingConfig } from '../server/provider-schema';
import { completionReferenceInstructions } from '../server/completion-tools';
import { jsonFile, verifyArtifacts, writeEvidence } from './completeness-evaluation/artifacts';

/** Separate debugging only. The failed scientific cohort and its allowance stay closed. */
export const DIAGNOSTIC = {
  id: '20261101-v1',
  repository: 'rayidali/spiich_homework',
  workflow: 'provider-diagnostic.yml',
  model: 'gemini-3.5-flash-lite',
  slots: ['original', 'repair', 'multi'],
  authorization: 'explicit_user_requested_diagnosis_within_existing_0_90_total',
  archivedRun: '41274681768',
  archivedCommit: '50fecb17cc22effea85c6af67a9dc5af37cf1f7f',
  archivedSourceHash: '4ed3d1a060e83033dcae8c66583934f784a4c1a3aad9e62681a823cb4c765ab0',
  originalRequestSha256: '3bce98f930244f60f179d8803d4a96b4a9e8af130028e667d85ed39a0ea8bbde',
  priorChargedUsd: '0.114158',
  slotCeilingUsd: '0.05',
  approvedTotalUsd: '0.90',
  maxRequestBytes: 100000,
  maxResponseBytes: 256 * 1024,
  maxOutputTokens: 4000,
  timeoutMs: 25000,
} as const;
const inputDirectory = '.tools/provider-diagnostic-input';
const outputDirectory = '.tools/provider-diagnostic-output';
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValue(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`PROVIDER_DIAGNOSTIC_${code}`);
}
function safeCode(error: unknown) {
  return error instanceof Error && /^PROVIDER_DIAGNOSTIC_[A-Z_]+$/.test(error.message)
    ? error.message
    : 'PROVIDER_DIAGNOSTIC_FAILED';
}
function exclusiveBytes(path: string, bytes: Uint8Array) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
const cost = (input: number, output: number) =>
  new Decimal(input).times('0.30').plus(new Decimal(output).times('2.50')).div(1e6).toFixed();

export function diagnosticBinding(env: NodeJS.ProcessEnv = process.env) {
  requireValue(
    env.GITHUB_ACTIONS === 'true' &&
      env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      env.GITHUB_REPOSITORY === DIAGNOSTIC.repository &&
      env.GITHUB_REF === 'refs/heads/main' &&
      env.GITHUB_RUN_ATTEMPT === '1' &&
      env.NODE_ENV === 'test' &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') &&
      env.GITHUB_SHA === env.DIAGNOSTIC_SOURCE_COMMIT &&
      /^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') &&
      DIAGNOSTIC.slots.some((slot) => slot === env.DIAGNOSTIC_SLOT) &&
      env.USER_DIAGNOSTIC_AUTHORIZATION === DIAGNOSTIC.authorization &&
      (!env.DIAGNOSTIC_SOURCE_HASH || env.DIAGNOSTIC_SOURCE_HASH === DIAGNOSTIC.archivedSourceHash),
    'RUN_BINDING_INVALID',
  );
  requireValue(
    new Decimal(DIAGNOSTIC.priorChargedUsd)
      .plus(new Decimal(DIAGNOSTIC.slotCeilingUsd).times(DIAGNOSTIC.slots.length))
      .lte(DIAGNOSTIC.approvedTotalUsd),
    'CUMULATIVE_CAP_INVALID',
  );
  return { slot: env.DIAGNOSTIC_SLOT!, runId: env.GITHUB_RUN_ID!, sourceCommit: env.GITHUB_SHA! };
}
type Binding = ReturnType<typeof diagnosticBinding>;
export type DiagnosticWorkflowRun = {
  id: number;
  display_title: string;
  head_sha: string;
  run_attempt: number;
  event: string;
};
const title = (slot: string) => `provider-diagnostic/${DIAGNOSTIC.id}/${slot}`;
export function assertUnusedDiagnosticSlot(runs: DiagnosticWorkflowRun[], binding: Binding) {
  requireValue(
    !runs.some((run) => run.display_title === title(binding.slot) && String(run.id) !== binding.runId),
    'SLOT_ALREADY_DISPATCHED',
  );
  const current = runs.find((run) => String(run.id) === binding.runId);
  if (current)
    requireValue(
      current.display_title === title(binding.slot) &&
        current.head_sha === binding.sourceCommit &&
        current.run_attempt === 1 &&
        current.event === 'workflow_dispatch',
      'CURRENT_RUN_MISMATCH',
    );
  return Boolean(current);
}

export function prepareDiagnosticRequest(slot: string, original: Uint8Array) {
  requireValue(hash(original) === DIAGNOSTIC.originalRequestSha256, 'ORIGINAL_REQUEST_CHANGED');
  requireValue(
    DIAGNOSTIC.slots.some((name) => name === slot),
    'SLOT_TRANSFORM_NOT_IMPLEMENTED',
  );
  if (slot === 'original') return validateDiagnosticBody(original);
  const request = JSON.parse(Buffer.from(original).toString('utf8'));
  const declarations = request.tools[0].functionDeclarations as {
    name: string;
    parametersJsonSchema: Record<string, unknown>;
  }[];
  requireValue(request.toolConfig.functionCallingConfig.mode === 'ANY', 'ORIGINAL_MODE_INVALID');
  const configuration = geminiFunctionCallingConfig(
    declarations.map((tool) => ({
      name: tool.name,
      parameters: tool.parametersJsonSchema,
    })),
  );
  requireValue(configuration.mode === 'AUTO', 'REPAIR_NOT_APPLICABLE');
  // The only changed field is the tool-calling configuration. Full original
  // schemas, prompts, user message, model and generation limits stay identical.
  request.toolConfig.functionCallingConfig = configuration;
  // Third and final slot checks the same follow-up against multiple validation
  // boundaries (message citation, output binding and query schema). It is not a
  // new accuracy sample. Only the shared generic reference instructions are added.
  if (slot === 'multi') request.systemInstruction.parts[0].text += completionReferenceInstructions;
  return validateDiagnosticBody(Buffer.from(JSON.stringify(request)));
}
export function validateDiagnosticBody(original: Uint8Array) {
  const body = Buffer.from(original);
  const parsed: unknown = JSON.parse(body.toString('utf8'));
  requireValue(
    body.byteLength <= DIAGNOSTIC.maxRequestBytes &&
      object(parsed) &&
      object(parsed.generationConfig) &&
      parsed.generationConfig.maxOutputTokens === DIAGNOSTIC.maxOutputTokens,
    'REQUEST_LIMIT_INVALID',
  );
  const reservedUsd = cost(body.byteLength + 2048, DIAGNOSTIC.maxOutputTokens);
  requireValue(new Decimal(reservedUsd).lte(DIAGNOSTIC.slotCeilingUsd), 'SLOT_CAP_EXCEEDED');
  return { body, requestSha256: hash(body), reservedUsd };
}
function preservedRequest(slot: string, directory = inputDirectory) {
  const artifact = verifyArtifacts(directory);
  requireValue(typeof artifact.sha256 === 'string', 'ARCHIVE_BINDING_INVALID');
  const run = jsonFile(join(directory, 'run.json')) as Record<string, unknown>;
  const transport = jsonFile(join(directory, 'transport/manifest.json')) as Record<string, unknown>;
  requireValue(
    run.runId === DIAGNOSTIC.archivedRun &&
      run.sourceCommit === DIAGNOSTIC.archivedCommit &&
      object(run.source) &&
      run.source.hash === DIAGNOSTIC.archivedSourceHash &&
      run.phase === 'development' &&
      transport.version === 'completeness-evaluation-v1' &&
      transport.model === DIAGNOSTIC.model &&
      typeof transport.expectedKeySha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(transport.expectedKeySha256),
    'ARCHIVE_BINDING_INVALID',
  );
  const prepared = prepareDiagnosticRequest(
    slot,
    readFileSync(join(directory, 'transport/attempts/0003/request.json')),
  );
  return { ...prepared, expectedKeySha256: transport.expectedKeySha256, artifactSha256: artifact.sha256 };
}

async function authorize() {
  const binding = diagnosticBinding();
  const prepared = preservedRequest(binding.slot);
  const token = process.env.GH_TOKEN;
  requireValue(token, 'GITHUB_AUTH_MISSING');
  let complete = false,
    observed = false;
  for (let page = 1; page <= 20; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${DIAGNOSTIC.repository}/actions/workflows/${DIAGNOSTIC.workflow}/runs?event=workflow_dispatch&per_page=100&page=${page}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      },
    );
    requireValue(response.ok, 'GITHUB_HISTORY_FAILED');
    const raw = await response.text();
    requireValue(Buffer.byteLength(raw) <= 4 * 1024 * 1024, 'GITHUB_HISTORY_TOO_LARGE');
    const data: unknown = JSON.parse(raw);
    requireValue(object(data) && Array.isArray(data.workflow_runs), 'GITHUB_HISTORY_INVALID');
    const runs = data.workflow_runs as DiagnosticWorkflowRun[];
    observed = assertUnusedDiagnosticSlot(runs, binding) || observed;
    if (runs.length < 100) {
      complete = true;
      break;
    }
  }
  requireValue(complete && observed, 'GITHUB_HISTORY_INCOMPLETE');
  writeEvidence(join(outputDirectory, 'authorization.json'), {
    version: 'provider-diagnostic-authorization-v1',
    ...binding,
    diagnosticId: DIAGNOSTIC.id,
    requestSha256: prepared.requestSha256,
    artifactSha256: prepared.artifactSha256,
    userAuthorization: DIAGNOSTIC.authorization,
    recordedAt: new Date().toISOString(),
    providerCalls: 0,
  });
  console.log(JSON.stringify({ authorized: true, slot: binding.slot, providerCalls: 0 }));
}

export function diagnosticUsage(raw: unknown) {
  if (!object(raw) || raw.modelVersion !== DIAGNOSTIC.model || !object(raw.usageMetadata)) return null;
  const usage = raw.usageMetadata;
  if (
    (usage.serviceTier !== undefined && usage.serviceTier !== 'standard') ||
    (raw.serviceTier !== undefined && raw.serviceTier !== 'standard') ||
    (usage.toolUsePromptTokenCount !== undefined && usage.toolUsePromptTokenCount !== 0)
  )
    return null;
  const counts = [
    usage.promptTokenCount,
    usage.candidatesTokenCount,
    usage.thoughtsTokenCount ?? 0,
    usage.totalTokenCount,
  ];
  if (!counts.every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0))
    return null;
  const [inputTokens, outputTokens, thinkingTokens, totalTokens] = counts as number[];
  if (
    !Number.isSafeInteger(inputTokens + outputTokens + thinkingTokens) ||
    inputTokens + outputTokens + thinkingTokens !== totalTokens ||
    (usage.cachedContentTokenCount !== undefined &&
      (!Number.isSafeInteger(usage.cachedContentTokenCount) ||
        Number(usage.cachedContentTokenCount) < 0 ||
        Number(usage.cachedContentTokenCount) > inputTokens))
  )
    return null;
  return { inputTokens, outputTokens, thinkingTokens, totalTokens };
}
async function boundedResponse(response: Response, signal: AbortSignal) {
  requireValue(!signal.aborted, 'TIMEOUT');
  requireValue(response.body, 'RESPONSE_BODY_MISSING');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('PROVIDER_DIAGNOSTIC_TIMEOUT')), { once: true });
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      length += part.value.byteLength;
      requireValue(length <= DIAGNOSTIC.maxResponseBytes, 'RESPONSE_TOO_LARGE');
      parts.push(part.value);
    }
    return Buffer.concat(parts, length);
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

/** Injectable only for offline transport checks. Production CLI uses native fetch once. */
export async function captureDiagnostic(options: {
  directory: string;
  binding: Binding;
  body: Uint8Array;
  apiKey: string;
  expectedKeySha256: string;
  artifactSha256: string;
  fetcher?: typeof fetch;
}) {
  const { directory, binding, apiKey } = options;
  requireValue(
    apiKey.length > 0 &&
      apiKey.length <= 4096 &&
      !/[\r\n\0]/.test(apiKey) &&
      hash(apiKey) === options.expectedKeySha256,
    'KEY_MISMATCH',
  );
  const request = validateDiagnosticBody(options.body);
  requireValue(!request.body.includes(Buffer.from(apiKey)), 'CREDENTIAL_IN_REQUEST');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  exclusiveBytes(join(directory, 'request.json'), request.body);
  const start = new Date().toISOString();
  writeEvidence(join(directory, 'reservation.json'), {
    ...binding,
    diagnosticId: DIAGNOSTIC.id,
    state: 'pending',
    requestSha256: request.requestSha256,
    reservedUsd: request.reservedUsd,
    slotCeilingUsd: DIAGNOSTIC.slotCeilingUsd,
    priorChargedUsd: DIAGNOSTIC.priorChargedUsd,
    cumulativeWorstCaseUsd: new Decimal(DIAGNOSTIC.priorChargedUsd)
      .plus(new Decimal(DIAGNOSTIC.slotCeilingUsd).times(DIAGNOSTIC.slots.length))
      .toFixed(),
    startedAt: start,
  });
  let httpStatus: number | null = null,
    responseSha256: string | null = null,
    responseBytes: number | null = null,
    responseFile: string | null = null,
    failure: string | null = null,
    providerStatus: string | null = null;
  let raw: unknown;
  const signal = AbortSignal.timeout(DIAGNOSTIC.timeoutMs);
  try {
    const response = await (options.fetcher ?? fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${DIAGNOSTIC.model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: request.body.toString('utf8'),
        redirect: 'error',
        signal,
      },
    );
    httpStatus = response.status;
    const body = await boundedResponse(response, signal);
    responseBytes = body.byteLength;
    requireValue(!body.includes(Buffer.from(apiKey)), 'CREDENTIAL_IN_RESPONSE');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
    requireValue(raw === undefined || !JSON.stringify(raw).includes(apiKey), 'CREDENTIAL_IN_RESPONSE');
    responseFile = raw === undefined ? 'response.txt' : 'response.json';
    exclusiveBytes(join(directory, responseFile), body);
    responseSha256 = hash(body);
    providerStatus = parseProviderErrorDiagnostics(body, { httpStatus, apiKey }).providerStatus ?? null;
  } catch (error) {
    failure = signal.aborted ? 'PROVIDER_DIAGNOSTIC_TIMEOUT' : safeCode(error);
    raw = undefined;
  }
  const usage = diagnosticUsage(raw);
  if (httpStatus !== null && httpStatus !== 200 && httpStatus !== 400)
    failure ??= 'PROVIDER_DIAGNOSTIC_HTTP_ERROR';
  if (httpStatus === 200 && (!object(raw) || 'error' in raw))
    failure ??= 'PROVIDER_DIAGNOSTIC_RESPONSE_INVALID';
  if (httpStatus === 200 && !usage) failure ??= 'PROVIDER_DIAGNOSTIC_USAGE_UNKNOWN';
  const knownUsd = usage ? cost(usage.inputTokens, usage.outputTokens + usage.thinkingTokens) : null;
  const chargedUsd =
    knownUsd === null ? request.reservedUsd : Decimal.max(knownUsd, request.reservedUsd).toFixed();
  // Known usage settles to the measured estimate unless it exceeds the prior reservation.
  const settledUsd = knownUsd ?? request.reservedUsd;
  if (
    knownUsd !== null &&
    (new Decimal(knownUsd).gt(request.reservedUsd) ||
      (usage && usage.outputTokens + usage.thinkingTokens > DIAGNOSTIC.maxOutputTokens))
  )
    failure ??= 'PROVIDER_DIAGNOSTIC_RESERVATION_EXCEEDED';
  const receipt = {
    version: 'provider-diagnostic-receipt-v1',
    diagnosticId: DIAGNOSTIC.id,
    ...binding,
    model: DIAGNOSTIC.model,
    archivedRun: DIAGNOSTIC.archivedRun,
    archivedArtifactSha256: options.artifactSha256,
    originalRequestSha256: DIAGNOSTIC.originalRequestSha256,
    requestSha256: request.requestSha256,
    requestBytes: request.body.byteLength,
    httpStatus,
    providerStatus,
    requestAccepted:
      httpStatus === 200 && responseSha256 !== null && failure === null && object(raw) && !('error' in raw),
    captureComplete: responseSha256 !== null,
    responseSha256,
    responseBytes,
    responseFile,
    keyBindingMatched: true,
    providerAttempts: 1,
    retries: 0,
    usage,
    knownUsd,
    unknownReservedUsd: knownUsd === null ? request.reservedUsd : '0',
    chargedUsd: failure === 'PROVIDER_DIAGNOSTIC_RESERVATION_EXCEEDED' ? chargedUsd : settledUsd,
    reservedUsd: request.reservedUsd,
    slotCeilingUsd: DIAGNOSTIC.slotCeilingUsd,
    priorChargedUsd: DIAGNOSTIC.priorChargedUsd,
    allThreeSlotsWorstCaseTotalUsd: '0.264158',
    approvedTotalUsd: DIAGNOSTIC.approvedTotalUsd,
    state: 'closed',
    failure,
    startedAt: start,
    finishedAt: new Date().toISOString(),
    interpretation: 'Separate provider debugging. Not a resumed cohort, model score or release acceptance.',
  };
  writeEvidence(join(directory, 'receipt.json'), receipt);
  return receipt;
}

async function run() {
  const binding = diagnosticBinding();
  const prepared = preservedRequest(binding.slot);
  const authorization = jsonFile(join(outputDirectory, 'authorization.json')) as Record<string, unknown>;
  requireValue(
    authorization.version === 'provider-diagnostic-authorization-v1' &&
      authorization.slot === binding.slot &&
      authorization.runId === binding.runId &&
      authorization.sourceCommit === binding.sourceCommit &&
      authorization.diagnosticId === DIAGNOSTIC.id &&
      authorization.userAuthorization === DIAGNOSTIC.authorization &&
      authorization.requestSha256 === prepared.requestSha256 &&
      authorization.artifactSha256 === prepared.artifactSha256,
    'AUTHORIZATION_MISMATCH',
  );
  const receipt = await captureDiagnostic({
    directory: outputDirectory,
    binding,
    ...prepared,
    apiKey: process.env.GEMINI_DIAGNOSTIC_KEY?.trim() ?? '',
  });
  console.log(
    JSON.stringify({
      slot: binding.slot,
      httpStatus: receipt.httpStatus,
      providerStatus: receipt.providerStatus,
      requestAccepted: receipt.requestAccepted,
      captureComplete: receipt.captureComplete,
      providerAttempts: receipt.providerAttempts,
      responseBytes: receipt.responseBytes,
      knownUsd: receipt.knownUsd,
      unknownReservedUsd: receipt.unknownReservedUsd,
      chargedUsd: receipt.chargedUsd,
      failure: receipt.failure,
    }),
  );
  if (receipt.failure || !receipt.captureComplete) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  const action = mode === 'authorize' ? authorize : mode === 'run' ? run : null;
  if (!action) {
    console.error(JSON.stringify({ error: 'PROVIDER_DIAGNOSTIC_MODE_INVALID' }));
    process.exitCode = 1;
  } else {
    action().catch((error: unknown) => {
      const failure = safeCode(error);
      try {
        writeEvidence(join(outputDirectory, `${mode}-failure.json`), {
          failure,
          providerAttempts: existsSync(join(outputDirectory, 'reservation.json')) ? 1 : 0,
          mode,
          recordedAt: new Date().toISOString(),
        });
      } catch {
        // Existing durable reservations/receipts are never overwritten.
      }
      console.error(JSON.stringify({ error: failure }));
      process.exitCode = 1;
    });
  }
}
