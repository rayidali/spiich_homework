import { z } from 'zod';
import { accountSchema } from '../shared/schema';
import { AppError } from './errors';

/** The model selects missing information; it cannot put invented balances in a clarification. */
export const chatClarificationSchema = z.strictObject({
  reason: z.enum([
    'missing_period',
    'ambiguous_account',
    'unknown_account',
    'missing_assumption',
    'unsupported_query',
    'off_topic',
    'unsupported_action',
  ]),
  subject: z.enum(['expenses', 'revenue', 'profit', 'balances', 'transactions', 'analysis']),
  accountCodes: z.array(accountSchema.shape.code).max(8),
  limitation: z.enum([
    'none',
    'native_currency',
    'month_end_balances',
    'payment_allocation',
    'forecast',
    'causality',
    'unknown_metric',
    'query_too_large',
    'comparison_period',
    'granularity',
  ]),
});
const clarificationParameters = z.toJSONSchema(chatClarificationSchema);
delete clarificationParameters.$schema;
export const chatClarificationTool = {
  type: 'function' as const,
  name: 'request_details',
  description:
    'Ask for missing information or explain an unsupported or unrelated question. Select a reason; application code writes the response. No invented facts or financial answers.',
  strict: true as const,
  parameters: clarificationParameters as Record<string, unknown>,
};
export function clarificationAnswer(args: unknown, chart: { code: string; name: string }[]) {
  const p = chatClarificationSchema.parse(args);
  const selected = p.accountCodes.map((code) => {
    const account = chart.find((a) => a.code === code);
    if (!account)
      throw new AppError(
        422,
        'INVALID_ACCOUNT',
        'The requested account is not in this workspace. Choose an account from Settings.',
      );
    return account;
  });
  const scope = selected.length
    ? selected.map((a) => `${a.name} (${a.code})`).join(', ')
    : p.subject === 'analysis'
      ? 'this analysis'
      : p.subject;
  switch (p.reason) {
    case 'off_topic':
      return 'I can help with your recorded business finances and clearly labeled financial scenarios. Ask about spending, revenue, balances or transactions.';
    case 'unsupported_action':
      return 'Financial chat cannot reveal credentials or change your books. To record or correct an entry, use Transactions and review the change; posted entries are corrected by reversals.';
    case 'missing_period':
      return `Which period should I use for ${scope}—this month, this year, or specific start and end dates?`;
    case 'ambiguous_account':
      return `Which account do you mean${selected.length ? `: ${scope}` : ''}? Please use its account code, name or currency so I can keep the correct scope.`;
    case 'unknown_account':
      return 'I could not identify the requested account in your chart. Please give its account name or code from Settings; I will not substitute all accounts.';
    case 'missing_assumption':
      return 'To calculate that scenario, please provide the proposed cost, time period, expected receipts and minimum cash reserve. The books describe recorded activity; they do not establish those future assumptions.';
    case 'unsupported_query': {
      const explanations: Record<z.infer<typeof chatClarificationSchema>['limitation'], string> = {
        none: 'I cannot express every part of that request with the current financial queries. Please narrow it to a recorded metric, accounts and date range.',
        native_currency:
          'Native amounts need one explicit account currency. Which currency should I use? I can also show stored USD values, but the books do not supply a current market exchange rate.',
        month_end_balances:
          'Which accounts and date range should I use for the closing-balance series? A closing balance includes earlier history; it is different from the activity within that month.',
        payment_allocation:
          'A journal can contain several expense and payment lines without saying which payment funded each item. I can show entries containing those accounts, but cannot infer that allocation. Would those entries help?',
        forecast:
          'Recorded transactions do not establish future income or commitments. Please supply the future amounts and period for a clearly labeled scenario.',
        causality:
          'The books can show amounts and changes, but do not prove why they happened. Would a breakdown by account, counterparty or month help investigate?',
        unknown_metric:
          'That business fact is not represented by the available ledger fields. I can analyze recorded accounts, amounts, dates, descriptions and counterparties.',
        query_too_large:
          'This analysis exceeds the bounded query or result limit. Please narrow the date range or split it into a few comparisons.',
        comparison_period: `Which two periods should I compare for ${scope}?`,
        granularity:
          'Should that average be per transaction or per calendar month? Those calculations answer different questions.',
      };
      return explanations[p.limitation];
    }
  }
}
