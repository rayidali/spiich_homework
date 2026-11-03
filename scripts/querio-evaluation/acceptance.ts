import {
  cases as nativeCases,
  clock,
  type Case as NativeCase,
} from '../flexible-analytics-evaluation/specification';

/**
 * Initial development smoke specification, not an executed result or a model
 * prompt. Expected values originate in the independent Python fraction oracle;
 * the model must receive neither these values nor reviewer requirements.
 */
export const acceptanceVersion = 'querio-development-smoke-v1';
export { clock };
export const caseIds = ['F01', 'F02', 'F03', 'F04', 'F09', 'F14', 'F19', 'F20'] as const;
export type CaseId = (typeof caseIds)[number];

export const fixtureContract = {
  source: 'scripts/flexible-analytics-evaluation/fixture.ts',
  oracle: 'scripts/flexible-analytics-evaluation/acceptance-oracles.json',
  oracleMethod: 'Python fractions.Fraction and decimal ROUND_HALF_UP; no application imports',
  workspace: 'primary',
  status: 'POSTED',
  currency: 'USD',
  expenseMeaning: 'Signed sum of expense-line base_debit minus base_credit; refunds reduce expense.',
  rentAccount: '5010',
  marketingAccount: '5030',
  totalExpenseAccounts: ['5010', '5020', '5030'],
  sentinels: [
    'Exclude primary-workspace DRAFT October 2025 rent of $9,999.',
    'Exclude other-workspace POSTED October 2025 rent of $8,888.',
    'F01 through-today scope excludes primary POSTED rent of $500 dated 2026-11-04.',
  ],
} as const;

export const commonEvidenceRequirements = [
  'Bind the run to source commit/hash, fixture hash, datasource, model/config when exposed, and business date.',
  'Retain actual user and assistant messages, generated SQL, parameter bindings, execution status and returned rows.',
  'Use the original selected questions without expected answers or grader hints; retain actual assistant replies in follow-ups.',
  'Prove primary-workspace isolation and POSTED-only scope in executed SQL or a captured enforced view definition.',
  'Prove the expense side uses expense lines once each, with signed base_debit-base_credit and USD amounts.',
  'Retain relevant schema/view definitions so account joins, date bounds and prevention of join fanout can be reviewed.',
  'If the service calculates after SQL, retain that calculation or mark formula evidence unverified; prose alone is not execution proof.',
  'Run under a restricted read-only database role and compare all fixture ledger fingerprints before and after the run.',
  'Check every extra displayed financial claim, not only the values matching expected rows.',
] as const;

type ReviewRequirements = {
  expectedBehavior: ('clarify' | 'answer_recorded')[];
  numericalExplanation: string;
  semanticChecks: string[];
  queryProofChecks: string[];
};

