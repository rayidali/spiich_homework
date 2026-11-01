import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  pairedSchedule,
  PREDECESSOR,
  PROTOCOL,
  validateRunEnvironment,
  assertUnchangedInference,
  assertClosedDevelopment,
  assertCalibrationBinding,
  validatePredecessorEvidence,
} from '../../scripts/adaptive-evaluation/protocol';
import { assertDevelopmentRun, assertNoPreviousRun } from '../../scripts/adaptive-evaluation/authorize';

const environment = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: PROTOCOL.repository,
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_RUN_ID: '123',
  GITHUB_SHA: 'a'.repeat(40),
  NODE_ENV: 'test',
  GITHUB_REF: 'refs/heads/main',
  EVALUATION_COHORT: PROTOCOL.cohort,
  EVALUATION_PHASE: 'holdout',
  EVALUATION_DEVELOPMENT_RUN: PREDECESSOR.runId,
  EVALUATION_SOURCE_COMMIT: 'a'.repeat(40),
  EVALUATION_SOURCE_HASH: 'b'.repeat(64),
};
const run = {
  id: Number(PREDECESSOR.runId),
  display_title: `adaptive-evaluation/${PROTOCOL.cohort}/development`,
  head_sha: PREDECESSOR.sourceCommit,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
  event: 'workflow_dispatch',
};
describe('manual adaptive comparison authorization', () => {
  it('pins the repository, event, cohort, phase and exact source', () => {
    expect(validateRunEnvironment(environment)).toEqual({
      phase: 'holdout',
      sourceCommit: 'a'.repeat(40),
      runId: '123',
    });
  });
  it.each([
    ['GITHUB_RUN_ATTEMPT', '2'],
    ['GITHUB_EVENT_NAME', 'push'],
    ['GITHUB_REPOSITORY', 'another/repository'],
    ['EVALUATION_SOURCE_COMMIT', 'c'.repeat(40)],
    ['EVALUATION_COHORT', 'fresh-budget'],
    ['NODE_ENV', 'production'],
    ['GITHUB_ACTIONS', 'false'],
    ['GITHUB_REF', 'refs/heads/other'],
    ['EVALUATION_PHASE', 'other'],
    ['EVALUATION_SOURCE_HASH', 'wrong'],
    ['GITHUB_RUN_ID', '0'],
  ])('refuses changed %s', (key, value) => {
    expect(() => validateRunEnvironment({ ...environment, [key]: value })).toThrow();
  });
  it('requires the fixed development predecessor and forbids paid development replay', () => {
    expect(() => validateRunEnvironment({ ...environment, EVALUATION_DEVELOPMENT_RUN: undefined })).toThrow(
      'EVALUATION_DEVELOPMENT_REQUIRED',
    );
    expect(() => validateRunEnvironment({ ...environment, EVALUATION_DEVELOPMENT_RUN: '100' })).toThrow();
    expect(() => validateRunEnvironment({ ...environment, EVALUATION_PHASE: 'development' })).toThrow(
      'EVALUATION_DEVELOPMENT_CLOSED',
    );
  });
  it('a new run ID cannot reuse the same phase allowance', () => {
    expect(() => assertNoPreviousRun([run], '124', 'development')).toThrow(
      'EVALUATION_COHORT_ALREADY_DISPATCHED',
    );
    expect(() => assertNoPreviousRun([run], PREDECESSOR.runId, 'development')).not.toThrow();
    expect(() => assertNoPreviousRun([run], '124', 'holdout')).not.toThrow();
  });
  it.each([
    { head_sha: 'c'.repeat(40) },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { run_attempt: 2 },
    { event: 'push' },
    { display_title: 'another experiment' },
  ])('rejects unbound or incomplete development evidence %j', (patch) => {
    expect(() => assertDevelopmentRun({ ...run, ...patch })).toThrow('EVALUATION_DEVELOPMENT_NOT_COMPLETE');
  });
  it('allows only the exact successful historical development run, not another same-source run', () => {
    expect(() => assertDevelopmentRun(run)).not.toThrow();
    expect(() => assertDevelopmentRun({ ...run, id: 456 })).toThrow();
  });
  it('pairs all cases and balances first-route order', () => {
    const cases = [4, 2, 3, 1].map((n) => ({ id: `D${n}`, split: 'development' as const }));
    const schedule = pairedSchedule(cases, 'development');
    expect(schedule.map(({ item, route }) => `${item.id}/${route}`)).toEqual([
      'D1/composable',
      'D1/adaptive',
      'D2/adaptive',
      'D2/composable',
      'D3/composable',
      'D3/adaptive',
      'D4/adaptive',
      'D4/composable',
    ]);
  });
  it('does not silently evaluate a smaller or duplicated case inventory', () => {
    expect(() => pairedSchedule([], 'development')).toThrow('EVALUATION_CASE_INVENTORY');
    expect(() =>
      pairedSchedule(
        Array.from({ length: 4 }, () => ({ id: 'D1', split: 'development' as const })),
        'development',
      ),
    ).toThrow();
  });
});

