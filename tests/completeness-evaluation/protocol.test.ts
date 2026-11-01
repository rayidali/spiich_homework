import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attemptsForRoute,
  coreSource,
  evaluationSource,
  pairedSchedule,
  PROTOCOL,
  sha256,
  validateCoreFreeze,
  validateDevelopmentSummary,
  validatePermit,
  validateRunEnvironment,
} from '../../scripts/completeness-evaluation/protocol';
import { loadCases } from '../../scripts/completeness-evaluation/fixtures';

const hash = 'a'.repeat(64),
  commit = 'b'.repeat(40),
  freezeHash = 'c'.repeat(64);
const now = Date.parse('2026-11-01T12:00:00Z');
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function runEnv(phase = 'development'): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY: PROTOCOL.repository,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ATTEMPT: '1',
    NODE_ENV: 'test',
    GITHUB_RUN_ID: '1234',
    GITHUB_SHA: commit,
    COMPLETENESS_PHASE: phase,
    COMPLETENESS_COHORT: PROTOCOL.cohort,
    COMPLETENESS_SOURCE_COMMIT: commit,
    COMPLETENESS_SOURCE_HASH: hash,
    COMPLETENESS_APPROVAL_SHA256: hash,
  };
}
function permit() {
  return {
    version: 'completeness-private-approval-v1',
    cohort: PROTOCOL.cohort,
    sourceCommit: commit,
    sourceHash: hash,
    freezeSha256: freezeHash,
    keySha256: 'd'.repeat(64),
    nonce: 'e'.repeat(32),
    approvedAt: '2026-11-01T11:00:00Z',
    expiresAt: '2026-11-02T12:00:00Z',
    ceilings: { development: '0.20', holdout: '0.70', total: '0.90' },
    attempts: { development: 32, holdout: 128, total: 160 },
    authorization: 'explicit_user_approval_recorded_by_operator',
  };
}
function checkPermit(value: unknown, time = now, overrides = {}) {
  const raw = JSON.stringify(value);
  return validatePermit(
    raw,
    {
      approvalSha256: sha256(raw),
      sourceCommit: commit,
      sourceHash: hash,
      freezeSha256: freezeHash,
      ...overrides,
    },
    time,
  );
}
function summary() {
  return {
    version: PROTOCOL.version,
    cohort: PROTOCOL.cohort,
    phase: 'development',
    runId: '1234',
    sourceCommit: commit,
    sourceHash: hash,
    finalSourceHash: hash,
    approvalSha256: hash,
    complete: true,
    failure: null,
    plannedExecutions: 12,
    completedExecutions: 12,
    initialFingerprint: { sha256: hash },
    finalFingerprint: { sha256: hash },
    budget: {
      state: 'closed',
      attempts: 12,
      knownUsd: '0.04',
      unknownReservedUsd: '0',
      chargedUsd: '0.04',
      haltReason: null,
      pending: 0,
      activeTrial: null,
    },
  };
}
const expected = { runId: '1234', sourceCommit: commit, sourceHash: hash, approvalSha256: hash };
function sourceTree() {
  const root = mkdtempSync(join(tmpdir(), 'completeness-protocol-'));
  directories.push(root);
  const write = (path: string, data: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), data);
  };
  for (const path of [
    'server/a.ts',
    'shared/a.ts',
    'db/migrations/a.sql',
    'scripts/completeness-evaluation/a.ts',
    'tests/completeness-evaluation/a.ts',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'scripts/migrate.ts',
    '.github/workflows/completeness-evaluation.yml',
    '.github/workflows/ci.yml',
    'docs/research/COMPLETENESS_EVALUATION.md',
  ])
    write(path, 'synthetic test source');
  return { root, write };
}
describe('Frozen protocol and explicit new authorization', () => {
  it('schedules every development question across all three routes without changing inputs', () => {
    const cases = loadCases('development'),
      prior = JSON.stringify(cases),
      schedule = pairedSchedule(cases, 'development');
    expect(schedule).toHaveLength(12);
    for (const item of cases)
      expect(
        schedule
          .filter((row) => row.item.id === item.id)
          .map((row) => row.route)
          .sort(),
      ).toEqual([...PROTOCOL.routes].sort());
    expect(JSON.stringify(cases)).toBe(prior);
    expect(schedule.reduce((total, row) => total + attemptsForRoute(row.route), 0)).toBe(32);
    expect(pairedSchedule([...cases].reverse(), 'development')).toEqual(schedule);
  });
  it('rejects duplicate, missing, mismatched split or family cases', () => {
    const cases = loadCases('development');
    expect(() => pairedSchedule(cases.slice(1), 'development')).toThrow();
    expect(() => pairedSchedule([cases[0], cases[0], ...cases.slice(2)], 'development')).toThrow();
    expect(() =>
      pairedSchedule(
        cases.map((item) => ({ ...item, family: 'common' })),
        'development',
      ),
    ).toThrow();
    expect(() =>
      pairedSchedule(
        cases.map((item) => ({ ...item, split: 'holdout' })),
        'development',
      ),
    ).toThrow();
  });
  it('accepts exact manual CI and requires a distinct development predecessor for holdout', () => {
    expect(validateRunEnvironment(runEnv()).phase).toBe('development');
    expect(() => validateRunEnvironment(runEnv('holdout'))).toThrow('DEVELOPMENT_RUN_REQUIRED');
    expect(validateRunEnvironment({ ...runEnv('holdout'), COMPLETENESS_DEVELOPMENT_RUN: '1233' }).phase).toBe(
      'holdout',
    );
    expect(() =>
      validateRunEnvironment({ ...runEnv('holdout'), COMPLETENESS_DEVELOPMENT_RUN: '1234' }),
    ).toThrow();
    expect(() => validateRunEnvironment({ ...runEnv(), COMPLETENESS_DEVELOPMENT_RUN: '1233' })).toThrow();
  });
  it.each([
    ['GITHUB_ACTIONS', 'false'],
    ['GITHUB_EVENT_NAME', 'push'],
    ['GITHUB_REPOSITORY', 'another/repo'],
    ['GITHUB_REF', 'refs/heads/feature'],
    ['GITHUB_RUN_ATTEMPT', '2'],
    ['NODE_ENV', 'production'],
    ['GITHUB_RUN_ID', '0'],
    ['GITHUB_SHA', 'bad'],
    ['COMPLETENESS_SOURCE_COMMIT', 'd'.repeat(40)],
    ['COMPLETENESS_SOURCE_HASH', 'bad'],
    ['COMPLETENESS_APPROVAL_SHA256', 'bad'],
    ['COMPLETENESS_COHORT', 'adaptive-loop-20261031-v1'],
    ['COMPLETENESS_PHASE', 'rerun'],
  ])('rejects invalid run binding %s', (field, value) => {
    expect(() => validateRunEnvironment({ ...runEnv(), [field]: value })).toThrow();
  });
  it('requires separately hashed, exact-source, time-limited synthetic approval', () => {
    expect(checkPermit(permit()).ceilings.total).toBe('0.90');
    expect(() =>
      validatePermit(
        undefined,
        { approvalSha256: hash, sourceCommit: commit, sourceHash: hash, freezeSha256: freezeHash },
        now,
      ),
    ).toThrow('APPROVAL_MISSING');
    expect(() => checkPermit(permit(), now, { approvalSha256: hash })).toThrow('HASH_MISMATCH');
    expect(() => checkPermit(permit(), now, { sourceHash: freezeHash })).toThrow('SOURCE_MISMATCH');
    expect(() => checkPermit(permit(), now, { freezeSha256: hash })).toThrow('SOURCE_MISMATCH');
    expect(() => checkPermit(permit(), Date.parse('2026-11-01T10:00:00Z'))).toThrow('TIME_INVALID');
    expect(() => checkPermit(permit(), Date.parse(permit().expiresAt))).toThrow('TIME_INVALID');
  });
  it('rejects transferred allowances, open-ended permits and extra fields', () => {
    expect(() =>
      checkPermit({ ...permit(), ceilings: { development: '0.10', holdout: '0.80', total: '0.90' } }),
    ).toThrow();
    expect(() =>
      checkPermit({ ...permit(), attempts: { development: 32, holdout: 129, total: 161 } }),
    ).toThrow();
    expect(() => checkPermit({ ...permit(), expiresAt: '2026-12-01T12:00:00Z' })).toThrow('TIME_INVALID');
    expect(() => checkPermit({ ...permit(), authorization: 'existing_old_budget' })).toThrow();
    expect(() => checkPermit({ ...permit(), automaticRenewal: true })).toThrow();
  });
  it('requires closed, complete, unchanged development with known accounting', () => {
    expect(validateDevelopmentSummary(summary(), expected).budget.chargedUsd).toBe('0.04');
    for (const patch of [
      { complete: false },
      { failure: 'ERROR' },
      { completedExecutions: 11 },
      { sourceHash: freezeHash },
      { finalSourceHash: freezeHash },
      { approvalSha256: freezeHash },
      { finalFingerprint: { sha256: freezeHash } },
      { cohort: 'old-cohort' },
    ])
      expect(() => validateDevelopmentSummary({ ...summary(), ...patch }, expected)).toThrow();
    for (const patch of [
      { state: 'open' },
      { pending: 1 },
      { unknownReservedUsd: '0.01' },
      { chargedUsd: '0.21', knownUsd: '0.21' },
      { knownUsd: '0.03' },
      { attempts: 33 },
      { haltReason: 'BUDGET' },
      { activeTrial: 'active' },
    ])
      expect(() =>
        validateDevelopmentSummary({ ...summary(), budget: { ...summary().budget, ...patch } }, expected),
      ).toThrow();
  });
  it('binds code before heldout authoring and detects later core drift', () => {
    const { root, write } = sourceTree(),
      frozen = coreSource(root);
    write(
      'scripts/completeness-evaluation/freeze.json',
      JSON.stringify({
        version: 'completeness-core-freeze-v1',
        cohort: PROTOCOL.cohort,
        coreHash: frozen.hash,
        createdAt: '2026-11-01T12:00:00Z',
        heldOutQuestionsAuthored: false,
        sharedAiAuthorshipDisclosed: true,
      }),
    );
    const before = evaluationSource(root);
    write('scripts/completeness-evaluation/fixtures/holdout.json', 'late synthetic heldout bytes');
    expect(coreSource(root)).toEqual(frozen);
    expect(evaluationSource(root).hash).not.toBe(before.hash);
    expect(validateCoreFreeze(root).coreHash).toBe(frozen.hash);
    write('server/a.ts', 'changed solver');
    expect(() => validateCoreFreeze(root)).toThrow('CORE_CHANGED_AFTER_FREEZE');
  });
  it('rejects source symlinks and missing required files', () => {
    const { root } = sourceTree();
    symlinkSync(join(root, 'package.json'), join(root, 'server/link.ts'));
    expect(() => coreSource(root)).toThrow('SOURCE_SYMLINK');
    rmSync(join(root, 'server/link.ts'));
    rmSync(join(root, '.github/workflows/ci.yml'));
    expect(() => coreSource(root)).toThrow();
  });
});
