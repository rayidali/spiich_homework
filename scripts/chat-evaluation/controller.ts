import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { ChatBudget, reserveEstimate, totals } from './budget';
import { exclusiveJson, hash, readJson, withLock } from './io';
import { MAX_RESPONSE_BYTES, MODEL, parsePlan, plannerRequest, reportedUsage } from './planner';
import type { ChatRoute, EvaluationCase, Fixture, Phase, RecordedOutcome } from './types';
export type RunManifest = {
  version: 'daybook-chat-evaluation-v1';
  runId: string;
  fixtureDir: string;
  hashes: { ledger: string; development: string; holdout: string; protocol: string };
  keyHash: string;
  model: typeof MODEL;
  createdAt: string;
  setup: typeof SETUP;
};
export const SETUP = [
  {
    id: 'P01',
    route: 'composable' as const,
    purpose: 'Validate the complete production function grammar before development',
    messages: [
      { role: 'user' as const, content: 'What is our cash and bank book balance as of June 30, 2026?' },
    ],
  },
];
type Pending = {
  id: string;
  slot: string;
  phase: Phase;
  route: ChatRoute;
  caseId: string;
  sourceHash: string;
  bodyHash: string;
  requestHash: string;
  url: string;
  createdAt: string;
};
export function sourceFingerprint(root = process.cwd()) {
  const paths: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const p = join(path, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith('.ts')) paths.push(p);
    }
  };
  for (const dir of ['server', 'shared', 'scripts/chat-evaluation']) walk(dir);
  paths.push('package.json', 'package-lock.json', 'tsconfig.json');
  const files = Object.fromEntries(paths.sort().map((p) => [p, hash(readFileSync(join(root, p)))]));
  return { hash: hash(JSON.stringify(files)), files };
}
export function initializeRun(root: string, runId: string, fixtureDir: string, key: string) {
  if (!/^[a-z][a-z0-9-]{1,70}$/.test(runId) || !key || /[\r\n\0]/.test(key)) throw Error('CHAT_INIT_INVALID');
  const path = resolve(root, runId);
  mkdirSync(path, { mode: 0o700 });
  const fixture = resolve(fixtureDir);
  const manifest: RunManifest = {
    version: 'daybook-chat-evaluation-v1',
    runId,
    fixtureDir: fixture,
    hashes: {
      ledger: hash(readFileSync(join(fixture, 'ledger.json'))),
      development: hash(readFileSync(join(fixture, 'development/cases.json'))),
      holdout: hash(readFileSync(join(fixture, 'holdout/cases.json'))),
      protocol: hash(readFileSync('docs/research/CHAT_QUERY_EVALUATION.md')),
    },
    keyHash: hash(key),
    model: MODEL,
    createdAt: new Date().toISOString(),
    setup: SETUP,
  };
  exclusiveJson(join(path, 'manifest.json'), manifest);
  ChatBudget.create(join(path, 'budget.json'), runId, hash(JSON.stringify(manifest)));
  return path;
}
export function openRun(path: string) {
  const manifest = readJson<RunManifest>(join(path, 'manifest.json'));
  if (manifest.version !== 'daybook-chat-evaluation-v1' || manifest.model !== MODEL)
    throw Error('CHAT_MANIFEST_INVALID');
  const files = {
    ledger: 'ledger.json',
    development: 'development/cases.json',
    holdout: 'holdout/cases.json',
  };
  for (const [kind, file] of Object.entries(files))
    if (hash(readFileSync(join(manifest.fixtureDir, file))) !== manifest.hashes[kind as keyof typeof files])
      throw Error('CHAT_FIXTURE_DRIFT');
  if (hash(readFileSync('docs/research/CHAT_QUERY_EVALUATION.md')) !== manifest.hashes.protocol)
    throw Error('CHAT_PROTOCOL_DRIFT');
  const budget = new ChatBudget(join(path, 'budget.json'), hash(JSON.stringify(manifest)));
  return { manifest, budget, fixture: readJson<Fixture>(join(manifest.fixtureDir, 'ledger.json')) };
}
export function prepare(path: string, phase: Phase, route: ChatRoute, caseId: string) {
  return withLock(join(path, 'controller.lock'), () => {
    const run = openRun(path),
      source = sourceFingerprint();
    if (route !== 'authored' && route !== 'composable') throw Error('CHAT_ROUTE');
    if (phase !== 'setup' && phase !== 'development' && phase !== 'holdout') throw Error('CHAT_PHASE');
    if (phase === 'holdout' && run.budget.read().holdoutSource !== source.hash)
      throw Error('CHAT_HOLDOUT_NOT_FROZEN');
    const cases =
      phase === 'setup'
        ? run.manifest.setup
        : readJson<{ cases: EvaluationCase[] }>(join(run.manifest.fixtureDir, phase, 'cases.json')).cases;
    const item = cases.find((c) => c.id === caseId);
    if (
      !item ||
      !new RegExp(
        phase === 'setup' ? '^P01$' : phase === 'development' ? '^D0[1-8]$' : '^H(0[1-9]|1[0-9]|20)$',
      ).test(caseId) ||
      (phase === 'setup' && route !== 'composable')
    )
      throw Error('CHAT_CASE');
    if (
      phase === 'development' &&
      !run.budget
        .read()
        .records.some(
          (r) =>
            r.slot === 'setup/composable/P01' &&
            (r.outcome as RecordedOutcome | null)?.status === 'valid_plan' &&
            r.state === 'known',
        )
    )
      throw Error('CHAT_SETUP_NOT_PASSED');
    const request = plannerRequest(route, run.fixture, item.messages),
      body = JSON.stringify(request.body);
    if (Buffer.byteLength(body) > 64 * 1024) throw Error('CHAT_REQUEST_TOO_LARGE');
    const slot = `${phase}/${route}/${caseId}`;
    const record = run.budget.reserve(slot, request.hash, source.hash, reserveEstimate(body));
    const dir = join(path, 'attempts', record.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'body.json'), body, { flag: 'wx', mode: 0o600 });
    exclusiveJson(join(dir, 'source.json'), source);
    const pending: Pending = {
      id: record.id,
      slot,
      phase,
      route,
      caseId,
      sourceHash: source.hash,
      bodyHash: hash(body),
      requestHash: request.hash,
      url: request.url,
      createdAt: record.reservedAt,
    };
    exclusiveJson(join(dir, 'pending.json'), pending);
    return { id: record.id, slot, reservedUsd: record.reservedUsd };
  });
}
function directory(path: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('CHAT_ATTEMPT_ID');
  return join(resolve(path), 'attempts', id);
}
/** This only creates a private static config. The operator must execute plain curl separately. */
export function claim(path: string, id: string, key: string) {
  return withLock(join(path, 'controller.lock'), () => {
    const run = openRun(path),
      dir = directory(path, id),
      p = readJson<Pending>(join(dir, 'pending.json'));
    if (hash(key) !== run.manifest.keyHash || /[\r\n\0]/.test(key)) throw Error('CHAT_KEY_BINDING');
    if (p.sourceHash !== sourceFingerprint().hash) throw Error('CHAT_SOURCE_DRIFT');
    const allowed = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    if (p.url !== allowed || p.id !== id || hash(readFileSync(join(dir, 'body.json'))) !== p.bodyHash)
      throw Error('CHAT_REQUEST_BINDING');
    const record = run.budget.read().records.find((r) => r.id === id);
    if (
      !record ||
      record.slot !== p.slot ||
      record.requestHash !== p.requestHash ||
      record.sourceHash !== p.sourceHash
    )
      throw Error('CHAT_REQUEST_BINDING');
    run.budget.claim(id);
    const expiresAt = new Date(Date.now() + 25_000).toISOString();
    // curl's quoted config syntax, not shell quoting. Keys cannot introduce directives.
    const q = (s: string) => JSON.stringify(s);
    const config =
      [
        `url = ${q(allowed)}`,
        'proto = "=https"',
        'request = "POST"',
        `header = ${q('content-type: application/json')}`,
        `header = ${q('x-goog-api-key: ' + key)}`,
        `data-binary = ${q('@' + join(dir, 'body.json'))}`,
        `output = ${q(join(dir, 'response.json'))}`,
        `dump-header = ${q(join(dir, 'headers.txt'))}`,
        'max-time = 25',
        'connect-timeout = 10',
        `max-filesize = ${MAX_RESPONSE_BYTES}`,
        'retry = 0',
        `write-out = ${q('%{http_code} %{time_total} %{exitcode} CHAT_HTTP_DONE_V1\n')}`,
      ].join('\n') + '\n';
    const configPath = join(dir, 'request.curl');
    writeFileSync(configPath, config, { flag: 'wx', mode: 0o600 });
    exclusiveJson(join(dir, 'claim.json'), {
      id,
      claimedAt: new Date().toISOString(),
      expiresAt,
      configHash: hash(config),
      bodyHash: p.bodyHash,
      deadlineLimitation: 'Pre-tool validation does not bound scheduler delay before actual curl starts.',
    });
    return {
      id,
      configPath,
      expiresAt,
      command: `curl -fsSL --config '${configPath.replaceAll("'", "'\\''")}'`,
    };
  });
}
export function complete(path: string, id: string, footer: string, curlExit: number) {
  return withLock(join(path, 'controller.lock'), () => {
    const run = openRun(path),
      dir = directory(path, id),
      p = readJson<Pending>(join(dir, 'pending.json'));
    const record = run.budget.read().records.find((r) => r.id === id);
    if (!record || !record.claimedAt || record.state !== 'pending') throw Error('CHAT_NOT_PENDING_CLAIM');
    // Completion is supplied only after curl has exited. Never parse a partially written footer.
    const match = /^(\d{3}) ([0-9]+(?:\.[0-9]+)?) (\d+) CHAT_HTTP_DONE_V1\n$/.exec(footer);
    if (!match || Number(match[3]) !== curlExit || !Number.isSafeInteger(curlExit))
      throw Error('CHAT_COMPLETION_INVALID');
    const status = Number(match[1]),
      networkSeconds = Number(match[2]);
    let raw: unknown,
      responseHash: string | null = null,
      invalidBody = false;
    const file = join(dir, 'response.json');
    if (existsSync(file)) {
      if (statSync(file).size > MAX_RESPONSE_BYTES) invalidBody = true;
      else {
        const body = readFileSync(file);
        responseHash = hash(body);
        try {
          raw = JSON.parse(body.toString('utf8'));
        } catch {
          invalidBody = true;
        }
      }
    }
    const usage = reportedUsage(raw);
    const outcome: RecordedOutcome = {
      attemptId: id,
      slot: p.slot,
      route: p.route,
      phase: p.phase,
      caseId: p.caseId,
      sourceHash: p.sourceHash,
      requestHash: p.requestHash,
      httpStatus: status,
      curlExit,
      networkSeconds,
      elapsedMs: Date.now() - Date.parse(record.reservedAt),
      responseHash,
      status: 'invalid_response',
      usage,
    };
    if (status !== 0 && status !== 200) {
      outcome.status = 'provider_error';
      outcome.errorCode = `HTTP_${status}`;
    } else if (curlExit !== 0 || status === 0) {
      outcome.status = 'transport_error';
      outcome.errorCode = `CURL_${curlExit}`;
    } else if (invalidBody || raw === undefined) outcome.errorCode = 'RESPONSE_JSON_OR_SIZE';
    else {
      try {
        if (sourceFingerprint().hash !== p.sourceHash) throw Error('CHAT_SOURCE_DRIFT');
        const cases =
          p.phase === 'setup'
            ? run.manifest.setup
            : readJson<{ cases: EvaluationCase[] }>(join(run.manifest.fixtureDir, p.phase, 'cases.json'))
                .cases;
        const c = cases.find((c) => c.id === p.caseId);
        if (!c) throw Error('CHAT_CASE');
        const request = plannerRequest(p.route, run.fixture, c.messages);
        if (request.hash !== p.requestHash) throw Error('CHAT_REQUEST_DRIFT');
        Object.assign(outcome, parsePlan(request, raw));
        outcome.status = 'valid_plan';
      } catch (error) {
        outcome.errorCode =
          error instanceof Error && /^[A-Z_]+$/.test(error.message)
            ? error.message
            : 'INVALID_TOOL_OR_SCHEMA';
      }
    }
    // Usage remains reserved on a transport/metadata failure, including HTTP errors with no usage.
    const haltReason = !usage
      ? 'CHAT_USAGE_UNKNOWN'
      : status === 401 || status === 403 || status === 429
        ? 'CHAT_PROVIDER_BLOCKED'
        : null;
    run.budget.finish(id, outcome, haltReason);
    exclusiveJson(join(dir, 'completion.json'), {
      footer,
      curlExit,
      completedAt: new Date().toISOString(),
      outcome,
    });
    return { outcome, totals: totals(run.budget.read()), haltReason: run.budget.read().haltReason };
  });
}
export function freezeHoldout(path: string) {
  const { budget } = openRun(path);
  const source = sourceFingerprint();
  budget.freezeHoldout(source.hash);
  exclusiveJson(join(path, 'holdout-freeze.json'), { ...source, frozenAt: new Date().toISOString() });
  return source.hash;
}
export function safeRunPath(path: string) {
  const p = resolve(path),
    base = resolve('.tools/chat-query-evaluation/runs');
  if (relative(base, p).startsWith('..') || p === base) throw Error('CHAT_RUN_PATH');
  return p;
}
