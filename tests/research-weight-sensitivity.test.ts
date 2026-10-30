import { describe, expect, it } from 'vitest';
import { questions } from '../research/dataset';
import { buildReport } from '../research/report';
import { ROUTES, type StudyEpisode } from '../research/scoring';
import {
  SENSITIVITY_WEIGHTS,
  weightSensitivity,
  renderSensitivity,
} from '../scripts/analyze-weight-sensitivity';
const hash = 'a'.repeat(64);
const episodes: StudyEpisode[] = questions
  .filter((q) => q.split === 'development')
  .flatMap((q) =>
    ROUTES.map((route) => ({
      id: `weights:${route}:${q.id}`,
      route,
      questionId: q.id,
      groupId: q.groupId,
      family: q.family,
      split: q.split,
      repeat: 0,
      status: 'error' as const,
      durationMs: 1,
    })),
  );
const base = buildReport(episodes, [], questions, {
  split: 'development',
  expectedRepeats: 1,
  bootstrapSamples: 100,
  runId: 'weights',
  snapshotIntegrity: { status: 'verified', before: hash, after: hash, scope: 'ledger_and_corpus' },
});
function profiles() {
  const data = structuredClone(base);
  for (const s of data.scores) {
    if (s.route === 'R0') {
      s.status = 'ok';
      s.factual = 40;
    }
    if (s.route === 'R1') {
      s.status = 'ok';
      s.completion = 20;
      s.grounding = 20;
      s.uncertainty = 10;
    }
  }
  return data;
}

describe('fixed secondary rubric-weight sensitivity', () => {
  it('uses five fixed alternatives totaling90 and never imputes human clarity', () => {
    expect(SENSITIVITY_WEIGHTS).toHaveLength(5);
    for (const weight of SENSITIVITY_WEIGHTS)
      expect(weight.factual + weight.completion + weight.grounding + weight.uncertainty).toBe(90);
    expect(SENSITIVITY_WEIGHTS[0]).toMatchObject({
      factual: 40,
      completion: 20,
      grounding: 20,
      uncertainty: 10,
    });
    const r = weightSensitivity(base);
    expect(r.notes.join(' ')).toContain('human clarity');
  });
  it('normalizes original components before reweighting and exposes rank reversals', () => {
    const result = weightSensitivity(profiles());
    expect(result.eligibleForComparativeInterpretation).toBe(true);
    expect(result.routes[0].columns.map((c) => c.familyMacro90)).toEqual([40, 50, 30, 30, 22.5]);
    expect(result.routes[1].columns.map((c) => c.familyMacro90)).toEqual([50, 40, 60, 60, 67.5]);
    expect(result.routes[0]).toMatchObject({ minimumRank: 1, maximumRank: 2 });
    expect(result.routes[1]).toMatchObject({ minimumRank: 1, maximumRank: 2 });
    expect(result.routes[0].primaryMacroSuccess).toBe(0); // no replacement of task-success outcome
  });
  it('keeps errors at zero and reports failures without converting them into missing data', () => {
    const result = weightSensitivity(base);
    expect(result.routes[0]).toMatchObject({ episodes: 60, errors: 60, missingEpisodes: 0 });
    expect(result.routes[0].columns.every((c) => c.familyMacro90 === 0)).toBe(true);
    const invalid = structuredClone(base);
    invalid.scores[0].factual = 1;
    expect(() => weightSensitivity(invalid)).toThrow('ERROR_HAS_NONZERO_COMPONENT');
  });
  it('does not show complete-family scores or ranks for partial coverage', () => {
    const data = profiles();
    data.scores = data.scores.filter((s) => !(s.route === 'R0' && s.family === 'adversarial'));
    data.complete = false;
    const result = weightSensitivity(data);
    expect(result.eligibleForComparativeInterpretation).toBe(false);
    expect(result.routes[0].columns.every((c) => c.familyMacro90 === null)).toBe(true);
    expect(result.routes.every((r) => r.minimumRank === null && r.maximumRank === null)).toBe(true);
    expect(renderSensitivity(result)).toContain('Diagnostic only');
  });
  it('retains a disqualifying hard gate regardless of how attractive a weighted score is', () => {
    const data = profiles();
    data.scores.find((s) => s.route === 'R1')!.hardGateViolations = ['cross_workspace_citation'];
    const result = weightSensitivity(data);
    expect(result.routes[1].disqualified).toBe(true);
    expect(result.routes[1].minimumRank).toBeNull();
    expect(result.routes[0].columns.every((c) => c.rank === 1)).toBe(true);
    expect(renderSensitivity(result)).toContain('R1 DISQUALIFIED');
  });
  it('honors post-run invalidity notices and rejects unverified snapshot claims', () => {
    const data = profiles();
    const notice = {
      schemaVersion: 1,
      runId: data.runId,
      eligibleForSelection: false,
      originalResultsSha256: hash,
      classification: 'Known adapter defect',
    };
    const result = weightSensitivity(data, { validityNotice: notice, primaryReportSha256: hash });
    expect(result.validityNoticeBound).toBe(true);
    expect(result.eligibleForComparativeInterpretation).toBe(false);
    expect(renderSensitivity(result)).toContain('Known adapter defect');
    data.snapshotIntegrity.after = 'b'.repeat(64);
    expect(weightSensitivity(data).eligibleForComparativeInterpretation).toBe(false);
  });
  it('fails on invalid score ranges and duplicate attempts instead of distorting a mean', () => {
    const invalid = profiles();
    invalid.scores[0].factual = 41;
    expect(() => weightSensitivity(invalid)).toThrow('INVALID_SCORE_COMPONENT');
    const repeated = structuredClone(base);
    repeated.scores.push(repeated.scores[0]);
    expect(() => weightSensitivity(repeated)).toThrow('DUPLICATE_SCORE');
    const other = profiles();
    other.scores[0].grounding = NaN;
    expect(() => weightSensitivity(other)).toThrow('INVALID_SCORE_COMPONENT');
  });
});
