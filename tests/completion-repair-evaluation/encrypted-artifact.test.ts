import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import {
  decryptArtifact,
  encryptArtifact,
  encryptedArtifactCommand,
} from '../../scripts/completion-repair-evaluation/encrypted-artifact';
import { sha256 } from '../../scripts/completion-repair-evaluation/protocol';
const key = 'ab'.repeat(32);
const binding = { sourceCommit: 'c'.repeat(40), runId: '12345', phase: 'development' as const };
const secretResponse = '{"thoughtSignature":"synthetic-private-signature","error":"synthetic raw response"}';
const files = [
  {
    path: 'transport/attempts/0001/response.json',
    data: Buffer.from(secretResponse).toString('base64'),
    sha256: sha256(secretResponse),
  },
];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('round-trips exact private bytes while each ciphertext has a fresh nonce', () => {
  const first = encryptArtifact(files, key, binding),
    second = encryptArtifact(files, key, binding);
  expect(decryptArtifact(first, key, binding)).toEqual(files);
  expect(first.iv).not.toBe(second.iv);
  expect(JSON.stringify(first)).not.toContain('synthetic-private-signature');
  expect(JSON.stringify(first)).not.toContain(key);
});
it.each(['sourceCommit', 'runId', 'phase'] as const)(
  'authenticates %s and rejects a mismatched predecessor',
  (field) => {
    const envelope = encryptArtifact(files, key, binding);
    const wrong = {
      ...binding,
      [field]: field === 'phase' ? 'holdout' : field === 'runId' ? '12346' : 'd'.repeat(40),
    } as typeof binding;
    expect(() => decryptArtifact(envelope, key, wrong)).toThrow();
    envelope.metadata = { ...envelope.metadata, ...wrong };
    expect(() => decryptArtifact(envelope, key, wrong)).toThrow();
  },
);
it('rejects tampered ciphertext, tag and wrong key', () => {
  const envelope = encryptArtifact(files, key, binding);
  expect(() => decryptArtifact(envelope, 'cd'.repeat(32), binding)).toThrow();
  expect(() => decryptArtifact({ ...envelope, tag: '00'.repeat(16) }, key, binding)).toThrow();
  const bytes = Buffer.from(envelope.ciphertext, 'base64');
  bytes[0] ^= 1;
  expect(() =>
    decryptArtifact({ ...envelope, ciphertext: bytes.toString('base64') }, key, binding),
  ).toThrow();
});
it.each(['../outside', '/absolute', 'nested/../../outside', './relative'])(
  'rejects unsafe archived path %s before writing files',
  (path) => {
    expect(() =>
      decryptArtifact(encryptArtifact([{ ...files[0], path }], key, binding), key, binding),
    ).toThrow();
  },
);
it('preflights the bound key before spending and refuses missing or mismatched keys', () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  for (const [name, value] of Object.entries({
    GITHUB_SHA: binding.sourceCommit,
    GITHUB_RUN_ID: binding.runId,
    COMPLETENESS_PHASE: binding.phase,
    COMPLETENESS_PRIVATE_APPROVAL: JSON.stringify({ artifactKeySha256: sha256(key) }),
  }))
    vi.stubEnv(name, value);
  vi.stubEnv('COMPLETION_REPAIR_ARTIFACT_KEY', '');
  expect(() => encryptedArtifactCommand('preflight')).toThrow();
  vi.stubEnv('COMPLETION_REPAIR_ARTIFACT_KEY', 'cd'.repeat(32));
  expect(() => encryptedArtifactCommand('preflight')).toThrow();
  vi.stubEnv('COMPLETION_REPAIR_ARTIFACT_KEY', key);
  expect(() => encryptedArtifactCommand('preflight')).not.toThrow();
  const workflow = readFileSync('.github/workflows/completion-repair-evaluation.yml', 'utf8');
  expect(workflow.indexOf('encrypted-artifact.ts preflight')).toBeLessThan(workflow.indexOf('cli.ts run'));
  expect(workflow).toContain('path: .tools/completion-repair-encrypted/');
  expect(workflow).not.toContain('path: .tools/completion-repair-evaluation-output/');
});
