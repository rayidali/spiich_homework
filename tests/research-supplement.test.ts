import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeResearchSupplement,
  rankedDocumentMetrics,
  retrievalObservation,
  providerTimingObservation,
  validateStudyValidityNotice,
  renderSupplementHtml,
  writeResearchSupplement,
  type SupplementalEpisode,
} from '../scripts/analyze-research';
import type { ReferenceAnswer } from '../research/reference';

function reference(documents = ['a', 'b']): ReferenceAnswer {
  return {
    behavior: 'ANSWER',
    facts: [{ key: 'fee', value: '10.00', unit: 'USD' }],
    evidenceIds: documents,
    requiredDocumentIds: documents,
    supportingEntryIds: [],
    requiresLedgerEvidence: false,
    requiredAssumptions: [],
    clarificationTopics: [],
    requiredAssumptionTags: [],
    clarificationTopicTags: [],
    summary: 'Fee is10USD.',
  };
}
function episode(id = 'one', changes: Partial<SupplementalEpisode> = {}): SupplementalEpisode {
  return {
    id,
    route: 'R4',
    questionId: 'q1',
    groupId: 'g1',
    family: 'documents',
    split: 'development',
    repeat: 0,
    status: 'ok',
    durationMs: 5,
    organizationId: 'org1',
    retrievedIds: ['a', 'b'],
    plan: { retrievalQuery: 'fee' },
    evidence: ['a', 'b'].map((id) => ({
      id,
      documentId: id,
      kind: 'document',
      organizationId: 'org1',
      text: 'Fee is10USD.',
    })),
    answer: {
      behavior: 'ANSWER',
      summary: 'Fee is10USD.',
      facts: [{ key: 'fee', value: '10.00', unit: 'USD', evidenceIds: ['a', 'b'] }],
      evidenceIds: ['a', 'b'],
      assumptions: [],
      clarificationTopics: [],
    },
    ...changes,
  };
}

