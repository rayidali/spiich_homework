import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { sha256 } from './protocol';

const version = 'completion-repair-encrypted-artifact-v1';
const maximumBytes = 256 * 1024 * 1024;
export type ArtifactBinding = { sourceCommit: string; runId: string; phase: 'development' | 'holdout' };
type FileRecord = { path: string; data: string; sha256: string };
const fail = (): never => {
  throw Error('COMPLETENESS_ENCRYPTED_ARTIFACT_INVALID');
};
const pathValid = (path: string) =>
  /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) &&
  !path.split('/').some((part) => part === '.' || part === '..');
function keyBytes(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) fail();
  return Buffer.from(key, 'hex');
}
function metadata(binding: ArtifactBinding) {
  if (
    !/^[a-f0-9]{40}$/.test(binding.sourceCommit) ||
    !/^[1-9]\d*$/.test(binding.runId) ||
    !['development', 'holdout'].includes(binding.phase)
  )
    fail();
  return { version, sourceCommit: binding.sourceCommit, runId: binding.runId, phase: binding.phase };
}
export function encryptArtifact(files: FileRecord[], key: string, binding: ArtifactBinding) {
  const plain = Buffer.from(JSON.stringify(files));
  if (plain.length > maximumBytes) fail();
  const meta = metadata(binding),
    iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from(JSON.stringify(meta)));
  const ciphertext = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  return {
    metadata: meta,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('base64'),
  };
}
export function decryptArtifact(
  envelope: ReturnType<typeof encryptArtifact>,
  key: string,
  binding: ArtifactBinding,
): FileRecord[] {
  if (
    JSON.stringify(envelope.metadata) !== JSON.stringify(metadata(binding)) ||
    !/^[a-f0-9]{24}$/.test(envelope.iv) ||
    !/^[a-f0-9]{32}$/.test(envelope.tag) ||
    typeof envelope.ciphertext !== 'string' ||
    envelope.ciphertext.length > maximumBytes * 2
  )
    fail();
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(envelope.iv, 'hex'));
  decipher.setAAD(Buffer.from(JSON.stringify(envelope.metadata)));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
  const compressed = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  const files: FileRecord[] = JSON.parse(
    gunzipSync(compressed, { maxOutputLength: maximumBytes }).toString('utf8'),
  );
  if (!Array.isArray(files) || files.length > 10000) fail();
  const paths = new Set<string>();
  for (const file of files) {
    if (
      !file ||
      !pathValid(file.path) ||
      paths.has(file.path) ||
      typeof file.data !== 'string' ||
      sha256(Buffer.from(file.data, 'base64')) !== file.sha256
    )
      fail();
    paths.add(file.path);
  }
  return files;
}
function collect(directory: string) {
  const files: FileRecord[] = [];
  let size = 0;
  function walk(relative: string) {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) fail();
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (!pathValid(path)) fail();
      if (entry.isDirectory()) walk(path);
      else {
        if (!entry.isFile()) fail();
        const data = readFileSync(join(directory, path));
        size += data.length;
        if (size > maximumBytes || files.length >= 10000) fail();
        files.push({ path, data: data.toString('base64'), sha256: sha256(data) });
      }
    }
  }
  walk('');
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function encryptedArtifactCommand(command: string) {
  const key = process.env.COMPLETION_REPAIR_ARTIFACT_KEY ?? '';
  keyBytes(key);
  const permit = JSON.parse(process.env.COMPLETENESS_PRIVATE_APPROVAL ?? '{}');
  if (sha256(key) !== permit.artifactKeySha256) fail();
  if (command === 'preflight') {
    const binding: ArtifactBinding = {
      sourceCommit: process.env.GITHUB_SHA!,
      runId: process.env.GITHUB_RUN_ID!,
      phase: process.env.COMPLETENESS_PHASE! as ArtifactBinding['phase'],
    };
    const files = [
      {
        path: 'preflight.txt',
        data: Buffer.from('artifact-key-check').toString('base64'),
        sha256: sha256('artifact-key-check'),
      },
    ];
    if (
      JSON.stringify(decryptArtifact(encryptArtifact(files, key, binding), key, binding)) !==
      JSON.stringify(files)
    )
      fail();
    console.log(JSON.stringify({ artifactEncryptionPreflightPassed: true }));
  } else if (command === 'encrypt') {
    const source = '.tools/completion-repair-evaluation-output';
    const output = '.tools/completion-repair-encrypted';
    if (!existsSync(source)) return;
    const binding = {
      sourceCommit: process.env.GITHUB_SHA!,
      runId: process.env.GITHUB_RUN_ID!,
      phase: process.env.COMPLETENESS_PHASE! as ArtifactBinding['phase'],
    };
    const bytes = Buffer.from(JSON.stringify(encryptArtifact(collect(source), key, binding)) + '\n');
    mkdirSync(output, { recursive: true, mode: 0o700 });
    writeFileSync(join(output, 'artifact.json'), bytes, { flag: 'wx', mode: 0o600 });
    writeFileSync(
      join(output, 'receipt.json'),
      JSON.stringify({
        ...metadata(binding),
        encrypted: true,
        algorithm: 'AES-256-GCM',
        ciphertextArchiveSha256: sha256(bytes),
        archiveBytes: bytes.length,
      }) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      JSON.stringify({ encrypted: true, archiveBytes: bytes.length, archiveSha256: sha256(bytes) }),
    );
  } else if (command === 'decrypt-development') {
    const path = '.tools/completion-repair-encrypted-predecessor/artifact.json';
    if (
      !lstatSync(path).isFile() ||
      lstatSync(path).isSymbolicLink() ||
      lstatSync(path).size > maximumBytes * 2
    )
      fail();
    const files = decryptArtifact(JSON.parse(readFileSync(path, 'utf8')), key, {
      sourceCommit: process.env.GITHUB_SHA!,
      runId: process.env.COMPLETENESS_DEVELOPMENT_RUN!,
      phase: 'development',
    });
    const output = '.tools/completion-repair-evaluation-predecessor';
    mkdirSync(output, { mode: 0o700 });
    for (const file of files) {
      mkdirSync(dirname(join(output, file.path)), { recursive: true, mode: 0o700 });
      writeFileSync(join(output, file.path), Buffer.from(file.data, 'base64'), { flag: 'wx', mode: 0o600 });
    }
    console.log(JSON.stringify({ decryptedDevelopmentFiles: files.length }));
  } else fail();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    encryptedArtifactCommand(process.argv[2]);
  } catch {
    console.error('COMPLETENESS_ENCRYPTED_ARTIFACT_FAILED');
    process.exitCode = 1;
  }
}
