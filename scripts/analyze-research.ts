/** Supplemental analysis only: deliberately outside the frozen research runtime tree. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getReference, type ReferenceAnswer } from '../research/reference';
import { ROUTES, ROUTE_LABELS, scoreEpisode, type StudyEpisode, type StudyRoute } from '../research/scoring';

const K = 6;
export interface SupplementalEpisode extends StudyEpisode {
  retrievedIds?: string[];
  plan?: { retrievalQuery?: string; intent?: string };
}
export interface ProviderCallTiming {
  id?: string;
  episode: string;
  durationMs?: number | null;
}
export interface ProviderTimingObservation {
  id: string;
  route: StudyRoute;
  status: StudyEpisode['status'];
  coverage: 'complete' | 'partial' | 'unknown' | 'unverified' | 'not_called';
  recordedCalls: number | null;
  measuredCalls: number | null;
  missingCalls: number | null;
  completeDurationMs: number | null;
  partialMeasuredDurationMs: number | null;
  legacyAggregateMs: number | null;
}
export interface StudyValidityNotice {
  runId: string;
  eligibleForSelection: boolean;
  originalResultsSha256: string;
  classification?: string;
  interpretation?: string;
  issues: { code?: string; detail: string }[];
}
export function validateStudyValidityNotice(
  notice: StudyValidityNotice | undefined,
  runId?: string,
  resultsHash?: string,
) {
  if (notice === undefined) return;
  if (
    !notice ||
    notice.runId !== runId ||
    typeof notice.eligibleForSelection !== 'boolean' ||
    !Array.isArray(notice.issues) ||
    notice.issues.some((issue) => !issue || typeof issue.detail !== 'string')
  )
    throw new Error('INVALID_STUDY_VALIDITY_NOTICE');
  if (resultsHash !== undefined && notice.originalResultsSha256 !== resultsHash)
    throw new Error('VALIDITY_NOTICE_RESULTS_HASH_MISMATCH');
}
type Stage = 'completed' | 'skipped' | 'unknown' | 'unsupported';
export type RetrievalObservation = {
  id: string;
  route: StudyRoute;
  questionId: string;
  groupId: string;
  split: StudyEpisode['split'];
  status: StudyEpisode['status'];
  applicable: boolean;
  requiredDocumentIds: string[];
  stage: Stage;
  recordedDocumentIds: string[] | null;
  duplicateIds: string[];
  selectedDocumentRecallAt6: number | null;
  recallAt6: number | null;
  reciprocalRankAt6: number | null;
  ndcgAt6: number | null;
  rankMetricsUnavailableReason: string | null;
  missingRequiredDocumentIds: string[] | null;
  releasedOutcomeHasAllRequiredDocuments: boolean | null;
  failures: string[];
};
export function rankedDocumentMetrics(ids: string[], relevant: string[], k = K) {
  if (!Number.isSafeInteger(k) || k < 1) throw new Error('INVALID_RETRIEVAL_CUTOFF');
  const gold = new Set(relevant);
  if (!gold.size) return { recall: null, reciprocalRank: null, ndcg: null };
  const seen = new Set<string>();
  let hits = 0,
    first = 0,
    dcg = 0;
  // Duplicate documents consume their actual positions, without duplicate credit.
  ids.slice(0, k).forEach((id, index) => {
    if (gold.has(id) && !seen.has(id)) {
      hits++;
      first ||= index + 1;
      dcg += 1 / Math.log2(index + 2);
    }
    seen.add(id);
  });
  let ideal = 0;
  for (let i = 0; i < Math.min(k, gold.size); i++) ideal += 1 / Math.log2(i + 2);
  return { recall: hits / gold.size, reciprocalRank: first ? 1 / first : 0, ndcg: dcg / ideal };
}

function operationFailure(error: unknown): string {
  const text = typeof error === 'string' ? error.toUpperCase() : '';
  if (/RATE_LIMIT|\b429\b/.test(text)) return 'provider_rate_limit';
  if (/TIMEOUT|DEADLINE|QUEUE_NOT_SERVICED/.test(text)) return 'timeout_or_deadline';
  if (
    /BUDGET_EXHAUSTED|CIRCUIT_OPEN|GENERATOR_LIMIT|REVIEWER_LIMIT|TOOL_LIMIT|EMBEDDING_LIMIT|RERANK_LIMIT/.test(
      text,
    )
  )
    return 'budget_or_call_limit';
  if (/AUTH_ERROR|NOT_CONFIGURED|\b401\b|\b403\b/.test(text)) return 'authentication_or_configuration';
  if (/FILE_SEARCH_NOT_INDEXED|VECTOR_INDEX_INCOMPLETE|INDEX_FAILED/.test(text))
    return 'retrieval_index_unavailable';
  if (/INVALID_RESPONSE|INVALID_REQUEST|SCHEMA|ZOD|DUPLICATE_QUERY|WRONG_BACKEND|BLOCK_WITH_TOOL/.test(text))
    return 'provider_or_plan_contract';
  if (/WREN|SQL|DATABASE|POSTGRES|QUERY_/.test(text)) return 'query_or_backend';
  if (/INTERRUPTED/.test(text)) return 'interrupted_attempt';
  if (/NETWORK|HTTP_FAILURE|HTTP_5\d\d|PROVIDER_ERROR|MODEL_UNAVAILABLE/.test(text))
    return 'provider_or_network_failure';
  return 'unclassified_operational_error';
}
function reviewDecision(value: unknown): unknown {
  if (!value || typeof value !== 'object') return null;
  const review = value as { decision?: unknown; data?: { decision?: unknown } };
  return review.decision ?? review.data?.decision;
}

export function retrievalObservation(
  episode: SupplementalEpisode,
  reference: ReferenceAnswer,
): RetrievalObservation {
  const gold = [...new Set(reference.requiredDocumentIds)];
  const applicable = gold.length > 0;
  const supported = !['R0', 'R1'].includes(episode.route);
  const ids = episode.retrievedIds;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)))
    throw new Error('INVALID_RETRIEVED_DOCUMENT_IDS');
  const query = episode.plan?.retrievalQuery;
  const stage: Stage = !supported
    ? 'unsupported'
    : query === ''
      ? 'skipped'
      : ids !== undefined && ((typeof query === 'string' && query.length > 0) || ids.length > 0)
        ? 'completed'
        : 'unknown';
  const top = ids?.slice(0, K) ?? null;
  const duplicateIds = ids ? [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))] : [];
  const selected =
    stage === 'completed' && applicable && top !== null ? rankedDocumentMetrics(top, gold) : null;
  const ranksComparable = selected !== null && episode.route !== 'R3';
  const missing = !applicable ? [] : top === null ? null : gold.filter((id) => !top.includes(id));
  const evidenceIds = new Set(
    (episode.evidence ?? [])
      .filter((source) => source.kind === 'document' && source.documentId)
      .filter(
        (source) =>
          !episode.organizationId ||
          !source.organizationId ||
          source.organizationId === episode.organizationId,
      )
      .map((source) => source.documentId!),
  );
  // End-to-end delivery is an operational outcome. Errors/blocks deliver no answer;
  // this zero is NOT attributed to the unknown retrieval stage on failed episodes.
  const released = applicable
    ? episode.status === 'ok' && Boolean(episode.answer) && gold.every((id) => evidenceIds.has(id))
    : null;
  const failures: string[] = [];
  if (episode.status === 'error') failures.push(`operational:${operationFailure(episode.error)}`);
  if (applicable && stage === 'unsupported') failures.push('capability:documents_unavailable');
  if (applicable && stage === 'skipped') failures.push('planner:retrieval_not_requested');
  if (applicable && stage === 'unknown') failures.push('observability:retrieval_stage_unknown');
  if (applicable && stage === 'completed' && missing?.length)
    failures.push('retrieval:missing_required_document');
  if (duplicateIds.length) failures.push('observability:duplicate_document_id');
  if (episode.validation?.valid === false || episode.validation?.passed === false)
    failures.push('gate:deterministic_rejection');
  if (['BLOCK', 'CLARIFY'].includes(String(reviewDecision(episode.review))))
    failures.push('gate:semantic_rejection');
  if (episode.status === 'blocked' && !failures.some((item) => item.startsWith('gate:')))
    failures.push('gate:unspecified_rejection');
  const score = scoreEpisode(episode, reference);
  if (score.hardGateViolations.length) failures.push('safety:hard_gate_violation');
  for (const failure of score.failures) {
    // Structured fact mismatch also includes key/scope/schema compliance; do not
    // relabel it a proven arithmetic or monetary error.
    if (/^[a-z0-9_]+$/.test(failure)) failures.push(`structured_answer:${failure}`);
  }
  return {
    id: episode.id,
    route: episode.route,
    questionId: episode.questionId,
    groupId: episode.groupId,
    split: episode.split,
    status: episode.status,
    applicable,
    requiredDocumentIds: gold,
    stage,
    recordedDocumentIds: top,
    duplicateIds,
    selectedDocumentRecallAt6: selected?.recall ?? null,
    recallAt6: ranksComparable ? selected.recall : null,
    reciprocalRankAt6: ranksComparable ? selected.reciprocalRank : null,
    ndcgAt6: ranksComparable ? selected.ndcg : null,
    rankMetricsUnavailableReason: !applicable
      ? 'No required document labels for this question.'
      : episode.route === 'R3'
        ? 'Managed citation order is not raw search rank; only selected-document coverage is measured.'
        : stage !== 'completed'
          ? `Retrieval stage ${stage}; no comparable completed ranking.`
          : null,
    missingRequiredDocumentIds: missing,
    releasedOutcomeHasAllRequiredDocuments: released,
    failures: [...new Set(failures)],
  };
}
function mean(values: (number | null)[]) {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}
function countFailures(rows: RetrievalObservation[]) {
  const counts = new Map<string, number>();
  for (const row of rows)
    for (const failure of row.failures) counts.set(failure, (counts.get(failure) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, episodes]) => ({ category, episodes }));
}
function timingValues(input: (number | null | undefined)[]) {
  const values = input
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const percentile = (probability: number) =>
    values.length ? values[Math.max(0, Math.ceil(probability * values.length) - 1)] : null;
  return {
    measured: values.length,
    unknown: input.length - values.length,
    recordedZeros: values.filter((value) => value === 0).length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
  };
}
export function providerTimingObservation(
  episode: SupplementalEpisode,
  usage?: ProviderCallTiming[],
): ProviderTimingObservation {
  const raw = episode.providerDurationMs;
  const base = {
    id: episode.id,
    route: episode.route,
    status: episode.status,
    legacyAggregateMs: typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null,
  };
  if (usage === undefined)
    return {
      ...base,
      coverage: 'unverified',
      recordedCalls: null,
      measuredCalls: null,
      missingCalls: null,
      completeDurationMs: null,
      partialMeasuredDurationMs: null,
    };
  const calls = usage.filter((row) => row.episode === episode.id);
  if (!calls.length && (base.legacyAggregateMs ?? 0) > 0)
    throw new Error('USAGE_SNAPSHOT_MISSING_EPISODE_CALLS');
  const known = calls
    .map((row) => row.durationMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const missing = calls.length - known.length;
  const sum = known.reduce((total, value) => total + value, 0);
  return {
    ...base,
    coverage: !calls.length ? 'not_called' : !missing ? 'complete' : known.length ? 'partial' : 'unknown',
    recordedCalls: calls.length,
    measuredCalls: known.length,
    missingCalls: missing,
    completeDurationMs: calls.length && !missing ? sum : null,
    partialMeasuredDurationMs: missing && known.length ? sum : null,
  };
}
function latencySummary(episodes: SupplementalEpisode[], usage?: ProviderCallTiming[]) {
  const summarize = (rows: SupplementalEpisode[]) => {
    const timings = rows.map((row) => providerTimingObservation(row, usage));
    const counts = (kind: ProviderTimingObservation['coverage']) =>
      timings.filter((row) => row.coverage === kind).length;
    return {
      episodes: rows.length,
      wall: timingValues(rows.map((row) => row.durationMs)),
      providerHttpSum: {
        ...timingValues(
          timings.filter((row) => row.coverage !== 'not_called').map((row) => row.completeDurationMs),
        ),
        completeEpisodes: counts('complete'),
        partialEpisodes: counts('partial'),
        unknownEpisodes: counts('unknown'),
        unverifiedEpisodes: counts('unverified'),
        noCallEpisodes: counts('not_called'),
        recordedCalls:
          usage === undefined ? null : timings.reduce((total, row) => total + (row.recordedCalls ?? 0), 0),
        measuredCalls:
          usage === undefined ? null : timings.reduce((total, row) => total + (row.measuredCalls ?? 0), 0),
        missingCalls:
          usage === undefined ? null : timings.reduce((total, row) => total + (row.missingCalls ?? 0), 0),
      },
      providerPartialHttpSum: timingValues(
        timings.filter((row) => row.coverage === 'partial').map((row) => row.partialMeasuredDurationMs),
      ),
    };
  };
  return {
    allAttempts: summarize(episodes),
    nonError: summarize(episodes.filter((episode) => episode.status !== 'error')),
  };
}
export function analyzeResearchSupplement(
  episodes: SupplementalEpisode[],
  referenceFor: (questionId: string) => ReferenceAnswer = getReference,
  options: {
    split?: StudyEpisode['split'];
    runId?: string;
    createdAt?: string;
    usage?: ProviderCallTiming[];
    validityNotice?: StudyValidityNotice;
  } = {},
) {
  validateStudyValidityNotice(options.validityNotice, options.runId);
  if (new Set(episodes.map((episode) => episode.id)).size !== episodes.length)
    throw new Error('DUPLICATE_EPISODE_ID');
  const selected = options.split ? episodes.filter((episode) => episode.split === options.split) : episodes;
  if (new Set(selected.map((episode) => episode.split)).size > 1)
    throw new Error('MIXED_SPLITS_REQUIRE_FILTER');
  const episodeIds = new Set(selected.map((episode) => episode.id));
  const usage = options.usage?.filter((row) => episodeIds.has(row.episode));
  if (usage) {
    const ids = usage.flatMap((row) => (row.id ? [row.id] : []));
    if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_USAGE_RECORD');
  }
  const observations = selected.map((episode) =>
    retrievalObservation(episode, referenceFor(episode.questionId)),
  );
  const routes = ROUTES.map((route) => {
    const rows = observations.filter((row) => row.route === route);
    const eligible = rows.filter((row) => row.applicable);
    const ranked = eligible.filter((row) => row.recallAt6 !== null);
    const coverage = eligible.filter((row) => row.selectedDocumentRecallAt6 !== null);
    const groups = [...new Set(ranked.map((row) => row.groupId))];
    return {
      route,
      label: ROUTE_LABELS[route],
      episodes: rows.length,
      documentApplicable: eligible.length,
      noDocumentLabel: rows.length - eligible.length,
      uniqueApplicableGroups: new Set(eligible.map((row) => row.groupId)).size,
      completedRetrievals: coverage.length,
      rankedRetrievals: ranked.length,
      skippedRetrievals: eligible.filter((row) => row.stage === 'skipped').length,
      unknownRetrievalStages: eligible.filter((row) => row.stage === 'unknown').length,
      unsupportedRetrievals: eligible.filter((row) => row.stage === 'unsupported').length,
      conditionalSelectedDocumentRecallAt6: mean(coverage.map((row) => row.selectedDocumentRecallAt6)),
      conditionalRecallAt6: mean(ranked.map((row) => row.recallAt6)),
      conditionalMrrAt6: mean(ranked.map((row) => row.reciprocalRankAt6)),
      conditionalNdcgAt6: mean(ranked.map((row) => row.ndcgAt6)),
      scenarioMacroConditionalRecallAt6: mean(
        groups.map((group) =>
          mean(ranked.filter((row) => row.groupId === group).map((row) => row.recallAt6)),
        ),
      ),
      releasedWithAllRequiredDocuments: eligible.filter((row) => row.releasedOutcomeHasAllRequiredDocuments)
        .length,
      endToEndRequiredDocumentAvailability: mean(
        eligible.map((row) => (row.releasedOutcomeHasAllRequiredDocuments ? 1 : 0)),
      ),
      failures: countFailures(rows),
      latency: latencySummary(
        selected.filter((episode) => episode.route === route),
        usage,
      ),
    };
  });
  return {
    schemaVersion: 'daybook-retrieval-supplement-v2',
    validityNotice: options.validityNotice ?? null,
    selectionStatus:
      options.validityNotice?.eligibleForSelection === false
        ? 'KNOWN STUDY DEFECTS / NOT FOR SELECTION'
        : 'Not assessed by supplemental analysis',
    runId: options.runId ?? 'unspecified',
    createdAt: options.createdAt ?? new Date().toISOString(),
    cutoff: K,
    split: options.split ?? selected[0]?.split ?? null,
    measuredEpisodes: selected.length,
    documentApplicableEpisodes: observations.filter((row) => row.applicable).length,
    routes,
    observations,
    timingObservations: selected.map((row) => providerTimingObservation(row, usage)),
    timingUsage: {
      available: usage !== undefined,
      matchedRecords: usage?.length ?? null,
      matchedRecordHash:
        usage === undefined
          ? null
          : createHash('sha256')
              .update(
                JSON.stringify(
                  usage.map((row) => ({ id: row.id, episode: row.episode, durationMs: row.durationMs })),
                ),
              )
              .digest('hex'),
      policy:
        'An explicit usage input must contain all provider attempt records for these episodes. Unmatched runs/setup records are excluded.',
    },
    failures: countFailures(observations),
    definitions: {
      relevance:
        'Binary required-document IDs from the independent reference; exact versions are distinct IDs. No graded relevance labels are invented.',
      conditionalRetrieval:
        'Only document-applicable episodes with recorded completed retrieval output. Explicit empty output after a requested search scores zero; unknown error stages and skipped searches are excluded and counted separately.',
      rankMetrics:
        'Recall@6 = distinct relevant hits / required documents. MRR@6 uses the first relevant rank, with0 if none in6. nDCG@6 uses binary gains and ideal ordering of up to6 required documents. R3 managed raw ranking metrics are unavailable.',
      managedCoverage:
        'R3 selected-document coverage measures the authorized documents selected through provider citations, not raw managed search recall or rank quality.',
      endToEnd:
        'Fraction of all recorded document-applicable episodes that released an unblocked result whose actual authorized evidence included every required document. Errors and blocked outcomes count as failed delivery, without assigning unknown retrieval stages a zero retrieval score.',
      taxonomy:
        'Multi-label observed conditions, not mutually exclusive causes. Structured fact mismatch may include semantic key, currency, entity, period or schema mismatch; it is not automatically an arithmetic error.',
      latency:
        'Nearest-rank p50/p95 for all attempts and separately non-error outcomes (including blocks). Harness wall includes pacing/queue waits. Complete HTTP totals require durations for every provider attempt in the explicit per-call usage snapshot. Partial known subtotals have separate percentiles; entirely unknown or unverified legacy aggregates are excluded. No-call episodes are disclosed separately. Provider sums are not production latency.',
    },
    limitations: [
      'Descriptive supplemental metrics on synthetic documents; no confidence intervals, causal claims, human citation-entailment judgments or publication-grade power are implied.',
      'Conditional retrieval results can be selected by planner decisions and upstream failures. Read them alongside skipped/unknown counts and end-to-end delivery.',
      'Required-document labels identify a reference evidence set, not an exhaustive set of every possibly relevant document.',
      'An absent final episode record is not an observed failure. Compare these measured denominators with the main run manifest for planned/missing episodes.',
      'Repeated episodes and paraphrases are clustered. Scenario-macro recall is also shown; no episode independence is assumed.',
      'The current runner may discard intermediate state after an exception. Unknown-stage errors cannot diagnose retrieval quality.',
    ],
  };
}

type Supplement = ReturnType<typeof analyzeResearchSupplement>;
const esc = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const pct = (value: number | null) => (value === null ? 'N/A' : `${(100 * value).toFixed(1)}%`);
export function renderRetrievalSvg(report: Supplement) {
  const width = 1020,
    height = report.validityNotice?.eligibleForSelection === false ? 496 : 470,
    origin = 240,
    scale = 570;
  const bars = report.routes
    .map((row, i) => {
      const y = 62 + i * 42;
      return `<text x="12" y="${y + 12}">${esc(row.route)} ${esc(row.label)}</text><rect x="${origin}" y="${y}" width="${scale * (row.conditionalSelectedDocumentRecallAt6 ?? 0)}" height="12" fill="#245f76"/><rect x="${origin}" y="${y + 15}" width="${scale * (row.endToEndRequiredDocumentAvailability ?? 0)}" height="12" fill="#c08a2d"/><text x="830" y="${y + 12}">${pct(row.conditionalSelectedDocumentRecallAt6)} (n=${row.completedRetrievals})</text><text x="830" y="${y + 28}">${pct(row.endToEndRequiredDocumentAvailability)} (n=${row.documentApplicable})</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">Required-document coverage and end-to-end availability</title><desc id="desc">Blue is mean conditional selected-document recall; gold is all-required-documents availability in released outcomes. Different denominators are printed. N/A means unmeasured.</desc><style>text{font:13px sans-serif;fill:#18242c}</style><rect width="100%" height="100%" fill="white"/><text x="12" y="23" style="font-size:17px;font-weight:bold">Required-document coverage — ${esc(report.runId)}</text><text x="240" y="43">0%</text><text x="785" y="43">100%</text>${bars}<text x="12" y="458">Blue: conditional selected-document recall · Gold: end-to-end all-required-document availability</text>${report.validityNotice?.eligibleForSelection === false ? '<text x="12" y="486" style="fill:#a34b43;font-weight:bold">KNOWN STUDY DEFECTS / NOT FOR SELECTION</text>' : ''}</svg>`;
}
export function renderSupplementHtml(report: Supplement) {
  const validityBanner =
    report.validityNotice?.eligibleForSelection === false
      ? `<section role="note" style="border:2px solid #a34b43;padding:16px"><h2>KNOWN STUDY DEFECTS / NOT FOR SELECTION</h2><p>${esc(report.validityNotice.classification ?? '')}</p><ul>${report.validityNotice.issues.map((issue) => `<li>${esc(issue.code ?? '')}: ${esc(issue.detail)}</li>`).join('')}</ul><p>${esc(report.validityNotice.interpretation ?? '')}</p><p>Original scores and episodes are retained. Completeness does not establish comparison validity.</p></section>`
      : '';
  const rows = report.routes
    .map(
      (row) =>
        `<tr><td>${esc(row.route)}</td><td>${row.completedRetrievals}/${row.documentApplicable}</td><td>${row.skippedRetrievals}/${row.unknownRetrievalStages}/${row.unsupportedRetrievals}</td><td>${pct(row.conditionalRecallAt6)}</td><td>${row.conditionalMrrAt6?.toFixed(3) ?? 'N/A'}</td><td>${row.conditionalNdcgAt6?.toFixed(3) ?? 'N/A'}</td><td>${pct(row.scenarioMacroConditionalRecallAt6)}</td><td>${pct(row.endToEndRequiredDocumentAvailability)}</td></tr>`,
    )
    .join('');
  const failures = report.failures
    .map((item) => `<tr><td>${esc(item.category)}</td><td>${item.episodes}</td></tr>`)
    .join('');
  const ms = (value: number | null) => (value === null ? 'N/A' : `${(value / 1000).toFixed(2)}s`);
  const latency = report.routes
    .flatMap((route) =>
      (['allAttempts', 'nonError'] as const).map((scope) => {
        const row = route.latency[scope];
        const service = row.providerHttpSum;
        return `<tr><td>${esc(route.route)}</td><td>${scope === 'allAttempts' ? 'All attempts' : 'Non-error'}</td><td>${row.episodes}</td><td>${ms(row.wall.p50Ms)} / ${ms(row.wall.p95Ms)}</td><td>${service.completeEpisodes}/${service.partialEpisodes}/${service.unknownEpisodes + service.unverifiedEpisodes}/${service.noCallEpisodes}</td><td>${ms(service.p50Ms)} / ${ms(service.p95Ms)}</td><td>${ms(row.providerPartialHttpSum.p50Ms)} / ${ms(row.providerPartialHttpSum.p95Ms)}</td></tr>`;
      }),
    )
    .join('');
  const latencySection = `<section><h2>Harness wall time and measured provider HTTP time</h2><p>Non-error includes blocked outcomes. C/P/U/N = complete / partial / unknown-or-unverified / no recorded calls. Complete HTTP totals require timing for every provider attempt; partial known subtotals are separate. Legacy episode aggregates are never assumed complete. These are not production latencies.</p><table><thead><tr><th>Route</th><th>Scope</th><th>Episodes</th><th>Wall p50 / p95</th><th>HTTP C/P/U/N</th><th>Complete HTTP p50 / p95</th><th>Partial subtotal p50 / p95</th></tr></thead><tbody>${latency}</tbody></table></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daybook retrieval supplement</title><style>body{max-width:1120px;margin:40px auto;padding:0 20px;font:16px/1.55 system-ui;color:#18242c;background:#faf9f6}svg{width:100%;height:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px;text-align:left;border-bottom:1px solid #cdd5d8}h1,h2{line-height:1.2}section{margin:32px 0}code{overflow-wrap:anywhere}@media print{body{margin:0;background:white}section{break-inside:avoid}}</style></head><body><h1>Retrieval and failure analysis</h1>${validityBanner}<p>${esc(report.runId)} · ${esc(report.split)} · ${report.measuredEpisodes} recorded episodes. Descriptive supplemental results; main planned/missing denominators remain in the primary report.</p>${renderRetrievalSvg(report)}<section><h2>Comparable ranking metrics</h2><p>Counts are completed retrievals / document-applicable episodes. Skipped / unknown / unsupported counts disclose exclusions. R3 citation order is not search ranking and its rank metrics remain N/A.</p><table><thead><tr><th>Route</th><th>Completed / eligible</th><th>Skipped / unknown / unsupported</th><th>Recall@6</th><th>MRR@6</th><th>nDCG@6</th><th>Scenario-macro recall</th><th>End-to-end availability</th></tr></thead><tbody>${rows}</tbody></table></section><section><h2>Observed failure conditions</h2><p>Multi-label counts overlap; they are not proven root causes.</p><table><thead><tr><th>Condition</th><th>Episodes</th></tr></thead><tbody>${failures}</tbody></table></section><section><h2>Definitions and limits</h2>${Object.entries(
    report.definitions,
  )
    .map(([name, definition]) => `<p><strong>${esc(name)}:</strong> ${esc(definition)}</p>`)
    .join(
      '',
    )}<ul>${report.limitations.map((limit) => `<li>${esc(limit)}</li>`).join('')}</ul></section>${latencySection}</body></html>`;
}
export function writeResearchSupplement(directory: string, report: Supplement) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'retrieval-and-failures.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(directory, 'retrieval.svg'), renderRetrievalSvg(report));
  writeFileSync(join(directory, 'index.html'), renderSupplementHtml(report));
}

function main() {
  const directory = process.argv[2];
  if (!directory)
    throw new Error(
      'USAGE: node --import tsx scripts/analyze-research.ts RUN_DIRECTORY [OUTPUT_DIRECTORY] [--usage PATH]',
    );
  let output = join(directory, 'supplemental');
  let usagePath: string | undefined;
  let validityPath: string | undefined;
  let outputSet = false;
  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i] === '--usage' && process.argv[i + 1] && !usagePath) usagePath = process.argv[++i];
    else if (process.argv[i] === '--validity-notice' && process.argv[i + 1] && !validityPath)
      validityPath = process.argv[++i];
    else if (!process.argv[i].startsWith('--') && !outputSet) {
      output = process.argv[i];
      outputSet = true;
    } else throw new Error('INVALID_ANALYSIS_ARGUMENT');
  }
  const usageSource = usagePath
    ? 'explicit'
    : existsSync(join(directory, 'usage.json'))
      ? 'run_snapshot'
      : 'absent';
  usagePath ??= usageSource === 'run_snapshot' ? join(directory, 'usage.json') : undefined;
  const usageBytes = usagePath ? readFileSync(usagePath, 'utf8') : undefined;
  const parsedUsage: unknown = usageBytes === undefined ? undefined : JSON.parse(usageBytes);
  if (
    parsedUsage !== undefined &&
    (!Array.isArray(parsedUsage) ||
      parsedUsage.some((row) => !row || typeof row !== 'object' || typeof row.episode !== 'string'))
  )
    throw new Error('INVALID_PROVIDER_USAGE_SNAPSHOT');
  // Whitelist timing fields; no provider body/header or unrelated payload is copied.
  const usage: ProviderCallTiming[] | undefined =
    parsedUsage === undefined
      ? undefined
      : (parsedUsage as ProviderCallTiming[]).map((row) => ({
          id: row.id,
          episode: row.episode,
          durationMs: row.durationMs,
        }));
  const episodeBytes = readFileSync(join(directory, 'episodes.jsonl'), 'utf8');
  const episodes = episodeBytes
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SupplementalEpisode);
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as {
    runId: string;
    split: StudyEpisode['split'];
  };
  validityPath ??= existsSync(join(directory, 'validity-notice.json'))
    ? join(directory, 'validity-notice.json')
    : undefined;
  const validityBytes = validityPath ? readFileSync(validityPath, 'utf8') : undefined;
  const validityNotice: StudyValidityNotice | undefined =
    validityBytes === undefined ? undefined : JSON.parse(validityBytes);
  validateStudyValidityNotice(
    validityNotice,
    manifest.runId,
    validityNotice
      ? createHash('sha256')
          .update(readFileSync(join(directory, 'results.json')))
          .digest('hex')
      : undefined,
  );
  const sourcePath = join(directory, 'source-manifest.json');
  let referenceSourceVerified = false;
  if (existsSync(sourcePath)) {
    const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as { files: Record<string, string> };
    const required = [
      'research/reference.ts',
      'research/dataset.ts',
      'research/scoring.ts',
      ...Object.keys(source.files).filter((file) => file.startsWith('research/fixtures/')),
    ];
    for (const file of required) {
      const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
      if (source.files[file] !== actual) throw new Error('REFERENCE_SOURCE_CHANGED_SINCE_RUN');
    }
    referenceSourceVerified = true;
  }
  const report = analyzeResearchSupplement(episodes, getReference, {
    split: manifest.split,
    runId: manifest.runId,
    usage,
    validityNotice,
  });
  writeResearchSupplement(output, report);
  writeFileSync(
    join(output, 'analysis-provenance.json'),
    JSON.stringify(
      {
        analyzerHash: createHash('sha256')
          .update(readFileSync(fileURLToPath(import.meta.url)))
          .digest('hex'),
        episodeFileHash: createHash('sha256').update(episodeBytes).digest('hex'),
        usageFileHash:
          usageBytes === undefined ? null : createHash('sha256').update(usageBytes).digest('hex'),
        usageSource,
        validityNoticeHash:
          validityBytes === undefined ? null : createHash('sha256').update(validityBytes).digest('hex'),
        referenceSourceVerified,
        generatedAt: report.createdAt,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ output, measuredEpisodes: report.measuredEpisodes, referenceSourceVerified }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
