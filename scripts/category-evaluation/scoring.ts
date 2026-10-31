import { createHash } from 'node:crypto';
import { Decimal, baseAmount } from '../../shared/money';
import { entrySchema } from '../../shared/schema';
import { categoryReference } from './references';
import { categoryFamilies, type CategoryCase, type CategoryObservation, type Selector } from './types';

export type CategoryScore = {
  caseId: string;
  sequenceId: string;
  family: CategoryCase['family'];
  split: CategoryCase['split'];
  correctionEvents: 0 | 1 | 3;
  selector: Selector;
  status: 'ok' | 'error' | 'missing';
  inputVerified: boolean;
  selectorEligible: boolean;
  decisionCorrect: boolean;
  semanticCategoryCorrect: boolean | null;
  preferenceAgreement: boolean | null;
  selectorSuccess: boolean | null;
  workflowHandlingSuccess: boolean;
  completeJournalCorrect: boolean | null;
  counterAccountCorrect: boolean | null;
  necessaryClarification: boolean;
  unnecessaryClarification: boolean;
  unsupportedInsteadOfAnswer: boolean;
  harmfulOvergeneralization: boolean;
  unsafeSuggestion: boolean;
  proposed: boolean;
  selectedCategoryCode: string | null;
  failures: string[];
};
const canonicalLines = (
  lines: { accountId: string; debit: string; credit: string; exchangeRate: string }[],
) =>
  lines
    .map((line) =>
      JSON.stringify({
        accountId: line.accountId,
        debit: new Decimal(line.debit).toString(),
        credit: new Decimal(line.credit).toString(),
        exchangeRate: new Decimal(line.exchangeRate).toString(),
      }),
    )
    .sort();

/** A journal is assessed only when a caller supplies actual workflow output.
 * Its account/amount/date oracle is independent of the candidate builder. */
function journalMatches(item: CategoryCase, observation: CategoryObservation, selectedAccountId: string) {
  if (!observation.workflow) return null;
  if (observation.workflow.posted) return false;
  const parsed = entrySchema.safeParse(observation.workflow.entry);
  if (!parsed.success || parsed.data.source !== 'AI') return false;
  const facts = item.input.facts;
  if (parsed.data.date !== facts.date || !facts.fundingAccountId || !facts.amount || !facts.exchangeRate)
    return false;
  const category = item.input.context.accounts.find((a) => a.id === selectedAccountId);
  const funding = item.input.context.accounts.find((a) => a.id === facts.fundingAccountId);
  if (
    !category ||
    !funding ||
    category.archived ||
    category.is_group ||
    funding.archived ||
    funding.is_group ||
    category.currency !== facts.currency ||
    funding.currency !== facts.currency
  )
    return false;
  const expected =
    facts.direction === 'OUT'
      ? [
          {
            accountId: selectedAccountId,
            debit: facts.amount,
            credit: '0',
            exchangeRate: facts.exchangeRate,
          },
          { accountId: funding.id, debit: '0', credit: facts.amount, exchangeRate: facts.exchangeRate },
        ]
      : [
          { accountId: funding.id, debit: facts.amount, credit: '0', exchangeRate: facts.exchangeRate },
          {
            accountId: selectedAccountId,
            debit: '0',
            credit: facts.amount,
            exchangeRate: facts.exchangeRate,
          },
        ];
  try {
    let net = new Decimal(0);
    for (const line of parsed.data.lines) {
      if (new Decimal(line.debit).gt(0) === new Decimal(line.credit).gt(0)) return false;
      net = net
        .plus(baseAmount(line.debit, line.exchangeRate))
        .minus(baseAmount(line.credit, line.exchangeRate));
    }
    return (
      net.isZero() &&
      JSON.stringify(canonicalLines(parsed.data.lines)) === JSON.stringify(canonicalLines(expected))
    );
  } catch {
    return false;
  }
}

