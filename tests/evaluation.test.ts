import { describe, expect, it } from 'vitest';
import { evaluationCases, pair } from '../scripts/evaluation/cases';
import { parseEvaluationOptions } from '../scripts/evaluation/options';
import {
  percentile,
  scoreClarification,
  scoreEntry,
  scoreInsight,
  shouldStop,
} from '../scripts/evaluation/scoring';
import { Decimal, baseAmount } from '../shared/money';

const ids: Record<string, string> = {
  '5010': '10000000-0000-4000-8000-000000000001',
  '1010': '10000000-0000-4000-8000-000000000002',
  '1020': '10000000-0000-4000-8000-000000000003',
};
const codes = Object.fromEntries(Object.entries(ids).map(([code, id]) => [id, code]));
const expected = { action: 'READY' as const, date: '2026-03-15', lines: pair('5010', '1010', '2400') };
function proposal() {
  return {
    action: 'READY',
    entry: {
      date: expected.date,
      description: 'Rent',
      source: 'AI',
      counterparty: '',
      reference: '',
      lines: expected.lines.map(({ code, ...line }) => ({ ...line, accountId: ids[code], memo: '' })),
    },
  };
}

describe('Complete accounting proposal scoring', () => {
  it('accepts line reordering and equivalent decimal spellings', () => {
    const actual = proposal();
    actual.entry.lines.reverse();
    actual.entry.lines[0].credit = '2400.00';
    actual.entry.lines[0].exchangeRate = '1.000';
    expect(scoreEntry(actual, expected, codes)).toEqual({ passed: true, failures: [] });
  });
  it('rejects the previous scorer false positive of any positive expected credit', () => {
    const actual = proposal();
    actual.entry.lines[1].credit = '1';
    expect(scoreEntry(actual, expected, codes).passed).toBe(false);
  });
  it('rejects extra balanced lines even when expected lines are present', () => {
    const actual = proposal();
    actual.entry.lines.push(
      ...actual.entry.lines.map((line) => ({
        ...line,
        debit: line.debit === '0' ? '0' : '25',
        credit: line.credit === '0' ? '0' : '25',
      })),
    );
    expect(scoreEntry(actual, expected, codes).passed).toBe(false);
  });
  it('rejects a wrong date and a foreign account even if amounts match', () => {
    const actual = proposal();
    actual.entry.date = '2026-03-14';
    actual.entry.lines[0].accountId = '20000000-0000-4000-8000-000000000001';
    const result = scoreEntry(actual, expected, codes);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.startsWith('Date differs'))).toBe(true);
    expect(result.failures).toContain('Unknown or cross-organization account.');
  });
  it('rejects wrong exchange rates despite a balanced base total', () => {
    const fx = {
      action: 'READY' as const,
      date: expected.date,
      lines: [
        { code: '1020', debit: '100', credit: '0', exchangeRate: '1.10' },
        { code: '1010', debit: '0', credit: '110', exchangeRate: '1' },
      ],
    };
    const actual = proposal();
    actual.entry.lines = [
      { accountId: ids['1020'], debit: '100', credit: '0', exchangeRate: '1.20', memo: '' },
      { accountId: ids['1010'], debit: '0', credit: '120', exchangeRate: '1', memo: '' },
    ];
    expect(scoreEntry(actual, fx, codes).passed).toBe(false);
  });
  it('does not reward unnecessary clarification on an explicit valid entry', () => {
    expect(
      scoreEntry({ action: 'CLARIFY', entry: null, questions: ['Can you explain?'] }, expected, codes).passed,
    ).toBe(false);
  });
});