describe('closed development carry and scoring-only calibration', () => {
  const predecessor = JSON.parse(readFileSync(PREDECESSOR.manifestPath, 'utf8'));
  function evidence() {
    const ledger = {
      state: 'closed',
      haltReason: null,
      trials: Object.fromEntries(Array.from({ length: 8 }, (_, n) => [`cell${n}`, { state: 'finished' }])),
      records: Array.from({ length: 10 }, (_, n) => ({
        id: String(n + 1).padStart(4, '0'),
        state: 'known',
        costUsd: n === 0 ? '0.0430496' : '0.0000003',
        usage: {
          inputTokens: n === 0 ? 143482 : 1,
          outputTokens: n === 0 ? 2 : 0,
          thinkingTokens: 0,
          totalTokens: n === 0 ? 143484 : 1,
        },
      })),
    };
    const summary = {
      complete: true,
      failure: null,
      phase: 'development',
      runId: PREDECESSOR.runId,
      sourceCommit: PREDECESSOR.sourceCommit,
      sourceHash: PREDECESSOR.sourceHash,
      finalSourceHash: PREDECESSOR.sourceHash,
      plannedExecutions: 8,
      attemptedExecutions: 8,
      completedExecutions: 8,
      initialFingerprint: { sha256: 'a'.repeat(64) },
      finalFingerprint: { sha256: 'a'.repeat(64) },
      budget: {
        state: 'closed',
        attempts: 10,
        pending: 0,
        activeTrial: null,
        haltReason: null,
        knownUsd: '0.0430523',
        unknownReservedUsd: '0',
        chargedUsd: '0.0430523',
      },
    };
    const manifest = {
      model: PROTOCOL.model,
      ceilingUsd: '0.10',
      maxAttempts: 20,
      inputUsdPerMillion: '0.30',
      outputUsdPerMillion: '2.50',
      maxOutputTokens: 4000,
      maxRequestBytes: 256 * 1024,
      expectedKeySha256: 'b'.repeat(64),
    };
    return { ledger, summary, manifest };
  }
  it('carries the original actual spend without reopening or transferring unused development allowance', () => {
    const e = evidence();
    expect(() => assertClosedDevelopment(e.ledger, e.summary, e.manifest)).not.toThrow();
    expect(PROTOCOL.phases.holdout).toEqual({
      cases: 16,
      executions: 32,
      maxAttempts: 80,
      ceilingUsd: '0.40',
    });
    expect(PREDECESSOR.chargedUsd).toBe('0.0430523');
    expect(PREDECESSOR.attempts + PROTOCOL.phases.holdout.maxAttempts).toBe(90);
  });
  it.each(['unknown', 'pending'])('rejects %s prior usage without refunding reservations', (state) => {
    const e = evidence();
    e.ledger.records[0].state = state;
    expect(() => assertClosedDevelopment(e.ledger, e.summary, e.manifest)).toThrow(
      'EVALUATION_PREDECESSOR_USAGE_INVALID',
    );
  });
  it('rejects repricing, altered usage, incomplete books or larger predecessor counts', () => {
    for (const mutate of [
      (e: ReturnType<typeof evidence>) => {
        e.ledger.records[0].costUsd = '0';
      },
      (e: ReturnType<typeof evidence>) => {
        e.ledger.records[0].usage.totalTokens++;
      },
      (e: ReturnType<typeof evidence>) => {
        e.summary.finalFingerprint.sha256 = 'changed';
      },
      (e: ReturnType<typeof evidence>) => {
        e.summary.completedExecutions = 7;
      },
      (e: ReturnType<typeof evidence>) => {
        e.ledger.records.push(e.ledger.records[0]);
      },
      (e: ReturnType<typeof evidence>) => {
        e.manifest.outputUsdPerMillion = '0';
      },
    ]) {
      const e = evidence();
      mutate(e);
      expect(() => assertClosedDevelopment(e.ledger, e.summary, e.manifest)).toThrow();
    }
  });
  it('allows only enumerated calibration/admission source changes', () => {
    const old = predecessor.source.files;
    const next = {
      ...old,
      'scripts/adaptive-evaluation/scoring-v2.ts': 'c'.repeat(64),
      'scripts/adaptive-evaluation/protocol.ts': 'd'.repeat(64),
      'docs/research/ADAPTIVE_EVALUATION_V2.md': 'e'.repeat(64),
    };
    expect(assertUnchangedInference(old, next)).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    'server/ai.ts',
    'scripts/adaptive-evaluation/transport.ts',
    'scripts/adaptive-evaluation/fixtures/development.json',
    'scripts/adaptive-evaluation/fixtures/holdout.json',
    'scripts/adaptive-evaluation/scoring.ts',
    'docs/research/ADAPTIVE_EVALUATION.md',
    'package-lock.json',
  ])('refuses changing original protected %s', (path) => {
    const old = predecessor.source.files;
    expect(() => assertUnchangedInference(old, { ...old, [path]: 'f'.repeat(64) })).toThrow(
      'EVALUATION_UNREVIEWED_SOURCE_CHANGE',
    );
  });
  it('rejects newly added inference modules and removed source', () => {
    const old = predecessor.source.files;
    expect(() =>
      assertUnchangedInference(old, { ...old, 'server/hidden-extra.ts': 'f'.repeat(64) }),
    ).toThrow();
    const removed = { ...old };
    delete removed['server/ai.ts'];
    expect(() => assertUnchangedInference(old, removed)).toThrow();
  });
  function calibration() {
    const hashes = {
      predecessor: PREDECESSOR.manifestSha256,
      scorer: 'd'.repeat(64),
      results: 'e'.repeat(64),
    };
    const receipt = {
      version: 'adaptive-development-calibration-v2',
      cohort: PROTOCOL.cohort,
      developmentRun: PREDECESSOR.runId,
      sourceCommit: PREDECESSOR.sourceCommit,
      sourceHash: PREDECESSOR.sourceHash,
      predecessorManifestSha256: hashes.predecessor,
      scorer: { version: 'v2', path: PREDECESSOR.scorerPath, sha256: hashes.scorer },
      results: { path: PREDECESSOR.resultsPath, sha256: hashes.results, executions: 8 },
      inputHashes: { ...predecessor.artifactHashes },
      providerCalls: 0,
      runtimeAndFixtureUnchanged: true,
    };
    const results = {
      trials: pairedSchedule(
        [1, 2, 3, 4].map((n) => ({ id: `D0${n}`, split: 'development' as const })),
        'development',
      ).map(({ item, route }) => ({ caseId: item.id, route, score: {} })),
    };
    return { hashes, receipt, results };
  }
  it('binds an eight-cell offline calibration to original outputs and the versioned scorer', () => {
    const e = calibration();
    expect(() => assertCalibrationBinding(e.receipt, e.results, predecessor, e.hashes)).not.toThrow();
  });
  it('rejects changed calibration inputs, scorer, call count or duplicated cells', () => {
    for (const mutate of [
      (e: ReturnType<typeof calibration>) => {
        e.receipt.inputHashes['trials/D03-composable/outcome.json'] = 'changed';
      },
      (e: ReturnType<typeof calibration>) => {
        delete e.receipt.inputHashes['transport/ledger.json'];
      },
      (e: ReturnType<typeof calibration>) => {
        e.receipt.scorer.sha256 = 'changed';
      },
      (e: ReturnType<typeof calibration>) => {
        e.receipt.providerCalls = 1;
      },
      (e: ReturnType<typeof calibration>) => {
        e.results.trials[1] = e.results.trials[0];
      },
    ]) {
      const e = calibration();
      mutate(e);
      expect(() => assertCalibrationBinding(e.receipt, e.results, predecessor, e.hashes)).toThrow();
    }
  });
  it('fails closed when the downloaded predecessor artifact is absent', () => {
    expect(() => validatePredecessorEvidence('/private/tmp/nonexistent-adaptive-predecessor-42')).toThrow(
      'EVALUATION_PREDECESSOR_INVALID',
    );
  });
  it('the old holdout name blocks another dispatch even after scorer version changes', () => {
    const prior = { ...run, display_title: `adaptive-evaluation/${PROTOCOL.cohort}/holdout`, id: 456 };
    expect(() => assertNoPreviousRun([prior], '789', 'holdout')).toThrow(
      'EVALUATION_COHORT_ALREADY_DISPATCHED',
    );
  });
});
