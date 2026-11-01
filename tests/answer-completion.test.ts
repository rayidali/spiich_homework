import { describe, expect, it } from 'vitest';
import {
  prepareAnswerContract,
  finalizeAnswerContract,
  type CompletionContext,
  type PreparedAnswerContract,
} from '../server/answer-completion';
import type { AnswerContract, AnswerRequirement, OutputBinding } from '../server/answer-contract';
import {
  executeFinancialAnalysis,
  type AnalysisAccount,
  type AnalysisFacts,
  type FinancialQuery,
} from '../server/financial-analysis';
import { evaluateFinancialScenario, type FinancialScenario } from '../server/financial-calculation';
import type { Db } from '../server/db';
import type { ModelMessages } from '../server/ai-provider';

const org = '00000000-0000-4000-8000-000000000001';
const chart: AnalysisAccount[] = [
  {
    id: '00000000-0000-4000-8000-000000000002',
    code: '5030',
    name: 'Supplies',
    type: 'EXPENSE',
    currency: 'USD',
    is_cash: false,
    is_group: false,
    archived: false,
    parent_id: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    code: '5040',
    name: 'Rent',
    type: 'EXPENSE',
    currency: 'USD',
    is_cash: false,
    is_group: false,
    archived: true,
    parent_id: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    code: '1000',
    name: 'Bank',
    type: 'ASSET',
    currency: 'USD',
    is_cash: true,
    is_group: false,
    archived: false,
    parent_id: null,
  },
];
const q = (id: string, changes: Partial<FinancialQuery> = {}): FinancialQuery => ({
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
  ...changes,
});
const feb = q('feb', { from: '2026-02-01', to: '2026-02-28' });
const messages: ModelMessages = [
  { role: 'user', content: 'Show January and February expenses, their change, and relative change.' },
];
const descriptor = (plan: FinancialQuery) => {
  const { id: _id, ...rest } = plan;
  return rest as Omit<FinancialQuery, 'id'>;
};
const value = (plan: FinancialQuery): AnswerRequirement => {
  const { groupBy: _g, order: _o, limit: _l, ...scope } = descriptor(plan);
  return { kind: 'value', scope, counterpartyFrom: null } as AnswerRequirement;
};
const contract = (
  requirements: [string, AnswerRequirement][],
  text = messages[0].content,
): AnswerContract => ({
  outputs: requirements.map(([id, requirement]) => ({
    id,
    requirement,
    sourceQuotes: [{ messageIndex: 0, quote: text }],
  })),
});
const bind = (outputId: string, queryId = outputId, rowId = 'total:total'): OutputBinding => ({
  outputId,
  source: { kind: 'query_row', queryId, rowId },
});
const calcBind = (outputId: string, calculationId = outputId): OutputBinding => ({
  outputId,
  source: { kind: 'calculation', calculationId },
});
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
type Raw = {
  row_id: string;
  label: string;
  value: string | null;
  entry_count: string;
  period_from?: string;
  period_to?: string;
  dimensions?: unknown[];
};
const total = (value: string | null): Raw => ({
  row_id: 'total',
  label: 'Total',
  value,
  entry_count: value === null ? '0' : '2',
});
async function executed(plans: FinancialQuery[], results: Raw[][]) {
  let index = 0;
  const db = {
    query: async (sql: string) => {
      if (sql.startsWith('SET LOCAL')) return { rows: [] };
      if (sql.startsWith('SELECT id,code,name,type,currency')) return { rows: chart };
      if (sql.startsWith('WITH typed_input')) return { rows: results[index++] };
      throw new Error('Unexpected offline database statement');
    },
  } as unknown as Db;
  const result = await executeFinancialAnalysis(org, { queries: plans }, db);
  return {
    ...result,
    organizationId: org,
    chart,
    bindings: [] as OutputBinding[],
    resolveRowReference: undefined as CompletionContext['resolveRowReference'],
  } satisfies CompletionContext;
}
function finish(prepared: PreparedAnswerContract, context: CompletionContext, bindings: OutputBinding[]) {
  return finalizeAnswerContract(prepared, { ...context, bindings });
}
const scope = (requirements: [string, AnswerRequirement][], text = messages[0].content) =>
  prepareAnswerContract(contract(requirements, text), [{ role: 'user', content: text }]);
