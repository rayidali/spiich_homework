import { describe, expect, it } from 'vitest';
import {
  completeDeclaredArithmetic,
  finalizeAnswerContract,
  prepareAnswerContract,
  type CompletionContext,
} from '../server/answer-completion';
import {
  answerValueScopeSchema,
  type AnswerContract,
  type AnswerRequirement,
  type OutputBinding,
} from '../server/answer-contract';
import {
  executeFinancialAnalysis,
  type AnalysisAccount,
  type AnalysisFacts,
  type FinancialQuery,
} from '../server/financial-analysis';
import {
  evaluateFinancialScenario,
  type FinancialScenario,
  type ScenarioReference,
} from '../server/financial-calculation';
import type { Db } from '../server/db';

const org = '00000000-0000-4000-8000-000000000001';
const chart: AnalysisAccount[] = [
  {
    id: '00000000-0000-4000-8000-000000000002',
    code: '5030',
    name: 'Supplies',
    type: 'EXPENSE',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    is_cash: false,
    archived: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    code: '5040',
    name: 'Rent',
    type: 'EXPENSE',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    is_cash: false,
    archived: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    code: '1000',
    name: 'Bank',
    type: 'ASSET',
    currency: 'USD',
    parent_id: null,
    is_group: false,
    is_cash: true,
    archived: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    code: '1020',
    name: 'Euro bank',
    type: 'ASSET',
    currency: 'EUR',
    parent_id: null,
    is_group: false,
    is_cash: true,
    archived: false,
  },
];
const query = (id: string, change: Partial<FinancialQuery> = {}): FinancialQuery => ({
  id,
  metric: 'net_expense',
  aggregation: 'sum',
  from: '2026-01-01',
  to: '2026-01-31',
  status: 'POSTED',
  currencyMode: 'base',
  currency: null,
  groupBy: 'total',
  accountCodes: ['5030'],
  cooccurringAccountCodes: [],
  counterparty: { mode: 'any', value: '' },
  descriptionSearch: '',
  minimumAmount: null,
  maximumAmount: null,
  order: 'label_asc',
  limit: 50,
  ...change,
});
const january = query('jan');
const february = query('feb', { from: '2026-02-01', to: '2026-02-28' });
const text = 'Show January and February spending, their change and relative change.';
const messages = [{ role: 'user' as const, content: text }];
const rowBinding = (id: string, queryId = id, rowId = 'total:total'): OutputBinding => ({
  outputId: id,
  source: { kind: 'query_row', queryId, rowId },
});
const value = (q: FinancialQuery): AnswerRequirement => {
  const { id: _id, groupBy: _g, order: _o, limit: _l, ...scope } = q;
  return {
    kind: 'value',
    scope: answerValueScopeSchema.parse(scope),
    counterpartyFrom: null,
    selectedAccountCode: null,
  };
};
const arithmetic = (
  operation: 'add' | 'subtract' | 'multiply' | 'divide',
  left: string,
  right: string,
): AnswerRequirement => ({
  kind: 'arithmetic',
  operation,
  operands: [
    { source: 'output', id: left },
    { source: 'output', id: right },
  ],
});
const contract = (requirements: [string, AnswerRequirement][], question = text): AnswerContract => ({
  outputs: requirements.map(([id, requirement]) => ({
    id,
    requirement,
    sourceQuotes: [{ messageIndex: 0, quote: question }],
  })),
});
const prepared = (requirements: [string, AnswerRequirement][], question = text) =>
  prepareAnswerContract(contract(requirements, question), [{ role: 'user', content: question }]);
const four = () =>
  prepared([
    ['jan', value(january)],
    ['feb', value(february)],
    ['delta', arithmetic('subtract', 'feb', 'jan')],
    ['relative', arithmetic('divide', 'delta', 'jan')],
  ]);
