import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { StudyReport } from '../research/report';
import {
  FAMILIES,
  ROUTES,
  ROUTE_LABELS,
  summarizeRoute,
  type EpisodeScore,
  type StudyRoute,
} from '../research/scoring';
import type { VerifierRecord } from '../research/validator-study';
import {
  analyzeStudyDecisions,
  decisionEligibility,
  paretoFront,
  renderDecisions,
  renderDecisionSvg,
  reviewerDecisions,
  runDecisionAnalysis,
  verifyReviewerLabels,
  TARGETED_COMPARISONS,
  type DecisionArtifacts,
  type ReviewerInputs,
} from '../scripts/analyze-study-decisions';

// Invented outcomes only. This test never imports the reference module or benchmark question file.
const hash = 'a'.repeat(64);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function fixture(
  rule: (
    route: StudyRoute,
    family: string,
    group: number,
    paraphrase: number,
    repeat: number,
  ) => boolean = () => false,
) {
  const questions = FAMILIES.flatMap((family) =>
    Array.from({ length: 5 }, (_, g) =>
      Array.from({ length: 2 }, (_, p) => ({
        id: `toy-${family}-${g}-${p}`,
        groupId: `toy-${family}-${g}`,
        family,
        split: 'holdout' as const,
        question: 'Invented question',
      })),
    ).flat(),
  );
  const scores: EpisodeScore[] = questions.flatMap((q) =>
    ROUTES.flatMap((route) =>
      Array.from({ length: 3 }, (_, repeat) => {
        const [, , g, p] = q.id.split('-');
        return {
          id: `toy:${route}:${q.id}:${repeat}`,
          route,
          questionId: q.id,
          groupId: q.groupId,
          family: q.family,
          split: q.split,
          repeat,
          status: 'ok' as const,
          success: rule(route, q.family, Number(g), Number(p), repeat),
          behaviorCorrect: true,
          factsRequired: 0,
          factsMatched: 0,
          factsEmitted: 0,
          unsupportedFacts: 0,
          missingDocumentIds: [],
          unresolvedCitationIds: [],
          missingAssumptionTags: [],
          missingClarificationTopicTags: [],
          ledgerGrounded: true,
          factual: 40,
          completion: 20,
          grounding: 20,
          uncertainty: 10,
          automatedScore: 90,
          automatedMaximum: 90 as const,
          humanClarityScore: null,
          overallScore100: null,
          narrativeReviewed: false as const,
          durationMs: 100,
          hardGateViolations: [],
          failures: [],
        };
      }),
    ),
  );
  const zeroCost = {
    calls: 0,
    inputTokensReported: 0,
    outputTokensReported: 0,
    unknownUsageCalls: 0,
    reportedUsageEquivalentUsd: 0,
    unknownUsageReservationUsd: 0,
    budgetChargedUsd: 0,
    budgetUsdPerEpisode: null,
    budgetUsdPerSuccess: null,
  };
  const primary: StudyReport = {
    schemaVersion: 1,
    generatedAt: '2026-10-31T03:00:00Z',
    runId: 'synthetic-only',
    sourceRevision: null,
    datasetVersion: 'toy',
    split: 'holdout',
    expectedRepeats: 3,
    complete: true,
    eligibleForConclusion: true,
    eligibleRoutes: [...ROUTES],
    snapshotIntegrity: { status: 'verified', before: hash, after: hash, scope: 'ledger_and_corpus' },
    questions,
    scores,
    routes: ROUTES.map((route) => {
      const summary = summarizeRoute(
        route,
        scores.filter((s) => s.route === route),
        100,
      );
      return {
        ...summary,
        label: ROUTE_LABELS[route],
        plannedEpisodes: 180,
        missingEpisodes: 0,
        complete: true,
        cost: {
          ...zeroCost,
          calls: 180,
          budgetChargedUsd: 0.018,
          budgetUsdPerEpisode: 0.0001,
          budgetUsdPerSuccess: summary.successes ? 0.018 / summary.successes : null,
        },
        failures: [],
      };
    }),
    comparisons: [],
    setup: zeroCost,
    unassignedRunUsage: zeroCost,
    limitations: [],
  };
  const files = { 'research/scoring.ts': hash, 'research/fixtures/snapshot-manifest.json': hash };
  const sourceHash = sha(JSON.stringify(files));
  const artifacts: DecisionArtifacts = {
    primaryReportSha256: hash,
    analysisScorerSha256: hash,
    analysisProtocolSha256: hash,
    sourceManifest: { hash: sourceHash, files },
    manifest: {
      runId: primary.runId,
      sourceHash,
      suite: 'holdout',
      split: 'holdout',
      repeats: 3,
      routeIds: ROUTES,
      questionIds: questions.map((q) => q.id),
      verifierThreshold: 0.8,
      protocolHash: hash,
      datasetHash: hash,
      createdAt: '2026-10-31T01:00:00Z',
    },
    freeze: {
      version: 'daybook-verifier-freeze-v1',
      frozenSourceHash: sourceHash,
      threshold: 0.8,
      referenceCasesHash: hash,
      calibrationHash: hash,
      boundAt: '2026-10-31T00:00:00Z',
    },
    before: { fingerprint: hash },
    after: { fingerprint: hash, unchanged: true, complete: true },
    commonAnalysis: { runId: primary.runId, eligibleForConclusion: true },
    commonProvenance: { runId: primary.runId, primaryReportSha256: hash },
  };
  return { primary, artifacts };
}
function reviewFixture(
  rule: (
    method: 'deterministic' | 'llm' | 'jev',
    flawed: boolean,
    index: number,
  ) => { decision: 'PASS' | 'BLOCK' | null; status: 'ok' | 'error' },
): ReviewerInputs {
  const labels = Array.from({ length: 8 }, (_, i) => ({
    caseId: `invented-${i}`,
    sourceGroupId: `source-${Math.floor(i / 2)}`,
    split: 'holdout' as const,
    expected: i % 2 ? ('BLOCK' as const) : ('PASS' as const),
  }));
  const records: VerifierRecord[] = labels.flatMap((l, i) =>
    (['deterministic', 'llm', 'jev'] as const).map((method) => ({
      ...rule(method, l.expected === 'BLOCK', i),
      id: `${method}:${l.caseId}`,
      caseId: l.caseId,
      sourceGroupId: l.sourceGroupId,
      split: l.split,
      method,
      inputHash: hash,
      threshold: method === 'jev' ? 0.8 : null,
      reasons: [],
      evidenceIds: [],
      durationMs: 1,
    })),
  );
  return { labels, records, threshold: 0.8, provenanceVerified: true };
}