const qref = (id: string) => ({
  source: 'query' as const,
  id,
  rowId: 'total:total',
  field: 'value' as const,
});
async function fourDuties() {
  const january = q('jan');
  const base = await executed([january, feb], [[total('240')], [total('90')]]);
  const plan: FinancialScenario = {
    queries: [january, feb],
    assumptions: [],
    calculations: [
      { id: 'delta', operation: 'subtract', operands: [qref('feb'), qref('jan')] },
      {
        id: 'relative',
        operation: 'divide',
        operands: [{ source: 'calculation', id: 'delta', rowId: null, field: 'value' }, qref('jan')],
      },
    ],
  };
  const calculated = evaluateFinancialScenario(plan, base.facts, messages);
  const context = { ...base, facts: calculated.facts, evidence: [...base.evidence, ...calculated.evidence] };
  const prepared = scope([
    ['jan', value(january)],
    ['feb', value(feb)],
    ['delta', arithmetic('subtract', 'feb', 'jan')],
    ['relative', arithmetic('divide', 'delta', 'jan')],
  ]);
  const bindings = [bind('jan'), bind('feb'), calcBind('delta'), calcBind('relative')];
  return { prepared, context, bindings };
}

describe('Frozen original-user answer contracts', () => {
  it('resolves exact UTF-16 quote spans without trimming, and freezes independent copies', () => {
    const input = contract([['january', value(q('jan'))]], 'January');
    input.outputs[0].sourceQuotes[0].messageIndex = 1;
    const original: ModelMessages = [
      { role: 'assistant', content: 'January' },
      { role: 'user', content: '  😀 January, please. ' },
    ];
    const prepared = prepareAnswerContract(input, original);
    expect(prepared.resolvedSpans).toEqual([{ outputId: 'january', messageIndex: 1, start: 5, end: 12 }]);
    input.outputs[0].id = 'changed';
    original[1].content = 'changed';
    expect(prepared.contract.outputs[0].id).toBe('january');
    expect(prepared.originalMessages[1].content).toBe('  😀 January, please. ');
    expect(Object.isFrozen(prepared.contract.outputs[0].requirement)).toBe(true);
  });
  it.each(['assistant', 'repeated', 'not-exact'] as const)('refuses %s anchors', (variant) => {
    const input = contract([['jan', value(q('jan'))]], 'January');
    const original: ModelMessages = [
      {
        role: variant === 'assistant' ? 'assistant' : 'user',
        content: variant === 'repeated' ? 'January January' : variant === 'not-exact' ? 'january' : 'January',
      },
    ];
    expect(() => prepareAnswerContract(input, original)).toThrow(/quotation/);
  });
  it('refuses forward dependencies and duplicate output IDs before any read', () => {
    expect(() =>
      scope([
        ['delta', arithmetic('subtract', 'feb', 'jan')],
        ['jan', value(q('jan'))],
      ]),
    ).toThrow(/earlier/);
    expect(() =>
      scope([
        ['jan', value(q('jan'))],
        ['jan', value(q('jan'))],
      ]),
    ).toThrow(/unique/);
  });
  it('requires at most eight outputs and bounds serialized UTF-8 contract bytes', () => {
    expect(() => scope(Array.from({ length: 9 }, (_, i) => [`q${i}`, value(q('jan'))]))).toThrow(/schema/);
    const input = contract(
      Array.from({ length: 8 }, (_, i) => [`q${i}`, value(q('jan'))]),
      '😀'.repeat(250),
    );
    input.outputs.forEach(
      (o) =>
        (o.sourceQuotes = Array.from({ length: 3 }, () => ({ messageIndex: 0, quote: '😀'.repeat(250) }))),
    );
    expect(() => prepareAnswerContract(input, [{ role: 'user', content: '😀'.repeat(250) }])).toThrow(/size/);
  });
  it('also enforces the byte limit after schema defaults are materialized', () => {
    let input: AnswerContract | undefined;
    for (let size = 1; size <= 500; size++) {
      const candidate = contract(
        Array.from({ length: 8 }, (_, i) => [
          `q${i}`,
          value(q('jan', { descriptionSearch: 'a'.repeat(200) })),
        ]),
        'x'.repeat(size),
      );
      candidate.outputs.forEach(
        (o) =>
          (o.sourceQuotes = Array.from({ length: 3 }, () => ({ messageIndex: 0, quote: 'x'.repeat(size) }))),
      );
      const normalized = structuredClone(candidate);
      normalized.outputs.forEach((o) => {
        if (o.requirement.kind === 'value') o.requirement.selectedAccountCode = null;
      });
      if (
        Buffer.byteLength(JSON.stringify(candidate)) <= 16384 &&
        Buffer.byteLength(JSON.stringify(normalized)) > 16384
      ) {
        input = candidate;
        break;
      }
    }
    expect(input).toBeDefined();
    expect(() =>
      prepareAnswerContract(input, [{ role: 'user', content: input!.outputs[0].sourceQuotes[0].quote }]),
    ).toThrow(/normalized answer contract exceeds/);
  });
  it('does not treat obligation quotes as authorization for invented numerical assumptions', () => {
    const req: AnswerRequirement = {
      kind: 'arithmetic',
      operation: 'add',
      operands: [
        { source: 'assumption', value: '2', unit: 'USD', sourceText: '$2' },
        { source: 'assumption', value: '3', unit: 'USD', sourceText: '$3' },
      ],
    };
    expect(() => scope([['sum', req]], 'Add those amounts.')).toThrow(/original-user quantity/);
  });
  it('rejects deferred identity cycles, literal filters, and account identity deferral', () => {
    const selected: AnswerRequirement = {
      kind: 'selected_identity',
      query: { ...descriptor(q('discover')), groupBy: 'account', order: 'value_desc' } as never,
      tiePolicy: 'any_one',
    };
    const required = { ...value(q('jan')), counterpartyFrom: 'leader' } as AnswerRequirement;
    expect(() =>
      scope([
        ['leader', selected],
        ['jan', required],
      ]),
    ).toThrow(/earlier selected counterparty/);
  });
});

