import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queuedHttp, parseQueueCompletion, QUEUE_COMPLETION_MARKER, type HttpRequest } from '../research/io';

const directories: string[] = [];
function temporary() {
  const path = mkdtempSync(join(tmpdir(), 'daybook-queue-framing-'));
  directories.push(path);
  return path;
}
function request(timeoutMs = 1000): HttpRequest {
  return {
    url: 'https://api.typesafe.ai/v1/systemone',
    method: 'POST',
    headers: {},
    body: { test: true },
    timeoutMs,
  };
}
function queued(timeoutMs = 1000) {
  const directory = temporary();
  const pending = queuedHttp(directory)(request(timeoutMs));
  const name = readdirSync(directory).find((file) => file.endsWith('.ready'))!;
  const stem = join(directory, name.slice(0, -6));
  return { directory, pending, stem };
}
const footer = (status: string, seconds: string, exit: string) =>
  `${status} ${seconds} ${exit} ${QUEUE_COMPLETION_MARKER}\n`;
afterEach(() => {
  vi.useRealTimers();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('framed curl completion parsing', () => {
  it('does not treat absent, empty, partial or legacy footers as completed', () => {
    for (const value of [
      '',
      '200',
      '200 1.181',
      '200 1.181 0',
      `200 1.181 0 ${QUEUE_COMPLETION_MARKER.slice(0, -1)}`,
      `200 1.181 0 ${QUEUE_COMPLETION_MARKER}`,
    ])
      expect(parseQueueCompletion(value)).toBeNull();
  });
  it('validates a completed footer and retains error/timeout exit codes', () => {
    expect(parseQueueCompletion(footer('200', '1.181', '0'))).toEqual({
      status: 200,
      elapsedMs: 1181,
      exitCode: 0,
    });
    expect(parseQueueCompletion(footer('000', '0', '28'))).toEqual({ status: 0, elapsedMs: 0, exitCode: 28 });
    expect(parseQueueCompletion(footer('503', '0.040', '0'))).toEqual({
      status: 503,
      elapsedMs: 40,
      exitCode: 0,
    });
    for (const value of [
      footer('999', '1', '0'),
      footer('200', 'NaN', '0'),
      footer('200', '1', '999'),
      footer('200', '999999999999999999', '0'),
    ])
      expect(() => parseQueueCompletion(value)).toThrow('RESEARCH_INVALID_HTTP_COMPLETION');
  });
});

describe('completion arrival under the original request deadline', () => {
  it('waits through an empty and then partial .done file before releasing the actual response', async () => {
    vi.useFakeTimers();
    const { pending, stem, directory } = queued();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    writeFileSync(`${stem}.done`, '');
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    writeFileSync(`${stem}.done`, '200 1.181');
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    writeFileSync(`${stem}.response`, JSON.stringify({ accepted: true }));
    writeFileSync(`${stem}.headers`, 'Content-Type: application/json\r\n');
    writeFileSync(`${stem}.done`, footer('200', '1.181', '0'));
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toMatchObject({ status: 200, elapsedMs: 1181, json: { accepted: true } });
    expect(readdirSync(directory).filter((name) => name.endsWith('.curl'))).toHaveLength(1);
    const config = readFileSync(`${stem}.curl`, 'utf8');
    const writeOut = JSON.parse(
      config
        .split('\n')
        .find((line) => line.startsWith('write-out = '))!
        .slice(12),
    );
    expect(writeOut).toContain(`%{exitcode} ${QUEUE_COMPLETION_MARKER}\n`);
  });
  it.each([
    ['7', 'RESEARCH_HTTP_FAILURE'],
    ['28', 'RESEARCH_HTTP_TIMEOUT'],
  ])('waits for a complete failed footer before classifying curl exit%s', async (exitCode, message) => {
    vi.useFakeTimers();
    const { pending, stem } = queued();
    const assertion = expect(pending).rejects.toThrow(message);
    writeFileSync(`${stem}.done`, '000 0');
    await vi.advanceTimersByTimeAsync(100);
    writeFileSync(`${stem}.done`, footer('000', '0.050', exitCode));
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
  it('returns an HTTP error status when curl itself succeeded, without retrying', async () => {
    vi.useFakeTimers();
    const { pending, stem, directory } = queued();
    writeFileSync(`${stem}.response`, '{"error":{"message":"unavailable"}}');
    writeFileSync(`${stem}.done`, footer('503', '0.100', '0'));
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toMatchObject({ status: 503, elapsedMs: 100 });
    expect(readdirSync(directory).filter((name) => name.endsWith('.curl'))).toHaveLength(1);
  });
  it.each(['', '200 0.1 0', `200 0.1 0 ${QUEUE_COMPLETION_MARKER.slice(0, -1)}`])(
    'times out a persistently partial footer without a retry: %s',
    async (partial) => {
      vi.useFakeTimers();
      const { pending, stem, directory } = queued(150);
      const assertion = expect(pending).rejects.toThrow('RESEARCH_HTTP_TIMEOUT');
      writeFileSync(`${stem}.done`, partial);
      await vi.advanceTimersByTimeAsync(150);
      await assertion;
      expect(existsSync(`${stem}.ready`)).toBe(false);
      expect(readdirSync(directory).filter((name) => name.endsWith('.curl'))).toHaveLength(1);
    },
  );
  it('does not accept a footer that arrives after the deadline', async () => {
    vi.useFakeTimers();
    const { pending, stem } = queued(200);
    const assertion = expect(pending).rejects.toThrow('RESEARCH_HTTP_TIMEOUT');
    await vi.advanceTimersByTimeAsync(200);
    writeFileSync(`${stem}.done`, footer('200', '0.05', '0'));
    await assertion;
  });
  it('rejects a fully framed malformed footer with a safe error', async () => {
    vi.useFakeTimers();
    const { pending, stem } = queued();
    const assertion = expect(pending).rejects.toThrow('RESEARCH_INVALID_HTTP_COMPLETION');
    writeFileSync(`${stem}.done`, footer('200', 'secret-private', '0'));
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
});

describe('expired dispatch preparation', () => {
  it('writes the same framed timeout and makes no network request for an expired job', () => {
    const cwd = temporary();
    const root = join(cwd, '.tools/research/queue');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'expired.ready'), JSON.stringify({ expiresAt: Date.now() - 1000 }));
    writeFileSync(join(root, 'expired.curl'), 'url = "https://api.typesafe.ai/v1/systemone"\n');
    const script = fileURLToPath(new URL('../scripts/research/prepare-queue.ts', import.meta.url));
    const output = execFileSync(
      process.execPath,
      ['--import', resolve('node_modules/tsx/dist/loader.mjs'), script],
      { cwd, encoding: 'utf8' },
    );
    expect(JSON.parse(output).queued).toBe(0);
    expect(parseQueueCompletion(readFileSync(join(root, 'expired.done'), 'utf8'))).toEqual({
      status: 0,
      elapsedMs: 0,
      exitCode: 28,
    });
    expect(existsSync(join(root, 'expired.ready'))).toBe(false);
    expect(readFileSync(join(cwd, '.tools/research/batch.curl'), 'utf8')).toBe('');
  });
});
