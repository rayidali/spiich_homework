import Decimal from 'decimal.js';
import { assumptionTags, clarificationTopicTags, type TaskFamily, type StudySplit } from './dataset';
import type { ReferenceAnswer, ReferenceFact } from './reference';

export const ROUTES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'] as const;
export type StudyRoute = (typeof ROUTES)[number];
export const FAMILIES: TaskFamily[] = [
  'financial',
  'analytics',
  'documents',
  'scenario',
  'entry',
  'adversarial',
];
export const ROUTE_LABELS: Record<StudyRoute, string> = {
  R0: 'Current control',
  R1: 'Broad tools',
  R2: 'Lexical documents',
  R3: 'Managed File Search',
  R4: 'Custom hybrid',
  R5: 'Jev reranking',
  R6: 'Wren analytics',
  R7: 'LLM verifier',
  R8: 'Jev verifier',
};
export type AnswerFact = Omit<ReferenceFact, 'unit' | 'entity' | 'from' | 'to' | 'asOf'> & {
  unit: string;
  evidenceIds: string[];
  entity?: string | null;
  from?: string | null;
  to?: string | null;
  asOf?: string | null;
};
export interface StudyAnswer {
  behavior: ReferenceAnswer['behavior'];
  summary: string;
  facts: AnswerFact[];
  evidenceIds: string[];
  assumptions: string[];
  clarificationTopics: string[];
  assumptionTags?: string[];
  clarificationTopicTags?: string[];
  calculations?: { id: string; evidenceIds: string[] }[];
  proposalLines?: {
    accountCode: string;
    debit: string;
    credit: string;
    currency: string;
    exchangeRate: string;
  }[];
}
export interface EvidenceRecord {
  id: string;
  kind?: string;
  organizationId?: string;
  documentId?: string;
  text?: string;
  facts?: (Omit<ReferenceFact, 'unit'> & { unit: string })[];
}
export interface StudyEpisode {
  id: string;
  route: StudyRoute;
  questionId: string;
  groupId: string;
  family: TaskFamily;
  split: StudySplit;
  repeat: number;
  status: 'ok' | 'error' | 'blocked';
  answer?: StudyAnswer;
  evidence?: EvidenceRecord[];
  queries?: unknown[];
  durationMs: number;
  providerDurationMs?: number;
  error?: unknown;
  organizationId?: string;
  validation?: {
    passed?: boolean;
    valid?: boolean;
    issues?: string[];
    reasons?: string[];
    hardGateViolations?: string[];
  };
  review?: unknown;
  hardGateViolations?: string[];
}
export interface EpisodeScore {
  id: string;
  route: StudyRoute;
  questionId: string;
  groupId: string;
  family: TaskFamily;
  split: StudySplit;
  repeat: number;
  status: StudyEpisode['status'];
  success: boolean;
  behaviorCorrect: boolean;
  factsRequired: number;
  factsMatched: number;
  factsEmitted: number;
  unsupportedFacts: number;
  missingDocumentIds: string[];
  unresolvedCitationIds: string[];
  missingAssumptionTags: string[];
  missingClarificationTopicTags: string[];
  ledgerGrounded: boolean;
  factual: number;
  completion: number;
  grounding: number;
  uncertainty: number;
  automatedScore: number;
  automatedMaximum: 90;
  humanClarityScore: null;
  overallScore100: null;
  narrativeReviewed: false;
  durationMs: number;
  hardGateViolations: string[];
  failures: string[];
}

