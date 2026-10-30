import type { Account } from '../../shared/schema';

export type QuickKind = 'out' | 'in' | 'transfer';

const available = (account: Account) => !account.archived && !account.is_group && account.currency === 'USD';

export function quickEntryOptions(accounts: Account[], kind: QuickKind, paymentId: string) {
  const active = accounts.filter(available);
  return {
    payment: active.filter((account) => account.is_cash || (kind === 'out' && account.type === 'LIABILITY')),
    category: active.filter(
      (account) =>
        account.id !== paymentId &&
        (kind === 'transfer'
          ? account.is_cash
          : !account.is_cash &&
            (kind === 'out'
              ? ['EXPENSE', 'ASSET', 'LIABILITY']
              : ['REVENUE', 'ASSET', 'LIABILITY', 'EQUITY']
            ).includes(account.type)),
    ),
  };
}

export function defaultQuickAccount(accounts: Account[]) {
  const cash = accounts.filter((account) => available(account) && account.is_cash);
  // A familiar code is only a preference within eligible cash accounts.
  return (cash.find((account) => account.code === '1010') ?? cash[0])?.id ?? '';
}

export function reconcileQuickSelection(
  accounts: Account[],
  kind: QuickKind,
  payment: string,
  category: string,
) {
  const options = quickEntryOptions(accounts, kind, payment);
  const nextPayment = options.payment.some((account) => account.id === payment)
    ? payment
    : defaultQuickAccount(accounts);
  const nextCategories = quickEntryOptions(accounts, kind, nextPayment).category;
  return {
    payment: nextPayment,
    category: nextCategories.some((account) => account.id === category) ? category : '',
  };
}

export function validQuickSelection(accounts: Account[], kind: QuickKind, payment: string, category: string) {
  const options = quickEntryOptions(accounts, kind, payment);
  return (
    options.payment.some((account) => account.id === payment) &&
    options.category.some((account) => account.id === category)
  );
}