type Raw = {
  row_id: string;
  label: string;
  value: string | null;
  entry_count: string;
  period_from?: string;
  period_to?: string;
};
const total = (amount: string | null): Raw => ({
  row_id: 'total',
  label: 'Total',
  value: amount,
  entry_count: amount === null ? '0' : '2',
});
async function executed(plans: FinancialQuery[], raw: Raw[][]): Promise<CompletionContext> {
  let at = 0;
  const db = {
    query: async (sql: string) => {
      if (sql.startsWith('SET LOCAL')) return { rows: [] };
      if (sql.startsWith('SELECT id,code,name,type,currency')) return { rows: chart };
      if (sql.startsWith('WITH typed_input')) return { rows: raw[at++] };
      throw new Error('Unexpected offline database statement');
    },
  } as unknown as Db;
  const result = await executeFinancialAnalysis(org, { queries: plans }, db);
  return { ...result, organizationId: org, chart, bindings: plans.map((p) => rowBinding(p.id)) };
}
const qref = (id: string): ScenarioReference => ({
  source: 'query',
  id,
  rowId: 'total:total',
  field: 'value',
});
const aref = (id: string): ScenarioReference => ({ source: 'assumption', id, rowId: null, field: 'value' });
function withCalculations(
  context: CompletionContext,
  plan: FinancialScenario,
  original = messages,
): CompletionContext {
  const result = evaluateFinancialScenario(
    plan,
    context.facts.filter((f): f is AnalysisFacts => !('kind' in f)),
    original,
  );
  return { ...context, facts: result.facts, evidence: [...context.evidence, ...result.evidence] };
}
const calcValues = (context: Pick<CompletionContext, 'facts'>) =>
  context.facts.flatMap((f) => ('kind' in f ? [f.value] : []));
const complete = (p: ReturnType<typeof four>, context: CompletionContext) => {
  const result = completeDeclaredArithmetic(p, context);
  return { result, assessment: finalizeAnswerContract(p, { ...context, ...result }) };
};

