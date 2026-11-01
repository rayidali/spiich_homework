import { describe, expect, it } from 'vitest';
import { pairedSchedule, PROTOCOL, validateRunEnvironment } from '../../scripts/adaptive-evaluation/protocol';
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
  EVALUATION_PHASE: 'development',
  EVALUATION_SOURCE_COMMIT: 'a'.repeat(40),
  EVALUATION_SOURCE_HASH: 'b'.repeat(64),
};
const run = {
  id: 123,
  display_title: `adaptive-evaluation/${PROTOCOL.cohort}/development`,
  head_sha: 'a'.repeat(40),
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
  event: 'workflow_dispatch',
};
describe('manual adaptive comparison authorization', () => {
  it('pins the repository, event, cohort, phase and exact source', () => {
    expect(validateRunEnvironment(environment)).toEqual({
      phase: 'development',
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
  it('requires a development run for holdout', () => {
    expect(() => validateRunEnvironment({ ...environment, EVALUATION_PHASE: 'holdout' })).toThrow(
      'EVALUATION_DEVELOPMENT_REQUIRED',
    );
    expect(
      validateRunEnvironment({
        ...environment,
        EVALUATION_PHASE: 'holdout',
        EVALUATION_DEVELOPMENT_RUN: '100',
      }).phase,
    ).toBe('holdout');
  });
  it('a new run ID cannot reuse the same phase allowance', () => {
    expect(() => assertNoPreviousRun([run], '124', 'development')).toThrow(
      'EVALUATION_COHORT_ALREADY_DISPATCHED',
    );
    expect(() => assertNoPreviousRun([run], '123', 'development')).not.toThrow();
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
    expect(() => assertDevelopmentRun({ ...run, ...patch }, 'a'.repeat(40))).toThrow(
      'EVALUATION_DEVELOPMENT_NOT_COMPLETE',
    );
  });
  it('allows successful same-source development', () => {
    expect(() => assertDevelopmentRun(run, 'a'.repeat(40))).not.toThrow();
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
