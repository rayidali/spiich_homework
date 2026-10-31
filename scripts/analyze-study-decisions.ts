/** Secondary analysis never regrades answers or calls providers. Optional post-run CLI review checks evaluator provenance. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FAMILIES,
  ROUTES,
  pairedDifference,
  type StudyRoute,
  type EpisodeScore,
  type ConfidenceInterval,
} from '../research/scoring';
import type { TaskFamily } from '../research/dataset';
import type { StudyReport } from '../research/report';
import type { VerifierRecord } from '../research/validator-study';
import type { CommonValidityNotice } from './analyze-common-capabilities';

export const PRACTICAL_BENEFIT = 0.05;
export const MAX_ADDITIONAL_WITHHOLDING = 0.05;
export const TARGETED_COMPARISONS: {
  hypothesis: string;
  route: StudyRoute;
  control: StudyRoute;
  families: TaskFamily[];
}[] = [
  { hypothesis: 'H1', route: 'R1', control: 'R0', families: ['financial', 'analytics'] },
  { hypothesis: 'H2', route: 'R2', control: 'R1', families: ['documents', 'scenario'] },
  { hypothesis: 'H3a', route: 'R3', control: 'R2', families: ['documents', 'scenario'] },
  { hypothesis: 'H3b', route: 'R3', control: 'R4', families: ['documents', 'scenario'] },
  { hypothesis: 'H4', route: 'R4', control: 'R2', families: ['documents', 'scenario'] },
  { hypothesis: 'H5', route: 'R5', control: 'R4', families: ['documents', 'scenario'] },
  { hypothesis: 'H6', route: 'R6', control: 'R4', families: ['financial', 'analytics'] },
  { hypothesis: 'H7a', route: 'R7', control: 'R4', families: [...FAMILIES] },
  { hypothesis: 'H7b', route: 'R8', control: 'R4', families: [...FAMILIES] },
];
export const COMPLEXITY = [
  {
    route: 'R0',
    components: 'PostgreSQL; one Gemini call; four existing financial tools',
    obligations: 'Maintain existing typed tools and accounting gates.',
  },
  {
    route: 'R1',
    components: 'PostgreSQL; Gemini planner and answer calls; broader typed analytics',
    obligations: 'Maintain query compiler, calculation provenance and tool schemas.',
  },
  {
    route: 'R2',
    components: 'R1 plus PostgreSQL lexical document search',
    obligations: 'Ingest/version authorized documents; maintain lexical retrieval.',
  },
  {
    route: 'R3',
    components: 'Broad analytics plus Gemini managed File Search and final answer generation',
    obligations:
      'Maintain managed store permissions, indexing and citation-to-document resolution; raw ranks unavailable.',
  },
  {
    route: 'R4',
    components: 'R2 plus Gemini embeddings and PostgreSQL pgvector hybrid retrieval',
    obligations: 'Maintain embedding versions, vector index, workspace filters and fusion.',
  },
  {
    route: 'R5',
    components: 'R4 plus Jev reranking',
    obligations: 'Operate another provider credential, candidate-ranking contract and limits.',
  },
  {
    route: 'R6',
    components: 'R4 retrieval with Wren analytics replacing the custom query compiler',
    obligations: 'Operate the pinned engine, semantic model and SQL provenance restrictions.',
  },
  {
    route: 'R7',
    components: 'R4 plus separate Gemini reviewer call using the same model weights',
    obligations: 'Maintain review prompts and evidence contract; correlated errors remain possible.',
  },
  {
    route: 'R8',
    components: 'R4 plus Jev reviewer',
    obligations: 'Maintain calibrated development threshold, reviewer schema and second-provider limits.',
  },
] as const;

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const validHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
type Json = Record<string, unknown>;
type Status = 'ineligible' | 'inconclusive' | 'below_practical_target' | 'candidate_for_further_experiment';
export interface DecisionArtifacts {
  primaryReportSha256: string;
  analysisScorerSha256?: string;
  analysisProtocolSha256?: string;
  sourceManifest?: { hash: string; files: Record<string, string> };
  manifest?: Json;
  freeze?: Json;
  before?: { fingerprint?: string };
  after?: { fingerprint?: string; unchanged?: boolean; complete?: boolean };
  commonAnalysis?: { runId: string; eligibleForConclusion: boolean };
  commonProvenance?: { runId: string; primaryReportSha256: string };
  validityNotice?: CommonValidityNotice;
}

/** Validate existing saved artifacts. This is provenance consistency, not an independent security audit. */
export function decisionEligibility(primary: StudyReport, artifacts: DecisionArtifacts) {
  const reasons: string[] = [];
  if (primary.split !== 'holdout') reasons.push('DEVELOPMENT_ONLY');
  const planned = primary.questions.length * primary.expectedRepeats;
  const complete =
    primary.complete &&
    primary.questions.length === 60 &&
    primary.expectedRepeats === 3 &&
    FAMILIES.every(
      (f) =>
        primary.questions.filter((q) => q.family === f).length === 10 &&
        new Set(primary.questions.filter((q) => q.family === f).map((q) => q.groupId)).size === 5,
    ) &&
    primary.routes.every(
      (route) =>
        route.complete &&
        route.plannedEpisodes === planned &&
        route.episodes === planned &&
        primary.scores.filter((s) => s.route === route.route).length === planned,
    );
  if (!complete) reasons.push('INCOMPLETE_ROUTE_MATRIX');
  const fp = primary.snapshotIntegrity;
  const fingerprintVerified =
    fp.status === 'verified' &&
    fp.scope === 'ledger_and_corpus' &&
    validHash(fp.before) &&
    fp.before === fp.after &&
    artifacts.before?.fingerprint === fp.before &&
    artifacts.after?.fingerprint === fp.after &&
    artifacts.after?.unchanged === true &&
    artifacts.after?.complete === true;
  if (!fingerprintVerified) reasons.push('FULL_FINGERPRINT_BINDING_UNVERIFIED');
  const source = artifacts.sourceManifest,
    manifest = artifacts.manifest,
    freeze = artifacts.freeze;
  const sourceBindingVerified =
    !!source &&
    !!manifest &&
    !!freeze &&
    validHash(source.hash) &&
    Object.keys(source.files).length > 0 &&
    Object.values(source.files).every(validHash) &&
    sha(JSON.stringify(source.files)) === source.hash &&
    manifest.sourceHash === source.hash &&
    source.files['research/scoring.ts'] === artifacts.analysisScorerSha256 &&
    validHash(artifacts.analysisScorerSha256) &&
    validHash(manifest.protocolHash) &&
    manifest.protocolHash === artifacts.analysisProtocolSha256 &&
    validHash(manifest.datasetHash) &&
    manifest.datasetHash === source.files['research/fixtures/snapshot-manifest.json'] &&
    freeze.frozenSourceHash === source.hash &&
    freeze.version === 'daybook-verifier-freeze-v1' &&
    validHash(freeze.referenceCasesHash) &&
    validHash(freeze.calibrationHash) &&
    manifest.verifierThreshold === freeze.threshold &&
    manifest.runId === primary.runId &&
    manifest.suite === 'holdout' &&
    manifest.split === primary.split &&
    manifest.repeats === primary.expectedRepeats &&
    JSON.stringify(manifest.questionIds) === JSON.stringify(primary.questions.map((q) => q.id)) &&
    Array.isArray(manifest.routeIds) &&
    manifest.routeIds.length === ROUTES.length &&
    ROUTES.every((r) => (manifest.routeIds as unknown[]).includes(r)) &&
    typeof freeze.boundAt === 'string' &&
    typeof manifest.createdAt === 'string' &&
    Number.isFinite(Date.parse(freeze.boundAt)) &&
    Date.parse(freeze.boundAt) <= Date.parse(manifest.createdAt);
  if (!sourceBindingVerified) reasons.push('FROZEN_SOURCE_OR_CONFIG_BINDING_UNVERIFIED');
  const membershipVerified =
    artifacts.commonAnalysis?.runId === primary.runId &&
    artifacts.commonAnalysis.eligibleForConclusion === true &&
    artifacts.commonProvenance?.runId === primary.runId &&
    validHash(artifacts.primaryReportSha256) &&
    artifacts.commonProvenance.primaryReportSha256 === artifacts.primaryReportSha256;
  if (!membershipVerified) reasons.push('SOURCE_MEMBERSHIP_AMENDMENT_UNVERIFIED');
  const notice = artifacts.validityNotice;
  const validityNoticeBound = notice
    ? notice.schemaVersion === 1 &&
      notice.runId === primary.runId &&
      validHash(notice.originalResultsSha256) &&
      notice.originalResultsSha256 === artifacts.primaryReportSha256
    : null;
  if (notice && (validityNoticeBound !== true || notice.eligibleForSelection !== true))
    reasons.push('OVERRIDING_OR_UNBOUND_VALIDITY_NOTICE');
  if (!primary.eligibleForConclusion) reasons.push('PRIMARY_REPORT_INELIGIBLE');
  return {
    eligible: reasons.length === 0,
    reasons,
    complete,
    sourceBindingVerified,
    fingerprintVerified,
    membershipVerified,
    validityNoticeBound,
  };
}