describe('document retrieval metrics with explicit denominators', () => {
  it('computes known binary recall, reciprocal rank and discounted gain by actual position', () => {
    const result = rankedDocumentMetrics(['x', 'a', 'y', 'b'], ['a', 'b']);
    expect(result.recall).toBe(1);
    expect(result.reciprocalRank).toBe(0.5);
    expect(result.ndcg).toBeCloseTo((1 / Math.log2(3) + 1 / Math.log2(5)) / (1 + 1 / Math.log2(3)), 12);
    expect(rankedDocumentMetrics([], ['a'])).toEqual({ recall: 0, reciprocalRank: 0, ndcg: 0 });
    expect(rankedDocumentMetrics(['a'], [])).toEqual({ recall: null, reciprocalRank: null, ndcg: null });
  });

  it('does not give duplicates repeated credit or move a seventh-position hit into the first six', () => {
    const result = rankedDocumentMetrics(['a', 'a', 'a', 'a', 'a', 'a', 'b'], ['a', 'b', 'b']);
    expect(result.recall).toBe(0.5);
    expect(result.ndcg).toBeCloseTo(1 / (1 + 1 / Math.log2(3)), 12);
    expect(
      retrievalObservation(episode('one', { retrievedIds: ['a', 'a'] }), reference()).duplicateIds,
    ).toEqual(['a']);
  });

  it('keeps managed citation selection coverage but never treats citation order as search ranking', () => {
    const row = retrievalObservation(
      episode('managed', { route: 'R3', retrievedIds: ['b', 'a'] }),
      reference(),
    );
    expect(row.selectedDocumentRecallAt6).toBe(1);
    expect(row.recallAt6).toBeNull();
    expect(row.reciprocalRankAt6).toBeNull();
    expect(row.ndcgAt6).toBeNull();
    expect(row.rankMetricsUnavailableReason).toContain('not raw search rank');
    expect(row.releasedOutcomeHasAllRequiredDocuments).toBe(true);
  });

  it('distinguishes an empty completed search, a skipped search and an unknown error stage', () => {
    const completed = retrievalObservation(episode('empty', { retrievedIds: [], evidence: [] }), reference());
    expect(completed.stage).toBe('completed');
    expect(completed.recallAt6).toBe(0);
    const skipped = retrievalObservation(
      episode('skipped', { plan: { retrievalQuery: '' }, retrievedIds: [] }),
      reference(),
    );
    expect(skipped.stage).toBe('skipped');
    expect(skipped.recallAt6).toBeNull();
    const unknown = retrievalObservation(
      episode('error', {
        status: 'error',
        error: 'RESEARCH_HTTP_TIMEOUT',
        answer: undefined,
        retrievedIds: undefined,
        plan: undefined,
        evidence: undefined,
      }),
      reference(),
    );
    expect(unknown.stage).toBe('unknown');
    expect(unknown.missingRequiredDocumentIds).toBeNull();
    expect(unknown.recallAt6).toBeNull();
    expect(unknown.releasedOutcomeHasAllRequiredDocuments).toBe(false);
    expect(unknown.failures).toContain('operational:timeout_or_deadline');
  });

  it('separates conditional retrieval denominators from all-episode delivery including blocks/errors', () => {
    const rows = [
      episode('success'),
      episode('partial', { retrievedIds: ['a'], evidence: [episode().evidence![0]] }),
      episode('skipped', { plan: { retrievalQuery: '' }, retrievedIds: [], evidence: [] }),
      episode('error', {
        status: 'error',
        error: 'RATE_LIMIT',
        plan: undefined,
        retrievedIds: undefined,
        evidence: undefined,
        answer: undefined,
      }),
      episode('blocked', { status: 'blocked', validation: { valid: false, reasons: ['INVALID'] } }),
    ];
    const report = analyzeResearchSupplement(rows, () => reference());
    const route = report.routes.find((row) => row.route === 'R4')!;
    expect(route).toMatchObject({
      documentApplicable: 5,
      completedRetrievals: 3,
      rankedRetrievals: 3,
      skippedRetrievals: 1,
      unknownRetrievalStages: 1,
      endToEndRequiredDocumentAvailability: 1 / 5,
    });
    expect(route.conditionalRecallAt6).toBeCloseTo(2.5 / 3);
    expect(report.failures).toContainEqual({ category: 'gate:deterministic_rejection', episodes: 1 });
  });

  it('keeps unsupported routes and questions without document labels out of conditional retrieval metrics', () => {
    const report = analyzeResearchSupplement(
      [
        episode('control', { route: 'R0', retrievedIds: undefined, plan: undefined, evidence: [] }),
        episode('no-doc', { questionId: 'no-doc' }),
      ],
      (id) => reference(id === 'no-doc' ? [] : ['a', 'b']),
    );
    expect(report.routes.find((row) => row.route === 'R0')).toMatchObject({
      unsupportedRetrievals: 1,
      conditionalRecallAt6: null,
      endToEndRequiredDocumentAvailability: 0,
    });
    expect(report.routes.find((row) => row.route === 'R4')).toMatchObject({
      documentApplicable: 0,
      noDocumentLabel: 1,
      conditionalRecallAt6: null,
      endToEndRequiredDocumentAvailability: null,
    });
    expect(report.routes.find((row) => row.route === 'R8')?.endToEndRequiredDocumentAvailability).toBeNull();
  });

  it('requires actual authorized evidence for released availability, not merely an ID in retrieval logs', () => {
    expect(
      retrievalObservation(episode('no-source', { evidence: [] }), reference())
        .releasedOutcomeHasAllRequiredDocuments,
    ).toBe(false);
    const wrongOrg = episode().evidence!.map((source) => ({ ...source, organizationId: 'other-org' }));
    expect(
      retrievalObservation(episode('foreign', { evidence: wrongOrg }), reference())
        .releasedOutcomeHasAllRequiredDocuments,
    ).toBe(false);
  });

  it('does not mix held-out and development results or silently accept duplicate episodes', () => {
    const rows = [episode('dev'), episode('held', { split: 'holdout' })];
    expect(() => analyzeResearchSupplement(rows, () => reference())).toThrow('MIXED_SPLITS_REQUIRE_FILTER');
    expect(analyzeResearchSupplement(rows, () => reference(), { split: 'holdout' }).measuredEpisodes).toBe(1);
    expect(() => analyzeResearchSupplement([episode(), episode()], () => reference())).toThrow(
      'DUPLICATE_EPISODE_ID',
    );
  });

  it('reports scenario-macro recall separately when repeated episodes are unbalanced', () => {
    const report = analyzeResearchSupplement(
      [episode('a1'), episode('a2'), episode('a3'), episode('b1', { groupId: 'g2', retrievedIds: [] })],
      () => reference(),
    );
    const route = report.routes.find((row) => row.route === 'R4')!;
    expect(route.conditionalRecallAt6).toBe(0.75);
    expect(route.scenarioMacroConditionalRecallAt6).toBe(0.5);
  });
});

