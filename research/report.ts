import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { datasetVersion, type ResearchQuestion, type StudySplit } from './dataset';
import { getReference } from './reference';
import type { UsageRecord } from './budget';
import {
  FAMILIES,
  ROUTES,
  pairedDifference,
  scoreEpisode,
  summarizeRoute,
  type EpisodeScore,
  type RouteSummary,
  type StudyEpisode,
  type StudyRoute,
} from './scoring';

export interface ReportOptions {
  split?: StudySplit;
  expectedRepeats?: number;
  plannedQuestionIds?: string[];
  bootstrapSamples?: number;
  generatedAt?: string;
  runId?: string;
  sourceRevision?: string;
  extraLimitations?: string[];
  snapshotIntegrity?: SnapshotIntegrity;
}
export interface SnapshotIntegrity {
  status: 'verified' | 'changed' | 'unverified';
  before: string | null;
  after: string | null;
  scope?: 'ledger' | 'ledger_and_corpus';
  reason?: string;
}
/** Predeclared component comparisons; wider R0 comparisons are descriptive only. */
export const DECLARED_COMPARISONS: { hypothesis: string; route: StudyRoute; control: StudyRoute }[] = [
  { hypothesis: 'H1', route: 'R1', control: 'R0' },
  { hypothesis: 'H2', route: 'R2', control: 'R1' },
  { hypothesis: 'H3a', route: 'R3', control: 'R2' },
  { hypothesis: 'H3b', route: 'R3', control: 'R4' },
  { hypothesis: 'H4', route: 'R4', control: 'R2' },
  { hypothesis: 'H5', route: 'R5', control: 'R4' },
  { hypothesis: 'H6', route: 'R6', control: 'R4' },
  { hypothesis: 'H7a', route: 'R7', control: 'R4' },
  { hypothesis: 'H7b', route: 'R8', control: 'R4' },
];
export interface RouteCost {
  calls: number;
  inputTokensReported: number;
  outputTokensReported: number;
  unknownUsageCalls: number;
  reportedUsageEquivalentUsd: number;
  unknownUsageReservationUsd: number;
  budgetChargedUsd: number;
  budgetUsdPerEpisode: number | null;
  budgetUsdPerSuccess: number | null;
}
export interface ReportRoute extends RouteSummary {
  plannedEpisodes: number;
  missingEpisodes: number;
  complete: boolean;
  cost: RouteCost;
  failures: { kind: string; episodes: number }[];
}
export interface StudyReport {
  schemaVersion: 1;
  generatedAt: string;
  runId: string;
  sourceRevision: string | null;
  datasetVersion: string;
  split: StudySplit;
  expectedRepeats: number;
  complete: boolean;
  eligibleForConclusion: boolean;
  eligibleRoutes: StudyRoute[];
  snapshotIntegrity: SnapshotIntegrity;
  questions: Pick<ResearchQuestion, 'id' | 'groupId' | 'family' | 'split' | 'question'>[];
  routes: ReportRoute[];
  scores: EpisodeScore[];
  comparisons: {
    hypothesis: string;
    kind: 'declared' | 'descriptive';
    route: StudyRoute;
    control: StudyRoute;
    effect: ReturnType<typeof pairedDifference>;
  }[];
  setup: RouteCost;
  unassignedRunUsage: RouteCost;
  limitations: string[];
}

function cost(records: UsageRecord[], episodeCount: number, successes: number): RouteCost {
  const reported = records.reduce((sum, row) => sum + (row.estimatedUsd ?? 0), 0);
  const reserved = records.reduce((sum, row) => sum + (row.estimatedUsd === null ? row.reserveUsd : 0), 0);
  return {
    calls: records.length,
    inputTokensReported: records.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
    outputTokensReported: records.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
    unknownUsageCalls: records.filter((row) => row.estimatedUsd === null).length,
    reportedUsageEquivalentUsd: reported,
    unknownUsageReservationUsd: reserved,
    budgetChargedUsd: reported + reserved,
    budgetUsdPerEpisode: episodeCount ? (reported + reserved) / episodeCount : null,
    budgetUsdPerSuccess: successes ? (reported + reserved) / successes : null,
  };
}

