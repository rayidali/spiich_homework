import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ chart: vi.fn(), analysis: vi.fn(), snapshot: vi.fn() }));
vi.mock('../server/financial-analysis', async (original) => ({
  ...(await original<typeof import('../server/financial-analysis')>()),
  financialAnalysisChart: db.chart,
  executeFinancialAnalysis: db.analysis,
}));
vi.mock('../server/reports', async (original) => ({
  ...(await original<typeof import('../server/reports')>()),
  expenseAccountChart: db.chart,
  reportSnapshot: db.snapshot,
  today: () => '2026-10-31',
}));

import { financialChat, getFinancialChatFailureMetadata } from '../server/ai';
import { config } from '../server/config';
import { getAiUsage, resetAiUsage, setAiBudget, type ModelMessages } from '../server/ai-provider';
import { answerContractSchema, type AnswerContract, type OutputBinding } from '../server/answer-contract';
import type {
  AnalysisAccount,
  AnalysisFacts,
  FinancialAnalysisOptions,
  FinancialQuery,
} from '../server/financial-analysis';
import type { InsightEvidence } from '../shared/financial-evidence';
import { formatCurrency } from '../shared/money';

const org = '00000000-0000-4000-8000-000000000001';
const supplies: AnalysisAccount = {
  id: '00000000-0000-4000-8000-000000000002',
  code: '5030',
  name: 'Office supplies',
  type: 'EXPENSE',
  currency: 'USD',
  parent_id: null,
  is_group: false,
  is_cash: false,
  archived: false,
};
const rent: AnalysisAccount = {
  ...supplies,
  id: '00000000-0000-4000-8000-000000000003',
  code: '6100',
  name: 'Rent',
};
const chart = [supplies, rent];
const messages: ModelMessages = [
  {
    role: 'user',
    content:
      'Show Office supplies spending in January 2026 and February 2026, then the dollar change from January to February.',
  },
];
const saved = { aiProvider: config.aiProvider, aiModel: config.aiModel, aiKey: config.aiKey };
const savedRoute = process.env.FINANCIAL_CHAT_ROUTE;
const fetchMock = vi.fn();
const usage = {
  promptTokenCount: 100,
  candidatesTokenCount: 20,
  thoughtsTokenCount: 10,
  totalTokenCount: 130,
};
const january = () => query('january', '2026-01-01', '2026-01-31');
const february = () => query('february', '2026-02-01', '2026-02-28');
function query(id: string, from: string, to: string): FinancialQuery {
  return {
    id,
    metric: 'net_expense',
    aggregation: 'sum',
    from,
    to,
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
  };
}
function scope(plan: FinancialQuery) {
  const { id: _id, groupBy: _group, order: _order, limit: _limit, ...value } = plan;
  return value;
}
function contract(delta = true): AnswerContract {
  return answerContractSchema.parse({
    outputs: [
      {
        id: 'january',
        sourceQuotes: [{ messageIndex: 0, quote: 'January 2026' }],
        requirement: { kind: 'value', scope: scope(january()), counterpartyFrom: null },
      },
      {
        id: 'february',
        sourceQuotes: [{ messageIndex: 0, quote: 'February 2026' }],
        requirement: { kind: 'value', scope: scope(february()), counterpartyFrom: null },
      },
      ...(delta
        ? [
            {
              id: 'delta',
              sourceQuotes: [{ messageIndex: 0, quote: 'dollar change from January to February' }],
              requirement: {
                kind: 'arithmetic',
                operation: 'subtract',
                operands: [
                  { source: 'output', id: 'february' },
                  { source: 'output', id: 'january' },
                ],
              },
            },
          ]
        : []),
    ],
  });
}
function bindings(delta = false): OutputBinding[] {
  return [
    { outputId: 'january', source: { kind: 'query_row', queryId: 'january', rowId: 'total:total' } },
    { outputId: 'february', source: { kind: 'query_row', queryId: 'february', rowId: 'total:total' } },
    ...(delta
      ? [{ outputId: 'delta', source: { kind: 'calculation' as const, calculationId: 'difference' } }]
      : []),
  ];
}
const calculation = () => ({
  assumptions: [],
  calculations: [
    {
      id: 'difference',
      operation: 'subtract',
      operands: [
        { source: 'query', id: 'february', rowId: 'total:total', field: 'value' },
        { source: 'query', id: 'january', rowId: 'total:total', field: 'value' },
      ],
    },
  ],
});
function result(
  queries: FinancialQuery[],
  options: FinancialAnalysisOptions = {},
  change: { label?: string; januaryValue?: string } = {},
) {
  options.onExecutionChart?.(structuredClone(chart));
  const facts: AnalysisFacts[] = queries.map((plan) => ({
    queryId: plan.id,
    metric: plan.metric,
    aggregation: plan.aggregation,
    grain: plan.groupBy,
    unit: 'USD',
    currency: 'USD',
    truncated: false,
    rows: [
      {
        rowId: 'total:total',
        label: change.label ?? 'Total',
        value: plan.from === '2026-01-01' ? (change.januaryValue ?? '240.00') : '90.00',
        entryCount: '1',
        from: plan.from,
        to: plan.to,
      },
    ],
    scope: {
      organizationId: org,
      plan: structuredClone(plan),
      resolvedAccountIds: chart
        .filter((a) => !plan.accountCodes.length || plan.accountCodes.includes(a.code))
        .map((a) => a.id),
      cooccurringAccountIds: [],
      amountBasis: 'selected_metric_base_lines',
      statusMeaning: 'booked',
    },
  }));
  const evidence: InsightEvidence[] = facts.map((fact) => ({
    title: 'Recorded expenses',
    period: `${fact.scope.plan.from} → ${fact.scope.plan.to}`,
    source: 'posted',
    href: '/reports',
    factSource: { kind: 'query_result', queryId: fact.queryId, truncated: false },
    rows: fact.rows.map((row) => ({
      label: row.label,
      value: formatCurrency(row.value!, 'USD'),
      factRef: { kind: 'query_row', queryId: fact.queryId, rowId: row.rowId },
    })),
  }));
  return { answer: 'Recorded amounts from the requested periods.', facts, evidence };
}
function response(name: string, args: unknown, reported: unknown = usage) {
  return new Response(
    JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name, args } }] } }],
      modelVersion: 'gemini-3.5-flash-lite',
      ...(reported === null ? {} : { usageMetadata: reported }),
    }),
    { status: 200 },
  );
}
const initial = (requested = contract(), queries = [january(), february()], reported: unknown = usage) =>
  response('inspect_financial_data', { queries, answerContract: requested, outputBindings: [] }, reported);
