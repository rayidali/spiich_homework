import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// Execute only the operator CLI, which never performs HTTP. Each test owns one
// uniquely named synthetic run; cleanup cannot remove any real study directory.
const owned: string[] = [];
const canary = 'synthetic-secret-never-sent';
const script = resolve('scripts/category-evaluation/dispatch.ts');
function fixture(queued = true) {
  const run = `test-${randomUUID()}`;
  const directory = resolve('.tools/category-evaluation', run);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  owned.push(directory);
  const id = 'development:test:gemini';
  const call = join(directory, id.replaceAll(':', '-'));
  mkdirSync(call, { mode: 0o700 });
  writeFileSync(join(call, 'auth.curl'), `header = "x-goog-api-key: ${canary}"\n`, { mode: 0o600 });
  writeFileSync(join(call, 'request.json'), JSON.stringify({ testOnly: canary }), { mode: 0o600 });
  writeFileSync(join(call, 'response.json'), '', { mode: 0o600 });
  const pending = {
    id,
    provider: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    directory: call,
    state: 'queued',
    deadline: Date.now() + 24_000,
    timeoutMs: 25_000,
    maxResponseBytes: 131_072,
  };
  const save = () => writeFileSync(join(directory, 'pending.json'), JSON.stringify(pending), { mode: 0o600 });
  if (queued) save();
  return { run, directory, call, id, pending, save };
}
function cli(command: string, run: string, ...args: string[]) {
  return cliEnvironment(command, run, args);
}
function cliEnvironment(command: string, run: string, args: string[], environment: NodeJS.ProcessEnv = {}) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, command, run, ...args], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      env: { ...process.env, ...environment },
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (data) => {
      stdout += String(data);
    });
    child.stderr.on('data', (data) => {
      stderr += String(data);
    });
    child.on('error', reject);
    child.on('close', (status) => resolveResult({ status, stdout, stderr }));
  });
}
afterEach(() => {
  for (const directory of owned.splice(0)) {
    if (!/^test-[0-9a-f-]{36}$/.test(directory.split('/').at(-1)!)) throw new Error('TEST_CLEANUP_SCOPE');
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Provider-free category dispatcher CLI', () => {
  it('refuses implicit curl defaults without claiming or displaying their contents', async () => {
    const f = fixture();
    writeFileSync(join(f.directory, '.curlrc'), `header = "X-Synthetic: ${canary}"\n`, { mode: 0o600 });
    const result = await cliEnvironment('claim', f.run, [], { CURL_HOME: f.directory });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('DISPATCH_IMPLICIT_CURL_CONFIG');
    expect(result.stdout + result.stderr).not.toContain(canary);
    expect(existsSync(join(f.call, 'claimed'))).toBe(false);
  });

  it('reports waiting/finished without creating a claim or revealing private queue content', async () => {
    const f = fixture(false);
    const waiting = await cli('claim', f.run);
    expect(waiting.status).toBe(0);
    expect(JSON.parse(waiting.stdout)).toEqual({ state: 'waiting' });
    writeFileSync(join(f.directory, 'finished.json'), '{}', { mode: 0o600 });
    expect(JSON.parse((await cli('claim', f.run)).stdout)).toEqual({ state: 'finished' });
    expect(existsSync(join(f.call, 'claimed'))).toBe(false);
    expect(waiting.stdout + waiting.stderr).not.toContain(canary);
  });

  it('permits exactly one of two concurrent claims', async () => {
    const f = fixture();
    const results = await Promise.all([cli('claim', f.run), cli('claim', f.run)]);
    const claims = results.filter((r) => r.status === 0 && JSON.parse(r.stdout).state === 'claimed');
    expect(claims).toHaveLength(1);
    const claim = JSON.parse(claims[0].stdout);
    expect(claim).toMatchObject({ id: f.id, provider: 'gemini', directory: f.call, url: f.pending.url });
    expect(claim.maxSeconds).toBeGreaterThanOrEqual(3);
    expect(claim.maxSeconds).toBeLessThanOrEqual(20);
    expect(existsSync(join(f.call, 'claimed'))).toBe(true);
    expect(JSON.parse(readFileSync(join(f.directory, 'pending.json'), 'utf8')).state).toBe('dispatched');
    for (const result of results) expect(result.stdout + result.stderr).not.toContain(canary);
    const again = await cli('claim', f.run);
    expect(JSON.parse(again.stdout).state).toBe('dispatched');
  });

  it.each([-1000, 1500])(
    'refuses expired/insufficient remaining deadline %sms before claiming',
    async (remainingMs) => {
      const f = fixture();
      f.pending.deadline = Date.now() + remainingMs;
      f.save();
      const result = await cli('claim', f.run);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('DISPATCH_STALE_OR_INVALID');
      expect(existsSync(join(f.call, 'claimed'))).toBe(false);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toContain(canary);
    },
  );

  it.each([
    'https://example.com/v1/generate',
    'http://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-other:generateContent',
  ])('rejects an unapproved destination before claiming: %s', async (url) => {
    const f = fixture();
    f.pending.url = url;
    f.save();
    const result = await cli('claim', f.run);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('DISPATCH_TARGET');
    expect(existsSync(join(f.call, 'claimed'))).toBe(false);
  });

  it('rejects a queue directory outside its own run and altered request bounds', async () => {
    const f = fixture(),
      other = fixture();
    f.pending.directory = other.call;
    f.save();
    expect((await cli('claim', f.run)).stderr).toContain('DISPATCH_STALE_OR_INVALID');
    expect(existsSync(join(other.call, 'claimed'))).toBe(false);
    f.pending.directory = f.call;
    f.pending.timeoutMs = 25001;
    f.save();
    expect((await cli('claim', f.run)).stderr).toContain('DISPATCH_STALE_OR_INVALID');
    f.pending.timeoutMs = 25000;
    f.pending.maxResponseBytes++;
    f.save();
    expect((await cli('claim', f.run)).stderr).toContain('DISPATCH_STALE_OR_INVALID');
    expect(existsSync(join(f.call, 'claimed'))).toBe(false);
  });

  it('permits exactly one concurrent completion and preserves its original response', async () => {
    const f = fixture();
    expect((await cli('claim', f.run)).status).toBe(0);
    const response = JSON.stringify({ syntheticResponse: true });
    writeFileSync(join(f.call, 'response.json'), response);
    const results = await Promise.all([
      cli('complete', f.run, f.id, '0', '200', '0.123'),
      cli('complete', f.run, f.id, '0', '200', '0.123'),
    ]);
    expect(results.filter((r) => r.status === 0)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 0)).toHaveLength(1);
    const file = join(f.call, 'completion.json');
    const original = readFileSync(file, 'utf8');
    expect(JSON.parse(original)).toEqual({ dispatched: true, exitCode: 0, httpStatus: 200, networkMs: 123 });
    expect(readFileSync(join(f.call, 'response.json'), 'utf8')).toBe(response);
    expect((await cli('complete', f.run, f.id, '6', '0', '0')).status).not.toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('refuses completion before a claim or with invalid transport measurements', async () => {
    const f = fixture();
    expect((await cli('complete', f.run, f.id, '0', '200', '0.1')).stderr).toContain(
      'DISPATCH_NOT_CLAIMED_OR_USED',
    );
    expect((await cli('claim', f.run)).status).toBe(0);
    for (const values of [
      ['256', '200', '0.1'],
      ['0', '600', '0.1'],
      ['0', '200', '-1'],
    ]) {
      expect((await cli('complete', f.run, f.id, ...values)).stderr).toContain('DISPATCH_RESULT');
      expect(existsSync(join(f.call, 'completion-claimed'))).toBe(false);
    }
    expect(existsSync(join(f.call, 'completion.json'))).toBe(false);
  });

  it('fails closed after a completion claim is consumed but publication is interrupted', async () => {
    const f = fixture();
    expect((await cli('claim', f.run)).status).toBe(0);
    writeFileSync(join(f.call, 'completion-claimed'), '', { flag: 'wx', mode: 0o600 });
    const retry = await cli('complete', f.run, f.id, '0', '200', '0.1');
    expect(retry.status).not.toBe(0);
    expect(existsSync(join(f.call, 'completion.json'))).toBe(false);
    expect(existsSync(join(f.call, 'completion-claimed'))).toBe(true);
  });
});
