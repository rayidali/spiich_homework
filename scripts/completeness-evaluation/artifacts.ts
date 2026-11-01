import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256 } from './protocol';

export function jsonFile(path: string): unknown {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
    throw Error('COMPLETENESS_ARTIFACT_INVALID');
  return JSON.parse(readFileSync(path, 'utf8'));
}
/** Atomic, durable local evidence. Exclusive files are never overwritten on a retry. */
export function writeEvidence(path: string, value: unknown, exclusive = true) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = exclusive ? path : `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (!exclusive) renameSync(temporary, path);
}
export function safeErrorCode(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z_]{1,95}$/.test(error.code)
  )
    return error.code;
  if (error instanceof Error && /^(COMPLETENESS|FIXTURE)_[A-Z_]+$/.test(error.message)) return error.message;
  return 'COMPLETENESS_EXECUTION_FAILED';
}
function artifactFiles(directory: string) {
  const files: Record<string, string> = {};
  function walk(relative: string) {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error('COMPLETENESS_ARTIFACT_SYMLINK');
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (path === 'artifact-manifest.json') continue;
      if (entry.isDirectory()) walk(path);
      else {
        if (!entry.isFile()) throw Error('COMPLETENESS_ARTIFACT_INVALID');
        files[path] = sha256(readFileSync(join(directory, path)));
      }
    }
  }
  walk('');
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
export function sealArtifacts(directory: string) {
  const files = artifactFiles(directory);
  const manifest = { version: 'completeness-artifact-v1', files, sha256: sha256(JSON.stringify(files)) };
  writeEvidence(join(directory, 'artifact-manifest.json'), manifest);
  return manifest;
}
/** Corruption/stale-artifact check within GitHub's immutable artifact provenance.
 * This is not a signature against an operator replacing both files and manifest. */
export function verifyArtifacts(directory: string) {
  const actual = artifactFiles(directory);
  const manifest = jsonFile(join(directory, 'artifact-manifest.json')) as {
    version?: string;
    files?: unknown;
    sha256?: string;
  };
  if (
    manifest.version !== 'completeness-artifact-v1' ||
    JSON.stringify(manifest.files) !== JSON.stringify(actual) ||
    manifest.sha256 !== sha256(JSON.stringify(actual))
  )
    throw Error('COMPLETENESS_ARTIFACT_CHANGED');
  return manifest;
}
