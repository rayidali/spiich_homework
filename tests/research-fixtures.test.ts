import { describe, expect, it } from 'vitest';
import {
  accounts,
  assumptionTags,
  clarificationTopicTags,
  documents,
  entries,
  primaryOrganizationId,
  providerQuestion,
  questions,
  scopedDocuments,
  scopedEntries,
} from '../research/dataset';
import {
  getReference,
  providerReviewCase,
  referenceBalance,
  referenceCash,
  referenceTotal,
  reviewCases,
  securityCases,
} from '../research/reference';

// A second arithmetic representation: fixture monetary values are converted to exact integer cents.
const cents = (value: string) => {
  if (!/^\d+\.\d{2}$/.test(value)) throw new Error(`Invalid nonnegative money ${value}`);
  return BigInt(value.replace('.', ''));
};
const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);
const signed = (debit: string, credit: string) => cents(debit) - cents(credit);

describe('frozen synthetic research inputs', () => {
  it('has 120 unique questions in 60 indivisible paraphrase groups and six balanced families', () => {
    expect(questions).toHaveLength(120);
    expect(new Set(questions.map((q) => q.id)).size).toBe(120);
    const groups = new Map<string, typeof questions>();
    for (const question of questions)
      groups.set(question.groupId, [...(groups.get(question.groupId) ?? []), question]);
    expect(groups.size).toBe(60);
    for (const group of groups.values()) {
      expect(group).toHaveLength(2);
      expect(new Set(group.map((q) => q.split)).size).toBe(1);
      expect(group[0].question).not.toBe(group[1].question);
    }
    for (const family of new Set(questions.map((q) => q.family))) {
      expect(questions.filter((q) => q.family === family)).toHaveLength(20);
      expect(questions.filter((q) => q.family === family && q.split === 'development')).toHaveLength(10);
      expect(questions.filter((q) => q.family === family && q.split === 'holdout')).toHaveLength(10);
    }
  });
  it('does not expose reference labels or split/group identifiers to providers', () => {
    for (const question of questions) {
      const enriched = {
        ...question,
        expectedAnswer: 'SECRET GOLD',
        facts: ['SECRET GOLD'],
        split: 'development' as const,
      };
      const prompt = providerQuestion(enriched);
      expect(Object.keys(prompt).sort()).toEqual(['asOf', 'baseCurrency', 'organizationId', 'question']);
      expect(JSON.stringify(prompt)).not.toContain('SECRET GOLD');
      expect(JSON.stringify(prompt)).not.toContain(question.groupId);
    }
  });
  it('contains a scoped corpus with conflicting versions, future drafts and hostile content', () => {
    expect(documents).toHaveLength(40);
    expect(new Set(documents.map((d) => d.id)).size).toBe(40);
    expect(scopedDocuments(primaryOrganizationId)).toHaveLength(39);
    expect(scopedDocuments(primaryOrganizationId).some((d) => d.text.includes('ALBATROSS-641'))).toBe(false);
    expect(documents.find((d) => d.id === 'lease-v1')?.effectiveTo).toBe('2026-09-30');
    expect(documents.find((d) => d.id === 'lease-v2')?.effectiveFrom).toBe('2026-10-01');
    expect(documents.find((d) => d.id === 'future-lease')?.effectiveFrom).toBe('2027-01-01');
    expect(documents.find((d) => d.id === 'malicious-invoice')?.text).toContain('UNTRUSTED');
    expect(documents.filter((d) => d.id.startsWith('renewal-quote-'))).toHaveLength(2);
  });
  it('keeps foreign-workspace records outside every public scoped ledger result', () => {
    const scoped = scopedEntries(primaryOrganizationId);
    expect(scoped).toHaveLength(59);
    expect(scoped.some((e) => e.id === 'foreign-org-cash')).toBe(false);
    expect(new Set(scoped.map((e) => e.organizationId))).toEqual(new Set([primaryOrganizationId]));
  });
});

