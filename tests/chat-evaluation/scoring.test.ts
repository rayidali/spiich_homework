import { describe, expect, it } from 'vitest';
import { scoreCase, sameScope, type Execution } from '../../scripts/chat-evaluation/scoring';
import { assertReplayDatabase } from '../../scripts/chat-evaluation/replay';
import type { EvaluationCase } from '../../scripts/chat-evaluation/types';
const scope = {
  from: '2026-04-01',
  to: '2026-04-30',
  asOf: null,
  status: 'POSTED',
  accountCodes: ['5020'],
  counterparty: { mode: 'exact', value: 'Example vendor' },
};
const testCase: EvaluationCase = {
  id: 'synthetic',
  split: 'development',
  family: 'combined',
  messages: [{ role: 'user', content: 'A synthetic unit-test question.' }],
  commonCapability: false,
  expected: {
    behavior: 'answer',
    answerableFromRecordedDataAndExplicitAssumptions: true,
    facts: [{ metric: 'net_expense', value: '25.00', unit: 'USD', scope }],
    requiredScope: {},
    clarificationTopics: [],
    formulas: [],
    notes: '',
  },
};
const call = { name: 'financial_analysis', args: { queries: [] } };
function execution(): Execution {
  return {
    facts: [{ ...testCase.expected.facts[0], scope: { ...scope }, proof: { database: true } }],
    answer: 'Recorded value',
    truncated: false,
  };
}
describe('semantic/actual-fact scoring (offline)', () => {
  it('accepts exact numeric evidence with equivalent decimal spelling', () => {
    const e = execution();
    e.facts[0].value = '25';
    expect(scoreCase(testCase, call, e).outcome).toBe('pass');
  });
  it('rejects the correct number reached by dropping the vendor, shifting dates or using draft/native values', () => {
    for (const change of [
      { counterparty: { mode: 'any', value: '' } },
      { from: '2026-01-01' },
      { status: 'DRAFT' },
      { currencyMode: 'native' },
      { descriptionSearch: 'unrequested' },
      { cooccurringAccountCodes: ['1010'] },
    ]) {
      const e = execution();
      e.facts[0].scope = { ...scope, ...change };
      expect(scoreCase(testCase, call, e).outcome).toBe('fail');
    }
  });
  it('does not accept contains search as exact identity or flow dates as a point-in-time balance', () => {
    expect(sameScope(scope, { ...scope, counterparty: { mode: 'contains', value: 'Example vendor' } })).toBe(
      false,
    );
    expect(
      sameScope(
        { from: null, to: null, asOf: '2026-04-30', status: 'POSTED' },
        { from: '2026-04-01', to: '2026-04-30', asOf: null, status: 'POSTED' },
      ),
    ).toBe(false);
  });
  it('checks denominator and both comparison periods independently of amount', () => {
    expect(sameScope({ ...scope, denominator: 3 }, { ...scope, denominator: 2 })).toBe(false);
    expect(
      sameScope(
        { ...scope, previousFrom: '2026-03-01', previousTo: '2026-03-31' },
        { ...scope, previousFrom: '2026-02-01', previousTo: '2026-02-28' },
      ),
    ).toBe(false);
  });
  it('allows deliberate top-N truncation only when the oracle requests that exact limit and ordering', () => {
    const c = structuredClone(testCase);
    c.expected.requiredScope = { limit: 1, order: 'value_desc' };
    const e = execution();
    e.truncated = true;
    e.facts[0].scope = { ...scope, limit: 1, order: 'value_desc' };
    expect(scoreCase(c, call, e).outcome).toBe('pass');
    expect(scoreCase(testCase, call, e).outcome).toBe('fail');
  });
  it('scores honest unsupported answers to data-answerable questions as coverage misses', () => {
    expect(
      scoreCase(
        testCase,
        { name: 'request_details', args: {} },
        {
          facts: [],
          answer: 'Unsupported',
          truncated: false,
          clarification: { reason: 'unsupported_query', accountCodes: [], limitation: 'none' },
        },
      ),
    ).toMatchObject({ outcome: 'fail', safeDeferral: true, reason: 'ANSWERABLE_COVERAGE_MISS' });
  });
  it('does not treat any clarification as the right clarification or auto-grade free text', () => {
    const c = structuredClone(testCase);
    c.expected.behavior = 'clarify';
    c.expected.facts = [];
    c.expected.clarificationTopics = ['reporting period'];
    const e: Execution = {
      facts: [],
      answer: 'Which assumptions?',
      truncated: false,
      clarification: { reason: 'missing_assumption', accountCodes: [], limitation: 'none' },
    };
    expect(scoreCase(c, { name: 'request_details', args: {} }, e).outcome).toBe('fail');
    expect(scoreCase(c, { name: 'ask_clarification', args: {} }, e).outcome).toBe('needs_review');
  });
  it('fails extra result rows and retains execution failure', () => {
    const e = execution();
    e.facts.push({ ...e.facts[0] });
    expect(scoreCase(testCase, call, e).outcome).toBe('fail');
    expect(scoreCase(testCase, call, { ...e, errorCode: 'SQL_ERROR' }).reason).toBe('NO_VALID_EXECUTION');
  });
  it('refuses hosted, owner-runtime and non-CI fixture seeding', () => {
    const runtime = 'postgres://spiich_app:p@127.0.0.1:5432/spiich',
      owner = 'postgres://spiich:p@127.0.0.1:5432/spiich',
      env = { GITHUB_ACTIONS: 'true', NODE_ENV: 'test' };
    expect(() => assertReplayDatabase(runtime, owner, env)).not.toThrow();
    expect(() => assertReplayDatabase(runtime, owner, {})).toThrow();
    expect(() => assertReplayDatabase(owner, owner, env)).toThrow();
    expect(() =>
      assertReplayDatabase(runtime.replace('127.0.0.1', 'production.neon.tech'), owner, env),
    ).toThrow();
  });
});
