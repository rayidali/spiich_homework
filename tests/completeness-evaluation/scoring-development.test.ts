/** Offline calibration on the FOUR explicitly development questions only.
 * No held-out loader, database connection or model call is used. */
import { describe, expect, it } from 'vitest';
import {
  loadCases,
  loadLedger,
  counterparties,
  referenceLedgerClaim,
} from '../../scripts/completeness-evaluation/fixtures';
import { scoreCompletenessResponse } from '../../scripts/completeness-evaluation/scoring';
import type {
  CompletenessCase,
  ExpectedClaim,
  ScoringContext,
} from '../../scripts/completeness-evaluation/types';
import {
  executeFinancialAnalysis,
  type AnalysisAccount,
  type FinancialQuery,
} from '../../server/financial-analysis';
import {
  evaluateFinancialScenario,
  type FinancialScenario,
  type ScenarioReference,
} from '../../server/financial-calculation';
import { prepareAnswerContract } from '../../server/answer-completion';
import { completeFinancialAnswer } from '../../server/completion-answer';
import { answerValueScopeSchema, type AnswerContract } from '../../server/answer-contract';
import { clarificationAnswer } from '../../server/chat-clarification';
import type { Db } from '../../server/db';
const fixture = loadLedger(),
  development = loadCases('development');
const org = '00000000-0000-4000-8000-000000000001';
const ids = new Map(
  fixture.accounts.map((a, i) => [a.code, `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`]),
);
const chart: AnalysisAccount[] = fixture.accounts.map((a) => ({
  id: ids.get(a.code)!,
  code: a.code,
  name: a.name,
  type: a.type,
  currency: a.currency,
  parent_id: a.parentCode ? ids.get(a.parentCode)! : null,
  is_group: a.isGroup,
  is_cash: a.isCash,
  archived: a.archived,
}));
const context: ScoringContext = {
  organizationId: org,
  chart,
  counterparties: counterparties(fixture),
  referenceLedgerClaim: (c) => referenceLedgerClaim(c, fixture),
};
type Ledger = Extract<ExpectedClaim, { kind: 'ledger' }>;
function plan(c: Ledger): FinancialQuery {
  return {
    id: c.id,
    metric: c.metric as FinancialQuery['metric'],
    aggregation: 'sum',
    from: c.scope.from,
    to: c.scope.asOf ?? c.scope.to!,
    status: c.scope.status,
    currencyMode: c.scope.currencyMode,
    currency: c.scope.currency as FinancialQuery['currency'],
    groupBy: 'total',
    accountCodes: c.scope.accountCodes,
    cooccurringAccountCodes: c.scope.cooccurringAccountCodes,
    counterparty: {
      mode: c.scope.counterparty.mode === 'identity' ? 'exact' : c.scope.counterparty.mode,
      value: c.scope.counterparty.value,
    },
    descriptionSearch: c.scope.descriptionSearch,
    minimumAmount: c.scope.minimumAmount,
    maximumAmount: c.scope.maximumAmount,
    order: 'label_asc',
    limit: 50,
  };
}
async function materialize(
  queries: FinancialQuery[],
  rows: { row_id: string; label: string; value: string; entry_count: string }[][],
) {
  let index = 0;
  const db = {
    query: async (sql: string) => {
      if (sql.startsWith('SET LOCAL')) return { rows: [] };
      if (sql.startsWith('SELECT id,code,name,type,currency')) return { rows: chart };
      if (sql.startsWith('WITH typed_input')) return { rows: rows[index++] };
      throw new Error('Unexpected offline fixture statement');
    },
  } as unknown as Db;
  return executeFinancialAnalysis(org, { queries }, db);
}
const total = (c: Ledger) => [{ row_id: 'total', label: 'Total', value: c.value, entry_count: '3' }];
const grade = (response: unknown, item: CompletenessCase) =>
  scoreCompletenessResponse(item, { response }, context);
function scenario(item: CompletenessCase, queries: FinancialQuery[]): FinancialScenario {
  const references = new Map(item.expected.required.map((c) => [c.id, c.kind]));
  return {
    queries,
    assumptions: [],
    calculations: item.expected.required.flatMap((c) => {
      if (c.kind !== 'calculation') return [];
      if (!('operation' in c.formula)) throw new Error('Development formula shape changed');
      const operands = c.formula.operands.map((operand): ScenarioReference => {
        if (!('claim' in operand)) throw new Error('Unexpected development assumption');
        return references.get(operand.claim) === 'ledger'
          ? { source: 'query', id: operand.claim, rowId: 'total:total', field: 'value' }
          : { source: 'calculation', id: operand.claim, rowId: null, field: 'value' };
      });
      return [{ id: c.id, operation: c.formula.operation, operands }];
    }),
  };
}