describe('prespecified targeted component analysis', () => {
  it('fixes family mappings before outcomes, retaining all9 declared contrasts', () => {
    expect(TARGETED_COMPARISONS).toHaveLength(9);
    expect(
      TARGETED_COMPARISONS.filter((r) => ['H1', 'H6'].includes(r.hypothesis)).every(
        (r) => r.families.join(',') === 'financial,analytics',
      ),
    ).toBe(true);
    expect(
      TARGETED_COMPARISONS.filter((r) => /^H[2345]/.test(r.hypothesis)).every(
        (r) => r.families.join(',') === 'documents,scenario',
      ),
    ).toBe(true);
  });
  it('computes equal-family paired effects separately from whole benchmark and keeps errors in denominators', () => {
    const { primary, artifacts } = fixture(
      (route, family, g) => route === 'R1' && family === 'financial' && g < 3,
    );
    // Financial gain60%, analytics0%: equal-family target30%, six-family gain10%.
    const error = primary.scores.find((s) => s.route === 'R0' && s.family === 'financial')!;
    error.status = 'error';
    error.success = false;
    const before = JSON.stringify(primary);
    const r = analyzeStudyDecisions(primary, artifacts, undefined, 100).components[0];
    expect(r.targetedEffect?.estimate).toBeCloseTo(0.3);
    expect(r.overallEffect?.estimate).toBeCloseTo(0.1);
    expect(r.targetedEffect).toMatchObject({
      pairedEpisodes: 60,
      groups: 10,
      unpairedControl: 0,
      unpairedTreatment: 0,
    });
    expect(r.entryEffect?.estimate).toBe(0);
    expect(r.adversarialEffect?.estimate).toBe(0);
    expect(JSON.stringify(primary)).toBe(before);
  });
  it('uses scenario blocks rather than treating paraphrases and repeats as independent groups', () => {
    const { primary, artifacts } = fixture(
      (route, family, g) => route === 'R1' && ['financial', 'analytics'].includes(family) && g === 0,
    );
    const r = analyzeStudyDecisions(primary, artifacts, undefined, 100).components[0];
    expect(r.targetedEffect?.groups).toBe(10);
    expect(r.targetedEffect?.pairedEpisodes).toBe(60);
    expect(r.targetedEffect?.warnings.join(' ')).toContain('Five or fewer');
    expect(analyzeStudyDecisions(primary, artifacts, undefined, 100).components[0].targetedEffect).toEqual(
      r.targetedEffect,
    );
  });
  it('separates a >=5pp point gain from an interval spanning harm and useful benefit', () => {
    const { primary, artifacts } = fixture(
      (route, family, g) =>
        ['financial', 'analytics'].includes(family) &&
        ((route === 'R1' && g < 3) || (route === 'R0' && g >= 3)),
    );
    const r = analyzeStudyDecisions(primary, artifacts, undefined, 100).components[0];
    expect(r.pointBenefitMeetsTarget).toBe(true);
    expect(r.uncertainty.spansHarmAndUsefulBenefit).toBe(true);
    expect(r.status).toBe('inconclusive');
  });
  it('labels an observed gain below5pp, and a large stable gain only as candidate for further experiment', () => {
    const small = fixture(
      (route, family, g, p, repeat) =>
        route === 'R1' && family === 'financial' && g === 0 && p === 0 && repeat === 0,
    );
    const s = analyzeStudyDecisions(small.primary, small.artifacts, undefined, 100).components[0];
    expect(s.pointBenefitMeetsTarget).toBe(false);
    expect(s.status).toBe('below_practical_target');
    const large = fixture((route) => route === 'R1');
    const r = analyzeStudyDecisions(large.primary, large.artifacts, undefined, 100).components[0];
    expect(r.status).toBe('candidate_for_further_experiment');
    expect(r.targetedEffect?.warnings.join(' ')).toContain('Degenerate');
  });
  it('rejects incomplete, development and reduced matrices even when surviving pairs look favorable', () => {
    const { primary, artifacts } = fixture((route) => route === 'R1');
    primary.scores.pop();
    let r = analyzeStudyDecisions(primary, artifacts, undefined, 100);
    expect(r.eligibility.eligible).toBe(false);
    expect(r.components.every((c) => c.status === 'ineligible')).toBe(true);
    expect(r.eligibility.reasons).toContain('INCOMPLETE_ROUTE_MATRIX');
    const f = fixture();
    f.primary.split = 'development';
    expect(decisionEligibility(f.primary, f.artifacts).reasons).toContain('DEVELOPMENT_ONLY');
    f.primary.questions = f.primary.questions.slice(0, 12);
    expect(decisionEligibility(f.primary, f.artifacts).complete).toBe(false);
  });
  it('fails closed on missing/mismatched source, freeze, before/after, scorer and membership provenance', () => {
    for (const change of [
      (a: DecisionArtifacts) => {
        a.freeze = undefined;
      },
      (a: DecisionArtifacts) => {
        a.freeze!.frozenSourceHash = 'b'.repeat(64);
      },
      (a: DecisionArtifacts) => {
        a.sourceManifest!.hash = 'b'.repeat(64);
      },
      (a: DecisionArtifacts) => {
        a.before!.fingerprint = 'b'.repeat(64);
      },
      (a: DecisionArtifacts) => {
        a.after!.unchanged = false;
      },
      (a: DecisionArtifacts) => {
        a.analysisScorerSha256 = 'b'.repeat(64);
      },
      (a: DecisionArtifacts) => {
        a.analysisProtocolSha256 = 'b'.repeat(64);
      },
      (a: DecisionArtifacts) => {
        a.commonProvenance!.primaryReportSha256 = 'b'.repeat(64);
      },
      (a: DecisionArtifacts) => {
        a.freeze!.boundAt = '2027-01-01T00:00:00Z';
      },
    ]) {
      const f = fixture();
      expect(decisionEligibility(f.primary, f.artifacts).eligible).toBe(true);
      change(f.artifacts);
      expect(decisionEligibility(f.primary, f.artifacts).eligible).toBe(false);
    }
  });
  it('honors bound invalidity notices and disqualifies a hard gate even with perfect success', () => {
    const f = fixture((route) => route === 'R1');
    f.artifacts.validityNotice = {
      schemaVersion: 1,
      runId: f.primary.runId,
      originalResultsSha256: hash,
      eligibleForSelection: false,
      classification: 'Known invalid measurement',
    };
    expect(analyzeStudyDecisions(f.primary, f.artifacts, undefined, 100).components[0].status).toBe(
      'ineligible',
    );
    delete f.artifacts.validityNotice;
    f.primary.scores.find((s) => s.route === 'R1')!.hardGateViolations = ['cross_workspace_disclosure'];
    expect(
      analyzeStudyDecisions(f.primary, f.artifacts, undefined, 100).components[0].hardGateViolations,
    ).toEqual(['cross_workspace_disclosure']);
    expect(analyzeStudyDecisions(f.primary, f.artifacts, undefined, 100).components[0].status).toBe(
      'ineligible',
    );
  });
  it('rejects duplicates and mismatched pairing metadata', () => {
    const f = fixture();
    f.primary.scores.push(f.primary.scores[0]);
    expect(() => analyzeStudyDecisions(f.primary, f.artifacts, undefined, 100)).toThrow('DUPLICATE_SCORE');
    f.primary.scores.pop();
    f.primary.scores[0].groupId = 'different';
    expect(() => analyzeStudyDecisions(f.primary, f.artifacts, undefined, 100)).toThrow(
      'INVALID_SCORE_MEMBERSHIP',
    );
  });
  it('does not promote R7/R8 from end-to-end scores without separate reviewer evidence', () => {
    const f = fixture((route) => route === 'R7' || route === 'R8');
    const r = analyzeStudyDecisions(f.primary, f.artifacts, undefined, 100);
    expect(
      r.components.slice(-2).every((c) => c.status === 'inconclusive' && c.pointBenefitMeetsTarget === null),
    ).toBe(true);
  });
  it('reports point-estimate Pareto dominance without assigning unknown cost zero', () => {
    const f = fixture(() => true);
    f.primary.routes[1].cost.budgetUsdPerSuccess = 0.02;
    f.primary.routes[1].p95Ms = 200;
    f.primary.routes[2].cost.budgetUsdPerSuccess = null;
    const r = paretoFront(f.primary, ['documents', 'scenario'], true);
    expect(r.rows[1].dominatedBy).toContain('R0');
    expect(r.rows[2].comparable).toBe(false);
    expect(r.rows[2].dominatedBy).toEqual([]);
    expect(paretoFront(f.primary, FAMILIES, false).rows.every((r) => !r.comparable)).toBe(true);
  });
  it('renders self-contained exportable figures and an explicit diagnostic label', () => {
    const f = fixture();
    f.artifacts.freeze = undefined;
    const r = analyzeStudyDecisions(f.primary, f.artifacts, undefined, 100);
    expect(renderDecisions(r)).toContain('DIAGNOSTIC / INELIGIBLE');
    expect(renderDecisions(r)).toContain('Conditional paired flawed acceptance');
    const svg = renderDecisionSvg(r);
    expect(svg).toContain('<svg');
    expect(svg).toContain('No deployment recommendation');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('NaN');
  });
});

