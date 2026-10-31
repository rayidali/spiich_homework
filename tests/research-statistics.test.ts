import { describe, expect, it } from 'vitest';
import { questions } from '../research/dataset';
import {
  buildReport,
  DECLARED_COMPARISONS,
  renderHtml,
  renderMarkdown,
  type ReportOptions,
} from '../research/report';
import { ROUTES, scoreEpisode, successInterval, type StudyEpisode } from '../research/scoring';
import type { ReferenceAnswer, ReferenceFact } from '../research/reference';
import type { UsageRecord } from '../research/budget';

const fact: ReferenceFact = { key: 'cash_balance', value: '125.20', unit: 'USD', asOf: '2026-09-30' };
const reference: ReferenceAnswer = {
  behavior: 'ANSWER',
  facts: [fact],
  evidenceIds: [],
  requiredDocumentIds: [],
  supportingEntryIds: [],
  requiresLedgerEvidence: true,
  requiredAssumptions: [],
  clarificationTopics: [],
  requiredAssumptionTags: [],
  clarificationTopicTags: [],
  summary: '',
};
const question = questions.find((q) => q.split === 'development')!;
function episode(): StudyEpisode {
  return {
    id: `audit:R0:${question.id}:0`,
    route: 'R0',
    questionId: question.id,
    groupId: question.groupId,
    family: question.family,
    split: question.split,
    repeat: 0,
    status: 'ok',
    durationMs: 10,
    organizationId: 'company-a',
    answer: {
      behavior: 'ANSWER',
      summary: 'A typed claim.',
      facts: [{ ...fact, evidenceIds: ['query:cash'] }],
      evidenceIds: ['query:cash'],
      assumptions: [],
      clarificationTopics: [],
    },
    evidence: [{ id: 'query:cash', kind: 'ledger', organizationId: 'company-a', facts: [fact] }],
    validation: { valid: true },
  };
}
const options: ReportOptions = {
  runId: 'audit',
  plannedQuestionIds: [question.id],
  split: 'development',
  expectedRepeats: 1,
  bootstrapSamples: 100,
};
const completed = () =>
  ROUTES.map(
    (route): StudyEpisode => ({
      ...episode(),
      route,
      id: `audit:${route}:${question.id}:0`,
      status: 'error',
    }),
  );
const digest = 'a'.repeat(64);

describe('scientific report validity gates', () => {
  it('preserves exact component controls instead of comparing everything only with R0', () => {
    expect(DECLARED_COMPARISONS).toHaveLength(9);
    expect(DECLARED_COMPARISONS).toEqual(
      expect.arrayContaining([
        { hypothesis: 'H2', route: 'R2', control: 'R1' },
        { hypothesis: 'H3a', route: 'R3', control: 'R2' },
        { hypothesis: 'H4', route: 'R4', control: 'R2' },
        { hypothesis: 'H7b', route: 'R8', control: 'R4' },
      ]),
    );
    const report = buildReport(completed(), [], questions, options);
    expect(report.comparisons.filter((pair) => pair.kind === 'declared')).toHaveLength(9);
    expect(renderMarkdown(report)).toContain('unadjusted for multiple comparisons');
  });

  it('distinguishes complete measurements from verified data and route eligibility', () => {
    const rows = completed();
    rows[0].hardGateViolations = ['cross_workspace_citation'];
    const unverified = buildReport(rows, [], questions, options);
    expect(unverified.complete).toBe(true);
    expect(unverified.eligibleForConclusion).toBe(false);
    expect(unverified.eligibleRoutes).toEqual([]);
    const verified = buildReport(rows, [], questions, {
      ...options,
      snapshotIntegrity: { status: 'verified', before: digest, after: digest, scope: 'ledger_and_corpus' },
    });
    expect(verified.eligibleForConclusion).toBe(true);
    expect(verified.eligibleRoutes).toEqual(ROUTES.slice(1));
    expect(verified.routes.every((route) => route.successes === 0)).toBe(true); // measurement completeness never means answers are correct
  });

  it('downgrades invalid integrity assertions and visibly prevents selection on changed snapshots', () => {
    for (const after of ['b'.repeat(64), null, 'invalid']) {
      const report = buildReport(completed(), [], questions, {
        ...options,
        snapshotIntegrity: { status: 'verified', before: digest, after },
      });
      expect(report.eligibleForConclusion).toBe(false);
      expect(report.snapshotIntegrity.status).not.toBe('verified');
      expect(renderHtml(report)).toContain('Ineligible for comparative selection');
      expect(renderHtml(report)).not.toContain('class="notice complete"');
    }
  });

  it.each([-1, 0.5, 1])(
    'rejects impossible repeat %s even if each question has the right row count',
    (repeat) => {
      expect(() => buildReport([{ ...episode(), repeat }], [], questions, options)).toThrow(/metadata/);
    },
  );

  it('retains the cost of an interrupted run request without assigning it a free successful outcome', () => {
    const usage: UsageRecord = {
      id: 'orphan',
      episode: 'audit:R4:missing:0',
      provider: 'gemini',
      kind: 'generate',
      model: 'test',
      at: '2026-10-30T00:00:00Z',
      reserveUsd: 0.03,
      estimatedUsd: null,
      status: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
    };
    const report = buildReport(
      [],
      [usage, { ...usage, id: 'other', episode: 'other-run:R4:missing:0' }],
      questions,
      options,
    );
    expect(report.unassignedRunUsage).toMatchObject({
      calls: 1,
      unknownUsageCalls: 1,
      budgetChargedUsd: 0.03,
    });
    expect(report.routes.every((route) => route.cost.calls === 0)).toBe(true);
    expect(renderMarkdown(report)).toContain('Unassigned requests for this run');
  });

  it('labels small and degenerate empirical confidence intervals without interpreting certainty', () => {
    const base = scoreEpisode(episode(), reference);
    const rows = Array.from({ length: 4 }, (_, i) => ({
      ...base,
      id: `${i}`,
      questionId: `q${i}`,
      groupId: `group${Math.floor(i / 2)}`,
    }));
    const result = successInterval(rows, 100)!;
    expect(result.low).toBe(1);
    expect(result.high).toBe(1);
    expect(result.method).toContain('Unadjusted');
    expect(result.warnings.join(' ')).toMatch(/Degenerate.*do not prove/);
    expect(result.warnings.join(' ')).toContain('Five or fewer');
    expect(result.warnings.join(' ')).toContain('only represented families');
    expect(result).toEqual(successInterval(rows, 100));
  });
});