const show = (outputBindings = bindings()) => response('show_inspected_results', { outputBindings });
const direct = (requested = contract(false), queries = [january(), february()]) =>
  response('financial_analysis', { queries, answerContract: requested, outputBindings: bindings() });
const compactArgs = () => ({
  mode: 'analysis',
  queries: [january(), february()],
  assumptions: [],
  calculations: [],
  outputs: contract().outputs,
  bindings: bindings(),
});
const ask = () =>
  response('request_details', {
    reason: 'off_topic',
    subject: 'analysis',
    accountCodes: [],
    limitation: 'none',
  });
const invoke = (conversation = messages) => financialChat(org, conversation, { route: 'complete' });
function bodies() {
  return fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options.body)));
}
function feedback(body: ReturnType<typeof bodies>[number]) {
  return JSON.parse(body.contents.at(-1).parts[0].text);
}
async function caught() {
  try {
    return { value: await invoke(), error: undefined };
  } catch (error) {
    return { value: undefined, error };
  }
}
const metadata = (outcome: Awaited<ReturnType<typeof caught>>) =>
  outcome.value?.ai ?? getFinancialChatFailureMetadata(outcome.error);
const completion = (value: unknown) =>
  (
    value as {
      completion?: {
        status: string;
        completionBasis: string;
        userIntentVerified: boolean;
        outputs: { id?: string; outputId?: string; status: string }[];
      };
    }
  ).completion;
function assertWithheld(outcome: Awaited<ReturnType<typeof caught>>) {
  expect(outcome.value?.evidence ?? []).toEqual([]);
  expect(completion(outcome.value ?? {})?.status).not.toBe('fulfilled');
}