function validateScores(primary: StudyReport) {
  if (
    primary.schemaVersion !== 1 ||
    primary.routes.length !== ROUTES.length ||
    new Set(primary.routes.map((r) => r.route)).size !== ROUTES.length ||
    primary.routes.some((r) => !ROUTES.includes(r.route))
  )
    throw new Error('INVALID_ROUTE_SET');
  if (
    !Number.isInteger(primary.expectedRepeats) ||
    primary.expectedRepeats < 1 ||
    new Set(primary.questions.map((q) => q.id)).size !== primary.questions.length
  )
    throw new Error('INVALID_QUESTION_PLAN');
  const ids = new Set<string>(),
    pairs = new Set<string>();
  for (const s of primary.scores) {
    const q = primary.questions.find((q) => q.id === s.questionId);
    const pair = `${s.route}:${s.questionId}:${s.repeat}`;
    if (ids.has(s.id) || pairs.has(pair)) throw new Error('DUPLICATE_SCORE');
    ids.add(s.id);
    pairs.add(pair);
    if (
      !q ||
      q.family !== s.family ||
      q.groupId !== s.groupId ||
      q.split !== s.split ||
      s.split !== primary.split ||
      !ROUTES.includes(s.route) ||
      !FAMILIES.includes(s.family) ||
      !Number.isInteger(s.repeat) ||
      s.repeat < 0 ||
      s.repeat >= primary.expectedRepeats ||
      typeof s.success !== 'boolean' ||
      !['ok', 'blocked', 'error'].includes(s.status) ||
      (s.status === 'error' && s.success)
    )
      throw new Error('INVALID_SCORE_MEMBERSHIP');
  }
}

