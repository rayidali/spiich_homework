import { createHash } from 'node:crypto';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { extractSourceAmounts } from './answer';
import { reviewWithJev, reviewWithLlm, type ReviewInput } from './review';
import {
  GeminiResearchClient,
  JevResearchClient,
  JEV_CHECKS,
  type JevReviewProbabilities,
  type ProviderMetadata,
} from './providers';
import { providerReviewCase, type ReviewCase } from './reference';
import { summarizeReviewer } from './scoring';
import type { StudySplit } from './dataset';

export const VERIFIER_PROTOCOL = 'daybook-verifiers-v1';
export const VERIFIER_METHODS = ['deterministic', 'llm', 'jev'] as const;
export type VerifierMethod = (typeof VERIFIER_METHODS)[number];
export const JEV_THRESHOLD_GRID = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.98, 0.99, 1] as const;
export const MAX_ADDITIONAL_FALSE_REJECTION = 0.05;

const factSchema = z
  .object({
    key: z.string().min(1).max(100),
    value: z.string().max(500),
    unit: z.enum(['USD', 'EUR', 'percent', 'days', 'months', 'count', 'text', 'boolean']),
    entity: z.string().optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    asOf: z.string().date().optional(),
  })
  .strict();
const visibleSchema = z
  .object({
    question: z.string().min(1).max(10000),
    evidence: z
      .array(z.object({ id: z.string().min(1).max(160), text: z.string().max(30000) }).strict())
      .max(30),
    candidate: z
      .object({
        behavior: z.enum(['ANSWER', 'CLARIFY', 'BLOCK', 'PROPOSAL']),
        facts: z.array(factSchema).max(30),
        evidenceIds: z.array(z.string().max(160)).max(30),
        assumptions: z.array(z.string().max(2000)).max(30),
        summary: z.string().max(10000),
      })
      .strict(),
  })
  .strict();
export type VisibleReviewCase = z.infer<typeof visibleSchema>;
export interface VerifierDecision {
  status: 'ok' | 'error';
  decision: 'PASS' | 'CLARIFY' | 'BLOCK' | null;
  reasons: string[];
  evidenceIds: string[];
  durationMs: number;
  probabilities?: JevReviewProbabilities;
  metadata?: ProviderMetadata;
  error?: string;
}
export interface VerifierRecord extends VerifierDecision {
  id: string;
  caseId: string;
  sourceGroupId: string;
  split: StudySplit;
  method: VerifierMethod;
  inputHash: string;
  threshold: number | null;
}

export function visibleReviewInput(item: ReviewCase): VisibleReviewCase {
  // Explicit whitelist plus strict parsing: expected/faultType/deterministicExpected cannot enter prompts.
  return visibleSchema.parse(providerReviewCase(item));
}
export function reviewInputHash(input: VisibleReviewCase) {
  return createHash('sha256')
    .update(JSON.stringify(visibleSchema.parse(input)))
    .digest('hex');
}
export function normalizedReviewInput(input: VisibleReviewCase): ReviewInput {
  const value = visibleSchema.parse(input);
  return {
    question: value.question,
    answer: value.candidate,
    evidence: value.evidence,
    assumptions: value.candidate.assumptions,
  };
}

/** A deliberately narrow shared code baseline. It cannot understand prose contradictions. */
export function deterministicReview(input: unknown): VerifierDecision {
  const start = performance.now();
  const parsed = visibleSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: 'ok',
      decision: 'BLOCK',
      reasons: ['INVALID_REVIEW_SHAPE'],
      evidenceIds: [],
      durationMs: Math.round(performance.now() - start),
    };
  const { candidate, evidence } = parsed.data;
  const reasons: string[] = [];
  const sources = new Map(evidence.map((item) => [item.id, item.text]));
  if (sources.size !== evidence.length) reasons.push('DUPLICATE_SOURCE_ID');
  if (candidate.evidenceIds.some((id) => !sources.has(id))) reasons.push('UNKNOWN_EVIDENCE');
  if (candidate.behavior === 'ANSWER' && (!candidate.facts.length || !candidate.evidenceIds.length))
    reasons.push('UNCITED_OR_EMPTY_FACTS');
  if (candidate.behavior === 'PROPOSAL') reasons.push('PROPOSAL_NOT_IN_REVIEW_SCHEMA');
  const amounts = candidate.evidenceIds.flatMap((id) => extractSourceAmounts(sources.get(id) ?? ''));
  for (const fact of candidate.facts) {
    if (['text', 'boolean'].includes(fact.unit)) continue;
    if (!/^-?\d+(?:\.\d+)?$/.test(fact.value)) {
      reasons.push('INVALID_NUMERIC_FACT');
      continue;
    }
    if (!amounts.some((amount) => amount.unit === fact.unit && new Decimal(amount.value).eq(fact.value)))
      reasons.push('UNSUPPORTED_AMOUNT_OR_UNIT');
  }
  return {
    status: 'ok',
    decision: reasons.length ? 'BLOCK' : 'PASS',
    reasons: [...new Set(reasons)],
    evidenceIds: candidate.evidenceIds.filter((id) => sources.has(id)),
    durationMs: Math.round(performance.now() - start),
  };
}