/** Build an auditable report from completed episodes; never substitute missing runs with successes. */
export function buildReport(
  episodes: StudyEpisode[],
  usage: UsageRecord[],
  questions: ResearchQuestion[],
  options: ReportOptions = {},
): StudyReport {
  const split =
    options.split ?? (episodes.some((episode) => episode.split === 'holdout') ? 'holdout' : 'development');
  const expectedRepeats = options.expectedRepeats ?? (split === 'holdout' ? 3 : 1);
  if (!Number.isInteger(expectedRepeats) || expectedRepeats < 1)
    throw new Error('Expected repeats must be positive.');
  const bootstrapSamples = options.bootstrapSamples ?? 2000;
  if (!Number.isInteger(bootstrapSamples) || bootstrapSamples < 100 || bootstrapSamples > 100000)
    throw new Error('Bootstrap samples must be between 100 and 100000.');
  const planned = questions.filter(
    (question) =>
      question.split === split &&
      (!options.plannedQuestionIds || options.plannedQuestionIds.includes(question.id)),
  );
  if (!planned.length) throw new Error('No planned questions for the selected report split.');
  if (
    options.plannedQuestionIds &&
    new Set(planned.map((question) => question.id)).size !== new Set(options.plannedQuestionIds).size
  )
    throw new Error('Planned question IDs must exist in the report split.');
  const byId = new Map(planned.map((question) => [question.id, question]));
  const selected = episodes.filter((episode) => episode.split === split && byId.has(episode.questionId));
  if (
    new Set(selected.map((episode) => episode.id)).size !== selected.length ||
    new Set(selected.map((episode) => `${episode.route}:${episode.questionId}:${episode.repeat}`)).size !==
      selected.length
  )
    throw new Error('Duplicate episodes would bias the report.');
  for (const episode of selected) {
    const question = byId.get(episode.questionId)!;
    if (
      !ROUTES.includes(episode.route) ||
      episode.groupId !== question.groupId ||
      episode.family !== question.family ||
      !Number.isInteger(episode.repeat) ||
      episode.repeat < 0 ||
      episode.repeat >= expectedRepeats ||
      !Number.isFinite(episode.durationMs) ||
      episode.durationMs < 0
    )
      throw new Error('Episode metadata does not match the frozen dataset.');
  }
  const scores = selected.map((episode) => scoreEpisode(episode, getReference(episode.questionId)));
  const routes = ROUTES.map((route): ReportRoute => {
    const summary = summarizeRoute(route, scores, bootstrapSamples);
    const records = scores.filter((score) => score.route === route);
    const episodeIds = new Set(records.map((score) => score.id));
    const expected = planned.length * expectedRepeats;
    const counts = new Map(
      planned.map((question) => [
        question.id,
        records.filter((score) => score.questionId === question.id).length,
      ]),
    );
    const missing = [...counts.values()].reduce(
      (sum, count) => sum + Math.max(0, expectedRepeats - count),
      0,
    );
    const complete = [...counts.values()].every((count) => count === expectedRepeats);
    const failureKinds = [...new Set(records.flatMap((score) => score.failures))].sort();
    return {
      ...summary,
      plannedEpisodes: expected,
      missingEpisodes: missing,
      complete,
      cost: cost(
        usage.filter((row) => episodeIds.has(row.episode)),
        records.length,
        summary.successes,
      ),
      failures: failureKinds.map((kind) => ({
        kind,
        episodes: records.filter((score) => score.failures.includes(kind)).length,
      })),
    };
  });
  const pairs = [
    ...DECLARED_COMPARISONS.map((pair) => ({ ...pair, kind: 'declared' as const })),
    ...ROUTES.filter(
      (route) =>
        route !== 'R0' && !DECLARED_COMPARISONS.some((pair) => pair.route === route && pair.control === 'R0'),
    ).map((route) => ({
      hypothesis: 'Descriptive',
      kind: 'descriptive' as const,
      route,
      control: 'R0' as const,
    })),
  ];
  const comparisons = pairs.map((pair) => ({
    ...pair,
    effect: pairedDifference(
      scores.filter((score) => score.route === pair.route),
      scores.filter((score) => score.route === pair.control),
      bootstrapSamples,
    ),
  }));
  const snapshotIntegrity: SnapshotIntegrity = {
    ...(options.snapshotIntegrity ?? { status: 'unverified', before: null, after: null }),
    scope: options.snapshotIntegrity?.scope ?? 'ledger',
  };
  const validDigest = (value: string | null) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (
    snapshotIntegrity.status === 'verified' &&
    !(validDigest(snapshotIntegrity.before) && snapshotIntegrity.before === snapshotIntegrity.after)
  ) {
    snapshotIntegrity.status =
      snapshotIntegrity.before &&
      snapshotIntegrity.after &&
      snapshotIntegrity.before !== snapshotIntegrity.after
        ? 'changed'
        : 'unverified';
    snapshotIntegrity.reason =
      'A verified snapshot requires identical valid before/after SHA-256 fingerprints.';
  }
  const complete = routes.every((route) => route.complete);
  const eligibleForConclusion = complete && snapshotIntegrity.status === 'verified';
  const recordedIds = new Set(selected.map((episode) => episode.id));
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    runId: options.runId ?? 'daybook-study',
    sourceRevision: options.sourceRevision ?? null,
    datasetVersion,
    split,
    expectedRepeats,
    complete,
    eligibleForConclusion,
    eligibleRoutes: eligibleForConclusion
      ? routes.filter((route) => !route.disqualified).map((route) => route.route)
      : [],
    snapshotIntegrity,
    questions: planned.map(({ id, groupId, family, split: questionSplit, question }) => ({
      id,
      groupId,
      family,
      split: questionSplit,
      question,
    })),
    routes,
    scores,
    comparisons,
    setup: cost(
      usage.filter((row) => row.episode === 'setup' || row.episode.startsWith('index:')),
      0,
      0,
    ),
    unassignedRunUsage: cost(
      usage.filter(
        (row) =>
          row.episode.startsWith(`${options.runId ?? 'daybook-study'}:`) && !recordedIds.has(row.episode),
      ),
      0,
      0,
    ),
    limitations: [
      'All inputs are synthetic. References are independently implemented decimal fixture calculations, not audited business records. No independent human adjudication is claimed.',
      'The primary score measures structured task success against frozen facts, scope, evidence IDs, proposal lines and explicit assumption/clarification tags. Natural-language summary faithfulness and usefulness still need human review.',
      'Grounding scores measure source provenance: required source IDs, actual result-value bindings and deterministic calculations. They do not establish full semantic entailment of every citation. Supplemental claims without an independent reference or exact trusted-result binding are penalized as unassessed.',
      'Automated scores are out of 90. The 10-point human clarity dimension and the combined 100-point score are unavailable; they are not imputed by another model.',
      'Provider/tool errors count as failed end-to-end episodes. Conditional quality excludes status:error episodes and includes intentional blocks; it is not a replacement denominator.',
      'Confidence intervals resample scenario groups within families. Paraphrases and repeat runs are correlated and stay together. Small synthetic samples do not establish real-world accuracy or safety.',
      'All displayed 95% bootstrap intervals are unadjusted for the nine predeclared component contrasts and additional descriptive contrasts. They are exploratory effect estimates, not simultaneous confidence guarantees or claims of statistical significance. Two-group pilot and five-group-per-family held-out intervals may have poor coverage; zero-width empirical intervals do not establish certainty.',
      'Reported monetary amounts are paid-equivalent estimates from returned usage and configured rates, not invoices. Unreported usage remains a separately identified conservative reservation; indexing/setup is separate.',
      'Managed File Search uses the Interactions API to identify source citations. Its citation order is not a raw retrieval rank or exposed passage list. Authorized source IDs are mapped to the shared canonical documents before answer generation. This is managed source selection, not a like-for-like chunk retriever; raw-passage recall, MRR and nDCG are unavailable unless independently exposed.',
      'Jev/LLM reviewers see supplied evidence, not ground truth, and can share generator errors. Their approval cannot override deterministic validation or database permissions.',
      'The Wren route evaluates the pinned OSS semantic engine with the shared planner and approved views. It does not measure the complete commercial Wren product.',
      'An incomplete route has no full-study conclusion. Missing episodes are reported separately, never silently removed or treated as free successful requests.',
      'Episode completeness and snapshot integrity are separate gates. Changed or unverified before/after data makes this report ineligible for comparative selection even if every episode is present. Individual routes with hard-gate violations remain disqualified.',
      ...(options.extraLimitations ?? []),
    ],
  };
}

