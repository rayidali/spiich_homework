import { describe, expect, it } from 'vitest';
import {
  FAMILIES,
  factMatches,
  pairedDifference,
  percentile,
  scoreEpisode,
  summarizeReviewer,
  summarizeRoute,
  type EpisodeScore,
  type StudyEpisode,
} from '../research/scoring';
import { buildReport, renderHtml, renderMarkdown } from '../research/report';
import { questions, type ResearchLine } from '../research/dataset';
import type { ReferenceAnswer, ReferenceFact } from '../research/reference';
import type { UsageRecord } from '../research/budget';

const target: ReferenceFact = { key: 'cash_balance', value: '125.20', unit: 'USD', asOf: '2026-09-30' };
function reference(overrides: Partial<ReferenceAnswer> = {}): ReferenceAnswer {
  return {
    behavior: 'ANSWER',
    facts: [target],
    evidenceIds: [],
    requiredDocumentIds: [],
    supportingEntryIds: [],
    requiresLedgerEvidence: true,
    requiredAssumptions: [],
    clarificationTopics: [],
    requiredAssumptionTags: [],
    clarificationTopicTags: [],
    summary: '',
    ...overrides,
  };
}
function episode(overrides: Partial<StudyEpisode> = {}): StudyEpisode {
  return {
    id: 'R0:financial-01-1:0',
    route: 'R0',
    questionId: 'financial-01-1',
    groupId: 'financial-01',
    family: 'financial',
    split: 'development',
    repeat: 0,
    status: 'ok',
    durationMs: 1000,
    organizationId: 'company-a',
    answer: {
      behavior: 'ANSWER',
      summary: 'Cash was USD 125.20.',
      facts: [{ ...target, evidenceIds: ['query:cash'] }],
      evidenceIds: ['query:cash'],
      assumptions: [],
      clarificationTopics: [],
    },
    evidence: [{ id: 'query:cash', kind: 'ledger', organizationId: 'company-a', facts: [target] }],
    validation: { valid: true },
    ...overrides,
  };
}
function score(overrides: Partial<StudyEpisode> = {}): EpisodeScore {
  return scoreEpisode(episode(overrides), reference());
}

