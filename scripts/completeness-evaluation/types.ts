/** External question requirements. None of these labels enter a provider request.
 * This module imports types only and never loads a fixture or prior study. */
import type { ModelMessages } from '../../server/ai-provider';
import type { AnalysisAccount } from '../../server/financial-analysis';

export type CompletenessRoute = 'composable' | 'adaptive' | 'complete';
export type EvaluationSplit = 'development' | 'holdout';
export type ExpectedScope = {
  from: string | null;
  to: string | null;
  asOf: string | null;
  status: 'POSTED' | 'DRAFT';
  /** Effective posting codes; a group code is expanded against the supplied chart. */
  accountCodes: string[];
  counterparty: { mode: 'any' | 'exact' | 'contains' | 'identity'; value: string };
  currencyMode: 'base' | 'native';
  currency: string | null;
  cooccurringAccountCodes: string[];
  descriptionSearch: string;
  minimumAmount: string | null;
  maximumAmount: string | null;
  /** Preserve the original per-entry threshold basis when a grouped cell narrows accounts. */
  amountThresholdAccountCodes?: string[];
  entryId?: string;
  averageDenominator?: string;
  /** Legacy find_transactions searches description OR counterparty OR reference. */
  searchText?: string;
};
export type Formula =
  | { claim: string }
  | { assumption: { value: string; unit: string; sourceText: string } }
  | { calendarMonths: { metric: string; scope: ExpectedScope; value: string } }
  | { operation: 'add' | 'subtract' | 'multiply' | 'divide'; operands: [Formula, Formula] };
type ClaimBase = { id: string; value: string; unit: string };
export type ExpectedClaim =
  | (ClaimBase & { kind: 'ledger'; metric: string; scope: ExpectedScope })
  | (ClaimBase & {
      kind: 'calculation';
      formula: Formula;
      source: 'posted' | 'draft' | 'scenario';
      exact?: { numerator: string; denominator: string };
    });
/** Exact requested list/ranking coverage, independent of presentation order unless ranked.
 * Every claim ID refers to the required/supporting catalogue. Alternatives permit
 * independently declared equal-rank choices; they do not authorize arbitrary ties. */
export type ExpectedTable = {
  id: string;
  claimIds: string[];
  alternativeClaimIds?: string[][];
  coverage: 'all' | 'top' | 'leading';
  order: 'any' | 'value_desc' | 'value_asc';
  limit: number | null;
};
export type CompletenessCase = {
  id: string;
  split: EvaluationSplit;
  family: string;
  messages: ModelMessages;
  expected: {
    behavior: 'ANSWER' | 'CLARIFY' | 'REFUSE';
    required: ExpectedClaim[];
    supporting: ExpectedClaim[];
    /** Which independently requested claims may lead the answer. Defaults to all required claims. */
    primaryClaimIds?: string[];
    tables?: ExpectedTable[];
    clarification?: { reasons: string[]; subject?: string; accountCodes?: string[]; limitation?: string };
  };
};
export type LedgerClaim = Extract<ExpectedClaim, { kind: 'ledger' }>;
export type LedgerReferenceResult =
  | { status: 'verified'; value: string; entry?: { date: string; description: string } }
  | { status: 'incorrect'; value: string; reason?: string }
  | { status: 'unsupported'; reason: string };
export type ScoringContext = {
  organizationId: string;
  chart: AnalysisAccount[];
  /** All distinct raw fixture counterparties, including the empty key when present. */
  counterparties: string[];
  /** Independent fixture arithmetic, explicitly injected; never the production compiler. */
  referenceLedgerClaim: (claim: LedgerClaim) => LedgerReferenceResult;
};
export type CompletenessOutcome = {
  response?: unknown;
  error?: { code: string };
  attempts?: unknown[];
};
export type CompletenessScore = {
  caseId: string;
  split: EvaluationSplit;
  family: string;
  classification:
    | 'structured-correct'
    | 'wrong-answer'
    | 'partial-answer'
    | 'safe-no-answer'
    | 'execution-error'
    | 'ungradable';
  passed: boolean;
  reasons: string[];
  requiredClaims: number;
  matchedClaims: string[];
  matchedTables: string[];
  focusCorrect: boolean;
  primaryMatched: string[];
  verifiedExtraClaims: number;
  unverifiableExtraClaims: number;
  wrongFinancialClaims: string[];
  hardBoundaryViolations: string[];
  modelCompletionIgnored: true;
  wordingReview: 'not_model_judged';
};