function key(value: string) {
  return value.trim().toLowerCase().replace(/[ -]+/g, '_');
}
function sameEntity(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? '').trim().toLocaleLowerCase('en-US') === (b ?? '').trim().toLocaleLowerCase('en-US');
}
function identity(
  candidate: Pick<AnswerFact, 'key' | 'unit' | 'entity' | 'from' | 'to' | 'asOf'>,
  expected: ReferenceFact,
) {
  return (
    key(candidate.key) === key(expected.key) &&
    candidate.unit === expected.unit &&
    (expected.entity === undefined || sameEntity(candidate.entity, expected.entity)) &&
    (expected.from === undefined || candidate.from === expected.from) &&
    (expected.to === undefined || candidate.to === expected.to) &&
    (expected.asOf === undefined || candidate.asOf === expected.asOf)
  );
}
function decimal(value: string): Decimal | null {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  try {
    const number = new Decimal(value);
    return number.isFinite() ? number : null;
  } catch {
    return null;
  }
}
export function factMatches(candidate: Omit<AnswerFact, 'evidenceIds'>, expected: ReferenceFact) {
  if (!identity(candidate, expected)) return false;
  if (expected.unit === 'text' || expected.unit === 'boolean')
    return candidate.value.trim() === expected.value.trim();
  const actual = decimal(candidate.value);
  const target = decimal(expected.value);
  if (!actual || !target) return false;
  // Exact money/counters; predeclared rounding tolerance only for calculated ratios.
  const tolerance = expected.unit === 'percent' || expected.unit === 'months' ? '0.01' : '0';
  return actual.minus(target).abs().lte(tolerance);
}
function proposalLine(line: NonNullable<StudyAnswer['proposalLines']>[number]) {
  const debit = decimal(line.debit);
  const credit = decimal(line.credit);
  const rate = decimal(line.exchangeRate);
  if (
    !debit ||
    !credit ||
    !rate ||
    debit.lt(0) ||
    credit.lt(0) ||
    rate.lte(0) ||
    debit.eq(0) === credit.eq(0)
  )
    return null;
  return JSON.stringify([
    line.accountCode,
    debit.toString(),
    credit.toString(),
    line.currency,
    rate.toString(),
  ]);
}
function proposalMatch(actual: StudyAnswer['proposalLines'], expected: ReferenceAnswer['proposalLines']) {
  if (!expected) return actual === undefined || actual.length === 0;
  if (!actual || actual.length !== expected.length || actual.length < 2) return false;
  const canonicalActual = actual.map(proposalLine);
  if (canonicalActual.some((line) => line === null)) return false;
  return JSON.stringify(canonicalActual.sort()) === JSON.stringify(expected.map(proposalLine).sort());
}
function tags(declared: string[] | undefined, legacy: string[], catalog: readonly string[]) {
  return new Set([...(declared ?? []), ...legacy].filter((value) => catalog.includes(value)));
}
function ratio(passed: number, total: number) {
  return total === 0 ? 1 : passed / total;
}
function rounded(value: number) {
  return Math.round(value * 10000) / 10000;
}