describe('Deterministic execution of frozen missing arithmetic', () => {
  it('creates exactly the declared delta and ratio, preserving every original input byte and ref', async () => {
    const context = await executed([january, february], [[total('240')], [total('90')]]);
    const p = four(),
      before = JSON.stringify({ p, context });
    const { result, assessment } = complete(p, context);
    expect(result.generatedCalculations.map((c) => c.outputId)).toEqual(['delta', 'relative']);
    expect(calcValues(result)).toEqual(['-150.00', '-0.625']);
    expect(assessment.status).toBe('fulfilled');
    expect(assessment.userIntentVerified).toBe(false);
    expect(JSON.stringify({ p, context })).toBe(before);
    expect(result.facts.slice(0, 2)).toEqual(context.facts);
    expect(result.evidence.slice(0, context.evidence.length)).toEqual(context.evidence);
    expect(result.bindings.slice(0, 2)).toEqual(context.bindings);
    expect(result.facts.at(-1)).toMatchObject({ exact: { numerator: '-5', denominator: '8' } });
  });
  it('is idempotent when effective generated bindings are passed back', async () => {
    const context = await executed([january, february], [[total('240')], [total('90')]]);
    const first = completeDeclaredArithmetic(four(), context);
    const second = completeDeclaredArithmetic(four(), { ...context, ...first });
    expect(second.generatedCalculations).toEqual([]);
    expect(second.facts).toEqual(first.facts);
    expect(second.evidence).toEqual(first.evidence);
  });
  it.each(['absent_binding', 'absent_fact'] as const)(
    'never infers a missing value output from %s',
    async (mode) => {
      const context = await executed([january, february], [[total('240')], [total('90')]]);
      context.bindings = [rowBinding('jan')];
      if (mode === 'absent_fact') {
        context.facts.pop();
        context.evidence.pop();
      }
      const { result, assessment } = complete(four(), context);
      expect(result.generatedCalculations).toEqual([]);
      expect(assessment.status).toBe('partial');
      expect(result.facts).toEqual(context.facts);
    },
  );
  it('does not repair an explicitly supplied equal-dollar wrong-account binding', async () => {
    const context = await executed(
      [query('jan', { accountCodes: ['5040'] }), february],
      [[total('240')], [total('90')]],
    );
    const { result, assessment } = complete(four(), context);
    expect(result.generatedCalculations).toEqual([]);
    expect(assessment.outputs[0].status).toBe('invalid');
  });
  it('never overwrites a supplied invalid arithmetic binding', async () => {
    const base = await executed([january, february], [[total('240')], [total('90')]]);
    const context = withCalculations(base, {
      queries: [january, february],
      assumptions: [],
      calculations: [{ id: 'wrong', operation: 'subtract', operands: [qref('jan'), qref('feb')] }],
    });
    context.bindings.push({ outputId: 'delta', source: { kind: 'calculation', calculationId: 'wrong' } });
    const { result, assessment } = complete(four(), context);
    expect(result.generatedCalculations).toEqual([]);
    expect(result.bindings).toEqual(context.bindings);
    expect(assessment.outputs[2].status).toBe('invalid');
  });
  it('does not expose or replace a supplied correct calculation hidden from evidence', async () => {
    const base = await executed([january, february], [[total('240')], [total('90')]]);
    const context = withCalculations(base, {
      queries: [january, february],
      assumptions: [],
      calculations: [{ id: 'hidden', operation: 'subtract', operands: [qref('feb'), qref('jan')] }],
    });
    context.evidence = base.evidence;
    context.bindings.push({ outputId: 'delta', source: { kind: 'calculation', calculationId: 'hidden' } });
    const { result, assessment } = complete(four(), context);
    expect(result.generatedCalculations).toEqual([]);
    expect(result.evidence).toEqual(base.evidence);
    expect(assessment.outputs[2].status).toBe('missing');
  });
  it('replay appends only new rows and never reveals an unrelated hidden existing calculation', async () => {
    const base = await executed([january, february], [[total('240')], [total('90')]]);
    const context = withCalculations(base, {
      queries: [january, february],
      assumptions: [],
      calculations: [{ id: 'hidden', operation: 'add', operands: [qref('feb'), qref('jan')] }],
    });
    context.evidence = base.evidence;
    const { result, assessment } = complete(four(), context);
    expect(result.generatedCalculations).toHaveLength(2);
    expect(assessment.status).toBe('fulfilled');
    expect(
      result.evidence
        .flatMap((e) => e.rows)
        .some((r) => r.factRef?.kind === 'calculation' && r.factRef.calculationId === 'hidden'),
    ).toBe(false);
    expect(result.facts[2]).toEqual(context.facts[2]);
  });
  it('retains a valid dependency that exposes a supplied downstream invalid formula, then stops', async () => {
    const base = await executed([january, february], [[total('240')], [total('90')]]);
    const context = withCalculations(base, {
      queries: [january, february],
      assumptions: [],
      calculations: [{ id: 'bad_relative', operation: 'divide', operands: [qref('jan'), qref('feb')] }],
    });
    context.bindings.push({
      outputId: 'relative',
      source: { kind: 'calculation', calculationId: 'bad_relative' },
    });
    expect(finalizeAnswerContract(four(), context).outputs[3].status).toBe('missing');
    const { result, assessment } = complete(four(), context);
    expect(result.generatedCalculations.map((c) => c.outputId)).toEqual(['delta']);
    expect(assessment.outputs[3].status).toBe('invalid');
    expect(result.bindings.find((b) => b.outputId === 'relative')).toEqual(context.bindings[2]);
  });
  it('zero denominator preserves the successful delta but commits no partial ratio node', async () => {
    const context = await executed([january, february], [[total('0')], [total('90')]]);
    const { result, assessment } = complete(four(), context);
    expect(result.generatedCalculations.map((c) => c.outputId)).toEqual(['delta']);
    expect(calcValues(result)).toEqual(['90.00']);
    expect(assessment.outputs[3].status).toBe('missing');
  });
  it('uses canonical row handles without copying raw reference strings into generated arithmetic', async () => {
    const context = await executed([january, february], [[total('240')], [total('90')]]);
    context.bindings = [rowBinding('jan', 'jan', 'r_january'), rowBinding('feb', 'feb', 'r_february')];
    context.resolveRowReference = (id, handle) => {
      if (handle === `r_${id === 'jan' ? 'january' : 'february'}`) return 'total:total';
      throw new Error('Bad handle');
    };
    const { result, assessment } = complete(four(), context);
    expect(assessment.status).toBe('fulfilled');
    expect(result.facts[2]).toMatchObject({ operands: [qref('feb'), qref('jan')] });
    context.bindings[1] = rowBinding('feb', 'feb', 'r_other');
    expect(completeDeclaredArithmetic(four(), context).generatedCalculations).toEqual([]);
  });
  it('allocates deterministic IDs without colliding with query, output or unused assumption IDs', async () => {
    const a = query('completion_calculation_1'),
      b = query('completion_calculation_2', { from: '2026-02-01', to: '2026-02-28' });
    const context = await executed([a, b], [[total('240')], [total('90')]]);
    const p = prepared([
      [a.id, value(a)],
      [b.id, value(b)],
      ['completion_calculation_3', arithmetic('subtract', b.id, a.id)],
    ]);
    const result = completeDeclaredArithmetic(p, context);
    expect(result.generatedCalculations).toEqual([
      { outputId: 'completion_calculation_3', calculationId: 'completion_calculation_4' },
    ]);
  });
});