describe('independent structured task scoring', () => {
  it('awards 90 only to a complete typed answer; human clarity and narrative review stay unavailable', () => {
    const result = score();
    expect(result.success).toBe(true);
    expect(result.automatedScore).toBe(90);
    expect(result.humanClarityScore).toBeNull();
    expect(result.overallScore100).toBeNull();
    expect(result.narrativeReviewed).toBe(false);
  });

  it('accepts equivalent decimal formatting but not a one-cent error', () => {
    expect(factMatches({ ...target, value: '125.2000' }, target)).toBe(true);
    expect(factMatches({ ...target, value: '125.21' }, target)).toBe(false);
    expect(factMatches({ ...target, value: '1.252e2' }, target)).toBe(false);
    expect(factMatches({ ...target, value: 'NaN' }, target)).toBe(false);
  });

  it('does not confuse same-valued metrics, currencies, or required periods', () => {
    expect(factMatches({ ...target, key: 'revenue' }, target)).toBe(false);
    expect(factMatches({ ...target, unit: 'EUR' }, target)).toBe(false);
    expect(factMatches({ ...target, asOf: '2026-10-31' }, target)).toBe(false);
    expect(factMatches({ ...target, asOf: undefined }, target)).toBe(false);
    expect(factMatches({ ...target, entity: 'Wrong company' }, { ...target, entity: 'Acme Corp' })).toBe(
      false,
    );
  });

  it('applies predeclared tolerance to ratios only', () => {
    const ratio = { ...target, unit: 'percent' as const, value: '33.33' };
    expect(factMatches({ ...ratio, value: '33.34' }, ratio)).toBe(true);
    expect(factMatches({ ...ratio, value: '33.35' }, ratio)).toBe(false);
  });

  it('requires actual cited result bindings rather than merely a queries array', () => {
    const result = score({ evidence: [], queries: [{ value: '125.20' }] });
    expect(result.success).toBe(false);
    expect(result.unresolvedCitationIds).toEqual(['query:cash']);
    expect(result.ledgerGrounded).toBe(false);
  });

  it('accepts explicit provenance with a different query metric label, without claiming entailment', () => {
    const e = episode();
    e.evidence![0].facts = [{ ...target, key: 'account_balance' }];
    expect(scoreEpisode(e, reference()).success).toBe(true);
    e.evidence![0].facts = [{ ...target, key: 'account_balance', asOf: '2026-10-31' }];
    expect(scoreEpisode(e, reference()).success).toBe(false);
  });

  it('penalizes an unsupported supplementary claim despite a correct required total', () => {
    const e = episode();
    e.answer!.facts.push({ key: 'forecast', value: '900000.00', unit: 'USD', evidenceIds: ['query:cash'] });
    const result = scoreEpisode(e, reference());
    expect(result.factsMatched).toBe(1);
    expect(result.unsupportedFacts).toBe(1);
    expect(result.success).toBe(false);
    expect(result.factual).toBe(20);
  });

  it('requires current required documents to be actually retrieved and cited', () => {
    const e = episode();
    const r = reference({ requiresLedgerEvidence: false, requiredDocumentIds: ['lease-v2'] });
    e.answer!.facts[0].evidenceIds = ['lease-v1'];
    e.answer!.evidenceIds = ['lease-v2'];
    e.evidence = [{ id: 'lease-v1', kind: 'document', documentId: 'lease-v1', text: 'old' }];
    const result = scoreEpisode(e, r);
    expect(result.missingDocumentIds).toEqual(['lease-v2']);
    expect(result.success).toBe(false);
  });

  it('reports cross-workspace citations as a deployment-disqualifying hard gate', () => {
    const e = episode();
    e.evidence![0].organizationId = 'company-b';
    const result = scoreEpisode(e, reference());
    expect(result.success).toBe(false);
    expect(result.hardGateViolations).toContain('cross_workspace_citation');
    expect(summarizeRoute('R0', [result], 100).disqualified).toBe(true);
  });

  it('requires explicit assumption tags, without grading arbitrary prose by fuzzy keyword matching', () => {
    const r = reference({
      requiredAssumptionTags: ['ZERO_FUTURE_RECEIPTS'],
      requiredAssumptions: ['Zero future receipts.'],
    });
    const e = episode();
    e.answer!.assumptions = ['Zero future receipts.'];
    expect(scoreEpisode(e, r).success).toBe(false);
    e.answer!.assumptionTags = ['ZERO_FUTURE_RECEIPTS'];
    expect(scoreEpisode(e, r).success).toBe(true);
    // Contradictory prose remains an explicitly unreviewed dimension, not silently certified.
    e.answer!.summary = 'There will certainly be future receipts.';
    expect(scoreEpisode(e, r).narrativeReviewed).toBe(false);
  });

  it('allows necessary clarification and rejects abstention on an answerable task', () => {
    const e = episode();
    e.answer = {
      behavior: 'CLARIFY',
      summary: 'What rate should I use?',
      facts: [],
      evidenceIds: [],
      assumptions: [],
      clarificationTopics: ['Please supply the booking rate.'],
      clarificationTopicTags: ['FX_RATE'],
    };
    const r = reference({
      behavior: 'CLARIFY',
      facts: [],
      requiresLedgerEvidence: false,
      clarificationTopics: ['Booking rate'],
      clarificationTopicTags: ['FX_RATE'],
    });
    expect(scoreEpisode(e, r).success).toBe(true);
    expect(scoreEpisode(e, reference()).automatedScore).toBe(0);
  });

  it('gives provider errors zero credit even if a candidate answer was retained for debugging', () => {
    const result = score({ status: 'error' });
    expect(result.automatedScore).toBe(0);
    expect(result.success).toBe(false);
    expect(result.failures).toEqual(['episode_error']);
  });

  it('matches proposal lines as an exact multiset, independent of displayed order', () => {
    const line = (accountCode: string, debit: string, credit: string): ResearchLine => ({
      accountCode,
      debit,
      credit,
      currency: 'USD',
      exchangeRate: '1',
      baseDebit: debit,
      baseCredit: credit,
    });
    const expected = [line('5030', '340.00', '0.00'), line('1000', '0.00', '340.00')];
    const r = reference({
      behavior: 'PROPOSAL',
      facts: [],
      requiresLedgerEvidence: false,
      proposalLines: expected,
    });
    const e = episode();
    e.answer = {
      behavior: 'PROPOSAL',
      summary: 'Review this proposal.',
      facts: [],
      evidenceIds: [],
      assumptions: [],
      clarificationTopics: [],
      proposalLines: expected.map((line) => ({ ...line })).reverse(),
    };
    expect(scoreEpisode(e, r).success).toBe(true);
    e.answer.proposalLines![0].accountCode = '2100';
    expect(scoreEpisode(e, r).success).toBe(false);
  });

  it('never permits semantic approval to override a deterministic validation failure', () => {
    const result = score({
      validation: { valid: false, reasons: ['UNSUPPORTED_CALCULATION_OPERAND'] },
      review: { decision: 'PASS' },
    });
    expect(result.success).toBe(false);
    expect(result.failures).toContain('deterministic_validation_failed');
  });
});