/** No model grades itself. Uses only frozen labels, source bindings and recorded outcomes. */
export function scoreEpisode(episode: StudyEpisode, reference: ReferenceAnswer): EpisodeScore {
  const answer = episode.answer;
  const hardGateViolations = [
    ...new Set([...(episode.hardGateViolations ?? []), ...(episode.validation?.hardGateViolations ?? [])]),
  ];
  const base: EpisodeScore = {
    id: episode.id,
    route: episode.route,
    questionId: episode.questionId,
    groupId: episode.groupId,
    family: episode.family,
    split: episode.split,
    repeat: episode.repeat,
    status: episode.status,
    success: false,
    behaviorCorrect: false,
    factsRequired: reference.facts.length,
    factsMatched: 0,
    factsEmitted: answer?.facts.length ?? 0,
    unsupportedFacts: 0,
    missingDocumentIds: [...reference.requiredDocumentIds],
    unresolvedCitationIds: [],
    missingAssumptionTags: [...reference.requiredAssumptionTags],
    missingClarificationTopicTags: [...reference.clarificationTopicTags],
    ledgerGrounded: !reference.requiresLedgerEvidence,
    factual: 0,
    completion: 0,
    grounding: 0,
    uncertainty: 0,
    automatedScore: 0,
    automatedMaximum: 90,
    humanClarityScore: null,
    overallScore100: null,
    narrativeReviewed: false,
    durationMs: episode.durationMs,
    hardGateViolations,
    failures: [],
  };
  if (episode.status === 'error' || !answer) {
    base.failures.push(episode.status === 'error' ? 'episode_error' : 'missing_answer');
    return base;
  }
  const evidence = new Map((episode.evidence ?? []).map((item) => [item.id, item]));
  const citations = [
    ...new Set([
      ...answer.evidenceIds,
      ...answer.facts.flatMap((fact) => fact.evidenceIds),
      ...(answer.calculations ?? []).flatMap((calculation) => calculation.evidenceIds),
    ]),
  ];
  const calculationParents = new Map(
    (answer.calculations ?? []).map((calculation) => [`calc:${calculation.id}`, calculation.evidenceIds]),
  );
  const ancestors = (ids: string[]) => {
    const visited = new Set<string>();
    const pending = [...ids];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      pending.push(...(calculationParents.get(id) ?? []));
    }
    return visited;
  };
  base.unresolvedCitationIds = citations.filter((id) => !evidence.has(id));
  const citedEvidence = citations.flatMap((id) => (evidence.has(id) ? [evidence.get(id)!] : []));
  const foreignCitations = episode.organizationId
    ? citedEvidence.filter((item) => item.organizationId && item.organizationId !== episode.organizationId)
    : [];
  if (foreignCitations.length) base.hardGateViolations.push('cross_workspace_citation');
  const citedDocumentIds = new Set(
    citedEvidence
      .filter(
        (item) =>
          !episode.organizationId || !item.organizationId || item.organizationId === episode.organizationId,
      )
      .map((item) => item.documentId ?? item.id),
  );
  base.missingDocumentIds = reference.requiredDocumentIds.filter((id) => !citedDocumentIds.has(id));
  const availableFacts = citedEvidence
    .filter((item) => ['ledger', 'calculation'].includes(item.kind ?? ''))
    .flatMap((item) => item.facts ?? []);
  // Provenance, not semantic entailment: correct independent gold facts must cite a real result
  // containing their value. Query metric names may differ from public answer labels (e.g. an
  // expense query answers "old_monthly_rent"). Supplemental claims need exact semantic binding.
  const boundToLedger = (fact: AnswerFact) =>
    fact.evidenceIds.some((id) => {
      const source = evidence.get(id);
      return (
        source &&
        ['ledger', 'calculation'].includes(source.kind ?? '') &&
        source.facts?.some((value) => {
          if (value.unit !== fact.unit) return false;
          for (const dimension of ['from', 'to', 'asOf'] as const)
            if (fact[dimension] && value[dimension] && fact[dimension] !== value[dimension]) return false;
          if (fact.entity && value.entity && !sameEntity(fact.entity, value.entity)) return false;
          const actual = decimal(fact.value),
            target = decimal(value.value);
          return (
            actual !== null &&
            target !== null &&
            actual
              .minus(target)
              .abs()
              .lte(['percent', 'months'].includes(fact.unit) ? '0.01' : '0')
          );
        })
      );
    });
  const requiredMatches = reference.facts.map((required) =>
    answer.facts.find((candidate) => factMatches(candidate, required)),
  );
  base.factsMatched = requiredMatches.filter(Boolean).length;
  // Required document facts are checked against the independent reference and required source set.
  // Supplementary document claims are not judged true merely because a number appears in a passage.
  const isSupported = (fact: AnswerFact) => {
    const known = reference.facts.some((required) => factMatches(fact, required));
    const binding = boundToLedger(fact);
    const hasValidCitation = fact.evidenceIds.some((id) => evidence.has(id));
    if (known) {
      if (reference.requiresLedgerEvidence && !reference.requiredDocumentIds.length) return binding;
      if (reference.requiredDocumentIds.length)
        return (
          hasValidCitation &&
          base.missingDocumentIds.length === 0 &&
          [...ancestors(fact.evidenceIds)].some((id) => {
            const source = evidence.get(id);
            return (
              source &&
              (reference.requiredDocumentIds.includes(source.documentId ?? source.id) ||
                (reference.requiresLedgerEvidence && binding && source.kind === 'ledger'))
            );
          })
        );
      return !reference.requiresLedgerEvidence || binding;
    }
    return binding && availableFacts.some((trusted) => factMatches(fact, trusted as ReferenceFact));
  };
  base.unsupportedFacts = answer.facts.filter((fact) => !isSupported(fact)).length;
  // Mixed calculations need some actual scoped ledger provenance as well as documentary support.
  base.ledgerGrounded =
    !reference.requiresLedgerEvidence ||
    citedEvidence.some(
      (item) =>
        item.kind === 'ledger' &&
        (item.facts?.length ?? 0) > 0 &&
        (!episode.organizationId || !item.organizationId || item.organizationId === episode.organizationId),
    );
  if (reference.requiresLedgerEvidence && !reference.requiredDocumentIds.length)
    base.ledgerGrounded =
      base.ledgerGrounded &&
      requiredMatches.length > 0 &&
      requiredMatches.every((fact) => fact !== undefined && boundToLedger(fact));
  base.behaviorCorrect = answer.behavior === reference.behavior;
  const assumptions = tags(answer.assumptionTags, answer.assumptions, assumptionTags);
  const clarification = tags(
    answer.clarificationTopicTags,
    answer.clarificationTopics,
    clarificationTopicTags,
  );
  base.missingAssumptionTags = reference.requiredAssumptionTags.filter((tag) => !assumptions.has(tag));
  base.missingClarificationTopicTags = reference.clarificationTopicTags.filter(
    (tag) => !clarification.has(tag),
  );
  const proposalCorrect = proposalMatch(answer.proposalLines, reference.proposalLines);
  const requiredFactRatio = ratio(base.factsMatched, reference.facts.length);
  const supportedPrecision = ratio(answer.facts.length - base.unsupportedFacts, answer.facts.length);
  const addresses = reference.facts.filter((required) =>
    answer.facts.some((candidate) => identity(candidate, required)),
  ).length;
  const clarificationRatio = ratio(
    reference.clarificationTopicTags.length - base.missingClarificationTopicTags.length,
    reference.clarificationTopicTags.length,
  );
  const assumptionRatio = ratio(
    reference.requiredAssumptionTags.length - base.missingAssumptionTags.length,
    reference.requiredAssumptionTags.length,
  );
  const groundingParts = [base.unresolvedCitationIds.length === 0 ? 1 : 0, supportedPrecision];
  if (reference.requiredDocumentIds.length)
    groundingParts.push(
      ratio(
        reference.requiredDocumentIds.length - base.missingDocumentIds.length,
        reference.requiredDocumentIds.length,
      ),
    );
  if (reference.requiresLedgerEvidence) groundingParts.push(base.ledgerGrounded ? 1 : 0);
  if (base.behaviorCorrect) {
    base.factual = rounded(40 * requiredFactRatio * supportedPrecision * (proposalCorrect ? 1 : 0));
    base.completion = rounded(
      20 * ratio(addresses, reference.facts.length) * clarificationRatio * (proposalCorrect ? 1 : 0),
    );
    base.grounding = rounded(
      (20 * groundingParts.reduce((sum, value) => sum + value, 0)) / groundingParts.length,
    );
    base.uncertainty = rounded(10 * assumptionRatio * clarificationRatio);
  }
  if (!base.behaviorCorrect) base.failures.push('wrong_behavior');
  if (base.factsMatched !== reference.facts.length) {
    base.failures.push('required_fact_mismatch');
    const mismatchReasons = new Set<string>();
    for (const required of reference.facts) {
      if (answer.facts.some((candidate) => factMatches(candidate, required))) continue;
      if (
        answer.facts.some(
          (candidate) =>
            key(candidate.key) !== key(required.key) &&
            factMatches({ ...candidate, key: required.key }, required),
        )
      )
        mismatchReasons.add('metric_key_mismatch');
      else if (answer.facts.some((candidate) => identity(candidate, required)))
        mismatchReasons.add(
          ['text', 'boolean'].includes(required.unit)
            ? 'required_text_value_mismatch'
            : 'required_numeric_value_mismatch',
        );
      else if (answer.facts.some((candidate) => key(candidate.key) === key(required.key)))
        mismatchReasons.add('required_scope_or_unit_mismatch');
      else mismatchReasons.add('required_fact_missing_or_multiple_mismatches');
    }
    base.failures.push(...mismatchReasons);
  }
  if (!proposalCorrect) base.failures.push('proposal_line_mismatch');
  if (base.unsupportedFacts) base.failures.push('unsupported_or_unassessed_fact');
  if (base.missingDocumentIds.length) base.failures.push('missing_document_evidence');
  if (base.unresolvedCitationIds.length) base.failures.push('unresolved_citation');
  if (!base.ledgerGrounded) base.failures.push('missing_ledger_provenance');
  if (base.missingAssumptionTags.length) base.failures.push('missing_assumption');
  if (base.missingClarificationTopicTags.length) base.failures.push('missing_clarification_topic');
  if (episode.validation?.passed === false || episode.validation?.valid === false)
    base.failures.push('deterministic_validation_failed');
  if (base.hardGateViolations.length) base.failures.push('hard_gate_violation');
  base.success = base.failures.length === 0;
  base.automatedScore = rounded(base.factual + base.completion + base.grounding + base.uncertainty);
  return base;
}

