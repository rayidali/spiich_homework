import { describe, expect, it } from 'vitest';
import type { Account } from '../shared/schema';
import {
  defaultQuickAccount,
  quickEntryOptions,
  reconcileQuickSelection,
  validQuickSelection,
} from '../web/src/quick-entry';

const account = (id: string, changes: Partial<Account> = {}): Account => ({
  id,
  code: id,
  name: id,
  type: 'EXPENSE',
  currency: 'USD',
  parent_id: null,
  is_group: false,
  is_cash: false,
  archived: false,
  balance: '0',
  native_balance: '0',
  ...changes,
});
const bank = account('bank', { code: '1011', type: 'ASSET', is_cash: true });
const savings = account('savings', { type: 'ASSET', is_cash: true });
const expenseAtOldBankCode = account('expense', { code: '1010' });
const receivable = account('receivable', { type: 'ASSET' });
const card = account('card', { type: 'LIABILITY' });
const equity = account('equity', { type: 'EQUITY' });
const revenue = account('revenue', { type: 'REVENUE' });
const chart = [expenseAtOldBankCode, bank, savings, receivable, card, equity, revenue];

describe('short-form account eligibility', () => {
  it('uses account meaning instead of treating code 1010 as a bank', () => {
    expect(defaultQuickAccount(chart)).toBe(bank.id);
    expect(validQuickSelection(chart, 'out', expenseAtOldBankCode.id, receivable.id)).toBe(false);
    expect(quickEntryOptions(chart, 'out', '').payment.map((item) => item.id)).toEqual([
      'bank',
      'savings',
      'card',
    ]);
  });

  it('does not default to archived, grouping or foreign cash accounts', () => {
    const unavailable = [
      account('archived', { code: '1010', type: 'ASSET', is_cash: true, archived: true }),
      account('group', { type: 'ASSET', is_cash: true, is_group: true }),
      account('euro', { type: 'ASSET', is_cash: true, currency: 'EUR' }),
    ];
    expect(defaultQuickAccount(unavailable)).toBe('');
    expect(defaultQuickAccount([...unavailable, bank])).toBe(bank.id);
    for (const item of unavailable) {
      expect(validQuickSelection([...chart, item], 'in', item.id, revenue.id)).toBe(false);
      expect(validQuickSelection([...chart, item], 'transfer', bank.id, item.id)).toBe(false);
    }
  });

  it('supports invoice payments and owner or loan funding without classifying them as revenue', () => {
    for (const category of [receivable, equity, card, revenue]) {
      expect(validQuickSelection(chart, 'in', bank.id, category.id)).toBe(true);
    }
    expect(validQuickSelection(chart, 'in', bank.id, expenseAtOldBankCode.id)).toBe(false);
  });

  it('supports liability repayments and rejects self-transfers or noncash destinations', () => {
    expect(validQuickSelection(chart, 'out', bank.id, card.id)).toBe(true);
    expect(validQuickSelection(chart, 'transfer', bank.id, savings.id)).toBe(true);
    expect(validQuickSelection(chart, 'transfer', bank.id, bank.id)).toBe(false);
    expect(validQuickSelection(chart, 'transfer', bank.id, receivable.id)).toBe(false);
  });

  it('clears incompatible selections when switching from a card expense to money in or transfer', () => {
    expect(reconcileQuickSelection(chart, 'in', card.id, expenseAtOldBankCode.id)).toEqual({
      payment: bank.id,
      category: '',
    });
    expect(reconcileQuickSelection(chart, 'transfer', card.id, receivable.id)).toEqual({
      payment: bank.id,
      category: '',
    });
    expect(reconcileQuickSelection(chart, 'in', bank.id, receivable.id)).toEqual({
      payment: bank.id,
      category: receivable.id,
    });
  });

  it('revalidates categories after archive changes and payment-account changes', () => {
    expect(
      validQuickSelection(
        chart.map((item) => (item.id === card.id ? { ...item, archived: true } : item)),
        'out',
        bank.id,
        card.id,
      ),
    ).toBe(false);
    expect(reconcileQuickSelection(chart, 'transfer', savings.id, savings.id)).toEqual({
      payment: savings.id,
      category: '',
    });
    expect(validQuickSelection(chart, 'out', bank.id, 'missing')).toBe(false);
  });
});
