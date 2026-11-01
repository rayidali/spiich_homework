import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIAGNOSTIC,
  assertUnusedDiagnosticSlot,
  captureDiagnostic,
  diagnosticBinding,
  diagnosticUsage,
  validateDiagnosticBody,
} from '../scripts/provider-diagnostic';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const commit = 'a'.repeat(40);
const binding = { slot: 'original', runId: '123', sourceCommit: commit };
const syntheticKey = 'synthetic-provider-diagnostic-key';
const body = Buffer.from(JSON.stringify({ generationConfig: { maxOutputTokens: 4000 }, contents: [] }));
function env() {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY: DIAGNOSTIC.repository,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: commit,
    GITHUB_RUN_ID: '123',
    NODE_ENV: 'test',
    DIAGNOSTIC_SLOT: 'original',
    DIAGNOSTIC_SOURCE_COMMIT: commit,
    USER_DIAGNOSTIC_AUTHORIZATION: DIAGNOSTIC.authorization,
  };
}
function capture(response: Response) {
  const directory = mkdtempSync(join(tmpdir(), 'daybook-provider-diagnostic-'));
  directories.push(directory);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  return {
    directory,
    fetcher,
    run: () =>
      captureDiagnostic({
        directory,
        binding,
        body,
        apiKey: syntheticKey,
        expectedKeySha256: hash(syntheticKey),
        artifactSha256: 'b'.repeat(64),
        fetcher,
      }),
  };
}
describe('One-shot provider diagnostic, offline only', () => {
  it('requires exact reviewed main, first dispatch attempt and explicit user authorization', () => {
    expect(diagnosticBinding(env())).toEqual(binding);
    for (const patch of [
      { GITHUB_RUN_ATTEMPT: '2' },
      { GITHUB_REF: 'refs/heads/other' },
      { DIAGNOSTIC_SOURCE_COMMIT: 'b'.repeat(40) },
      { USER_DIAGNOSTIC_AUTHORIZATION: 'old study approval' },
      { DIAGNOSTIC_SLOT: 'extra' },
      { DIAGNOSTIC_SOURCE_HASH: 'c'.repeat(64) },
    ])
      expect(() => diagnosticBinding({ ...env(), ...patch })).toThrow('RUN_BINDING_INVALID');
  });
  it('refuses every earlier same-slot dispatch, including failed runs and changed source', () => {
    const current = {
      id: 123,
      display_title: 'provider-diagnostic/20261101-v1/original',
      head_sha: commit,
      run_attempt: 1,
      event: 'workflow_dispatch',
    };
    expect(assertUnusedDiagnosticSlot([current], binding)).toBe(true);
    expect(() => assertUnusedDiagnosticSlot([{ ...current, id: 122 }], binding)).toThrow(
      'ALREADY_DISPATCHED',
    );
    expect(() => assertUnusedDiagnosticSlot([{ ...current, run_attempt: 2 }], binding)).toThrow(
      'CURRENT_RUN_MISMATCH',
    );
  });
  it('bounds bytes, output tokens and the per-slot reservation before requests', () => {
    expect(Number(validateDiagnosticBody(body).reservedUsd)).toBeLessThan(0.05);
    expect(() =>
      validateDiagnosticBody(Buffer.from(JSON.stringify({ generationConfig: { maxOutputTokens: 4001 } }))),
    ).toThrow('REQUEST_LIMIT_INVALID');
    expect(() =>
      validateDiagnosticBody(
        Buffer.from(
          JSON.stringify({ generationConfig: { maxOutputTokens: 4000 }, padding: 'x'.repeat(100000) }),
        ),
      ),
    ).toThrow('REQUEST_LIMIT_INVALID');
  });
  it('retains exact HTTP 400 bytes privately and keeps unknown-use reservation without retry', async () => {
    const error = JSON.stringify({
      error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Synthetic grammar diagnostic.' },
    });
    const task = capture(new Response(error, { status: 400 }));
    const receipt = await task.run();
    expect(receipt).toMatchObject({
      httpStatus: 400,
      providerStatus: 'INVALID_ARGUMENT',
      requestAccepted: false,
      captureComplete: true,
      failure: null,
      providerAttempts: 1,
      knownUsd: null,
    });
    expect(receipt.unknownReservedUsd).toBe(receipt.reservedUsd);
    expect(readFileSync(join(task.directory, 'response.json'), 'utf8')).toBe(error);
    expect(task.fetcher).toHaveBeenCalledTimes(1);
    expect(task.fetcher.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      method: 'POST',
      body: body.toString(),
    });
    await expect(task.run()).rejects.toThrow();
    expect(task.fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses to archive credential echoes, including JSON escape encodings', async () => {
    const escaped = syntheticKey
      .split('')
      .map((character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join('');
    const task = capture(new Response(`{"error":{"message":"${escaped}"}}`, { status: 400 }));
    const receipt = await task.run();
    expect(receipt.failure).toBe('PROVIDER_DIAGNOSTIC_CREDENTIAL_IN_RESPONSE');
    expect(receipt.captureComplete).toBe(false);
    expect(existsSync(join(task.directory, 'response.json'))).toBe(false);
    expect(readFileSync(join(task.directory, 'receipt.json'), 'utf8')).not.toContain(syntheticKey);
  });
  it('retains a bounded non-JSON error and refuses an oversized body', async () => {
    const text = capture(new Response('Synthetic non-JSON rejection', { status: 400 }));
    expect((await text.run()).responseFile).toBe('response.txt');
    const large = capture(new Response('x'.repeat(DIAGNOSTIC.maxResponseBytes + 1), { status: 400 }));
    const receipt = await large.run();
    expect(receipt.failure).toBe('PROVIDER_DIAGNOSTIC_RESPONSE_TOO_LARGE');
    expect(receipt.unknownReservedUsd).toBe(receipt.reservedUsd);
    expect(existsSync(join(large.directory, 'response.txt'))).toBe(false);
  });
  it('settles exact standard-rate usage and keeps invalid usage unknown', async () => {
    const raw = {
      modelVersion: DIAGNOSTIC.model,
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 3,
        thoughtsTokenCount: 2,
        totalTokenCount: 15,
      },
      candidates: [],
    };
    const task = capture(new Response(JSON.stringify(raw), { status: 200 }));
    expect(await task.run()).toMatchObject({
      requestAccepted: true,
      knownUsd: '0.0000155',
      unknownReservedUsd: '0',
      chargedUsd: '0.0000155',
    });
    expect(diagnosticUsage({ ...raw, modelVersion: 'other' })).toBeNull();
    expect(
      diagnosticUsage({ ...raw, usageMetadata: { ...raw.usageMetadata, totalTokenCount: 16 } }),
    ).toBeNull();
  });
});