describe('Existing financial restrictions remain authoritative', () => {
  it.each([
    { metric: 'account_balance', from: null, accountCodes: ['1000'] },
    {
      metric: 'account_balance',
      from: null,
      currencyMode: 'native',
      currency: 'EUR',
      accountCodes: ['1020'],
    },
    { aggregation: 'average_per_entry' },
  ] as Partial<FinancialQuery>[])('does not broaden the calculator for %j', async (change) => {
    const q = query('source', change),
      context = await executed([q], [[total('240')]]);
    const p = prepared([
      ['source', value(q)],
      ['twice', arithmetic('add', 'source', 'source')],
    ]);
    const result = completeDeclaredArithmetic(p, context);
    expect(result.generatedCalculations).toEqual([]);
    expect(finalizeAnswerContract(p, { ...context, ...result }).outputs[1].status).toBe('missing');
  });
  it('native EUR cash remains a valid displayed value but not a monetary calculator operand', async () => {
    const q = query('cash', {
      metric: 'cash_balance',
      from: null,
      accountCodes: [],
      currencyMode: 'native',
      currency: 'EUR',
    });
    const context = await executed([q], [[total('240')]]);
    const p = prepared([
      ['cash', value(q)],
      ['twice', arithmetic('add', 'cash', 'cash')],
    ]);
    expect(finalizeAnswerContract(p, context).outputs[0].status).toBe('fulfilled');
    expect(completeDeclaredArithmetic(p, context).generatedCalculations).toEqual([]);
  });
  it('does not use a fulfilled scalar cell from a truncated discovery as an operand', async () => {
    const q = query('accounts', { accountCodes: [], groupBy: 'account', limit: 1 });
    const context = await executed(
      [q],
      [
        [
          { ...total('240'), row_id: chart[0].id },
          { ...total('90'), row_id: chart[1].id },
        ],
      ],
    );
    const required = {
      ...value(query('scope', { accountCodes: [] })),
      selectedAccountCode: '5030',
    } as AnswerRequirement;
    context.bindings = [rowBinding('supplies', 'accounts', `account:${chart[0].id}`)];
    const p = prepared([
      ['supplies', required],
      ['twice', arithmetic('add', 'supplies', 'supplies')],
    ]);
    expect(finalizeAnswerContract(p, context).outputs[0].status).toBe('fulfilled');
    expect(completeDeclaredArithmetic(p, context).generatedCalculations).toEqual([]);
  });
  it('does not turn a null no-transaction average into a numeric constant', async () => {
    const q = query('average', { aggregation: 'average_per_entry' }),
      context = await executed([q], [[total(null)]]);
    const p = prepared([
      ['average', value(q)],
      ['twice', arithmetic('add', 'average', 'average')],
    ]);
    expect(completeDeclaredArithmetic(p, context).generatedCalculations).toEqual([]);
  });
  it('preserves draft ancestry and hypothetical labeling', async () => {
    const q = query('draft', { status: 'DRAFT' }),
      context = await executed([q], [[total('240')]]);
    const p = prepared([
      ['draft', value(q)],
      ['twice', arithmetic('add', 'draft', 'draft')],
    ]);
    const result = completeDeclaredArithmetic(p, context);
    expect(result.facts.at(-1)).toMatchObject({ source: 'draft', hypothetical: true, value: '480.00' });
    expect(result.evidence.at(-1)?.source).toBe('draft');
  });
  it('keeps stock and cash-movement lineage distinct through generated operations', async () => {
    const cash = query('cash', { metric: 'cash_balance', from: null, accountCodes: [] });
    const movement = query('movement', { metric: 'net_cash_movement', accountCodes: [] });
    const context = await executed([cash, movement], [[total('240')], [total('90')]]);
    const p = prepared([
      ['cash', value(cash)],
      ['movement', value(movement)],
      ['minus', arithmetic('subtract', 'cash', 'movement')],
    ]);
    const result = completeDeclaredArithmetic(p, context);
    expect(result.facts.at(-1)).toMatchObject({
      value: '150.00',
      cashSources: [{ queryId: 'cash', asOf: '2026-01-31' }],
      cashMovementSources: [{ queryId: 'movement', from: '2026-01-01', to: '2026-01-31' }],
    });
  });
});

