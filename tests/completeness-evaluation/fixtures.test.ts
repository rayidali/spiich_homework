import { describe, expect, it } from 'vitest';
import {
  assertDisposableFixtureDatabase,
  counterparties,
  fixtureFamilies,
  fixtureFiles,
  fixtureMessages,
  loadCases,
  loadLedger,
  referenceLedgerClaim,
  referenceLedgerValue,
  verifyCaseReferences,
  verifyLedger,
  verifyWorkedTotals,
} from '../../scripts/completeness-evaluation/fixtures';
import type { CompletenessCase, LedgerClaim } from '../../scripts/completeness-evaluation/types';

const ledger = loadLedger();
const development = loadCases('development');
function claim(changes: Partial<LedgerClaim> = {}): LedgerClaim {
  const source = structuredClone(development[2].expected.required[0]) as LedgerClaim;
  return { ...source, ...changes };
}
function scoped(change: Partial<LedgerClaim['scope']>, changes: Partial<LedgerClaim> = {}) {
  const original = claim(changes);
  return { ...original, scope: { ...original.scope, ...change } };
}

describe('Fresh completeness development fixture and independent arithmetic', () => {
  it('loads only four development questions with one per family and no held-out file dependency', () => {
    expect(development).toHaveLength(4);
    expect(new Set(development.map((item) => item.id)).size).toBe(4);
    for (const family of fixtureFamilies)
      expect(development.filter((item) => item.family === family)).toHaveLength(1);
    expect(fixtureFiles).toEqual([
      'scripts/completeness-evaluation/fixtures/ledger.json',
      'scripts/completeness-evaluation/fixtures/development.json',
      'scripts/completeness-evaluation/fixtures/worked-totals.json',
    ]);
    expect(ledger.version).toBe('completeness-fixture-v1');
    expect(ledger.asOf).toBe('2026-09-30');
  });

  it('projects the complete original conversation without external labels or mutation', () => {
    const item = development[0];
    const visible = fixtureMessages(item);
    expect(visible.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(visible[0].content).toContain('July 2026');
    expect(visible[2].content).toContain('August 2026');
    expect(JSON.stringify(visible)).not.toMatch(/165\.00|expected|supporting|development|D01/);
    visible[0].content = 'Changed';
    expect(item.messages[0].content).not.toBe('Changed');
    expect(development[2].expected.required).toHaveLength(8);
  });

  it('independently verifies all 104 lines, 14 development claims and 41 worked invariants', () => {
    expect(verifyLedger(ledger)).toEqual({
      organizations: 2,
      accountsPerOrganization: 24,
      entries: 51,
      lines: 104,
    });
    expect(development.map((item) => verifyCaseReferences(item, ledger))).toEqual([1, 5, 8, 0]);
    expect(verifyWorkedTotals(ledger)).toBe(41);
  });

  it('rejects an unbalanced line and invalid posting-account parent order', () => {
    const unbalanced = structuredClone(ledger);
    unbalanced.entries[0].lines[0].debit = '18001';
    expect(() => verifyLedger(unbalanced)).toThrow('FIXTURE_UNBALANCED_ENTRY');
    const unordered = structuredClone(ledger);
    [unordered.accounts[0], unordered.accounts[1]] = [unordered.accounts[1], unordered.accounts[0]];
    expect(() => verifyLedger(unordered)).toThrow('FIXTURE_ACCOUNT_PARENT_ORDER');
  });

  it('rejects a foreign or changed reversal instead of deleting the original history', () => {
    const foreign = structuredClone(ledger);
    foreign.entries.find((entry) => entry.id === 'SEP-REVERSAL')!.tenant = 'foreign';
    expect(() => verifyLedger(foreign)).toThrow('FIXTURE_REVERSAL_ORIGINAL');
    const changed = structuredClone(ledger);
    const reversal = changed.entries.find((entry) => entry.id === 'SEP-REVERSAL')!;
    reversal.lines[0].debit = '99';
    reversal.lines[1].credit = '99';
    expect(() => verifyLedger(changed)).toThrow('FIXTURE_REVERSAL_LINES');
  });

  it('rejects changed golden values, incorrect units and a changed exact ratio', () => {
    const value = structuredClone(development[2]);
    value.expected.required[0].value = '731.00';
    expect(() => verifyCaseReferences(value, ledger)).toThrow('FIXTURE_WRONG_REFERENCE');
    const unit = structuredClone(development[2]);
    unit.expected.required.at(-1)!.unit = 'USD';
    expect(() => verifyCaseReferences(unit, ledger)).toThrow('FIXTURE_WRONG_UNIT');
    const ratio = structuredClone(development[2]);
    const result = ratio.expected.required.at(-1)!;
    if (result.kind !== 'calculation') throw new Error('Calculation fixture required');
    result.exact = { numerator: '3', denominator: '17' };
    expect(() => verifyCaseReferences(ratio, ledger)).toThrow('FIXTURE_EXACT_FRACTION');
  });

  it('checks formula dependencies independently and refuses cycles', () => {
    const item = structuredClone(development[2]);
    const result = item.expected.required.at(-1)!;
    if (result.kind !== 'calculation') throw new Error('Calculation fixture required');
    result.formula = { claim: result.id };
    expect(() => verifyCaseReferences(item, ledger)).toThrow('FIXTURE_FORMULA_CYCLE');
  });

  it('keeps the conversational vendor filter distinct from all parts expenses', () => {
    const wanted = development[0].expected.required[0] as LedgerClaim;
    expect(referenceLedgerValue(wanted, ledger)).toBe('165.00');
    expect(
      referenceLedgerValue(
        { ...wanted, scope: { ...wanted.scope, counterparty: { mode: 'any', value: '' } } },
        ledger,
      ),
    ).toBe('870.00');
  });

  it('keeps case-sensitive identities and blank counterparties distinct', () => {
    const august = scoped({
      from: '2026-08-01',
      to: '2026-08-31',
      counterparty: { mode: 'identity', value: 'Harbor Repair' },
    });
    expect(referenceLedgerValue(august, ledger)).toBe('260.00');
    expect(
      referenceLedgerValue(
        { ...august, scope: { ...august.scope, counterparty: { mode: 'exact', value: 'Harbor Repair' } } },
        ledger,
      ),
    ).toBe('670.00');
    const blank = scoped({
      from: '2026-09-01',
      to: '2026-09-30',
      accountCodes: ['5040'],
      counterparty: { mode: 'identity', value: '' },
    });
    expect(referenceLedgerValue(blank, ledger)).toBe('30.00');
    expect(
      referenceLedgerValue(
        {
          ...blank,
          scope: { ...blank.scope, counterparty: { mode: 'identity', value: '(No counterparty)' } },
        },
        ledger,
      ),
    ).toBe('45.00');
    expect(counterparties(ledger)).toEqual(
      expect.arrayContaining(['Harbor Repair', 'harbor repair', '', '(No counterparty)']),
    );
  });

  it('counts refunds, excludes drafts and foreign workspaces, and dates reversals separately', () => {
    expect(referenceLedgerValue(claim(), ledger)).toBe('730.00');
    expect(
      referenceLedgerValue(scoped({ from: '2026-08-01', to: '2026-08-31', status: 'DRAFT' }), ledger),
    ).toBe('999.00');
    const alteredForeign = structuredClone(ledger);
    alteredForeign.entries.find((entry) => entry.id === 'FOREIGN-PARTS')!.lines[0].debit = '999999';
    expect(referenceLedgerValue(claim(), alteredForeign)).toBe('730.00');
    expect(
      referenceLedgerValue(scoped({ accountCodes: ['5050'], from: '2026-08-01', to: '2026-08-31' }), ledger),
    ).toBe('100.00');
    expect(
      referenceLedgerValue(scoped({ accountCodes: ['5050'], from: '2026-09-01', to: '2026-09-30' }), ledger),
    ).toBe('-100.00');
  });

  it('distinguishes cash from equipment and receivables even when all are assets', () => {
    const cash = scoped(
      { from: null, to: '2026-09-30', asOf: '2026-09-30', accountCodes: ['1010', '1020', '1030'] },
      { metric: 'cash_balance' },
    );
    expect(referenceLedgerValue(cash, ledger)).toBe('18889.00');
    expect(
      referenceLedgerValue(
        {
          ...cash,
          metric: 'account_balance',
          scope: { ...cash.scope, accountCodes: ['1010', '1020', '1030', '1100', '1200'] },
        },
        ledger,
      ),
    ).toBe('27789.00');
    expect(referenceLedgerValue({ ...cash, scope: { ...cash.scope, accountCodes: ['1030'] } }, ledger)).toBe(
      '70.00',
    );
  });

  it('uses saved rates rather than converting the whole native balance at one rate', () => {
    const euro = scoped(
      {
        from: null,
        to: '2026-09-30',
        asOf: '2026-09-30',
        accountCodes: ['1020'],
        currencyMode: 'native',
        currency: 'EUR',
      },
      { metric: 'cash_balance', unit: 'EUR' },
    );
    expect(referenceLedgerValue(euro, ledger)).toBe('300.00');
    expect(
      referenceLedgerValue(
        { ...euro, unit: 'USD', scope: { ...euro.scope, currencyMode: 'base', currency: null } },
        ledger,
      ),
    ).toBe('369.00');
    const transfer = scoped(
      { accountCodes: ['1010', '1020', '1030'], from: '2026-09-27', to: '2026-09-27' },
      { metric: 'net_cash_movement' },
    );
    expect(referenceLedgerValue(transfer, ledger)).toBe('0.00');
    expect(
      referenceLedgerValue(
        {
          ...transfer,
          scope: { ...transfer.scope, accountCodes: ['1020'], currencyMode: 'native', currency: 'EUR' },
        },
        ledger,
      ),
    ).toBe('50.00');
  });

  it('separates full journal totals and distinct entry counts from selected-line averages', () => {
    expect(referenceLedgerValue(claim({ metric: 'journal_total' }), ledger)).toBe('820.00');
    expect(referenceLedgerValue(claim({ metric: 'journal_count', unit: 'count' }), ledger)).toBe('5');
    expect(
      referenceLedgerValue(
        scoped({ averageDenominator: '5' }, { metric: 'net_expense_average_per_entry' }),
        ledger,
      ),
    ).toBe('146.00');
    expect(() =>
      referenceLedgerValue(
        scoped({ averageDenominator: '4' }, { metric: 'net_expense_average_per_entry' }),
        ledger,
      ),
    ).toThrow('FIXTURE_ORACLE_AVERAGE_DENOMINATOR');
  });

  it('applies thresholds to the original entry scope before narrowing an account row', () => {
    const selected = scoped({ minimumAmount: '100', amountThresholdAccountCodes: ['5030', '5040'] });
    expect(referenceLedgerValue(selected, ledger)).toBe('665.00');
    expect(
      referenceLedgerValue(
        { ...selected, scope: { ...selected.scope, amountThresholdAccountCodes: ['5030'] } },
        ledger,
      ),
    ).toBe('605.00');
    expect(referenceLedgerValue(scoped({ cooccurringAccountCodes: ['1010'] }), ledger)).toBe('550.00');
  });

  it('keeps literal description searches and full-entry IDs explicit', () => {
    expect(referenceLedgerValue(scoped({ descriptionSearch: 'split' }), ledger)).toBe('60.00');
    expect(referenceLedgerValue(scoped({ descriptionSearch: 'Wheelhouse' }), ledger)).toBe('0.00');
    expect(referenceLedgerValue(scoped({ searchText: 'Wheelhouse' }), ledger)).toBe('400.00');
    expect(referenceLedgerValue(scoped({ entryId: 'db-id' }), ledger, { 'db-id': 'JUL-SPLIT' })).toBe(
      '60.00',
    );
    expect(() => referenceLedgerValue(scoped({ entryId: 'unknown-id' }), ledger)).toThrow(
      'FIXTURE_ORACLE_ENTRY',
    );
  });

  it('distinguishes incorrect amounts or units from unsupported oracle scope', () => {
    expect(referenceLedgerClaim(claim(), ledger)).toEqual({ status: 'verified', value: '730.00' });
    expect(referenceLedgerClaim(claim({ value: '731.00' }), ledger)).toMatchObject({
      status: 'incorrect',
      value: '730.00',
    });
    expect(referenceLedgerClaim(claim({ unit: 'EUR' }), ledger)).toMatchObject({ status: 'incorrect' });
    expect(referenceLedgerClaim(claim({ metric: 'unknown_metric' }), ledger)).toMatchObject({
      status: 'unsupported',
    });
    expect(referenceLedgerClaim(scoped({ accountCodes: ['5000'] }), ledger)).toMatchObject({
      status: 'unsupported',
    });
    expect(
      referenceLedgerClaim(
        scoped(
          { counterparty: { mode: 'identity', value: 'No such person' } },
          { metric: 'net_expense_average_per_entry', value: '0.00' },
        ),
        ledger,
      ),
    ).toMatchObject({ status: 'unsupported', reason: 'FIXTURE_ORACLE_NULL_AVERAGE' });
  });

  it('does not mutate the external requirements or explicit fixture during checking', () => {
    const before = structuredClone({ ledger, development });
    development.forEach((item) => verifyCaseReferences(item, ledger));
    verifyWorkedTotals(ledger);
    expect({ ledger, development }).toEqual(before);
    expect(development[3].expected).toMatchObject({ behavior: 'CLARIFY', required: [], supporting: [] });
  });

  it('verifies quoted numerical assumptions and dimensions independently', () => {
    const scenario: CompletenessCase = {
      id: 'unit-test',
      split: 'development',
      family: 'arithmetic',
      messages: [{ role: 'user', content: 'Assume $40 per month for 3 months.' }],
      expected: {
        behavior: 'ANSWER',
        supporting: [],
        required: [
          {
            id: 'total',
            kind: 'calculation',
            value: '120.00',
            unit: 'USD',
            source: 'scenario',
            formula: {
              operation: 'multiply',
              operands: [
                { assumption: { value: '40', unit: 'USD_per_month', sourceText: '$40 per month' } },
                { assumption: { value: '3', unit: 'months', sourceText: '3 months' } },
              ],
            },
          },
        ],
      },
    };
    expect(verifyCaseReferences(scenario, ledger)).toBe(1);
    const bad = structuredClone(scenario);
    bad.messages[0].content = 'Assume $400 per month for 3 months.';
    expect(() => verifyCaseReferences(bad, ledger)).toThrow('FIXTURE_ASSUMPTION_QUOTE');
  });
});

describe('Disposable completeness database admission', () => {
  const options = {
    ownerUrl: 'postgresql://owner:local@127.0.0.1:5432/daybook_completeness_eval_v1',
    runtimeUrl: 'postgresql://app:local@127.0.0.1:5432/daybook_completeness_eval_v1',
    confirmation: 'CREATE_ISOLATED_COMPLETENESS_FIXTURE' as const,
  };
  it('accepts only explicit matching isolated database targets with a distinct runtime role', () => {
    expect(assertDisposableFixtureDatabase(options)).toEqual({
      databaseName: 'daybook_completeness_eval_v1',
    });
  });
  it.each([
    { ownerUrl: 'postgresql://owner:local@db.example.com/daybook_completeness_eval_v1' },
    { runtimeUrl: 'postgresql://app:local@127.0.0.1:5432/spiich' },
    { runtimeUrl: options.ownerUrl },
    { ownerUrl: `${options.ownerUrl}?sslmode=require` },
    { runtimeUrl: options.runtimeUrl.replace('5432', '5433') },
    { confirmation: 'RESET_EXISTING_DATABASE' },
  ])('refuses unsafe target options %j', (change) => {
    expect(() => assertDisposableFixtureDatabase({ ...options, ...change } as typeof options)).toThrow();
  });
});
