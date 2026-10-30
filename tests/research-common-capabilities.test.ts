import { describe, expect, it } from 'vitest';
import mappingSource from '../docs/research/common-capabilities-v1.json';
import { questions } from '../research/dataset';
import { buildReport } from '../research/report';
import { ROUTES, type StudyEpisode } from '../research/scoring';
import {
  analyzeCommonCapabilities,
  renderCommonMarkdown,
  renderCommonSvg,
  type CommonMapping,
  type CommonAmendment,
  type CommonValidityNotice,
} from '../scripts/analyze-common-capabilities';

const mapping: CommonMapping = mappingSource;
const digest = 'a'.repeat(64);
const changed = 'b'.repeat(64);
const raw: StudyEpisode[] = questions
  .filter((q) => q.split === 'holdout')
  .flatMap((q) =>
    ROUTES.flatMap((route) =>
      Array.from({ length: 3 }, (_, repeat) => ({
        id: `common:${route}:${q.id}:${repeat}`,
        route,
        questionId: q.id,
        groupId: q.groupId,
        family: q.family,
        split: q.split,
        repeat,
        status: 'error' as const,
        durationMs: 10,
        error: 'TEST_PROVIDER_ERROR',
      })),
    ),
  );
const primary = buildReport(raw, [], questions, {
  split: 'holdout',
  expectedRepeats: 3,
  bootstrapSamples: 100,
  runId: 'common',
  snapshotIntegrity: { status: 'verified', before: digest, after: digest, scope: 'ledger_and_corpus' },
});
const input = () => ({
  mapping: structuredClone(mapping),
  primary: structuredClone(primary),
  episodes: structuredClone(raw),
  questions,
  comparisonSourceHashes: { ...mapping.sourceSha256 },
  currentQuestionFileSha256: mapping.sourceSha256['research/fixtures/questions.json'],
  bootstrapSamples: 100,
});
const amendment: CommonAmendment = {
  schemaVersion: 1,
  mappingId: mapping.id,
  file: 'research/routes.ts',
  definitionSha256: mapping.sourceSha256['research/routes.ts'],
  comparisonSha256: changed,
  reviewedAt: '2026-10-30T23:00:00Z',
  rationale: 'Reviewed generic planner changes; the original R0 dispatch and capabilities remain unchanged.',
};

