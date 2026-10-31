import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  prepareCategorySnapshot,
  selectCategory,
  type CategoryHttpRequest,
  type CategoryTransport,
} from '../server/category-selector';
import { categoryCases, knownDevelopmentRegressions } from '../scripts/category-evaluation/fixtures';
import { categoryReference } from '../scripts/category-evaluation/references';
import { CategoryBudget, CATEGORY_PRICES } from '../scripts/category-evaluation/budget';
import {
  parseCategoryArguments,
  plannedCategorySlots,
  runCategoryEvaluation,
  type CategoryRunRecord,
} from '../scripts/category-evaluation/run';
import type { TransportObservation } from '../scripts/category-evaluation/transport';

const temporary: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function setup(selectors: ('reference' | 'gemini' | 'jev')[] = ['reference', 'gemini', 'jev']) {
  const root = mkdtempSync(join(tmpdir(), 'category-runner-test-'));
  temporary.push(root);
  writeFileSync(join(root, 'frozen.txt'), 'synthetic frozen source');
  return {
    root,
    run: 'offline-test',
    split: 'development' as const,
    mode: 'create' as const,
    keys: { gemini: 'fake-gemini-credential', jev: 'fake-jev-credential' },
    selectors,
    directory: join(root, 'run'),
    sourceFiles: ['frozen.txt'],
    cases: categoryCases.filter((c) => ['repeat-paper-dev', 'repeat-paper'].includes(c.sequenceId)),
  };
}
function modelBody(request: CategoryHttpRequest) {
  const body = JSON.parse(request.body);
  const state = request.provider === 'gemini' ? JSON.parse(body.contents[0].parts[0].text) : body.state;
  const choice =
    state.options.find((o: { accountCode: string | null }) => o.accountCode === '5030')?.key ??
    state.options[0].key;
  if (request.provider === 'gemini')
    return {
      modelVersion: CATEGORY_PRICES.gemini.model,
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ choice }) }] } }],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 10,
        thoughtsTokenCount: 0,
        totalTokenCount: 110,
      },
    };
  return {
    model: CATEGORY_PRICES.jev.model,
    answers: {
      category: {
        type: 'choice',
        choice,
        confidence: 1,
        probabilities: Object.fromEntries(
          state.options.map((o: { key: string }) => [o.key, o.key === choice ? 1 : 0]),
        ),
      },
    },
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}
function fakeTransport(calls: { id: string; request: CategoryHttpRequest }[] = []) {
  return (
      _directory: string,
      id: string,
      budget: CategoryBudget,
      observation: TransportObservation,
    ): CategoryTransport =>
    async (request) => {
      calls.push({ id, request });
      budget.reserve(id, request.provider, request.body);
      budget.settle(id, { inputTokens: 100, outputTokens: 10 });
      Object.assign(observation, {
        dispatched: true,
        claimed: true,
        networkMs: 12,
        httpStatus: 200,
        exitCode: 0,
      });
      return { status: 200, body: modelBody(request) };
    };
}

