import { z } from 'zod';
import type { ModelMessages } from '../../server/ai-provider';
export const routeSchema = z.enum(['authored', 'composable']);
export type ChatRoute = z.infer<typeof routeSchema>;
export type Phase = 'setup' | 'development' | 'holdout';
export type EvaluationFact = {
  metric: string;
  value: string;
  unit: string;
  scope: Record<string, unknown>;
};
export type EvaluationCase = {
  id: string;
  split: 'development' | 'holdout';
  family: string;
  messages: ModelMessages;
  expected: {
    behavior: 'answer' | 'clarify' | 'out_of_scope' | 'refuse';
    answerableFromRecordedDataAndExplicitAssumptions: boolean;
    facts: EvaluationFact[];
    requiredScope: Record<string, unknown>;
    clarificationTopics: string[];
    formulas: unknown[];
    notes: string;
  };
  commonCapability: boolean;
};
export type FixtureAccount = {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  type: string;
  currency: string;
  is_cash: boolean;
  is_group: boolean;
  archived: boolean;
  parent_id: string | null;
};
export type Fixture = {
  version: string;
  today: string;
  timezone: string;
  primaryOrganizationId: string;
  foreignOrganizationId: string;
  accounts: FixtureAccount[];
  organizations: { id: string; name: string; base_currency: string; timezone: string }[];
  entries: FixtureEntry[];
};
export type RecordedCall = { name: string; args: Record<string, unknown> };
export type RecordedOutcome = {
  attemptId: string;
  slot: string;
  route: ChatRoute;
  phase: Phase;
  caseId: string;
  sourceHash: string;
  requestHash: string;
  httpStatus: number;
  curlExit: number;
  networkSeconds: number;
  elapsedMs: number;
  responseHash: string | null;
  status: 'valid_plan' | 'transport_error' | 'provider_error' | 'invalid_response';
  errorCode?: string;
  call?: RecordedCall;
  modelVersion?: string;
  usage: TokenUsage | null;
};
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
};

export type FixtureEntry = {
  fixtureKey: string;
  id: string;
  organization_id: string;
  date: string;
  description: string;
  counterparty: string;
  reference: string;
  status: 'POSTED' | 'DRAFT';
  source: string;
  reverses_entry_id: string | null;
  lines: {
    id: string;
    organization_id: string;
    entry_id: string;
    account_id: string;
    account_code: string;
    currency: string;
    position: number;
    debit: string;
    credit: string;
    exchange_rate: string;
    base_debit: string;
    base_credit: string;
    memo: string;
  }[];
};
