import { createHash } from 'node:crypto';
import { Decimal } from '../../shared/money';
import type { CategoryBudget } from './budget';
import { prepareCategorySnapshot } from '../../server/category-selector';
import { categoryReference } from './references';
import {
  categoryLearningPairs,
  pairedSequenceInterval,
  scoreCategoryMatrix,
  summarizeCategory,
  summarizeCategoryCosts,
} from './scoring';
import {
  categoryFamilies,
  correctionStates,
  type CategoryCase,
  type CategoryObservation,
  type Selector,
  type Split,
} from './types';

export type ReportObservation = CategoryObservation & {
  networkMs?: number | null;
  dispatched?: boolean;
  claimed?: boolean;
};
export type ReportIntegrity = {
  sourceVerified: boolean;
  inputVerified: boolean;
  budgetReconciled: boolean;
  halted: boolean;
};
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rate = (n: number, d: number) => (d ? n / d : null);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function timing(values: (number | null | undefined)[]) {
  const sorted = values
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  return {
    observed: sorted.length,
    missing: values.length - sorted.length,
    p50Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.5) - 1] : null,
    p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
  };
}

/** Provider-free analysis. Every planned slot remains in the denominator. */
export function buildCategoryReport(
  cases: CategoryCase[],
  observations: ReportObservation[],
  options: {
    run: string;
    split: Split;
    sourceHash: string;
    selectors: Selector[];
    integrity: ReportIntegrity;
    cohortAccounting?: ReturnType<CategoryBudget['accounting']>;
  },
) {
  if (!cases.length || cases.some((c) => c.split !== options.split)) throw new Error('REPORT_SPLIT');
  const scores = scoreCategoryMatrix(cases, observations, options.selectors);
  const contextInventory = cases.map((item) => {
    const snapshot = prepareCategorySnapshot(item.input.facts, item.input.context);
    const state = JSON.parse(snapshot.stateJson) as {
      examples: { source: 'correction' | 'history'; id: string }[];
    };
    return {
      caseId: item.id,
      reviewedCorrectionEvents: item.correctionEvents,
      modelOpportunity: categoryReference(item).selectorEligible,
      projectedEligibleCorrections: item.input.context.corrections.length,
      projectedEligibleHistory: item.input.context.history.length,
      preparedCorrections: state.examples.filter((e) => e.source === 'correction').length,
      preparedHistory: state.examples.filter((e) => e.source === 'history').length,
      preparedExampleIds: state.examples.map(({ source, id }) => ({ source, id })),
      snapshotHash: snapshot.hash,
    };
  });
  const complete = scores.every((s) => s.status !== 'missing');
  const verified = Object.entries(options.integrity).every(([key, value]) =>
    key === 'halted' ? !value : value,
  );
  const eligibleForComparison =
    complete &&
    verified &&
    options.split === 'holdout' &&
    options.selectors.includes('gemini') &&
    options.selectors.includes('jev');
  const categoryIds = new Set(
    cases.filter((c) => categoryReference(c).decision === 'SELECT').map((c) => c.id),
  );
  const groups = [...new Set(cases.filter((c) => categoryIds.has(c.id)).map((c) => c.sequenceId))];
  const categoriesCorrect = (selector: Selector, sequenceId?: string) =>
    scores.filter(
      (s) =>
        s.selector === selector &&
        categoryIds.has(s.caseId) &&
        (!sequenceId || s.sequenceId === sequenceId) &&
        s.selectorSuccess === true,
    ).length;
  const selectors = options.selectors.map((selector) => {
    const own = scores.filter((s) => s.selector === selector);
    const rows = observations.filter((o) => o.selector === selector);
    const paid = rows.filter((o) => o.attempts === 1);
    const costs = summarizeCategoryCosts(rows);
    const correct = categoriesCorrect(selector);
    const learning = categoryLearningPairs(cases, scores, selector);
    const adoption = learning.flatMap((p) =>
      p.preferenceAdoptionGain === null ? [] : [p.preferenceAdoptionGain],
    );
    return {
      selector,
      ...summarizeCategory(own),
      categoryTasks: categoryIds.size,
      categoryAndPreferenceCorrect: correct,
      categoryAndPreferenceRate: rate(correct, categoryIds.size),
      necessaryClarificationTasks: cases.filter((c) => categoryReference(c).decision === 'CLARIFY').length,
      correctionStates: correctionStates.map((state) => {
        const atState = own.filter((s) => s.correctionEvents === state);
        return { reviewedCorrectionEvents: state, ...summarizeCategory(atState) };
      }),
      costs,
      trackedCostPerCorrectCategoryUsd: correct
        ? new Decimal(costs.trackedUsd).div(correct).toString()
        : null,
      timing: {
        allAttemptOrchestration: timing(paid.map((o) => o.latencyMs)),
        successfulAttemptOrchestration: timing(paid.filter((o) => o.status === 'ok').map((o) => o.latencyMs)),
        allAttemptNetwork: timing(paid.map((o) => o.networkMs)),
        successfulAttemptNetwork: timing(paid.filter((o) => o.status === 'ok').map((o) => o.networkMs)),
        localDecision: timing(rows.filter((o) => o.attempts === 0).map((o) => o.latencyMs)),
      },
      learning: {
        pairs: learning,
        groups: learning.length,
        handlingGain: mean(learning.map((p) => p.handlingGain)),
        handlingGainInterval: pairedSequenceInterval(learning.map((p) => p.handlingGain)),
        taughtPreferenceGroups: adoption.length,
        preferenceAdoptionGain: adoption.length ? mean(adoption) : null,
        preferenceAdoptionInterval: pairedSequenceInterval(adoption),
      },
      families: categoryFamilies.map((family) => {
        const familyScores = own.filter((s) => s.family === family);
        return { family, ...summarizeCategory(familyScores) };
      }),
    };
  });
  const gemini = selectors.find((s) => s.selector === 'gemini'),
    jev = selectors.find((s) => s.selector === 'jev');
  const deltas =
    gemini && jev
      ? groups.map((group) => {
          const n = cases.filter((c) => c.sequenceId === group && categoryIds.has(c.id)).length;
          return (categoriesCorrect('jev', group) - categoriesCorrect('gemini', group)) / n;
        })
      : [];
  const interval = pairedSequenceInterval(deltas);
  const difference = deltas.length ? mean(deltas) : null;
  const costSaving =
    gemini?.trackedCostPerCorrectCategoryUsd &&
    jev?.trackedCostPerCorrectCategoryUsd &&
    new Decimal(gemini.trackedCostPerCorrectCategoryUsd).gt(0)
      ? new Decimal(1)
          .minus(
            new Decimal(jev.trackedCostPerCorrectCategoryUsd).div(gemini.trackedCostPerCorrectCategoryUsd),
          )
          .toNumber()
      : null;
  const lostClarifications = scores
    .filter(
      (s) =>
        s.selector === 'gemini' &&
        s.necessaryClarification &&
        !scores.find((other) => other.selector === 'jev' && other.caseId === s.caseId)
          ?.necessaryClarification,
    )
    .map((s) => s.caseId);
  const efficacy = difference !== null && interval !== null && difference >= 0.1 && interval[0] > 0;
  const economy = interval !== null && interval[0] > -0.05 && costSaving !== null && costSaving >= 0.3;
  const safety = !!jev && jev.unsafeSuggestions === 0 && lostClarifications.length === 0;
  const screenPassed = eligibleForComparison && safety && (efficacy || economy);
  return {
    version: 'category-report-v1',
    run: options.run,
    split: options.split,
    sourceHash: options.sourceHash,
    inputHashes: Object.fromEntries(cases.map((c) => [c.id, c.inputHash])),
    contextInventory,
    observationsSha256: sha(observations),
    complete,
    eligibleForComparison,
    integrity: options.integrity,
    planned: cases.length * options.selectors.length,
    observed: observations.length,
    skippedOrMissing: scores.filter((s) => s.status === 'missing').map((s) => `${s.selector}:${s.caseId}`),
    selectors,
    scores,
    accounting: {
      accuracyScope:
        'Only this version and split; predecessor outcomes are preserved separately, never pooled.',
      phase: Object.fromEntries(selectors.map((s) => [s.selector, s.costs])),
      cohort: options.cohortAccounting ?? null,
      priorAccuracyPooled: false,
    },
    comparison: {
      contrast: 'Jev minus Gemini, category-and-preference success',
      groups: groups.length,
      difference,
      interval,
      intervalMethod:
        'Paired sequence bootstrap; 2000 resamples; seed 20261031; exploratory unadjusted 95% interval',
      costSaving,
      lostAppropriateClarificationIds: lostClarifications,
      efficacyCriterionMet: efficacy,
      economyCriterionMet: economy,
      safetyCriterionMet: safety,
      screenPassed,
      recommendation: !eligibleForComparison
        ? 'NO_SELECTION_INCOMPLETE_DEVELOPMENT_OR_UNVERIFIED'
        : screenPassed
          ? 'CANDIDATE_PENDING_WORKFLOW_ACCEPTANCE'
          : 'RETAIN_GEMINI_WITHIN_SELECTOR_SCOPE',
      workflowAcceptanceVerified: false,
    },
    limitations: [
      'Synthetic AI-authored cases and labels; no independent human adjudication or production accuracy claim.',
      'The three correction states are paired hypothetical contexts, not independent users or longitudinal training.',
      'Curated eligible context is supplied equally; this does not measure database retrieval quality.',
      'Reference rules and local input gates are not paid model capabilities.',
      'The selector does not generate journals. Exact journal, posting and end-to-end workflow correctness remain unmeasured here.',
      'Provider/network latency is distinct from orchestration-inclusive wall time; missing measurements are not zero.',
      'No automatic routing or production adoption follows from this report. Workflow integration evidence is required separately.',
    ],
  };
}
export type CategoryReport = ReturnType<typeof buildCategoryReport>;
const percent = (value: number | null) => (value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`);
const escaped = (value: unknown) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function categoryReportMarkdown(report: CategoryReport) {
  const contextRows = report.contextInventory
    .map(
      (c) =>
        `| ${c.caseId} | ${c.reviewedCorrectionEvents} | ${c.projectedEligibleCorrections} / ${c.projectedEligibleHistory} | ${c.preparedCorrections} / ${c.preparedHistory} | ${c.modelOpportunity ? 'Model opportunity' : 'Local gate'} |`,
    )
    .join('\n');
  const contextTable = `## Context actually prepared\n\nReview events, eligible input records after fixture projection, and examples retained by the real snapshot builder are distinct counts. Counts use correction / history order. These are synthetic fixture projections, not measured database retrieval. Prepared examples are not sent when a local gate stops a request; missing attempts do not imply transmission. Synthetic example IDs and snapshot hashes are in the JSON report.\n\n| Case | Review events | Eligible input C / H | Prepared C / H | Execution scope |\n|---|---:|---:|---:|---|\n${contextRows}`;
  const rows = report.selectors
    .map(
      (s) =>
        `| ${s.selector} | ${s.categoryAndPreferenceCorrect}/${s.categoryTasks} (${percent(s.categoryAndPreferenceRate)}) | ${s.selectorSuccesses}/${s.selectorEligible} | ${s.handlingSuccesses}/${s.planned} | ${s.errors} / ${s.missing} | ${s.costs.trackedUsd} |`,
    )
    .join('\n');
  const cohort = report.accounting.cohort;
  const cohortTable = cohort
    ? `## Shared spend allowance\n\nThe score table above contains only this version and split. The earlier adapter failure remains a separate historical outcome; its cost and attempt count still reduce the same allowance. Current-run totals include both development and holdout of this version; cumulative totals also include the reviewed predecessor. No earlier accuracy result is pooled into this version.\n\n| Provider | Predecessor attempts / USD | Current run attempts / USD | Cumulative attempts / USD | Cumulative unknown reserved USD | Fixed cap |\n|---|---:|---:|---:|---:|---|\n${(['gemini', 'jev'] as const).map((p) => `| ${p} | ${cohort.predecessor[p].attempts} / ${cohort.predecessor[p].chargedUsd} | ${cohort.currentRun[p].attempts} / ${cohort.currentRun[p].chargedUsd} | ${cohort.cumulative[p].attempts} / ${cohort.cumulative[p].chargedUsd} | ${cohort.cumulative[p].unknownReservedUsd} | ${cohort.limits[p].attempts} attempts / $${cohort.limits[p].usd} |`).join('\n')}\n`
    : '';
  return `# Category learning comparison — ${report.split}\n\n${report.complete ? 'All planned observations recorded.' : 'INCOMPLETE: remaining slots are missing, not successful.'} ${report.eligibleForComparison ? 'Integrity checks permit the predefined comparison.' : 'No architecture or provider selection is justified by this snapshot.'}\n\nRun: \`${report.run}\`; source: \`${report.sourceHash}\`.\n\n| Selector | Category + taught preference | All model opportunities | Whole input handling (includes code gates) | Errors / missing | Tracked USD |\n|---|---:|---:|---:|---:|---:|\n${rows}\n\n${cohortTable}\nJev minus Gemini: ${percent(report.comparison.difference)}; paired interval ${report.comparison.interval ? report.comparison.interval.map(percent).join(' to ') : 'N/A'} across ${report.comparison.groups} category scenario groups. Intervals are exploratory and unadjusted. Cost-per-correct-category reduction uses this version's split only: ${percent(report.comparison.costSaving)}.\n\nDecision: **${report.comparison.recommendation}**. A passed statistical screen still requires separate workflow acceptance; this report does not verify posting or complete journals.\n\n## Learning after corrections\n\n${report.selectors.map((s) => `- ${s.selector}: taught-preference adoption gain ${percent(s.learning.preferenceAdoptionGain)} across ${s.learning.taughtPreferenceGroups} teaching groups; handling gain ${percent(s.learning.handlingGain)} across ${s.learning.groups} groups.`).join('\n')}\n\n${contextTable}\n\n## Limits\n\n${report.limitations.map((s) => `- ${s}`).join('\n')}\n`;
}

