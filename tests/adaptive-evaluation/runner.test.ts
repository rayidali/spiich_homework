import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  source: vi.fn(),
  predecessor: vi.fn(),
  environment: vi.fn(),
  seed: vi.fn(),
  cases: vi.fn(),
  messages: vi.fn(),
  createTransport: vi.fn(),
  chat: vi.fn(),
  score: vi.fn(),
  aggregate: vi.fn(),
  endPool: vi.fn(),
  config: {
    aiProvider: 'gemini',
    aiModel: 'gemini-3.5-flash-lite',
    aiKey: 'synthetic-runner-key',
    databaseUrl: 'postgres://runtime@localhost/daybook_adaptive_eval_test',
  },
}));
vi.mock('../../scripts/adaptive-evaluation/protocol', async (original) => ({
  ...(await original<object>()),
  evaluationSource: mocks.source,
  validateRunEnvironment: mocks.environment,
  validatePredecessorEvidence: mocks.predecessor,
}));
vi.mock('../../scripts/adaptive-evaluation/fixtures', () => ({
  seedFixtures: mocks.seed,
  loadCases: mocks.cases,
  fixtureMessages: mocks.messages,
}));
vi.mock('../../scripts/adaptive-evaluation/transport', () => ({
  createEvaluationTransport: mocks.createTransport,
}));
vi.mock('../../scripts/adaptive-evaluation/scoring', () => ({
  scoreAdaptiveResponse: mocks.score,
  aggregatePairedScores: mocks.aggregate,
}));
vi.mock('../../scripts/adaptive-evaluation/scoring-v2', () => ({ scoreAdaptiveResponseV2: mocks.score }));
vi.mock('../../server/config', () => ({ config: mocks.config }));
vi.mock('../../server/ai', () => ({ financialChat: mocks.chat }));
vi.mock('../../server/db', () => ({ pool: { end: mocks.endPool } }));
import { runEvaluation } from '../../scripts/adaptive-evaluation/cli';
import { PROTOCOL } from '../../scripts/adaptive-evaluation/protocol';

const sourceHash = 'a'.repeat(64),
  sourceCommit = 'b'.repeat(40);