function assertVisibleLocators(value: unknown) {
  const answer = value as {
    evidence: InsightEvidence[];
    outputBindings: OutputBinding[];
    completion: {
      outputs: { outputId: string; status: string; evidence: { tableIndex: number; rowIndex?: number }[] }[];
    };
  };
  expect(answer.evidence[0].title).toMatch(/^Requested result/);
  for (const output of answer.completion.outputs.filter((item) => item.status === 'fulfilled')) {
    expect(output.evidence.length).toBeGreaterThan(0);
    for (const locator of output.evidence) {
      const table = answer.evidence[locator.tableIndex];
      expect(table).toBeDefined();
      expect(table.source).toBe('posted');
      const row = table.rows[locator.rowIndex!];
      expect(row).toBeDefined();
      expect(row.factRef).toEqual(
        output.outputId === 'delta'
          ? {
              kind: 'calculation',
              calculationId: (
                answer.outputBindings.find((binding) => binding.outputId === 'delta')!.source as {
                  calculationId: string;
                }
              ).calculationId,
            }
          : { kind: 'query_row', queryId: output.outputId, rowId: 'total:total' },
      );
      expect(row.value).toContain(
        output.outputId === 'january' ? '240.00' : output.outputId === 'february' ? '90.00' : '150.00',
      );
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(config, {
    aiProvider: 'gemini',
    aiModel: 'gemini-3.5-flash-lite',
    aiKey: 'COMPLETE_TEST_KEY_NOT_REAL',
  });
  delete process.env.FINANCIAL_CHAT_ROUTE;
  setAiBudget(null);
  resetAiUsage();
  db.chart.mockResolvedValue(structuredClone(chart));
  db.snapshot.mockImplementation(async (read: (snapshot: unknown) => unknown) => read({ query: vi.fn() }));
  db.analysis.mockImplementation(
    async (
      _org: string,
      input: { queries: FinancialQuery[] },
      _snapshot: unknown,
      options: FinancialAnalysisOptions = {},
    ) => result(input.queries, options),
  );
});
afterEach(() => {
  Object.assign(config, saved);
  if (savedRoute === undefined) delete process.env.FINANCIAL_CHAT_ROUTE;
  else process.env.FINANCIAL_CHAT_ROUTE = savedRoute;
  setAiBudget(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Completion-required chat with real execution boundaries and scripted HTTP/ledger', () => {
  it('finalizes direct query values using the execution chart and excludes legacy numeric bypasses', async () => {
    fetchMock.mockResolvedValueOnce(direct());
    const value = await invoke();
    expect(completion(value)).toMatchObject({
      status: 'fulfilled',
      completionBasis: 'model_declared',
      userIntentVerified: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(db.analysis.mock.calls[0][3].onExecutionChart).toBeTypeOf('function');
    const names = bodies()[0].tools.flatMap((x: { functionDeclarations: { name: string }[] }) =>
      x.functionDeclarations.map((t) => t.name),
    );
    expect(names.sort()).toEqual(['plan_complete_answer', 'request_details']);
  });
  it('maps compact syntax before the unchanged declared arithmetic and source checks', async () => {
    fetchMock.mockResolvedValueOnce(response('plan_complete_answer', compactArgs()));
    const value = await invoke();
    expect(completion(value)).toMatchObject({ status: 'fulfilled', userIntentVerified: false });
    expect(value).toMatchObject({ generatedCalculations: [{ outputId: 'delta' }] });
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(value.evidence)).toContain('-$150.00 USD');
  });
  it('retains the existing single schema repair and reads no amounts for an invalid compact envelope', async () => {
    const malformed = { ...compactArgs(), type: 'OBJECT' };
    fetchMock
      .mockResolvedValueOnce(response('plan_complete_answer', malformed))
      .mockImplementationOnce(async () => {
        expect(db.analysis).not.toHaveBeenCalled();
        return response('plan_complete_answer', compactArgs());
      });
    const value = await invoke();
    expect(completion(value)?.status).toBe('fulfilled');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(bodies()[1].contents.at(-1).parts[0].text).toContain('untrusted_schema_repair_data');
  });
  it('never strips repeated compact annotations to obtain a financial read', async () => {
    fetchMock.mockImplementation(async () =>
      response('plan_complete_answer', { ...compactArgs(), type: 'OBJECT' }),
    );
    await expect(invoke()).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.analysis).not.toHaveBeenCalled();
  });
  it('rejects a structurally valid compact declaration with a false original-user anchor before reading amounts', async () => {
    const args = compactArgs();
    args.outputs[0].sourceQuotes[0].messageIndex = 1;
    fetchMock.mockResolvedValueOnce(response('plan_complete_answer', args));
    await expect(invoke()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.analysis).not.toHaveBeenCalled();
  });
  it('withholds query results when the executor omits its snapshot chart callback', async () => {
    fetchMock.mockResolvedValueOnce(direct());
    db.analysis.mockImplementationOnce(async (_org: string, input: { queries: FinancialQuery[] }) =>
      result(input.queries),
    );
    const value = await invoke();
    expect(value).toMatchObject({ facts: [], evidence: [], completion: { status: 'unassessed' } });
    expect(completion(value)?.outputs.every((output) => output.status === 'unsupported')).toBe(true);
    expect(db.chart).toHaveBeenCalledTimes(1);
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('finalizes a direct scenario using real exact arithmetic and shows all three declared outputs', async () => {
    fetchMock.mockResolvedValueOnce(
      response('financial_scenario', {
        queries: [january(), february()],
        ...calculation(),
        answerContract: contract(),
        outputBindings: bindings(true),
      }),
    );
    const value = await invoke();
    expect(completion(value)?.status).toBe('fulfilled');
    expect(completion(value)?.outputs).toHaveLength(3);
    expect(JSON.stringify(value.evidence)).toContain('150.00');
    assertVisibleLocators(value);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('retains separate recorded and hypothetical sources on requested rows and their final evidence links', async () => {
    const text = 'Show January 2026 Office supplies spending and add a $20 adjustment.';
    const assumption = { value: '20', unit: 'USD', sourceText: '$20 adjustment' };
    const requested = answerContractSchema.parse({
      outputs: [
        contract(false).outputs[0],
        {
          id: 'adjusted',
          sourceQuotes: [{ messageIndex: 0, quote: 'add a $20 adjustment' }],
          requirement: {
            kind: 'arithmetic',
            operation: 'add',
            operands: [
              { source: 'output', id: 'january' },
              { source: 'assumption', ...assumption },
            ],
          },
        },
      ],
    });
    fetchMock.mockResolvedValueOnce(
      response('financial_scenario', {
        queries: [january()],
        assumptions: [{ id: 'adjustment', ...assumption }],
        calculations: [
          {
            id: 'adjusted',
            operation: 'add',
            operands: [
              { source: 'query', id: 'january', rowId: 'total:total', field: 'value' },
              { source: 'assumption', id: 'adjustment', rowId: null, field: 'value' },
            ],
          },
        ],
        answerContract: requested,
        outputBindings: [
          bindings()[0],
          { outputId: 'adjusted', source: { kind: 'calculation', calculationId: 'adjusted' } },
        ],
      }),
    );
    const value = await invoke([{ role: 'user', content: text }]);
    expect(completion(value)?.status).toBe('fulfilled');
    expect(value.evidence.slice(0, 2).map((table) => table.source)).toEqual(['posted', 'scenario']);
    expect(value.evidence[0].rows[0]).toMatchObject({
      value: '$240.00',
      factRef: { kind: 'query_row', queryId: 'january', rowId: 'total:total' },
    });
    expect(value.evidence[1].rows[0]).toMatchObject({
      value: '$260.00 USD',
      factRef: { kind: 'calculation', calculationId: 'adjusted' },
    });
    const assessed = value as typeof value & {
      completion: {
        outputs: {
          outputId: string;
          evidence: { tableIndex: number; rowIndex?: number }[];
        }[];
      };
    };
    const [location] = assessed.completion.outputs.find((output) => output.outputId === 'adjusted')!.evidence;
    expect(value.evidence[location.tableIndex].source).toBe('scenario');
    expect(value.evidence[location.tableIndex].rows[location.rowIndex!].factRef).toEqual({
      kind: 'calculation',
      calculationId: 'adjusted',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('freezes the initial declaration before amount reads and binds inspected handles to canonical results', async () => {
    const declared = contract(false);
    db.analysis.mockImplementationOnce(
      async (
        _org: string,
        input: { queries: FinancialQuery[] },
        _snapshot: unknown,
        options: FinancialAnalysisOptions,
      ) => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(bodies()[0].tools[0].functionDeclarations[0].parametersJsonSchema.required).toContain(
          'outputs',
        );
        return result(input.queries, options);
      },
    );
    fetchMock.mockResolvedValueOnce(initial(declared)).mockImplementationOnce(async (_url, options) => {
      const data = feedback(JSON.parse(options.body));
      expect(data.answerContract).toEqual(declared);
      const bound = bindings().map((binding) => ({
        ...binding,
        source: {
          ...binding.source,
          rowId: data.inspection.facts.find(
            (f: AnalysisFacts) => f.queryId === (binding.source as { queryId: string }).queryId,
          ).rows[0].rowId,
        },
      }));
      expect(bound.every((binding) => binding.source.rowId.startsWith('r_'))).toBe(true);
      return show(bound as OutputBinding[]);
    });
    const value = await invoke();
    expect(completion(value)?.status).toBe('fulfilled');
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(value.evidence)).toContain('total:total');
  });
  it('finishes the declared missing delta with no extra provider call or database read', async () => {
    fetchMock.mockResolvedValueOnce(direct(contract()));
    const value = await invoke();
    expect(completion(value)?.status).toBe('fulfilled');
    expect(completion(value)?.outputs.filter((output) => output.status === 'fulfilled')).toHaveLength(3);
    expect(JSON.stringify(value.evidence)).toContain('240.00');
    expect(JSON.stringify(value.evidence)).toContain('90.00');
    expect(JSON.stringify(value.evidence)).toContain('-$150.00 USD');
    assertVisibleLocators(value);
    expect(value).not.toHaveProperty('limitation');
    expect(value).toMatchObject({
      modelOutputBindings: bindings(),
      generatedCalculations: [{ outputId: 'delta', calculationId: expect.any(String) }],
    });
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(value.ai.attempts).toBe(1);
    const event = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => JSON.parse(String(line)))
      .find((line) => line.event === 'ai_answer_completion');
    expect(event).toMatchObject({ completionStatus: 'fulfilled', generatedCalculationCount: 1 });
  });
  it('finishes a declared difference and relative change in dependency order', async () => {
    const conversation = [
      { role: 'user' as const, content: messages[0].content + ' Also show the relative change.' },
    ];
    const requested = contract();
    requested.outputs.push({
      id: 'relative',
      sourceQuotes: [{ messageIndex: 0, quote: 'relative change' }],
      requirement: {
        kind: 'arithmetic',
        operation: 'divide',
        operands: [
          { source: 'output', id: 'delta' },
          { source: 'output', id: 'january' },
        ],
      },
    });
    fetchMock.mockResolvedValueOnce(direct(requested));
    const value = await invoke(conversation);
    expect(completion(value)?.status).toBe('fulfilled');
    expect(value).toMatchObject({
      modelOutputBindings: bindings(),
      generatedCalculations: [
        { outputId: 'delta', calculationId: expect.any(String) },
        { outputId: 'relative', calculationId: expect.any(String) },
      ],
    });
    const facts = (value as unknown as { facts: Record<string, unknown>[] }).facts;
    expect(facts.slice(-2)).toMatchObject([
      { value: '-150.00', exact: { numerator: '-150', denominator: '1' }, source: 'posted' },
      { value: '-0.625', exact: { numerator: '-5', denominator: '8' }, source: 'posted' },
    ]);
    expect(value.evidence.slice(0, 4).map((table) => table.rows[0].value)).toEqual([
      '$240.00',
      '$90.00',
      '-$150.00 USD',
      '-0.625 ratio',
    ]);
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('completes from inspected handles without another read or model continuation', async () => {
    fetchMock.mockResolvedValueOnce(initial()).mockImplementationOnce(async () => {
      const data = feedback(bodies()[1]);
      const bound = bindings().map((binding) => ({
        ...binding,
        source: {
          ...binding.source,
          rowId: data.inspection.facts.find(
            (fact: AnalysisFacts) => fact.queryId === (binding.source as { queryId: string }).queryId,
          ).rows[0].rowId,
        },
      }));
      expect(bound.every((binding) => binding.source.rowId.startsWith('r_'))).toBe(true);
      return show(bound as OutputBinding[]);
    });
    const value = await invoke();
    expect(completion(value)?.status).toBe('fulfilled');
    assertVisibleLocators(value);
    expect(value).toMatchObject({ generatedCalculations: [{ outputId: 'delta' }] });
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(value.ai.attempts).toBe(2);
  });
  it('keeps missing input bindings partial instead of guessing a source from available amounts', async () => {
    fetchMock.mockResolvedValueOnce(
      response('financial_analysis', {
        queries: [january(), february()],
        answerContract: contract(),
        outputBindings: bindings().slice(0, 1),
      }),
    );
    const value = await invoke();
    expect(completion(value)?.status).toBe('partial');
    expect(completion(value)?.outputs.map((output) => output.status)).toEqual([
      'fulfilled',
      'missing',
      'missing',
    ]);
    expect(value).not.toHaveProperty('generatedCalculations');
    expect(value).toMatchObject({ limitation: { code: 'ANSWER_INCOMPLETE' } });
    expect(JSON.stringify(value.evidence)).not.toContain('-$150');
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not repair a supplied binding to a nonexistent calculation', async () => {
    fetchMock.mockResolvedValueOnce(
      response('financial_analysis', {
        queries: [january(), february()],
        answerContract: contract(),
        outputBindings: bindings(true),
      }),
    );
    const outcome = await caught();
    assertWithheld(outcome);
    expect(outcome.value).toMatchObject({
      facts: [],
      evidence: [],
      limitation: { code: 'INVALID_ANSWER_BINDING' },
    });
    expect(outcome.value).not.toHaveProperty('generatedCalculations');
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('withholds a conflicting supplied ratio exposed after completing its missing declared dependency', async () => {
    const conversation = [
      { role: 'user' as const, content: messages[0].content + ' Also show the relative change.' },
    ];
    const requested = contract();
    requested.outputs.push({
      id: 'relative',
      sourceQuotes: [{ messageIndex: 0, quote: 'relative change' }],
      requirement: {
        kind: 'arithmetic',
        operation: 'divide',
        operands: [
          { source: 'output', id: 'delta' },
          { source: 'output', id: 'january' },
        ],
      },
    });
    fetchMock.mockResolvedValueOnce(
      response('financial_scenario', {
        queries: [january(), february()],
        assumptions: [],
        calculations: [
          ...calculation().calculations,
          {
            id: 'wrong_ratio',
            operation: 'divide',
            operands: [
              { source: 'query', id: 'january', rowId: 'total:total', field: 'value' },
              { source: 'query', id: 'february', rowId: 'total:total', field: 'value' },
            ],
          },
        ],
        answerContract: requested,
        outputBindings: [
          ...bindings(),
          { outputId: 'relative', source: { kind: 'calculation', calculationId: 'wrong_ratio' } },
        ],
      }),
    );
    const value = await invoke(conversation);
    expect(value).toMatchObject({
      facts: [],
      evidence: [],
      limitation: { code: 'INVALID_ANSWER_BINDING' },
      generatedCalculations: [{ outputId: 'delta' }],
      completion: { status: 'unassessed' },
    });
    expect(completion(value)?.outputs.every((output) => output.status !== 'fulfilled')).toBe(true);
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('fulfills the frozen delta after inspection with the real cached-fact calculator', async () => {
    fetchMock
      .mockResolvedValueOnce(initial())
      .mockResolvedValueOnce(
        response('calculate_from_inspection', { ...calculation(), outputBindings: bindings(true) }),
      );
    const value = await invoke();
    expect(completion(value)?.status).toBe('fulfilled');
    expect(JSON.stringify(value.evidence)).toContain('150.00');
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('withholds a same-dollar result from the wrong account', async () => {
    const wrong = [january(), { ...february(), accountCodes: ['6100'] }];
    fetchMock.mockResolvedValueOnce(direct(contract(false), wrong));
    const outcome = await caught();
    assertWithheld(outcome);
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(metadata(outcome)?.attempts).toBe(1);
    expect(outcome.value).toMatchObject({
      facts: [],
      evidence: [],
      limitation: { code: 'INVALID_ANSWER_BINDING' },
      completion: {
        status: 'unassessed',
        outputs: [
          { outputId: 'january', status: 'missing', reason: 'answer_withheld', evidence: [] },
          { outputId: 'february', status: 'invalid', evidence: [] },
        ],
      },
    });
  });
  it('rejects a missing contract after one bounded repair without reading financial amounts', async () => {
    fetchMock.mockImplementation(async () =>
      response('financial_analysis', { queries: [january()], outputBindings: [] }),
    );
    const outcome = await caught();
    expect(outcome.error).toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.analysis).not.toHaveBeenCalled();
    expect(metadata(outcome)).toMatchObject({ attempts: 2, repairStatus: 'failed' });
  });
  it('rejects a structurally valid contract whose quote is not original-user evidence before any amount read', async () => {
    const forged = contract(false);
    forged.outputs[0].sourceQuotes = [{ messageIndex: 0, quote: 'Not in the conversation' }];
    fetchMock.mockResolvedValueOnce(direct(forged));
    const outcome = await caught();
    assertWithheld(outcome);
    expect(db.analysis).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('cannot replace the frozen contract in a followup, even through the remaining repair', async () => {
    const changed = contract(false);
    fetchMock
      .mockResolvedValueOnce(initial())
      .mockImplementation(async () =>
        response('show_inspected_results', { answerContract: changed, outputBindings: bindings() }),
      );
    const outcome = await caught();
    expect(outcome.error).toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(metadata(outcome)?.attempts).toBe(3);
    expect(feedback(bodies()[1]).answerContract).toEqual(contract());
  });
  it('retains the first-user expense guard before the initial inspection reads money', async () => {
    const text = 'How much do we spend on Office supplies from 2026-01-01 to 2026-01-31?';
    const declared = contract(false);
    declared.outputs = [declared.outputs[0]];
    declared.outputs[0].sourceQuotes = [{ messageIndex: 0, quote: text }];
    fetchMock.mockResolvedValueOnce(initial(declared, [{ ...january(), accountCodes: [] }]));
    const value = await invoke([{ role: 'user', content: text }]);
    expect(value).toMatchObject({ evidence: [], limitation: { code: 'REQUEST_SCOPE_MISMATCH' } });
    expect(db.analysis).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not continue from unknown initial usage and retains the unknown accounting metadata', async () => {
    fetchMock.mockResolvedValueOnce(initial(contract(false), [january(), february()], null));
    const outcome = await caught();
    assertWithheld(outcome);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.analysis).not.toHaveBeenCalled();
    expect(metadata(outcome)).toMatchObject({ attempts: 1, unreportedAttempts: 1, usageComplete: false });
  });
  it('retains known first usage but cannot fund a second read from an unknown second attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(initial(contract(false), [january()]))
      .mockResolvedValueOnce(response('inspect_financial_data', { queries: [february()] }, null));
    const outcome = await caught();
    assertWithheld(outcome);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(metadata(outcome)).toMatchObject({
      attempts: 2,
      unreportedAttempts: 1,
      reportedUsage: { totalTokens: 130 },
    });
  });
  it('shares one initial schema repair and finalization within three total attempts', async () => {
    fetchMock
      .mockResolvedValueOnce(response('inspect_financial_data', { queries: [january()] }))
      .mockResolvedValueOnce(initial(contract(false)))
      .mockResolvedValueOnce(show());
    const value = await invoke();
    expect(completion(value)?.status).toBe('fulfilled');
    expect(value.ai).toMatchObject({ attempts: 3, repairStatus: 'succeeded', usage: { totalTokens: 390 } });
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(getAiUsage().attempts).toBe(3);
  });
  it('does not dispatch a fourth attempt or execute a third read after two coherent inspections', async () => {
    fetchMock
      .mockResolvedValueOnce(initial(contract(false), [january()]))
      .mockResolvedValueOnce(response('inspect_financial_data', { queries: [february()] }))
      .mockResolvedValueOnce(
        response('inspect_financial_data', { queries: [query('third', '2026-03-01', '2026-03-31')] }),
      );
    const outcome = await caught();
    assertWithheld(outcome);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(db.analysis).toHaveBeenCalledTimes(2);
    expect(metadata(outcome)?.attempts).toBe(3);
  });
  it('uses the remaining shared deadline for continuation rather than starting another forty-second window', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock
      .mockImplementationOnce(async () => {
        now = 24000;
        return initial(contract(false));
      })
      .mockResolvedValueOnce(show());
    const value = await invoke();
    expect(completion(value)?.status).toBe('fulfilled');
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([25000, 16000]);
    expect(db.analysis.mock.calls[0][3].deadline).toBe(40000);
  });
  it('withholds a late inspection before another model call or final financial answer', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    fetchMock.mockResolvedValueOnce(initial(contract(false)));
    db.analysis.mockImplementationOnce(
      async (
        _org: string,
        input: { queries: FinancialQuery[] },
        _snapshot: unknown,
        options: FinancialAnalysisOptions,
      ) => {
        const value = result(input.queries, options);
        now = 41000;
        return value;
      },
    );
    const outcome = await caught();
    assertWithheld(outcome);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(metadata(outcome)?.attempts).toBe(1);
  });
  it('cannot turn an untrusted database label in feedback into an original-user assumption', async () => {
    fetchMock.mockResolvedValueOnce(initial()).mockResolvedValueOnce(
      response('calculate_from_inspection', {
        assumptions: [{ id: 'injected', value: '9999', unit: 'USD', sourceText: '$9,999 reserve' }],
        calculations: [
          {
            id: 'difference',
            operation: 'subtract',
            operands: [
              { source: 'assumption', id: 'injected', rowId: null, field: 'value' },
              { source: 'query', id: 'january', rowId: 'total:total', field: 'value' },
            ],
          },
        ],
        outputBindings: bindings(true),
      }),
    );
    db.analysis.mockImplementation(
      async (
        _org: string,
        input: { queries: FinancialQuery[] },
        _snapshot: unknown,
        options: FinancialAnalysisOptions,
      ) => result(input.queries, options, { label: '$9,999 reserve' }),
    );
    const outcome = await caught();
    assertWithheld(outcome);
    expect(JSON.stringify(feedback(bodies()[1]))).toContain('$9,999 reserve');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.analysis).toHaveBeenCalledTimes(1);
  });
  it('withholds earlier evidence when the cumulative reread changes a previously inspected amount', async () => {
    fetchMock
      .mockResolvedValueOnce(initial(contract(false), [january()]))
      .mockResolvedValueOnce(response('inspect_financial_data', { queries: [february()] }));
    db.analysis
      .mockImplementationOnce(
        async (
          _org: string,
          input: { queries: FinancialQuery[] },
          _snapshot: unknown,
          options: FinancialAnalysisOptions,
        ) => result(input.queries, options),
      )
      .mockImplementationOnce(
        async (
          _org: string,
          input: { queries: FinancialQuery[] },
          _snapshot: unknown,
          options: FinancialAnalysisOptions,
        ) => result(input.queries, options, { januaryValue: '241.00' }),
      );
    const outcome = await caught();
    assertWithheld(outcome);
    expect(outcome.value).toMatchObject({ limitation: { code: 'INSPECTION_CHANGED' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(db.analysis).toHaveBeenCalledTimes(2);
  });
  it('allows an off-topic clarification without a fabricated financial contract or amount read', async () => {
    fetchMock.mockResolvedValueOnce(ask());
    const value = await invoke([{ role: 'user', content: 'Suggest a pizza topping.' }]);
    expect(value.evidence).toEqual([]);
    expect(completion(value)?.status).not.toBe('fulfilled');
    expect(db.analysis).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('leaves the composable route working without completion envelopes or new fulfillment claims', async () => {
    fetchMock.mockResolvedValueOnce(response('financial_analysis', { queries: [january()] }));
    const value = await financialChat(org, messages, { route: 'composable' });
    expect(value.evidence).toHaveLength(1);
    expect(completion(value)).toBeUndefined();
    expect(db.analysis).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
