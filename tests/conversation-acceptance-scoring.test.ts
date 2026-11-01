import { describe, expect, it } from 'vitest';
import { assessTurn, type ScoringContext } from '../scripts/conversation-acceptance/scoring';
import { accounts } from './conversation-acceptance/book';
import { cases } from './conversation-acceptance/cases';
import { evaluateFinancialScenario } from '../server/financial-calculation';
import type { AnalysisFacts } from '../server/financial-analysis';

const context: ScoringContext = {
  caseId: 'C07',
  turnIndex: 0,
  org: 'evaluation-org',
  chart: accounts.map((a) => ({
    ...a,
    id: `account-${a.code}`,
    is_cash: a.cash,
    is_group: false,
    parent_id: null,
  })),
  messages: [{ role: 'user', content: cases.find((c) => c.id === 'C07')!.turns[0].user }],
};
const expected = cases.find((c) => c.id === 'C07')!.turns[0].expected;
const factStatus = (response: unknown) => assessTurn(expected, response, context).facts[0];

function analysis() {
  const plan = {
    id: 'supplies',
    metric: 'net_expense',
    aggregation: 'sum',
    from: '2026-10-01',
    to: '2026-10-31',
    accountCodes: ['5030'],
    cooccurringAccountCodes: [],
    status: 'POSTED',
    currencyMode: 'base',
    currency: null,
    counterparty: { mode: 'any', value: '' },
    descriptionSearch: '',
    minimumAmount: null,
    maximumAmount: null,
    groupBy: 'total',
    order: 'label_asc',
    limit: 50,
  };
  return {
    answer: 'Office supplies: $340.00. October 2026.',
    query: { name: 'financial_analysis', args: { queries: [plan] } },
    facts: [
      {
        queryId: plan.id,
        metric: plan.metric,
        aggregation: plan.aggregation,
        grain: 'total',
        unit: 'USD',
        currency: 'USD',
        truncated: false,
        rows: [
          {
            rowId: 'total:total',
            label: 'Total',
            value: '340.00',
            entryCount: '2',
            from: plan.from,
            to: plan.to,
          },
        ],
        scope: {
          organizationId: context.org,
          plan,
          resolvedAccountIds: ['account-5030'],
          cooccurringAccountIds: [],
          statusMeaning: 'booked',
          amountBasis: 'selected_metric_base_lines',
        },
      },
    ],
    evidence: [
      {
        title: 'Net expenses · Office supplies',
        period: '2026-10-01 → 2026-10-31',
        source: 'posted',
        factSource: { kind: 'query_result', queryId: plan.id, truncated: false },
        rows: [
          {
            label: 'Total',
            value: '$340.00',
            factRef: { kind: 'query_row', queryId: plan.id, rowId: 'total:total' },
          },
        ],
      },
    ],
  };
}

function narrow() {
  return {
    answer: 'You recorded $340.00 USD in Office supplies expenses from October 1 to October 31.',
    query: {
      name: 'expense_by_account',
      args: { accountCode: '5030', from: '2026-10-01', to: '2026-10-31' },
    },
    evidence: [
      {
        title: 'Expenses · Office supplies',
        period: '2026-10-01 → 2026-10-31',
        rows: [
          {
            label: 'Office supplies',
            value: '$340.00',
            href: '/accounts?account=account-5030&from=2026-10-01&to=2026-10-31',
          },
        ],
      },
    ],
  };
}

function scenario() {
  const c = cases.find((c) => c.id === 'C01')!;
  const messages: ScoringContext['messages'] = [
    { role: 'user', content: c.turns[0].user },
    { role: 'assistant', content: 'Do you mean the financial impact?' },
    { role: 'user', content: c.turns[1].user },
  ];
  const assumption = (id: string) => ({ source: 'assumption', id, rowId: null, field: 'value' });
  const plan = {
    queries: [],
    assumptions: [
      { id: 'monthly', value: '4000', unit: 'USD_per_month', sourceText: '$4,000 per month' },
      { id: 'duration', value: '3', unit: 'months', sourceText: '3 months' },
      { id: 'fee', value: '2000', unit: 'USD', sourceText: '$2,000 one-off cost' },
    ],
    calculations: [
      { id: 'gross', operation: 'multiply', operands: [assumption('monthly'), assumption('duration')] },
      {
        id: 'net',
        operation: 'subtract',
        operands: [{ source: 'calculation', id: 'gross', rowId: null, field: 'value' }, assumption('fee')],
      },
    ],
  };
  return {
    response: evaluateFinancialScenario(plan, [], messages),
    expected: c.turns[1].expected,
    context: { ...context, caseId: 'C01', turnIndex: 1, messages },
  };
}

