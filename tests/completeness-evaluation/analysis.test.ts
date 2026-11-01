import { describe, expect, it } from 'vitest';
import {
  analyzeCompleteness,
  exactPairedImprovement,
  renderCompletenessJson,
  renderCompletenessMarkdown,
  renderCompletenessSvg,
  wilsonInterval,
  type CompletenessAnalysisInput,
} from '../../scripts/completeness-evaluation/analysis';
import type { CompletenessRoute, CompletenessScore } from '../../scripts/completeness-evaluation/types';

const routes = ['composable', 'adaptive', 'complete'] as const;
const families = ['common', 'discovery', 'arithmetic', 'boundary'];
function fixture(): CompletenessAnalysisInput {
  const cases = Array.from({ length: 16 }, (_, i) => ({
    id: `Q${String(i + 1).padStart(2, '0')}`,
    family: families[Math.floor(i / 4)],
  }));
  return {
    cases,
    observations: cases.flatMap((item) =>
      routes.map((route) => {
        const boundary = item.family === 'boundary',
          passed = route !== 'composable' || ['common', 'boundary'].includes(item.family);
        const score: CompletenessScore = {
          caseId: item.id,
          split: 'holdout',
          family: item.family,
          classification: passed ? 'structured-correct' : 'partial-answer',
          passed,
          reasons: [],
          requiredClaims: boundary ? 0 : 2,
          matchedClaims: boundary ? [] : passed ? ['first', 'second'] : ['first'],
          matchedTables: [],
          focusCorrect: true,
          primaryMatched: boundary ? [] : ['first'],
          verifiedExtraClaims: 0,
          unverifiableExtraClaims: 0,
          wrongFinancialClaims: [],
          hardBoundaryViolations: [],
          modelCompletionIgnored: true,
          wordingReview: 'not_model_judged',
        };
        return { caseId: item.id, route, score };
      }),
    ),
  };
}
function cell(input: CompletenessAnalysisInput, route: CompletenessRoute, index: number) {
  return input.observations.find((item) => item.route === route && item.caseId === input.cases[index].id)!;
}
function fail(input: CompletenessAnalysisInput, route: CompletenessRoute, index: number) {
  const item = cell(input, route, index);
  item.score.passed = false;
  item.score.classification = 'partial-answer';
  item.score.matchedClaims = [];
  return item;
}