describe('study denominators and uncertainty', () => {
  it('retains errors in end-to-end success but shows the conditional denominator separately', () => {
    const good = score();
    const bad = score({ id: 'failed', status: 'error' });
    const result = summarizeRoute('R0', [good, bad], 100);
    expect(result.microSuccessRate).toBe(0.5);
    expect(result.errorRate).toBe(0.5);
    expect(result.completedEpisodes).toBe(1);
    expect(result.conditionalSuccessRate).toBe(1);
    expect(result.macroSuccessRate).toBeNull();
  });

  it('macro-averages families equally instead of weighting the largest family', () => {
    const rows = FAMILIES.flatMap((family) =>
      Array.from({ length: family === 'financial' ? 10 : 1 }, (_, index) => ({
        ...score(),
        id: `${family}:${index}`,
        family,
        groupId: `${family}-group-${index}`,
        success: family === 'financial' && index < 9,
      })),
    );
    const result = summarizeRoute('R0', rows, 100);
    expect(result.microSuccessRate).toBe(9 / 15);
    expect(result.macroSuccessRate).toBeCloseTo(0.9 / 6);
    expect(result.confidence?.low).toBeNull(); // single-group nonfinancial families
  });

  it('uses nearest-rank latency percentiles and preserves empty data as N/A', () => {
    expect(percentile([100, 400, 200, 300], 0.5)).toBe(200);
    expect(percentile([100, 400, 200, 300], 0.95)).toBe(400);
    expect(percentile([], 0.95)).toBeNull();
  });

  it('paired bootstrap keeps paraphrases/repeats inside scenario blocks and is reproducible', () => {
    const control = Array.from({ length: 24 }, (_, index) => ({
      ...score(),
      id: `control-${index}`,
      questionId: `question-${Math.floor(index / 3)}`,
      groupId: `group-${Math.floor(index / 6)}`,
      repeat: index % 3,
      success: false,
    }));
    const treatment = control.map((row, index) => ({
      ...row,
      id: `treatment-${index}`,
      route: 'R4' as const,
      success: true,
    }));
    const effect = pairedDifference(treatment, control, 100, 42)!;
    expect(effect).toMatchObject({
      estimate: 1,
      low: 1,
      high: 1,
      groups: 4,
      pairedEpisodes: 24,
      samples: 100,
    });
    expect(pairedDifference(treatment, control, 100, 42)).toEqual(effect);
  });

  it('does not quietly drop unmatched episodes or count duplicate runs twice', () => {
    const baseline = [score()];
    const treated = [
      { ...score(), id: 'treatment', route: 'R4' as const },
      { ...score(), id: 'extra', route: 'R4' as const, questionId: 'unpaired' },
    ];
    expect(pairedDifference(treated, baseline, 100)).toMatchObject({
      pairedEpisodes: 1,
      unpairedTreatment: 1,
      low: null,
      high: null,
    });
    expect(() => pairedDifference([...treated, treated[0]], baseline, 100)).toThrow(/Duplicate/);
  });

  it('computes verifier errors and Brier score against injected labels rather than model confidence claims', () => {
    const result = summarizeReviewer([
      { id: 'a', flawed: true, decision: 'PASS', probabilityFlawed: 0.9, deterministicBlocked: false },
      { id: 'b', flawed: true, decision: 'BLOCK', probabilityFlawed: 0.8, deterministicBlocked: true },
      { id: 'c', flawed: false, decision: 'CLARIFY', probabilityFlawed: 0.2 },
      { id: 'd', flawed: false, decision: 'PASS', probabilityFlawed: 0.1 },
    ]);
    expect(result).toMatchObject({
      falseAccepts: 1,
      falseRejects: 1,
      sensitivity: 0.5,
      specificity: 0.5,
      balancedAccuracy: 0.5,
      semanticEscapesAfterCode: 1,
      prevalenceIsSynthetic: true,
    });
    expect(result.brierScore).toBeCloseTo(0.025);
  });
});