const predecessor = {
  version: 'adaptive-v2-predecessor',
  runId: '100',
  sourceCommit: 'e'.repeat(40),
  sourceHash: 'f'.repeat(64),
  chargedUsd: '0.0430523',
  attempts: 10,
  unknownReservedUsd: '0',
  calibrationSha256: 'c'.repeat(64),
  predecessorManifestSha256: 'a'.repeat(64),
  runtimeHash: 'b'.repeat(64),
  expectedKeySha256: 'd'.repeat(64),
};
const initial = {
  sha256: 'c'.repeat(64),
  organizations: 2,
  accounts: 46,
  entries: 41,
  lines: 86,
  scope: 'full_org_account_entry_line_rows',
};
let directory: string;
let events: string[];
let activeTrial: string | null;
let haltReason: string | null;
let records: { id: string; trial: string; state: string; usage: unknown; httpStatus: number }[];
let fingerprint: ReturnType<typeof vi.fn>;
let fixtureClose: ReturnType<typeof vi.fn>;
let afterCall: (() => void) | undefined;
let state: 'open' | 'closed';
const read = (relative: string) => JSON.parse(readFileSync(join(directory, relative), 'utf8'));
function save(relative: string, value: unknown) {
  const path = join(directory, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}
function summary() {
  return {
    state,
    attempts: records.length,
    knownUsd: haltReason ? '0' : '0.0001',
    unknownReservedUsd: haltReason ? '0.02' : '0',
    chargedUsd: haltReason ? '0.02' : '0.0001',
    haltReason,
    pending: 0,
    activeTrial,
  };
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'daybook-adaptive-runner-'));
  events = [];
  records = [];
  activeTrial = null;
  haltReason = null;
  afterCall = undefined;
  state = 'open';
  process.exitCode = 0;
  vi.stubEnv('EVALUATION_SOURCE_HASH', sourceHash);
  vi.stubEnv('AI_PROVIDER', 'gemini');
  vi.stubEnv('AI_MODEL', PROTOCOL.model);
  vi.stubEnv('GEMINI_API_KEY', mocks.config.aiKey);
  vi.stubEnv('EVALUATION_KEY_SHA256', 'd'.repeat(64));
  vi.stubEnv('DATABASE_URL', mocks.config.databaseUrl);
  vi.stubEnv('MIGRATION_DATABASE_URL', 'postgres://owner@localhost/daybook_adaptive_eval_test');
  for (const value of Object.values(mocks)) if (vi.isMockFunction(value)) value.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.predecessor.mockReturnValue(predecessor);
  mocks.source.mockReturnValue({ hash: sourceHash, files: { source: sourceHash } });
  mocks.environment.mockReturnValue({ phase: 'development', runId: '101', sourceCommit });
  save('authorization.json', {
    runId: '101',
    phase: 'development',
    sourceCommit,
    sourceHash,
    cohort: PROTOCOL.cohort,
    predecessor,
  });
  const cases = [1, 2, 3, 4].map((n) => ({
    id: `D0${n}`,
    split: 'development',
    family: 'synthetic-runner-contract',
    messages: [{ role: 'user', content: `Fixture question ${n}` }],
    expected: { behavior: 'ANSWER', required: [], supporting: [] },
  }));
  mocks.cases.mockReturnValue(cases);
  mocks.messages.mockImplementation((item) => structuredClone(item.messages));
  fingerprint = vi.fn(async () => {
    events.push('fingerprint');
    return { ...initial };
  });
  fixtureClose = vi.fn(async () => {
    events.push('fixture-close');
  });
  mocks.seed.mockImplementation(async () => {
    events.push('seed-and-reference-checks');
    return {
      orgId: 'isolated-org',
      foreignOrgId: 'foreign-org',
      chart: [],
      counterparties: [],
      referenceChecks: 76,
      counts: { entries: 41, lines: 86 },
      initialFingerprint: { ...initial },
      fingerprint,
      close: fixtureClose,
    };
  });
  mocks.createTransport.mockImplementation(() => {
    events.push('create-transport');
    save('transport/ledger.json', { records });
    return {
      install() {
        events.push('install');
        return () => {
          events.push('restore');
        };
      },
      beginTrial({ caseId, route }: { caseId: string; route: string }) {
        activeTrial = `${route}/${caseId}`;
        events.push(`begin:${activeTrial}`);
      },
      endTrial() {
        events.push(`end:${activeTrial}`);
        activeTrial = null;
      },
      summary,
      close() {
        events.push('close-transport');
        state = 'closed';
        return summary();
      },
    };
  });
  mocks.chat.mockImplementation(async (_org, _messages, options) => {
    events.push(`chat:${options.route}`);
    expect(activeTrial).not.toBeNull();
    const id = String(records.length + 1).padStart(4, '0');
    records.push({ id, trial: activeTrial!, state: 'known', usage: { inputTokens: 1 }, httpStatus: 200 });
    save(`transport/attempts/${id}/request.json`, { synthetic: true });
    save(`transport/attempts/${id}/response.json`, { synthetic: true });
    save('transport/ledger.json', { records });
    afterCall?.();
    return { answer: 'Synthetic runner response, not model accuracy.', evidence: [] };
  });
  mocks.score.mockImplementation((item, outcome) => ({
    caseId: item.id,
    split: item.split,
    family: item.family,
    classification: outcome.error ? 'execution-error' : 'structured-correct',
    passed: !outcome.error,
    reasons: [outcome.error?.code ?? 'SYNTHETIC_CONTRACT'],
    requiredClaims: 0,
    matchedClaims: [],
    extraClaims: 0,
    numericCorrect: !outcome.error,
    scopeCorrect: !outcome.error,
    hardBoundaryViolations: [],
  }));
  mocks.aggregate.mockReturnValue({ matchedPairs: 4, syntheticContractOnly: true });
  mocks.endPool.mockImplementation(async () => {
    events.push('pool-close');
  });
});
afterEach(() => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe('provider-free runner ordering and artifact preservation', () => {
  it('runs all eight paired cells on the same verified fixture and retains their outcomes', async () => {
    await runEvaluation(directory);
    const result = read('summary.json');
    expect(result).toMatchObject({
      complete: true,
      completedExecutions: 8,
      attemptedExecutions: 8,
      failure: null,
    });
    expect(result.initialFingerprint).toEqual(result.finalFingerprint);
    expect(result.budget.state).toBe('closed');
    expect(result.cumulativeAccounting).toMatchObject({
      priorChargedUsd: '0.0430523',
      totalChargedUsd: '0.0431523',
      totalAttempts: 18,
      unusedDevelopmentTransferred: false,
    });
    expect(result.predecessor).not.toHaveProperty('expectedKeySha256');
    expect(read('run.json').predecessor).not.toHaveProperty('expectedKeySha256');
    expect(read('trials/D01-composable/score-v1.json')).toEqual(read('trials/D01-composable/score.json'));
    expect(mocks.chat.mock.calls.map(([org, _messages, options]) => [org, options.route])).toEqual([
      ['isolated-org', 'composable'],
      ['isolated-org', 'adaptive'],
      ['isolated-org', 'adaptive'],
      ['isolated-org', 'composable'],
      ['isolated-org', 'composable'],
      ['isolated-org', 'adaptive'],
      ['isolated-org', 'adaptive'],
      ['isolated-org', 'composable'],
    ]);
    expect(events.indexOf('seed-and-reference-checks')).toBeLessThan(events.indexOf('install'));
    expect(events.indexOf('fingerprint')).toBeLessThan(events.indexOf('chat:composable'));
    expect(events.indexOf('restore')).toBeLessThan(events.indexOf('close-transport'));
    for (const item of ['D01', 'D02', 'D03', 'D04'])
      for (const route of ['composable', 'adaptive']) {
        const saved = read(`trials/${item}-${route}/outcome.json`);
        expect(saved.outcome.attempts).toHaveLength(1);
        expect(read(`trials/${item}-${route}/before.json`)).toEqual(initial);
        expect(read(`trials/${item}-${route}/after.json`)).toEqual(initial);
      }
  });

  it('does not install provider transport or call the model after fixture/reference validation fails', async () => {
    mocks.seed.mockRejectedValue(new Error('FIXTURE_STORED_LINES'));
    await runEvaluation(directory);
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(events).not.toContain('install');
    expect(read('summary.json')).toMatchObject({
      complete: false,
      attemptedExecutions: 0,
      failure: 'FIXTURE_STORED_LINES',
    });
  });

  it('requires authorization and source agreement before creating transport or seeding', async () => {
    save('authorization.json', { runId: 'wrong' });
    await expect(runEvaluation(directory)).rejects.toThrow('EVALUATION_AUTHORIZATION_MISMATCH');
    expect(mocks.seed).not.toHaveBeenCalled();
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it('refuses changed predecessor evidence before any model or fixture access', async () => {
    mocks.predecessor.mockReturnValue({ ...predecessor, chargedUsd: '0' });
    await expect(runEvaluation(directory)).rejects.toThrow('EVALUATION_PREDECESSOR_AUTHORIZATION_MISMATCH');
    expect(mocks.createTransport).not.toHaveBeenCalled();
    expect(mocks.seed).not.toHaveBeenCalled();
  });

  it('refuses a different credential binding before creating a transport', async () => {
    vi.stubEnv('EVALUATION_KEY_SHA256', '9'.repeat(64));
    await expect(runEvaluation(directory)).rejects.toThrow('EVALUATION_PREDECESSOR_KEY_MISMATCH');
    expect(mocks.createTransport).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it('cannot omit prior costs or transfer an excessive allowance', async () => {
    const altered = { ...predecessor, chargedUsd: '0.49' };
    mocks.predecessor.mockReturnValue(altered);
    save('authorization.json', { ...read('authorization.json'), predecessor: altered });
    await expect(runEvaluation(directory)).rejects.toThrow('EVALUATION_CUMULATIVE_ALLOWANCE_EXCEEDED');
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it('keeps a known semantic/model failure in the paired inventory without a retry', async () => {
    afterCall = () => {
      if (records.length === 1) throw { code: 'AI_INVALID_RESPONSE' };
    };
    await runEvaluation(directory);
    const result = read('summary.json');
    expect(result).toMatchObject({ complete: true, completedExecutions: 8, attemptedExecutions: 8 });
    expect(mocks.chat).toHaveBeenCalledTimes(8);
    expect(read('trials/D01-composable/outcome.json').outcome.error).toEqual({ code: 'AI_INVALID_RESPONSE' });
    expect(read('trials/D01-composable/outcome.json').outcome.attempts).toHaveLength(1);
    expect(result.trials[0].score.passed).toBe(false);
  });

  it('preserves the first outcome and halts immediately on unknown accounting', async () => {
    afterCall = () => {
      haltReason = 'USAGE_UNKNOWN';
      records.at(-1)!.state = 'unknown';
      save('transport/ledger.json', { records });
    };
    await runEvaluation(directory);
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    expect(read('summary.json')).toMatchObject({
      complete: false,
      attemptedExecutions: 1,
      completedExecutions: 1,
      failure: 'EVALUATION_TRANSPORT_HALTED',
      budget: { haltReason: 'USAGE_UNKNOWN' },
    });
    expect(read('trials/D01-composable/outcome.json').outcome.attempts[0].state).toBe('unknown');
    expect(existsSync(join(directory, 'trials/D01-adaptive/outcome.json'))).toBe(false);
  });

  it('refuses an already changed fixture before the first model invocation', async () => {
    fingerprint.mockResolvedValue({ ...initial, sha256: 'changed' });
    await runEvaluation(directory);
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(read('summary.json')).toMatchObject({
      complete: false,
      attemptedExecutions: 0,
      failure: 'EVALUATION_BOOKS_CHANGED',
    });
  });

  it('retains a call that changed the books and prevents the paired follow-up', async () => {
    afterCall = () => fingerprint.mockResolvedValue({ ...initial, sha256: 'changed' });
    await runEvaluation(directory);
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    expect(existsSync(join(directory, 'trials/D01-composable/outcome.json'))).toBe(true);
    expect(read('summary.json')).toMatchObject({
      complete: false,
      attemptedExecutions: 1,
      failure: 'EVALUATION_BOOKS_CHANGED',
    });
  });

  it('does not report completion when source changes during the final call', async () => {
    afterCall = () => {
      if (mocks.chat.mock.calls.length === 8) mocks.source.mockReturnValue({ hash: 'changed', files: {} });
    };
    await runEvaluation(directory);
    expect(mocks.chat).toHaveBeenCalledTimes(8);
    expect(read('summary.json')).toMatchObject({
      complete: false,
      attemptedExecutions: 8,
      failure: 'EVALUATION_SOURCE_DRIFT',
    });
  });

  it('compares the final cleanup fingerprint instead of overwriting a previously verified one', async () => {
    fingerprint.mockImplementation(async () => ({
      ...initial,
      sha256: fingerprint.mock.calls.length >= 18 ? 'changed-at-final-capture' : initial.sha256,
    }));
    await runEvaluation(directory);
    expect(mocks.chat).toHaveBeenCalledTimes(8);
    expect(read('summary.json')).toMatchObject({
      complete: false,
      attemptedExecutions: 8,
      failure: 'EVALUATION_BOOKS_CHANGED',
    });
  });

  it('sanitizes unexpected private errors while retaining an incomplete result', async () => {
    mocks.seed.mockRejectedValue(new Error('postgres://owner:private-password@example.invalid/private'));
    await runEvaluation(directory);
    const text = readFileSync(join(directory, 'summary.json'), 'utf8');
    expect(text).not.toContain('private-password');
    expect(read('summary.json').failure).toBe('EVALUATION_EXECUTION_FAILED');
    expect(mocks.chat).not.toHaveBeenCalled();
  });
});