export function categoryReportHtml(report: CategoryReport) {
  const bars = report.selectors
    .map((s, index) => {
      const y = 35 + index * 55,
        width = (s.categoryAndPreferenceRate ?? 0) * 420;
      return `<text x="5" y="${y + 18}">${escaped(s.selector)}</text><rect x="95" y="${y}" width="${width}" height="26" fill="${['#596572', '#326f87', '#b87b35'][index % 3]}"/><text x="${105 + width}" y="${y + 18}">${escaped(percent(s.categoryAndPreferenceRate))}</text>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daybook category comparison</title><style>body{max-width:980px;margin:40px auto;padding:0 20px;background:#fbfaf6;color:#232b30;font:16px/1.6 system-ui}h1{font-size:30px}svg{width:100%;max-width:700px}pre{white-space:pre-wrap;font:inherit}code{overflow-wrap:anywhere}.notice{padding:14px;background:#e8e1cf}</style><h1>Category learning comparison</h1><p class="notice">${escaped(report.split.toUpperCase())} · ${report.complete ? 'COMPLETE' : 'INCOMPLETE'} · ${report.eligibleForComparison ? 'Comparison eligible' : 'No provider selection'}</p><h2>Correct categories and taught preferences</h2><p>Every expected category task stays in the denominator, including errors and missing attempts. These bars do not measure journal generation.</p><svg viewBox="0 0 640 ${60 + report.selectors.length * 55}" role="img" aria-label="Category and preference success by selector">${bars}</svg><pre>${escaped(categoryReportMarkdown(report))}</pre></html>\n`;
}