describe('static common-capability postprocessor', () => {
  it('applies a superseding validity notice even when all mechanical gates pass', () => {
    const data = input();
    expect(analyzeCommonCapabilities(data).eligibleForConclusion).toBe(true);
    const validityNotice: CommonValidityNotice = {
      schemaVersion: 1,
      runId: data.primary.runId,
      eligibleForSelection: false,
      originalResultsSha256: digest,
      classification: 'Known control adapter defect',
      issues: [
        {
          code: 'CONTROL_EVIDENCE_ADAPTER',
          detail: 'Valid original proposals lacked evidence records in the adapter.',
        },
      ],
    };
    const result = analyzeCommonCapabilities({ ...data, validityNotice, primaryReportSha256: digest });
    expect(result.validityNoticeBound).toBe(true);
    expect(result.eligibleForConclusion).toBe(false);
    expect(result.eligibleRoutes).toEqual([]);
    expect(renderCommonMarkdown(result)).toContain('CONTROL_EVIDENCE_ADAPTER');
  });

  it('never accepts an unbound or affirmative notice as a shortcut around other gates', () => {
    const data = input();
    const validityNotice: CommonValidityNotice = {
      schemaVersion: 1,
      runId: data.primary.runId,
      eligibleForSelection: true,
      originalResultsSha256: digest,
    };
    const unbound = analyzeCommonCapabilities({ ...data, validityNotice, primaryReportSha256: changed });
    expect(unbound.validityNoticeBound).toBe(false);
    expect(unbound.eligibleForConclusion).toBe(false);
    data.primary.complete = false;
    const bound = analyzeCommonCapabilities({ ...data, validityNotice, primaryReportSha256: digest });
    expect(bound.validityNoticeAllowsSelection).toBe(true);
    expect(bound.eligibleForConclusion).toBe(false);
  });
  it('retains all provider failures in the fixed 12-question/6-group held-out subset', () => {
    const result = analyzeCommonCapabilities(input());
    expect(result.selectedQuestionIds).toHaveLength(12);
    expect(result.selectedGroupIds).toHaveLength(6);
    expect(result.eligibleForConclusion).toBe(true); // complete measurement of zero successes
    expect(result.routes[0]).toMatchObject({
      episodes: 36,
      fullSplitPlannedEpisodes: 36,
      errors: 36,
      successes: 0,
      microSuccessRate: 0,
      observedFamilyMacro: 0,
      observedFamilies: ['financial', 'entry'],
    });
    expect(result.routes[0].macroSuccessRate).toBeUndefined();
    expect(result.comparisons.find((c) => c.route === 'R1' && c.control === 'R0')!.effect).toMatchObject({
      pairedEpisodes: 36,
      groups: 6,
    });
    expect(result.routes[0].failures).toContainEqual({ kind: 'episode_error', episodes: 36 });
  });

  it('counts a genuinely missing attempt separately and invalidates conclusions', () => {
    const data = input();
    const id = data.primary.scores.find((s) => s.route === 'R1' && s.questionId === 'financial-06-1')!.id;
    data.episodes = data.episodes.filter((e) => e.id !== id);
    data.primary.scores = data.primary.scores.filter((s) => s.id !== id);
    data.primary.complete = false;
    const result = analyzeCommonCapabilities(data);
    expect(result.eligibleForConclusion).toBe(false);
    expect(result.routes[1]).toMatchObject({
      episodes: 35,
      errors: 35,
      missingPlannedEpisodes: 1,
      missingFullSplitEpisodes: 1,
    });
    expect(result.comparisons.find((c) => c.route === 'R1' && c.control === 'R0')!.effect).toMatchObject({
      pairedEpisodes: 35,
      unpairedControl: 1,
    });
  });

  it('separates micro success from observed-family macro when measured coverage is unequal', () => {
    const data = input();
    const retained = (row: { route: string; family: string; questionId: string }) =>
      row.route !== 'R0' || row.family !== 'financial' || row.questionId.startsWith('financial-06');
    data.episodes = data.episodes.filter(retained);
    data.primary.scores = data.primary.scores.filter(retained);
    data.primary.complete = false;
    for (const score of data.primary.scores) {
      if (score.route === 'R0' && score.family === 'financial') {
        score.status = 'ok';
        score.success = true;
        score.failures = [];
        data.episodes.find((row) => row.id === score.id)!.status = 'ok';
      }
    }
    const route = analyzeCommonCapabilities(data).routes[0];
    expect(route).toMatchObject({ episodes: 24, successes: 6, errors: 18 });
    expect(route.microSuccessRate).toBe(0.25);
    expect(route.observedFamilyMacro).toBe(0.5);
    expect(route.complete).toBe(false);
  });

  it('retains intentional blocks as unsuccessful non-error outcomes', () => {
    const data = input();
    const score = data.primary.scores.find(
      (row) => row.route === 'R0' && row.questionId === 'financial-06-1',
    )!;
    score.status = 'blocked';
    data.episodes.find((row) => row.id === score.id)!.status = 'blocked';
    const route = analyzeCommonCapabilities(data).routes[0];
    expect(route).toMatchObject({ episodes: 36, successes: 0, errors: 35, blocked: 1, microSuccessRate: 0 });
    expect(route.completedEpisodes).toBe(1);
    expect(route.conditionalSuccessRate).toBe(0);
  });

  it('separates unscheduled subgroup cases from missing cases in a completed narrow run', () => {
    const data = input();
    const ids = ['financial-06-1', 'financial-06-2'];
    data.episodes = data.episodes.filter((e) => ids.includes(e.questionId));
    data.primary = buildReport(data.episodes, [], questions, {
      split: 'holdout',
      expectedRepeats: 3,
      plannedQuestionIds: ids,
      bootstrapSamples: 100,
      snapshotIntegrity: { status: 'verified', before: digest, after: digest, scope: 'ledger_and_corpus' },
    });
    const result = analyzeCommonCapabilities(data);
    expect(result.primaryComplete).toBe(true);
    expect(result.fullSplitCoverage).toBe(false);
    expect(result.wholeBenchmarkCoverage).toBe(false);
    expect(result.eligibleForConclusion).toBe(false);
    expect(result.routes[0]).toMatchObject({
      episodes: 6,
      missingPlannedEpisodes: 0,
      unscheduledFullSplitEpisodes: 30,
      missingFullSplitEpisodes: 30,
    });
    expect(renderCommonMarkdown(result)).toContain('Diagnostic only');
  });

  it('does not hide a whole-route safety violation outside the common subgroup', () => {
    const data = input();
    const outside = data.primary.scores.find((s) => s.route === 'R2' && s.family === 'adversarial')!;
    outside.hardGateViolations = ['cross_workspace_citation'];
    const result = analyzeCommonCapabilities(data);
    expect(result.routes[2].disqualified).toBe(true);
    expect(result.routes[2].hardGateViolations).toContain('cross_workspace_citation');
    expect(result.eligibleRoutes).not.toContain('R2');
  });

  it('requires verified matching full-corpus fingerprints and the primary eligibility gate', () => {
    for (const override of [
      { status: 'unverified' as const },
      { after: changed },
      { scope: 'ledger' as const },
    ]) {
      const data = input();
      data.primary.snapshotIntegrity = { ...data.primary.snapshotIntegrity, ...override };
      expect(analyzeCommonCapabilities(data).eligibleForConclusion).toBe(false);
    }
    const data = input();
    data.primary.eligibleForConclusion = false;
    expect(analyzeCommonCapabilities(data).eligibleForConclusion).toBe(false);
  });

  it('makes unreviewed route-source drift diagnostic and binds an amendment to the exact hash pair', () => {
    const data = input();
    data.comparisonSourceHashes['research/routes.ts'] = changed;
    expect(analyzeCommonCapabilities(data)).toMatchObject({
      membershipSourcesValid: false,
      eligibleForConclusion: false,
    });
    const reviewed = analyzeCommonCapabilities({ ...data, amendment });
    expect(reviewed.membershipSourcesValid).toBe(true);
    expect(reviewed.sourceChecks.find((s) => s.file === 'research/routes.ts')!.status).toBe(
      'reviewed_amendment',
    );
    expect(
      analyzeCommonCapabilities({ ...data, amendment: { ...amendment, comparisonSha256: 'c'.repeat(64) } })
        .eligibleForConclusion,
    ).toBe(false);
  });

  it('never waives question or baseline changes through a route-only amendment', () => {
    for (const file of ['research/baseline.ts', 'research/fixtures/questions.json']) {
      const data = input();
      data.comparisonSourceHashes[file] = changed;
      expect(analyzeCommonCapabilities({ ...data, amendment }).eligibleForConclusion).toBe(false);
    }
    const data = input();
    data.currentQuestionFileSha256 = changed;
    expect(analyzeCommonCapabilities(data).questionMetadataSourceValid).toBe(false);
  });

  it('rejects stale primary snapshots, duplicate attempts, and metadata rewrites', () => {
    const stale = input();
    stale.episodes.pop();
    expect(() => analyzeCommonCapabilities(stale)).toThrow('OUT_OF_SYNC');
    const duplicate = input();
    duplicate.episodes.push(duplicate.episodes[0]);
    expect(() => analyzeCommonCapabilities(duplicate)).toThrow('DUPLICATE_RAW');
    const rewrite = input();
    rewrite.episodes[0].status = 'ok';
    expect(() => analyzeCommonCapabilities(rewrite)).toThrow('METADATA_MISMATCH');
    const impossible = input();
    impossible.primary.scores[0].success = true;
    expect(() => analyzeCommonCapabilities(impossible)).toThrow('INVALID_PRIMARY_OUTCOME');
  });

  it('rejects partial group selection and incomplete mapping coverage', () => {
    const data = input();
    data.mapping.selectedQuestionIds.pop();
    expect(() => analyzeCommonCapabilities(data)).toThrow('MEMBERSHIP_MISMATCH');
    const missing = input();
    missing.mapping.groups.pop();
    expect(() => analyzeCommonCapabilities(missing)).toThrow('INCOMPLETE_MAPPING_COVERAGE');
  });

  it('refuses raw outcomes that are outside the declared primary plan', () => {
    const data = input();
    data.episodes.push({
      ...data.episodes[0],
      id: 'unexpected',
      questionId: 'financial-01-1',
      split: 'development',
    });
    expect(() => analyzeCommonCapabilities(data)).toThrow('OUTSIDE_PRIMARY_PLAN');
  });

  it('renders an escaped standalone descriptive SVG and labels subset macro correctly', () => {
    const data = input();
    data.primary.runId = '<script>alert(1)</script>';
    data.primary.complete = false;
    const report = analyzeCommonCapabilities(data);
    const svg = renderCommonSvg(report);
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('DIAGNOSTIC / INELIGIBLE');
    expect(svg).not.toMatch(/href=|<image/);
    expect(renderCommonMarkdown(report)).toContain(
      'Observed-family macro is not the primary six-family score',
    );
  });
});
