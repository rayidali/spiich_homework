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
  type AnalysisAccount,
  type AnalysisFacts,
  type FinancialQuery,
} from '../server/financial-analysis';
import { executeFinancialScenario, type FinancialScenario } from '../server/financial-calculation';
import { FinancialInspection } from '../server/financial-inspection';
import { prepareAnswerContract, finalizeAnswerContract } from '../server/answer-completion';
import { completeFinancialAnswer, type AnswerCompletionSession } from '../server/completion-answer';
import {
  answerValueScopeSchema,
  type AnswerContract,
  type OutputBinding,
  type RequestedOutput,
} from '../server/answer-contract';
import type { EntryInput } from '../shared/schema';

// Actual PostgreSQL, query/compiler, calculator and finalizer. These plans are
// supplied by the test, so the suite makes no model-understanding claim.
const admin = new pg.Client({ connectionString: config.migrationUrl });
let connected = false;
let org: string;
let ids: Record<string, string>;
const question =
  'Show January spending on Office supplies, February spending on Office supplies, the dollar change, and the relative change.';
const messages = [{ role: 'user' as const, content: question }];

beforeAll(async () => {
  for (const value of [config.databaseUrl, config.migrationUrl]) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const compose =
      process.env.NODE_ENV === 'test' &&
      url.hostname === 'db' &&
      url.port === '5432' &&
      url.pathname === '/spiich';
    if (!local && !compose) throw new Error('Answer-completion tests require isolated local/CI PostgreSQL.');
  }
  await admin.connect();
  connected = true;
});
beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  org = randomUUID();
  await admin.query("INSERT INTO organizations(id,name) VALUES($1,'Answer completion fixture')", [org]);
  await seedChart(org);
  ids = Object.fromEntries((await accounts(org)).map((account) => [account.code, account.id]));
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (connected) await admin.end();
  await pool.end();
});

async function post(code: string, amount: string, date = '2026-01-15', refund = false) {
  const input: EntryInput = {
    date,
    description: 'Synthetic completion evidence',
    counterparty: 'Fixture merchant',
    reference: '',
    source: 'MANUAL',
    lines: [
      {
        accountId: ids[code],
        debit: refund ? '0' : amount,
        credit: refund ? amount : '0',
        exchangeRate: '1',
        memo: '',
      },
      {
        accountId: ids['1010'],
        debit: refund ? amount : '0',
        credit: refund ? '0' : amount,
        exchangeRate: '1',
        memo: '',
      },
    ],
  };
  return createEntry(org, input, randomUUID(), { post: true });
}
async function addAccount(code: string, name: string, parent: string, isGroup = false) {
  const [created] = await query<{ id: string }>(
    `INSERT INTO accounts(organization_id,code,name,type,currency,parent_id,is_group)
     VALUES($1,$2,$3,'EXPENSE','USD',$4,$5) RETURNING id`,
    [org, code, name, ids[parent], isGroup],
  );
  ids[code] = created.id;
}
function plan(id: string, change: Partial<FinancialQuery> = {}): FinancialQuery {
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
    ...change,
  };
}
function valueOutput(id: string, quote: string, requested: FinancialQuery): RequestedOutput {
  const { id: _id, groupBy: _groupBy, order: _order, limit: _limit, ...scope } = requested;
  return {
    id,
    sourceQuotes: [{ messageIndex: 0, quote }],
    requirement: {
      kind: 'value',
      scope: answerValueScopeSchema.parse(scope),
      counterpartyFrom: null,
      selectedAccountCode: null,
    },
  };
}
const rowBinding = (outputId: string, queryId: string, rowId = 'total:total'): OutputBinding => ({
  outputId,
  source: { kind: 'query_row', queryId, rowId },
});
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
function comparison() {
  const january = plan('january');
  const february = plan('february', { from: '2026-02-01', to: '2026-02-28' });
  const contract: AnswerContract = {
    outputs: [
      valueOutput('january_output', 'January spending on Office supplies', january),
      valueOutput('february_output', 'February spending on Office supplies', february),
      {
        id: 'delta_output',
        sourceQuotes: [{ messageIndex: 0, quote: 'the dollar change' }],
        requirement: {
          kind: 'arithmetic',
          operation: 'subtract',
          operands: [
            { source: 'output', id: 'february_output' },
            { source: 'output', id: 'january_output' },
          ],
        },
      },
      {
        id: 'ratio_output',
        sourceQuotes: [{ messageIndex: 0, quote: 'the relative change' }],
        requirement: {
          kind: 'arithmetic',
          operation: 'divide',
          operands: [
            { source: 'output', id: 'delta_output' },
            { source: 'output', id: 'january_output' },
          ],
        },
      },
    ],
  };
  const scenario: FinancialScenario = {
    queries: [january, february],
    assumptions: [],
    calculations: [
      {
        id: 'delta',
        operation: 'subtract',
        operands: [
          { source: 'query', id: 'february', rowId: 'total:total', field: 'value' },
          { source: 'query', id: 'january', rowId: 'total:total', field: 'value' },
        ],
      },
      {
        id: 'ratio',
        operation: 'divide',
        operands: [
          { source: 'calculation', id: 'delta', rowId: null, field: 'value' },
          { source: 'query', id: 'january', rowId: 'total:total', field: 'value' },
        ],
      },
    ],
  };
  const bindings: OutputBinding[] = [
    rowBinding('january_output', 'january'),
    rowBinding('february_output', 'february'),
    { outputId: 'delta_output', source: { kind: 'calculation', calculationId: 'delta' } },
    { outputId: 'ratio_output', source: { kind: 'calculation', calculationId: 'ratio' } },
  ];
  return { contract, scenario, bindings };
}

