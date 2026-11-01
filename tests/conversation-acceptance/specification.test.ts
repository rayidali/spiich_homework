import { describe, expect, it } from 'vitest';
import { entries } from './book';
import { cases, oracles } from './cases';
import { validateSpecification } from './validate';

describe('new conversation acceptance specification (offline fixture checks only)', () => {
  it('has balanced synthetic books and independently recomputable expected amounts and original user assumptions', () => {
    expect(validateSpecification(cases, oracles)).toEqual([]);
  });

  it('covers conversation quality, facts, assumptions, missing information and boundaries without scripted assistant replies', () => {
    expect(new Set(cases.map((c) => c.family))).toEqual(
      new Set([
        'business_decision',
        'recorded_data',
        'context',
        'ambiguity',
        'scenario',
        'explanation',
        'unavailable_information',
        'boundary',
      ]),
    );
    expect(cases).toHaveLength(31);
    expect(cases.reduce((count, c) => count + c.turns.length, 0)).toBe(35);
    expect(cases.filter((c) => c.turns.length > 1)).toHaveLength(3);
    expect(cases.filter((c) => c.provenance === 'user_reported_regression').map((c) => c.id)).toEqual([
      'C01',
    ]);
    for (const c of cases) for (const turn of c.turns) expect(turn).not.toHaveProperty('assistant');
  });

  it('detects a mistaken expected amount rather than blessing its own reference', () => {
    const changed = structuredClone(oracles);
    changed.find((o) => o.id === 'oct_supplies')!.expectedCents = '700000';
    expect(validateSpecification(cases, changed)).toContain('Wrong expected amount: oct_supplies');
  });

  it('detects a wrong-account oracle even when a query would be valid', () => {
    const changed = structuredClone(oracles);
    const fact = changed.find((o) => o.id === 'oct_supplies')!;
    if (fact.kind !== 'recorded') throw new Error('fixture kind changed');
    fact.accountCodes = ['5020'];
    expect(validateSpecification(cases, changed)).toContain('Wrong expected amount: oct_supplies');
  });

  it('detects inclusion of a previously unposted payroll draft', () => {
    const changed = structuredClone(entries);
    changed.find((entry) => entry.id === 'draft-payroll')!.status = 'POSTED';
    const errors = validateSpecification(cases, oracles, changed);
    expect(errors).toContain('Wrong expected amount: oct_payroll');
    expect(errors).toContain('Wrong expected amount: oct_cash');
    expect(errors).toContain('Wrong expected amount: oct_profit');
  });

  it('detects treating the refund as an additional expense', () => {
    const changed = structuredClone(entries);
    const refund = changed.find((entry) => entry.id === 'sep-refund')!;
    for (const line of refund.lines)
      [line.baseDebitCents, line.baseCreditCents] = [line.baseCreditCents, line.baseDebitCents];
    expect(validateSpecification(cases, oracles, changed)).toContain('Wrong expected amount: sep_supplies');
  });

  it('rejects an unbalanced controlled ledger entry', () => {
    const changed = structuredClone(entries);
    changed[0].lines[0].baseDebitCents = '1';
    expect(validateSpecification(cases, oracles, changed)).toContain('Unbalanced entry: opening');
  });

  it('detects a result with no declared source or a source in the wrong conversation', () => {
    const changed = structuredClone(cases);
    changed[0].turns[0].expected.requiredFacts = ['missing_fact', 'cancellation_saving'];
    const errors = validateSpecification(changed, oracles);
    expect(errors).toContain('Unknown required fact: C01/0/missing_fact');
    expect(errors).toContain('Cross-conversation scenario: C01/0/cancellation_saving');
  });

  it('rejects future-turn leakage into an earlier expected result', () => {
    const changed = structuredClone(cases);
    changed[0].turns[1].expected.requiredFacts = ['staff_saving_corrected'];
    expect(validateSpecification(changed, oracles)).toContain(
      'Future assumption: C01/1/staff_saving_corrected',
    );
  });

  it('rejects a fabricated quote and a quantity that differs from the actual quote', () => {
    const changed = structuredClone(oracles);
    const fact = changed.find((o) => o.id === 'staff_saving')!;
    if (fact.kind !== 'scenario') throw new Error('fixture kind changed');
    fact.sources[0].quote = '$9,999 per month';
    const errors = validateSpecification(cases, changed);
    expect(errors).toContain('Missing user quote: staff_saving/monthlyCents');
    expect(errors).toContain('Wrong quoted quantity: staff_saving/monthlyCents');
  });

  it('rejects duplicate case identities and silent extra schema fields', () => {
    const changed = structuredClone(cases);
    changed[1].id = changed[0].id;
    Object.assign(changed[0], { secretlyAcceptGenericRefusal: true });
    expect(validateSpecification(changed, oracles)).toEqual(
      expect.arrayContaining(['Invalid case schema: C01', 'Duplicate case: C01']),
    );
  });

  it('rejects two requirements sharing a review identity', () => {
    const changed = structuredClone(cases);
    changed[0].turns[0].expected.requires.push(changed[0].turns[0].expected.requires[0]);
    expect(validateSpecification(changed, oracles)).toContain('Duplicate criterion: C01/0');
  });
});