function effect(
  scores: EpisodeScore[],
  route: StudyRoute,
  control: StudyRoute,
  families: TaskFamily[],
  samples: number,
) {
  return pairedDifference(
    scores.filter((s) => s.route === route && families.includes(s.family)),
    scores.filter((s) => s.route === control && families.includes(s.family)),
    samples,
    418,
  );
}
function uncertainty(ci: ConfidenceInterval | null, practicalThreshold = PRACTICAL_BENEFIT) {
  const available = ci !== null && ci.low !== null && ci.high !== null;
  return {
    available,
    spansHarmAndUsefulBenefit: available && ci.low! < 0 && ci.high! >= practicalThreshold,
    includesAnyHarm: available && ci.low! < 0,
    method:
      'Unadjusted empirical interval; not a formal significance test or simultaneous confidence statement.',
  };
}
function familyMacro(scores: EpisodeScore[], families: TaskFamily[]) {
  const values = families.map((f) =>
    mean(scores.filter((s) => s.family === f).map((s) => Number(s.success))),
  );
  return values.every((v) => v !== null) ? mean(values as number[]) : null;
}

/** Descriptive point-estimate dominance; missing cost per success is unavailable, never imputed. */
export function paretoFront(primary: StudyReport, families: TaskFamily[], eligible: boolean) {
  const rows = primary.routes.map((r) => {
    const scores = primary.scores.filter((s) => s.route === r.route);
    const dimensions = {
      overallSuccess: familyMacro(scores, FAMILIES),
      targetedSuccess: familyMacro(scores, families),
      errorRate: mean(scores.map((s) => Number(s.status === 'error'))),
      p95HarnessMs: r.p95Ms,
      costPerSuccessUsd: r.cost.budgetUsdPerSuccess,
    };
    return {
      route: r.route,
      dimensions,
      comparable:
        eligible &&
        !r.disqualified &&
        !scores.some((s) => s.hardGateViolations.length) &&
        Object.values(dimensions).every((v) => v !== null && Number.isFinite(v)),
      dominatedBy: [] as StudyRoute[],
    };
  });
  for (const row of rows.filter((r) => r.comparable)) {
    const signed = (r: typeof row) => [
      r.dimensions.overallSuccess!,
      r.dimensions.targetedSuccess!,
      -r.dimensions.errorRate!,
      -r.dimensions.p95HarnessMs!,
      -r.dimensions.costPerSuccessUsd!,
    ];
    row.dominatedBy = rows
      .filter(
        (other) =>
          other.route !== row.route &&
          other.comparable &&
          signed(other).every((v, i) => v >= signed(row)[i]) &&
          signed(other).some((v, i) => v > signed(row)[i]),
      )
      .map((r) => r.route);
  }
  return {
    targetFamilies: families,
    rows,
    meaning:
      'Observed point-estimate dominance only; not uncertainty-adjusted superiority. Missing cost/latency prevents comparison. No production route is selected.',
  };
}