const percentage = (value: number | null) => (value === null ? 'N/A' : `${(100 * value).toFixed(1)}%`);
const number = (value: number | null, digits = 1) => (value === null ? 'N/A' : value.toFixed(digits));
const money = (value: number | null) => (value === null ? 'N/A' : `$${value.toFixed(5)}`);
const seconds = (value: number | null) => (value === null ? 'N/A' : `${(value / 1000).toFixed(2)}s`);
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const md = (value: unknown) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

export function renderMarkdown(report: StudyReport) {
  const lines = [
    '# Daybook comparative architecture study',
    '',
    `Run: ${md(report.runId)} · Dataset: ${md(report.datasetVersion)} · Split: **${report.split}** · Generated: ${report.generatedAt}`,
    '',
    report.complete
      ? 'All planned route episodes are present. This establishes measurement completeness, not correctness of every answer.'
      : '**Incomplete study:** one or more routes lack planned episodes. Do not select a winner from missing measurements.',
    '',
    `Snapshot integrity (${report.snapshotIntegrity.scope}): **${report.snapshotIntegrity.status}**. ${report.eligibleForConclusion ? 'Complete measurements and the supplied integrity check permit comparative interpretation, subject to the limitations and route hard gates.' : '**Ineligible for comparative selection:** measurement completeness and verified snapshot integrity are both required.'}`,
    ...(report.snapshotIntegrity.reason ? ['', md(report.snapshotIntegrity.reason)] : []),
    '',
    '## Results',
    '',
    '| Route | Completed / planned | Structured success | Macro across six families | Automated /90 | Error rate | p50 / p95 | Budget-equivalent / success |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |',
    ...report.routes.map(
      (route) =>
        `| ${route.route} ${route.label}${route.disqualified ? ' — DISQUALIFIED' : ''} | ${route.episodes}/${route.plannedEpisodes} | ${route.successes}/${route.episodes} (${percentage(route.microSuccessRate)}) | ${percentage(route.macroSuccessRate)} | ${number(route.automatedScore90)} | ${percentage(route.errorRate)} | ${seconds(route.p50Ms)} / ${seconds(route.p95Ms)} | ${money(route.cost.budgetUsdPerSuccess)} |`,
    ),
    '',
    'Errors remain in the end-to-end denominator. Scores assess structured claims; prose clarity/faithfulness has not been independently reviewed. Blank capabilities and missing runs are not successes.',
    '',
    '## Per-family success',
    '',
    `| Route | ${FAMILIES.join(' | ')} |`,
    `| --- | ${FAMILIES.map(() => '---:').join(' | ')} |`,
    ...report.routes.map(
      (route) =>
        `| ${route.route} | ${route.families.map((family) => `${percentage(family.rate)} (n=${family.episodes})`).join(' | ')} |`,
    ),
    '',
    '## Paired effects',
    '',
    'Difference in structured success, percentage points; positive favors the treatment. Intervals resample scenario groups, retaining paraphrases/repeats together. Comparisons use paired question/repeat IDs only. H1–H7 identify the predeclared component hypotheses. Additional R0 contrasts are descriptive. All intervals are unadjusted for multiple comparisons; no significance claim is made.',
    '',
    '| Hypothesis | Treatment / control | Paired episodes | Groups | Difference | Unadjusted 95% group interval |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...report.comparisons.map(
      ({ hypothesis, route, control, effect }) =>
        `| ${hypothesis} | ${route} / ${control} | ${effect?.pairedEpisodes ?? 0} | ${effect?.groups ?? 0} | ${effect ? `${(100 * effect.estimate).toFixed(1)} pp` : 'N/A'} | ${effect?.low == null || effect.high == null ? 'N/A' : `${(100 * effect.low).toFixed(1)} to ${(100 * effect.high).toFixed(1)} pp`} |`,
    ),
    '',
    '## Cost and usage',
    '',
    '| Route | Calls | Reported input / output tokens | Unknown usage calls | Reported-use estimate | Unknown-use reservation | Total budget accounting |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.routes.map(
      (route) =>
        `| ${route.route} | ${route.cost.calls} | ${route.cost.inputTokensReported} / ${route.cost.outputTokensReported} | ${route.cost.unknownUsageCalls} | ${money(route.cost.reportedUsageEquivalentUsd)} | ${money(route.cost.unknownUsageReservationUsd)} | ${money(route.cost.budgetChargedUsd)} |`,
    ),
    '',
    `Separate setup/indexing: ${report.setup.calls} calls, ${money(report.setup.reportedUsageEquivalentUsd)} reported-use estimate and ${money(report.setup.unknownUsageReservationUsd)} unknown-use reservation. Shared indexing is not charged again for every route.`,
    '',
    `Unassigned requests for this run (for example, an interrupted episode with no recorded outcome): ${report.unassignedRunUsage.calls} calls, ${money(report.unassignedRunUsage.budgetChargedUsd)} in reported-use estimates plus reservations. These are excluded from per-route averages until their outcomes are reconciled; they are not free.`,
    '',
    '## Failure analysis',
    '',
    ...report.routes.flatMap((route) => [
      `### ${route.route} ${route.label}`,
      '',
      route.episodes
        ? `Non-error conditional success: ${percentage(route.conditionalSuccessRate)} (n=${route.completedEpisodes}). Missing planned episodes: ${route.missingEpisodes}.`
        : 'No episodes measured.',
      '',
      ...route.failures.map((failure) => `- ${failure.kind}: ${failure.episodes} episodes.`),
      ...(route.disqualified ? [`- Hard gates: ${route.hardGateViolations.map(md).join(', ')}.`] : []),
      '',
    ]),
    '## Methods and limits',
    '',
    ...report.limitations.map((limitation) => `- ${limitation}`),
    '',
    'Full per-episode scores and failed rubric checks are in `results.json`. Visual figures are in the standalone `report.html`; it contains no third-party scripts or fonts.',
    '',
  ];
  return lines.join('\n');
}

