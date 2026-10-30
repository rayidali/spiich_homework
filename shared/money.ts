import Decimal from 'decimal.js';
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export { Decimal };
export const decimal = (amount: string | number) => new Decimal(amount);
export const money = (amount: Decimal.Value) => new Decimal(amount).toFixed(2);
export const sum = (amounts: Decimal.Value[]) =>
  amounts.reduce<Decimal>((total, amount) => total.plus(amount), new Decimal(0));
export function baseAmount(amount: string, rate: string) {
  return new Decimal(amount).times(rate).toDecimalPlaces(2).toFixed(2);
}

// Formatting never passes a financial value through an IEEE-754 number, even
// when totals exceed Number.MAX_SAFE_INTEGER measured in cents.
export function formatCurrency(amount: Decimal.Value, currency = 'USD', whole = false) {
  const value = new Decimal(amount),
    places = currency === 'JPY' || whole ? 0 : 2;
  const rounded = value.toDecimalPlaces(places),
    [integer, fraction] = rounded.abs().toFixed(places).split('.');
  const symbol = new Intl.NumberFormat('en-US', { style: 'currency', currency })
    .formatToParts(0)
    .find((p) => p.type === 'currency')!.value;
  return `${rounded.isNegative() && !rounded.isZero() ? '-' : ''}${symbol}${BigInt(integer).toLocaleString('en-US')}${places ? '.' + fraction : ''}`;
}
