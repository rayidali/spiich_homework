import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../server/config';
import { pool, query } from '../server/db';
import { accounts, createEntry } from '../server/ledger';
import { seedChart } from '../scripts/seed';
import {
  executeFinancialAnalysis,
  financialAnalysisChart,
  type AnalysisFacts,
  type FinancialQuery,
} from '../server/financial-analysis';
import { executeFinancialScenario, type ScenarioCalculationFact } from '../server/financial-calculation';
import { FinancialInspection } from '../server/financial-inspection';
import {
  completeDeclaredArithmetic,
  finalizeAnswerContract,
  prepareAnswerContract,
  type CompletionContext,
} from '../server/answer-completion';
import { completeFinancialAnswer, type AnswerCompletionSession } from '../server/completion-answer';
import {
  answerValueScopeSchema,
  type AnswerContract,
  type OutputBinding,
  type RequestedOutput,
} from '../server/answer-contract';

// These are scripted plans with real PostgreSQL/query/calculator execution.
// The independent amounts below are hand arithmetic, not a model-quality test.
const admin = new pg.Client({ connectionString: config.migrationUrl });
let connected = false;
let org: string;
let ids: Record<string, string>;
const messages = [
  {
    role: 'user' as const,
    content:
      'Show January Office supplies, February Office supplies, the dollar change, and the relative change.',
  },
];

beforeAll(async () => {
  for (const value of [config.databaseUrl, config.migrationUrl]) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const compose =
      process.env.NODE_ENV === 'test' &&
      url.hostname === 'db' &&
      url.port === '5432' &&
      url.pathname === '/spiich';
    if (!local && !compose)
      throw new Error('Declared arithmetic tests require isolated local/CI PostgreSQL.');
  }
  await admin.connect();
  connected = true;
});
beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Declared arithmetic fixture')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (connected) await admin.end();
  await pool.end();
});

