import { describe, expect, it } from 'vitest';
import { checkFormulaProvenance } from '../../scripts/chat-evaluation/formula-scoring';
import { sameScope, type ScoredFact } from '../../scripts/chat-evaluation/scoring';
import type { EvaluationCase } from '../../scripts/chat-evaluation/types';
import type { ScenarioCalculationFact, ScenarioReference } from '../../server/financial-calculation';
const scope = { from: null, to: null, asOf: '2026-01-31', status: 'POSTED' };
const fact: ScoredFact = {
  metric: 'cash_balance',
  value: '500.00',
  unit: 'USD',
  scope,
  proof: { queryId: 'bank', rowId: 'total:total' },
};
const c: EvaluationCase = {
  id: 'synthetic-formula',
  split: 'development',
  family: 'scenario',
  commonCapability: false,
  messages: [
    {
      role: 'user',
      content:
        'Use $40 per month for 2 months, add 25% to that cost, and $5 setup. Start with January 31 cash.',
    },
  ],
  expected: {
    behavior: 'answer',
    answerableFromRecordedDataAndExplicitAssumptions: true,
    facts: [fact],
    requiredScope: {},
    clarificationTopics: [],
    notes: '',
    formulas: [
      {
        operation: 'sum',
        terms: [{ operation: 'product', terms: ['2', '40', '1.25'] }, '5'],
        value: '105.00',
        unit: 'USD',
      },
      { operation: 'difference', terms: ['500.00', '105.00'], value: '395.00', unit: 'USD' },
    ],
  },
};
const assumptions: ScenarioCalculationFact['assumptions'] = [
  { id: 'monthly', value: '40', unit: 'USD_per_month', sourceText: '$40 per month', userMessageIndex: 0 },
  { id: 'period', value: '2', unit: 'months', sourceText: '2 months', userMessageIndex: 0 },
  { id: 'rate', value: '0.25', unit: 'ratio', sourceText: '25%', userMessageIndex: 0 },
  { id: 'setup', value: '5', unit: 'USD', sourceText: '$5 setup', userMessageIndex: 0 },
];
const a = (id: string): ScenarioReference => ({ source: 'assumption', id, rowId: null, field: 'value' }),
  r = (id: string): ScenarioReference => ({ source: 'calculation', id, rowId: null, field: 'value' });
function node(
  id: string,
  operation: ScenarioCalculationFact['operation'],
  left: ScenarioReference,
  right: ScenarioReference,
  value: string,
): ScenarioCalculationFact {
  return {
    kind: 'scenario_calculation',
    id,
    operation,
    operands: [left, right],
    value,
    unit: 'USD',
    exact: { numerator: value, denominator: '1' },
    hypothetical: true,
    source: 'scenario',
    assumptions,
    provenance: { assumptionIds: assumptions.map((a) => a.id), queryRows: [] },
  };
}
function graph() {
  return [
    node('arbitrary_a', 'multiply', a('monthly'), a('period'), '80'),
    node('arbitrary_b', 'multiply', r('arbitrary_a'), a('rate'), '20'),
    node('arbitrary_c', 'add', r('arbitrary_a'), r('arbitrary_b'), '100'),
    node('arbitrary_d', 'add', r('arbitrary_c'), a('setup'), '105'),
    node(
      'arbitrary_e',
      'subtract',
      { source: 'query', id: 'bank', rowId: 'total:total', field: 'value' },
      r('arbitrary_d'),
      '395',
    ),
  ];
}
describe('sourced symbolic formula scoring (no model judge)', () => {
  it('accepts equivalent distributive arithmetic using actual source assumptions and ledger scope', () => {
    const out = checkFormulaProvenance(c, graph(), [fact], sameScope);
    expect(out.status).toBe('pass');
    expect(out.checks).toHaveLength(2);
  });
  it('rejects coincidentally correct reported numbers with the wrong operand structure', () => {
    const g = graph();
    g[3].operands = [r('arbitrary_a'), a('setup')];
    expect(checkFormulaProvenance(c, g, [fact], sameScope).status).not.toBe('pass');
  });
  it('does not interpret generated IDs as financial meaning', () => {
    const g = graph();
    for (const n of g) {
      n.id = 'cost_' + n.id;
      for (const o of n.operands) if (o.source === 'calculation') o.id = 'cost_' + o.id;
    }
    expect(checkFormulaProvenance(c, g, [fact], sameScope).status).toBe('pass');
  });
  it('withholds judgment on wrong-scope ledger facts, absent source quotes, and unsupported division forms', () => {
    expect(
      checkFormulaProvenance(c, graph(), [{ ...fact, scope: { ...scope, asOf: '2026-02-28' } }], sameScope)
        .status,
    ).not.toBe('pass');
    const g = structuredClone(graph());
    g[0].assumptions[0].sourceText = 'not in the user request';
    expect(checkFormulaProvenance(c, g, [fact], sameScope).status).toBe('needs_review');
    const d = graph();
    d[0].operation = 'divide';
    expect(checkFormulaProvenance(c, d, [fact], sameScope).status).toBe('needs_review');
  });
});