const requirements: Record<CaseId, ReviewRequirements> = {
  F01: {
    expectedBehavior: ['clarify', 'clarify', 'answer_recorded'],
    numericalExplanation:
      'January 50.00%, October 66.67%, November 50.00%; February through September undefined. Eleven calendar months.',
    semanticChecks: [
      'Initially resolve the year and denominator without inventing either.',
      'After “this year”, preserve 2026 and ask only the unresolved denominator/end-date question; do not repeat the year menu.',
      'Final answer contains monthly percentages, not only two tables of the component amounts.',
      'Identify November as partial through November 3; do not describe it as a full-month forecast.',
      'Preserve all actual assistant replies; a poor intermediate clarification fails the conversation even if the final table is right.',
    ],
    queryProofChecks: [
      'Final inclusive dates are 2026-01-01 through 2026-11-03; exclude the November 4 future posting.',
      'Generate all eleven elapsed calendar months; months without source postings still appear.',
      'Each numerator sums Rent (5010); each denominator sums all expense accounts for the same month.',
      'Divide monthly numerator by the matching monthly denominator, with zero denominator represented as undefined.',
    ],
  },
  F02: {
    expectedBehavior: ['answer_recorded'],
    numericalExplanation:
      'Jan–Dec percentages: undefined, 50.00, 25.00, 100.00, 50.00, -100.00, undefined, undefined, 33.33, 40.00, 200.00, 50.00.',
    semanticChecks: [
      'Return every one of the twelve named calendar months with its calculated percentage or an explicit unavailable value.',
      'Keep negative and above-100% results; explain unavailable values without replacing them with zero.',
      'Do not substitute the annual percentage, component amounts, or only active months.',
    ],
    queryProofChecks: [
      'Use 2025-01-01 through 2025-12-31 inclusive and a complete twelve-month calendar scaffold.',
      'Rent (5010) numerator and all-expense denominator share the same exact month identity.',
      'Use signed net expense; do not use cash credits, ABS, positive-only amounts or division by annual expense.',
    ],
  },
  F03: {
    expectedBehavior: ['answer_recorded'],
    numericalExplanation: 'Annual rent $1,200 / annual net expenses $2,050 = 58.54% (ratio 24/41).',
    semanticChecks: [
      'Return one yearly share, labeled rent as a share of all 2025 net expenses.',
      'Do not average monthly percentages or describe 58.54% as the mean month.',
    ],
    queryProofChecks: [
      'Sum 2025 Rent (5010) and all 2025 expense lines separately, then divide the totals.',
      'The denominator retains all expense accounts and signed refunds; no counterparty restriction applies.',
    ],
  },
  F04: {
    expectedBehavior: ['answer_recorded'],
    numericalExplanation:
      'Mean of nine defined monthly ratios = 49.81% (ratio 269/540); include June -100% and November 200%.',
    semanticChecks: [
      'Return both the arithmetic mean and the count of nine contributing months.',
      'Distinguish equally weighted monthly ratios from the annual weighted share of 58.54%.',
      'Exclude only zero denominators; negative denominators remain eligible.',
    ],
    queryProofChecks: [
      'Build 2025 monthly Rent and net-expense totals, divide per month, then average defined ratios.',
      'Nine monthly denominators are nonzero; January, July and August are excluded from the mean.',
      'Do not round individual ratios before computing their mean, or calculate AVG over journal lines.',
    ],
  },
  F09: {
    expectedBehavior: ['answer_recorded'],
    numericalExplanation:
      'Sorted monthly totals are -100, 0, 0, 0, 50, 100, 200, 200, 300, 400, 400, 500; median = $150.00.',
    semanticChecks: [
      'State the median of twelve monthly net-expense totals, including quiet and refund months.',
      'Do not substitute the mean, a discrete lower/upper median, or a median of individual transactions.',
    ],
    queryProofChecks: [
      'Aggregate expense lines into all twelve 2025 calendar months, filling absent months with zero.',
      'Compute the even-sample median as the average of the sixth and seventh sorted totals ($100 and $200).',
      'Equivalent continuous percentile or explicit sorting is acceptable; SQL text need not match a template.',
    ],
  },
  F14: {
    expectedBehavior: ['answer_recorded'],
    numericalExplanation:
      'October Marketing with exactly Alpha is $120 / all October expenses $500 = 24.00%.',
    semanticChecks: [
      'Return 24.00% and preserve the distinction between the filtered numerator and business-wide expense denominator.',
      'A 60% share of Marketing or a 100% share of Alpha expenses answers a different question.',
      'Do not infer supplier legal identity, invoice status or payment method from the counterparty label.',
    ],
    queryProofChecks: [
      'Use October 1–31, 2025 for numerator and denominator.',
      'Numerator intersects Marketing (5030) with counterparty exactly Alpha; use equality, not substring/prefix/fuzzy matching.',
      'Denominator includes all expense accounts and counterparties, including both Alpha and Beta; no numerator filter leaks into it.',
      'Inspect the actual equality predicate: this unchanged fixture has no Alpha-like decoy, so numbers alone cannot prove exact-match semantics.',
    ],
  },
  F19: {
    expectedBehavior: ['answer_recorded'],
    numericalExplanation: 'January rent/expense is 0/0; August is 100/0. Both ratios are undefined.',
    semanticChecks: [
      'Show both January and August as undefined, not 0%, 100% or infinity.',
      'Explain January has no expense activity; August has $100 rent offset by a $100 software refund.',
      'Do not say both months had no transactions; August has activity and a zero net denominator.',
    ],
    queryProofChecks: [
      'Select January and August 2025 and preserve the separate month identities.',
      'January Rent/net expenses resolve to 0/0 despite absent rows; August resolves to 100/0 using signed refund activity.',
      'Guard zero division without dropping either row or coercing an undefined ratio into a number.',
      'Any explanatory amount is supported by the actual account-level rows or an additional captured query.',
    ],
  },
  F20: {
    expectedBehavior: ['answer_recorded'],
    numericalExplanation: 'June $100 / -$100 = -100.00%; November $100 / $50 = 200.00%.',
    semanticChecks: [
      'Return both months and retain their signs; results outside 0–100% are valid for these net denominators.',
      'Explain only what recorded refunds support, without inventing the reason for a refund.',
    ],
    queryProofChecks: [
      'Use June and November 2025 separately; each numerator is Rent (5010) and denominator is all net expenses.',
      'June includes the -$200 software refund; November includes the -$50 software refund.',
      'Do not clamp ratios, take absolute values or discard credit expense lines.',
    ],
  },
};

export type QuerioAcceptanceCase = NativeCase & {
  sourceCaseId: CaseId;
  review: ReviewRequirements;
};

export const acceptanceCases: QuerioAcceptanceCase[] = caseIds.map((id) => {
  const source = nativeCases.find((entry) => entry.id === id);
  if (!source) throw new Error(`Missing unchanged native acceptance case ${id}`);
  if (source.turns.length !== requirements[id].expectedBehavior.length)
    throw new Error(`Turn count changed for native acceptance case ${id}`);
  return { ...structuredClone(source), sourceCaseId: id, review: structuredClone(requirements[id]) };
});

export const totalTurns = acceptanceCases.reduce((sum, entry) => sum + entry.turns.length, 0);
export const expectedFinalRows = acceptanceCases.reduce(
  (sum, entry) => sum + entry.oracleRows[entry.oracleRows.length - 1].length,
  0,
);

export const scoringContract = {
  numerical:
    'Report each required value/undefined outcome as correct, wrong, missing or unverified. Check extra displayed figures separately. Clarification-only turns are not applicable.',
  numericalDisplay:
    'Canonical money and percentage displays use two decimal places, ROUND_HALF_UP. Equivalent units are accepted only after explicit normalization; an unlabelled 0.5 is not proof of 50%. Exact fractions are retained where available.',
  semantic:
    'Independently review actual transcripts for complete intent, denominator, dates, month coverage, appropriate clarifications, labels and unsupported explanations. Correct nearby numbers alone do not pass.',
  queryProof:
    'Review actual executed SQL/bindings/results plus enforced views and any downstream calculation. Mark absent evidence unverified rather than inferring correct scope from coincidentally matching values.',
  conversationPass:
    'A case passes only when every turn meets its semantic requirements, every required outcome is correct, all displayed financial claims are supported, query scope/formula is verified, and books remain unchanged.',
  reporting:
    'Report numerator and denominator for cases/turns/facts separately, retain every error and original review, and label all results as selected development smoke. Do not pool with other cohorts.',
} as const;