describe('independent paired completeness analysis', () => {
  it('uses 16 paired questions, reports both qualifying candidates, and never picks a deployment winner', () => {
    const result = analyzeCompleteness(fixture());
    expect(result).toMatchObject({
      complete: true,
      plannedQuestions: 16,
      plannedExecutions: 48,
      observedExecutions: 48,
      eligibleCandidates: ['adaptive', 'complete'],
      deploymentAction: 'retain_composable_pending_separate_acceptance',
    });
    expect(result.routes.map((item) => item.passed)).toEqual([8, 16, 16]);
    for (const pair of result.comparisons)
      expect(pair).toMatchObject({
        pairedCases: 16,
        bothPass: 8,
        bothFail: 0,
        candidateOnly: 8,
        controlOnly: 0,
        netAdditionalCompleteAnswers: 8,
        pairedDifference: 0.5,
        exactOneSided: { p: 1 / 256, numerator: '1', denominator: '256' },
        holmAdjustedP: 1 / 128,
      });
    expect(result.routes[0].wilson95!.low).toBeCloseTo(0.2799956361);
    expect(result.routes[0].wilson95!.high).toBeCloseTo(0.7200043639);
  });

  it('computes exact directional tails, including zero discordances and the opposite direction', () => {
    expect(exactPairedImprovement(0, 0)).toEqual({ p: 1, numerator: '1', denominator: '1' });
    expect(exactPairedImprovement(6, 0).p).toBe(1 / 64);
    expect(exactPairedImprovement(5, 1).p).toBe(7 / 64);
    expect(exactPairedImprovement(0, 6).p).toBe(1);
    expect(() => exactPairedImprovement(17, 0)).toThrow('PAIR_COUNTS');
    expect(() => exactPairedImprovement(1.5, 0)).toThrow('PAIR_COUNTS');
  });

  it('applies Holm to both candidates even when the unadjusted result is below .05', () => {
    const input = fixture();
    for (const route of ['adaptive', 'complete'] as const) for (const i of [9, 10, 11]) fail(input, route, i);
    const result = analyzeCompleteness(input);
    expect(result.comparisons.map((item) => item.exactOneSided!.p)).toEqual([1 / 32, 1 / 32]);
    expect(result.comparisons.map((item) => item.holmAdjustedP)).toEqual([1 / 16, 1 / 16]);
    expect(result.eligibleCandidates).toEqual([]);
    expect(result.decisions.every((item) => item.failedGates.includes('holmImprovement'))).toBe(true);
  });

  it('uses monotone step-down adjusted p values in the original candidate order', () => {
    const input = fixture();
    for (const i of [10, 11]) fail(input, 'adaptive', i);
    const result = analyzeCompleteness(input);
    expect(result.comparisons[0]).toMatchObject({ candidate: 'adaptive', holmAdjustedP: 1 / 64 });
    expect(result.comparisons[1]).toMatchObject({ candidate: 'complete', holmAdjustedP: 1 / 128 });
  });

  it('withholds eligibility and inference on an incomplete run without turning absent cells into failures', () => {
    const input = fixture();
    input.observations = input.observations.filter(
      (item) => !(item.caseId === 'Q16' && item.route === 'complete'),
    );
    const result = analyzeCompleteness(input);
    expect(result).toMatchObject({
      complete: false,
      observedExecutions: 47,
      missing: [{ caseId: 'Q16', route: 'complete' }],
      eligibleCandidates: [],
    });
    expect(result.routes[2]).toMatchObject({ observed: 15, passed: 15, passRate: null, wilson95: null });
    expect(
      result.comparisons.every((item) => item.exactOneSided === null && item.holmAdjustedP === null),
    ).toBe(true);
  });

  it('handles zero observed executions as incomplete, with no invented cost or coverage', () => {
    const input = fixture();
    input.observations = [];
    const result = analyzeCompleteness(input);
    expect(result.missing).toHaveLength(48);
    expect(
      result.routes.every(
        (item) =>
          item.passRate === null && item.claimCoverage.fraction === null && item.operational.cost === null,
      ),
    ).toBe(true);
    expect(result.eligibleCandidates).toEqual([]);
  });

  it.each([
    'duplicate-execution',
    'duplicate-case',
    'development',
    'wrong-question',
    'wrong-family',
    'unknown-case',
  ])('rejects %s rather than inflating or contaminating the paired sample', (mutation) => {
    const input = fixture();
    if (mutation === 'duplicate-execution') input.observations.push(structuredClone(input.observations[0]));
    if (mutation === 'duplicate-case') input.cases[1].id = input.cases[0].id;
    if (mutation === 'development') input.observations[0].score.split = 'development';
    if (mutation === 'wrong-question') input.observations[0].score.caseId = 'Q02';
    if (mutation === 'wrong-family') input.observations[0].score.family = 'boundary';
    if (mutation === 'unknown-case') input.observations[0].caseId = 'NEW';
    expect(() => analyzeCompleteness(input)).toThrow('COMPLETENESS_ANALYSIS_');
  });

  it('rejects repeated correlated reruns rather than treating 96 observations as independent evidence', () => {
    const input = fixture();
    input.observations.push(...structuredClone(input.observations));
    expect(() => analyzeCompleteness(input)).toThrow('DUPLICATE_CELL');
  });

  it('enforces the four-family case design before inspecting route scores', () => {
    const input = fixture();
    input.cases[0].family = 'discovery';
    expect(() => analyzeCompleteness(input)).toThrow('FAMILY_COUNT');
  });

  it.each(['wrong-financial', 'hard-boundary', 'common-regression', 'boundary-failure'])(
    'keeps the %s safety gate independent of a large paired gain',
    (mutation) => {
      const input = fixture();
      const item = fail(
        input,
        'complete',
        mutation === 'common-regression' ? 0 : mutation === 'boundary-failure' ? 12 : 4,
      );
      if (mutation === 'wrong-financial') item.score.wrongFinancialClaims.push('unrequested_wrong_value');
      if (mutation === 'hard-boundary') item.score.hardBoundaryViolations.push('cross_workspace');
      const result = analyzeCompleteness(input),
        decision = result.decisions.find((d) => d.candidate === 'complete')!;
      expect(result.comparisons[1].netAdditionalCompleteAnswers).toBeGreaterThanOrEqual(6);
      expect(decision.eligibleForSeparateAcceptance).toBe(false);
      expect(result.eligibleCandidates).toEqual(['adaptive']);
      const gate = {
        'wrong-financial': 'zeroWrongFinancialClaims',
        'hard-boundary': 'zeroHardBoundaryViolations',
        'common-regression': 'noCommonRegressions',
        'boundary-failure': 'allBoundaryCasesPass',
      }[mutation];
      expect(decision.failedGates).toContain(gate);
    },
  );

  it('separates missing requested claims and wrong focus from demonstrated wrong money', () => {
    const input = fixture(),
      item = fail(input, 'complete', 4);
    item.score.focusCorrect = false;
    item.score.matchedClaims = ['first'];
    const result = analyzeCompleteness(input),
      route = result.routes[2];
    expect(route).toMatchObject({
      passed: 15,
      focusCorrect: 15,
      wrongFinancialClaims: 0,
      claimCoverage: { required: 24, matched: 23 },
    });
    expect(route.families.find((f) => f.family === 'boundary')!.claimCoverage).toEqual({
      required: 0,
      matched: 0,
      fraction: null,
    });
  });

  it('rejects contradictory passes and duplicate claim counts instead of trusting model completion', () => {
    for (const mutate of [
      (score: CompletenessScore) => {
        score.wrongFinancialClaims = ['bad'];
      },
      (score: CompletenessScore) => {
        score.focusCorrect = false;
      },
      (score: CompletenessScore) => {
        score.matchedClaims = ['first'];
      },
      (score: CompletenessScore) => {
        score.matchedClaims = ['first', 'first'];
      },
      (score: CompletenessScore) => {
        score.unverifiableExtraClaims = 1;
      },
    ]) {
      const input = fixture();
      mutate(cell(input, 'complete', 0).score);
      expect(() => analyzeCompleteness(input)).toThrow('COMPLETENESS_ANALYSIS_');
    }
  });

  it('sums known cost and unknown reservations exactly once and reports incomplete operational coverage', () => {
    const input = fixture();
    for (const item of input.observations) {
      item.attempts = item.route === 'composable' ? 2 : 3;
      item.knownUsd = '0.0000011';
      item.unknownReservedUsd = item.caseId === 'Q01' ? '0.02' : '0';
      item.durationMs = Number(item.caseId.slice(1)) * 100;
    }
    const result = analyzeCompleteness(input);
    expect(result.routes.map((r) => r.operational.attempts!.total)).toEqual([32, 48, 48]);
    expect(result.routes[2].operational).toMatchObject({
      cost: {
        reportedExecutions: 16,
        knownUsd: '0.0000176',
        unknownReservedUsd: '0.02',
        chargedUsd: '0.0200176',
        chargedUsdPerCompleteAnswer: '0.0012511',
      },
      duration: { reportedExecutions: 16, medianMs: 850, p95Ms: 1600 },
    });
    delete input.observations[0].knownUsd;
    delete input.observations[0].unknownReservedUsd;
    expect(analyzeCompleteness(input).routes[0].operational.cost).toMatchObject({
      reportedExecutions: 15,
      chargedUsdPerCompleteAnswer: null,
    });
  });

  it.each(['negative', 'missing-reserve', 'exponent', 'too-many-attempts', 'nan-duration'])(
    'rejects invalid operational metadata %s',
    (kind) => {
      const input = fixture(),
        item = input.observations[0];
      item.knownUsd = '0';
      item.unknownReservedUsd = '0';
      if (kind === 'negative') item.knownUsd = '-1';
      if (kind === 'missing-reserve') delete item.unknownReservedUsd;
      if (kind === 'exponent') item.knownUsd = '1e-5';
      if (kind === 'too-many-attempts') item.attempts = 3;
      if (kind === 'nan-duration') item.durationMs = NaN;
      expect(() => analyzeCompleteness(input)).toThrow('COMPLETENESS_ANALYSIS_');
    },
  );

  it('is pure and binds the same data independently of input ordering', () => {
    const input = fixture(),
      before = structuredClone(input),
      result = analyzeCompleteness(input);
    expect(input).toEqual(before);
    input.cases.reverse();
    input.observations.reverse();
    expect(analyzeCompleteness(input)).toEqual(result);
  });

  it('renders standalone JSON, Markdown and SVG without invented operational measurements', () => {
    const result = analyzeCompleteness(fixture()),
      md = renderCompletenessMarkdown(result),
      svg = renderCompletenessSvg(result);
    expect(JSON.parse(renderCompletenessJson(result))).toEqual(result);
    expect(md).toContain('eligible for separate acceptance');
    expect(md).toContain('Holm-adjusted p');
    expect(md).toContain('unavailable');
    expect(md).toContain('not 48 independent accuracy samples');
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(result.inputSha256);
    expect(svg).toContain('16/16 (16 observed)');
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(0, 16)!.low).toBe(0);
    expect(wilsonInterval(16, 16)!.high).toBe(1);
  });
});
