import { describe, expect, it } from 'vitest';
import { evidenceFor, validateAnswer, type ResearchAnswer } from '../research/answer';
import { compileQuery, customRowScope, type AnalyticalQuery, type ToolEvidence } from '../research/analytics';
import { ledgerFactBound, rowQualifiers, type RowScope } from '../research/scope';
import { accounts, primaryOrganizationId, type ResearchQuestion } from '../research/dataset';
import { scoreEpisode } from '../research/scoring';
import type { ReferenceAnswer } from '../research/reference';

const question: ResearchQuestion = {
  id: 'synthetic-scope',
  groupId: 'synthetic-scope',
  family: 'analytics',
  split: 'development',
  organizationId: primaryOrganizationId,
  asOf: '2024-04-30',
  question: 'Compare monthly rent in January through March with April.',
};
const query = (overrides: Partial<AnalyticalQuery> = {}): AnalyticalQuery => ({
  id: 'monthly',
  metric: 'expenses',
  from: '2024-01-01',
  to: '2024-04-30',
  groupBy: 'month',
  accountCodes: ['5000'],
  search: '',
  limit: 10,
  order: 'label_asc',
  ...overrides,
});
const rows = [
  { label: '2024-01', value: '1100.00' },
  { label: '2024-02', value: '1100.00' },
  { label: '2024-03', value: '1100.00' },
  { label: '2024-04', value: '1210.00' },
];
function evidence(backend: 'custom' | 'wren', changedRows = rows, scope?: RowScope) {
  const plan = query();
  const tool: ToolEvidence = {
    id: 'query:monthly',
    plan: backend === 'custom' ? plan : { backend: 'wren', columnUnits: { value: 'USD' } },
    rows: changedRows,
    sqlHash: 'a'.repeat(64),
    snapshot: 'b'.repeat(64),
    rowScope:
      scope ??
      (backend === 'custom'
        ? customRowScope(plan)
        : {
            provenance: 'ast-scope-v1',
            supported: true,
            from: '2024-01-01',
            toExclusive: '2024-05-01',
            periodColumn: { name: 'label', kind: 'month' },
            fixedIdentity: { accountCode: '5000' },
          }),
  };
  return evidenceFor([tool], []);
}
const fact = (overrides: Partial<ResearchAnswer['facts'][number]> = {}): ResearchAnswer['facts'][number] => ({
  key: 'old_monthly_rent',
  value: '1100.00',
  unit: 'USD',
  evidenceIds: ['query:monthly'],
  entity: 'Rent',
  from: '2024-01-01',
  to: '2024-03-31',
  asOf: null,
  ...overrides,
});
const answer = (facts = [fact()]): ResearchAnswer => ({
  behavior: 'ANSWER',
  summary: 'Synthetic scope test.',
  facts,
  evidenceIds: ['query:monthly'],
  assumptions: [],
  assumptionTags: [],
  clarificationTopics: [],
  clarificationTopicTags: [],
  proposalLines: [],
  calculations: [],
});
const reference: ReferenceAnswer = {
  behavior: 'ANSWER',
  facts: [
    {
      key: 'old_monthly_rent',
      value: '1100.00',
      unit: 'USD',
      from: '2024-01-01',
      to: '2024-03-31',
      entity: 'Rent',
    },
  ],
  evidenceIds: [],
  requiredDocumentIds: [],
  supportingEntryIds: [],
  requiresLedgerEvidence: true,
  requiredAssumptions: [],
  clarificationTopics: [],
  requiredAssumptionTags: [],
  clarificationTopicTags: [],
  summary: '',
};

