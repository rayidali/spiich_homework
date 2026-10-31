import { z } from 'zod';
import { config } from './config';
import { query, transaction } from './db';
import { AppError, failureStage, required } from './errors';
import { diagnostic } from './diagnostics';
import { getCategorizationContext, recordProposal } from './categorization-memory';
import {
  CATEGORY_MODELS,
  prepareCategorySnapshot,
  selectCategory,
  getCategoryFailureMetadata,
  type CategoryAccount,
  type CategoryResult,
  type CategorySelectorOptions,
} from './category-selector';
import { currencyCodes, entrySchema, type EntryInput } from '../shared/schema';

// Only user facts are accepted. Charts, model/provider settings, organization IDs,
// examples and proposed journal lines can never enter through this request.
export const categoryRequestSchema = z.strictObject({
  description: z.string().trim().min(1).max(500),
  counterparty: z.string().trim().max(100).default(''),
  direction: z.enum(['OUT', 'IN']).nullish(),
  amount: z.string().max(40).nullish(),
  date: z.string().max(40).nullish(),
  currency: z.enum(currencyCodes).nullish(),
  exchangeRate: z.string().max(40).nullish(),
  fundingAccountId: z.string().max(100).nullish(),
  purpose: z.enum(['BUSINESS', 'PERSONAL', 'LOAN', 'TRANSFER']).nullish(),
  structure: z.enum(['SINGLE', 'SPLIT', 'COMPLEX']).nullish(),
});
export type CategorySuggestion =
  | Exclude<CategoryResult, { decision: 'SELECT' }>
  | (Extract<CategoryResult, { decision: 'SELECT' }> & { entry: EntryInput; proposalId: string });
export function categoryAvailability() {
  const provider = config.categoryProvider;
  return {
    available: provider === 'reference' || Boolean(config.categoryKey),
    provider,
    model: provider === 'reference' ? 'exact-memory-label-rules-v1' : CATEGORY_MODELS[provider],
  };
}
let inFlight = 0;
/** Test injection is server-only and never populated from request JSON. A future
 * outer budget transport may use the same injection; no provider retry occurs. */
export async function suggestCategory(
  org: string,
  input: unknown,
  selectorOptions?: CategorySelectorOptions,
): Promise<CategorySuggestion> {
  const facts = categoryRequestSchema.parse(input);
  if (inFlight >= 4)
    throw new AppError(429, 'AI_BUSY', 'Category suggestions are busy. Please try again shortly.');
  const configured = categoryAvailability();
  if (!selectorOptions && !configured.available)
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'Category suggestions are not connected. You can choose a category yourself.',
    );
  const options =
    selectorOptions ??
    (config.categoryProvider === 'reference'
      ? { provider: 'reference' as const }
      : {
          provider: config.categoryProvider,
          apiKey: config.categoryKey,
          model: CATEGORY_MODELS[config.categoryProvider],
        });
  inFlight++;
  try {
    const [organization, accounts, memory] = await Promise.all([
      query<{ base_currency: string }>('SELECT base_currency FROM organizations WHERE id=$1', [org]),
      query<CategoryAccount>(
        `SELECT organization_id AS "organizationId",id,code,name,type,currency,archived,is_group,is_cash
        FROM accounts WHERE organization_id=$1 AND NOT archived AND NOT is_group ORDER BY code,id`,
        [org],
      ),
      getCategorizationContext(org, `${facts.description} ${facts.counterparty}`),
    ]);
    const baseCurrency = required(organization[0]).base_currency;
    if (baseCurrency !== 'USD')
      throw new AppError(
        422,
        'INVALID_INPUT',
        'Category suggestions currently require a USD base currency. Use the full entry form.',
      );
    const snapshot = prepareCategorySnapshot(facts, {
      organizationId: org,
      baseCurrency,
      accounts,
      ...memory,
    });
    const selected = await selectCategory(snapshot, options);
    const logResult = () =>
      diagnostic('ai_category_result', {
        operation: 'category',
        provider: selected.metadata.provider,
        model: selected.metadata.requestedModel,
        modelVersion: selected.metadata.returnedModel ?? undefined,
        decision: selected.decision,
        attempts: selected.metadata.attempts,
        durationMs: selected.metadata.durationMs,
      });
    if (selected.decision !== 'SELECT') {
      logResult();
      return selected;
    }
    // Only SELECT can reach here, so the snapshot gates have checked every fixed
    // fact. The server schema and recordProposal repeat full ledger validation.
    const debit = facts.direction === 'OUT' ? selected.accountId : facts.fundingAccountId!;
    const credit = facts.direction === 'OUT' ? facts.fundingAccountId! : selected.accountId;
    const entry = entrySchema.parse({
      date: facts.date,
      description: facts.description,
      counterparty: facts.counterparty,
      reference: '',
      source: 'AI',
      lines: [
        { accountId: debit, debit: facts.amount, credit: '0', exchangeRate: facts.exchangeRate, memo: '' },
        { accountId: credit, debit: '0', credit: facts.amount, exchangeRate: facts.exchangeRate, memo: '' },
      ],
    });
    const proposalId = await transaction(async (db) => {
      const current = await query<CategoryAccount>(
        `SELECT organization_id AS "organizationId",id,code,name,type,currency,archived,is_group,is_cash
        FROM accounts WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE`,
        [org, [debit, credit]],
        db,
      );
      const properties = ['code', 'name', 'type', 'currency', 'archived', 'is_group', 'is_cash'] as const;
      if (
        current.length !== 2 ||
        current.some((account) => {
          const original = accounts.find((item) => item.id === account.id);
          return !original || properties.some((property) => account[property] !== original[property]);
        })
      )
        throw new AppError(
          422,
          'INVALID_ACCOUNT',
          'An account changed while preparing this suggestion. Refresh the accounts and try again.',
        );
      return recordProposal(org, entry, db);
    });
    logResult();
    return { ...selected, entry, proposalId };
  } catch (error) {
    const metadata = getCategoryFailureMetadata(error);
    if (metadata)
      diagnostic('ai_provider_failure', {
        operation: 'category',
        provider: metadata.provider,
        model: metadata.requestedModel,
        code: error instanceof AppError ? error.code : 'AI_PROVIDER_ERROR',
        stage: failureStage(error),
        upstreamStatus: metadata.upstreamStatus,
        durationMs: metadata.durationMs,
        failureClass:
          failureStage(error) === 'provider_http'
            ? 'http'
            : failureStage(error) === 'provider_timeout'
              ? 'timeout'
              : 'provider',
      });
    throw error;
  } finally {
    inFlight--;
  }
}
