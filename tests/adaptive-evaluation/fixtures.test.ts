import { describe, expect, it } from 'vitest';
import {
  assertDisposableFixtureDatabase,
  counterparties,
  fixtureFamilies,
  fixtureMessages,
  loadCases,
  loadLedger,
  referenceLedgerValue,
  verifyCaseReferences,
  verifyLedger,
} from '../../scripts/adaptive-evaluation/fixtures';
import type { ExpectedClaim } from '../../scripts/adaptive-evaluation/scoring';

const allCases = [...loadCases('development'), ...loadCases('holdout')];
const ledgerClaim = (caseId: string, claimId: string) => {
  const item = allCases.find((testCase) => testCase.id === caseId)!;
  const result = [...item.expected.required, ...item.expected.supporting].find(
    (claim) => claim.id === claimId,
  )!;
  if (result.kind !== 'ledger') throw new Error('Expected ledger reference.');
  return structuredClone(result);
};

describe('New adaptive comparison fixtures and independent integer reference arithmetic', () => {
  it('has four development and sixteen separate held-out scenarios balanced by family', () => {
    expect(allCases).toHaveLength(20);
    expect(new Set(allCases.map((item) => item.id)).size).toBe(20);
    for (const family of fixtureFamilies) {
      expect(loadCases('development').filter((item) => item.family === family)).toHaveLength(1);
      expect(loadCases('holdout').filter((item) => item.family === family)).toHaveLength(4);
    }
    expect(new Set(allCases.map((item) => JSON.stringify(item.messages))).size).toBe(20);
  });
  it('projects only original messages to provider-visible input, and returns a detached copy', () => {
    const item = allCases.find((testCase) => testCase.id === 'H11')!;
    const payload = fixtureMessages(item);
    expect(payload).toEqual(item.messages);
    expect(JSON.stringify(payload)).not.toContain('9485.50');
    expect(JSON.stringify(payload)).not.toMatch(/expected|supporting|fixture-v1|holdout/);
    payload[0].content = 'modified';
    expect(item.messages[0].content).not.toBe('modified');
  });
  it('checks all entries with exact saved-rate arithmetic and all reference formulas without production SQL', () => {
    expect(verifyLedger()).toEqual({ accountsPerOrganization: 23, organizations: 2, entries: 41, lines: 86 });
    const checks = allCases.map((item) => verifyCaseReferences(item));
    expect(checks.every((count, index) => allCases[index].expected.behavior !== 'ANSWER' || count > 0)).toBe(
      true,
    );
    expect(checks.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(75);
  });
  it('rejects an unbalanced fixture and a changed golden label rather than recomputing it silently', () => {
    const ledger = loadLedger();
    ledger.entries[0].lines[0].debit = '12001';
    expect(() => verifyLedger(ledger)).toThrow('FIXTURE_UNBALANCED_ENTRY');
    const item = structuredClone(allCases.find((testCase) => testCase.id === 'H01')!);
    item.expected.required[0].value = '999.00';
    expect(() => verifyCaseReferences(item)).toThrow('FIXTURE_WRONG_REFERENCE');
  });
  it('keeps raw Acme identity distinct from the wider case-folded name match', () => {
    expect(counterparties()).toEqual(expect.arrayContaining(['Acme', 'acme']));
    const reference = ledgerClaim('H05', 'selected_june');
    expect(referenceLedgerValue(reference)).toBe('122.00');
    reference.scope.counterparty.mode = 'exact';
    expect(referenceLedgerValue(reference)).toBe('737.00');
  });
  it('does not let a revenue change accidentally equal the requested cash receipts change', () => {
    const juneRevenue = ledgerClaim('H08', 'selected_revenue');
    const mayRevenue = structuredClone(juneRevenue);
    mayRevenue.scope.from = '2026-05-01';
    mayRevenue.scope.to = '2026-05-31';
    expect([referenceLedgerValue(mayRevenue), referenceLedgerValue(juneRevenue)]).toEqual([
      '2500.00',
      '3300.00',
    ]);
    expect([
      referenceLedgerValue(ledgerClaim('H08', 'receipt_may')),
      referenceLedgerValue(ledgerClaim('H08', 'receipt_june')),
    ]).toEqual(['900.00', '1600.00']);
  });
  it('counts refunds, split lines, draft exclusion and foreign isolation in independently worked supplies totals', () => {
    expect(referenceLedgerValue(ledgerClaim('H01', 'supplies_may'))).toBe('675.00');
    expect(referenceLedgerValue(ledgerClaim('H09', 'supplies_june'))).toBe('809.50');
    const draft = ledgerClaim('H01', 'supplies_may');
    draft.scope.status = 'DRAFT';
    expect(referenceLedgerValue(draft)).toBe('888.00');
  });
  it('keeps native306EUR distinct from saved375USD and cash distinct from noncash assets', () => {
    const eur = ledgerClaim('H04', 'euro_june');
    expect(referenceLedgerValue(eur)).toBe('306.00');
    eur.scope.currencyMode = 'base';
    eur.scope.currency = null;
    expect(referenceLedgerValue(eur)).toBe('375.00');
    const cash = ledgerClaim('H03', 'cash_june');
    expect(referenceLedgerValue(cash)).toBe('13535.50');
    const assets: Extract<ExpectedClaim, { kind: 'ledger' }> = {
      ...cash,
      metric: 'account_balance',
      scope: { ...cash.scope, accountCodes: ['1010', '1020', '1030', '1100', '1200'] },
    };
    expect(referenceLedgerValue(assets)).toBe('19135.50');
  });
  it('retains original expense and later reversal in their own periods and separates cash from profit', () => {
    expect(referenceLedgerValue(ledgerClaim('D01', 'software_may'))).toBe('210.00');
    expect(referenceLedgerValue(ledgerClaim('H12', 'profit_may'))).toBe('1825.00');
    expect(referenceLedgerValue(ledgerClaim('H12', 'profit_june'))).toBe('1690.50');
    expect(referenceLedgerValue(ledgerClaim('H02', 'cash_movement_may'))).toBe('2135.00');
    const ledger = loadLedger();
    expect(ledger.entries.find((item) => item.id === 'J-REVERSAL')?.reverses).toBe('M-REVERSIBLE');
  });
  it('contains an explicitly hypothetical calculation with real user assumptions and a negative reserve remainder', () => {
    const item = allCases.find((testCase) => testCase.id === 'H11')!;
    expect(item.expected.required.map((claim) => claim.value)).toEqual(['9485.50', '-514.50']);
    expect(
      item.expected.required.every((claim) => claim.kind === 'calculation' && claim.source === 'scenario'),
    ).toBe(true);
    expect(() => verifyCaseReferences(item)).not.toThrow();
    const changed = structuredClone(item);
    changed.messages[0].content = 'No cost assumptions given.';
    expect(() => verifyCaseReferences(changed)).toThrow('FIXTURE_ASSUMPTION_QUOTE');
  });
  it('keeps clarification and refusal cases free of invented numeric answer labels', () => {
    for (const item of allCases.filter((testCase) => testCase.family === 'clarification')) {
      expect(item.expected.required).toEqual([]);
      expect(item.expected.supporting).toEqual([]);
      expect(item.expected.clarification?.reasons.length).toBeGreaterThan(0);
    }
  });
});

const options = {
  ownerUrl: 'postgres://owner:disposable@127.0.0.1:5432/daybook_adaptive_eval_test_local',
  runtimeUrl: 'postgres://runtime:disposable@127.0.0.1:5432/daybook_adaptive_eval_test_local',
  confirmation: 'CREATE_ISOLATED_ADAPTIVE_FIXTURE' as const,
};
describe('Fixture database refusal before any connection', () => {
  it('accepts explicit distinct local roles only in a dedicated named database', () => {
    expect(assertDisposableFixtureDatabase(options)).toEqual({
      databaseName: 'daybook_adaptive_eval_test_local',
    });
  });
  it.each([
    { ...options, ownerUrl: options.ownerUrl.replace('127.0.0.1', 'production.example.com') },
    { ...options, ownerUrl: options.ownerUrl.replace('daybook_adaptive_eval_test_local', 'spiich') },
    { ...options, runtimeUrl: options.runtimeUrl.replace('test_local', 'different') },
    { ...options, runtimeUrl: options.ownerUrl },
    { ...options, ownerUrl: options.ownerUrl + '?sslmode=require' },
    { ...options, confirmation: 'yes' },
  ])('refuses an unsafe or mismatched target without connecting', (input) => {
    expect(() => assertDisposableFixtureDatabase(input as typeof options)).toThrow(/^FIXTURE_/);
  });
});
