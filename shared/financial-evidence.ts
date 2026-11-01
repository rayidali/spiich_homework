/** References are assigned by the application after validated execution.
 * They identify facts; they do not establish that a user's whole question was answered.
 */
export type FinancialFactReference =
  | { kind: 'query_row'; queryId: string; rowId: string }
  | { kind: 'calculation'; calculationId: string }
  | { kind: 'assumption'; assumptionId: string };

export type FinancialFactSource = {
  kind: 'query_result';
  queryId: string;
  truncated: boolean;
};

/** Optional references keep existing report tools and consumers compatible.
 * Missing references are unassessed, not evidence of a completed requirement.
 */
export type InsightEvidence = {
  title: string;
  period: string;
  source?: 'posted' | 'draft' | 'scenario';
  scope?: string;
  factSource?: FinancialFactSource;
  rows: { label: string; value: string; href?: string; factRef?: FinancialFactReference }[];
  href: string;
};