export function scoreCategory(
  item: CategoryCase,
  selector: Selector,
  observation?: CategoryObservation,
): CategoryScore {
  const reference = categoryReference(item);
  const score: CategoryScore = {
    caseId: item.id,
    sequenceId: item.sequenceId,
    family: item.family,
    split: item.split,
    correctionEvents: item.correctionEvents,
    selector,
    status: observation?.status ?? 'missing',
    inputVerified: false,
    selectorEligible: reference.selectorEligible,
    decisionCorrect: false,
    semanticCategoryCorrect: reference.decision === 'SELECT' ? false : null,
    preferenceAgreement: reference.preferredCategoryCode ? false : null,
    selectorSuccess: reference.selectorEligible ? false : null,
    workflowHandlingSuccess: false,
    completeJournalCorrect: null,
    counterAccountCorrect: null,
    necessaryClarification: false,
    unnecessaryClarification: false,
    unsupportedInsteadOfAnswer: false,
    harmfulOvergeneralization: false,
    unsafeSuggestion: false,
    proposed: false,
    selectedCategoryCode: null,
    failures: [],
  };
  if (!observation) {
    score.failures.push('missing_attempt');
    return score;
  }
  const actualHash = createHash('sha256').update(JSON.stringify(item.input)).digest('hex');
  score.inputVerified =
    observation.caseId === item.id &&
    observation.selector === selector &&
    observation.inputHash === item.inputHash &&
    item.inputHash === actualHash;
  if (!score.inputVerified) score.failures.push('input_binding_mismatch');
  if (observation.status === 'error' || !observation.result) {
    score.failures.push(observation.errorCode ?? 'provider_or_workflow_error');
    return score;
  }
  if (
    (reference.selectorEligible && selector !== 'reference' && observation.attempts !== 1) ||
    (!reference.selectorEligible && observation.attempts !== 0) ||
    (selector === 'reference' && observation.attempts !== 0)
  )
    score.failures.push('attempt_contract_mismatch');
  const result = observation.result;
  score.proposed = result.decision === 'SELECT';
  score.decisionCorrect = result.decision === reference.decision;
  if (!score.decisionCorrect) score.failures.push('wrong_decision');
  if (result.decision === 'SELECT') {
    const selected = item.input.context.accounts.find(
      (a) =>
        a.id === result.accountId &&
        !a.archived &&
        !a.is_group &&
        a.organizationId === item.input.context.organizationId,
    );
    score.selectedCategoryCode = selected?.code ?? null;
    const categoryType = item.input.facts.direction === 'OUT' ? 'EXPENSE' : 'REVENUE';
    if (!selected || selected.type !== categoryType || selected.currency !== item.input.facts.currency)
      score.failures.push('invalid_category_option');
    if (reference.decision === 'SELECT') {
      score.semanticCategoryCorrect =
        selected !== undefined && reference.acceptableCategoryCodes.includes(selected.code);
      if (!score.semanticCategoryCorrect) score.failures.push('wrong_semantic_category');
      if (reference.preferredCategoryCode) {
        score.preferenceAgreement = selected?.code === reference.preferredCategoryCode;
        if (!score.preferenceAgreement) score.failures.push('missed_taught_preference');
      }
      if (observation.workflow) {
        const journal = entrySchema.safeParse(observation.workflow.entry);
        const funding = item.input.facts.fundingAccountId;
        score.counterAccountCorrect =
          journal.success &&
          journal.data.lines.length === 2 &&
          journal.data.lines.some(
            (line) =>
              line.accountId === funding &&
              (item.input.facts.direction === 'OUT'
                ? new Decimal(line.credit).gt(0)
                : new Decimal(line.debit).gt(0)),
          );
      }
      const journal = journalMatches(item, observation, result.accountId);
      score.completeJournalCorrect =
        journal === null
          ? null
          : journal && score.semanticCategoryCorrect && score.preferenceAgreement !== false;
      if (score.completeJournalCorrect === false) score.failures.push('complete_journal_mismatch');
    }
    score.unsafeSuggestion =
      reference.decision !== 'SELECT' ||
      !selected ||
      selected.type !== categoryType ||
      selected.currency !== item.input.facts.currency;
    score.harmfulOvergeneralization =
      reference.testsOvergeneralization &&
      (reference.decision !== 'SELECT' || score.semanticCategoryCorrect === false);
  } else if (result.decision === 'CLARIFY') {
    const validQuestion = result.question.trim().length > 0;
    score.necessaryClarification =
      reference.decision === 'CLARIFY' &&
      validQuestion &&
      reference.acceptableFirstTopics.includes(result.topic);
    score.unnecessaryClarification = reference.decision === 'SELECT';
    if (reference.decision === 'CLARIFY' && !score.necessaryClarification)
      score.failures.push('wrong_or_empty_clarification');
  } else {
    score.unsupportedInsteadOfAnswer = reference.decision === 'SELECT';
    if (
      !result.message.trim() ||
      (reference.decision === 'UNSUPPORTED' &&
        !reference.acceptableUnsupportedReasons.includes(result.reason))
    )
      score.failures.push('unsupported_handoff_mismatch');
  }
  if (observation.workflow?.posted || (result.decision !== 'SELECT' && observation.workflow?.entry)) {
    score.unsafeSuggestion = true;
    score.failures.push('posting_or_entry_despite_handoff');
  }
  score.workflowHandlingSuccess = score.failures.length === 0;
  // A correct category is not made into a model failure by a separate journal
  // builder defect, and balanced code output is not counted as model strength.
  score.selectorSuccess = reference.selectorEligible
    ? score.failures.every((failure) =>
        ['complete_journal_mismatch', 'posting_or_entry_despite_handoff'].includes(failure),
      )
    : null;
  return score;
}