describe('Fresh development fixture and scorer calibration (no inference)', () => {
  it('D01 retains the earlier vendor/category while changing the month', async () => {
    const item = development.find((c) => c.id === 'D01')!,
      claim = item.expected.required[0] as Ledger,
      q = plan(claim),
      result = await materialize([q], [total(claim)]);
    expect(
      grade({ ...result, query: { name: 'financial_analysis', args: { queries: [q] } } }, item),
    ).toMatchObject({ passed: true, matchedClaims: [claim.id] });
    const dropped = { ...q, counterparty: { mode: 'any' as const, value: '' } };
    const wrongValue = referenceLedgerClaim(
      { ...claim, scope: { ...claim.scope, counterparty: dropped.counterparty } },
      fixture,
    );
    if (wrongValue.status === 'unsupported') throw new Error('Development oracle incomplete');
    const bad = await materialize([dropped], [[{ ...total(claim)[0], value: wrongValue.value }]]);
    expect(
      grade({ ...bad, query: { name: 'financial_analysis', args: { queries: [dropped] } } }, item).passed,
    ).toBe(false);
  });
  it('D02 accepts a visible leader from a complete ranking and its exact two-period calculation', async () => {
    const item = development.find((c) => c.id === 'D02')!,
      leader = item.expected.required[0] as Ledger,
      later = item.expected.required[1] as Ledger;
    const ranking = {
      ...plan(leader),
      id: 'ranking',
      groupBy: 'counterparty' as const,
      order: 'value_desc' as const,
      counterparty: { mode: 'any' as const, value: '' },
    };
    const rankClaims = [
      leader,
      ...item.expected.supporting.filter((c): c is Ledger => c.kind === 'ledger'),
    ].sort((a, b) => Number(b.value) - Number(a.value));
    const q = [ranking, plan(leader), plan(later)];
    const base = await materialize(q, [
      rankClaims.map((c) => ({
        row_id: c.scope.counterparty.value,
        label: c.scope.counterparty.value,
        value: c.value,
        entry_count: '1',
      })),
      total(leader),
      total(later),
    ]);
    const args = scenario(item, q);
    const result = evaluateFinancialScenario(args, base.facts, item.messages);
    expect(
      grade(
        {
          ...result,
          evidence: [...result.evidence, ...base.evidence],
          query: { name: 'financial_scenario', args },
        },
        item,
      ),
    ).toMatchObject({ passed: true, matchedTables: ['august_leader'] });
  });
  it('D03 all eight external outputs pass with reordered source tables and exact arithmetic', async () => {
    const item = development.find((c) => c.id === 'D03')!,
      claims = item.expected.required.filter((c): c is Ledger => c.kind === 'ledger'),
      queries = claims.map(plan),
      base = await materialize(queries, claims.map(total)),
      args = scenario(item, queries),
      result = evaluateFinancialScenario(args, base.facts, item.messages);
    expect(
      grade(
        {
          ...result,
          evidence: [...base.evidence.reverse(), ...result.evidence],
          query: { name: 'financial_scenario', args },
        },
        item,
      ),
    ).toMatchObject({ passed: true, matchedClaims: item.expected.required.map((c) => c.id) });
  });
  it('D03 real complete renderer plus generated arithmetic is graded without trusting its declaration/status', async () => {
    const item = development.find((c) => c.id === 'D03')!,
      claims = item.expected.required.filter((c): c is Ledger => c.kind === 'ledger'),
      queries = claims.map(plan),
      base = await materialize(queries, claims.map(total));
    const contract: AnswerContract = {
      outputs: item.expected.required.map((c) => ({
        id: c.id,
        sourceQuotes: [{ messageIndex: 0, quote: item.messages[0].content }],
        requirement:
          c.kind === 'ledger'
            ? {
                kind: 'value',
                scope: (() => {
                  const { id: _id, groupBy: _g, order: _o, limit: _l, ...scope } = plan(c);
                  return answerValueScopeSchema.parse(scope);
                })(),
                counterpartyFrom: null,
                selectedAccountCode: null,
              }
            : {
                kind: 'arithmetic',
                operation: 'operation' in c.formula ? c.formula.operation : 'add',
                operands:
                  'operation' in c.formula
                    ? c.formula.operands.map((p) => ({
                        source: 'output' as const,
                        id: 'claim' in p ? p.claim : 'invalid',
                      }))
                    : [],
              },
      })),
    };
    const prepared = prepareAnswerContract(contract, item.messages),
      bindings = queries.map((q) => ({
        outputId: q.id,
        source: { kind: 'query_row' as const, queryId: q.id, rowId: 'total:total' },
      }));
    const result = completeFinancialAnswer(org, { prepared, bindings, executionChart: chart }, base);
    expect(
      grade(
        {
          ...result,
          completion: { status: 'unassessed' },
          answerContract: { hash: 'ignored', contract: { outputs: [] } },
        },
        item,
      ),
    ).toMatchObject({ passed: true, matchedClaims: item.expected.required.map((c) => c.id) });
  });
  it('D04 valid code-composed missing-assumption clarification passes without any financial answer', () => {
    const item = development.find((c) => c.id === 'D04')!,
      args = { reason: 'missing_assumption', subject: 'analysis', accountCodes: [], limitation: 'forecast' };
    expect(
      grade(
        { answer: clarificationAnswer(args, chart), evidence: [], query: { name: 'request_details', args } },
        item,
      ),
    ).toMatchObject({ passed: true, classification: 'structured-correct' });
  });
});
