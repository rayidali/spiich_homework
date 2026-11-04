import { describe, expect, it } from 'vitest';
import { assertFinancialLiteralSupport, financialLiterals } from '../server/analyst-claims';
import type { AnalystSqlResult } from '../server/analyst-sql';

const result = (values: string[], kind: 'decimal' | 'integer' | 'text' = 'decimal', name = 'amount') =>
  ({
    columns: [{ name, kind, oid: 1700 }],
    rows: values.map((value) => [value]),
  }) as AnalystSqlResult;

describe('financial literal support, separate from semantic correctness', () => {
  it('rejects an invented monetary aside even when the requested calculation is supported', () => {
    expect(() =>
      assertFinancialLiteralSupport(
        ['Rent is $1,000.00. Another draft is $45.00.'],
        [result(['1000', '60'])],
      ),
    ).toThrow('no numeric support');
  });
  it('requires SQL scalar support for correct arithmetic instead of silently summing rows', () => {
    expect(() => assertFinancialLiteralSupport(['Total $3,000.00'], [result(['1000', '2000'])])).toThrow(
      'no numeric support',
    );
    expect(() => assertFinancialLiteralSupport(['Total $3,000.00'], [result(['3000'])])).not.toThrow();
  });
  it('allows exact display rounding without IEEE floating-point loss', () => {
    expect(() =>
      assertFinancialLiteralSupport(
        ['$9,007,199,254,740,993.23; 53.02%; EUR 1,800.00'],
        [result(['9007199254740993.23', '53.024999', '1800'])],
      ),
    ).not.toThrow();
    expect(() => assertFinancialLiteralSupport(['53.03%'], [result(['53.024999'])])).toThrow();
  });
  it('supports negative values and usual currency placements and magnitude notation', () => {
    expect(() =>
      assertFinancialLiteralSupport(
        ['-$25.00, €60, 60 USD, GBP 60, 60 dollars, $1.2k'],
        [result(['-25', '60', '1200'])],
      ),
    ).not.toThrow();
    expect(() => assertFinancialLiteralSupport(['-$25.00'], [result(['25'])])).toThrow();
  });
  it('does not treat dates, identifiers, text amounts or row counts as financial evidence', () => {
    const misleading = [
      result(['45'], 'integer', 'entry_number'),
      result(['45'], 'integer', 'transaction_count'),
      result(['45'], 'text'),
    ];
    expect(() => assertFinancialLiteralSupport(['$45'], misleading)).toThrow();
    expect(financialLiterals('Entry 45 on 2026-11-03; YTD 2026; 14 rows.')).toEqual([]);
    expect(financialLiterals('**Cash:** 23,427.65 USD\n- **1020:** Euro bank')).toHaveLength(1);
    expect(financialLiterals('Currency: USD\n 1020 account')).toEqual([]);
  });
  it('does not multiply ratios by 100 or erase NULL to fabricate support', () => {
    expect(() => assertFinancialLiteralSupport(['3%'], [result(['0.03'])])).toThrow();
    expect(() => assertFinancialLiteralSupport(['0%'], [{ ...result([]), rows: [[null]] }])).toThrow();
  });
  it('allows explicitly supplied financial assumptions without making them verified book facts', () => {
    expect(() =>
      assertFinancialLiteralSupport(
        ['Using your $4,500 salary and 20% employer costs.'],
        [],
        ['Model $4,500 plus 20% employer costs.'],
      ),
    ).not.toThrow();
    expect(() => assertFinancialLiteralSupport(['20%'], [], ['My price is $20.'])).toThrow();
    expect(() =>
      assertFinancialLiteralSupport(['$45'], [], ['The assistant earlier said $45.']),
    ).not.toThrow();
  });
  it('supports prose percentages but deliberately does not certify matching values attribution', () => {
    expect(() => assertFinancialLiteralSupport(['A share of 3 percent'], [result(['3'])])).not.toThrow();
    // This gate cannot distinguish vendors, dates or currencies sharing a value.
    expect(() => assertFinancialLiteralSupport(['Wrong vendor $60'], [result(['60'])])).not.toThrow();
  });
  it('allows ordinary clarifications and bounds extreme numeric data', () => {
    expect(() => assertFinancialLiteralSupport(['What monthly salary should I use?'], [])).not.toThrow();
    expect(() => assertFinancialLiteralSupport(['$45'], [result(['1e999999', 'NaN', 'Infinity'])])).toThrow(
      'no numeric support',
    );
  });
  it('parses a complete exponent/magnitude rather than accepting a matching prefix', () => {
    for (const text of ['$1K', '$1e3', 'USD 1E3', '$1.0M']) {
      expect(() => assertFinancialLiteralSupport([text], [result(['1'])])).toThrow();
    }
    expect(() =>
      assertFinancialLiteralSupport(['$1K; $1e3; USD 1E3; $1.0M'], [result(['1000', '1000000'])]),
    ).not.toThrow();
    for (const text of ['$1e999999', '$1.0000000000000', '$' + '1'.repeat(101)])
      expect(() => assertFinancialLiteralSupport([text], [])).toThrow('precision or magnitude');
    expect(() => assertFinancialLiteralSupport(['USD45.00'], [result(['1'])])).toThrow();
    expect(() => assertFinancialLiteralSupport(['USD45.00'], [result(['45'])])).not.toThrow();
  });
});