describe('standalone paper-style report', () => {
  const reportEpisode = episode({ status: 'error', organizationId: undefined });
  const usage: UsageRecord[] = [
    {
      id: 'usage-1',
      episode: reportEpisode.id,
      provider: 'gemini',
      kind: 'generate',
      model: 'test',
      at: '2026-10-30T00:00:00Z',
      reserveUsd: 0.02,
      estimatedUsd: null,
      status: 503,
      inputTokens: null,
      outputTokens: null,
      durationMs: 1000,
    },
  ];
  it('lists all nine configurations, missing planned runs, and unknown usage reservations', () => {
    const report = buildReport([reportEpisode], usage, questions, {
      split: 'development',
      plannedQuestionIds: [reportEpisode.questionId],
      expectedRepeats: 1,
      bootstrapSamples: 100,
    });
    expect(report.routes).toHaveLength(9);
    expect(report.complete).toBe(false);
    expect(report.routes[0].cost).toMatchObject({
      unknownUsageCalls: 1,
      reportedUsageEquivalentUsd: 0,
      unknownUsageReservationUsd: 0.02,
      budgetUsdPerSuccess: null,
    });
    expect(report.routes[1]).toMatchObject({ episodes: 0, missingEpisodes: 1, microSuccessRate: null });
  });

  it('rejects duplicate episodes and invalid metadata instead of generating a misleading report', () => {
    expect(() =>
      buildReport([reportEpisode, reportEpisode], usage, questions, { bootstrapSamples: 100 }),
    ).toThrow(/Duplicate/);
    expect(() =>
      buildReport([{ ...reportEpisode, family: 'documents' }], usage, questions, { bootstrapSamples: 100 }),
    ).toThrow(/metadata/);
  });

  it('produces self-contained SVG figures, escaped metadata and explicit scientific limitations', () => {
    const report = buildReport([reportEpisode], usage, questions, {
      runId: '<script>alert(1)</script>',
      bootstrapSamples: 100,
    });
    const html = renderHtml(report);
    const markdown = renderMarkdown(report);
    expect(html.match(/<svg /g)).toHaveLength(4);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
    expect(html).toContain('Automated rubric scores stop at 90');
    expect(markdown).toContain('Incomplete study');
    expect(markdown).toContain('independent human adjudication');
    expect(markdown).toContain('R8 Jev verifier');
  });
});