function chart(title: string, description: string, height: number, body: string) {
  return `<svg viewBox="0 0 960 ${height}" role="img" xmlns="http://www.w3.org/2000/svg"><title>${escape(title)}</title><desc>${escape(description)}</desc><rect width="960" height="${height}" fill="white"/>${body}</svg>`;
}
function label(x: number, y: number, text: string, extra = '') {
  return `<text x="${x}" y="${y}" ${extra}>${escape(text)}</text>`;
}
function successChart(report: StudyReport) {
  const left = 220,
    width = 650;
  let body = [0, 25, 50, 75, 100]
    .map(
      (tick) =>
        `<line x1="${left + (width * tick) / 100}" y1="25" x2="${left + (width * tick) / 100}" y2="340" stroke="#e2e8f0"/>${label(left + (width * tick) / 100, 365, `${tick}%`, 'text-anchor="middle"')}`,
    )
    .join('');
  report.routes.forEach((route, index) => {
    const y = 44 + index * 35;
    body += label(10, y + 3, `${route.route} ${route.label}`);
    const value = route.macroSuccessRate;
    if (value === null) {
      body += label(left + 5, y + 3, 'N/A — missing family data', 'fill="#64748b"');
      return;
    }
    body += `<rect x="${left}" y="${y - 10}" width="${width * value}" height="18" rx="2" fill="${route.route === 'R0' ? '#334155' : '#2563eb'}"/>`;
    const ci = route.confidence;
    if (ci?.low != null && ci.high != null) {
      const x1 = left + width * ci.low,
        x2 = left + width * ci.high;
      body += `<path d="M${x1},${y - 5}V${y + 5}M${x1},${y}H${x2}M${x2},${y - 5}V${y + 5}" stroke="#0f172a" stroke-width="1.5" fill="none"/>`;
    }
    body += label(900, y + 3, percentage(value), 'text-anchor="end"');
  });
  return chart(
    'Macro structured task success',
    'All six families have equal weight. Whiskers are 95 percent scenario-group bootstrap intervals, where estimable. N/A is missing data, not zero.',
    385,
    body,
  );
}
function familyChart(report: StudyReport) {
  const left = 220,
    cell = 116;
  let body = FAMILIES.map((family, index) =>
    label(left + cell * index + cell / 2, 30, family, 'text-anchor="middle"'),
  ).join('');
  report.routes.forEach((route, row) => {
    const y = 50 + row * 39;
    body += label(10, y + 22, `${route.route} ${route.label}`);
    route.families.forEach((family, column) => {
      const value = family.rate;
      const shade =
        value === null
          ? '#f1f5f9'
          : `rgb(${Math.round(240 - value * 190)},${Math.round(245 - value * 140)},${Math.round(255 - value * 35)})`;
      body += `<rect x="${left + column * cell}" y="${y}" width="${cell - 4}" height="34" rx="2" fill="${shade}"/>`;
      body += label(
        left + column * cell + (cell - 4) / 2,
        y + 21,
        `${percentage(value)} · ${family.episodes}`,
        `text-anchor="middle" font-size="11" fill="${value !== null && value > 0.6 ? 'white' : '#0f172a'}"`,
      );
    });
  });
  return chart(
    'Success by family',
    'Each cell shows structured success percentage and the number of measured episodes. N/A means no measured episodes.',
    420,
    body,
  );
}
function latencyChart(report: StudyReport) {
  const maximum = Math.max(1, ...report.routes.map((route) => route.p95Ms ?? 0));
  const left = 220,
    width = 650;
  let body = '';
  report.routes.forEach((route, index) => {
    const y = 35 + index * 38;
    body += label(10, y + 4, `${route.route} ${route.label}`);
    if (route.p95Ms === null || route.p50Ms === null) {
      body += label(left, y + 4, 'N/A');
      return;
    }
    body += `<rect x="${left}" y="${y - 9}" width="${(width * route.p95Ms) / maximum}" height="18" rx="2" fill="#bfdbfe"/><rect x="${left}" y="${y - 9}" width="${(width * route.p50Ms) / maximum}" height="18" rx="2" fill="#2563eb"/>`;
    body += label(
      940,
      y + 4,
      `${seconds(route.p50Ms)} / ${seconds(route.p95Ms)}`,
      'text-anchor="end" font-size="11"',
    );
  });
  for (let tick = 0; tick <= 4; tick++)
    body += label(left + (width * tick) / 4, 395, seconds((maximum * tick) / 4), 'text-anchor="middle"');
  return chart(
    'Episode latency p50 and p95',
    'Dark bars are median and light bars are 95th percentile recorded episode latency, including failed episodes. Queue/orchestration time is included when measured by the runner.',
    420,
    body,
  );
}
function costChart(report: StudyReport) {
  const rows = report.routes.filter(
    (route) => route.macroSuccessRate !== null && route.cost.budgetUsdPerEpisode !== null,
  );
  const maximum = Math.max(0.0001, ...rows.map((route) => route.cost.budgetUsdPerEpisode!));
  const left = 90,
    top = 35,
    width = 760,
    height = 300;
  let body = '';
  for (let tick = 0; tick <= 4; tick++) {
    const y = top + height * (1 - tick / 4);
    body += `<line x1="${left}" y1="${y}" x2="${left + width}" y2="${y}" stroke="#e2e8f0"/>${label(left - 12, y + 4, `${tick * 25}%`, 'text-anchor="end"')}`;
    body += label(
      left + (width * tick) / 4,
      top + height + 28,
      money((maximum * tick) / 4),
      'text-anchor="middle"',
    );
  }
  for (const route of rows) {
    const x = left + (width * route.cost.budgetUsdPerEpisode!) / maximum;
    const y = top + height * (1 - route.macroSuccessRate!);
    body += `<circle cx="${x}" cy="${y}" r="6" fill="${route.route === 'R0' ? '#334155' : '#2563eb'}"><title>${escape(`${route.route}: ${percentage(route.macroSuccessRate)}, ${money(route.cost.budgetUsdPerEpisode)} per episode`)}</title></circle>${label(x + 9, y - 8, route.route)}`;
  }
  if (!rows.length)
    body += label(400, 190, 'No complete-family cost/success points yet.', 'text-anchor="middle"');
  body += label(
    470,
    400,
    'Budget-equivalent USD per episode, including unknown-use reservations',
    'text-anchor="middle"',
  );
  return chart(
    'Quality versus cost',
    'Vertical axis is macro structured success; horizontal axis is estimated plus reserved provider cost per episode. Setup/indexing is excluded and separately reported. Lower cost and higher success are preferable, subject to safety gates.',
    430,
    body,
  );
}