describe('standalone supplemental artifacts', () => {
  it('shows known defects without changing historical measured values and leaves unaffected runs normal', () => {
    const rows = [episode()];
    const plain = analyzeResearchSupplement(rows, () => reference(), { runId: 'pilot' });
    const notice = {
      runId: 'pilot',
      eligibleForSelection: false,
      originalResultsSha256: 'a'.repeat(64),
      classification: 'Adapter defects',
      issues: [{ code: 'CONTROL', detail: 'Baseline evidence omitted.' }],
    };
    const flagged = analyzeResearchSupplement(rows, () => reference(), {
      runId: 'pilot',
      validityNotice: notice,
    });
    expect(flagged.routes).toEqual(plain.routes);
    expect(flagged.selectionStatus).toBe('KNOWN STUDY DEFECTS / NOT FOR SELECTION');
    expect(renderSupplementHtml(flagged)).toContain('Baseline evidence omitted.');
    expect(renderSupplementHtml(flagged)).toContain('KNOWN STUDY DEFECTS / NOT FOR SELECTION');
    expect(renderSupplementHtml(plain)).not.toContain('KNOWN STUDY DEFECTS / NOT FOR SELECTION');
    expect(() => validateStudyValidityNotice(notice, 'other')).toThrow('INVALID_STUDY_VALIDITY_NOTICE');
    expect(() => validateStudyValidityNotice(notice, 'pilot', 'b'.repeat(64))).toThrow(
      'VALIDITY_NOTICE_RESULTS_HASH_MISMATCH',
    );
  });
  it('separates paced wall and measured HTTP-sum latency without imputing unknown service times', () => {
    const rows = [
      episode('slow-wall', { durationMs: 12000, providerDurationMs: 2000 }),
      episode('fast', { durationMs: 5000, providerDurationMs: 1000, status: 'blocked' }),
      episode('unknown', { durationMs: 60000, providerDurationMs: undefined, status: 'error' }),
      episode('recorded-zero', { durationMs: 100, providerDurationMs: 0, status: 'error' }),
      episode('partial', { durationMs: 30000, providerDurationMs: 400, status: 'error' }),
      episode('no-call', { durationMs: 10, providerDurationMs: 0, status: 'error' }),
    ];
    const usage = [
      { id: '1', episode: 'slow-wall', durationMs: 2000 },
      { id: '2', episode: 'fast', durationMs: 1000 },
      { id: '3', episode: 'unknown', durationMs: null },
      { id: '4', episode: 'recorded-zero', durationMs: null },
      { id: '5', episode: 'partial', durationMs: 400 },
      { id: '6', episode: 'partial', durationMs: null },
      { id: 'unrelated', episode: 'other-run', durationMs: 99999 },
    ];
    const report = analyzeResearchSupplement(rows, () => reference(), { usage });
    const latency = report.routes.find((row) => row.route === 'R4')!.latency;
    expect(latency.allAttempts).toMatchObject({
      episodes: 6,
      wall: { measured: 6, p50Ms: 5000, p95Ms: 60000 },
      providerHttpSum: {
        measured: 2,
        unknown: 3,
        recordedZeros: 0,
        p50Ms: 1000,
        p95Ms: 2000,
        completeEpisodes: 2,
        partialEpisodes: 1,
        unknownEpisodes: 2,
        noCallEpisodes: 1,
        recordedCalls: 6,
        measuredCalls: 3,
        missingCalls: 3,
      },
      providerPartialHttpSum: { measured: 1, p50Ms: 400, p95Ms: 400 },
    });
    expect(latency.nonError).toMatchObject({
      episodes: 2,
      wall: { p50Ms: 5000, p95Ms: 12000 },
      providerHttpSum: { measured: 2, unknown: 0, recordedZeros: 0, p50Ms: 1000, p95Ms: 2000 },
    });
    expect(
      report.routes.find((row) => row.route === 'R8')!.latency.allAttempts.providerHttpSum.p50Ms,
    ).toBeNull();
    expect(report.timingUsage.matchedRecords).toBe(6);
    expect(report.timingObservations.find((row) => row.id === 'recorded-zero')).toMatchObject({
      coverage: 'unknown',
      legacyAggregateMs: 0,
      completeDurationMs: null,
    });
  });
  it('does not claim complete HTTP timing from a legacy aggregate without per-call evidence', () => {
    const report = analyzeResearchSupplement([episode('legacy', { providerDurationMs: 2000 })], () =>
      reference(),
    );
    expect(
      report.routes.find((row) => row.route === 'R4')!.latency.allAttempts.providerHttpSum,
    ).toMatchObject({
      measured: 0,
      unknown: 1,
      unverifiedEpisodes: 1,
      p50Ms: null,
      p95Ms: null,
    });
    expect(report.timingObservations[0]).toMatchObject({ coverage: 'unverified', legacyAggregateMs: 2000 });
    expect(
      providerTimingObservation(episode('explicit-zero'), [{ episode: 'explicit-zero', durationMs: 0 }]),
    ).toMatchObject({ coverage: 'complete', completeDurationMs: 0 });
  });
  it('rejects duplicate per-call IDs rather than counting measured service twice', () => {
    const row = { id: 'same', episode: 'one', durationMs: 1000 };
    expect(() => analyzeResearchSupplement([episode()], () => reference(), { usage: [row, row] })).toThrow(
      'DUPLICATE_USAGE_RECORD',
    );
    expect(() => providerTimingObservation(episode('missing', { providerDurationMs: 1200 }), [])).toThrow(
      'USAGE_SNAPSHOT_MISSING_EPISODE_CALLS',
    );
  });
  it('exports self-contained HTML/SVG/JSON with escaped metadata and no provider error bodies', () => {
    const report = analyzeResearchSupplement(
      [
        episode('bad', {
          status: 'error',
          error: 'private token SECRET do not export',
          plan: undefined,
          retrievedIds: undefined,
        }),
      ],
      () => reference(),
      { runId: '<script>alert(1)</script>' },
    );
    const html = renderSupplementHtml(report);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('https://');
    const path = mkdtempSync(join(tmpdir(), 'daybook-supplement-'));
    try {
      writeResearchSupplement(path, report);
      expect(
        JSON.parse(readFileSync(join(path, 'retrieval-and-failures.json'), 'utf8')).measuredEpisodes,
      ).toBe(1);
      expect(readFileSync(join(path, 'retrieval.svg'), 'utf8')).toContain('<svg');
      expect(readFileSync(join(path, 'index.html'), 'utf8')).toBe(html);
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });
});