describe('Declared-answer completion against actual PostgreSQL execution', () => {
  it('returns four visibly linked outputs with January 240, February 90, difference minus 150 and ratio minus 5/8', async () => {
    // Refunds contribute to the independent net totals:200+50−10=240;120−30=90.
    await post('5030', '200');
    await post('5030', '50');
    await post('5030', '10', '2026-01-20', true);
    await post('5030', '120', '2026-02-10');
    await post('5030', '30', '2026-02-20', true);
    const before = await fingerprint();
    const { contract, scenario, bindings } = comparison();
    const session: AnswerCompletionSession = {
      prepared: prepareAnswerContract(contract, messages),
      bindings,
    };
    const result = await executeFinancialScenario(org, scenario, messages, {
      onExecutionChart: (chart) => {
        session.executionChart = chart;
      },
    });
    expect(result.facts.map((fact) => ('queryId' in fact ? fact.rows[0].value : fact.value))).toEqual([
      '240.00',
      '90.00',
      '-150.00',
      '-0.625',
    ]);
    expect(result.facts.at(-1)).toMatchObject({
      exact: { numerator: '-5', denominator: '8' },
      source: 'posted',
    });
    const final = completeFinancialAnswer(org, session, result);
    expect(final.completion).toMatchObject({
      completionBasis: 'model_declared',
      userIntentVerified: false,
      status: 'fulfilled',
    });
    expect(final.completion.outputs.map((output) => output.status)).toEqual(Array(4).fill('fulfilled'));
    expect(final.evidence.slice(0, 4).map((table) => table.rows[0].value)).toEqual([
      '$240.00',
      '$90.00',
      '-$150.00 USD',
      '-0.625 ratio',
    ]);
    for (const output of final.completion.outputs) {
      expect(output.evidence.length).toBeGreaterThan(0);
      for (const location of output.evidence)
        expect(final.evidence[location.tableIndex].rows[location.rowIndex!].factRef).toBeDefined();
    }
    expect(final).not.toHaveProperty('limitation');
    // Omitting a binding is incomplete even though the underlying arithmetic exists.
    const incomplete = finalizeAnswerContract(session.prepared, {
      organizationId: org,
      chart: session.executionChart!,
      facts: result.facts,
      evidence: result.evidence,
      bindings: bindings.slice(0, 3),
    });
    expect(incomplete.status).toBe('partial');
    expect(incomplete.outputs.at(-1)).toMatchObject({ outputId: 'ratio_output', status: 'missing' });
    expect(await fingerprint()).toEqual(before);
  });

  it('withholds a different account even when its recorded amount equals the requested account', async () => {
    await post('5030', '240');
    await post('5010', '240');
    const original = [{ role: 'user' as const, content: 'Show January Office supplies spending.' }];
    const requested = plan('supplies');
    const session: AnswerCompletionSession = {
      prepared: prepareAnswerContract(
        { outputs: [valueOutput('requested', 'January Office supplies spending', requested)] },
        original,
      ),
      bindings: [rowBinding('requested', 'rent')],
    };
    const before = await fingerprint();
    const result = await executeFinancialAnalysis(
      org,
      { queries: [plan('rent', { accountCodes: ['5010'] })] },
      undefined,
      {
        onExecutionChart: (chart) => {
          session.executionChart = chart;
        },
      },
    );
    expect(result.facts[0].rows[0].value).toBe('240.00');
    const final = completeFinancialAnswer(org, session, result);
    expect(final.completion.outputs[0].status).toBe('invalid');
    expect(final.limitation).toEqual({ code: 'INVALID_ANSWER_BINDING' });
    expect(final.evidence).toEqual([]);
    expect(final.facts).toEqual([]);
    expect(final.answer).not.toMatch(/\$\s*\d/);
    expect(await fingerprint()).toEqual(before);
  });

  it.each(['0', '80'])(
    'uses the actual execution chart when a newly posted group child contributes %s',
    async (newChildAmount) => {
      await addAccount('5500', 'Office operations', '5000', true);
      await addAccount('5510', 'Original paper account', '5500');
      await post('5510', '240');
      const planningChart = await financialAnalysisChart(org);
      const original = [{ role: 'user' as const, content: 'Show January Office operations spending.' }];
      const groupPlan = plan('whole_group', { accountCodes: ['5500'] });
      const session: AnswerCompletionSession = {
        prepared: prepareAnswerContract(
          { outputs: [valueOutput('requested', 'January Office operations spending', groupPlan)] },
          original,
        ),
        bindings: [rowBinding('requested', 'old_subset')],
      };
      await addAccount('5520', 'New printing account', '5500');
      if (newChildAmount === '0') {
        // Genuine posted activity with netzero; equal dollars must not prove group completeness.
        await post('5520', '25');
        await post('5520', '25', '2026-01-20', true);
      } else await post('5520', newChildAmount);
      const before = await fingerprint();
      expect(planningChart.some((account) => account.code === '5520')).toBe(false);
      const result = await executeFinancialAnalysis(
        org,
        {
          queries: [plan('old_subset', { accountCodes: ['5510'] }), groupPlan],
        },
        undefined,
        {
          onExecutionChart: (chart) => {
            session.executionChart = chart;
          },
        },
      );
      expect(session.executionChart!.find((account) => account.code === '5520')?.id).toBe(ids['5520']);
      expect(result.facts[0].rows[0].value).toBe('240.00');
      expect(result.facts[1].rows[0].value).toBe(newChildAmount === '0' ? '240.00' : '320.00');
      expect(result.facts[1].scope.resolvedAccountIds.sort()).toEqual([ids['5510'], ids['5520']].sort());
      const rejected = completeFinancialAnswer(org, session, result);
      expect(rejected.completion.outputs[0].status).toBe('invalid');
      expect(rejected.evidence).toEqual([]);
      const corrected = completeFinancialAnswer(
        org,
        { ...session, bindings: [rowBinding('requested', 'whole_group')] },
        result,
      );
      expect(corrected.completion.status).toBe('fulfilled');
      expect(await fingerprint()).toEqual(before);
    },
  );

  it('binds an actual inspection handle to visible canonical evidence and rejects the same handle with the wrong query', async () => {
    await post('5030', '240');
    const original = [{ role: 'user' as const, content: 'Show January Office supplies spending.' }];
    const actual = plan('january');
    const session: AnswerCompletionSession = {
      prepared: prepareAnswerContract(
        { outputs: [valueOutput('requested', 'January Office supplies spending', actual)] },
        original,
      ),
      bindings: [],
    };
    const before = await fingerprint();
    const inspection = new FinancialInspection(
      org,
      original,
      await financialAnalysisChart(org),
      undefined,
      (chart) => {
        session.executionChart = chart;
      },
    );
    await inspection.inspect({ queries: [{ ...actual, counterpartySource: null }] });
    const feedback = JSON.parse(inspection.feedback()) as { facts: AnalysisFacts[] };
    const handle = feedback.facts[0].rows[0].rowId;
    expect(handle).toMatch(/^r_[a-f0-9]{24}_\d+$/);
    const result = inspection.show();
    expect(result.facts[0].rows[0].rowId).toBe('total:total');
    session.bindings = [rowBinding('requested', 'january', handle)];
    const final = completeFinancialAnswer(org, session, result, inspection.summary().rowReferences);
    expect(final.completion.status).toBe('fulfilled');
    expect(final.evidence[0].rows[0].factRef).toEqual({
      kind: 'query_row',
      queryId: 'january',
      rowId: 'total:total',
    });
    const rejected = completeFinancialAnswer(
      org,
      { ...session, bindings: [rowBinding('requested', 'another_query', handle)] },
      result,
      inspection.summary().rowReferences,
    );
    expect(rejected.completion.outputs[0].status).toBe('invalid');
    expect(rejected.evidence).toEqual([]);
    expect(await fingerprint()).toEqual(before);
  });

  it('does not publish a new chart or stale result when a later real database reread changes earlier evidence', async () => {
    await post('5030', '240');
    const acceptedCharts: AnalysisAccount[][] = [];
    const inspection = new FinancialInspection(
      org,
      messages,
      await financialAnalysisChart(org),
      undefined,
      (chart) => {
        acceptedCharts.push(chart);
      },
    );
    await inspection.inspect({ queries: [{ ...plan('january'), counterpartySource: null }] });
    expect(acceptedCharts).toHaveLength(1);
    const firstChart = structuredClone(acceptedCharts[0]);
    await addAccount('5500', 'New expense leaf', '5000');
    await post('5030', '1', '2026-01-25');
    const beforeSecondRead = await fingerprint();
    await expect(
      inspection.inspect({
        queries: [
          {
            ...plan('february', { from: '2026-02-01', to: '2026-02-28' }),
            counterpartySource: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INSPECTION_CHANGED' });
    expect(acceptedCharts).toEqual([firstChart]);
    expect(acceptedCharts[0].some((account) => account.code === '5500')).toBe(false);
    expect(inspection.summary().state).toBe('failed');
    expect(() => inspection.show()).toThrow();
    expect(() => inspection.feedback()).toThrow();
    expect(await fingerprint()).toEqual(beforeSecondRead);
  });
});