describe('Clarification and evidence scoring', () => {
  it('requires a question and no ready entry for clarification', () => {
    expect(
      scoreClarification({ action: 'CLARIFY', entry: null, questions: ['Which account paid?'] }, 'entry')
        .passed,
    ).toBe(true);
    expect(scoreClarification({ action: 'CLARIFY', entry: null, questions: ['  '] }, 'entry').passed).toBe(
      false,
    );
    expect(
      scoreClarification({ action: 'CLARIFY', entry: proposal().entry, questions: ['Confirm?'] }, 'entry')
        .passed,
    ).toBe(false);
  });
  it('requires the approved clarification tool for unsupported financial questions', () => {
    expect(
      scoreClarification(
        {
          query: { name: 'ask_clarification' },
          answer: 'Which recorded period should I show?',
          evidence: [],
        },
        'chat',
      ).passed,
    ).toBe(true);
    expect(scoreClarification({ answer: 'Possibly $100.', evidence: [] }, 'chat').passed).toBe(false);
  });
  const query = { tool: 'cash_position', args: { asOf: '2026-03-31' } };
  const expectedResult = {
    answer: 'Cash is $100.00.',
    evidence: {
      title: 'Cash',
      period: 'As of 2026-03-31',
      rows: [{ label: 'Bank', value: '$100.00', href: '/accounts?account=ours' }],
      href: '/reports?to=2026-03-31',
    },
  };
  const insight = () => ({
    query: { name: query.tool, args: { ...query.args } },
    answer: expectedResult.answer,
    evidence: [structuredClone(expectedResult.evidence)],
  });
  it('checks the full evidence and query, not an amount substring', () => {
    const actual = insight();
    expect(scoreInsight(actual, query, expectedResult).passed).toBe(true);
    actual.answer = 'Cash is $100.00, but the bank secretly owes $999.';
    expect(scoreInsight(actual, query, expectedResult).passed).toBe(false);
  });
  it('rejects wrong-period results even when their totals happen to match', () => {
    const actual = insight();
    actual.query.args.asOf = '2026-04-30';
    expect(scoreInsight(actual, query, expectedResult).passed).toBe(false);
  });
  it('rejects another organization evidence identity with the same amount', () => {
    const actual = insight();
    actual.evidence[0].rows[0].href = '/accounts?account=another-workspace';
    expect(scoreInsight(actual, query, expectedResult).passed).toBe(false);
  });
});

describe('Evaluation controls and fixtures', () => {
  it('defaults to a bounded smoke run and three holdout repetitions', () => {
    expect(parseEvaluationOptions([])).toMatchObject({
      suite: 'smoke',
      repeats: 1,
      maxAttempts: 8,
      maxTotalTokens: 32000,
    });
    expect(parseEvaluationOptions(['--suite', 'holdout'])).toMatchObject({
      suite: 'holdout',
      repeats: 3,
      maxAttempts: 96,
    });
  });
  it.each([
    ['--max-attempts', '0'],
    ['--max-attempts', '201'],
    ['--max-total-tokens', '-1'],
    ['--repeats', '1.5'],
    ['--suite', 'unknown'],
    ['--candidate', 'bad name'],
    ['--suite', 'smoke', '--suite', 'all'],
    ['--unknown', 'anything'],
  ])('rejects invalid or duplicated budget options: %j', (...args) => {
    expect(() => parseEvaluationOptions(args)).toThrow();
  });
  it('stops further calls on auth, quota, missing usage, request, and budget failures', () => {
    for (const code of [
      'AI_AUTH_ERROR',
      'AI_RATE_LIMIT',
      'AI_MODEL_UNAVAILABLE',
      'AI_REQUEST_REJECTED',
      'AI_USAGE_UNAVAILABLE',
      'AI_BUDGET_EXCEEDED',
    ])
      expect(shouldStop(code)).toBe(true);
    expect(shouldStop('AI_INVALID_RESPONSE', 502)).toBe(false);
    expect(shouldStop('UNKNOWN', 429)).toBe(true);
  });
  it('keeps 40 unique labeled cases with the specified development and reserved splits', () => {
    expect(evaluationCases).toHaveLength(40);
    expect(new Set(evaluationCases.map((c) => c.id)).size).toBe(40);
    for (const split of ['development', 'holdout']) {
      const rows = evaluationCases.filter((c) => c.split === split);
      expect(rows).toHaveLength(20);
      expect(
        Object.fromEntries(
          ['entry', 'insight', 'clarification', 'adversarial'].map((g) => [
            g,
            rows.filter((c) => c.group === g).length,
          ]),
        ),
      ).toEqual({ entry: 8, insight: 6, clarification: 4, adversarial: 2 });
    }
    for (const item of evaluationCases) {
      if ('action' in item.expected && item.expected.action === 'CLARIFY')
        expect(item.reviewRubric?.length, item.id).toBeGreaterThan(20);
      if ('action' in item.expected && item.expected.action === 'READY') {
        const total = item.expected.lines.reduce(
          (sum, line) =>
            sum
              .plus(baseAmount(line.debit, line.exchangeRate))
              .minus(baseAmount(line.credit, line.exchangeRate)),
          new Decimal(0),
        );
        expect(total.isZero(), item.id).toBe(true);
      }
    }
  });
  it('reports small-sample latency percentiles without inventing empty values', () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([100, 5, 20, 10], 0.5)).toBe(10);
    expect(percentile([100, 5, 20, 10], 0.95)).toBe(100);
  });
});