describe('Calendar and assumption resource bounds', () => {
  const monthQuery = query('months', { groupBy: 'month', to: '2026-02-28' });
  const all = query('total', { to: '2026-02-28' });
  const months = [
    { ...total('240'), row_id: '2026-01', period_from: '2026-01-01', period_to: '2026-01-31' },
    { ...total('90'), row_id: '2026-02', period_from: '2026-02-01', period_to: '2026-02-28' },
  ];
  const monthRequirement = (): AnswerRequirement => {
    const { id: _id, ...query } = monthQuery;
    return {
      kind: 'arithmetic',
      operation: 'divide',
      operands: [
        { source: 'output', id: 'total' },
        { source: 'month_count', query: query as never },
      ],
    };
  };
  it('matches one complete exact month-count source and never supplies a guessed divisor', async () => {
    const context = await executed([all, monthQuery], [[total('330')], months]);
    context.bindings = [rowBinding('total')];
    const p = prepared([
      ['total', value(all)],
      ['average', monthRequirement()],
    ]);
    const result = completeDeclaredArithmetic(p, context);
    expect(calcValues(result)).toEqual(['165.00']);
    expect(result.facts.at(-1)).toMatchObject({
      operands: [qref('total'), { source: 'query', id: 'months', rowId: null, field: 'month_count' }],
    });
  });
  it.each(['missing', 'incomplete', 'ambiguous'] as const)(
    'keeps %s month coverage unresolved',
    async (mode) => {
      const plans =
        mode === 'missing'
          ? [all]
          : mode === 'ambiguous'
            ? [all, monthQuery, { ...monthQuery, id: 'months_two' }]
            : [all, monthQuery];
      const data =
        mode === 'missing'
          ? [[total('330')]]
          : mode === 'ambiguous'
            ? [[total('330')], months, months]
            : [[total('330')], months.slice(0, 1)];
      const context = await executed(plans, data);
      context.bindings = [rowBinding('total')];
      const p = prepared([
        ['total', value(all)],
        ['average', monthRequirement()],
      ]);
      expect(completeDeclaredArithmetic(p, context).generatedCalculations).toEqual([]);
    },
  );
  it('global eight-node ceiling includes every existing calculation, even if not a requested output', async () => {
    const context = await executed([january], [[total('240')]]);
    const calculations = Array.from({ length: 8 }, (_, i) => ({
      id: `existing_${i}`,
      operation: 'add' as const,
      operands: [qref('jan'), qref('jan')],
    }));
    const full = withCalculations(context, { queries: [january], assumptions: [], calculations });
    const p = prepared([
      ['jan', value(january)],
      ['twice', arithmetic('add', 'jan', 'jan')],
    ]);
    expect(completeDeclaredArithmetic(p, full).generatedCalculations).toEqual([]);
    const seven = withCalculations(context, {
      queries: [january],
      assumptions: [],
      calculations: calculations.slice(0, 7),
    });
    expect(completeDeclaredArithmetic(p, seven).facts.filter((f) => 'kind' in f)).toHaveLength(8);
  });
  it('counts unused original assumption IDs without parsing or reclaiming their displayed values', () => {
    const question =
      'Use $1 first, $2 second, $3 third, $4 fourth, $5 fifth, $6 sixth, $7 seventh, $8 eighth, and $9 extra.';
    const assumptions = Array.from({ length: 8 }, (_, i) => ({
      id: `a${i}`,
      value: String(i + 1),
      unit: 'USD' as const,
      sourceText: `$${i + 1}`,
    }));
    const original = [{ role: 'user' as const, content: question }];
    const result = evaluateFinancialScenario(
      {
        queries: [],
        assumptions,
        calculations: [{ id: 'existing', operation: 'add', operands: [aref('a0'), aref('a1')] }],
      },
      [],
      original,
    );
    const req: AnswerRequirement = {
      kind: 'arithmetic',
      operation: 'add',
      operands: [
        { source: 'assumption', value: '9', unit: 'USD', sourceText: '$9' },
        { source: 'assumption', value: '1', unit: 'USD', sourceText: '$1' },
      ],
    };
    const context: CompletionContext = { ...result, organizationId: org, chart, bindings: [] };
    const generated = completeDeclaredArithmetic(prepared([['new_sum', req]], question), context);
    expect(generated.generatedCalculations).toEqual([]);
    expect(generated.evidence).toEqual(context.evidence);
  });
  it('deduplicates the same exact user quantity while keeping distinct equal-dollar occurrences separate', () => {
    const question = 'Use $450 one-time $450 setup, plus $20.';
    const assumption = (sourceText: string): AnswerRequirement => ({
      kind: 'arithmetic',
      operation: 'add',
      operands: [
        { source: 'assumption', value: '450', unit: 'USD', sourceText },
        { source: 'assumption', value: '20', unit: 'USD', sourceText: '$20' },
      ],
    });
    const p = prepared(
      [
        ['first', assumption('$450 one-time')],
        ['second', assumption('one-time $450 setup')],
        ['same_second', assumption('$450 setup')],
      ],
      question,
    );
    const context: CompletionContext = { facts: [], evidence: [], bindings: [], chart, organizationId: org };
    const result = completeDeclaredArithmetic(p, context);
    expect(result.generatedCalculations).toHaveLength(3);
    const assumptions = result.evidence
      .flatMap((e) => e.rows)
      .flatMap((r) => (r.factRef?.kind === 'assumption' ? [r.factRef.assumptionId] : []));
    expect(assumptions).toHaveLength(3);
    const facts = result.facts.filter((f) => 'kind' in f);
    expect(facts[0].operands[0].id).not.toBe(facts[1].operands[0].id);
    expect(facts[1].operands[0].id).toBe(facts[2].operands[0].id);
    expect(finalizeAnswerContract(p, { ...context, ...result }).status).toBe('fulfilled');
  });
});
