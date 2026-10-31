import { Decimal } from '../../shared/money';
import type { EvaluationCase, EvaluationFact, RecordedCall } from './types';
export type ScoredFact = EvaluationFact & { proof: Record<string, unknown> };
export type Execution = {
  facts: ScoredFact[];
  answer: string;
  errorCode?: string;
  truncated: boolean;
  clarification?: { reason: string; accountCodes: string[]; limitation: string };
  scenario?: unknown;
};
function equal(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && [...a].sort().every((v, i) => equal(v, [...b].sort()[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object')
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.entries(a).every(([k, v]) => equal(v, (b as Record<string, unknown>)[k]))
    );
  return a === b;
}
const defaults: Record<string, unknown> = {
  accountCodes: [],
  counterparty: { mode: 'any', value: '' },
  currencyMode: 'base',
  cooccurringAccountCodes: [],
  descriptionSearch: '',
  minimumAmount: null,
  maximumAmount: null,
};
/** An omitted requested filter means unfiltered, not a wildcard that accepts extra restrictions. */
export function sameScope(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  required: Record<string, unknown> = {},
) {
  for (const key of ['from', 'to', 'asOf', 'status', ...Object.keys(defaults)]) {
    const e = expected[key] ?? required[key] ?? defaults[key] ?? null,
      a = actual[key] ?? defaults[key] ?? null;
    if (key === 'minimumAmount' || key === 'maximumAmount') {
      if (e !== null || a !== null) {
        try {
          if (e === null || a === null || !new Decimal(String(e)).eq(String(a))) return false;
        } catch {
          return false;
        }
      }
    } else if (!equal(e, a)) return false;
  }
  for (const key of ['month', 'entryId', 'rank', 'denominator'])
    if (key in expected && !equal(expected[key], actual[key])) return false;
  for (const [key, v] of Object.entries(required)) {
    const mapped = key === 'grain' ? 'groupBy' : key;
    const a = actual[mapped];
    if (key === 'minimumAmount' || key === 'maximumAmount') {
      try {
        if (a == null || !new Decimal(String(v)).eq(String(a))) return false;
      } catch {
        return false;
      }
    } else if (!equal(v, a)) return false;
  }
  return true;
}
export function scoreCase(
  c: EvaluationCase,
  call: RecordedCall | undefined,
  execution: Execution | undefined,
) {
  const clarification = call?.name === 'ask_clarification' || call?.name === 'request_details';
  const result = {
    caseId: c.id,
    commonCapability: c.commonCapability,
    answerable: c.expected.answerableFromRecordedDataAndExplicitAssumptions,
    outcome: 'fail' as 'pass' | 'fail' | 'needs_review',
    reason: 'NO_VALID_EXECUTION',
    numericCorrect: false,
    scopeCorrect: false,
    supportedAnswer: false,
    safeDeferral: false,
    matchedFacts: 0,
    expectedFacts: c.expected.facts.length,
  };
  if (!call || !execution || execution.errorCode) return result;
  if (c.expected.behavior !== 'answer') {
    if (!clarification) {
      result.reason = 'ANSWERED_WHEN_CLARIFICATION_OR_BOUNDARY_REQUIRED';
      return result;
    }
    result.safeDeferral = true;
    // Human-authored free text needs explicit rubric review. Keyword matches are not proof of meaning.
    if (call.name === 'ask_clarification' || c.expected.behavior === 'refuse') {
      result.outcome = 'needs_review';
      result.reason = 'BOUNDARY_WORDING_REQUIRES_RUBRIC_REVIEW';
      return result;
    }
    const reason = execution.clarification?.reason;
    const match =
      c.expected.behavior === 'out_of_scope'
        ? reason === 'off_topic'
        : reason === 'missing_period' || reason === 'missing_assumption' || reason === 'ambiguous_account';
    result.outcome = match ? 'pass' : 'fail';
    result.reason = match ? 'STRUCTURED_BOUNDARY_MATCH' : 'WRONG_CLARIFICATION_KIND';
    return result;
  }
  if (clarification) {
    result.reason = 'ANSWERABLE_COVERAGE_MISS';
    result.safeDeferral = true;
    return result;
  }
  const used = new Set<number>();
  for (const e of c.expected.facts) {
    if (e.metric.startsWith('scenario_')) continue;
    const idx = execution.facts.findIndex(
      (a, i) =>
        !used.has(i) &&
        a.metric === e.metric &&
        a.unit === e.unit &&
        sameScope(e.scope, a.scope, c.expected.requiredScope) &&
        new Decimal(a.value).eq(e.value),
    );
    if (idx >= 0) {
      used.add(idx);
      result.matchedFacts++;
    }
  }
  const ordinary = c.expected.facts.filter((f) => !f.metric.startsWith('scenario_'));
  result.numericCorrect = ordinary.every((e) =>
    execution.facts.some(
      (a) => a.metric === e.metric && a.unit === e.unit && new Decimal(a.value).eq(e.value),
    ),
  );
  result.scopeCorrect = ordinary.every((e) =>
    execution.facts.some(
      (a) =>
        a.metric === e.metric && a.unit === e.unit && sameScope(e.scope, a.scope, c.expected.requiredScope),
    ),
  );
  const hasScenario = c.expected.facts.some((f) => f.metric.startsWith('scenario_'));
  if (hasScenario && result.matchedFacts === ordinary.length && execution.scenario) {
    result.outcome = 'needs_review';
    result.reason = 'SCENARIO_FORMULA_MEANING_REQUIRES_RUBRIC_REVIEW';
    return result;
  }
  // Extra grouped rows can hide an incorrect top-N/period request. Query intermediates are separate proof, not answer rows.
  const permittedTopN =
    Number.isInteger(c.expected.requiredScope.limit) && c.expected.requiredScope.order === 'value_desc';
  if (
    result.matchedFacts === c.expected.facts.length &&
    (!execution.truncated || permittedTopN) &&
    execution.facts.length === c.expected.facts.length
  ) {
    result.outcome = 'pass';
    result.supportedAnswer = true;
    result.reason = 'EXACT_SCOPE_AND_DATABASE_FACTS';
  } else
    result.reason = execution.truncated
      ? 'TRUNCATED_RESULT'
      : result.scopeCorrect
        ? 'WRONG_OR_EXTRA_NUMERIC_FACTS'
        : 'SCOPE_DROPPED_OR_CHANGED';
  return result;
}