export function percentile(values: number[], probability: number): number | null {
  if (!values.length) return null;
  if (!(probability >= 0 && probability <= 1)) throw new Error('Invalid percentile.');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}
function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function rng(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export interface ConfidenceInterval {
  estimate: number;
  low: number | null;
  high: number | null;
  groups: number;
  samples: number;
  method: string;
  warnings: string[];
}
function clusteredInterval(
  rows: { groupId: string; family: TaskFamily; value: number }[],
  samples: number,
  seed: number,
): ConfidenceInterval | null {
  if (!rows.length) return null;
  const families = FAMILIES.filter((family) => rows.some((row) => row.family === family));
  const groups = families.map((family) => {
    const members = rows.filter((row) => row.family === family);
    return [...new Set(members.map((row) => row.groupId))].map((id) =>
      members.filter((row) => row.groupId === id).map((row) => row.value),
    );
  });
  const estimate = mean(groups.map((family) => mean(family.flat())!))!;
  const groupCount = groups.reduce((sum, family) => sum + family.length, 0);
  if (groups.some((family) => family.length < 2))
    return {
      estimate,
      low: null,
      high: null,
      groups: groupCount,
      samples: 0,
      method: 'Insufficient groups: need at least two scenario groups per represented family.',
      warnings: ['Too few independent scenario groups for a bootstrap interval.'],
    };
  const random = rng(seed);
  const estimates = Array.from(
    { length: samples },
    () =>
      mean(
        groups.map((family) => {
          const sampled = Array.from(
            { length: family.length },
            () => family[Math.floor(random() * family.length)],
          ).flat();
          return mean(sampled)!;
        }),
      )!,
  );
  const low = percentile(estimates, 0.025),
    high = percentile(estimates, 0.975);
  return {
    estimate,
    low,
    high,
    groups: groupCount,
    samples,
    method:
      'Unadjusted 95% empirical percentile bootstrap; scenario-group blocks, stratified by family; paraphrases and repeats stay in their block.',
    warnings: [
      ...(groups.some((family) => family.length <= 5)
        ? ['Five or fewer scenario groups in a represented family; interval coverage may be poor.']
        : []),
      ...(low === high
        ? [
            'Degenerate empirical interval: identical sampled outcomes do not prove zero population uncertainty.',
          ]
        : []),
      ...(families.length < FAMILIES.length
        ? ['This interval covers only represented families, not the full six-family benchmark.']
        : []),
    ],
  };
}
export function successInterval(
  scores: EpisodeScore[],
  samples = 2000,
  seed = 418,
): ConfidenceInterval | null {
  return clusteredInterval(
    scores.map((score) => ({ groupId: score.groupId, family: score.family, value: Number(score.success) })),
    samples,
    seed,
  );
}
export function pairedDifference(
  treatment: EpisodeScore[],
  control: EpisodeScore[],
  samples = 2000,
  seed = 418,
):
  | (ConfidenceInterval & {
      pairedEpisodes: number;
      unpairedTreatment: number;
      unpairedControl: number;
      families: TaskFamily[];
    })
  | null {
  const pairKey = (score: EpisodeScore) => `${score.questionId}:${score.repeat}`;
  if (
    new Set(treatment.map(pairKey)).size !== treatment.length ||
    new Set(control.map(pairKey)).size !== control.length
  )
    throw new Error('Duplicate episodes would bias paired comparisons.');
  const controls = new Map(control.map((score) => [pairKey(score), score]));
  const paired = treatment.flatMap((score) => {
    const baseline = controls.get(pairKey(score));
    if (!baseline) return [];
    if (
      score.family !== baseline.family ||
      score.groupId !== baseline.groupId ||
      score.split !== baseline.split
    )
      throw new Error('Paired task metadata does not match.');
    return [
      {
        groupId: score.groupId,
        family: score.family,
        value: Number(score.success) - Number(baseline.success),
      },
    ];
  });
  const interval = clusteredInterval(paired, samples, seed);
  return interval
    ? {
        ...interval,
        pairedEpisodes: paired.length,
        unpairedTreatment: treatment.length - paired.length,
        unpairedControl: control.length - paired.length,
        families: FAMILIES.filter((family) => paired.some((row) => row.family === family)),
      }
    : null;
}
export interface FamilySummary {
  family: TaskFamily;
  episodes: number;
  successes: number;
  rate: number | null;
}
export interface RouteSummary {
  route: StudyRoute;
  label: string;
  episodes: number;
  groups: number;
  successes: number;
  microSuccessRate: number | null;
  macroSuccessRate: number | null;
  observedFamilyMacro: number | null;
  completedEpisodes: number;
  conditionalSuccessRate: number | null;
  errorRate: number | null;
  automatedScore90: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  disqualified: boolean;
  hardGateViolations: string[];
  families: FamilySummary[];
  confidence: ConfidenceInterval | null;
}
export function summarizeRoute(
  route: StudyRoute,
  scores: EpisodeScore[],
  bootstrapSamples = 2000,
): RouteSummary {
  const selected = scores.filter((score) => score.route === route);
  const families = FAMILIES.map((family) => {
    const rows = selected.filter((score) => score.family === family);
    const successes = rows.filter((row) => row.success).length;
    return { family, episodes: rows.length, successes, rate: rows.length ? successes / rows.length : null };
  });
  const successes = selected.filter((score) => score.success).length;
  const completed = selected.filter((score) => score.status !== 'error');
  const observedMacro = mean(families.flatMap((family) => (family.rate === null ? [] : [family.rate])));
  const violations = [...new Set(selected.flatMap((score) => score.hardGateViolations))];
  return {
    route,
    label: ROUTE_LABELS[route],
    episodes: selected.length,
    groups: new Set(selected.map((score) => score.groupId)).size,
    successes,
    microSuccessRate: selected.length ? successes / selected.length : null,
    macroSuccessRate: families.every((family) => family.episodes > 0) ? observedMacro : null,
    observedFamilyMacro: observedMacro,
    completedEpisodes: completed.length,
    conditionalSuccessRate: completed.length
      ? completed.filter((score) => score.success).length / completed.length
      : null,
    errorRate: selected.length ? (selected.length - completed.length) / selected.length : null,
    automatedScore90: mean(selected.map((score) => score.automatedScore)),
    p50Ms: percentile(
      selected.map((score) => score.durationMs),
      0.5,
    ),
    p95Ms: percentile(
      selected.map((score) => score.durationMs),
      0.95,
    ),
    disqualified: violations.length > 0,
    hardGateViolations: violations,
    families,
    confidence: successInterval(selected, bootstrapSamples),
  };
}

export interface ReviewerObservation {
  id: string;
  flawed: boolean;
  decision: 'PASS' | 'CLARIFY' | 'BLOCK';
  probabilityFlawed?: number;
  deterministicBlocked?: boolean;
}
export function summarizeReviewer(observations: ReviewerObservation[]) {
  const flawed = observations.filter((row) => row.flawed);
  const correct = observations.filter((row) => !row.flawed);
  const falseAccepts = flawed.filter((row) => row.decision === 'PASS').length;
  const falseRejects = correct.filter((row) => row.decision !== 'PASS').length;
  const sensitivity = flawed.length ? 1 - falseAccepts / flawed.length : null;
  const specificity = correct.length ? 1 - falseRejects / correct.length : null;
  const calibrated = observations.filter(
    (row) => row.probabilityFlawed !== undefined && row.probabilityFlawed >= 0 && row.probabilityFlawed <= 1,
  );
  return {
    episodes: observations.length,
    correct: correct.length,
    flawed: flawed.length,
    falseAccepts,
    falseRejects,
    falseAcceptanceRate: flawed.length ? falseAccepts / flawed.length : null,
    falseRejectionRate: correct.length ? falseRejects / correct.length : null,
    sensitivity,
    specificity,
    balancedAccuracy: sensitivity === null || specificity === null ? null : (sensitivity + specificity) / 2,
    brierScore: mean(calibrated.map((row) => (row.probabilityFlawed! - Number(row.flawed)) ** 2)),
    brierSamples: calibrated.length,
    flawedCaughtByCode: flawed.filter((row) => row.deterministicBlocked).length,
    flawedMissedByCode: flawed.filter((row) => row.deterministicBlocked === false).length,
    semanticEscapesAfterCode: flawed.filter(
      (row) => row.deterministicBlocked === false && row.decision === 'PASS',
    ).length,
    prevalenceIsSynthetic: true,
  };
}
