import { query, type Db } from './db';
import { AppError } from './errors';
import { Decimal, baseAmount, sum } from '../shared/money';
import type { Account, LineInput } from '../shared/schema';

export async function validateLines(org: string, lines: LineInput[], db?: Db, allowArchived = false) {
  const accountRows = await query<Account>(
    'SELECT * FROM accounts WHERE organization_id=$1 AND id=ANY($2::uuid[])',
    [org, lines.map((l) => l.accountId)],
    db,
  );
  const byId = new Map(accountRows.map((a) => [a.id, a]));
  return lines.map((line, i) => {
    const a = byId.get(line.accountId);
    if (!a || a.is_group || (a.archived && !allowArchived))
      throw new AppError(422, 'INVALID_ACCOUNT', `Line ${i + 1}: choose an active posting account`);
    const debit = new Decimal(line.debit),
      credit = new Decimal(line.credit),
      rate = new Decimal(line.exchangeRate);
    if (!((debit.gt(0) && credit.eq(0)) || (credit.gt(0) && debit.eq(0))))
      throw new AppError(
        422,
        'INVALID_AMOUNT',
        `Line ${i + 1}: enter either a positive debit or a positive credit`,
      );
    if (debit.gte('100000000000000') || credit.gte('100000000000000') || rate.lte(0) || rate.gte(1000000))
      throw new AppError(422, 'INVALID_AMOUNT', 'Amount or exchange rate is outside the supported range');
    const places = a.currency === 'JPY' ? 0 : 2;
    if (debit.decimalPlaces() > places || credit.decimalPlaces() > places)
      throw new AppError(
        422,
        'CURRENCY_PRECISION',
        `${a.currency} amounts require at most ${places} decimal places`,
      );
    if (a.currency === 'USD' && !rate.eq(1))
      throw new AppError(422, 'INVALID_EXCHANGE_RATE', 'USD accounts must use an exchange rate of 1');
    const baseDebit = baseAmount(line.debit, line.exchangeRate),
      baseCredit = baseAmount(line.credit, line.exchangeRate);
    if (new Decimal(baseDebit).plus(baseCredit).eq(0))
      throw new AppError(422, 'AMOUNT_TOO_SMALL', 'A line must have a nonzero base-currency value');
    return { ...line, currency: a.currency, baseDebit, baseCredit };
  });
}
export function assertBalanced(lines: { baseDebit: string; baseCredit: string }[]) {
  const debits = sum(lines.map((l) => l.baseDebit)),
    credits = sum(lines.map((l) => l.baseCredit));
  if (!debits.eq(credits))
    throw new AppError(
      422,
      'UNBALANCED_ENTRY',
      `Debits are $${debits.toFixed(2)} and credits are $${credits.toFixed(2)}. Difference: $${debits.minus(credits).abs().toFixed(2)}.`,
      { debits: debits.toFixed(2), credits: credits.toFixed(2) },
    );
}
