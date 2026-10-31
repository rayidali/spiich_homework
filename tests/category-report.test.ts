import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { categoryCases, accountId } from '../scripts/category-evaluation/fixtures';
import { categoryReference } from '../scripts/category-evaluation/references';
import {
  buildCategoryReport,
  categoryReportMarkdown,
  categoryReportHtml,
  type ReportObservation,
} from '../scripts/category-evaluation/report';
import type { CategoryCase, Selector } from '../scripts/category-evaluation/types';

const cases = categoryCases.filter((c) => c.split === 'holdout');
const selectors: Selector[] = ['reference', 'gemini', 'jev'];
const config = {
  run: 'synthetic-report-test',
  split: 'holdout' as const,
  sourceHash: 'a'.repeat(64),
  selectors,
  integrity: { sourceVerified: true, inputVerified: true, budgetReconciled: true, halted: false },
};
function correct(item: CategoryCase, selector: Selector): ReportObservation {
  const expected = categoryReference(item);
  return {
    caseId: item.id,
    selector,
    inputHash: item.inputHash,
    status: 'ok',
    attempts: selector !== 'reference' && expected.selectorEligible ? 1 : 0,
    latencyMs: 40,
    networkMs: expected.selectorEligible && selector !== 'reference' ? 12 : null,
    reportedCostUsd:
      selector === 'reference' || !expected.selectorEligible
        ? null
        : selector === 'gemini'
          ? '0.001'
          : '0.0001',
    reservedUnknownUsd: null,
    result:
      expected.decision === 'SELECT'
        ? {
            decision: 'SELECT',
            accountId: accountId(expected.preferredCategoryCode ?? expected.acceptableCategoryCodes[0]),
          }
        : expected.decision === 'CLARIFY'
          ? {
              decision: 'CLARIFY',
              topic: expected.acceptableFirstTopics[0],
              question: 'Please provide the missing fact.',
            }
          : {
              decision: 'UNSUPPORTED',
              reason: expected.acceptableUnsupportedReasons[0],
              message: 'Use full journal review.',
            },
  };
}
const allCorrect = () => selectors.flatMap((selector) => cases.map((c) => correct(c, selector)));