describe('Visible exact-source fulfillment', () => {
  it('fulfills four independent duties and binds ratio -0.625 without inventing percentage prose', async () => {
    const { prepared, context, bindings } = await fourDuties();
    const result = finish(prepared, context, bindings);
    expect(result).toMatchObject({
      status: 'fulfilled',
      completionBasis: 'model_declared',
      userIntentVerified: false,
    });
    expect(result.outputs).toHaveLength(4);
    expect(context.evidence.at(-1)?.rows.at(-1)?.value).toBe('-0.625 ratio');
    expect(result.outputs.every((o) => o.evidence.length > 0)).toBe(true);
  });
  it.each(['delta', 'relative'])(
    'missing %s stays a failed partial even when all other amounts are right',
    async (id) => {
      const { prepared, context, bindings } = await fourDuties();
      const result = finish(
        prepared,
        context,
        bindings.filter((b) => b.outputId !== id),
      );
      expect(result.status).toBe('partial');
      expect(result.outputs.find((o) => o.outputId === id)?.status).toBe('missing');
    },
  );
  it('a hidden correct calculation is not a visible completed answer', async () => {
    const { prepared, context, bindings } = await fourDuties();
    context.evidence = context.evidence.map((e) => ({
      ...e,
      rows: e.rows.filter((r) => r.factRef?.kind !== 'calculation' || r.factRef.calculationId !== 'delta'),
    }));
    expect(finish(prepared, context, bindings).outputs[2].status).toBe('missing');
  });
  it('table and row reordering uses additive fact references, not table positions', async () => {
    const { prepared, context, bindings } = await fourDuties();
    context.evidence.reverse();
    context.evidence.forEach((e) => e.rows.reverse());
    expect(finish(prepared, context, bindings).status).toBe('fulfilled');
  });
  it.each([
    { accountCodes: ['5040'] },
    { from: '2026-02-01', to: '2026-02-28' },
    { status: 'DRAFT' },
    { counterparty: { mode: 'exact', value: 'Acme' } },
    { descriptionSearch: 'paper' },
    { minimumAmount: '1' },
    { cooccurringAccountCodes: ['1000'] },
  ] as Partial<FinancialQuery>[])('equal dollars cannot launder changed scope %j', async (change) => {
    const context = await executed([q('jan', change)], [[total('240')]]);
    expect(finish(scope([['jan', value(q('jan'))]]), context, [bind('jan')]).outputs[0].status).toBe(
      'invalid',
    );
  });
  it('a monthly cell can fulfill the exact corresponding scalar period without requiring the same query ID', async () => {
    const monthly = q('series', { to: '2026-02-28', groupBy: 'month' });
    const context = await executed(
      [monthly],
      [
        [
          {
            ...total('240'),
            row_id: '2026-01',
            label: '2026-01',
            period_from: '2026-01-01',
            period_to: '2026-01-31',
          },
          {
            ...total('90'),
            row_id: '2026-02',
            label: '2026-02',
            period_from: '2026-02-01',
            period_to: '2026-02-28',
          },
        ],
      ],
    );
    const prepared = scope([
      ['jan', value(q('jan'))],
      ['feb', value(feb)],
    ]);
    expect(
      finish(prepared, context, [
        bind('jan', 'series', 'month:2026-01'),
        bind('feb', 'series', 'month:2026-02'),
      ]).status,
    ).toBe('fulfilled');
    context.facts[0].rows[1].from = '2026-01-01';
    expect(finish(prepared, context, [bind('jan', 'series', 'month:2026-01')]).outputs[0].status).toBe(
      'invalid',
    );
  });
  it('account grouping keeps actual posting identity, including archived accounts', async () => {
    const plan = q('by_account', { accountCodes: [], groupBy: 'account' });
    const context = await executed(
      [plan],
      [
        [
          { ...total('240'), row_id: chart[0].id, label: 'Supplies' },
          { ...total('90'), row_id: chart[1].id, label: 'Rent' },
        ],
      ],
    );
    expect(
      finish(scope([['rent', value(q('rent', { accountCodes: ['5040'] }))]]), context, [
        bind('rent', 'by_account', `account:${chart[1].id}`),
      ]).status,
    ).toBe('fulfilled');
  });
  it('does not infer a combined total by adding visible rows behind the contract', async () => {
    const context = await executed(
      [q('jan'), q('rent', { accountCodes: ['5040'] })],
      [[total('240')], [total('90')]],
    );
    const prepared = scope([['combined', value(q('combined', { accountCodes: ['5030', '5040'] }))]]);
    expect(finish(prepared, context, [bind('combined', 'jan')]).outputs[0].status).toBe('invalid');
    const combined = await executed([q('combined', { accountCodes: ['5030', '5040'] })], [[total('330')]]);
    expect(finish(prepared, combined, [bind('combined')]).status).toBe('fulfilled');
  });
  it('retains the original amount-threshold account scope when narrowing an account cell', async () => {
    // Broad transaction eligibility sums Supplies + Rent before grouping; the
    // same displayed Supplies amount cannot prove a Supplies-only threshold.
    const broad = q('broad', { accountCodes: [], groupBy: 'account', minimumAmount: '100' });
    const context = await executed([broad], [[{ ...total('240'), row_id: chart[0].id, label: 'Supplies' }]]);
    const narrow = scope([['supplies', value(q('narrow', { minimumAmount: '100' }))]]);
    expect(
      finish(narrow, context, [bind('supplies', 'broad', `account:${chart[0].id}`)]).outputs[0].status,
    ).toBe('invalid');
    const requested = {
      ...value(q('broad', { accountCodes: [], minimumAmount: '100' })),
      selectedAccountCode: '5030',
    } as AnswerRequirement;
    expect(
      finish(scope([['supplies', requested]]), context, [bind('supplies', 'broad', `account:${chart[0].id}`)])
        .status,
    ).toBe('fulfilled');
  });
  it('selects one cash account cell within the server-owned cash set without substituting all assets', async () => {
    const cash = q('cash', { metric: 'cash_balance', from: null, accountCodes: [], groupBy: 'account' });
    const context = await executed([cash], [[{ ...total('240'), row_id: chart[2].id, label: 'Bank' }]]);
    const required = {
      ...value({ ...cash, groupBy: 'total' }),
      selectedAccountCode: '1000',
    } as AnswerRequirement;
    expect(
      finish(scope([['bank', required]]), context, [bind('bank', 'cash', `account:${chart[2].id}`)]).status,
    ).toBe('fulfilled');
    const outside = { ...required, selectedAccountCode: '5030' } as AnswerRequirement;
    expect(
      finish(scope([['bank', outside]]), context, [bind('bank', 'cash', `account:${chart[2].id}`)]).outputs[0]
        .status,
    ).toBe('invalid');
    context.facts[0].scope.cashBalanceSource!.accounts[0].is_cash = false;
    expect(
      finish(scope([['bank', required]]), context, [bind('bank', 'cash', `account:${chart[2].id}`)])
        .outputs[0].status,
    ).toBe('invalid');
  });
  it('does not satisfy a cash stock duty using a coincidentally equal movement', async () => {
    const movement = q('movement', { metric: 'net_cash_movement', accountCodes: [] });
    const context = await executed([movement], [[total('240')]]);
    const balance = q('cash', { metric: 'cash_balance', from: null, accountCodes: [] });
    expect(
      finish(scope([['cash', value(balance)]]), context, [bind('cash', 'movement')]).outputs[0].status,
    ).toBe('invalid');
  });
  it('checks compound calendar/account keys against same-snapshot identities rather than display labels', async () => {
    const plan = q('compound', { to: '2026-02-28', accountCodes: [], groupBy: ['month', 'account'] });
    const dimensions = [
      { kind: 'month', key: '2026-02', label: 'Fake January' },
      { kind: 'account', key: '5040', label: 'Fake Supplies', accountId: chart[1].id },
    ];
    const context = await executed(
      [plan],
      [
        [
          {
            ...total('90'),
            row_id: 'ignored',
            label: 'Misleading label',
            period_from: '2026-02-01',
            period_to: '2026-02-28',
            dimensions,
          },
        ],
      ],
    );
    const rowId = context.facts[0].rows[0].rowId;
    const expected = value(q('rent', { accountCodes: ['5040'], from: '2026-02-01', to: '2026-02-28' }));
    expect(finish(scope([['rent', expected]]), context, [bind('rent', 'compound', rowId)]).status).toBe(
      'fulfilled',
    );
    context.facts[0].rows[0].dimensions![1].accountId = chart[0].id;
    expect(
      finish(scope([['rent', expected]]), context, [bind('rent', 'compound', rowId)]).outputs[0].status,
    ).toBe('invalid');
  });
  it('a legitimate no-transaction average is visibly fulfilled as absence, not manufactured zero', async () => {
    const average = q('average', { aggregation: 'average_per_entry' });
    const context = await executed([average], [[total(null)]]);
    expect(finish(scope([['average', value(average)]]), context, [bind('average')]).status).toBe('fulfilled');
    context.evidence[0].rows[0].value = '$0.00';
    expect(finish(scope([['average', value(average)]]), context, [bind('average')]).outputs[0].status).toBe(
      'invalid',
    );
  });
  it('legacy evidence without fact references cannot claim fulfillment', async () => {
    const context = await executed([q('jan')], [[total('240')]]);
    delete context.evidence[0].rows[0].factRef;
    expect(finish(scope([['jan', value(q('jan'))]]), context, [bind('jan')]).outputs[0].status).toBe(
      'missing',
    );
  });
  it('rejects foreign organization metadata and swapped displayed values', async () => {
    const { prepared, context, bindings } = await fourDuties();
    (context.facts[0] as AnalysisFacts).scope.organizationId = 'other';
    expect(finish(prepared, context, bindings).outputs[0].status).toBe('invalid');
    const fresh = await fourDuties();
    fresh.context.evidence[0].rows[0].value = '$90.00';
    expect(finish(fresh.prepared, fresh.context, fresh.bindings).outputs[0].status).toBe('invalid');
  });
  it('rejects unknown output bindings, duplicate bindings, and a changed frozen contract', async () => {
    const { prepared, context, bindings } = await fourDuties();
    expect(() => finish(prepared, context, [...bindings, bind('unknown')])).toThrow(/unique declared/);
    expect(() => finish(prepared, context, [bindings[0], bindings[0]])).toThrow(/unique declared/);
    const changed = structuredClone(prepared);
    changed.contract.outputs.pop();
    expect(() => finish(changed, context, [])).toThrow(/changed/);
  });
  it('always retains the unverified-intent caveat even if the model omitted a user duty from its initial contract', async () => {
    const context = await executed([q('jan')], [[total('240')]]);
    const result = finish(scope([['jan', value(q('jan'))]]), context, [bind('jan')]);
    expect(result.status).toBe('fulfilled');
    expect(result.userIntentVerified).toBe(false);
  });
});

