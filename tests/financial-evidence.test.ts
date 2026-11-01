import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../server/db';
import type { InsightEvidence } from '../shared/financial-evidence';
import {
  executeFinancialAnalysis,
  type AnalysisAccount,
  type FinancialQuery,
} from '../server/financial-analysis';
import {
  evaluateFinancialScenario,
  executeFinancialScenario,
  scenarioAssumptionEvidence,
  scenarioAssumptionQuantityEvidence,
  scenarioCalendarMonthCount,
  type FinancialScenario,
  type ScenarioReference,
} from '../server/financial-calculation';
import type { GroupDimension } from '../server/financial-grouping';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock('../server/reports', () => ({ reportSnapshot: mocks.snapshot }));

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
const plan = (id: string, changes: Partial<FinancialQuery> = {}): FinancialQuery => ({
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
type RawRow = {
  row_id: string;
  label: string;
  value: string | null;
  entry_count: string;
  period_from?: string;
  period_to?: string;
  dimensions?: GroupDimension[];
};
const total = (value: string | null): RawRow => ({
  row_id: 'total',
  label: 'Total',
  value,
  entry_count: value === null ? '0' : '2',
});

// Real compiler, presentation and calculator; the database transport alone is
// synthetic. These are evidence-linkage tests, not PostgreSQL or model-quality tests.
function database(results: RawRow[][], accounts: AnalysisAccount[] = [supplies]) {
  let index = 0;
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SET LOCAL')) return { rows: [] };
    if (sql.startsWith('SELECT id,code,name,type,currency,parent_id,is_group,archived,is_cash'))
      return { rows: accounts };
    if (sql.startsWith('WITH typed_input')) {
      if (index >= results.length) throw new Error('Unexpected extra amount read');
      return { rows: results[index++] };
    }
    throw new Error('Unexpected offline database statement');
  });
  return { snapshot: { query } as unknown as Db, query };
}
const ref = (id: string, rowId = 'total:total'): ScenarioReference => ({
  source: 'query',
  id,
  rowId,
  field: 'value',
});
const assumption = (id: string): ScenarioReference => ({
  source: 'assumption',
  id,
  rowId: null,
  field: 'value',
});

beforeEach(() => {
  mocks.snapshot.mockReset();
  mocks.snapshot.mockImplementation(() => {
    throw new Error('This test did not authorize a snapshot');
  });
});