async function journal(
  debit: string,
  credit: string,
  amount: string,
  date = '2026-01-15',
  counterparty = 'Fixture merchant',
) {
  return createEntry(
    org,
    {
      date,
      description: 'Synthetic declared arithmetic evidence',
      counterparty,
      reference: '',
      source: 'MANUAL',
      lines: [
        { accountId: ids[debit], debit: amount, credit: '0', exchangeRate: '1', memo: '' },
        { accountId: ids[credit], debit: '0', credit: amount, exchangeRate: '1', memo: '' },
      ],
    },
    randomUUID(),
    { post: true },
  );
}
async function comparisonEntries() {
  // January200+50−10=240; February120−30=90;90−240=−150;−150/240=−5/8.
  await journal('5030', '1010', '200');
  await journal('5030', '1010', '50');
  await journal('1010', '5030', '10', '2026-01-20');
  await journal('5030', '1010', '120', '2026-02-10');
  await journal('1010', '5030', '30', '2026-02-20');
}
function plan(id: string, changes: Partial<FinancialQuery> = {}): FinancialQuery {
  return {
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
  };
}
function valueOutput(
  id: string,
  quote: string,
  wanted: FinancialQuery,
  counterpartyFrom: string | null = null,
): RequestedOutput {
  const { id: _id, groupBy: _group, order: _order, limit: _limit, ...scope } = wanted;
  return {
    id,
    sourceQuotes: [{ messageIndex: 0, quote }],
    requirement: {
      kind: 'value',
      scope: answerValueScopeSchema.parse(scope),
      counterpartyFrom,
      selectedAccountCode: null,
    },
  };
}
function arithmeticOutput(
  id: string,
  quote: string,
  operation: 'add' | 'subtract' | 'divide',
  left: string,
  right: string,
): RequestedOutput {
  return {
    id,
    sourceQuotes: [{ messageIndex: 0, quote }],
    requirement: {
      kind: 'arithmetic',
      operation,
      operands: [
        { source: 'output', id: left },
        { source: 'output', id: right },
      ],
    },
  };
}
const rowBinding = (outputId: string, queryId: string, rowId = 'total:total'): OutputBinding => ({
  outputId,
  source: { kind: 'query_row', queryId, rowId },
});
function comparison() {
  const january = plan('january');
  const february = plan('february', { from: '2026-02-01', to: '2026-02-28' });
  const contract: AnswerContract = {
    outputs: [
      valueOutput('january_output', 'January Office supplies', january),
      valueOutput('february_output', 'February Office supplies', february),
      arithmeticOutput('delta_output', 'the dollar change', 'subtract', 'february_output', 'january_output'),
      arithmeticOutput('ratio_output', 'the relative change', 'divide', 'delta_output', 'january_output'),
    ],
  };
  const bindings = [rowBinding('january_output', 'january'), rowBinding('february_output', 'february')];
  return { january, february, contract, bindings };
}
async function fingerprint() {
  const [row] = await query<{ snapshot: { entries: unknown[]; lines: unknown[]; accounts: unknown[] } }>(
    `SELECT jsonb_build_object(
      'entries',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM journal_entries e WHERE organization_id=$1),'[]'::jsonb),
      'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM journal_lines l WHERE organization_id=$1),'[]'::jsonb),
      'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM accounts a WHERE organization_id=$1),'[]'::jsonb)) AS snapshot`,
    [org],
  );
  return {
    hash: createHash('sha256').update(JSON.stringify(row.snapshot)).digest('hex'),
    entries: row.snapshot.entries.length,
    lines: row.snapshot.lines.length,
    accounts: row.snapshot.accounts.length,
  };
}
async function materialize(
  queries: FinancialQuery[],
  contract: AnswerContract,
  bindings: OutputBinding[],
  original = messages,
) {
  const session: AnswerCompletionSession = { prepared: prepareAnswerContract(contract, original), bindings };
  const result = await executeFinancialAnalysis(org, { queries }, undefined, {
    onExecutionChart: (chart) => {
      session.executionChart = chart;
    },
  });
  const context: CompletionContext = {
    organizationId: org,
    chart: session.executionChart!,
    facts: result.facts,
    evidence: result.evidence,
    bindings,
  };
  return { session, result, context };
}
function withoutDatabase<T>(operation: () => T): T {
  const connection = vi.spyOn(pool, 'connect').mockImplementation(() => {
    throw new Error('Unexpected completion database connection');
  });
  const direct = vi.spyOn(pool, 'query').mockImplementation(() => {
    throw new Error('Unexpected completion database query');
  });
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('Unexpected completion network request');
  });
  try {
    const result = operation();
    expect(connection).not.toHaveBeenCalled();
    expect(direct).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    return result;
  } finally {
    connection.mockRestore();
    direct.mockRestore();
    network.mockRestore();
  }
}
function calculations(facts: CompletionContext['facts']) {
  return facts.filter((fact): fact is ScenarioCalculationFact => 'kind' in fact);
}