describe('Table coverage, selected identities and dynamic row handles', () => {
  const ranked = q('vendors', { groupBy: 'counterparty', order: 'value_desc', limit: 2 });
  const raw = [
    { ...total('240'), row_id: 'Acme', label: 'Acme' },
    { ...total('90'), row_id: 'acme', label: 'acme' },
  ];
  const table = (coverage: 'all' | 'top'): AnswerRequirement => ({
    kind: 'table',
    query: descriptor(ranked) as never,
    coverage,
    counterpartyFrom: null,
  });
  const leader = (tiePolicy: 'unique' | 'any_one'): AnswerRequirement => ({
    kind: 'selected_identity',
    query: descriptor(ranked) as never,
    tiePolicy,
  });
  it('allows a requested top table but never calls the same truncated result complete', async () => {
    const context = await executed([ranked], [[...raw, { ...total('10'), row_id: 'Other', label: 'Other' }]]);
    const binding: OutputBinding = {
      outputId: 'vendors',
      source: { kind: 'query_result', queryId: 'vendors' },
    };
    expect(finish(scope([['vendors', table('top')]]), context, [binding]).status).toBe('fulfilled');
    expect(finish(scope([['vendors', table('all')]]), context, [binding]).outputs[0].status).toBe('missing');
  });
  it('an empty complete table is visible via factSource with no invented row', async () => {
    const context = await executed([ranked], [[]]);
    const result = finish(scope([['vendors', table('all')]]), context, [
      { outputId: 'vendors', source: { kind: 'query_result', queryId: 'vendors' } },
    ]);
    expect(result.status).toBe('fulfilled');
    expect(result.outputs[0].evidence).toEqual([{ tableIndex: 0 }]);
  });
  it('selected identity requires the ranked first row and exact case-sensitive source key', async () => {
    const context = await executed([ranked], [raw]);
    const prepared = scope([['leader', leader('unique')]]);
    expect(finish(prepared, context, [bind('leader', 'vendors', 'counterparty:Acme')]).status).toBe(
      'fulfilled',
    );
    expect(
      finish(prepared, context, [bind('leader', 'vendors', 'counterparty:acme')]).outputs[0].status,
    ).toBe('invalid');
  });
  it('a tie or truncated single row cannot prove uniqueness, but explicit any_one is narrower', async () => {
    const context = await executed([ranked], [[raw[0], { ...raw[1], value: '240' }]]);
    expect(
      finish(scope([['leader', leader('unique')]]), context, [bind('leader', 'vendors', 'counterparty:Acme')])
        .outputs[0].status,
    ).toBe('unsupported');
    expect(
      finish(scope([['leader', leader('any_one')]]), context, [
        bind('leader', 'vendors', 'counterparty:Acme'),
      ]).status,
    ).toBe('fulfilled');
    const one = q('vendors', { groupBy: 'counterparty', order: 'value_desc', limit: 1 });
    const limited = await executed([one], [raw]);
    const req = { ...leader('unique'), query: descriptor(one) } as AnswerRequirement;
    expect(
      finish(scope([['leader', req]]), limited, [bind('leader', 'vendors', 'counterparty:Acme')]).outputs[0]
        .status,
    ).toBe('unsupported');
  });
  it('does not accept a nonmonotonic ranked result as an observed leader', async () => {
    const context = await executed([ranked], [raw]);
    context.facts[0].rows.reverse();
    expect(
      finish(scope([['leader', leader('any_one')]]), context, [
        bind('leader', 'vendors', 'counterparty:acme'),
      ]).outputs[0].status,
    ).toBe('invalid');
  });
  it('row handles resolve only within the exact query/session; wrong references fail', async () => {
    const context = await executed([ranked], [raw]);
    context.resolveRowReference = (queryId, rowId) => {
      if (queryId === 'vendors' && rowId === 'r_session_1') return 'counterparty:Acme';
      throw new Error('Wrong session');
    };
    const prepared = scope([['leader', leader('unique')]]);
    expect(finish(prepared, context, [bind('leader', 'vendors', 'r_session_1')]).status).toBe('fulfilled');
    expect(finish(prepared, context, [bind('leader', 'vendors', 'r_other_1')]).outputs[0].status).toBe(
      'invalid',
    );
  });
  it('a discovered exact identity cannot be replaced by a case-folded copied-name filter', async () => {
    const discovery = await executed([ranked], [raw]);
    const follow = await executed(
      [q('follow', { counterparty: { mode: 'exact', value: 'Acme' } })],
      [[total('240')]],
    );
    const context = {
      ...discovery,
      facts: [...discovery.facts, ...follow.facts],
      evidence: [...discovery.evidence, ...follow.evidence],
    };
    const required = { ...value(q('follow')), counterpartyFrom: 'leader' } as AnswerRequirement;
    const prepared = scope([
      ['leader', leader('unique')],
      ['follow', required],
    ]);
    expect(
      finish(prepared, context, [bind('leader', 'vendors', 'counterparty:Acme'), bind('follow')]).outputs[1]
        .status,
    ).toBe('invalid');
    const fact = context.facts[1];
    fact.scope.plan.counterparty = { mode: 'identity', value: 'Acme' };
    fact.scope.counterpartyIdentity = { queryId: 'vendors', rowId: 'counterparty:Acme', key: 'Acme' };
    expect(
      finish(prepared, context, [bind('leader', 'vendors', 'counterparty:Acme'), bind('follow')]).status,
    ).toBe('fulfilled');
  });
});

