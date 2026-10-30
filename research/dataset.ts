/** Synthetic study inputs. Gold labels live in reference.ts and are never provider context. */
import ledger from './fixtures/ledger.json';
import corpus from './fixtures/documents.json';
import tasks from './fixtures/questions.json';

export const datasetVersion = 'daybook-study-v1';
export const primaryOrganizationId = '11111111-1111-4111-8111-111111111111';
export const otherOrganizationId = '22222222-2222-4222-8222-222222222222';
export type TaskFamily = 'financial' | 'analytics' | 'documents' | 'scenario' | 'entry' | 'adversarial';
export type StudySplit = 'development' | 'holdout';
export interface ResearchAccount {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  currency: string;
  isCash: boolean;
}
export interface ResearchLine {
  accountCode: string;
  debit: string;
  credit: string;
  currency: string;
  exchangeRate: string;
  baseDebit: string;
  baseCredit: string;
}
export interface ResearchEntry {
  id: string;
  organizationId: string;
  date: string;
  status: 'POSTED' | 'DRAFT';
  description: string;
  vendor: string;
  reversalOf: string | null;
  lines: ResearchLine[];
}
export interface ResearchDocument {
  id: string;
  organizationId: string;
  title: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  text: string;
  source: string;
}
export interface ResearchQuestion {
  id: string;
  groupId: string;
  split: StudySplit;
  family: TaskFamily;
  question: string;
  organizationId: string;
  asOf: string;
}
export const accounts = ledger.accounts as ResearchAccount[];
export const entries = ledger.entries as ResearchEntry[];
export const documents = corpus as ResearchDocument[];
export const questions = tasks as ResearchQuestion[];

/** Explicit allowlist: adding evaluator metadata cannot silently leak it into a prompt. */
export function providerQuestion(question: ResearchQuestion) {
  return {
    question: question.question,
    organizationId: question.organizationId,
    asOf: question.asOf,
    baseCurrency: 'USD' as const,
  };
}

export function scopedDocuments(organizationId: string) {
  return documents.filter((document) => document.organizationId === organizationId);
}

export function scopedEntries(organizationId: string) {
  return entries.filter((entry) => entry.organizationId === organizationId);
}

/** Shared response vocabulary, safe to expose to every route; never a per-question answer key. */
export const assumptionTags = [
  'PLANNING_ESTIMATE',
  'NO_OTHER_CASH_MOVEMENTS',
  'INCREMENTAL_SCENARIO',
  'TWELVE_MONTHS',
  'NO_TAX',
  'UNSIGNED_QUOTE',
  'ZERO_FUTURE_RECEIPTS',
  'EXPENSES_AS_CASH_PROXY',
  'IGNORES_OTHER_OBLIGATIONS',
  'NO_FORECAST_GUARANTEE',
  'ONE_TIME_RECRUITING',
  'EXCLUDE_DRAFTS',
  'HUMAN_REVIEW_DUPLICATE',
] as const;
export const clarificationTopicTags = [
  'HIRING_COSTS',
  'PLANNING_HORIZON',
  'FX_RATE',
  'PAYMENT_ACCOUNT',
  'CURRENCY',
  'PURPOSE',
  'TAX_CONTEXT',
  'ACCEPTED_CONTRACT',
  'LIVE_MARKET_RATE',
  'FUTURE_CASH_FLOWS',
] as const;
export type AssumptionTag = (typeof assumptionTags)[number];
export type ClarificationTopicTag = (typeof clarificationTopicTags)[number];