describe('independent ledger and scenario oracle', () => {
  it('balances every journal in exact base cents and references compatible accounts', () => {
    expect(entries).toHaveLength(60);
    for (const entry of entries) {
      expect(entry.lines.length).toBeGreaterThanOrEqual(2);
      expect(sum(entry.lines.map((l) => signed(l.baseDebit, l.baseCredit)))).toBe(0n);
      for (const line of entry.lines) {
        const account = accounts.find((a) => a.code === line.accountCode);
        expect(account).toBeDefined();
        expect(account?.currency).toBe(line.currency);
        expect(cents(line.debit) > 0n !== cents(line.credit) > 0n).toBe(true);
      }
    }
  });
  it('preserves posted history and makes the flight reversal exactly cancel its original', () => {
    const original = entries.find((e) => e.id === 'travel-sep-error')!;
    const reversal = entries.find((e) => e.reversalOf === original.id)!;
    expect(original.status).toBe('POSTED');
    expect(reversal.status).toBe('POSTED');
    for (const line of original.lines) {
      const inverse = reversal.lines.find((l) => l.accountCode === line.accountCode)!;
      expect(line.debit).toBe(inverse.credit);
      expect(line.credit).toBe(inverse.debit);
      expect(line.exchangeRate).toBe(inverse.exchangeRate);
    }
    expect(referenceTotal('EXPENSE', '2026-09-01', '2026-09-30', { accountCode: '5040' })).toBe('210.00');
  });
  it('independently verifies cash across cutoffs using integer cents, excluding drafts and other tenants', () => {
    const cashCodes = new Set(accounts.filter((a) => a.isCash).map((a) => a.code));
    for (const date of ['2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31']) {
      const computed = sum(
        entries
          .filter(
            (e) => e.organizationId === primaryOrganizationId && e.status === 'POSTED' && e.date <= date,
          )
          .flatMap((e) =>
            e.lines.filter((l) => cashCodes.has(l.accountCode)).map((l) => signed(l.baseDebit, l.baseCredit)),
          ),
      );
      expect(cents(referenceCash(date))).toBe(computed);
    }
    expect(referenceCash('2026-09-30')).toBe('164615.00');
    expect(referenceCash('2026-10-31')).toBe('174450.00');
  });
  it('retains the accounting equation at four independent snapshots', () => {
    for (const date of ['2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31']) {
      const balances = new Map(
        accounts.map((a) => [
          a.code,
          sum(
            entries
              .filter(
                (e) => e.organizationId === primaryOrganizationId && e.status === 'POSTED' && e.date <= date,
              )
              .flatMap((e) =>
                e.lines.filter((l) => l.accountCode === a.code).map((l) => signed(l.baseDebit, l.baseCredit)),
              ),
          ),
        ]),
      );
      const byType = (type: string) =>
        sum(accounts.filter((a) => a.type === type).map((a) => balances.get(a.code)!));
      const assets = byType('ASSET');
      const liabilities = -byType('LIABILITY');
      const equity = -byType('EQUITY');
      const retained = -byType('REVENUE') - byType('EXPENSE');
      expect(assets).toBe(liabilities + equity + retained);
    }
  });
  it('does not recognize invoices twice when paid or count drafts, investments and loans as sales', () => {
    // August services 21000 + unpaid invoice8000 + product6100; loan/investment excluded.
    expect(referenceTotal('REVENUE', '2026-08-01', '2026-08-31')).toBe('35100.00');
    expect(referenceBalance('1100', '2026-08-31')).toBe('8000.00');
    expect(referenceBalance('1100', '2026-09-30')).toBe('0.00');
    expect(referenceTotal('REVENUE', '2026-10-01', '2026-10-31')).toBe('37200.00');
    expect(referenceBalance('2300', '2026-10-31')).toBe('20000.00');
  });
  it('distinguishes native foreign cash from recorded base value', () => {
    expect(referenceBalance('1010', '2026-09-30', true)).toBe('800.00');
    expect(referenceBalance('1010', '2026-09-30')).toBe('880.00');
    expect(referenceTotal('EXPENSE', '2026-08-01', '2026-08-31', { vendor: 'Europa Rail' })).toBe('220.00');
  });
  it('includes all posted duplicate amounts until a human makes a reversing correction', () => {
    expect(referenceTotal('EXPENSE', '2026-09-01', '2026-09-30', { vendor: 'Maple Cafe' })).toBe('280.00');
    expect(getReference('analytics-10').facts.map((f) => f.value)).toEqual(['2', '280.00', '140.00']);
  });
  it('supplies complete references, scoped evidence and balanced review-only proposals', () => {
    for (const question of questions) {
      const reference = getReference(question.id);
      expect(reference.behavior).toBeTruthy();
      for (const id of reference.requiredDocumentIds) {
        expect(documents.find((d) => d.id === id)?.organizationId).toBe(question.organizationId);
      }
      if (reference.behavior === 'ANSWER') expect(reference.facts.length).toBeGreaterThan(0);
      if (reference.behavior === 'CLARIFY')
        expect(reference.clarificationTopicTags.length).toBeGreaterThan(0);
      if (reference.behavior === 'PROPOSAL') {
        expect(reference.proposalLines).toHaveLength(2);
        expect(sum(reference.proposalLines!.map((l) => signed(l.baseDebit, l.baseCredit)))).toBe(0n);
      }
      expect(reference.requiredAssumptionTags.every((tag) => assumptionTags.includes(tag))).toBe(true);
      expect(reference.clarificationTopicTags.every((tag) => clarificationTopicTags.includes(tag))).toBe(
        true,
      );
    }
    expect(getReference('entry-02').proposalLines?.map((l) => l.accountCode)).toEqual(['1000', '1100']);
    expect(getReference('entry-07').proposalLines?.map((l) => l.accountCode)).toEqual(['2000', '1000']);
    expect(getReference('entry-10').behavior).toBe('CLARIFY');
  });
  it('keeps explicit scenario arithmetic and forecast assumptions separate from observed facts', () => {
    // 164615 - 3*(6000+18%*6000) -3000 recruiting -50000 reserve =90375.
    expect(getReference('scenario-02').facts[0].value).toBe('90375.00');
    expect(getReference('scenario-06').facts.map((f) => f.value)).toEqual(['13500.00', '110950.00']);
    // October expenses18365; (174450-50000)/18365 =6.776..., rounded6.78.
    expect(referenceTotal('EXPENSE', '2026-10-01', '2026-10-31')).toBe('18365.00');
    expect(getReference('scenario-07').facts[0].value).toBe('6.78');
    expect(getReference('scenario-08').facts[0].value).toBe('4.77');
    expect(getReference('scenario-07').requiredAssumptionTags).toContain('EXPENSES_AS_CASH_PROXY');
    expect(getReference('scenario-09').behavior).toBe('CLARIFY');
    expect(getReference('adversarial-08').facts[0].value).toBe('37200.00');
  });
});