export interface ReviewerLabel {
  caseId: string;
  sourceGroupId: string;
  split: 'development' | 'holdout';
  expected: 'PASS' | 'BLOCK';
}
export interface ReviewerInputs {
  records: VerifierRecord[];
  labels: ReviewerLabel[];
  threshold: number;
  provenanceVerified: boolean;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function verifyReviewerLabels(
  labels: ReviewerLabel[],
  referenceCases: { id: string; sourceGroupId: string; split: string; expected: string }[],
  referenceHash: unknown,
  split: string,
) {
  if (!validHash(referenceHash) || sha(JSON.stringify(canonical(referenceCases))) !== referenceHash)
    return false;
  const projected = referenceCases
    .filter((c) => c.split === split)
    .map((c) => ({ caseId: c.id, sourceGroupId: c.sourceGroupId, split: c.split, expected: c.expected }));
  return (
    JSON.stringify(canonical([...labels].sort((a, b) => a.caseId.localeCompare(b.caseId)))) ===
    JSON.stringify(canonical(projected.sort((a, b) => a.caseId.localeCompare(b.caseId))))
  );
}
function groupedDifference(
  rows: { groupId: string; value: number }[],
  samples: number,
): (ConfidenceInterval & { pairedEpisodes: number }) | null {
  if (!rows.length) return null;
  const groups = [...new Set(rows.map((r) => r.groupId))]
    .sort()
    .map((id) => rows.filter((r) => r.groupId === id).map((r) => r.value));
  const estimate = mean(rows.map((r) => r.value))!;
  const common = {
    estimate,
    groups: groups.length,
    pairedEpisodes: rows.length,
    method:
      'Unadjusted 95% empirical percentile bootstrap of paired source-group blocks within this label stratum.',
    warnings: [
      'Synthetic reviewer set; conditional estimates are restricted to pairs with both requests successful.',
    ],
  };
  if (groups.length < 2)
    return {
      ...common,
      low: null,
      high: null,
      samples: 0,
      warnings: [...common.warnings, 'Fewer than two source groups; interval unavailable.'],
    };
  let seed = 418;
  function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  const values = Array.from(
    { length: samples },
    () =>
      mean(Array.from({ length: groups.length }, () => groups[Math.floor(random() * groups.length)]).flat())!,
  ).sort((a, b) => a - b);
  const low = values[Math.ceil(samples * 0.025) - 1],
    high = values[Math.ceil(samples * 0.975) - 1];
  return {
    ...common,
    low,
    high,
    samples,
    warnings: [
      ...common.warnings,
      ...(groups.length <= 5 ? ['Five or fewer source groups; interval coverage may be poor.'] : []),
      ...(low === high
        ? ['Degenerate empirical interval does not establish zero population uncertainty.']
        : []),
    ],
  };
}

export function reviewerDecisions(input: ReviewerInputs, samples = 2000) {
  const methods = ['deterministic', 'llm', 'jev'] as const;
  const labels = new Map(input.labels.map((x) => [x.caseId, x]));
  if (
    labels.size !== input.labels.length ||
    !Number.isFinite(input.threshold) ||
    input.threshold < 0 ||
    input.threshold > 1 ||
    input.labels.some((l) => !l.caseId || !l.sourceGroupId || !['PASS', 'BLOCK'].includes(l.expected))
  )
    throw new Error('INVALID_REVIEWER_LABEL_PROJECTION');
  const seen = new Set<string>();
  const caseHashes = new Map<string, string>();
  for (const r of input.records) {
    const label = labels.get(r.caseId),
      id = `${r.method}:${r.caseId}`;
    if (seen.has(id)) throw new Error('DUPLICATE_REVIEWER_RECORD');
    seen.add(id);
    if (
      !label ||
      r.sourceGroupId !== label.sourceGroupId ||
      r.split !== label.split ||
      !methods.includes(r.method) ||
      (caseHashes.has(r.caseId) && caseHashes.get(r.caseId) !== r.inputHash) ||
      !['ok', 'error'].includes(r.status) ||
      (r.status === 'ok' && !['PASS', 'CLARIFY', 'BLOCK'].includes(r.decision ?? '')) ||
      (r.method === 'jev' && r.threshold !== input.threshold)
    )
      throw new Error('INVALID_REVIEWER_MEMBERSHIP_OR_THRESHOLD');
    caseHashes.set(r.caseId, r.inputHash);
  }
  const code = new Map(input.records.filter((r) => r.method === 'deterministic').map((r) => [r.caseId, r]));
  const complete = input.labels.length > 0 && input.records.length === input.labels.length * 3;
  const eligible =
    input.provenanceVerified &&
    complete &&
    input.labels.every((l) => l.split === 'holdout') &&
    input.labels.some((l) => l.expected === 'PASS') &&
    input.labels.some((l) => l.expected === 'BLOCK');
  const comparisons = (['llm', 'jev'] as const).map((method) => {
    const selected = input.records.filter((r) => r.method === method);
    const pairs = selected.flatMap((r) => {
      const c = code.get(r.caseId);
      return c ? [{ r, c, label: labels.get(r.caseId)! }] : [];
    });
    const pass = (r: VerifierRecord) => r.status === 'ok' && r.decision === 'PASS';
    const projected = (flawed: boolean, conditional: boolean, combined: boolean) =>
      pairs
        .filter(
          ({ r, c, label }) =>
            (label.expected === 'BLOCK') === flawed &&
            (!conditional || (r.status === 'ok' && c.status === 'ok')),
        )
        .map(({ r, c, label }) => {
          const treatmentPass = pass(r) && (!combined || pass(c));
          return {
            groupId: label.sourceGroupId,
            value: flawed
              ? Number(treatmentPass) - Number(pass(c))
              : Number(!treatmentPass) - Number(!pass(c)),
          };
        });
    const fa = groupedDifference(projected(true, false, true), samples);
    const withholding = groupedDifference(projected(false, false, true), samples);
    const semantic = groupedDifference(projected(true, true, true), samples);
    const semanticWithholding = groupedDifference(projected(false, true, true), samples);
    const pointCriterionMet =
      fa !== null && withholding !== null
        ? fa.estimate < 0 && withholding.estimate <= MAX_ADDITIONAL_WITHHOLDING + 1e-12
        : null;
    const uncertaintyResolved =
      fa?.high !== null &&
      fa?.high !== undefined &&
      fa.high < 0 &&
      withholding?.high !== null &&
      withholding?.high !== undefined &&
      withholding.high <= MAX_ADDITIONAL_WITHHOLDING + 1e-12;
    const semanticImprovementObserved = semantic !== null && semantic.estimate < 0;
    const reasons: string[] = [];
    if (!eligible) reasons.push('REVIEWER_STUDY_INCOMPLETE_OR_UNBOUND_OR_DEVELOPMENT');
    if (!pointCriterionMet) reasons.push('OPERATIONAL_POINT_CRITERION_NOT_MET');
    if (!semanticImprovementObserved) reasons.push('NO_OBSERVED_PAIRED_SEMANTIC_IMPROVEMENT');
    if (!uncertaintyResolved) reasons.push('REVIEWER_UNCERTAINTY_INCLUDES_NO_BENEFIT_OR_EXCESS_WITHHOLDING');
    const status: Status = !eligible
      ? 'ineligible'
      : !pointCriterionMet
        ? 'below_practical_target'
        : !semanticImprovementObserved || !uncertaintyResolved
          ? 'inconclusive'
          : 'candidate_for_further_experiment';
    return {
      method,
      control: 'deterministic',
      deploymentCombination: 'deterministic AND reviewer',
      status,
      reasons,
      operationalFalseAcceptanceDifference: fa,
      additionalCorrectWithholding: withholding,
      conditionalPairedFalseAcceptanceDifference: semantic,
      conditionalPairedCorrectWithholding: semanticWithholding,
      reviewerOnlyFalseAcceptanceDifference: groupedDifference(projected(true, false, false), samples),
      reviewerOnlyCorrectWithholding: groupedDifference(projected(false, false, false), samples),
      pointCriterionMet,
      semanticImprovementObserved,
      uncertaintyResolved,
      counts: {
        plannedCases: input.labels.length,
        measured: selected.length,
        paired: pairs.length,
        correctPairs: pairs.filter((p) => p.label.expected === 'PASS').length,
        flawedPairs: pairs.filter((p) => p.label.expected === 'BLOCK').length,
        reviewerErrors: selected.filter((r) => r.status === 'error').length,
        deterministicErrors: pairs.filter((p) => p.c.status === 'error').length,
        successfulPairs: pairs.filter((p) => p.r.status === 'ok' && p.c.status === 'ok').length,
      },
    };
  });
  return {
    available: true,
    complete,
    eligible,
    threshold: input.threshold,
    comparisons,
    notes: [
      'Operational failures withhold output; conditional paired rates exclude request failures. A failure is never described as semantic flaw detection.',
      'Differences are treatment minus deterministic control: negative false acceptance is favorable; positive correct withholding is unfavorable.',
      'Criterion is lower operational false acceptance and <=+5pp correct withholding. Intervals are descriptive and unadjusted, not a significance/noninferiority test. No Brier score is inferred from composite Jev hazards.',
      'Joint review policy requires both deterministic and model passes. Standalone reviewer differences are diagnostics. Conditional selection can change the evaluated case mix.',
    ],
  };
}

export function analyzeStudyDecisions(
  primary: StudyReport,
  artifacts: DecisionArtifacts,
  reviewerInput?: ReviewerInputs,
  samples = 2000,
) {
  if (!Number.isInteger(samples) || samples < 100 || samples > 100000)
    throw new Error('INVALID_BOOTSTRAP_SAMPLES');
  validateScores(primary);
  const eligibility = decisionEligibility(primary, artifacts);
  const reviewers = reviewerInput
    ? reviewerDecisions(reviewerInput, samples)
    : {
        available: false as const,
        comparisons: [],
        notes: [
          'Reviewer raw outcomes and evaluator label projection were not supplied. No reviewer criterion is inferred.',
        ],
      };
  const components = TARGETED_COMPARISONS.map((comparison) => {
    const { route, control, families } = comparison;
    const treatment = primary.routes.find((r) => r.route === route)!,
      baseline = primary.routes.find((r) => r.route === control)!;
    const targetedEffect = effect(primary.scores, route, control, families, samples);
    const u = uncertainty(targetedEffect);
    const hardGates = [
      ...new Set(
        primary.scores
          .filter((s) => s.route === route || s.route === control)
          .flatMap((s) => s.hardGateViolations)
          .concat(treatment.hardGateViolations, baseline.hardGateViolations),
      ),
    ];
    const fullPairs =
      !!targetedEffect &&
      targetedEffect.unpairedControl === 0 &&
      targetedEffect.unpairedTreatment === 0 &&
      families.every((f) => targetedEffect.families.includes(f));
    const isReviewer = route === 'R7' || route === 'R8';
    const pointBenefitMeetsTarget =
      isReviewer || !targetedEffect ? null : targetedEffect.estimate + 1e-12 >= PRACTICAL_BENEFIT;
    const reasons: string[] = [];
    let status: Status;
    if (
      !eligibility.eligible ||
      hardGates.length ||
      treatment.disqualified ||
      baseline.disqualified ||
      !fullPairs
    ) {
      status = 'ineligible';
      reasons.push(...eligibility.reasons);
      if (hardGates.length || treatment.disqualified || baseline.disqualified)
        reasons.push('TREATMENT_OR_CONTROL_HARD_GATE');
      if (!fullPairs) reasons.push('UNPAIRED_OR_MISSING_TARGET_FAMILY');
    } else if (isReviewer) {
      const review = reviewers.comparisons.find((r) => r.method === (route === 'R7' ? 'llm' : 'jev'));
      status =
        review?.status === 'candidate_for_further_experiment' &&
        u.available &&
        !u.includesAnyHarm &&
        targetedEffect!.estimate >= 0
          ? 'candidate_for_further_experiment'
          : 'inconclusive';
      if (status === 'inconclusive') reasons.push('REVIEWER_CRITERION_OR_END_TO_END_HARM_REMAINS_UNRESOLVED');
    } else if (!u.available || u.spansHarmAndUsefulBenefit) {
      status = 'inconclusive';
      reasons.push('INTERVAL_UNAVAILABLE_OR_SPANS_HARM_AND_USEFUL_BENEFIT');
    } else if (!pointBenefitMeetsTarget) {
      status = 'below_practical_target';
      reasons.push('TARGETED_POINT_GAIN_BELOW_FIVE_PERCENTAGE_POINTS');
    } else if (u.includesAnyHarm) {
      status = 'inconclusive';
      reasons.push('TARGETED_INTERVAL_INCLUDES_HARM');
    } else status = 'candidate_for_further_experiment';
    return {
      hypothesis: comparison.hypothesis,
      route,
      control,
      targetFamilies: families,
      targetedEffect,
      overallEffect: effect(primary.scores, route, control, FAMILIES, samples),
      entryEffect: effect(primary.scores, route, control, ['entry'], samples),
      adversarialEffect: effect(primary.scores, route, control, ['adversarial'], samples),
      pointBenefitMeetsTarget,
      uncertainty: u,
      hardGateViolations: hardGates,
      status,
      reasons,
      tradeoffs: {
        additionalObservedSuccesses: treatment.successes - baseline.successes,
        additionalCalls: treatment.cost.calls - baseline.cost.calls,
        errorRateDifference: delta(treatment.errorRate, baseline.errorRate),
        p95HarnessMsDifference: delta(treatment.p95Ms, baseline.p95Ms),
        budgetUsdDifference: treatment.cost.budgetChargedUsd - baseline.cost.budgetChargedUsd,
        costPerSuccessfulTaskUsdDifference: delta(
          treatment.cost.budgetUsdPerSuccess,
          baseline.cost.budgetUsdPerSuccess,
        ),
      },
    };
  });
  return {
    schemaVersion: 1,
    runId: primary.runId,
    split: primary.split,
    primaryReportSha256: artifacts.primaryReportSha256,
    eligibility,
    criteria: {
      practicalBenefit: PRACTICAL_BENEFIT,
      maximumAdditionalCorrectWithholding: MAX_ADDITIONAL_WITHHOLDING,
      bootstrapSamples: samples,
      seed: 418,
    },
    components,
    reviewers,
    pareto: {
      overall: paretoFront(primary, FAMILIES, eligibility.eligible),
      financialAndAnalytics: paretoFront(primary, ['financial', 'analytics'], eligibility.eligible),
      documentsAndScenario: paretoFront(primary, ['documents', 'scenario'], eligibility.eligible),
    },
    complexity: COMPLEXITY,
    notes: [
      'Primary six-family scores are preserved. This supplement uses fixed targeted family mappings; entry and adversarial effects remain visible.',
      'Point estimates meeting +5pp are separate from interval uncertainty. Any negative interval bound is disclosed as possible harm; no new magnitude threshold for material harm is invented.',
      'All requests/errors remain in end-to-end task-success denominators. Missing attempts remain missing and block comparative conclusions.',
      'Recorded error rates include local/harness failures as well as provider failures; they are not a provider-only availability measurement.',
      'A favorable row means candidate for further experiment, subject to the visible cost, latency and operational tradeoffs. It never authorizes production deployment or an unmeasured combined architecture.',
      'Pareto tables use observed point estimates, not statistical superiority. Fewer services are preferred when gains are below target or inconclusive; no numerical operational-complexity score is invented.',
      'Unadjusted clustered intervals are descriptive, with only a few scenario groups per family. Degenerate intervals and a shared synthetic corpus limit generalization.',
      'Typed-fact/protocol success is not full prose faithfulness. Independent human clarity and reference adjudication remain unavailable.',
    ],
  };
}

type DecisionReport = ReturnType<typeof analyzeStudyDecisions>;
const percent = (n: number | null | undefined) => (n == null ? 'N/A' : (n * 100).toFixed(1));
const ciText = (ci: ConfidenceInterval | null) =>
  ci ? `${percent(ci.estimate)} [${percent(ci.low)}, ${percent(ci.high)}]` : 'N/A';
const safe = (s: unknown) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function renderDecisions(report: DecisionReport) {
  return [
    `# Prespecified component decisions — ${report.runId}`,
    '',
    report.eligibility.eligible
      ? 'Complete held-out measurement. No production winner is selected.'
      : `DIAGNOSTIC / INELIGIBLE: ${report.eligibility.reasons.join(', ')}`,
    '',
    'All differences are percentage points, treatment minus control. Intervals are unadjusted 95% clustered empirical intervals; they are not significance tests.',
    '',
    '| Hypothesis | Comparison | Fixed families | Paired effect [interval], pp | Pairs / groups | >=+5pp point gain | Interpretation |',
    '| --- | --- | --- | ---: | ---: | --- | --- |',
    ...report.components.map(
      (r) =>
        `| ${r.hypothesis} | ${r.route} − ${r.control} | ${r.targetFamilies.join(', ')} | ${ciText(r.targetedEffect)} | ${r.targetedEffect?.pairedEpisodes ?? 0} / ${r.targetedEffect?.groups ?? 0} | ${r.pointBenefitMeetsTarget === null ? 'Separate reviewer criterion' : r.pointBenefitMeetsTarget ? 'Yes' : 'No'} | ${r.status} ${r.reasons.join('; ')} |`,
    ),
    '',
    '## Reviewer criterion',
    '',
    ...report.reviewers.notes,
    '',
    '| Reviewer + deterministic gate | Flawed acceptance difference, pp | Correct withholding difference, pp | Conditional paired flawed acceptance, pp | Errors / measured | Interpretation |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...report.reviewers.comparisons.map(
      (r) =>
        `| ${r.method} | ${ciText(r.operationalFalseAcceptanceDifference)} | ${ciText(r.additionalCorrectWithholding)} | ${ciText(r.conditionalPairedFalseAcceptanceDifference)} | ${r.counts.reviewerErrors} / ${r.counts.measured} | ${r.status} |`,
    ),
    '',
    '## Visible tradeoffs',
    '',
    '| Comparison | Additional successes | Additional calls | Error delta, pp | p95 harness delta, ms | Tracked USD delta |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...report.components.map(
      (r) =>
        `| ${r.route} − ${r.control} | ${r.tradeoffs.additionalObservedSuccesses} | ${r.tradeoffs.additionalCalls} | ${percent(r.tradeoffs.errorRateDifference)} | ${r.tradeoffs.p95HarnessMsDifference ?? 'N/A'} | ${r.tradeoffs.budgetUsdDifference.toFixed(6)} |`,
    ),
    '',
    'Tracked cost includes reported-use estimates and unknown-use reservations; it is not an invoice. Harness latency includes pacing and queue waits.',
    '',
    '## Operational complexity',
    '',
    '| Route | Components | Maintenance obligations |',
    '| --- | --- | --- |',
    ...report.complexity.map((r) => `| ${r.route} | ${r.components} | ${r.obligations} |`),
    '',
    '## Limitations',
    '',
    ...report.notes.map((n) => `- ${n}`),
    '',
  ].join('\n');
}
export function renderDecisionSvg(report: DecisionReport) {
  const x = (v: number) => 500 + v * 350;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="600" viewBox="0 0 1100 600" role="img"><title>Prespecified targeted component effects</title><desc>Percentage-point differences; error bars are unadjusted clustered empirical intervals. N/A indicates unavailable uncertainty. No production winner.</desc><rect width="1100" height="600" fill="white"/><g font-family="sans-serif" font-size="13" fill="#152331"><text x="20" y="28">${safe(report.runId)} — ${report.eligibility.eligible ? 'HELD-OUT / DESCRIPTIVE' : 'DIAGNOSTIC / INELIGIBLE'}</text><line x1="500" y1="65" x2="500" y2="535" stroke="#8797a6"/><line x1="${x(0.05)}" y1="65" x2="${x(0.05)}" y2="535" stroke="#b87412" stroke-dasharray="4 4"/>${[-1, -0.5, 0, 0.5, 1].map((v) => `<text x="${x(v)}" y="58" text-anchor="middle">${v * 100}pp</text>`).join('')}${report.components
    .map((r, i) => {
      const y = 92 + i * 49,
        c = r.targetedEffect;
      return `<text x="12" y="${y}">${r.hypothesis}: ${r.route}−${r.control}</text>${c ? `${c.low !== null && c.high !== null ? `<line x1="${x(c.low)}" x2="${x(c.high)}" y1="${y - 4}" y2="${y - 4}" stroke="#245870" stroke-width="2"/>` : ''}<circle cx="${x(c.estimate)}" cy="${y - 4}" r="4" fill="#245870"/>` : ''}<text x="870" y="${y}">${safe(ciText(c))}pp</text><text x="870" y="${y + 16}" font-size="11">${safe(r.status.replaceAll('_', ' '))}</text>`;
    })
    .join(
      '',
    )}<text x="20" y="564">Gold dashed line: +5pp practical target (H1–H6); H7 uses the separate reviewer criterion.</text><text x="20" y="586">Point benefit and uncertainty are distinct. N/A intervals are not zero. No deployment recommendation.</text></g></svg>`;
}

/** CLI reads existing public experiment artifacts only; all label access is explicit and evaluator-side. */
export async function runDecisionAnalysis(
  directory: string,
  options: { freezePath?: string; reviewerDirectory?: string; reviewerLabelsPath?: string } = {},
) {
  const provenance: Record<string, unknown> = { schemaVersion: 1, createdAt: new Date().toISOString() };
  const read = (path: string, key: string, optional = false): any => {
    if (!existsSync(path)) {
      if (optional) {
        provenance[key] = null;
        return undefined;
      }
      throw new Error(`MISSING_ANALYSIS_INPUT:${key}`);
    }
    const text = readFileSync(path, 'utf8');
    provenance[key] = sha(text);
    return JSON.parse(text);
  };
  const primary = read(join(directory, 'results.json'), 'primaryReportSha256') as StudyReport;
  const artifacts: DecisionArtifacts = {
    primaryReportSha256: provenance.primaryReportSha256 as string,
    analysisScorerSha256: sha(readFileSync('research/scoring.ts', 'utf8')),
    analysisProtocolSha256: sha(readFileSync('docs/PLAN.md', 'utf8')),
    sourceManifest: read(join(directory, 'source-manifest.json'), 'sourceManifestSha256', true),
    manifest: read(join(directory, 'manifest.json'), 'manifestSha256', true),
    before: read(join(directory, 'before.json'), 'beforeSha256', true),
    after: read(join(directory, 'after.json'), 'afterSha256', true),
    freeze: options.freezePath ? read(options.freezePath, 'freezeSha256') : undefined,
    commonAnalysis: read(
      join(directory, 'common-capabilities/common-capabilities.json'),
      'commonAnalysisSha256',
      true,
    ),
    commonProvenance: read(
      join(directory, 'common-capabilities/analysis-provenance.json'),
      'commonProvenanceSha256',
      true,
    ),
    validityNotice: read(join(directory, 'validity-notice.json'), 'validityNoticeSha256', true),
  };
  let reviewers: ReviewerInputs | undefined;
  if (options.reviewerDirectory || options.reviewerLabelsPath) {
    if (!options.reviewerDirectory || !options.reviewerLabelsPath)
      throw new Error('BOTH_REVIEWER_PATHS_REQUIRED');
    const split = primary.split;
    const raw = readFileSync(join(options.reviewerDirectory, `${split}.jsonl`), 'utf8');
    provenance.verifierRawOutcomesSha256 = sha(raw);
    const records = raw
      .split('\n')
      .filter((s) => s.trim())
      .map((s) => JSON.parse(s)) as VerifierRecord[];
    const labels = read(options.reviewerLabelsPath, 'verifierLabelsSha256') as ReviewerLabel[];
    const manifest = read(
      join(options.reviewerDirectory, `${split}-manifest.json`),
      'verifierManifestSha256',
    );
    read(join(options.reviewerDirectory, `${split}-results.json`), 'verifierResultsSha256');
    const sameCases =
      Array.isArray(manifest.caseIds) &&
      JSON.stringify([...manifest.caseIds].sort()) === JSON.stringify(labels.map((l) => l.caseId).sort());
    // Reference access happens only on explicitly requested post-run evaluator analysis. It is never sent to providers.
    const { reviewCases } = await import('../research/reference');
    const { visibleReviewInput, reviewInputHash } = await import('../research/validator-study');
    const selected = reviewCases.filter((c) => c.split === split);
    const hashes = new Map(selected.map((c) => [c.id, reviewInputHash(visibleReviewInput(c))]));
    const labelsBound = verifyReviewerLabels(
      labels,
      reviewCases,
      artifacts.freeze?.referenceCasesHash,
      split,
    );
    const inputsBound =
      manifest.inputHash === sha(JSON.stringify(selected.map(visibleReviewInput))) &&
      records.every((r) => r.inputHash === hashes.get(r.caseId));
    const verified =
      labelsBound &&
      inputsBound &&
      !!artifacts.freeze &&
      manifest.fullSourceHash === artifacts.freeze.frozenSourceHash &&
      manifest.threshold === artifacts.freeze.threshold &&
      manifest.split === split &&
      sameCases &&
      typeof manifest.createdAt === 'string' &&
      typeof artifacts.freeze.boundAt === 'string' &&
      Date.parse(manifest.createdAt) >= Date.parse(artifacts.freeze.boundAt);
    provenance.verifierReferenceCasesSha256 = sha(JSON.stringify(canonical(reviewCases)));
    reviewers = { records, labels, threshold: manifest.threshold, provenanceVerified: verified };
  }
  const result = analyzeStudyDecisions(primary, artifacts, reviewers);
  Object.assign(provenance, {
    runId: primary.runId,
    analyzerSha256: sha(readFileSync(fileURLToPath(import.meta.url), 'utf8')),
    pairedScorerSha256: sha(readFileSync('research/scoring.ts', 'utf8')),
    protocolSha256: artifacts.analysisProtocolSha256,
    specificationSha256: sha(JSON.stringify(TARGETED_COMPARISONS)),
  });
  const output = join(directory, 'decisions');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'decisions.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(output, 'report.md'), renderDecisions(result));
  writeFileSync(join(output, 'targeted-effects.svg'), renderDecisionSvg(result));
  writeFileSync(join(output, 'analysis-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  return { output, eligible: result.eligibility.eligible };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, ...args] = process.argv.slice(2);
  if (!directory)
    throw new Error(
      'Usage: analyze-study-decisions.ts RUN_DIR [--freeze PUBLIC_FREEZE_JSON] [--reviewers REVIEWER_DIR --reviewer-labels EVALUATOR_LABEL_PROJECTION_JSON]',
    );
  const options: { freezePath?: string; reviewerDirectory?: string; reviewerLabelsPath?: string } = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i + 1]) throw new Error('MISSING_ARGUMENT');
    if (args[i] === '--freeze') options.freezePath = args[i + 1];
    else if (args[i] === '--reviewers') options.reviewerDirectory = args[i + 1];
    else if (args[i] === '--reviewer-labels') options.reviewerLabelsPath = args[i + 1];
    else throw new Error('UNKNOWN_ARGUMENT');
  }
  console.log(JSON.stringify(await runDecisionAnalysis(directory, options)));
}