describe('Server-owned financial evidence references', () => {
  it('distinguishes equal amounts and labels by exact query identity after tables are reordered', async () => {
    const january = plan('january');
    const february = plan('february', { from: '2026-02-01', to: '2026-02-28' });
    const db = database([[total('240')], [total('240')]]);
    const result = await executeFinancialAnalysis(org, { queries: [january, february] }, db.snapshot);
    const factsBefore = structuredClone(result.facts);
    const reordered = structuredClone(result.evidence).reverse();
    // Deliberately indistinguishable presentation must not become identity.
    for (const table of reordered) {
      table.title = 'Same displayed title';
      table.rows[0].label = 'Same displayed label';
      const source = table.factSource!;
      expect(source).toEqual({ kind: 'query_result', queryId: source.queryId, truncated: false });
      const actual = result.facts.find((fact) => fact.queryId === source.queryId)!;
      expect(table.rows[0].factRef).toEqual({
        kind: 'query_row',
        queryId: actual.queryId,
        rowId: 'total:total',
      });
      expect(actual.scope.plan.from).toBe(source.queryId === 'january' ? '2026-01-01' : '2026-02-01');
      expect(table.rows[0].value).toBe('$240.00');
    }
    expect(reordered.map((table) => table.factSource!.queryId)).toEqual(['february', 'january']);
    expect(result.facts).toEqual(factsBefore);
    expect(result.evidence.map((table) => table.rows[0].label)).toEqual(['Total', 'Total']);
  });

  it('preserves exact compound IDs and raw identities rather than copying escaped labels', async () => {
    const party = 'Acme ["West"] \\ / café';
    const dimensions: GroupDimension[] = [
      { kind: 'counterparty', key: party, label: JSON.stringify(party) },
      { kind: 'month', key: '2026-01', label: '2026-01' },
    ];
    const db = database([
      [
        {
          row_id: 'unused',
          label: 'Untrusted label says query:another, row:fake',
          value: '90',
          entry_count: '1',
          dimensions,
          period_from: '2026-01-01',
          period_to: '2026-01-31',
        },
      ],
    ]);
    const result = await executeFinancialAnalysis(
      org,
      { queries: [plan('discovery', { groupBy: ['counterparty', 'month'] })] },
      db.snapshot,
    );
    const rowId = `compound:${JSON.stringify([
      ['counterparty', party],
      ['month', '2026-01'],
    ])}`;
    expect(result.facts[0].rows[0].rowId).toBe(rowId);
    expect(result.evidence[0].rows[0].factRef).toEqual({ kind: 'query_row', queryId: 'discovery', rowId });
    expect(JSON.parse(JSON.stringify(result.evidence))[0].rows[0].factRef.rowId).toBe(rowId);
    expect(result.evidence[0].rows[0].value).toBe('$90.00');
  });

  it('retains visible-row references and the truncation flag without inventing a hidden row', async () => {
    const db = database([
      [
        { row_id: 'Acme', label: 'Acme', value: '240', entry_count: '1' },
        { row_id: 'acme', label: 'acme', value: '220', entry_count: '1' },
      ],
    ]);
    const query = plan('leaders', { groupBy: 'counterparty', limit: 1, order: 'value_desc' });
    const result = await executeFinancialAnalysis(org, { queries: [query] }, db.snapshot);
    expect(result.evidence[0].factSource).toEqual({
      kind: 'query_result',
      queryId: 'leaders',
      truncated: true,
    });
    expect(result.evidence[0].rows).toEqual([
      {
        label: 'Acme',
        value: '$240.00',
        factRef: { kind: 'query_row', queryId: 'leaders', rowId: 'counterparty:Acme' },
      },
    ]);
    expect(() =>
      evaluateFinancialScenario(
        {
          queries: [query],
          assumptions: [],
          calculations: [
            {
              id: 'double',
              operation: 'add',
              operands: [ref('leaders', 'counterparty:Acme'), ref('leaders', 'counterparty:Acme')],
            },
          ],
        },
        result.facts,
        [{ role: 'user', content: 'Double the leading amount.' }],
      ),
    ).toThrow('complete query result');
  });

  it('links a true null average but adds no phantom row to an empty grouped result', async () => {
    const db = database([[], [total(null)]]);
    const result = await executeFinancialAnalysis(
      org,
      {
        queries: [
          plan('empty', { groupBy: 'counterparty' }),
          plan('average', { aggregation: 'average_per_entry' }),
        ],
      },
      db.snapshot,
    );
    expect(result.evidence[0].rows).toEqual([]);
    expect(result.evidence[0].factSource).toEqual({
      kind: 'query_result',
      queryId: 'empty',
      truncated: false,
    });
    expect(result.evidence[1].rows).toEqual([
      {
        label: 'Total · 0 matching transactions',
        value: 'No matching transactions',
        factRef: { kind: 'query_row', queryId: 'average', rowId: 'total:total' },
      },
    ]);
    expect(result.facts[1].rows[0].value).toBeNull();
  });

  it('keeps transaction hrefs and displayed money unchanged when attaching exact row references', async () => {
    const entryId = '00000000-0000-4000-8000-000000000003';
    const db = database([[{ row_id: entryId, label: 'Paper', value: '12.34', entry_count: '1' }]]);
    const result = await executeFinancialAnalysis(
      org,
      { queries: [plan('entries', { groupBy: 'entry' })] },
      db.snapshot,
    );
    expect(result.evidence[0].rows[0]).toEqual({
      label: 'Paper',
      value: '$12.34',
      href: `/transactions?entry=${entryId}`,
      factRef: { kind: 'query_row', queryId: 'entries', rowId: `entry:${entryId}` },
    });
  });

  it('links query, assumption and calculation evidence through the real scenario assembly without changing provenance', async () => {
    const january = plan('january');
    const february = plan('february', { from: '2026-02-01', to: '2026-02-28' });
    const scenario: FinancialScenario = {
      queries: [january, february],
      assumptions: [{ id: 'setup', value: '20', unit: 'USD', sourceText: '$20 setup' }],
      calculations: [
        { id: 'change', operation: 'subtract', operands: [ref('february'), ref('january')] },
        { id: 'with_setup', operation: 'add', operands: [ref('february'), assumption('setup')] },
      ],
    };
    const original = structuredClone(scenario);
    const db = database([[total('240')], [total('90')]]);
    mocks.snapshot.mockImplementation((read: (snapshot: Db) => unknown) => read(db.snapshot));
    const result = await executeFinancialScenario(org, scenario, [
      { role: 'user', content: 'Add a $20 setup to February spending.' },
    ]);
    const refs = result.evidence.flatMap((table) => table.rows.map((row) => row.factRef));
    expect(refs).toEqual([
      { kind: 'query_row', queryId: 'january', rowId: 'total:total' },
      { kind: 'query_row', queryId: 'february', rowId: 'total:total' },
      { kind: 'assumption', assumptionId: 'setup' },
      { kind: 'calculation', calculationId: 'change' },
      { kind: 'calculation', calculationId: 'with_setup' },
    ]);
    expect(result.evidence.map((table) => table.source)).toEqual([
      'posted',
      'posted',
      'scenario',
      'posted',
      'scenario',
    ]);
    expect(result.evidence.at(-2)!.rows[0]).toEqual({
      label: 'Calculation 1: $90.00 USD − $240.00 USD',
      value: '-$150.00 USD',
      factRef: { kind: 'calculation', calculationId: 'change' },
    });
    expect(result.evidence.at(-1)!.rows[0]).toEqual({
      label: 'Calculation 2: $90.00 USD + $20.00 USD',
      value: '$110.00 USD',
      factRef: { kind: 'calculation', calculationId: 'with_setup' },
    });
    const changed = result.facts.find((fact) => 'kind' in fact && fact.id === 'change');
    expect(changed).toMatchObject({
      value: '-150.00',
      source: 'posted',
      hypothetical: false,
      provenance: {
        assumptionIds: [],
        queryRows: [
          { id: 'february', rowId: 'total:total', field: 'value' },
          { id: 'january', rowId: 'total:total', field: 'value' },
        ],
      },
    });
    expect(scenario).toEqual(original);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  });

  it('keeps calculation identity stable when source-based table grouping changes visible order', async () => {
    const posted = plan('posted');
    const draft = plan('draft', { status: 'DRAFT' });
    const db = database([[total('12')], [total('3')]]);
    const queryResult = await executeFinancialAnalysis(org, { queries: [posted, draft] }, db.snapshot);
    const result = evaluateFinancialScenario(
      {
        queries: [posted, draft],
        assumptions: [],
        calculations: [
          { id: 'draft_one', operation: 'add', operands: [ref('posted'), ref('draft')] },
          { id: 'books', operation: 'add', operands: [ref('posted'), ref('posted')] },
          { id: 'draft_two', operation: 'subtract', operands: [ref('posted'), ref('draft')] },
        ],
      },
      queryResult.facts,
      [{ role: 'user', content: 'Compare posted and draft amounts.' }],
    );
    expect(result.evidence.map((table) => table.source)).toEqual(['draft', 'posted']);
    expect(result.evidence.flatMap((table) => table.rows.map((row) => row.factRef))).toEqual([
      { kind: 'calculation', calculationId: 'draft_one' },
      { kind: 'calculation', calculationId: 'draft_two' },
      { kind: 'calculation', calculationId: 'books' },
    ]);
    const tables = structuredClone(result.evidence).reverse();
    for (const table of tables)
      for (const row of table.rows.reverse()) {
        expect(row.factRef?.kind).toBe('calculation');
        if (row.factRef?.kind !== 'calculation') throw new Error('Missing calculation reference');
        const calculationId = row.factRef.calculationId;
        const fact = result.facts.find((fact) => 'kind' in fact && fact.id === calculationId);
        expect(fact).toBeDefined();
      }
  });

  it('does not accept model-supplied evidence fields as query or scenario authority', async () => {
    const db = database([]);
    await expect(
      executeFinancialAnalysis(
        org,
        {
          queries: [
            { ...plan('forged'), factSource: { kind: 'query_result', queryId: 'trusted', truncated: false } },
          ],
        },
        db.snapshot,
      ),
    ).rejects.toThrow();
    expect(db.query).not.toHaveBeenCalled();
    expect(() =>
      evaluateFinancialScenario(
        {
          queries: [],
          assumptions: [{ id: 'setup', value: '20', unit: 'USD', sourceText: '$20 setup' }],
          calculations: [
            {
              id: 'double',
              operation: 'add',
              operands: [assumption('setup'), assumption('setup')],
              factRef: { kind: 'calculation', calculationId: 'trusted' },
            },
          ],
        },
        [],
        [{ role: 'user', content: '$20 setup' }],
      ),
    ).toThrow();
  });

  it('keeps legacy evidence structurally compatible without pretending it has source references', () => {
    const legacy: InsightEvidence = {
      title: 'Legacy',
      period: 'January',
      rows: [{ label: 'Total', value: '$240.00' }],
      href: '/reports',
    };
    expect(legacy.factSource).toBeUndefined();
    expect(legacy.rows[0].factRef).toBeUndefined();
  });

  it('observes the execution chart once after every result is built and isolates observer mutation', async () => {
    const archivedChild: AnalysisAccount = {
      ...supplies,
      id: '00000000-0000-4000-8000-000000000004',
      code: '5040',
      name: 'Archived printing',
      archived: true,
    };
    const accounts = [supplies, archivedChild];
    const original = structuredClone(accounts);
    const db = database([[total('240')], [total('90')]], accounts);
    const observer = vi.fn((chart: AnalysisAccount[]) => {
      // Two settings, one chart and both result reads already completed.
      expect(db.query).toHaveBeenCalledTimes(5);
      expect(chart).toEqual(original);
      expect(chart).not.toBe(accounts);
      chart[0].name = 'Observer must not overwrite presentation';
      chart[0].id = archivedChild.id;
      chart.pop();
    });
    const result = await executeFinancialAnalysis(
      org,
      { queries: [plan('first'), plan('second')] },
      db.snapshot,
      { onExecutionChart: observer },
    );
    expect(observer).toHaveBeenCalledTimes(1);
    expect(accounts).toEqual(original);
    expect(db.query).toHaveBeenCalledTimes(5);
    expect(result.facts[0].scope.resolvedAccountIds).toEqual([supplies.id]);
    expect(result.evidence[0].title).toContain('Office supplies');
    expect(result).not.toHaveProperty('chart');
    expect(result).not.toHaveProperty('onExecutionChart');
  });

  it('does not publish an execution chart after an incomplete or rejected query set', async () => {
    const observer = vi.fn();
    const db = database([[total('240')]]);
    await expect(
      executeFinancialAnalysis(org, { queries: [plan('first'), plan('second')] }, db.snapshot, {
        onExecutionChart: observer,
      }),
    ).rejects.toThrow('Unexpected extra amount read');
    expect(observer).not.toHaveBeenCalled();
    const invalidDb = database([]);
    await expect(
      executeFinancialAnalysis(
        org,
        { queries: [plan('wrong', { accountCodes: ['9999'] })] },
        invalidDb.snapshot,
        { onExecutionChart: observer },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_ACCOUNT' });
    expect(observer).not.toHaveBeenCalled();
  });

  it('forwards the observer through scenario execution without adding a query or serialized chart', async () => {
    const db = database([[total('240')]]);
    mocks.snapshot.mockImplementation((read: (snapshot: Db) => unknown) => read(db.snapshot));
    const observer = vi.fn();
    const result = await executeFinancialScenario(
      org,
      {
        queries: [plan('amount')],
        assumptions: [],
        calculations: [{ id: 'double', operation: 'add', operands: [ref('amount'), ref('amount')] }],
      },
      [{ role: 'user', content: 'Double this recorded amount.' }],
      { onExecutionChart: observer },
    );
    expect(observer).toHaveBeenCalledExactlyOnceWith([supplies]);
    expect(db.query).toHaveBeenCalledTimes(4);
    expect(result.facts.at(-1)).toMatchObject({ id: 'double', value: '480.00' });
    expect(result).not.toHaveProperty('chart');
  });

  it('keeps pure-assumption scenarios independent of a database chart or observer', async () => {
    const observer = vi.fn();
    const result = await executeFinancialScenario(
      org,
      {
        queries: [],
        assumptions: [{ id: 'setup', value: '20', unit: 'USD', sourceText: '$20 setup' }],
        calculations: [
          { id: 'double', operation: 'add', operands: [assumption('setup'), assumption('setup')] },
        ],
      },
      [{ role: 'user', content: 'Double the $20 setup.' }],
      { onExecutionChart: observer },
    );
    expect(observer).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(result.facts.at(-1)).toMatchObject({ id: 'double', value: '40.00', hypothetical: true });
  });

  it('exposes the same normalized original-user assumption evidence as the existing calculator', () => {
    const source = { id: 'duration', value: '3', unit: 'months', sourceText: '3 months' };
    const messages = [{ role: 'user' as const, content: '📅 Plan for three months.' }];
    const evidence = scenarioAssumptionEvidence(source, messages);
    expect(evidence).toMatchObject({
      id: 'duration',
      value: '3',
      unit: 'months',
      sourceText: 'three months',
      userMessageIndex: 0,
      sourceStart: 12,
      sourceEnd: 24,
      normalization: 'english_cardinal',
    });
    expect(messages[0].content.slice(evidence.sourceStart, evidence.sourceEnd)).toBe('three months');
    const result = evaluateFinancialScenario(
      {
        queries: [],
        assumptions: [source],
        calculations: [
          {
            id: 'double',
            operation: 'add',
            operands: [assumption('duration'), assumption('duration')],
          },
        ],
      },
      [],
      messages,
    );
    expect(result.facts.at(-1)).toMatchObject({ assumptions: [evidence], value: '6' });
    expect(evidence).not.toHaveProperty('exact');
  });

  it('keeps assistant text and mismatched quantities invalid through the assumption evidence helper', () => {
    const source = { id: 'setup', value: '20', unit: 'USD', sourceText: '$20 setup' };
    expect(() =>
      scenarioAssumptionEvidence(source, [
        { role: 'user', content: 'There is a setup charge; its amount is unknown.' },
        { role: 'assistant', content: 'Assume a $20 setup.' },
      ]),
    ).toThrow('verify');
    expect(() =>
      scenarioAssumptionEvidence({ ...source, value: '25' }, [{ role: 'user', content: 'Use a $20 setup.' }]),
    ).toThrow('quoted number');
  });

  it('distinguishes equal quantities whose quotes overlap only incidental one-time wording', () => {
    const content = 'Use $450 one-time $450 setup, plus $20.';
    const messages = [{ role: 'user' as const, content }];
    const first = scenarioAssumptionQuantityEvidence(
      { id: 'first', value: '450', unit: 'USD', sourceText: '$450 one-time' },
      messages,
    );
    const second = scenarioAssumptionQuantityEvidence(
      { id: 'second', value: '450', unit: 'USD', sourceText: 'one-time $450 setup' },
      messages,
    );
    expect(
      content.slice(
        Math.max(first.sourceStart!, second.sourceStart!),
        Math.min(first.sourceEnd!, second.sourceEnd!),
      ),
    ).toBe('one-time');
    expect([first.quantityStart, first.quantityEnd]).toEqual([5, 8]);
    expect([second.quantityStart, second.quantityEnd]).toEqual([19, 22]);
    expect(content.slice(first.quantityStart, first.quantityEnd)).toBe('450');
    expect(content.slice(second.quantityStart, second.quantityEnd)).toBe('450');
  });

  it('gives short and expanded quotes of the same amount one exact quantity occurrence', () => {
    const messages = [{ role: 'user' as const, content: 'Use a one-time $450 setup, plus $20.' }];
    const short = scenarioAssumptionQuantityEvidence(
      { id: 'setup', value: '450', unit: 'USD', sourceText: '$450' },
      messages,
    );
    const expanded = scenarioAssumptionQuantityEvidence(
      { id: 'setup', value: '450', unit: 'USD', sourceText: 'one-time $450 setup' },
      messages,
    );
    expect([short.quantityStart, short.quantityEnd]).toEqual([16, 19]);
    expect([expanded.quantityStart, expanded.quantityEnd]).toEqual([16, 19]);
    const ordinary = scenarioAssumptionEvidence(
      { id: 'setup', value: '450', unit: 'USD', sourceText: '$450' },
      messages,
    );
    expect(ordinary).not.toHaveProperty('quantityStart');
    expect(ordinary).not.toHaveProperty('quantityEnd');
  });

  it.each([
    {
      content: '📅 Plan for twenty-one employees.',
      quote: '21 employees',
      value: '21',
      unit: 'count',
      start: 12,
      end: 22,
      token: 'twenty-one',
    },
    {
      content: 'Apply eighteen percent burden.',
      quote: '18 percent burden',
      value: '0.18',
      unit: 'ratio',
      start: 6,
      end: 14,
      token: 'eighteen',
    },
    {
      content: '📅 Apply 18% burden.',
      quote: '18% burden',
      value: '0.18',
      unit: 'ratio',
      start: 9,
      end: 11,
      token: '18',
    },
    {
      content: 'Use $1,250.50 setup.',
      quote: '$1,250.50 setup',
      value: '1250.50',
      unit: 'USD',
      start: 5,
      end: 13,
      token: '1,250.50',
    },
  ])(
    'retains original UTF-16 quantity bounds for $quote',
    ({ content, quote, value, unit, start, end, token }) => {
      const result = scenarioAssumptionQuantityEvidence({ id: 'quantity', value, unit, sourceText: quote }, [
        { role: 'user', content },
      ]);
      expect([result.quantityStart, result.quantityEnd]).toEqual([start, end]);
      expect(content.slice(result.quantityStart, result.quantityEnd)).toBe(token);
      expect(result.quantityStart).toBeGreaterThanOrEqual(result.sourceStart!);
      expect(result.quantityEnd).toBeLessThanOrEqual(result.sourceEnd!);
    },
  );

  it('does not expose a quantity occurrence when the original assumption fails validation', () => {
    expect(() =>
      scenarioAssumptionQuantityEvidence(
        { id: 'setup', value: '450', unit: 'USD', sourceText: '$450 setup' },
        [
          { role: 'user', content: 'Setup amount is unknown.' },
          { role: 'assistant', content: 'Use $450 setup.' },
        ],
      ),
    ).toThrow('verify');
  });

  it('shares complete month-count validation including a zero month and rejects incomplete evidence', async () => {
    const db = database([
      [
        {
          row_id: '2026-01',
          label: 'January',
          value: '90',
          entry_count: '1',
          period_from: '2026-01-01',
          period_to: '2026-01-31',
        },
        {
          row_id: '2026-02',
          label: 'February',
          value: '0',
          entry_count: '0',
          period_from: '2026-02-01',
          period_to: '2026-02-28',
        },
        {
          row_id: '2026-03',
          label: 'March',
          value: '30',
          entry_count: '1',
          period_from: '2026-03-01',
          period_to: '2026-03-31',
        },
      ],
    ]);
    const result = await executeFinancialAnalysis(
      org,
      {
        queries: [plan('months', { groupBy: 'month', to: '2026-03-31' })],
      },
      db.snapshot,
    );
    const fact = result.facts[0];
    const unchanged = structuredClone(fact);
    expect(scenarioCalendarMonthCount(fact)).toBe('3');
    expect(fact).toEqual(unchanged);
    expect(() => scenarioCalendarMonthCount({ ...fact, truncated: true })).toThrow('complete monthly flow');
    expect(() => scenarioCalendarMonthCount({ ...fact, rows: [fact.rows[0], fact.rows[2]] })).toThrow(
      'every month',
    );
    const partial = structuredClone(fact);
    partial.rows[0].from = '2026-01-02';
    expect(() => scenarioCalendarMonthCount(partial)).toThrow('calendar coverage');
  });
});