describe('conversational acceptance partial financial assessment; no model calls', () => {
  it('verifies exact analysis facts but always leaves semantic review pending', () => {
    const result = assessTurn(expected, analysis(), context);
    expect(result.facts[0].status).toBe('verified');
    expect(result.status).toBe('needs_review');
    expect(result.semanticReview.length).toBe(expected.requires.length + expected.forbids.length);
    expect(result.semanticReview.every((item) => item.status === 'pending_review')).toBe(true);
  });
  it('accepts the application USD display suffix without weakening scope', () => {
    const response = analysis();
    response.evidence[0].rows[0].value += ' USD';
    expect(factStatus(response).status).toBe('verified');
  });
  it.each([
    'wrong_number',
    'wrong_account',
    'wrong_period',
    'draft',
    'foreign_org',
    'vendor_filter',
    'truncated',
  ])('rejects %s even when the response and plan are structurally plausible', (mutation) => {
    const response = analysis(),
      fact = response.facts[0],
      p = fact.scope.plan;
    if (mutation === 'wrong_number') {
      fact.rows[0].value = '7000.00';
      response.evidence[0].rows[0].value = '$7,000.00';
    }
    if (mutation === 'wrong_account') p.accountCodes = ['5010'];
    if (mutation === 'wrong_period') p.from = '2026-09-01';
    if (mutation === 'draft') p.status = 'DRAFT';
    if (mutation === 'foreign_org') fact.scope.organizationId = 'another-org';
    if (mutation === 'vendor_filter') p.counterparty = { mode: 'exact', value: 'Acme' };
    if (mutation === 'truncated') fact.truncated = true;
    expect(factStatus(response).status).toBe('failed');
  });
  it('does not certify a hidden result, wrong reference or changed display', () => {
    for (const change of ['missing', 'wrong_ref', 'wrong_display']) {
      const response = analysis();
      if (change === 'missing') response.evidence = [];
      if (change === 'wrong_ref') response.evidence[0].rows[0].factRef.rowId = 'another-row';
      if (change === 'wrong_display') response.evidence[0].rows[0].value = '$999.00';
      expect(factStatus(response).status).toBe('failed');
    }
  });
  it('verifies narrow report account URLs and scope instead of number coincidence', () => {
    const response = narrow();
    expect(factStatus(response).status).toBe('verified');
    response.query.args.accountCode = '5010';
    expect(factStatus(response).status).toBe('failed');
  });
  it('leaves unrecognized display or output representations unresolved', () => {
    const response = narrow();
    response.evidence[0].rows[0].value = 'three hundred forty dollars';
    expect(factStatus(response).status).toBe('needs_review');
    expect(factStatus({ futureVersion: true }).status).toBe('needs_review');
    expect(
      factStatus({ answer: '$340 in supplies', evidence: [], query: { name: 'future_report', args: {} } })
        .status,
    ).toBe('needs_review');
  });
  it('does not accept prose-only arithmetic or a guessed amount for a computable question', () => {
    expect(
      factStatus({ answer: 'It is $340.', evidence: [], query: { name: 'discuss_business', args: {} } })
        .status,
    ).toBe('failed');
  });
  it('keeps even a schema-valid apparently helpful explanation pending semantic review', () => {
    const e = cases.find((c) => c.id === 'C30')!.turns[0].expected;
    const result = assessTurn(
      e,
      {
        answer: 'Profit is not cash. Your company lost money in October.',
        evidence: [],
        query: { name: 'discuss_business', args: { kind: 'explanation' } },
      },
      { ...context, caseId: 'C30' },
    );
    expect(result.facts).toEqual([]);
    expect(result.status).toBe('needs_review');
    expect(
      result.semanticReview.some(
        (r) => r.criterionId === 'no_ungrounded_company_assertion' && r.status === 'pending_review',
      ),
    ).toBe(true);
  });
  it('checks the actual application scenario representation, source quotes and formula', () => {
    const s = scenario();
    const result = assessTurn(s.expected, s.response, s.context);
    expect(result.facts[0]).toMatchObject({
      status: 'verified',
      reason: 'USER_SOURCED_MONTHLY_TIMES_MONTHS_MINUS_FEE',
    });
    expect(result.status).toBe('needs_review');
  });
  it('rejects assistant-sourced assumptions even with the right number', () => {
    const s = scenario();
    const last = s.response.facts.at(-1)!;
    if (!('assumptions' in last)) throw new Error('wrong fixture');
    last.assumptions[0].userMessageIndex = 1;
    expect(assessTurn(s.expected, s.response, s.context).facts[0].status).toBe('failed');
  });
  it('rejects scenario value relabeled as recorded books', () => {
    const s = scenario();
    const last = s.response.facts.at(-1)!;
    if (!('source' in last)) throw new Error('wrong fixture');
    last.source = 'posted';
    last.hypothetical = false;
    s.response.evidence.at(-1)!.source = 'posted';
    expect(assessTurn(s.expected, s.response, s.context).facts[0].status).toBe('failed');
  });
  it('does not accept the old fee after the user corrects it', () => {
    const s = scenario(),
      c = cases.find((c) => c.id === 'C01')!;
    s.context.turnIndex = 2;
    s.context.messages.push(
      { role: 'assistant', content: s.response.answer },
      { role: 'user', content: c.turns[2].user },
    );
    expect(assessTurn(c.turns[2].expected, s.response, s.context).facts[0].status).toBe('failed');
  });
  it('handles independent narrow cash and income evidence with actual account identity', () => {
    const e = cases.find((c) => c.id === 'C14')!.turns[0].expected;
    const cash = {
      answer: 'Recorded cash is $22,840.00 USD.',
      query: { name: 'cash_position', args: { asOf: '2026-10-31' } },
      evidence: [
        {
          title: 'Cash position',
          period: 'As of 2026-10-31',
          rows: [
            {
              label: 'Operating bank',
              value: '$22,840.00',
              href: '/accounts?account=account-1000&from=0001-01-01&to=2026-10-31',
            },
          ],
        },
      ],
    };
    expect(assessTurn({ ...e, requiredFacts: ['oct_cash'] }, cash, context).facts[0].status).toBe('verified');
    cash.evidence[0].rows[0].href = '/accounts?account=account-1100&from=0001-01-01&to=2026-10-31';
    expect(assessTurn({ ...e, requiredFacts: ['oct_cash'] }, cash, context).facts[0].status).not.toBe(
      'verified',
    );
    const profit = {
      answer: 'October net profit was $9,000.00 USD.',
      query: { name: 'income_summary', args: { metric: 'profit', from: '2026-10-01', to: '2026-10-31' } },
      evidence: [
        {
          title: 'Net profit',
          period: '2026-10-01 → 2026-10-31',
          rows: [{ label: 'Net profit', value: '$9,000.00' }],
        },
      ],
    };
    expect(assessTurn({ ...e, requiredFacts: ['oct_profit'] }, profit, context).facts[0].status).toBe(
      'verified',
    );
    profit.query.args.metric = 'revenue';
    expect(assessTurn({ ...e, requiredFacts: ['oct_profit'] }, profit, context).facts[0].status).toBe(
      'failed',
    );
  });
  it('checks requested quiet months as actual visible rows', () => {
    const response = analysis(),
      fact = response.facts[0],
      p = fact.scope.plan;
    p.from = '2026-07-01';
    p.groupBy = 'month';
    fact.grain = 'month';
    fact.rows = [
      {
        rowId: 'month:2026-07',
        label: '2026-07',
        value: '0.00',
        entryCount: '0',
        from: '2026-07-01',
        to: '2026-07-31',
      },
    ];
    response.evidence[0].rows = [
      {
        label: '2026-07',
        value: '$0.00',
        factRef: { kind: 'query_row', queryId: 'supplies', rowId: 'month:2026-07' },
      },
    ];
    const e = { ...expected, requiredFacts: ['jul_supplies'] };
    expect(assessTurn(e, response, context).facts[0].status).toBe('verified');
    fact.rows = [];
    expect(assessTurn(e, response, context).facts[0].status).toBe('failed');
  });
  it('proves subtraction order from two source-bound query operands', () => {
    const supplies = analysis(),
      rent = analysis();
    const rentFact = rent.facts[0];
    rentFact.queryId = 'rent';
    rentFact.scope.plan.id = 'rent';
    rentFact.scope.plan.accountCodes = ['5010'];
    rentFact.scope.resolvedAccountIds = ['account-5010'];
    rentFact.rows[0].value = '2400.00';
    rent.evidence[0].factSource.queryId = 'rent';
    rent.evidence[0].rows[0].factRef.queryId = 'rent';
    rent.evidence[0].rows[0].value = '$2,400.00';
    const reference = (id: string) => ({ source: 'query', id, rowId: 'total:total', field: 'value' });
    const plan = {
      queries: [rentFact.scope.plan, supplies.facts[0].scope.plan],
      assumptions: [],
      calculations: [
        { id: 'difference', operation: 'subtract', operands: [reference('rent'), reference('supplies')] },
      ],
    };
    const evaluated = evaluateFinancialScenario(
      plan,
      [rentFact, supplies.facts[0]] as AnalysisFacts[],
      context.messages,
    );
    const response = {
      ...evaluated,
      evidence: [...rent.evidence, ...supplies.evidence, ...evaluated.evidence],
    };
    const e = cases.find((c) => c.id === 'C08')!.turns[0].expected;
    expect(
      assessTurn(e, response, { ...context, caseId: 'C08' }).facts.every((f) => f.status === 'verified'),
    ).toBe(true);
    const last = response.facts.at(-1)!;
    if (!('operands' in last)) throw new Error('wrong fixture');
    last.operands.reverse();
    expect(assessTurn(e, response, { ...context, caseId: 'C08' }).facts.at(-1)!.status).toBe('failed');
  });
});
