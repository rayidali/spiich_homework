import { z } from 'zod';
export const accountTypes = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
export const currencyCodes = ['USD', 'EUR', 'GBP', 'CAD', 'JPY'] as const;
export const dateSchema = z.iso
  .date()
  .refine((value) => value >= '0001-01-01', 'Use a year from 0001 through 9999.');
export const moneySchema = z
  .string()
  .regex(/^\d{1,14}(\.\d{1,4})?$/, 'Use a positive decimal amount, without currency symbols');
export const lineSchema = z.object({
  accountId: z.uuid(),
  debit: moneySchema.default('0'),
  credit: moneySchema.default('0'),
  exchangeRate: z
    .string()
    .regex(/^\d{1,6}(\.\d{1,10})?$/)
    .default('1'),
  memo: z.string().max(200).default(''),
});
export const entrySchema = z.object({
  date: dateSchema,
  description: z.string().trim().min(1).max(500),
  counterparty: z.string().trim().max(100).default(''),
  reference: z.string().trim().max(100).default(''),
  lines: z.array(lineSchema).min(2).max(100),
  source: z.enum(['MANUAL', 'AI']).default('MANUAL'),
});
export const accountSchema = z.object({
  code: z.string().regex(/^\d{3,8}$/),
  name: z.string().trim().min(1).max(100),
  type: z.enum(accountTypes),
  currency: z.enum(currencyCodes),
  parentId: z.uuid().nullable().default(null),
  isGroup: z.boolean().default(false),
  isCash: z.boolean().default(false),
});
export const recurringSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  counterparty: z.string().max(100).default(''),
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY']),
  anchorDate: dateSchema,
  endDate: dateSchema.nullable().default(null),
  lines: z.array(lineSchema).min(2).max(100),
});
export type EntryInput = z.infer<typeof entrySchema>;
export type LineInput = z.infer<typeof lineSchema>;
export type AccountInput = z.infer<typeof accountSchema>;
export type RecurringInput = z.infer<typeof recurringSchema>;
export type RecurringTemplate = {
  id: string;
  name: string;
  description: string;
  counterparty: string;
  frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  anchor_date: string;
  next_date: string;
  end_date: string | null;
  active: boolean;
  lines: LineInput[];
  revision: number;
  last_error: string | null;
};
export type Account = {
  id: string;
  code: string;
  name: string;
  type: (typeof accountTypes)[number];
  currency: string;
  parent_id: string | null;
  is_group: boolean;
  is_cash: boolean;
  archived: boolean;
  balance: string;
  native_balance: string;
};
export type JournalLine = {
  id: string;
  account_id: string;
  account_name: string;
  account_code: string;
  currency: string;
  debit: string;
  credit: string;
  exchange_rate: string;
  base_debit: string;
  base_credit: string;
  memo: string;
};
export type Entry = {
  categorizationLearning?: {
    status: 'LEARNED' | 'NO_ACCOUNT_CHANGE' | 'NOT_APPLICABLE' | 'REVOKED' | 'SUPERSEDED';
    memoryId?: string;
  };
  revision: number;
  id: string;
  number: string;
  date: string;
  description: string;
  counterparty: string;
  reference: string;
  status: 'DRAFT' | 'POSTED';
  source: string;
  posted_at: string | null;
  created_at: string;
  total: string;
  reverses_entry_id: string | null;
  reversal_id: string | null;
  lines: JournalLine[];
};