describe('Ordered arithmetic, assumptions and calendar provenance', () => {
  it('does not confuse incidental one-time wording with two distinct equal-dollar quantity occurrences', () => {
    const text = 'Use $450 one-time $450 setup, plus $20.';
    const req: AnswerRequirement = {
      kind: 'arithmetic',
      operation: 'add',
      operands: [
        { source: 'assumption', value: '450', unit: 'USD', sourceText: '$450 one-time' },
        { source: 'assumption', value: '20', unit: 'USD', sourceText: '$20' },
      ],
    };
    const result = evaluateFinancialScenario(
      {
        queries: [],
        assumptions: [
          { id: 'setup', value: '450', unit: 'USD', sourceText: 'one-time $450 setup' },
          { id: 'other', value: '20', unit: 'USD', sourceText: '$20' },
        ],
        calculations: [
          {
            id: 'sum',
            operation: 'add',
            operands: [
              { source: 'assumption', id: 'setup', rowId: null, field: 'value' },
              { source: 'assumption', id: 'other', rowId: null, field: 'value' },
            ],
          },
        ],
      },
      [],
      [{ role: 'user', content: text }],
    );
    expect(
      finish(scope([['sum', req]], text), { ...result, chart, organizationId: org, bindings: [] }, [
        calcBind('sum'),
      ]).outputs[0].status,
    ).toBe('invalid');
  });
  it('rejects reversed subtraction even if another displayed amount is equal', async () => {
    const { prepared, context, bindings } = await fourDuties();
    const modified = structuredClone(prepared.contract);
    (
      modified.outputs[2].requirement as Extract<AnswerRequirement, { kind: 'arithmetic' }>
    ).operands.reverse();
    const expected = prepareAnswerContract(modified, messages);
    expect(finish(expected, context, bindings).outputs[2].status).toBe('invalid');
  });
  it('rejects altered exact arithmetic facts before using their displayed value', async () => {
    const { prepared, context, bindings } = await fourDuties();
    const calculation = context.facts.find((f) => 'kind' in f && f.id === 'delta');
    if (!calculation || !('kind' in calculation)) throw new Error('Fixture missing calculation');
    calculation.exact.numerator = '999';
    expect(finish(prepared, context, bindings).outputs[2].status).toBe('invalid');
  });
  it('accepts harmless overlapping assumption quote boundaries while retaining original quantity identity', () => {
    const text = 'Add one-time $450 setup and $2 supplies.';
    const req: AnswerRequirement = {
      kind: 'arithmetic',
      operation: 'add',
      operands: [
        { source: 'assumption', value: '450', unit: 'USD', sourceText: '$450 setup' },
        { source: 'assumption', value: '2', unit: 'USD', sourceText: '$2 supplies' },
      ],
    };
    const prepared = scope([['sum', req]], text);
    const result = evaluateFinancialScenario(
      {
        queries: [],
        assumptions: [
          { id: 'setup', value: '450', unit: 'USD', sourceText: 'one-time $450' },
          { id: 'supplies', value: '2', unit: 'USD', sourceText: '$2' },
        ],
        calculations: [
          {
            id: 'sum',
            operation: 'add',
            operands: [
              { source: 'assumption', id: 'setup', rowId: null, field: 'value' },
              { source: 'assumption', id: 'supplies', rowId: null, field: 'value' },
            ],
          },
        ],
      },
      [],
      [{ role: 'user', content: text }],
    );
    expect(
      finish(prepared, { ...result, chart, organizationId: org, bindings: [] }, [calcBind('sum')]).status,
    ).toBe('fulfilled');
  });
  it('does not equate distinct same-dollar assumptions from different original occurrences', () => {
    const text = 'Add $2 setup and $2 supplies.';
    const req: AnswerRequirement = {
      kind: 'arithmetic',
      operation: 'add',
      operands: [
        { source: 'assumption', value: '2', unit: 'USD', sourceText: '$2 setup' },
        { source: 'assumption', value: '2', unit: 'USD', sourceText: '$2 setup' },
      ],
    };
    const result = evaluateFinancialScenario(
      {
        queries: [],
        assumptions: [
          { id: 'setup', value: '2', unit: 'USD', sourceText: '$2 setup' },
          { id: 'supplies', value: '2', unit: 'USD', sourceText: '$2 supplies' },
        ],
        calculations: [
          {
            id: 'sum',
            operation: 'add',
            operands: [
              { source: 'assumption', id: 'setup', rowId: null, field: 'value' },
              { source: 'assumption', id: 'supplies', rowId: null, field: 'value' },
            ],
          },
        ],
      },
      [],
      [{ role: 'user', content: text }],
    );
    expect(
      finish(scope([['sum', req]], text), { ...result, chart, organizationId: org, bindings: [] }, [
        calcBind('sum'),
      ]).outputs[0].status,
    ).toBe('invalid');
  });
  it('matches month_count only from the same complete monthly flow and validates its actual calendar coverage', async () => {
    const monthly = q('months', { to: '2026-02-28', groupBy: 'month' });
    const sum = q('sum', { to: '2026-02-28' });
    const base = await executed(
      [sum, monthly],
      [
        [total('330')],
        [
          {
            ...total('240'),
            row_id: '2026-01',
            label: 'January',
            period_from: '2026-01-01',
            period_to: '2026-01-31',
          },
          {
            ...total('90'),
            row_id: '2026-02',
            label: 'February',
            period_from: '2026-02-01',
            period_to: '2026-02-28',
          },
        ],
      ],
    );
    const calculated = evaluateFinancialScenario(
      {
        queries: [sum, monthly],
        assumptions: [],
        calculations: [
          {
            id: 'average',
            operation: 'divide',
            operands: [qref('sum'), { source: 'query', id: 'months', rowId: null, field: 'month_count' }],
          },
        ],
      },
      base.facts,
      messages,
    );
    const req: AnswerRequirement = {
      kind: 'arithmetic',
      operation: 'divide',
      operands: [
        { source: 'output', id: 'sum' },
        { source: 'month_count', query: descriptor(monthly) as never },
      ],
    };
    const prepared = scope([
      ['sum', value(sum)],
      ['average', req],
    ]);
    const context = {
      ...base,
      facts: calculated.facts,
      evidence: [...base.evidence, ...calculated.evidence],
    };
    expect(finish(prepared, context, [bind('sum'), calcBind('average')]).status).toBe('fulfilled');
    (context.facts[1] as AnalysisFacts).rows.pop();
    expect(finish(prepared, context, [bind('sum'), calcBind('average')]).outputs[1].status).toBe('invalid');
  });
});
