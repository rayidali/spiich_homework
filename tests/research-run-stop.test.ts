import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertStudyMayContinue, isStudyStopError } from '../research/run-stop';

const originalDirectory = process.cwd();
const originalArguments = [...process.argv];
const originalRoutes = process.env.RESEARCH_ROUTES;
const originalExitCode = process.exitCode;
const temporary: string[] = [];
const families = ['financial', 'analytics', 'documents', 'scenario', 'entry', 'adversarial'];
const questions = families.map((family) => ({
  id: `${family}-01-1`,
  groupId: `${family}-01`,
  family,
  split: 'development',
  organizationId: 'synthetic-workspace',
  question: 'Synthetic runner test; no provider is contacted.',
}));
function file(path: string, contents: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'daybook-stop-test-'));
  temporary.push(directory);
  process.chdir(directory);
  file('.tools/research/database-private.json', { readerUrl: 'synthetic-test-only' });
  file('docs/PLAN.md', 'Synthetic protocol.');
  file('research/fixtures/snapshot-manifest.json', { version: 'synthetic' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.doMock('node:child_process', () => ({ execFileSync: () => 'synthetic-revision' }));
  vi.doMock('../research/manifest', () => ({
    sourceManifest: () => ({ hash: 'a'.repeat(64), files: {}, runtime: {} }),
  }));
  vi.doMock('../research/reference', () => ({ reviewCases: [] }));
  return directory;
}
afterEach(() => {
  process.chdir(originalDirectory);
  process.argv = [...originalArguments];
  process.exitCode = originalExitCode;
  if (originalRoutes === undefined) delete process.env.RESEARCH_ROUTES;
  else process.env.RESEARCH_ROUTES = originalRoutes;
  vi.restoreAllMocks();
  for (const name of [
    'node:child_process',
    '../research/manifest',
    '../research/dataset',
    '../research/routes',
    '../research/database',
    '../research/report',
    '../research/reference',
    '../research/validator-study',
    '../research/providers',
  ])
    vi.doUnmock(name);
  vi.resetModules();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('research safety stop classification', () => {
  it('stops on persistent budget, policy, key, recovery and circuit failures', () => {
    for (const error of [
      'RESEARCH_BUDGET_EXHAUSTED',
      'RESEARCH_BUDGET_EXHAUSTED_STUDY_ALLOWANCE',
      'RESEARCH_BUDGET_EXHAUSTED_STUDY_ATTEMPTS',
      'RESEARCH_BUDGET_STATE_INVALID',
      'RESEARCH_BUDGET_IN_USE',
      'RESEARCH_POLICY_INCOMPLETE',
      'RESEARCH_POLICY_BASELINE_CHANGED',
      'RESEARCH_STUDY_POLICY_KEY_MISMATCH',
      'RESEARCH_STUDY_POLICY_MODEL_FORBIDDEN',
      'RESEARCH_RECOVERY_NOT_RELEASED',
      'RESEARCH_PROVIDER_CIRCUIT_OPEN',
      'RESEARCH_UNPRICED_MODEL',
    ]) {
      expect(isStudyStopError(error), error).toBe(true);
      expect(() => assertStudyMayContinue(error)).toThrow(error);
    }
  });
  it('keeps provider, schema, episode-limit and ordinary model failures in the measured sample', () => {
    for (const error of [
      undefined,
      null,
      'HTTP_ERROR',
      'RATE_LIMIT',
      'INVALID_RESPONSE',
      'VERIFIER_REQUEST_FAILED',
      'RESEARCH_HTTP_TIMEOUT',
      'RESEARCH_QUERY_BUDGET',
      'RESEARCH_EPISODE_TIMEOUT',
      'RESEARCH_WRONG_BACKEND',
      'Model said RESEARCH_POLICY_INVALID in its answer',
    ]) {
      expect(isStudyStopError(error)).toBe(false);
      expect(() => assertStudyMayContinue(error)).not.toThrow();
    }
  });
  it('preserves local stop codes through both real semantic-review adapters', async () => {
    const { evaluateVerifier } = await import('../research/validator-study');
    const { GeminiResearchClient, JevResearchClient } = await import('../research/providers');
    const transport = vi.fn(async () => {
      throw new Error('RESEARCH_BUDGET_STATE_INVALID');
    });
    const clients = {
      gemini: new GeminiResearchClient('synthetic-test-key', transport),
      jev: new JevResearchClient('synthetic-test-key', transport),
    };
    for (const method of ['llm', 'jev'] as const) {
      const result = await evaluateVerifier(
        method,
        {
          question: 'What is the cash balance?',
          evidence: [{ id: 'test-ledger', text: 'Cash balance USD 10.00.' }],
          candidate: {
            behavior: 'ANSWER',
            facts: [{ key: 'cash_balance', value: '10.00', unit: 'USD' }],
            evidenceIds: ['test-ledger'],
            assumptions: [],
            summary: 'The cash balance is USD 10.00.',
          },
        },
        clients,
      );
      expect(result).toMatchObject({ status: 'error', error: 'RESEARCH_BUDGET_STATE_INVALID' });
      expect(() => assertStudyMayContinue(result.error)).toThrow('RESEARCH_BUDGET_STATE_INVALID');
    }
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe('route runner safety stops', () => {
  async function run(error: string) {
    vi.resetModules();
    const directory = fixture();
    process.argv = ['node', 'scripts/research/run.ts', 'smoke', 'synthetic-smoke'];
    process.env.RESEARCH_ROUTES = 'R0,R1';
    const executeRoute = vi.fn(async () => {
      throw new Error(error);
    });
    const fingerprint = vi.fn(async () => 'b'.repeat(64));
    vi.doMock('../research/dataset', () => ({
      questions,
      accounts: [],
      primaryOrganizationId: 'synthetic-workspace',
    }));
    vi.doMock('../research/routes', () => ({ routes: { R0: {}, R1: {} }, executeRoute }));
    vi.doMock('../research/database', () => ({
      ResearchDatabase: class {
        fingerprint = fingerprint;
      },
    }));
    vi.doMock('../research/report', () => ({
      buildReport: (episodes: unknown[], _usage: unknown, _questions: unknown, options: unknown) => ({
        episodes: [...episodes],
        options,
      }),
      writeReport: (path: string, report: unknown) => file(`${path}/test-report.json`, report),
    }));
    const completion = import('../scripts/research/run');
    return { directory, executeRoute, fingerprint, completion };
  }
  it.each(['RESEARCH_STUDY_POLICY_KEY_MISMATCH', 'RESEARCH_BUDGET_STATE_INVALID'])(
    'persists one %s outcome, verifies the snapshot, and leaves other episodes missing',
    async (error) => {
      const result = await run(error);
      await expect(result.completion).rejects.toThrow(error);
      expect(result.executeRoute).toHaveBeenCalledTimes(1);
      expect(result.fingerprint).toHaveBeenCalledTimes(2);
      const output = join(result.directory, 'docs/evidence/research-runs/synthetic-smoke');
      const records = readFileSync(`${output}/episodes.jsonl`, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ status: 'error', error });
      expect(JSON.parse(readFileSync(`${output}/after.json`, 'utf8'))).toMatchObject({
        complete: false,
        unchanged: true,
      });
      expect(existsSync(join(result.directory, '.tools/research/runner.lock'))).toBe(false);
    },
  );
  it('continues after ordinary model failures without silently retrying them', async () => {
    const result = await run('RESEARCH_WRONG_BACKEND');
    await expect(result.completion).resolves.toBeDefined();
    expect(result.executeRoute).toHaveBeenCalledTimes(12);
    const output = join(result.directory, 'docs/evidence/research-runs/synthetic-smoke');
    const records = readFileSync(`${output}/episodes.jsonl`, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(12);
    expect(new Set(records.map((record) => record.id)).size).toBe(12);
    expect(records.every((record) => record.status === 'error')).toBe(true);
    expect(JSON.parse(readFileSync(`${output}/after.json`, 'utf8')).complete).toBe(true);
  });
});

describe('verifier runner safety stops', () => {
  it('saves the first local policy error and report, then releases its lock without filling other cases', async () => {
    vi.resetModules();
    const directory = fixture();
    process.argv = ['node', 'scripts/research/verifiers.ts', 'development', 'synthetic-verifiers'];
    for (const path of [
      'research/validator-study.ts',
      'research/review.ts',
      'research/providers/jev.ts',
      'research/providers/gemini.ts',
    ])
      file(path, 'Synthetic source hash input.');
    const cases = [0, 1].map((index) => ({
      id: `case-${index}`,
      split: 'development',
      sourceGroupId: `group-${index}`,
    }));
    const evaluateVerifier = vi.fn(async () => ({
      status: 'error',
      decision: null,
      reasons: [],
      evidenceIds: [],
      durationMs: 0,
      error: 'RESEARCH_POLICY_INVALID',
    }));
    vi.doMock('../research/reference', () => ({ reviewCases: cases }));
    vi.doMock('../research/providers', () => ({
      GeminiResearchClient: class {},
      JevResearchClient: class {},
    }));
    vi.doMock('../research/validator-study', () => ({
      analyzeVerifiers: (records: unknown[]) => ({ records: [...records], complete: records.length === 6 }),
      evaluateVerifier,
      JEV_THRESHOLD_GRID: [0.8],
      renderVerifierMarkdown: () => 'Synthetic report.',
      reviewInputHash: () => 'c'.repeat(64),
      selectJevThreshold: vi.fn(),
      VERIFIER_METHODS: ['llm', 'jev', 'deterministic'],
      VERIFIER_PROTOCOL: 'synthetic',
      visibleReviewInput: (item: unknown) => item,
    }));
    await expect(import('../scripts/research/verifiers')).rejects.toThrow('RESEARCH_POLICY_INVALID');
    expect(evaluateVerifier).toHaveBeenCalledTimes(1);
    const output = join(directory, 'docs/evidence/research-verifiers/synthetic-verifiers');
    const records = readFileSync(`${output}/development.jsonl`, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: 'error', error: 'RESEARCH_POLICY_INVALID' });
    expect(JSON.parse(readFileSync(`${output}/development-results.json`, 'utf8')).complete).toBe(false);
    expect(existsSync(join(directory, '.tools/research/runner.lock'))).toBe(false);
    expect(existsSync(join(directory, '.tools/research/verifier-config.json'))).toBe(false);
  });
});