describe('independent verifier and hard-gate challenge packs', () => {
  it('has 160 balanced reviewer cases with eight examples of each fault and source-disjoint splits', () => {
    expect(reviewCases).toHaveLength(160);
    expect(reviewCases.filter((c) => c.expected === 'PASS')).toHaveLength(80);
    expect(reviewCases.filter((c) => c.expected === 'BLOCK')).toHaveLength(80);
    expect(reviewCases.filter((c) => c.split === 'development')).toHaveLength(80);
    expect(reviewCases.filter((c) => c.split === 'holdout')).toHaveLength(80);
    for (const fault of new Set(reviewCases.filter((c) => c.faultType).map((c) => c.faultType))) {
      expect(reviewCases.filter((c) => c.faultType === fault)).toHaveLength(8);
    }
    const splits = new Map<string, Set<string>>();
    for (const item of reviewCases)
      splits.set(item.sourceGroupId, new Set([...(splits.get(item.sourceGroupId) ?? []), item.split]));
    expect([...splits.values()].every((s) => s.size === 1)).toBe(true);
  });
  it('strips reviewer gold decisions and mutation labels from the submitted checker input', () => {
    for (const item of reviewCases) {
      const visible = providerReviewCase(item);
      expect(Object.keys(visible).sort()).toEqual(['candidate', 'evidence', 'question']);
      expect(visible).not.toHaveProperty('expected');
      expect(visible).not.toHaveProperty('faultType');
      expect(visible).not.toHaveProperty('deterministicExpected');
      const paired = reviewCases.find(
        (other) => other.groupId === item.groupId && other.expected !== item.expected,
      )!;
      if (item.expected === 'BLOCK')
        expect(JSON.stringify(visible)).not.toBe(JSON.stringify(providerReviewCase(paired)));
    }
  });
  it('covers six distinct hard-gate families with 60 unique inputs', () => {
    expect(securityCases).toHaveLength(60);
    expect(new Set(securityCases.map((c) => c.id)).size).toBe(60);
    expect(new Set(securityCases.map((c) => c.kind)).size).toBe(6);
    for (const kind of new Set(securityCases.map((c) => c.kind))) {
      expect(securityCases.filter((c) => c.kind === kind)).toHaveLength(10);
    }
    expect(
      securityCases.every((c) => c.organizationId === primaryOrganizationId && c.expected === 'BLOCK'),
    ).toBe(true);
  });
});
