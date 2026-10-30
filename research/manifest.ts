import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
export function sourceManifest() {
  const files: string[] = [];
  function walk(directory: string) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (item.name.startsWith('.') || item.name === '__pycache__') continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (/\.(ts|py|json|sql|txt)$/.test(item.name)) files.push(path);
    }
  }
  for (const directory of ['research', 'server', 'shared', 'scripts/research']) walk(directory);
  files.push('package.json', 'package-lock.json', 'tsconfig.json');
  const hashes = Object.fromEntries(
    files
      .sort()
      .map((path) => [
        relative(process.cwd(), path),
        createHash('sha256').update(readFileSync(path)).digest('hex'),
      ]),
  );
  return {
    hash: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
    files: hashes,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  };
}