export function scoreCategoryMatrix(
  cases: CategoryCase[],
  observations: CategoryObservation[],
  selectors: Selector[] = ['reference', 'gemini', 'jev'],
) {
  const expected = new Set(cases.map((item) => item.id));
  if (expected.size !== cases.length || new Set(selectors).size !== selectors.length)
    throw new Error('Duplicate matrix definition.');
  const indexed = new Map<string, CategoryObservation>();
  for (const observation of observations) {
    const key = `${observation.selector}:${observation.caseId}`;
    if (!expected.has(observation.caseId) || !selectors.includes(observation.selector) || indexed.has(key))
      throw new Error('Unknown or duplicated category attempt; never replace a failed observation.');
    indexed.set(key, observation);
  }
  return selectors.flatMap((selector) =>
    cases.map((item) => scoreCategory(item, selector, indexed.get(`${selector}:${item.id}`))),
  );
}

export function summarizeCategory(scores: CategoryScore[]) {
  const count = (predicate: (score: CategoryScore) => boolean) => scores.filter(predicate).length;
  const eligible = scores.filter((score) => score.selectorEligible);
  const journals = scores.filter((score) => score.completeJournalCorrect !== null);
  return {
    planned: scores.length,
    observed: count((s) => s.status !== 'missing'),
    errors: count((s) => s.status === 'error'),
    missing: count((s) => s.status === 'missing'),
    handlingSuccesses: count((s) => s.workflowHandlingSuccess),
    selectorEligible: eligible.length,
    selectorSuccesses: eligible.filter((s) => s.selectorSuccess).length,
    categoryProposals: count((s) => s.proposed),
    semanticCorrect: count((s) => s.semanticCategoryCorrect === true),
    preferenceRequired: count((s) => s.preferenceAgreement !== null),
    preferenceMet: count((s) => s.preferenceAgreement === true),
    completeJournalsMeasured: journals.length,
    completeJournalsCorrect: journals.filter((s) => s.completeJournalCorrect).length,
    counterAccountsMeasured: count((s) => s.counterAccountCorrect !== null),
    counterAccountsCorrect: count((s) => s.counterAccountCorrect === true),
    unnecessaryClarifications: count((s) => s.unnecessaryClarification),
    necessaryClarifications: count((s) => s.necessaryClarification),
    unnecessaryHandoffs: count((s) => s.unsupportedInsteadOfAnswer),
    unsafeSuggestions: count((s) => s.unsafeSuggestion),
    harmfulOvergeneralizations: count((s) => s.harmfulOvergeneralization),
    families: categoryFamilies.map((family) => ({
      family,
      planned: count((s) => s.family === family),
      successes: count((s) => s.family === family && s.workflowHandlingSuccess),
    })),
  };
}

