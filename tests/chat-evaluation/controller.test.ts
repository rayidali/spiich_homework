import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from '../../scripts/chat-evaluation/io';
import { claim, complete, initializeRun, openRun, prepare } from '../../scripts/chat-evaluation/controller';
const dirs: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'chat-controller-'));
  dirs.push(root);
  const f = join(root, 'fixture');
  mkdirSync(join(f, 'development'), { recursive: true });
  mkdirSync(join(f, 'holdout'));
  writeFileSync(
    join(f, 'ledger.json'),
    JSON.stringify({
      version: 'test',
      today: '2026-07-15',
      timezone: 'America/New_York',
      primaryOrganizationId: 'primary',
      foreignOrganizationId: 'foreign',
      accounts: [],
      organizations: [],
      entries: [],
    }),
  );
  for (const split of ['development', 'holdout'])
    writeFileSync(
      join(f, split, 'cases.json'),
      JSON.stringify({
        cases: [
          {
            id: split === 'development' ? 'D01' : 'H01',
            split,
            messages: [{ role: 'user', content: 'cash at June end' }],
            expected: { secretGold: 'NEVER_IN_PROMPT' },
          },
        ],
      }),
    );
  writeFileSync(
    join(f, 'hand-calculated-oracle.json'),
    JSON.stringify({ reference: 'ORACLE_NEVER_IN_PROMPT' }),
  );
  return initializeRun(root, 'offline-test', f, 'synthetic-key');
}
function raw() {
  return {
    candidates: [
      {
        finishReason: 'STOP',
        content: { parts: [{ functionCall: { name: 'cash_position', args: { asOf: '2026-06-30' } } }] },
      },
    ],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 0,
      totalTokenCount: 120,
    },
    modelVersion: 'gemini-3.5-flash-lite',
  };
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
describe('external curl chat controller (zero network)', () => {
  it('requires P01 before development and final freeze before reading held-out cases for inference', () => {
    const p = setup();
    expect(() => prepare(p, 'development', 'authored', 'D01')).toThrow('CHAT_SETUP_NOT_PASSED');
    expect(() => prepare(p, 'holdout', 'authored', 'H01')).toThrow('CHAT_HOLDOUT_NOT_FROZEN');
    expect(() => prepare(p, 'setup', 'authored', 'P01')).toThrow('CHAT_CASE');
  });
  it('creates a private single-use ordinary curl config without returning secrets or gold', () => {
    const p = setup(),
      a = prepare(p, 'setup', 'composable', 'P01');
    expect(() => claim(p, a.id, 'wrong')).toThrow('CHAT_KEY_BINDING');
    const c = claim(p, a.id, 'synthetic-key');
    expect(JSON.stringify(c)).not.toContain('synthetic-key');
    expect(c.command).toMatch(/^curl -fsSL --no-fail --config '/);
    expect(c.command).not.toContain('<(');
    expect(statSync(c.configPath).mode & 0o777).toBe(0o600);
    const config = readFileSync(c.configPath, 'utf8');
    expect(config).toContain('retry = 0');
    expect(config).toContain('max-redirs = 0');
    expect(config).toContain('max-filesize = 131072');
    const body = readFileSync(join(p, 'attempts', a.id, 'body.json'), 'utf8');
    expect(body).not.toContain('NEVER_IN_PROMPT');
    expect(body).not.toContain('ORACLE_NEVER_IN_PROMPT');
    expect(body).not.toContain('synthetic-key');
    expect(() => claim(p, a.id, 'synthetic-key')).toThrow('CHAT_ALREADY_CLAIMED');
  });
  it('ignores incomplete footer, settles reported usage once and permits the next development slot', () => {
    const p = setup(),
      a = prepare(p, 'setup', 'composable', 'P01');
    claim(p, a.id, 'synthetic-key');
    writeFileSync(join(p, 'attempts', a.id, 'response.json'), JSON.stringify(raw()));
    expect(() => complete(p, a.id, '200 0.10 0 CHAT_HTTP_DONE_V1', 0)).toThrow('CHAT_COMPLETION_INVALID');
    expect(openRun(p).budget.read().records[0].state).toBe('pending');
    const result = complete(p, a.id, '200 0.10 0 CHAT_HTTP_DONE_V1\n', 0);
    expect(result.outcome.status).toBe('valid_plan');
    expect(result.totals.knownUsd).toBe('0.000080000000');
    expect(() => complete(p, a.id, '200 0.10 0 CHAT_HTTP_DONE_V1\n', 0)).toThrow('CHAT_NOT_PENDING_CLAIM');
    expect(prepare(p, 'development', 'authored', 'D01').slot).toBe('development/authored/D01');
  });
  it('keeps full reservation and halts on an unknown-cost transport failure', () => {
    const p = setup(),
      a = prepare(p, 'setup', 'composable', 'P01');
    claim(p, a.id, 'synthetic-key');
    const result = complete(p, a.id, '000 0.01 6 CHAT_HTTP_DONE_V1\n', 6);
    expect(result.outcome.status).toBe('transport_error');
    expect(result.totals.unknownReservedUsd).toBe(a.reservedUsd);
    expect(result.haltReason).toBe('CHAT_USAGE_UNKNOWN');
    expect(() => prepare(p, 'setup', 'composable', 'P01')).toThrow('CHAT_BUDGET_HALTED');
  });
  it('preserves known usage on invalid tool output and rejects oversized bodies before JSON parsing', () => {
    const p = setup(),
      a = prepare(p, 'setup', 'composable', 'P01');
    claim(p, a.id, 'synthetic-key');
    const data = raw();
    data.candidates[0].content.parts[0].functionCall.name = 'run_sql';
    writeFileSync(join(p, 'attempts', a.id, 'response.json'), JSON.stringify(data));
    const result = complete(p, a.id, '200 0.10 0 CHAT_HTTP_DONE_V1\n', 0);
    expect(result.outcome.status).toBe('invalid_response');
    expect(result.totals.knownUsd).toBe('0.000080000000');
    const p2 = setup(),
      a2 = prepare(p2, 'setup', 'composable', 'P01');
    claim(p2, a2.id, 'synthetic-key');
    writeFileSync(join(p2, 'attempts', a2.id, 'response.json'), ' '.repeat(131073));
    const oversized = complete(p2, a2.id, '200 0.10 0 CHAT_HTTP_DONE_V1\n', 0);
    expect(oversized.outcome.errorCode).toBe('RESPONSE_JSON_OR_SIZE');
    expect(oversized.haltReason).toBe('CHAT_USAGE_UNKNOWN');
  });
  it('rejects modified body even when its mutable pending checksum is changed to match', () => {
    const p = setup(),
      a = prepare(p, 'setup', 'composable', 'P01'),
      dir = join(p, 'attempts', a.id);
    const body = readFileSync(join(dir, 'body.json'), 'utf8').replace('June 30', 'July 30');
    writeFileSync(join(dir, 'body.json'), body);
    const pending = JSON.parse(readFileSync(join(dir, 'pending.json'), 'utf8'));
    pending.bodyHash = hash(body);
    writeFileSync(join(dir, 'pending.json'), JSON.stringify(pending));
    expect(() => claim(p, a.id, 'synthetic-key')).toThrow('CHAT_REQUEST_BINDING');
    expect(openRun(p).budget.read().records[0].claimedAt).toBeNull();
  });
  it('refuses implicit curl defaults without changing the existing file or claiming the request', () => {
    const p = setup(),
      a = prepare(p, 'setup', 'composable', 'P01');
    const dir = join(p, 'curl-home');
    mkdirSync(dir);
    writeFileSync(join(dir, '.curlrc'), 'synthetic default');
    const old = process.env.CURL_HOME;
    process.env.CURL_HOME = dir;
    try {
      expect(() => claim(p, a.id, 'synthetic-key')).toThrow('CHAT_IMPLICIT_CURL_CONFIG');
      expect(openRun(p).budget.read().records[0].claimedAt).toBeNull();
      expect(readFileSync(join(dir, '.curlrc'), 'utf8')).toBe('synthetic default');
    } finally {
      if (old === undefined) delete process.env.CURL_HOME;
      else process.env.CURL_HOME = old;
    }
  });
  it('binds independent arithmetic reference bytes and refuses drift without modifying ledger or oracle', () => {
    const p = setup(),
      run = openRun(p),
      file = join(run.manifest.fixtureDir, 'hand-calculated-oracle.json');
    expect(run.manifest.hashes.oracle).toBe(hash(readFileSync(file)));
    const before = readFileSync(join(p, 'budget.json'));
    writeFileSync(file, '{"reference":"changed"}');
    expect(() => openRun(p)).toThrow('CHAT_FIXTURE_DRIFT');
    expect(() => prepare(p, 'setup', 'composable', 'P01')).toThrow('CHAT_FIXTURE_DRIFT');
    expect(readFileSync(join(p, 'budget.json')).equals(before)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('{"reference":"changed"}');
  });
  it('retains a private HTTP error body while exit zero still fails and reserves unknown cost', () => {
    const p = setup(),
      a = prepare(p, 'setup', 'composable', 'P01');
    const dispatched = claim(p, a.id, 'synthetic-key');
    expect(dispatched.command).toContain('curl -fsSL --no-fail --config');
    const file = join(p, 'attempts', a.id, 'response.json'),
      body = JSON.stringify({
        error: { code: 400, status: 'INVALID_ARGUMENT', message: 'PRIVATE_PROVIDER_ERROR_SENTINEL' },
      });
    writeFileSync(file, body, { mode: 0o600 });
    const result = complete(p, a.id, '400 0.10 0 CHAT_HTTP_DONE_V1\n', 0);
    expect(result.outcome).toMatchObject({
      status: 'provider_error',
      httpStatus: 400,
      curlExit: 0,
      errorCode: 'HTTP_400',
      responseHash: hash(body),
    });
    expect(result.totals.unknownReservedUsd).toBe(a.reservedUsd);
    expect(result.haltReason).toBe('CHAT_USAGE_UNKNOWN');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_ERROR_SENTINEL');
    expect(readFileSync(file, 'utf8')).toBe(body);
  });
});
