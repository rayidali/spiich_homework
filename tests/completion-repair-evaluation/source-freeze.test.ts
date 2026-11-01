import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  coreSource,
  evaluationSource,
  PROTOCOL,
  sha256,
  validateCoreFreeze,
} from '../../scripts/completion-repair-evaluation/protocol';
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'daybook-repair-freeze-'));
  directories.push(root);
  function write(path: string, value: string) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  for (const path of [
    'server/runtime.ts',
    'shared/types.ts',
    'db/migrations/001.sql',
    'tests/completeness-evaluation/oracle.test.ts',
    'tests/completion-repair-evaluation/source.test.ts',
    'scripts/completion-repair-evaluation/protocol.ts',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'scripts/migrate.ts',
    '.github/workflows/completeness-evaluation.yml',
    '.github/workflows/completion-repair-evaluation.yml',
    '.github/workflows/ci.yml',
    'docs/research/COMPLETENESS_EVALUATION.md',
    'docs/research/COMPLETION_REPAIR_EVALUATION.md',
  ])
    write(path, '{}');
  // Synthetic stand-ins only: this test never loads the actual held-out questions.
  const inherited: Record<string, string> = {};
  for (const file of [
    ...Array.from({ length: 24 }, (_, n) => `frozen-${n}.ts`),
    'fixtures/holdout.json',
    'fixtures/holdout-worked-totals.json',
  ]) {
    const path = `scripts/completeness-evaluation/${file}`;
    write(path, 'synthetic sealed bytes');
    inherited[path] = sha256('synthetic sealed bytes');
  }
  write(
    'scripts/completion-repair-evaluation/inherited-source.json',
    JSON.stringify({ sourceCommit: '50fecb17cc22effea85c6af67a9dc5af37cf1f7f', files: inherited }),
  );
  write(
    'scripts/completion-repair-evaluation/freeze.json',
    JSON.stringify({
      version: 'completion-repair-core-freeze-v1',
      cohort: PROTOCOL.cohort,
      coreHash: coreSource(root).hash,
      createdAt: '2026-11-01T12:00:00Z',
      inheritedUnexecutedHoldout: true,
      inheritedSourceCommit: '50fecb17cc22effea85c6af67a9dc5af37cf1f7f',
      inheritedFiles: inherited,
      sharedAiAuthorshipDisclosed: true,
    }),
  );
  return { root, write };
}
it('binds new runtime and runner while independently verifying inherited sealed bytes', () => {
  const { root } = fixture();
  expect(validateCoreFreeze(root).inheritedUnexecutedHoldout).toBe(true);
  expect(evaluationSource(root).files['scripts/completion-repair-evaluation/freeze.json']).toBeDefined();
  expect(coreSource(root).files['scripts/completion-repair-evaluation/freeze.json']).toBeUndefined();
});
it.each(['server/runtime.ts', 'scripts/completion-repair-evaluation/protocol.ts'])(
  'rejects repaired source drift in %s',
  (path) => {
    const { root, write } = fixture();
    write(path, 'changed');
    expect(() => validateCoreFreeze(root)).toThrow('CORE_CHANGED_AFTER_FREEZE');
  },
);
it('rejects inherited holdout drift even though core hashing excludes its text', () => {
  const { root, write } = fixture();
  const core = coreSource(root).hash;
  write('scripts/completeness-evaluation/fixtures/holdout.json', 'different synthetic sealed bytes');
  expect(coreSource(root).hash).toBe(core);
  expect(() => validateCoreFreeze(root)).toThrow('INHERITED_SOURCE_CHANGED');
});
it('cannot omit an inherited label hash from the freeze', () => {
  const { root, write } = fixture();
  const frozen = JSON.parse(
    readFileSync(join(root, 'scripts/completion-repair-evaluation/freeze.json'), 'utf8'),
  );
  delete frozen.inheritedFiles['scripts/completeness-evaluation/fixtures/holdout.json'];
  write('scripts/completion-repair-evaluation/freeze.json', JSON.stringify(frozen));
  expect(() => validateCoreFreeze(root)).toThrow('INHERITED_MANIFEST_MISMATCH');
});