describe('Focused category runner: no provider calls', () => {
  it('accepts only explicit, unique CLI options and disallows a fresh holdout budget', async () => {
    expect(parseCategoryArguments(['--split=development', '--run=example-1', '--mode=create'])).toEqual({
      split: 'development',
      run: 'example-1',
      mode: 'create',
    });
    for (const args of [
      [],
      ['--split=development', '--run=../secret', '--mode=create'],
      ['--split=development', '--run=x', '--run=y'],
      ['--split=holdout', '--run=x', '--mode=reset'],
    ])
      expect(() => parseCategoryArguments(args)).toThrow('RUN_ARGUMENTS');
    await expect(runCategoryEvaluation({ ...setup(), split: 'holdout' })).rejects.toThrow(
      'RUN_DEVELOPMENT_FIRST',
    );
  });
  it('all72 visible inputs typecheck against the actual selector and local gates match the declared opportunities', async () => {
    let opportunities = 0;
    for (const item of [...categoryCases, ...knownDevelopmentRegressions]) {
      const snapshot = prepareCategorySnapshot(item.input.facts, item.input.context);
      const result = await selectCategory(snapshot, { provider: 'reference' });
      expect(result.metadata.snapshotHash).toBe(snapshot.hash);
      expect(result.metadata.attempts).toBe(0);
      expect(result.basis === 'input_gate').toBe(!categoryReference(item).selectorEligible);
      if (result.basis !== 'input_gate') opportunities++;
      for (const label of [
        'acceptableCategoryCodes',
        'preferredCategoryCode',
        'selectorEligible',
        'split',
        'sequenceId',
        'excludedEvidenceIds',
      ])
        expect(snapshot.stateJson).not.toContain(`"${label}"`);
    }
    expect(opportunities).toBe(57);
  });
  it('rotates all three selectors per identical case and binds each prepared snapshot deterministically', () => {
    const plan = plannedCategorySlots(categoryCases, ['reference', 'gemini', 'jev']);
    expect(plan).toHaveLength(216);
    expect(plan).toEqual(plannedCategorySlots(categoryCases, ['reference', 'gemini', 'jev']));
    for (let index = 0; index < plan.length; index += 3) {
      const group = plan.slice(index, index + 3);
      expect(new Set(group.map((g) => g.caseId)).size).toBe(1);
      expect(new Set(group.map((g) => g.snapshotHash)).size).toBe(1);
      expect(new Set(group.map((g) => g.selector)).size).toBe(3);
    }
    expect(new Set([plan[0].selector, plan[3].selector, plan[6].selector]).size).toBe(3);
  });
  it('runs real selector parsing with fake transport, reuses one ledger for holdout, and never claims journal measurement', async () => {
    const options = setup(),
      calls: { id: string; request: CategoryHttpRequest }[] = [];
    const dependencies = { transport: fakeTransport(calls) };
    const development = await runCategoryEvaluation(options, dependencies);
    expect(development.complete).toBe(true);
    expect(development.eligibleForComparison).toBe(false);
    expect(calls).toHaveLength(6);
    expect(json(join(options.directory, 'budget.json')).state).toBe('open');
    const firstRecords = readdirSync(join(options.directory, 'observations')).map((name) =>
      readFileSync(join(options.directory, 'observations', name), 'utf8'),
    );
    const holdout = await runCategoryEvaluation(
      { ...options, split: 'holdout', mode: 'resume' },
      dependencies,
    );
    expect(holdout.complete).toBe(true);
    expect(holdout.eligibleForComparison).toBe(true);
    expect(calls).toHaveLength(12);
    expect(new Set(calls.map((c) => c.id)).size).toBe(12);
    expect(json(join(options.directory, 'budget.json')).state).toBe('closed');
    expect(holdout.selectors.every((s) => s.completeJournalsMeasured === 0)).toBe(true);
    expect(holdout.comparison.workflowAcceptanceVerified).toBe(false);
    expect(holdout.selectors.find((s) => s.selector === 'gemini')!.timing.allAttemptNetwork.p50Ms).toBe(12);
    expect(existsSync(join(options.directory, 'budget.json.lock'))).toBe(false);
    expect(existsSync(join(options.directory, 'runner.lock'))).toBe(false);
    expect(
      readdirSync(join(options.directory, 'observations'))
        .slice(0, 9)
        .map((name) => readFileSync(join(options.directory, 'observations', name), 'utf8')),
    ).toEqual(firstRecords);
    const published = readFileSync(join(options.directory, 'holdout/results.json'), 'utf8');
    expect(published).not.toContain(options.keys.gemini);
    expect(published).not.toContain(options.keys.jev);
    expect(published).not.toContain('keyFingerprints');
    for (const item of options.cases) {
      const paired = calls.filter((c) => c.id.endsWith(item.id));
      const gemini = JSON.parse(paired.find((c) => c.request.provider === 'gemini')!.request.body);
      const jev = JSON.parse(paired.find((c) => c.request.provider === 'jev')!.request.body);
      expect(JSON.parse(gemini.contents[0].parts[0].text)).toEqual(jev.state);
    }
    await expect(
      runCategoryEvaluation({ ...options, split: 'holdout', mode: 'resume' }, dependencies),
    ).rejects.toThrow('BUDGET_BINDING');
    expect(calls).toHaveLength(12);
  });
  it('supports a reference-only offline dry run without any provider transport invocation', async () => {
    const transport = vi.fn(fakeTransport());
    const options = setup(['reference']);
    options.keys = { gemini: '', jev: '' };
    const report = await runCategoryEvaluation(options, { transport });
    expect(report.observed).toBe(3);
    expect(report.eligibleForComparison).toBe(false);
    expect(json(join(options.directory, 'budget.json')).records).toEqual([]);
    // Factories can be constructed; the transport itself is never called.
    expect(report.selectors[0].costs.actualAttempts).toBe(0);
  });
  it('preserves a failed provider slot and every unattempted denominator, and refuses automatic resume', async () => {
    const options = setup();
    let calls = 0;
    const transport =
      (_d: string, id: string, budget: CategoryBudget, observed: TransportObservation): CategoryTransport =>
      async (request) => {
        calls++;
        budget.reserve(id, request.provider, request.body);
        budget.settle(id, null);
        Object.assign(observed, { httpStatus: 429, dispatched: true, networkMs: 10, exitCode: 0 });
        return { status: 429, body: { error: 'fictional test quota' } };
      };
    const report = await runCategoryEvaluation(options, { transport });
    expect(calls).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.integrity.halted).toBe(true);
    expect(report.scores.filter((s) => s.status === 'error')).toHaveLength(1);
    expect(report.scores.filter((s) => s.status === 'missing').length).toBeGreaterThan(0);
    expect(report.selectors.some((s) => new Number(s.costs.reservedUnknownUsd).valueOf() > 0)).toBe(true);
    await expect(runCategoryEvaluation({ ...options, mode: 'resume' }, { transport })).rejects.toThrow(
      'RUN_HALTED_REVIEW_REQUIRED',
    );
    expect(calls).toBe(1);
  });
  it('records an invalid response as an error even when tokens are known, and stops rather than retrying', async () => {
    const options = setup();
    const transport =
      (_d: string, id: string, budget: CategoryBudget, observed: TransportObservation): CategoryTransport =>
      async (request) => {
        budget.reserve(id, request.provider, request.body);
        budget.settle(id, { inputTokens: 100, outputTokens: 10 });
        observed.networkMs = 5;
        observed.httpStatus = 200;
        return { status: 200, body: { malformed: true } };
      };
    const report = await runCategoryEvaluation(options, { transport });
    expect(report.scores.filter((s) => s.status === 'error')).toHaveLength(1);
    expect(report.selectors.reduce((n, s) => n + s.costs.actualAttempts, 0)).toBe(1);
    expect(report.selectors.some((s) => Number(s.costs.reportedUsd) > 0)).toBe(true);
  });
  it('retains one HTTP503 failure then continues only to new cells; a valid paid attempt resets the provider streak', async () => {
    const options = setup();
    const seen = new Set<string>();
    let errors = 0;
    const transport =
      (
        _d: string,
        id: string,
        budget: CategoryBudget,
        observation: TransportObservation,
      ): CategoryTransport =>
      async (request) => {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        budget.reserve(id, request.provider, request.body);
        if (request.provider === 'gemini' && ++errors !== 2) {
          budget.settle(id, null);
          observation.httpStatus = 503;
          observation.exitCode = 22;
          return { status: 503, body: {} };
        }
        budget.settle(id, { inputTokens: 100, outputTokens: 10 });
        observation.httpStatus = 200;
        return { status: 200, body: modelBody(request) };
      };
    const report = await runCategoryEvaluation(options, { transport });
    expect(report.complete).toBe(true);
    expect(report.integrity.halted).toBe(false);
    expect(report.scores.filter((s) => s.status === 'error')).toHaveLength(2);
    const rows = readdirSync(join(options.directory, 'observations')).map((name) =>
      json(join(options.directory, 'observations', name)),
    );
    expect(
      rows
        .filter((r) => r.status === 'error')
        .every((r) => r.failureDisposition === 'continue_next_slot' && r.reservedUnknownUsd !== null),
    ).toBe(true);
    // A nonfatal saved error is valid history on holdout resume, never a retry.
    const next = await runCategoryEvaluation(
      { ...options, mode: 'resume', split: 'holdout' },
      { transport: fakeTransport() },
    );
    expect(next.complete).toBe(true);
  });
  it('halts at the second consecutive HTTP5xx for one provider, ignoring other-provider successes', async () => {
    const options = setup();
    let failures = 0;
    const transport =
      (
        _d: string,
        id: string,
        budget: CategoryBudget,
        observation: TransportObservation,
      ): CategoryTransport =>
      async (request) => {
        budget.reserve(id, request.provider, request.body);
        if (request.provider === 'gemini') {
          failures++;
          budget.settle(id, null);
          observation.httpStatus = 500;
          return { status: 500, body: {} };
        }
        budget.settle(id, { inputTokens: 100, outputTokens: 10 });
        observation.httpStatus = 200;
        return { status: 200, body: modelBody(request) };
      };
    const report = await runCategoryEvaluation(options, { transport });
    expect(failures).toBe(2);
    expect(report.complete).toBe(false);
    expect(report.integrity.halted).toBe(true);
    expect(report.scores.filter((s) => s.status === 'error')).toHaveLength(2);
    const last = readdirSync(join(options.directory, 'observations')).sort().at(-1)!;
    expect(json(join(options.directory, 'observations', last)).failureDisposition).toBe('halt');
  });
  it('clears the previous phase dispatcher marker before a new holdout request', async () => {
    const options = setup();
    await runCategoryEvaluation(options, { transport: fakeTransport() });
    expect(json(join(options.directory, 'finished.json')).split).toBe('development');
    const transport = (
      directory: string,
      id: string,
      budget: CategoryBudget,
      observation: TransportObservation,
    ): CategoryTransport => {
      expect(existsSync(join(directory, 'finished.json'))).toBe(false);
      return fakeTransport()(directory, id, budget, observation);
    };
    await runCategoryEvaluation({ ...options, mode: 'resume', split: 'holdout' }, { transport });
    expect(json(join(options.directory, 'finished.json')).split).toBe('holdout');
  });
  it('halts successful HTTP200 with absent usage or model metadata without dropping its reservation', async () => {
    for (const defect of ['usage', 'model']) {
      const options = setup(['gemini']);
      const transport =
        (
          _d: string,
          id: string,
          budget: CategoryBudget,
          observation: TransportObservation,
        ): CategoryTransport =>
        async (request) => {
          budget.reserve(id, request.provider, request.body);
          budget.settle(id, null);
          observation.httpStatus = 200;
          const body = modelBody(request) as Record<string, unknown>;
          delete body[defect === 'usage' ? 'usageMetadata' : 'modelVersion'];
          return { status: 200, body };
        };
      const report = await runCategoryEvaluation(options, { transport });
      expect(report.integrity.halted).toBe(true);
      const row = json(join(options.directory, 'observations/0000.json'));
      expect(row.errorCode).toBe(defect === 'usage' ? 'RUN_USAGE_UNVERIFIED' : 'RUN_MODEL_MISMATCH');
      expect(Number(row.reservedUnknownUsd)).toBeGreaterThan(0);
    }
  });
  it('waits for the original queue abort settlement after the selector25s deadline before releasing the lock', async () => {
    vi.useFakeTimers();
    const options = setup();
    let settled = false;
    const transport =
      (_d: string, id: string, budget: CategoryBudget): CategoryTransport =>
      (request) => {
        budget.reserve(id, request.provider, request.body);
        return new Promise((_resolve, reject) =>
          request.signal.addEventListener('abort', () =>
            setTimeout(() => {
              budget.settle(id, null);
              settled = true;
              reject(new Error('TRANSPORT_ABORTED'));
            }, 50),
          ),
        );
      };
    const pending = runCategoryEvaluation(options, { transport });
    await vi.advanceTimersByTimeAsync(25001);
    expect(settled).toBe(false);
    expect(existsSync(join(options.directory, 'budget.json.lock'))).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    const report = await pending;
    expect(settled).toBe(true);
    expect(report.integrity.halted).toBe(true);
    expect(json(join(options.directory, 'budget.json')).records[0].state).toBe('unknown');
    expect(existsSync(join(options.directory, 'budget.json.lock'))).toBe(false);
  });
  it('resumes only unstarted slots after an offline interruption and preserves prior bytes', async () => {
    const options = setup(['reference']);
    let emitted = 0;
    await expect(
      runCategoryEvaluation(options, {
        onRecorded: () => {
          if (++emitted === 1) throw new Error('synthetic process interruption');
        },
      }),
    ).rejects.toThrow('synthetic process interruption');
    const first = readFileSync(join(options.directory, 'observations/0000.json'), 'utf8');
    const report = await runCategoryEvaluation({ ...options, mode: 'resume' });
    expect(report.complete).toBe(true);
    expect(readFileSync(join(options.directory, 'observations/0000.json'), 'utf8')).toBe(first);
  });
  it('consumes a crash-started reservation as an interrupted error and never replays it', async () => {
    const options = setup();
    await runCategoryEvaluation(options, { transport: fakeTransport() });
    const manifest = json(join(options.directory, 'manifest.json'));
    const next = manifest.plan[9];
    writeFileSync(
      join(options.directory, 'started/0009.json'),
      JSON.stringify({
        slotId: next.id,
        manifestHash: hash(manifest),
        startedAt: '2026-10-31T00:00:00.000Z',
      }),
    );
    const budget = new CategoryBudget(
      join(options.directory, 'budget.json'),
      manifest.source.sourceHash,
      'resume',
    );
    if (next.selector !== 'reference')
      budget.reserve(
        next.id,
        next.selector,
        JSON.stringify(
          next.selector === 'gemini'
            ? { generationConfig: { maxOutputTokens: 256 } }
            : { model: CATEGORY_PRICES.jev.model, questions: { category: {} } },
        ),
      );
    budget.release();
    const transport = vi.fn(fakeTransport());
    const report = await runCategoryEvaluation(
      { ...options, mode: 'resume', split: 'holdout' },
      { transport },
    );
    expect(transport).not.toHaveBeenCalled();
    expect(report.observed).toBe(1);
    expect(report.integrity.halted).toBe(true);
    const row: CategoryRunRecord = json(join(options.directory, 'observations/0009.json'));
    expect(row.errorCode).toBe('RUN_INTERRUPTED_ATTEMPT');
    expect(row.latencyMs).toBeNull();
  });
  it('rejects changed key, source, private config or result bytes before another attempt', async () => {
    for (const mutation of ['key', 'source', 'config', 'outcome']) {
      const options = setup();
      await runCategoryEvaluation(options, { transport: fakeTransport() });
      if (mutation === 'source') writeFileSync(join(options.root, 'frozen.txt'), 'changed');
      if (mutation === 'config') writeFileSync(join(options.directory, 'private-config.json'), '{}');
      if (mutation === 'outcome') {
        const file = join(options.directory, 'observations/0000.json');
        const row = json(file);
        row.attempts = 1;
        writeFileSync(file, JSON.stringify(row));
      }
      const transport = vi.fn(fakeTransport());
      await expect(
        runCategoryEvaluation(
          {
            ...options,
            mode: 'resume',
            split: 'holdout',
            ...(mutation === 'key' ? { keys: { ...options.keys, gemini: 'different-key' } } : {}),
          },
          { transport },
        ),
      ).rejects.toThrow(/RUN_(FREEZE_MISMATCH|OUTCOME_BINDING)/);
      expect(transport).not.toHaveBeenCalled();
    }
  });
  it('does not overwrite an existing run or skip development', async () => {
    const options = setup(['reference']);
    mkdirSync(options.directory);
    await expect(runCategoryEvaluation(options)).rejects.toThrow();
    expect(existsSync(join(options.directory, 'budget.json'))).toBe(false);
  });
});