function safeError(error: unknown) {
  const code =
    error instanceof Error && 'code' in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : '';
  return /^[A-Z][A-Z0-9_]{2,100}$/.test(code) ? code : 'VERIFIER_REQUEST_FAILED';
}

/** Decisions use only visible inputs; labels are consulted by analysis after this returns. */
export async function evaluateVerifier(
  method: VerifierMethod,
  input: VisibleReviewCase,
  clients: { gemini: GeminiResearchClient; jev: JevResearchClient },
  threshold = 0.8,
): Promise<VerifierDecision> {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error('INVALID_VERIFIER_THRESHOLD');
  if (method === 'deterministic') return deterministicReview(input);
  const start = performance.now();
  try {
    const normalized = normalizedReviewInput(input);
    if (method === 'llm') {
      const result = await reviewWithLlm(clients.gemini, normalized);
      const allowed = new Set(input.evidence.map((item) => item.id));
      if (result.data.evidenceIds.some((id) => !allowed.has(id)))
        throw new Error('VERIFIER_UNKNOWN_EVIDENCE');
      return {
        status: 'ok',
        decision: result.data.decision,
        reasons: result.data.reasons,
        evidenceIds: result.data.evidenceIds,
        metadata: result.metadata,
        durationMs: Math.round(performance.now() - start),
      };
    }
    const result = await reviewWithJev(clients.jev, normalized, threshold);
    return {
      status: 'ok',
      decision: result.decision,
      reasons: result.reasons,
      evidenceIds: [],
      probabilities: result.data,
      metadata: result.metadata,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    return {
      status: 'error',
      decision: null,
      reasons: [],
      evidenceIds: [],
      error: safeError(error),
      durationMs: Math.round(performance.now() - start),
    };
  }
}

function hazard(record: VerifierRecord) {
  if (
    record.status !== 'ok' ||
    !record.probabilities ||
    JEV_CHECKS.some(
      (check) =>
        !Number.isFinite(record.probabilities![check]) ||
        record.probabilities![check] < 0 ||
        record.probabilities![check] > 1,
    )
  )
    return null;
  return Math.max(...JEV_CHECKS.map((check) => record.probabilities![check]));
}
export function thresholdDecision(record: VerifierRecord, threshold: number): 'PASS' | 'BLOCK' {
  const value = hazard(record);
  // Operational policy: provider failure releases no candidate. It is reported separately from semantic detection.
  return value === null || value >= threshold ? 'BLOCK' : 'PASS';
}
export interface ThresholdSelection {
  protocol: typeof VERIFIER_PROTOCOL;
  threshold: number;
  feasible: boolean;
  selectedOn: 'development';
  developmentCases: number;
  correctCases: number;
  flawedCases: number;
  successfulJevDecisions: number;
  deterministicFalseRejectionRate: number;
  maxAdditionalFalseRejection: number;
  grid: {
    threshold: number;
    falseAccepts: number;
    falseRejects: number;
    falseRejectionRate: number;
    feasible: boolean;
  }[];
  selectionRule: string;
  probabilityCalibration: string;
}

export function selectJevThreshold(records: VerifierRecord[], cases: ReviewCase[]): ThresholdSelection {
  if (
    !cases.length ||
    cases.some((item) => item.split !== 'development') ||
    records.some((record) => record.split !== 'development')
  )
    throw new Error('THRESHOLD_SELECTION_REQUIRES_DEVELOPMENT_ONLY');
  const map = new Map(records.map((record) => [`${record.method}:${record.caseId}`, record]));
  if (map.size !== records.length) throw new Error('DUPLICATE_VERIFIER_RECORD');
  if (cases.some((item) => !map.has(`jev:${item.id}`) || !map.has(`deterministic:${item.id}`)))
    throw new Error('INCOMPLETE_THRESHOLD_DEVELOPMENT_SET');
  const correct = cases.filter((item) => item.expected === 'PASS');
  const flawed = cases.filter((item) => item.expected === 'BLOCK');
  if (!correct.length || !flawed.length) throw new Error('THRESHOLD_SELECTION_NEEDS_BOTH_CLASSES');
  const baselineRejection =
    correct.filter((item) => map.get(`deterministic:${item.id}`)!.decision !== 'PASS').length /
    correct.length;
  const grid = JEV_THRESHOLD_GRID.map((threshold) => {
    const falseAccepts = flawed.filter(
      (item) => thresholdDecision(map.get(`jev:${item.id}`)!, threshold) === 'PASS',
    ).length;
    const falseRejects = correct.filter(
      (item) => thresholdDecision(map.get(`jev:${item.id}`)!, threshold) !== 'PASS',
    ).length;
    const falseRejectionRate = falseRejects / correct.length;
    return {
      threshold,
      falseAccepts,
      falseRejects,
      falseRejectionRate,
      feasible: falseRejectionRate <= baselineRejection + MAX_ADDITIONAL_FALSE_REJECTION + 1e-12,
    };
  });
  const feasible = grid.filter((row) => row.feasible);
  const selected = [...(feasible.length ? feasible : grid)].sort((a, b) =>
    feasible.length
      ? a.falseAccepts - b.falseAccepts || a.falseRejects - b.falseRejects || b.threshold - a.threshold
      : a.falseRejects - b.falseRejects || a.falseAccepts - b.falseAccepts || b.threshold - a.threshold,
  )[0];
  return {
    protocol: VERIFIER_PROTOCOL,
    threshold: selected.threshold,
    feasible: feasible.length > 0,
    selectedOn: 'development',
    developmentCases: cases.length,
    correctCases: correct.length,
    flawedCases: flawed.length,
    successfulJevDecisions: cases.filter((item) => map.get(`jev:${item.id}`)!.status === 'ok').length,
    deterministicFalseRejectionRate: baselineRejection,
    maxAdditionalFalseRejection: MAX_ADDITIONAL_FALSE_REJECTION,
    grid,
    selectionRule:
      'Among thresholds adding at most 5 percentage points of correct-candidate rejection versus deterministic checks, minimize flawed acceptance; ties minimize false rejection, then choose the higher threshold. If none qualifies, retain the least-rejecting threshold only for measurement and mark feasibility false.',
    probabilityCalibration:
      'Maximum of seven hazard probabilities is an uncalibrated risk score, not probability that the entire answer is invalid. No overall Brier score is inferred.',
  };
}

export function analyzeVerifiers(records: VerifierRecord[], cases: ReviewCase[], threshold: number) {
  if (new Set(records.map((record) => `${record.method}:${record.caseId}`)).size !== records.length)
    throw new Error('DUPLICATE_VERIFIER_RECORD');
  const labels = new Map(cases.map((item) => [item.id, item]));
  if (records.some((record) => !labels.has(record.caseId))) throw new Error('UNKNOWN_VERIFIER_CASE');
  const code = new Map(
    records.filter((record) => record.method === 'deterministic').map((record) => [record.caseId, record]),
  );
  const methods = VERIFIER_METHODS.map((method) => {
    const selected = records.filter((record) => record.method === method);
    const successful = selected.filter((record) => record.status === 'ok');
    const observation = (record: VerifierRecord) => ({
      id: record.caseId,
      flawed: labels.get(record.caseId)!.expected === 'BLOCK',
      decision:
        method === 'jev'
          ? thresholdDecision(record, threshold)
          : record.status === 'error'
            ? ('BLOCK' as const)
            : record.decision!,
      deterministicBlocked: code.has(record.caseId)
        ? code.get(record.caseId)!.decision !== 'PASS'
        : undefined,
      // No probabilityFlawed: max(hazards) has not been calibrated to this target.
    });
    const operations = selected.map(observation);
    const combined = operations.map((row) => ({
      ...row,
      decision: row.deterministicBlocked === true ? ('BLOCK' as const) : row.decision,
    }));
    const faultTypes = [
      ...new Set(cases.map((item) => item.faultType).filter((value): value is string => value !== null)),
    ];
    return {
      method,
      plannedCases: cases.length,
      measuredCases: selected.length,
      missingCases: cases.length - selected.length,
      errors: selected.length - successful.length,
      conditionalSemantic: summarizeReviewer(successful.map(observation)),
      operationalFailClosed: summarizeReviewer(operations),
      combinedWithDeterministic: summarizeReviewer(combined),
      byFault: faultTypes.map((faultType) => {
        const subset = selected.filter((record) => labels.get(record.caseId)!.faultType === faultType);
        return {
          faultType,
          measured: subset.length,
          providerErrors: subset.filter((record) => record.status === 'error').length,
          accepted: subset.filter((record) => observation(record).decision === 'PASS').length,
        };
      }),
      probabilityCalibration: {
        available: false,
        reason:
          method === 'jev'
            ? 'Hazard-specific gold probabilities/labels were not independently adjudicated; maximum hazard is not an overall probability.'
            : 'No calibrated probability output.',
      },
    };
  });
  return {
    protocol: VERIFIER_PROTOCOL,
    threshold,
    cases: cases.length,
    correctCases: cases.filter((item) => item.expected === 'PASS').length,
    flawedCases: cases.filter((item) => item.expected === 'BLOCK').length,
    complete: methods.every((method) => method.measuredCases === method.plannedCases),
    methods,
    limitations: [
      'Synthetic stress cases have 50% flawed prevalence; these results do not estimate production precision.',
      'Correct/flawed pairs share source scenarios. Reused templates and fault patterns reduce independence; no publication-grade statistical power is claimed.',
      'The deterministic baseline checks schema, citation existence and exact source amount/currency pairs. It intentionally cannot detect semantic period/entity/narrative contradictions.',
      'Each semantic reviewer is run on every candidate, including code-detectable faults. Combined pipeline metrics show their additional contribution after code checks.',
      'Provider errors are separate from semantic decisions. The operational column blocks on errors; the conditional column includes only completed reviewer responses.',
      'Jev thresholds are selected only on development cases and frozen before holdout. Maximum hazard is an uncalibrated risk score; overall Brier calibration is unavailable.',
      'LLM critic and main generator use the same Gemini3.5FlashLite weights in separate contexts; their errors are not statistically independent.',
      'Reference fault labels are synthetic authored cases, not independently adjudicated human judgments. Narrative flaws are measured by these labels, not a judge-model truth claim.',
    ],
  };
}

export function renderVerifierMarkdown(
  report: ReturnType<typeof analyzeVerifiers>,
  selection: ThresholdSelection | null,
) {
  const pct = (value: number | null) => (value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`);
  const rows = report.methods.map((method) => {
    const s = method.conditionalSemantic,
      o = method.operationalFailClosed,
      combined = method.combinedWithDeterministic;
    return `| ${method.method} | ${method.measuredCases}/${method.plannedCases} | ${method.errors} | ${pct(s.falseAcceptanceRate)} | ${pct(s.falseRejectionRate)} | ${pct(s.balancedAccuracy)} | ${pct(o.falseAcceptanceRate)} / ${pct(o.falseRejectionRate)} | ${pct(combined.falseAcceptanceRate)} / ${pct(combined.falseRejectionRate)} |`;
  });
  return [
    '# Daybook validator stress study',
    '',
    `${report.cases} planned cases: ${report.correctCases} correct, ${report.flawedCases} deliberately flawed. ${report.complete ? 'All outcomes recorded.' : 'Incomplete: missing outcomes remain.'}`,
    '',
    `Jev threshold: **${report.threshold}**${selection ? `; selected on development only; 5pp false-rejection constraint ${selection.feasible ? 'satisfied' : 'NOT satisfied'}.` : '.'}`,
    '',
    '| Reviewer | Measured / planned | Errors | Conditional false accept | Conditional false reject | Conditional balanced accuracy | Fail-closed false accept / reject | With code false accept / reject |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    ...rows,
    '',
    'Conditional metrics exclude failed provider requests. Fail-closed metrics block on request errors; a failed request is not evidence that a semantic reviewer detected a flaw.',
    '',
    '## Fault breakdown',
    '',
    '| Reviewer | Injected fault | Measured | Accepted flawed | Provider errors |',
    '| --- | --- | ---: | ---: | ---: |',
    ...report.methods.flatMap((method) =>
      method.byFault.map(
        (row) =>
          `| ${method.method} | ${row.faultType} | ${row.measured} | ${row.accepted} | ${row.providerErrors} |`,
      ),
    ),
    '',
    '## Limits',
    '',
    ...report.limitations.map((limit) => `- ${limit}`),
    '',
  ].join('\n');
}