export function renderHtml(report: StudyReport) {
  const rows = report.routes
    .map(
      (route) =>
        `<tr><th>${route.route}<small>${escape(route.label)}</small></th><td>${route.episodes}/${route.plannedEpisodes}</td><td>${percentage(route.macroSuccessRate)}</td><td>${number(route.automatedScore90)} /90</td><td>${percentage(route.errorRate)}</td><td>${seconds(route.p50Ms)} / ${seconds(route.p95Ms)}</td><td>${money(route.cost.budgetUsdPerSuccess)}</td><td>${route.disqualified ? 'Disqualified' : !route.complete ? 'Incomplete' : report.eligibleForConclusion ? 'Measured' : 'Integrity unverified or changed'}</td></tr>`,
    )
    .join('');
  const comparisons = report.comparisons
    .filter((item) => item.effect)
    .map(
      ({ hypothesis, route, control, effect }) =>
        `<tr><th>${hypothesis}: ${route} − ${control}</th><td>${effect!.pairedEpisodes}</td><td>${effect!.groups}</td><td>${(100 * effect!.estimate).toFixed(1)} pp</td><td>${effect!.low === null || effect!.high === null ? 'N/A' : `${(100 * effect!.low).toFixed(1)} to ${(100 * effect!.high).toFixed(1)} pp`}</td><td>${effect!.unpairedTreatment + effect!.unpairedControl}</td></tr>`,
    )
    .join('');
  const failures = report.routes
    .map(
      (route) =>
        `<details><summary>${route.route} ${escape(route.label)} — ${route.episodes - route.successes}/${route.episodes} unsuccessful episodes</summary><p>Conditional success among ${route.completedEpisodes} non-error episodes: ${percentage(route.conditionalSuccessRate)}. This excludes failed provider/tool episodes and is not the headline metric.</p>${route.failures.length ? `<ul>${route.failures.map((failure) => `<li>${escape(failure.kind)}: ${failure.episodes}</li>`).join('')}</ul>` : '<p>No failed checks in the measured episodes.</p>'}${route.disqualified ? `<p class="danger">Hard-gate violations: ${route.hardGateViolations.map(escape).join(', ')}</p>` : ''}</details>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daybook architecture study</title><style>
  :root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f4ef;font-synthesis:none}*{box-sizing:border-box}body{margin:0}main{max-width:1160px;margin:0 auto;padding:48px 32px 80px}header{border-bottom:2px solid #172033;padding-bottom:26px;margin-bottom:28px}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#556175}h1{font-family:Georgia,serif;font-weight:normal;font-size:44px;line-height:1.1;margin:12px 0}h2{font-size:24px;margin:38px 0 14px}p{line-height:1.6;max-width:88ch}small{display:block;font-weight:normal;color:#5c687a;margin-top:3px}.notice{padding:15px 18px;background:#fff5d8;border-left:4px solid #b07c12}.complete{background:#e9f4ee;border-color:#267149}.table-wrap{overflow:auto;border:1px solid #d4d8df;background:white}table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}th,td{padding:13px 12px;text-align:right;border-bottom:1px solid #e6e8ec;white-space:nowrap}th:first-child,td:first-child{text-align:left}thead{background:#edf0f4}figure{background:white;border:1px solid #d4d8df;margin:22px 0;padding:20px}figcaption{font-size:13px;line-height:1.5;color:#566176;margin:10px 0 0}svg{width:100%;height:auto;display:block}svg text{font-family:system-ui,sans-serif;font-size:13px;fill:#172033}details{border-bottom:1px solid #d4d8df;padding:16px 0}summary{font-weight:600;cursor:pointer}li{line-height:1.6;margin-bottom:7px}.danger{color:#9b1c1c}code{font-size:.9em}footer{margin-top:40px;border-top:1px solid #b9c0cb;padding-top:16px;color:#5c687a;font-size:12px}@media(max-width:640px){main{padding:28px 16px}h1{font-size:34px}figure{padding:8px}svg{min-width:700px}figure{overflow:auto}}@media print{body{background:white}main{max-width:none;padding:0}figure,table{break-inside:avoid}details{display:block}details>*{display:block}summary{list-style:none}h2{break-after:avoid}}
  </style></head><body><main><header><div class="eyebrow">Daybook · Reproducible engineering study</div><h1>Which architecture earns its complexity?</h1><p>Nine configurations, one synthetic accounting benchmark. Compare structured correctness, source grounding, latency and cost before selecting product components.</p><small>${escape(report.runId)} · ${escape(report.datasetVersion)} · ${escape(report.split)} · ${escape(report.generatedAt)}${report.sourceRevision ? ` · published ancestor ${escape(report.sourceRevision)}` : ''}</small></header>
  <p class="notice ${report.eligibleForConclusion ? 'complete' : ''}">${report.eligibleForConclusion ? 'Every planned episode is recorded and the supplied snapshot integrity check is verified. Results remain subject to methodological limits and individual route hard gates.' : 'Ineligible for comparative selection: complete measurements and verified snapshot integrity are both required.'} Snapshot integrity (${escape(report.snapshotIntegrity.scope)}): ${escape(report.snapshotIntegrity.status)}. ${report.complete ? 'All planned episodes are recorded.' : 'Incomplete study: one or more routes have missing episodes.'} ${escape(report.snapshotIntegrity.reason ?? '')}</p><p>Exact evaluated working-source hashes and runtime details are recorded in source-manifest.json; a published ancestor revision alone does not identify the evaluated working tree.</p>
  <h2>Measured outcomes</h2><p>The primary metric is structured task success, macro-averaged across six families. Errors count as failures. Automated rubric scores stop at 90; human clarity and the combined 100-point score are unavailable.</p><div class="table-wrap"><table><thead><tr><th>Configuration</th><th>Run / planned</th><th>Macro success</th><th>Automated</th><th>Errors</th><th>p50 / p95</th><th>Cost / success</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
  <figure>${successChart(report)}<figcaption><b>Figure 1.</b> Equal-weight family macro success. Whiskers: unadjusted 95% scenario-group bootstrap intervals, where at least two groups per represented family permit estimation. Repeated paraphrases are not independent samples. Few groups can give poor coverage; a zero-width empirical interval does not establish certainty.</figcaption></figure>
  <figure>${familyChart(report)}<figcaption><b>Figure 2.</b> Success by task family. Cells show percentage · episode count. This exposes coverage differences that a single average can hide.</figcaption></figure>
  <figure>${latencyChart(report)}<figcaption><b>Figure 3.</b> Recorded end-to-end episode latency: median (dark) and 95th percentile (light). Failed episodes remain included. Local queue/orchestration delays may be present; these figures are not a server-load benchmark.</figcaption></figure>
  <figure>${costChart(report)}<figcaption><b>Figure 4.</b> Success versus paid-equivalent provider budget per episode. Unknown usage reservations are included; indexing is separate. A promising point is not a deployment recommendation if it fails a hard gate or has incomplete coverage.</figcaption></figure>
  <h2>Paired comparisons</h2><p>Positive differences favor the treatment. H1–H7 label predeclared component comparisons; additional R0 comparisons are descriptive. Only matching question/repeat pairs contribute. All intervals are unadjusted for multiple comparisons; no statistical significance claim is made. R0 reproduces the current control architecture with the shared study model, rather than measuring an unchanged production deployment.</p><div class="table-wrap"><table><thead><tr><th>Treatment − control</th><th>Paired episodes</th><th>Scenario groups</th><th>Difference</th><th>Unadjusted 95% interval</th><th>Unpaired omitted</th></tr></thead><tbody>${comparisons || '<tr><td colspan="6">No paired measurements yet.</td></tr>'}</tbody></table></div>
  <h2>Cost accounting</h2><p>These are configured-rate equivalents, not a billing invoice. A null usage response is never claimed free. Shared setup/indexing: ${report.setup.calls} calls; reported-use estimate ${money(report.setup.reportedUsageEquivalentUsd)}; unknown-use reservation ${money(report.setup.unknownUsageReservationUsd)}. Unassigned requests for this run: ${report.unassignedRunUsage.calls} calls, ${money(report.unassignedRunUsage.budgetChargedUsd)} estimated/reserved. Unassigned requests lack a selected recorded episode; their cost remains visible and is excluded from per-route averages until reconciliation.</p><div class="table-wrap"><table><thead><tr><th>Route</th><th>Calls</th><th>Input / output tokens reported</th><th>Unknown usage calls</th><th>Known-use estimate</th><th>Unknown reservation</th></tr></thead><tbody>${report.routes.map((route) => `<tr><th>${route.route}</th><td>${route.cost.calls}</td><td>${route.cost.inputTokensReported} / ${route.cost.outputTokensReported}</td><td>${route.cost.unknownUsageCalls}</td><td>${money(route.cost.reportedUsageEquivalentUsd)}</td><td>${money(route.cost.unknownUsageReservationUsd)}</td></tr>`).join('')}</tbody></table></div>
  <h2>Failure analysis</h2>${failures}<h2>Methods and limits</h2><ol>${report.limitations.map((limitation) => `<li>${escape(limitation)}</li>`).join('')}</ol><footer>Standalone report: inline SVG figures, system fonts, no external scripts or network dependencies. All per-episode outcomes and failed rubric checks are available in results.json. Print or save as PDF for a portable copy.</footer></main></body></html>`;
}

export function writeReport(directory: string, report: StudyReport) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(directory, 'report.md'), renderMarkdown(report));
  writeFileSync(join(directory, 'report.html'), renderHtml(report));
  return {
    json: join(directory, 'results.json'),
    markdown: join(directory, 'report.md'),
    html: join(directory, 'report.html'),
  };
}
