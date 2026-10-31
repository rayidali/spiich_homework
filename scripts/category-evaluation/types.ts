import type { EntryInput, LineInput } from '../../shared/schema';

export const CATEGORY_EVALUATION_VERSION = 'daybook-category-learning-v2';
// Adapter revision does not reorder the original declared case/provider plan.
export const CATEGORY_ORDER_SEED = 'daybook-category-learning-v1';
export const correctionStates = [0, 1, 3] as const;
export const categoryFamilies = [
  'repeat_vendor',
  'unseen_merchant',
  'changed_purpose',
  'transaction_meaning',
  'missing_facts',
  'evidence_quality',
] as const;
export type CorrectionState = (typeof correctionStates)[number];
export type CategoryFamily = (typeof categoryFamilies)[number];
export type Split = 'development' | 'holdout';
export type Selector = 'reference' | 'gemini' | 'jev';
export type Topic =
  | 'direction'
  | 'amount'
  | 'date'
  | 'currency'
  | 'exchange_rate'
  | 'funding_account'
  | 'purpose'
  | 'structure'
  | 'category';

// Structural mirrors of the selector branch's public DTO. The integration test
// must typecheck these against CategoryFacts/TrustedCategoryContext after merge.
export type EvaluationFacts = {
  description: string;
  counterparty: string;
  direction?: 'OUT' | 'IN' | null;
  amount?: string | null;
  date?: string | null;
  currency?: 'USD' | 'EUR' | 'GBP' | 'CAD' | 'JPY' | null;
  exchangeRate?: string | null;
  fundingAccountId?: string | null;
  purpose?: 'BUSINESS' | 'PERSONAL' | 'LOAN' | 'TRANSFER' | null;
  structure?: 'SINGLE' | 'SPLIT' | 'COMPLEX' | null;
};
export type EvaluationAccount = {
  organizationId: string;
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  currency: NonNullable<EvaluationFacts['currency']>;
  archived: boolean;
  is_group: boolean;
  is_cash: boolean;
};
export type PriorCorrection = {
  id: string;
  entryId: string;
  organizationId: string;
  postedAt: string;
  description: string;
  counterparty: string;
  corrected_lines: LineInput[];
  status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';
  reversed: boolean;
};
export type PriorHistory = {
  id: string;
  organizationId: string;
  postedAt: string;
  description: string;
  counterparty: string;
  lines: LineInput[];
  reversed: boolean;
};
export type VisibleCategoryInput = {
  facts: EvaluationFacts;
  context: {
    organizationId: string;
    baseCurrency: 'USD';
    accounts: EvaluationAccount[];
    corrections: Pick<
      PriorCorrection,
      'id' | 'entryId' | 'description' | 'counterparty' | 'corrected_lines'
    >[];
    history: Pick<PriorHistory, 'id' | 'description' | 'counterparty' | 'lines'>[];
  };
};
export type CategorySequence = {
  id: string;
  family: CategoryFamily;
  split: Split;
  facts: EvaluationFacts;
  priorCorrections: [PriorCorrection, PriorCorrection, PriorCorrection];
  fixedHistory: PriorHistory[];
  excludedNoise: PriorCorrection[];
  supersedeSameContext?: boolean;
};
export type CategoryCase = {
  id: string;
  sequenceId: string;
  family: CategoryFamily;
  split: Split;
  correctionEvents: CorrectionState;
  eligibleCorrectionCount: number;
  input: VisibleCategoryInput;
  inputHash: string;
  excludedEvidenceIds: string[]; // Audit metadata: never pass this wrapper to a model.
};
export type CategoryReference = {
  decision: 'SELECT' | 'CLARIFY' | 'UNSUPPORTED';
  selectorEligible: boolean;
  acceptableCategoryCodes: string[];
  preferredCategoryCode: string | null;
  acceptableFirstTopics: Topic[];
  acceptableUnsupportedReasons: string[];
  explanation: string;
  testsOvergeneralization: boolean;
};
export type SelectorOutcome =
  | { decision: 'SELECT'; accountId: string }
  | { decision: 'CLARIFY'; topic: Topic; question: string }
  | { decision: 'UNSUPPORTED'; reason: string; message: string };
export type CategoryObservation = {
  caseId: string;
  selector: Selector;
  inputHash: string;
  status: 'ok' | 'error';
  result: SelectorOutcome | null;
  errorCode?: string;
  attempts: 0 | 1;
  latencyMs: number | null;
  reportedCostUsd: string | null;
  reservedUnknownUsd: string | null;
  // Supplied only by a real deterministic builder/validation path. The scorer
  // never manufactures a journal from the selector's account choice.
  workflow?: { entry: EntryInput | null; posted: boolean };
};