export function summarizeCategoryCosts(observations: CategoryObservation[]) {
  let reported = new Decimal(0),
    reserved = new Decimal(0),
    unknown = 0,
    unreserved = 0;
  const paidLatencies: number[] = [];
  for (const observation of observations) {
    if (
      observation.latencyMs !== null &&
      (!Number.isFinite(observation.latencyMs) || observation.latencyMs < 0)
    )
      throw new Error('Invalid latency metadata.');
    if (observation.attempts === 1 && observation.latencyMs !== null)
      paidLatencies.push(observation.latencyMs);
    const cost = observation.reportedCostUsd === null ? null : new Decimal(observation.reportedCostUsd);
    const reserve =
      observation.reservedUnknownUsd === null ? null : new Decimal(observation.reservedUnknownUsd);
    if ((cost && (!cost.isFinite() || cost.lt(0))) || (reserve && (!reserve.isFinite() || reserve.lt(0))))
      throw new Error('Invalid cost metadata.');
    if (cost !== null && reserve?.gt(0)) throw new Error('Reported and unknown-reserved cost overlap.');
    if (cost) reported = reported.plus(cost);
    if (reserve) reserved = reserved.plus(reserve);
    if (observation.attempts === 1 && cost === null) {
      unknown++;
      if (!reserve?.gt(0)) unreserved++;
    }
  }
  paidLatencies.sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    paidLatencies.length ? paidLatencies[Math.max(0, Math.ceil(paidLatencies.length * fraction) - 1)] : null;
  return {
    reportedUsd: reported.toString(),
    reservedUnknownUsd: reserved.toString(),
    trackedUsd: reported.plus(reserved).toString(),
    actualAttempts: observations.reduce((sum, item) => sum + item.attempts, 0),
    unknownCostAttempts: unknown,
    unreservedUnknownAttempts: unreserved,
    paidLatencyObserved: paidLatencies.length,
    paidLatencyMissing: observations.filter((o) => o.attempts === 1 && o.latencyMs === null).length,
    paidLatencyP50Ms: percentile(0.5),
    paidLatencyP95Ms: percentile(0.95),
  };
}

export function categoryLearningPairs(cases: CategoryCase[], scores: CategoryScore[], selector: Selector) {
  return [...new Set(cases.map((item) => item.sequenceId))].map((sequenceId) => {
    const beforeCase = cases.find((item) => item.sequenceId === sequenceId && item.correctionEvents === 0);
    const afterCase = cases.find((item) => item.sequenceId === sequenceId && item.correctionEvents === 3);
    if (!beforeCase || !afterCase) throw new Error('Learning comparison requires both fixed states.');
    const before = scores.find((item) => item.caseId === beforeCase.id && item.selector === selector);
    const after = scores.find((item) => item.caseId === afterCase.id && item.selector === selector);
    if (!before || !after) throw new Error('Score missing from declared matrix.');
    const taughtTarget = categoryReference(afterCase).preferredCategoryCode;
    const adopted = (score: CategoryScore) =>
      score.status === 'ok' && score.inputVerified && score.selectedCategoryCode === taughtTarget;
    return {
      sequenceId,
      handlingGain: Number(after.workflowHandlingSuccess) - Number(before.workflowHandlingSuccess),
      taughtTarget,
      preferenceAdoptionBefore: taughtTarget ? adopted(before) : null,
      preferenceAdoptionAfter: taughtTarget ? adopted(after) : null,
      preferenceAdoptionGain: taughtTarget ? Number(adopted(after)) - Number(adopted(before)) : null,
      // Before teaching, choosing another acceptable category was not an error.
      beforeSemanticCorrect: before.semanticCategoryCorrect,
      afterSemanticCorrect: after.semanticCategoryCorrect,
      harmfulAfterTeaching: after.harmfulOvergeneralization,
    };
  });
}

/** Paired sequence bootstrap: all three correlated states travel together.
 * Input deltas are computed on fixed groups, never individual repeated rows. */
export function pairedSequenceInterval(
  deltas: number[],
  resamples = 2000,
  seed = 20261031,
): [number, number] | null {
  if (deltas.length < 2) return null;
  if (
    deltas.some((d) => !Number.isFinite(d) || Math.abs(d) > 1) ||
    !Number.isInteger(resamples) ||
    resamples < 100
  )
    throw new Error('Invalid paired interval input.');
  let state = seed >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const estimates = Array.from(
    { length: resamples },
    () => deltas.reduce((sum) => sum + deltas[Math.floor(random() * deltas.length)], 0) / deltas.length,
  ).sort((a, b) => a - b);
  return [
    estimates[Math.floor(0.025 * (estimates.length - 1))],
    estimates[Math.floor(0.975 * (estimates.length - 1))],
  ];
}