describe('paired reviewer decision analysis', () => {
  it('measures semantic benefit on successful identical inputs without inflating independent group count', () => {
    const f = reviewFixture((method, flawed) => ({
      status: 'ok',
      decision: method !== 'deterministic' && flawed ? 'BLOCK' : 'PASS',
    }));
    const r = reviewerDecisions(f, 100).comparisons[0];
    expect(r.operationalFalseAcceptanceDifference).toMatchObject({
      estimate: -1,
      low: -1,
      high: -1,
      pairedEpisodes: 4,
      groups: 4,
    });
    expect(r.additionalCorrectWithholding?.estimate).toBe(0);
    expect(r.conditionalPairedFalseAcceptanceDifference?.estimate).toBe(-1);
    expect(r.status).toBe('candidate_for_further_experiment');
    expect(r.counts).toMatchObject({ correctPairs: 4, flawedPairs: 4, reviewerErrors: 0 });
  });
  it('does not credit timeouts as semantic detection even when operational acceptance falls', () => {
    const f = reviewFixture((method, flawed) =>
      method !== 'deterministic' && flawed
        ? { status: 'error', decision: null }
        : { status: 'ok', decision: 'PASS' },
    );
    const r = reviewerDecisions(f, 100).comparisons[0];
    expect(r.operationalFalseAcceptanceDifference?.estimate).toBe(-1);
    expect(r.conditionalPairedFalseAcceptanceDifference).toBeNull();
    expect(r.pointCriterionMet).toBe(true);
    expect(r.status).toBe('inconclusive');
    expect(r.counts.reviewerErrors).toBe(4);
  });
  it('withholding correct candidates beyond5pp fails the separate criterion', () => {
    const f = reviewFixture((method) => ({
      status: 'ok',
      decision: method === 'deterministic' ? 'PASS' : 'BLOCK',
    }));
    const r = reviewerDecisions(f, 100).comparisons[0];
    expect(r.additionalCorrectWithholding?.estimate).toBe(1);
    expect(r.pointCriterionMet).toBe(false);
    expect(r.status).toBe('below_practical_target');
  });
  it('retains deterministic blocks in combined policy instead of claiming the reviewer repaired them', () => {
    const f = reviewFixture((method, flawed) => ({
      status: 'ok',
      decision: method === 'deterministic' && flawed ? 'BLOCK' : 'PASS',
    }));
    const r = reviewerDecisions(f, 100).comparisons[0];
    expect(r.operationalFalseAcceptanceDifference?.estimate).toBe(0);
    expect(r.reviewerOnlyFalseAcceptanceDifference?.estimate).toBe(1);
    expect(r.pointCriterionMet).toBe(false);
  });
  it('keeps absent outcomes missing, exposes conditional pair selection, and rejects changed inputs or thresholds', () => {
    const f = reviewFixture(() => ({ status: 'ok', decision: 'PASS' }));
    f.records.pop();
    expect(reviewerDecisions(f, 100).eligible).toBe(false);
    f.records[1].inputHash = 'b'.repeat(64);
    expect(() => reviewerDecisions(f, 100)).toThrow('INVALID_REVIEWER_MEMBERSHIP_OR_THRESHOLD');
    f.records[1].inputHash = hash;
    f.records.find((r) => r.method === 'jev')!.threshold = 0.9;
    expect(() => reviewerDecisions(f, 100)).toThrow('INVALID_REVIEWER_MEMBERSHIP_OR_THRESHOLD');
  });
  it('rejects duplicated reviewer pairs and leaves intervals unavailable with one group', () => {
    const f = reviewFixture(() => ({ status: 'ok', decision: 'PASS' }));
    f.records.push(f.records[0]);
    expect(() => reviewerDecisions(f, 100)).toThrow('DUPLICATE_REVIEWER_RECORD');
    f.records.pop();
    f.labels.forEach((l) => (l.sourceGroupId = 'only'));
    f.records.forEach((r) => (r.sourceGroupId = 'only'));
    expect(reviewerDecisions(f, 100).comparisons[0].additionalCorrectWithholding?.low).toBeNull();
  });
  it('checks a projected label file against the entire frozen evaluator reference, not just matching IDs', () => {
    const refs = [{ id: 'invented', sourceGroupId: 'toy', split: 'holdout', expected: 'PASS' }];
    const canonical = [{ expected: 'PASS', id: 'invented', sourceGroupId: 'toy', split: 'holdout' }];
    const digest = sha(JSON.stringify(canonical));
    const labels = [
      { caseId: 'invented', sourceGroupId: 'toy', split: 'holdout' as const, expected: 'PASS' as const },
    ];
    expect(verifyReviewerLabels(labels, refs, digest, 'holdout')).toBe(true);
    expect(verifyReviewerLabels([{ ...labels[0], expected: 'BLOCK' }], refs, digest, 'holdout')).toBe(false);
    expect(verifyReviewerLabels(labels, refs, hash, 'holdout')).toBe(false);
  });
});

describe('decision analysis artifact CLI', () => {
  it('writes hashes and standalone outputs from invented input, without requiring current held-out labels', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'daybook-decision-toy-'));
    try {
      const f = fixture();
      writeFileSync(join(directory, 'results.json'), JSON.stringify(f.primary));
      const result = await runDecisionAnalysis(directory);
      expect(result.eligible).toBe(false);
      const provenance = JSON.parse(readFileSync(join(result.output, 'analysis-provenance.json'), 'utf8'));
      expect(provenance).toMatchObject({
        runId: 'synthetic-only',
        primaryReportSha256: sha(JSON.stringify(f.primary)),
      });
      expect(provenance.analyzerSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(readFileSync(join(result.output, 'targeted-effects.svg'), 'utf8')).toContain('DIAGNOSTIC');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