describe('score diagnostics and connected provenance', () => {
  it('separates public metric-key violations from incorrect money', () => {
    const wrongKey = episode();
    wrongKey.answer!.facts[0].key = 'bank_cash';
    const result = scoreEpisode(wrongKey, reference);
    expect(result.success).toBe(false);
    expect(result.failures).toContain('metric_key_mismatch');
    expect(result.failures).not.toContain('required_numeric_value_mismatch');
    const wrongAmount = episode();
    wrongAmount.answer!.facts[0].value = '125.21';
    expect(scoreEpisode(wrongAmount, reference).failures).toContain('required_numeric_value_mismatch');
  });

  it('does not exempt derived financial claims from matching source units', () => {
    const e = episode();
    e.answer!.facts[0].evidenceIds = ['calc:total'];
    e.answer!.calculations = [{ id: 'total', evidenceIds: ['query:cash'] }];
    e.evidence!.push({
      id: 'calc:total',
      kind: 'calculation',
      facts: [{ ...fact, unit: 'EUR' }],
      ledgerAncestors: [fact],
    });
    expect(scoreEpisode(e, reference).success).toBe(false);
    e.evidence![1].facts![0].unit = 'USD';
    expect(scoreEpisode(e, reference).success).toBe(true);
  });

  it('requires actual ledger provenance for a calculated financial result', () => {
    const e = episode();
    e.answer!.facts[0].evidenceIds = ['calc:total'];
    e.answer!.evidenceIds = ['calc:total'];
    e.evidence = [{ id: 'calc:total', kind: 'calculation', facts: [fact] }];
    expect(scoreEpisode(e, reference).ledgerGrounded).toBe(false);
    e.answer!.calculations = [{ id: 'total', evidenceIds: ['query:cash'] }];
    e.evidence.push({ id: 'query:cash', kind: 'ledger', facts: [fact] });
    e.evidence[0].ledgerAncestors = [fact];
    expect(scoreEpisode(e, reference).success).toBe(true);
  });

  it('does not credit an unrelated document just because the right document appears elsewhere', () => {
    const e = episode();
    const r = { ...reference, requiresLedgerEvidence: false, requiredDocumentIds: ['required'] };
    e.evidence = [
      { id: 'required', kind: 'document', text: 'Correct source.' },
      { id: 'unrelated', kind: 'document', text: 'Unrelated source.' },
    ];
    e.answer!.evidenceIds = ['required'];
    e.answer!.facts[0].evidenceIds = ['unrelated'];
    expect(scoreEpisode(e, r).success).toBe(false);
    e.answer!.facts[0].evidenceIds = ['required'];
    expect(scoreEpisode(e, r).success).toBe(true);
    e.answer!.facts[0].evidenceIds = ['calc:derived'];
    e.answer!.calculations = [{ id: 'derived', evidenceIds: ['required'] }];
    e.evidence.push({ id: 'calc:derived', kind: 'calculation', facts: [fact] });
    expect(scoreEpisode(e, r).success).toBe(true);
  });

  it('allows directly sourced ledger facts within a mixed document-and-ledger answer', () => {
    const e = episode();
    e.evidence!.push({ id: 'contract', kind: 'document', text: 'A required contract.' });
    e.answer!.evidenceIds.push('contract');
    expect(scoreEpisode(e, { ...reference, requiredDocumentIds: ['contract'] }).success).toBe(true);
  });
});
