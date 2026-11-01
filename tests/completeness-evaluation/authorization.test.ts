import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  jsonFile,
  safeErrorCode,
  sealArtifacts,
  verifyArtifacts,
  writeEvidence,
} from '../../scripts/completeness-evaluation/artifacts';
import {
  assertDevelopmentRun,
  assertNoPreviousRun,
  verifyDevelopmentArtifact,
  type WorkflowRun,
} from '../../scripts/completeness-evaluation/authorize';
import { loadCases } from '../../scripts/completeness-evaluation/fixtures';
import { PROTOCOL, sha256 } from '../../scripts/completeness-evaluation/protocol';

const hash = 'a'.repeat(64),
  commit = 'b'.repeat(40);
const directories: string[] = [];
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'completeness-authorization-'));
  directories.push(path);
  return path;
}
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function workflowRun(): WorkflowRun {
  return {
    id: 1234,
    display_title: `completeness-evaluation/${PROTOCOL.cohort}/development`,
    head_sha: commit,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    event: 'workflow_dispatch',
  };
}
const expected = {
  runId: '1234',
  sourceCommit: commit,
  sourceHash: hash,
  approvalSha256: hash,
  freezeSha256: 'c'.repeat(64),
  keySha256: 'd'.repeat(64),
};
function syntheticArtifact() {
  const path = directory();
  const trials: Record<string, unknown> = {},
    records: Record<string, unknown>[] = [];
  for (const item of loadCases('development'))
    for (const route of PROTOCOL.routes) {
      const key = `${route}/${item.id}`,
        base = join(path, 'trials', `${item.id}-${route}`);
      trials[key] = {
        state: 'finished',
        caseId: item.id,
        route,
        maxAttempts: route === 'composable' ? 2 : 3,
      };
      records.push({ id: `attempt-${records.length + 1}`, trial: key, state: 'known', costUsd: '0.001' });
      writeEvidence(join(base, 'outcome.json'), { caseId: item.id, route });
      writeEvidence(join(base, 'score.json'), { caseId: item.id, split: 'development' });
      writeEvidence(join(base, 'before.json'), { sha256: hash });
      writeEvidence(join(base, 'after.json'), { sha256: hash });
    }
  writeEvidence(join(path, 'transport/manifest.json'), {
    version: 'completeness-evaluation-v1',
    model: PROTOCOL.model,
    expectedKeySha256: expected.keySha256,
    ceilingUsd: '0.2',
    maxAttempts: 32,
    inputUsdPerMillion: '0.30',
    outputUsdPerMillion: '2.50',
    maxOutputTokens: 4000,
    maxRequestBytes: 256 * 1024,
    maxResponseBytes: 256 * 1024,
  });
  writeEvidence(join(path, 'transport/ledger.json'), {
    version: 'completeness-evaluation-v1',
    state: 'closed',
    manifestSha256: sha256(readFileSync(join(path, 'transport/manifest.json'))),
    haltReason: null,
    trials,
    records,
  });
  writeEvidence(join(path, 'summary.json'), {
    version: PROTOCOL.version,
    cohort: PROTOCOL.cohort,
    phase: 'development',
    ...expected,
    finalSourceHash: hash,
    complete: true,
    failure: null,
    plannedExecutions: 12,
    completedExecutions: 12,
    initialFingerprint: { sha256: hash },
    finalFingerprint: { sha256: hash },
    budget: {
      state: 'closed',
      attempts: 12,
      knownUsd: '0.012',
      chargedUsd: '0.012',
      unknownReservedUsd: '0',
      haltReason: null,
      pending: 0,
      activeTrial: null,
    },
  });
  const change = (relative: string, mutate: (value: Record<string, unknown>) => void) => {
    const file = join(path, relative),
      value = jsonFile(file) as Record<string, unknown>;
    mutate(value);
    writeEvidence(file, value, false);
  };
  return { path, change };
}
describe('Explicit workflow authorization and immutable artifact provenance', () => {
  it('rejects prior phase dispatches even when failed, without rejecting the current run', () => {
    expect(() => assertNoPreviousRun([workflowRun()], '1234', 'development')).not.toThrow();
    expect(() =>
      assertNoPreviousRun([{ ...workflowRun(), conclusion: 'failure' }], '9999', 'development'),
    ).toThrow('COHORT_ALREADY_DISPATCHED');
    expect(() => assertNoPreviousRun([workflowRun()], '9999', 'holdout')).not.toThrow();
  });
  it('requires the exact successful first-attempt development at the frozen source', () => {
    expect(() => assertDevelopmentRun(workflowRun(), expected)).not.toThrow();
    for (const patch of [
      { id: 777 },
      { head_sha: 'c'.repeat(40) },
      { run_attempt: 2 },
      { event: 'push' },
      { status: 'in_progress' },
      { conclusion: 'failure' },
      { display_title: 'adaptive-evaluation/old/development' },
    ])
      expect(() => assertDevelopmentRun({ ...workflowRun(), ...patch }, expected)).toThrow();
  });
  it('retains exclusive evidence and permits only explicit atomic progress replacement', () => {
    const path = join(directory(), 'nested/evidence.json');
    writeEvidence(path, { n: 1 });
    expect(() => writeEvidence(path, { n: 2 })).toThrow();
    expect(jsonFile(path)).toEqual({ n: 1 });
    writeEvidence(path, { n: 3 }, false);
    expect(jsonFile(path)).toEqual({ n: 3 });
  });
  it('seals exact file bytes and rejects changed, extra and missing files', () => {
    const path = directory();
    writeEvidence(join(path, 'evidence.json'), { n: 1 });
    const seal = sealArtifacts(path);
    expect(verifyArtifacts(path)).toEqual(seal);
    const original = readFileSync(join(path, 'evidence.json'));
    writeEvidence(join(path, 'evidence.json'), { n: 2 }, false);
    expect(() => verifyArtifacts(path)).toThrow('ARTIFACT_CHANGED');
    writeFileSync(join(path, 'evidence.json'), original);
    writeEvidence(join(path, 'extra.json'), {});
    expect(() => verifyArtifacts(path)).toThrow('ARTIFACT_CHANGED');
    rmSync(join(path, 'extra.json'));
    rmSync(join(path, 'evidence.json'));
    expect(() => verifyArtifacts(path)).toThrow('ARTIFACT_CHANGED');
  });
  it('rejects linked artifacts and prevents resealing over an existing manifest', () => {
    const path = directory();
    writeEvidence(join(path, 'a.json'), {});
    sealArtifacts(path);
    expect(() => sealArtifacts(path)).toThrow();
    symlinkSync(join(path, 'a.json'), join(path, 'link.json'));
    expect(() => verifyArtifacts(path)).toThrow('SYMLINK');
    expect(() => jsonFile(join(path, 'link.json'))).toThrow('ARTIFACT_INVALID');
  });
  it('reconciles every development route/case and exact cost before allowing a successor', () => {
    const { path } = syntheticArtifact();
    const seal = sealArtifacts(path);
    expect(verifyDevelopmentArtifact(path, expected)).toEqual({
      runId: '1234',
      chargedUsd: '0.012',
      attempts: 12,
      artifactSha256: seal.sha256,
    });
  });
  it.each(['unknown', 'duplicate', 'wrong-cost', 'extra-trial', 'unfinished-trial', 'unrelated-record'])(
    'rejects resealed but semantically invalid predecessor %s',
    (kind) => {
      const { path, change } = syntheticArtifact();
      change('transport/ledger.json', (value) => {
        const records = value.records as { id: string; state: string; costUsd: string; trial: string }[];
        const trials = value.trials as Record<string, { state: string }>;
        if (kind === 'unknown') records[0].state = 'unknown';
        if (kind === 'duplicate') records[0].id = records[1].id;
        if (kind === 'wrong-cost') records[0].costUsd = '0.002';
        if (kind === 'extra-trial') trials.extra = { state: 'finished' };
        if (kind === 'unfinished-trial') trials[Object.keys(trials)[0]].state = 'active';
        if (kind === 'unrelated-record') records[0].trial = 'complete/other';
      });
      sealArtifacts(path);
      expect(() => verifyDevelopmentArtifact(path, expected)).toThrow();
    },
  );
  it('rejects changed books, wrong split or missing outcome even when resealed', () => {
    for (const kind of ['books', 'split', 'missing']) {
      const { path, change } = syntheticArtifact(),
        item = loadCases('development')[0];
      const base = `trials/${item.id}-composable`;
      if (kind === 'books')
        change(`${base}/after.json`, (value) => {
          value.sha256 = 'e'.repeat(64);
        });
      if (kind === 'split')
        change(`${base}/score.json`, (value) => {
          value.split = 'holdout';
        });
      if (kind === 'missing') rmSync(join(path, base, 'outcome.json'));
      sealArtifacts(path);
      expect(() => verifyDevelopmentArtifact(path, expected)).toThrow();
    }
  });
  it('requires the same model, key, freeze and phase caps in the predecessor manifest', () => {
    for (const patch of [
      { model: 'different-model' },
      { expectedKeySha256: hash },
      { maxAttempts: 33 },
      { ceilingUsd: '0.7' },
      { maxOutputTokens: 8000 },
      { inputUsdPerMillion: '0.10' },
    ]) {
      const { path, change } = syntheticArtifact();
      change('transport/manifest.json', (value) => Object.assign(value, patch));
      sealArtifacts(path);
      expect(() => verifyDevelopmentArtifact(path, expected)).toThrow('MANIFEST_INVALID');
    }
    const { path } = syntheticArtifact();
    sealArtifacts(path);
    expect(() => verifyDevelopmentArtifact(path, { ...expected, freezeSha256: hash })).toThrow(
      'MANIFEST_INVALID',
    );
  });
  it('never turns arbitrary error bodies into log messages', () => {
    expect(safeErrorCode(new Error('secret provider body'))).toBe('COMPLETENESS_EXECUTION_FAILED');
    expect(safeErrorCode({ code: 'AI_UNAVAILABLE', message: 'secret body' })).toBe('AI_UNAVAILABLE');
    expect(safeErrorCode({ code: 'https://secret' })).toBe('COMPLETENESS_EXECUTION_FAILED');
  });
});