describe('Category report: synthetic provider-free outcomes', () => {
  it('distinguishes review events, eligible records and examples actually retained by the snapshot', () => {
    const changedCases = structuredClone(cases);
    const item = changedCases.find((c) => c.id === 'repeat-paper:c3')!;
    const lines = item.input.context.corrections[0].corrected_lines;
    // Still balanced and eligible in the fixture context, but the narrow
    // selector excludes a three-line example rather than treating it as a shot.
    item.input.context.corrections[0].corrected_lines = [
      { ...lines[0], debit: '40' },
      { ...lines[0], debit: '59' },
      lines[1],
    ];
    item.inputHash = createHash('sha256').update(JSON.stringify(item.input)).digest('hex');
    const report = buildCategoryReport(changedCases, [], config);
    expect(report.contextInventory.find((c) => c.caseId === 'evidence-stale:c3')).toMatchObject({
      reviewedCorrectionEvents: 3,
      projectedEligibleCorrections: 1,
      preparedCorrections: 1,
    });
    const retained = report.contextInventory.find((c) => c.caseId === item.id)!;
    expect(retained).toMatchObject({
      reviewedCorrectionEvents: 3,
      projectedEligibleCorrections: 3,
      preparedCorrections: 2,
    });
    expect(retained.preparedExampleIds.some((e) => e.id === item.input.context.corrections[0].id)).toBe(
      false,
    );
    expect(retained.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(categoryReportMarkdown(report)).toContain('not measured database retrieval');
    expect(categoryReportHtml(report)).toContain('Prepared C / H');
  });

  it('separates all54 inputs,42 model opportunities,33 category targets and11 category groups', () => {
    const report = buildCategoryReport(cases, allCorrect(), config);
    expect(report.planned).toBe(162);
    expect(report.observed).toBe(162);
    for (const selector of report.selectors) {
      expect(selector.planned).toBe(54);
      expect(selector.selectorEligible).toBe(42);
      expect(selector.categoryTasks).toBe(33);
      expect(selector.categoryAndPreferenceCorrect).toBe(33);
      expect(selector.correctionStates.map((s) => s.planned)).toEqual([18, 18, 18]);
      expect(selector.completeJournalsMeasured).toBe(0);
      expect(selector.learning.taughtPreferenceGroups).toBe(5);
    }
    expect(report.comparison.groups).toBe(11);
    expect(report.comparison.interval).toEqual([0, 0]);
    expect(report.comparison.economyCriterionMet).toBe(true);
    expect(report.comparison.recommendation).toBe('CANDIDATE_PENDING_WORKFLOW_ACCEPTANCE');
    expect(report.comparison.workflowAcceptanceVerified).toBe(false);
  });
  it('keeps errors and missing cells in all relevant denominators and forbids incomplete selection', () => {
    const observations = allCorrect();
    const idx = observations.findIndex((o) => o.selector === 'jev' && o.result?.decision === 'SELECT');
    observations.splice(idx, 1);
    const failed = observations.find((o) => o.selector === 'gemini' && o.result?.decision === 'SELECT')!;
    failed.status = 'error';
    failed.result = null;
    failed.errorCode = 'AI_TIMEOUT';
    failed.reportedCostUsd = null;
    failed.reservedUnknownUsd = '0.004';
    failed.networkMs = null;
    const report = buildCategoryReport(cases, observations, config);
    expect(report.complete).toBe(false);
    expect(report.eligibleForComparison).toBe(false);
    expect(report.selectors.find((s) => s.selector === 'jev')!.categoryTasks).toBe(33);
    expect(report.selectors.find((s) => s.selector === 'jev')!.categoryAndPreferenceCorrect).toBe(32);
    const gemini = report.selectors.find((s) => s.selector === 'gemini')!;
    expect(gemini.errors).toBe(1);
    expect(gemini.costs.reservedUnknownUsd).toBe('0.004');
    expect(gemini.timing.allAttemptNetwork.missing).toBe(1);
    expect(gemini.timing.successfulAttemptNetwork.missing).toBe(0);
    expect(report.comparison.recommendation).toBe('NO_SELECTION_INCOMPLETE_DEVELOPMENT_OR_UNVERIFIED');
  });
  it('requires all integrity checks even with a complete high-scoring matrix', () => {
    for (const field of ['sourceVerified', 'inputVerified', 'budgetReconciled', 'halted'] as const) {
      const integrity = { ...config.integrity, [field]: field === 'halted' };
      const report = buildCategoryReport(cases, allCorrect(), { ...config, integrity });
      expect(report.complete).toBe(true);
      expect(report.eligibleForComparison).toBe(false);
    }
    const development = categoryCases.filter((c) => c.split === 'development');
    expect(
      buildCategoryReport(
        development,
        selectors.flatMap((s) => development.map((c) => correct(c, s))),
        { ...config, split: 'development' },
      ).eligibleForComparison,
    ).toBe(false);
  });
  it('uses the predeclared paired category comparison and safety checks, not whole-input scores', () => {
    const observations = allCorrect();
    for (const row of observations)
      if (row.selector === 'gemini' && row.result?.decision === 'SELECT')
        row.result = { decision: 'CLARIFY', topic: 'category', question: 'Which category?' };
    const report = buildCategoryReport(cases, observations, config);
    expect(report.comparison.difference).toBe(1);
    expect(report.comparison.interval).toEqual([1, 1]);
    expect(report.comparison.efficacyCriterionMet).toBe(true);
    expect(report.comparison.screenPassed).toBe(true);
    const ambiguous = observations.find((o) => o.selector === 'jev' && o.result?.decision === 'CLARIFY')!;
    ambiguous.result = { decision: 'SELECT', accountId: accountId('5030') };
    const unsafe = buildCategoryReport(cases, observations, config);
    expect(unsafe.comparison.efficacyCriterionMet).toBe(true);
    expect(unsafe.comparison.screenPassed).toBe(false);
    expect(unsafe.comparison.lostAppropriateClarificationIds).toContain(ambiguous.caseId);
  });
  it('rejects a clarification loss even when it does not create an unsafe category suggestion', () => {
    const observations = allCorrect();
    const ambiguous = observations.find((o) => o.selector === 'jev' && o.result?.decision === 'CLARIFY')!;
    ambiguous.result = { decision: 'CLARIFY', topic: 'category', question: 'Which category?' };
    const report = buildCategoryReport(cases, observations, config);
    expect(report.selectors.find((s) => s.selector === 'jev')!.unsafeSuggestions).toBe(0);
    expect(report.comparison.safetyCriterionMet).toBe(false);
  });
  it('reports learning as taught-target adoption while preserving a reasonable pre-teaching category', () => {
    const observations = allCorrect();
    for (const row of observations)
      if (row.caseId === 'repeat-paper:c0') row.result = { decision: 'SELECT', accountId: accountId('5030') };
    const report = buildCategoryReport(cases, observations, config);
    const pair = report.selectors[0].learning.pairs.find((p) => p.sequenceId === 'repeat-paper')!;
    expect(pair.beforeSemanticCorrect).toBe(true);
    expect(pair.handlingGain).toBe(0);
    expect(pair.preferenceAdoptionBefore).toBe(false);
    expect(pair.preferenceAdoptionAfter).toBe(true);
    expect(pair.preferenceAdoptionGain).toBe(1);
  });
  it('never replaces missing request timing with local wall time or zero', () => {
    const observations = allCorrect();
    for (const row of observations) if (row.selector === 'jev') row.networkMs = null;
    const report = buildCategoryReport(cases, observations, config);
    const timing = report.selectors.find((s) => s.selector === 'jev')!.timing;
    expect(timing.allAttemptNetwork.p50Ms).toBeNull();
    expect(timing.allAttemptNetwork.missing).toBe(42);
    expect(timing.allAttemptOrchestration.p50Ms).toBe(40);
  });
  it('renders a self-contained safe report with explicit journal and evidence limitations', () => {
    const report = buildCategoryReport(cases, allCorrect(), { ...config, run: '<script>alert(1)</script>' });
    const html = categoryReportHtml(report),
      markdown = categoryReportMarkdown(report);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<svg');
    expect(html).toContain('journal generation');
    expect(markdown).toContain('CANDIDATE_PENDING_WORKFLOW_ACCEPTANCE');
    expect(markdown).toContain('does not verify posting');
    expect(markdown).toContain('no independent human adjudication');
  });
});