describe('Deterministic declared arithmetic from actual PostgreSQL evidence', () => {
  it('completes both omitted comparisons from verified 240 and 90 without another read', async () => {
    await comparisonEntries();
    const before = await fingerprint();
    const { january, february, contract, bindings } = comparison();
    const { session, result, context } = await materialize([january, february], contract, bindings);
    const original = structuredClone({ result, context, session });
    expect(result.facts.map((fact) => fact.rows[0].value)).toEqual(['240.00', '90.00']);
    const generated = withoutDatabase(() => completeDeclaredArithmetic(session.prepared, context));
    expect(generated.generatedCalculations.map((item) => item.outputId)).toEqual([
      'delta_output',
      'ratio_output',
    ]);
    expect(calculations(generated.facts).map((fact) => fact.value)).toEqual(['-150.00', '-0.625']);
    expect(calculations(generated.facts).at(-1)).toMatchObject({
      exact: { numerator: '-5', denominator: '8' },
      source: 'posted',
      assumptions: [],
    });
    expect(finalizeAnswerContract(session.prepared, { ...context, ...generated }).status).toBe('fulfilled');
    const final = withoutDatabase(() => completeFinancialAnswer(org, session, result));
    expect(final.completion.status).toBe('fulfilled');
    if (!('modelOutputBindings' in final) || !('generatedCalculations' in final))
      throw new Error('Generated completion is missing its source audit');
    expect(final.modelOutputBindings).toEqual(bindings);
    expect(final.outputBindings).toHaveLength(4);
    expect(final.generatedCalculations?.map((item) => item.outputId)).toEqual([
      'delta_output',
      'ratio_output',
    ]);
    expect(final.evidence.slice(0, 4).map((table) => table.rows[0].value)).toEqual([
      '$240.00',
      '$90.00',
      '-$150.00 USD',
      '-0.625 ratio',
    ]);
    expect(final.completion.userIntentVerified).toBe(false);
    expect({ result, context, session }).toEqual(original);
    expect(await fingerprint()).toEqual(before);
  });

  it('does not replace a same-dollar wrong-account source with the requested account', async () => {
    await comparisonEntries();
    await journal('5010', '1010', '240');
    const before = await fingerprint();
    const { january, february, contract, bindings } = comparison();
    const { session, result, context } = await materialize(
      [{ ...january, accountCodes: ['5010'] }, february],
      contract,
      bindings,
    );
    expect(result.facts[0].rows[0].value).toBe('240.00');
    const generated = withoutDatabase(() => completeDeclaredArithmetic(session.prepared, context));
    expect(generated.generatedCalculations).toEqual([]);
    expect(generated.bindings).toEqual(bindings);
    const final = withoutDatabase(() => completeFinancialAnswer(org, session, result));
    expect(final.limitation).toEqual({ code: 'INVALID_ANSWER_BINDING' });
    expect(final.facts).toEqual([]);
    expect(final.evidence).toEqual([]);
    expect(await fingerprint()).toEqual(before);
  });

  it('leaves an unbound missing query unresolved even when its answer exists in the books', async () => {
    await comparisonEntries();
    const before = await fingerprint();
    const { january, contract, bindings } = comparison();
    const { session, result, context } = await materialize([january], contract, bindings.slice(0, 1));
    const generated = withoutDatabase(() => completeDeclaredArithmetic(session.prepared, context));
    expect(generated.generatedCalculations).toEqual([]);
    const final = withoutDatabase(() => completeFinancialAnswer(org, session, result));
    expect(final.completion.status).toBe('partial');
    expect(final.completion.outputs.map((item) => item.status)).toEqual([
      'fulfilled',
      'missing',
      'missing',
      'missing',
    ]);
    expect(calculations(final.facts!)).toEqual([]);
    expect(await fingerprint()).toEqual(before);
  });

  it('preserves a valid difference but leaves relative change unresolved for a zero baseline', async () => {
    await journal('5030', '1010', '90', '2026-02-10');
    const before = await fingerprint();
    const { january, february, contract, bindings } = comparison();
    const { session, result, context } = await materialize([january, february], contract, bindings);
    expect(result.facts.map((fact) => fact.rows[0].value)).toEqual(['0.00', '90.00']);
    const generated = withoutDatabase(() => completeDeclaredArithmetic(session.prepared, context));
    expect(generated.generatedCalculations.map((item) => item.outputId)).toEqual(['delta_output']);
    expect(calculations(generated.facts).map((fact) => fact.value)).toEqual(['90.00']);
    const final = withoutDatabase(() => completeFinancialAnswer(org, session, result));
    expect(final.completion.status).toBe('partial');
    expect(final.completion.outputs.at(-1)).toMatchObject({ outputId: 'ratio_output', status: 'missing' });
    expect(JSON.stringify(final)).not.toMatch(/Infinity|NaN/);
    expect(await fingerprint()).toEqual(before);
  });

  it('does not overwrite an existing wrong operation with the declared subtraction', async () => {
    await comparisonEntries();
    const before = await fingerprint();
    const { january, february, contract, bindings } = comparison();
    const session: AnswerCompletionSession = {
      prepared: prepareAnswerContract(contract, messages),
      bindings: [
        ...bindings,
        { outputId: 'delta_output', source: { kind: 'calculation', calculationId: 'wrong_sum' } },
      ],
    };
    const result = await executeFinancialScenario(
      org,
      {
        queries: [january, february],
        assumptions: [],
        calculations: [
          {
            id: 'wrong_sum',
            operation: 'add',
            operands: [
              { source: 'query', id: 'february', rowId: 'total:total', field: 'value' },
              { source: 'query', id: 'january', rowId: 'total:total', field: 'value' },
            ],
          },
        ],
      },
      messages,
      {
        onExecutionChart: (chart) => {
          session.executionChart = chart;
        },
      },
    );
    expect(calculations(result.facts)[0].value).toBe('330.00');
    const context: CompletionContext = {
      organizationId: org,
      chart: session.executionChart!,
      facts: result.facts,
      evidence: result.evidence,
      bindings: session.bindings,
    };
    const generated = withoutDatabase(() => completeDeclaredArithmetic(session.prepared, context));
    expect(generated.generatedCalculations).toEqual([]);
    expect(generated.facts).toEqual(result.facts);
    const final = withoutDatabase(() => completeFinancialAnswer(org, session, result));
    expect(final.limitation).toEqual({ code: 'INVALID_ANSWER_BINDING' });
    expect(final.evidence).toEqual([]);
    expect(await fingerprint()).toEqual(before);
  });

  it('retains the exact discovered Acme identity through generated arithmetic and short handles', async () => {
    await journal('5030', '1010', '240', '2026-01-15', 'Acme');
    await journal('5030', '1010', '220', '2026-01-15', 'acme');
    await journal('5030', '1010', '90', '2026-02-15', 'Acme');
    await journal('5030', '1010', '500', '2026-02-15', 'acme');
    const before = await fingerprint();
    const original = [
      {
        role: 'user' as const,
        content:
          'Find the top January supplier, its January expense, its February expense, and the dollar change.',
      },
    ];
    const discovery = plan('leader', { groupBy: 'counterparty', order: 'value_desc' });
    const january = plan('january');
    const february = plan('february', { from: '2026-02-01', to: '2026-02-28' });
    const { id: _id, ...selection } = discovery;
    const contract: AnswerContract = {
      outputs: [
        {
          id: 'leader_output',
          sourceQuotes: [{ messageIndex: 0, quote: 'the top January supplier' }],
          requirement: {
            kind: 'selected_identity',
            query: {
              ...selection,
              counterparty: { mode: 'any', value: '' },
              groupBy: 'counterparty',
              order: 'value_desc',
            },
            tiePolicy: 'unique',
          },
        },
        valueOutput('january_output', 'its January expense', january, 'leader_output'),
        valueOutput('february_output', 'its February expense', february, 'leader_output'),
        arithmeticOutput(
          'delta_output',
          'the dollar change',
          'subtract',
          'february_output',
          'january_output',
        ),
      ],
    };
    const session: AnswerCompletionSession = {
      prepared: prepareAnswerContract(contract, original),
      bindings: [],
    };
    const inspection = new FinancialInspection(
      org,
      original,
      await financialAnalysisChart(org),
      undefined,
      (chart) => {
        session.executionChart = chart;
      },
    );
    await inspection.inspect({ queries: [{ ...discovery, counterpartySource: null }] });
    const first = JSON.parse(inspection.feedback()) as { facts: AnalysisFacts[] };
    const selectedHandle = first.facts[0].rows[0].rowId;
    await inspection.inspect({
      queries: [january, february].map((requested) => ({
        ...requested,
        counterpartySource: { queryId: 'leader', rowId: selectedHandle },
      })),
    });
    const feedback = JSON.parse(inspection.feedback()) as { facts: AnalysisFacts[] };
    session.bindings = [
      rowBinding('leader_output', 'leader', selectedHandle),
      ...['january', 'february'].map((id) =>
        rowBinding(`${id}_output`, id, feedback.facts.find((fact) => fact.queryId === id)!.rows[0].rowId),
      ),
    ];
    const result = inspection.show();
    expect(result.facts.find((fact) => fact.queryId === 'january')!.rows[0].value).toBe('240.00');
    expect(result.facts.find((fact) => fact.queryId === 'february')!.scope.counterpartyIdentity?.key).toBe(
      'Acme',
    );
    expect(result.facts.find((fact) => fact.queryId === 'february')!.rows[0].value).toBe('90.00');
    const final = withoutDatabase(() =>
      completeFinancialAnswer(org, session, result, inspection.summary().rowReferences),
    );
    expect(final.completion.status).toBe('fulfilled');
    expect(calculations(final.facts!)[0]).toMatchObject({
      value: '-150.00',
      provenance: {
        queryRows: [
          { id: 'february', rowId: 'total:total', field: 'value' },
          { id: 'january', rowId: 'total:total', field: 'value' },
        ],
      },
    });
    expect(await fingerprint()).toEqual(before);
  });

  it('computes closing cash from cached stock plus movement without treating other assets as cash', async () => {
    await journal('1010', '3010', '1000', '2025-12-31');
    await journal('1200', '3010', '5000', '2025-12-31');
    await journal('5030', '1010', '15', '2026-01-10');
    const before = await fingerprint();
    const original = [
      {
        role: 'user' as const,
        content: 'Show opening cash, January cash movement, and opening cash plus that movement.',
      },
    ];
    const opening = plan('opening', {
      metric: 'cash_balance',
      accountCodes: [],
      from: null,
      to: '2025-12-31',
    });
    const movement = plan('movement', { metric: 'net_cash_movement', accountCodes: [] });
    const contract: AnswerContract = {
      outputs: [
        valueOutput('opening_output', 'Show opening cash', opening),
        valueOutput('movement_output', 'January cash movement', movement),
        arithmeticOutput(
          'closing_output',
          'opening cash plus that movement',
          'add',
          'opening_output',
          'movement_output',
        ),
      ],
    };
    const { session, result } = await materialize(
      [opening, movement],
      contract,
      [rowBinding('opening_output', 'opening'), rowBinding('movement_output', 'movement')],
      original,
    );
    expect(result.facts.map((fact) => fact.rows[0].value)).toEqual(['1000.00', '-15.00']);
    const final = withoutDatabase(() => completeFinancialAnswer(org, session, result));
    expect(final.completion.status).toBe('fulfilled');
    const derived = calculations(final.facts!)[0];
    expect(derived).toMatchObject({
      value: '985.00',
      exact: { numerator: '985', denominator: '1' },
      source: 'posted',
    });
    expect(derived.cashSources).toEqual([
      {
        queryId: 'opening',
        rowId: 'total:total',
        asOf: '2025-12-31',
        accountIds: expect.arrayContaining([ids['1010'], ids['1020']]),
      },
    ]);
    expect(derived.cashMovementSources).toEqual([
      {
        queryId: 'movement',
        rowId: 'total:total',
        from: '2026-01-01',
        to: '2026-01-31',
        accountIds: expect.arrayContaining([ids['1010'], ids['1020']]),
      },
    ]);
    expect(derived.cashSources![0].accountIds).not.toContain(ids['1200']);
    expect(derived.cashSources![0].accountIds).toHaveLength(2);
    expect(derived.cashMovementSources![0].accountIds).toHaveLength(2);
    expect(await fingerprint()).toEqual(before);
  });
});
