import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { accountSelection, entrySnapshot, hasAccountCorrection } from '../server/categorization-memory';
import { pool } from '../server/db';
import type { EntryInput } from '../shared/schema';

afterAll(() => pool.end());
const expense = randomUUID(),
  bank = randomUUID(),
  alternate = randomUUID();
const proposal: EntryInput = {
  date: '2026-03-15',
  description: 'Printer paper',
  counterparty: 'Office shop',
  reference: '',
  source: 'AI',
  lines: [
    { accountId: expense, debit: '100', credit: '0', exchangeRate: '1', memo: '' },
    { accountId: bank, debit: '0', credit: '100', exchangeRate: '1', memo: '' },
  ],
};
describe('Correction meaning and review identity', () => {
  it('does not mistake amount, formatting, line order, memo or same-account split changes for category learning', () => {
    const changed = [
      { ...proposal.lines[1], credit: '120.00', memo: 'receipt' },
      { ...proposal.lines[0], debit: '70.0' },
      { ...proposal.lines[0], debit: '50.0' },
    ];
    expect(hasAccountCorrection(proposal.lines, changed)).toBe(false);
    expect(accountSelection(changed)).toEqual(accountSelection(proposal.lines));
  });
  it('detects a changed account or direction while keeping the same amount', () => {
    expect(
      hasAccountCorrection(proposal.lines, [
        { ...proposal.lines[0], accountId: alternate },
        proposal.lines[1],
      ]),
    ).toBe(true);
    expect(
      hasAccountCorrection(
        proposal.lines,
        proposal.lines.map((line) => ({ ...line, debit: line.credit, credit: line.debit })),
      ),
    ).toBe(true);
  });
  it('binds the actual reviewed amounts, accounts, date and description, allowing harmless decimal/order serialization', () => {
    const equivalent = {
      ...proposal,
      lines: [...proposal.lines].reverse().map((line) => ({
        ...line,
        debit: `${line.debit}.00`,
        credit: `${line.credit}.00`,
        exchangeRate: '1.0',
      })),
    };
    expect(entrySnapshot(equivalent)).toBe(entrySnapshot(proposal));
    for (const modified of [
      { ...proposal, date: '2026-03-16' },
      { ...proposal, description: 'Something else' },
      { ...proposal, lines: [{ ...proposal.lines[0], accountId: alternate }, proposal.lines[1]] },
      { ...proposal, lines: [{ ...proposal.lines[0], debit: '101' }, proposal.lines[1]] },
    ])
      expect(entrySnapshot(modified)).not.toBe(entrySnapshot(proposal));
  });
});