describe('machine-derived ledger row periods', () => {
  it('gives equivalent custom and Wren rows the same monthly scopes, including leap-year February', () => {
    const custom = evidence('custom'),
      wren = evidence('wren');
    expect(custom[0].facts!.map(({ key: _key, ...value }) => value)).toEqual(
      wren[0].facts!.map(({ key: _key, ...value }) => value),
    );
    expect(custom[0].facts![1]).toMatchObject({
      from: '2024-02-01',
      to: '2024-02-29',
      entity: 'Rent',
      scopeSupported: true,
    });
    expect(custom[0].facts![3]).toMatchObject({ from: '2024-04-01', to: '2024-04-30', value: '1210.00' });
  });
  it.each(['custom', 'wren'] as const)(
    'validates and scores a fully covered uniform monthly claim with %s',
    (backend) => {
      const sources = evidence(backend),
        candidate = answer();
      const validation = validateAnswer(candidate, question, sources);
      expect(validation.valid).toBe(true);
      const score = scoreEpisode(
        {
          id: `test-${backend}`,
          route: backend === 'wren' ? 'R6' : 'R1',
          questionId: question.id,
          groupId: question.groupId,
          family: question.family,
          split: question.split,
          repeat: 0,
          status: 'ok',
          durationMs: 1,
          organizationId: question.organizationId,
          answer: candidate,
          evidence: sources,
          validation,
        },
        reference,
      );
      expect(score.success).toBe(true);
      expect(score.ledgerGrounded).toBe(true);
      expect(score.unsupportedFacts).toBe(0);
    },
  );
  it('does not use the same amount from a different month or accept a missing source date', () => {
    const october = fact({ from: '2024-10-01', to: '2024-10-31' });
    expect(ledgerFactBound(october, evidence('custom')[0].facts!)).toBe(false);
    expect(ledgerFactBound(october, [{ key: 'value', value: '1100.00', unit: 'USD', entity: 'Rent' }])).toBe(
      false,
    );
    expect(validateAnswer(answer([october]), question, evidence('custom')).reasons).toContain(
      'UNSUPPORTED_LEDGER_SCOPE',
    );
  });
  it.each(['missing', 'different_value', 'different_currency', 'different_entity'])(
    'rejects a monthly series with %s',
    (failure) => {
      const sources = evidence('custom');
      if (failure === 'missing') sources[0].facts!.splice(1, 1);
      if (failure === 'different_value') sources[0].facts![1].value = '1101.00';
      if (failure === 'different_currency') sources[0].facts![1].unit = 'EUR';
      if (failure === 'different_entity') {
        sources[0].facts![1].entity = 'Travel';
        sources[0].facts![1].entityAliases = ['Travel'];
      }
      expect(ledgerFactBound(fact(), sources[0].facts!)).toBe(false);
    },
  );
  it('clips partial months and does not pretend they prove a full month', () => {
    const sources = evidence('custom', rows, customRowScope(query({ from: '2024-01-15' })));
    expect(sources[0].facts![0].from).toBe('2024-01-15');
    expect(ledgerFactBound(fact(), sources[0].facts!)).toBe(false);
  });
  it('does not turn identical monthly amounts into an equal multi-month expense total', () => {
    expect(ledgerFactBound(fact({ key: 'expenses' }), evidence('custom')[0].facts!)).toBe(false);
  });
  it('does not treat absent/unsupported Wren scope as a wildcard or launder it through arithmetic', () => {
    const sources = evidence('wren', rows, { provenance: 'ast-scope-v1', supported: false });
    expect(ledgerFactBound(fact(), sources[0].facts!)).toBe(false);
    const candidate = answer([fact({ value: '2200.00', evidenceIds: ['calc:double'] })]);
    candidate.calculations = [
      {
        id: 'double',
        operation: 'sum',
        operands: ['1100.00', '1100.00'],
        operandUnits: ['USD', 'USD'],
        unit: 'USD',
        evidenceIds: ['query:monthly'],
        scale: 2,
      },
    ];
    expect(validateAnswer(candidate, question, sources).reasons).toContain('UNSUPPORTED_CALCULATION_OPERAND');
  });
  it('proves as-of balances only from an explicit upper bound over unbounded history', () => {
    const bounded = rowQualifiers(
      { provenance: 'ast-scope-v1', supported: true, from: null, toExclusive: '2024-05-01' },
      {},
      accounts,
    );
    expect(bounded.asOf).toBe('2024-04-30');
    const unbounded = rowQualifiers(
      { provenance: 'ast-scope-v1', supported: true, from: null, toExclusive: null },
      {},
      accounts,
    );
    expect(
      ledgerFactBound(fact({ from: null, to: null, asOf: '2024-04-30', entity: null }), [
        { key: 'cash', value: '1100.00', unit: 'USD', ...unbounded },
      ]),
    ).toBe(false);
  });
  it('requires actual identity proof and accepts only machine-known account aliases', () => {
    const sources = evidence('custom')[0].facts!;
    expect(ledgerFactBound(fact({ entity: '5000' }), sources)).toBe(true);
    expect(ledgerFactBound(fact({ entity: 'Travel' }), sources)).toBe(false);
    expect(
      ledgerFactBound(
        fact(),
        sources.map(({ entity: _entity, entityAliases: _aliases, ...rest }) => rest),
      ),
    ).toBe(false);
  });
  it('does not relabel a day/month movement as an as-of balance', () => {
    expect(() => compileQuery(query({ metric: 'cash_balance', from: null }))).toThrow(
      'RESEARCH_BALANCE_MONTH_GROUP_REQUIRES_CUMULATIVE_QUERY',
    );
    const qualifiers = rowQualifiers(
      {
        provenance: 'ast-scope-v1',
        supported: true,
        from: null,
        toExclusive: '2024-05-01',
        periodColumn: { name: 'day', kind: 'date' },
      },
      { day: '2024-04-30' },
      accounts,
    );
    expect(qualifiers).toMatchObject({ from: '2024-04-30', to: '2024-04-30' });
    expect(qualifiers.asOf).toBeUndefined();
    expect(
      ledgerFactBound(fact({ key: 'cash_balance', entity: null, from: null, to: null, asOf: '2024-04-30' }), [
        { key: 'value', value: '1100.00', unit: 'USD', ...qualifiers },
      ]),
    ).toBe(false);
  });
  it.each(['wrong_date', 'wrong_entity'])('rejects a same-value calculation wrapper with %s', (failure) => {
    const sources = evidence('custom');
    const claim = fact({
      from: failure === 'wrong_date' ? '2024-08-01' : '2024-01-01',
      to: failure === 'wrong_date' ? '2024-08-31' : '2024-01-31',
      entity: failure === 'wrong_entity' ? 'Travel' : 'Rent',
      evidenceIds: ['calc:wrapped'],
    });
    const candidate = answer([claim]);
    candidate.calculations = [
      {
        id: 'wrapped',
        operation: 'product',
        operands: ['1100.00', '1'],
        operandUnits: ['USD', 'count'],
        unit: 'USD',
        evidenceIds: ['query:monthly'],
        scale: 2,
      },
    ];
    expect(validateAnswer(candidate, question, sources).reasons).toContain('UNSUPPORTED_CALCULATION_SCOPE');
  });
  it('retains verified ancestor periods across multi-step calculations and accepts real multi-period comparisons', () => {
    const sources = evidence('custom', [
      { label: '2024-01', value: '1100.00' },
      { label: '2024-02', value: '1210.00' },
    ]);
    const candidate = answer([
      fact({
        key: 'increase',
        value: '110.00',
        from: '2024-01-01',
        to: '2024-02-29',
        evidenceIds: ['calc:increase'],
      }),
    ]);
    candidate.calculations = [
      {
        id: 'prior',
        operation: 'product',
        operands: ['1100.00', '1'],
        operandUnits: ['USD', 'count'],
        unit: 'USD',
        evidenceIds: ['query:monthly'],
        scale: 2,
      },
      {
        id: 'increase',
        operation: 'difference',
        operands: ['1210.00', '1100.00'],
        operandUnits: ['USD', 'USD'],
        unit: 'USD',
        evidenceIds: ['query:monthly', 'calc:prior'],
        scale: 2,
      },
    ];
    const validation = validateAnswer(candidate, question, sources);
    expect(validation.valid).toBe(true);
    expect(sources.find((source) => source.id === 'calc:increase')?.ledgerAncestors?.length).toBeGreaterThan(
      0,
    );
    const score = scoreEpisode(
      {
        id: 'comparison',
        route: 'R1',
        questionId: question.id,
        groupId: question.groupId,
        family: question.family,
        split: question.split,
        repeat: 0,
        status: 'ok',
        durationMs: 1,
        organizationId: question.organizationId,
        answer: candidate,
        evidence: sources,
        validation,
      },
      {
        ...reference,
        facts: [
          {
            key: 'increase',
            value: '110.00',
            unit: 'USD',
            from: '2024-01-01',
            to: '2024-02-29',
            entity: 'Rent',
          },
        ],
      },
    );
    expect(score.success).toBe(true);
  });
  it('does not widen one ambiguous monthly operand into the union of equal-valued rows', () => {
    const sources = evidence('custom');
    const candidate = answer([fact({ key: 'expenses', value: '1100.00', evidenceIds: ['calc:wrapped'] })]);
    candidate.calculations = [
      {
        id: 'wrapped',
        operation: 'product',
        operands: ['1100.00', '1'],
        operandUnits: ['USD', 'count'],
        unit: 'USD',
        evidenceIds: ['query:monthly'],
        scale: 2,
      },
    ];
    expect(validateAnswer(candidate, question, sources).reasons).toContain('UNSUPPORTED_CALCULATION_SCOPE');
  });
  it('does not collapse grouped vendors into an account-wide monthly claim', () => {
    const scope: RowScope = {
      provenance: 'ast-scope-v1',
      supported: true,
      from: '2024-01-01',
      toExclusive: '2024-03-01',
      periodColumn: { name: 'month', kind: 'month' },
      fixedIdentity: { accountCode: '5000' },
      identityColumns: { vendor: 'vendor' },
    };
    const facts = ['2024-01', '2024-02'].flatMap((month) =>
      ['Vendor A', 'Vendor B'].map((vendor) => ({
        key: 'value',
        value: '1100.00',
        unit: 'USD',
        ...rowQualifiers(scope, { month, vendor }, accounts),
      })),
    );
    const claim = fact({ to: '2024-02-29' });
    expect(ledgerFactBound(claim, facts)).toBe(false);
    expect(ledgerFactBound({ ...claim, entity: null }, facts)).toBe(false);
    expect(ledgerFactBound({ ...claim, entity: 'Vendor A' }, facts)).toBe(true);
    expect(ledgerFactBound({ ...claim, entity: 'Vendor A' }, [...facts, facts[0]])).toBe(false);
  });
  it('does not remove a required grouping identity through a same-value calculation wrapper', () => {
    const sources = evidence('custom', [{ label: '2024-01', value: '1100.00' }]);
    sources[0].facts![0].identityGrain = [['Vendor A']];
    sources[0].facts![0].entityAliases = ['Rent', 'Vendor A'];
    const candidate = answer([
      fact({ key: 'expenses', entity: null, to: '2024-01-31', evidenceIds: ['calc:wrapped'] }),
    ]);
    candidate.calculations = [
      {
        id: 'wrapped',
        operation: 'product',
        operands: ['1100.00', '1'],
        operandUnits: ['USD', 'count'],
        unit: 'USD',
        evidenceIds: ['query:monthly'],
        scale: 2,
      },
    ];
    expect(validateAnswer(candidate, question, sources).reasons).toContain('UNSUPPORTED_CALCULATION_SCOPE');
  });
  it('binds an entry date only to event claims, not a cumulative cash claim', () => {
    const qualifiers = rowQualifiers(
      {
        provenance: 'ast-scope-v1',
        supported: true,
        from: null,
        toExclusive: '2024-05-01',
        periodColumn: { name: 'date', kind: 'date' },
        identityColumns: { entryId: 'id' },
      },
      { date: '2024-04-12', id: 'entry-1' },
      accounts,
    );
    const source = { key: 'value', value: '1100.00', unit: 'USD', ...qualifiers };
    expect(source).toMatchObject({
      periodKind: 'event',
      from: '2024-04-12',
      to: '2024-04-12',
      asOf: '2024-04-12',
    });
    const candidate = fact({
      key: 'entry_total',
      entity: 'entry-1',
      from: null,
      to: null,
      asOf: '2024-04-12',
    });
    expect(ledgerFactBound(candidate, [source])).toBe(true);
    expect(ledgerFactBound({ ...candidate, key: 'cash_balance' }, [source])).toBe(false);
  });
});
