import { oracles } from '../../tests/conversation-acceptance/cases';
import type { Oracle, TurnExpectation } from '../../tests/conversation-acceptance/schema';

type ObjectValue = Record<string, unknown>;
export type ScoringContext = {
  caseId: string;
  turnIndex: number;
  messages: { role: 'user' | 'assistant'; content: string }[];
  org: string;
  chart: {
    id: string;
    code: string;
    name: string;
    type: string;
    currency: string;
    is_cash: boolean;
    is_group: boolean;
    parent_id?: string | null;
  }[];
};
export type FactAssessment = {
  id: string;
  status: 'verified' | 'failed' | 'needs_review';
  reason: string;
  references: string[];
};
export type TurnAssessment = {
  status: 'failed' | 'needs_review';
  facts: FactAssessment[];
  semanticReview: {
    criterionId: string;
    direction: 'required' | 'forbidden';
    status: 'pending_review';
    requirement: string;
  }[];
  limitations: string[];
};
type Recorded = Extract<Oracle, { kind: 'recorded' }>;
type Scenario = Extract<Oracle, { kind: 'scenario' }>;
type Candidate = {
  value: bigint;
  queryId: string;
  rowId: string;
  visible: boolean;
};
const object = (v: unknown): v is ObjectValue => v !== null && typeof v === 'object' && !Array.isArray(v);
const objects = (v: unknown): ObjectValue[] => (Array.isArray(v) ? v.filter(object) : []);
const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((item) => typeof item === 'string') ? v : null;
const equalSet = (a: string[], b: string[]) =>
  a.length === b.length && new Set(a).size === a.length && a.every((item) => b.includes(item));
function cents(v: unknown): bigint | null {
  if (typeof v !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(v)) return null;
  const sign = v.startsWith('-') ? -1n : 1n;
  const [whole, decimal = ''] = v.replace(/^-/, '').split('.');
  return sign * BigInt(whole + decimal.padEnd(2, '0'));
}
function displayedCents(v: unknown): bigint | null {
  if (typeof v !== 'string') return null;
  // Parse a whole display cell, not a number anywhere in prose. USD is optional
  // because the existing application displays both "$340.00" and "$340.00 USD".
  const match = /^(-?)\$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?: USD)?$/.exec(v);
  return match ? cents(`${match[1]}${match[2].replaceAll(',', '')}`) : null;
}
const assessment = (
  id: string,
  status: FactAssessment['status'],
  reason: string,
  references: string[] = [],
): FactAssessment => ({ id, status, reason, references });

function visibleRow(response: ObjectValue, queryId: string, rowId: string, value: bigint) {
  return objects(response.evidence).some(
    (table) =>
      table.source === 'posted' &&
      object(table.factSource) &&
      table.factSource.kind === 'query_result' &&
      table.factSource.queryId === queryId &&
      table.factSource.truncated === false &&
      objects(table.rows).some(
        (row) =>
          object(row.factRef) &&
          row.factRef.kind === 'query_row' &&
          row.factRef.queryId === queryId &&
          row.factRef.rowId === rowId &&
          displayedCents(row.value) === value,
      ),
  );
}
function expectedIds(oracle: Recorded, context: ScoringContext) {
  const types =
    oracle.metric === 'profit'
      ? ['REVENUE', 'EXPENSE']
      : oracle.metric === 'net_expense'
        ? ['EXPENSE']
        : ['ASSET'];
  return context.chart
    .filter(
      (account) =>
        !account.is_group &&
        types.includes(account.type) &&
        (oracle.metric !== 'cash_balance' || account.is_cash) &&
        (!oracle.accountCodes.length || oracle.accountCodes.includes(account.code)),
    )
    .map((account) => account.id);
}
function selectedPlanIds(plan: ObjectValue, context: ScoringContext): string[] | null {
  const codes = strings(plan.accountCodes);
  if (
    !codes ||
    new Set(codes).size !== codes.length ||
    codes.some((code) => !context.chart.some((a) => a.code === code))
  )
    return null;
  const roots = new Set(context.chart.filter((a) => codes.includes(a.code)).map((a) => a.id));
  const types =
    plan.metric === 'net_profit'
      ? ['REVENUE', 'EXPENSE']
      : plan.metric === 'net_expense'
        ? ['EXPENSE']
        : ['ASSET'];
  return context.chart
    .filter((a) => {
      if (a.is_group || !types.includes(a.type) || (plan.metric === 'cash_balance' && !a.is_cash))
        return false;
      if (!codes.length) return true;
      let current = a;
      const seen = new Set<string>();
      while (!seen.has(current.id)) {
        if (roots.has(current.id)) return true;
        seen.add(current.id);
        const parent = context.chart.find((item) => item.id === current.parent_id);
        if (!parent) return false;
        current = parent;
      }
      return false;
    })
    .map((a) => a.id);
}

/** Matching is against server-produced scope and row references, never label/amount coincidence. */
function analysisCandidates(
  oracle: Recorded,
  response: ObjectValue,
  context: ScoringContext,
): { candidates: Candidate[]; unsupported: boolean } {
  const candidates: Candidate[] = [];
  let unsupported = false;
  const metric = oracle.metric === 'profit' ? 'net_profit' : oracle.metric;
  for (const fact of objects(response.facts)) {
    if (fact.kind === 'scenario_calculation') continue;
    if (!object(fact.scope) || !object(fact.scope.plan) || !Array.isArray(fact.rows)) {
      unsupported = true;
      continue;
    }
    const p = fact.scope.plan;
    if (Array.isArray(p.groupBy) || !['total', 'account', 'month'].includes(String(p.groupBy))) {
      unsupported = true;
      continue;
    }
    const resolved = strings(fact.scope.resolvedAccountIds);
    const plannedIds = selectedPlanIds(p, context);
    if (
      fact.scope.organizationId !== context.org ||
      fact.metric !== metric ||
      p.metric !== metric ||
      fact.aggregation !== 'sum' ||
      p.aggregation !== 'sum' ||
      fact.grain !== p.groupBy ||
      fact.unit !== 'USD' ||
      fact.currency !== 'USD' ||
      fact.truncated !== false ||
      fact.scope.statusMeaning !== 'booked' ||
      fact.scope.amountBasis !==
        (oracle.metric === 'cash_balance'
          ? 'inception_to_closing_date_base_lines'
          : 'selected_metric_base_lines') ||
      p.status !== 'POSTED' ||
      p.currencyMode !== 'base' ||
      p.currency !== null ||
      p.descriptionSearch !== '' ||
      p.minimumAmount !== null ||
      p.maximumAmount !== null ||
      !equalSet(strings(p.cooccurringAccountCodes) ?? ['invalid'], []) ||
      !equalSet(strings(fact.scope.cooccurringAccountIds) ?? ['invalid'], []) ||
      !object(p.counterparty) ||
      (oracle.counterparty === null
        ? p.counterparty.mode !== 'any' || p.counterparty.value !== ''
        : p.counterparty.mode !== 'exact' || p.counterparty.value !== oracle.counterparty) ||
      !resolved ||
      !plannedIds ||
      !equalSet(resolved, plannedIds)
    )
      continue;
    if (oracle.metric === 'cash_balance') {
      const source = fact.scope.cashBalanceSource;
      if (
        !object(source) ||
        source.selection !== 'all_cash_asset_posting_accounts' ||
        !equalSet(
          objects(source.accounts).map((a) => String(a.id)),
          expectedIds(oracle, context),
        ) ||
        !equalSet(strings(p.accountCodes) ?? ['invalid'], []) ||
        p.from !== null
      )
        continue;
    }
    for (const row of objects(fact.rows)) {
      const value = cents(row.value);
      if (value === null || typeof row.rowId !== 'string' || typeof fact.queryId !== 'string') {
        unsupported = true;
        continue;
      }
      let ids = resolved;
      if (p.groupBy === 'account') {
        const account = context.chart.find((a) => `account:${a.id}` === row.rowId);
        if (!account || !resolved.includes(account.id)) continue;
        ids = [account.id];
      }
      if (!equalSet(ids, expectedIds(oracle, context))) continue;
      if (p.groupBy === 'month') {
        if (
          row.from !== oracle.from ||
          row.to !== oracle.to ||
          row.rowId !== `month:${oracle.to.slice(0, 7)}` ||
          typeof p.from !== 'string' ||
          typeof p.to !== 'string' ||
          p.from > oracle.from! ||
          p.to < oracle.to
        )
          continue;
      } else if (
        p.from !== oracle.from ||
        p.to !== oracle.to ||
        row.from !== oracle.from ||
        row.to !== oracle.to
      )
        continue;
      if (oracle.metric === 'cash_balance' && row.balanceAsOf !== oracle.to) continue;
      if (p.groupBy === 'total' && row.rowId !== 'total:total') continue;
      candidates.push({
        value,
        queryId: fact.queryId,
        rowId: row.rowId,
        visible: visibleRow(response, fact.queryId, row.rowId, value),
      });
    }
  }
  return { candidates, unsupported };
}

function narrowFact(oracle: Recorded, response: ObjectValue, context: ScoringContext): FactAssessment | null {
  if (!object(response.query) || !object(response.query.args)) return null;
  const { name, args } = response.query;
  if (!['expense_by_account', 'income_summary', 'cash_position'].includes(String(name))) return null;
  if (oracle.counterparty !== null)
    return assessment(oracle.id, 'failed', 'NARROW_TOOL_DROPPED_COUNTERPARTY');
  const tables = objects(response.evidence);
  const period = oracle.from ? `${oracle.from} → ${oracle.to}` : `As of ${oracle.to}`;
  if (tables.length !== 1 || tables[0].period !== period)
    return assessment(oracle.id, 'failed', 'VISIBLE_PERIOD_MISMATCH');
  const rows = objects(tables[0].rows);
  let value: bigint | null = null;
  if (name === 'expense_by_account') {
    if (
      oracle.metric !== 'net_expense' ||
      oracle.accountCodes.length !== 1 ||
      args.accountCode !== oracle.accountCodes[0] ||
      args.from !== oracle.from ||
      args.to !== oracle.to
    )
      return assessment(oracle.id, 'failed', 'QUERY_SCOPE_MISMATCH');
    const account = context.chart.find(
      (a) => a.code === args.accountCode && !a.is_group && a.type === 'EXPENSE',
    );
    if (!account) return assessment(oracle.id, 'needs_review', 'UNSUPPORTED_GROUP_OR_ACCOUNT');
    const expectedHref = `/accounts?account=${account.id}&from=${oracle.from}&to=${oracle.to}`;
    if (rows.length === 1 && rows[0].href === expectedHref && rows[0].label === account.name)
      value = displayedCents(rows[0].value);
  } else if (name === 'income_summary') {
    if (
      oracle.metric !== 'profit' ||
      oracle.accountCodes.length ||
      args.metric !== 'profit' ||
      args.from !== oracle.from ||
      args.to !== oracle.to
    )
      return assessment(oracle.id, 'failed', 'QUERY_SCOPE_MISMATCH');
    if (rows.length === 1 && rows[0].label === 'Net profit') value = displayedCents(rows[0].value);
  } else {
    if (oracle.metric !== 'cash_balance' || oracle.from !== null || args.asOf !== oracle.to)
      return assessment(oracle.id, 'failed', 'QUERY_SCOPE_MISMATCH');
    const expectedAccounts = context.chart.filter((a) => a.is_cash && !a.is_group && a.type === 'ASSET');
    if (
      rows.length === expectedAccounts.length &&
      expectedAccounts.every(
        (a) =>
          rows.filter(
            (r) =>
              r.href === `/accounts?account=${a.id}&from=0001-01-01&to=${oracle.to}` &&
              r.label === a.name &&
              displayedCents(r.value) !== null,
          ).length === 1,
      )
    )
      value = rows.reduce((total, row) => total + displayedCents(row.value)!, 0n);
  }
  if (value === null) return assessment(oracle.id, 'needs_review', 'UNSUPPORTED_NARROW_EVIDENCE_SHAPE');
  return assessment(
    oracle.id,
    value === BigInt(oracle.expectedCents) ? 'verified' : 'failed',
    value === BigInt(oracle.expectedCents) ? 'EXACT_NARROW_SCOPE_AND_VISIBLE_VALUE' : 'WRONG_VALUE',
    [`query:${name}`],
  );
}

function recordedFact(oracle: Recorded, response: ObjectValue, context: ScoringContext): FactAssessment {
  const { candidates, unsupported } = analysisCandidates(oracle, response, context);
  const exact = candidates.filter((c) => c.value === BigInt(oracle.expectedCents) && c.visible);
  if (candidates.some((c) => c.value !== BigInt(oracle.expectedCents)))
    return assessment(oracle.id, 'failed', 'WRONG_VALUE');
  if (exact.length)
    return assessment(
      oracle.id,
      'verified',
      'EXACT_ANALYSIS_SCOPE_AND_VISIBLE_VALUE',
      exact.map((c) => `query:${c.queryId}/${c.rowId}`),
    );
  if (candidates.length) return assessment(oracle.id, 'failed', 'RESULT_NOT_VISIBLE');
  const narrow = narrowFact(oracle, response, context);
  if (narrow) return narrow;
  if (unsupported) return assessment(oracle.id, 'needs_review', 'UNSUPPORTED_ANALYSIS_SHAPE');
  if (
    !object(response.query) ||
    ![
      'financial_analysis',
      'financial_scenario',
      'discuss_business',
      'request_details',
      'ask_clarification',
    ].includes(String(response.query.name))
  )
    return assessment(oracle.id, 'needs_review', 'UNSUPPORTED_RESPONSE_REPRESENTATION');
  return assessment(oracle.id, 'failed', 'REQUIRED_SCOPE_OR_RESULT_MISSING');
}

function calculationVisible(response: ObjectValue, fact: ObjectValue) {
  return objects(response.evidence).some(
    (table) =>
      table.source === fact.source &&
      objects(table.rows).some(
        (row) =>
          object(row.factRef) &&
          row.factRef.kind === 'calculation' &&
          row.factRef.calculationId === fact.id &&
          displayedCents(row.value) === cents(fact.value),
      ),
  );
}
function validExact(fact: ObjectValue) {
  const amount = cents(fact.value);
  return (
    amount !== null &&
    object(fact.exact) &&
    typeof fact.exact.numerator === 'string' &&
    /^-?\d+$/.test(fact.exact.numerator) &&
    typeof fact.exact.denominator === 'string' &&
    /^[1-9]\d*$/.test(fact.exact.denominator) &&
    BigInt(fact.exact.numerator) * 100n === amount * BigInt(fact.exact.denominator)
  );
}
function userTurnOf(messages: ScoringContext['messages'], messageIndex: number) {
  return messages.slice(0, messageIndex + 1).filter((m) => m.role === 'user').length - 1;
}
function assumptionField(assumption: ObjectValue, oracle: Scenario, context: ScoringContext): string | null {
  if (
    !Number.isInteger(assumption.userMessageIndex) ||
    !Number.isInteger(assumption.sourceStart) ||
    !Number.isInteger(assumption.sourceEnd) ||
    typeof assumption.sourceText !== 'string'
  )
    return null;
  const messageIndex = assumption.userMessageIndex as number;
  const message = context.messages[messageIndex];
  if (
    !message ||
    message.role !== 'user' ||
    (assumption.sourceStart as number) < 0 ||
    (assumption.sourceEnd as number) <= (assumption.sourceStart as number) ||
    message.content.slice(assumption.sourceStart as number, assumption.sourceEnd as number) !==
      assumption.sourceText
  )
    return null;
  for (const source of oracle.sources) {
    if (
      source.turn !== userTurnOf(context.messages, messageIndex) ||
      source.turn > context.turnIndex ||
      !assumption.sourceText.includes(source.quote)
    )
      continue;
    const unit =
      source.field === 'months' ? 'months' : source.field === 'monthlyCents' ? 'USD_per_month' : 'USD';
    const correct =
      source.field === 'months'
        ? assumption.value === String(oracle.months)
        : cents(assumption.value) === BigInt(oracle[source.field]);
    if (assumption.unit === unit && correct) return source.field;
  }
  return null;
}

function calculatedFact(
  oracle: Exclude<Oracle, Recorded>,
  response: ObjectValue,
  context: ScoringContext,
): FactAssessment {
  const calculations = objects(response.facts).filter((f) => f.kind === 'scenario_calculation');
  if (!calculations.length)
    return assessment(
      oracle.id,
      object(response.query) &&
        ['financial_scenario', 'financial_analysis', 'discuss_business', 'request_details'].includes(
          String(response.query.name),
        )
        ? 'failed'
        : 'needs_review',
      'REQUIRED_CALCULATION_MISSING',
    );
  const indexed = new Map(calculations.map((f) => [f.id, f]));
  if (indexed.size !== calculations.length)
    return assessment(oracle.id, 'needs_review', 'DUPLICATE_CALCULATION_ID');
  let sourceInvalid = false;
  let formulaUnsupported = false;
  for (const fact of calculations) {
    if (fact.unit !== 'USD' || cents(fact.value) !== BigInt(oracle.expectedCents)) continue;
    if (!validExact(fact) || !calculationVisible(response, fact)) continue;
    const operands = objects(fact.operands);
    if (fact.operation !== 'subtract' || operands.length !== 2 || operands.some((r) => r.field !== 'value')) {
      formulaUnsupported = true;
      continue;
    }
    if (oracle.kind === 'recorded_difference') {
      if (
        fact.source !== 'posted' ||
        fact.hypothetical !== false ||
        !Array.isArray(fact.assumptions) ||
        fact.assumptions.length
      ) {
        sourceInvalid = true;
        continue;
      }
      const sources = [oracle.left, oracle.right].map((id) => oracles.find((o) => o.id === id));
      const matched = operands.every((r, index) => {
        const source = sources[index];
        if (!source || source.kind !== 'recorded' || r.source !== 'query') return false;
        return analysisCandidates(source, response, context).candidates.some(
          (c) =>
            c.queryId === r.id &&
            c.rowId === r.rowId &&
            c.value === BigInt(source.expectedCents) &&
            c.visible,
        );
      });
      if (matched)
        return assessment(oracle.id, 'verified', 'ORDERED_RECORDED_SUBTRACTION', [
          `calculation:${String(fact.id)}`,
        ]);
      sourceInvalid = true;
    } else {
      if (
        oracle.caseId !== context.caseId ||
        fact.source !== 'scenario' ||
        fact.hypothetical !== true ||
        !object(fact.provenance) ||
        !Array.isArray(fact.provenance.queryRows) ||
        fact.provenance.queryRows.length
      ) {
        sourceInvalid = true;
        continue;
      }
      const assumptions = objects(fact.assumptions);
      const fields = new Map(assumptions.map((a) => [a.id, assumptionField(a, oracle, context)]));
      if (
        fields.size !== 3 ||
        [...fields.values()].some((field) => !field) ||
        new Set(fields.values()).size !== 3 ||
        !equalSet(strings(fact.provenance.assumptionIds) ?? [], [...fields.keys()].map(String))
      ) {
        sourceInvalid = true;
        continue;
      }
      const [left, fee] = operands;
      const product = indexed.get(left.id);
      if (
        left.source !== 'calculation' ||
        left.rowId !== null ||
        fee.source !== 'assumption' ||
        fee.rowId !== null ||
        fields.get(fee.id) !== 'oneOffCents' ||
        !product ||
        product.operation !== 'multiply' ||
        product.source !== 'scenario' ||
        product.hypothetical !== true ||
        !validExact(product)
      ) {
        formulaUnsupported = true;
        continue;
      }
      const productInputs = objects(product.operands);
      if (
        productInputs.length !== 2 ||
        productInputs.some((r) => r.source !== 'assumption' || r.rowId !== null || r.field !== 'value') ||
        !equalSet(
          productInputs.map((r) => String(fields.get(r.id))),
          ['monthlyCents', 'months'],
        ) ||
        cents(product.value) !== BigInt(oracle.monthlyCents) * BigInt(oracle.months)
      ) {
        sourceInvalid = true;
        continue;
      }
      return assessment(oracle.id, 'verified', 'USER_SOURCED_MONTHLY_TIMES_MONTHS_MINUS_FEE', [
        `calculation:${String(fact.id)}`,
      ]);
    }
  }
  if (sourceInvalid) return assessment(oracle.id, 'failed', 'CALCULATION_SOURCE_MISMATCH');
  if (formulaUnsupported) return assessment(oracle.id, 'needs_review', 'UNSUPPORTED_FORMULA_SHAPE');
  return assessment(oracle.id, 'failed', 'EXPECTED_VISIBLE_CALCULATION_MISSING');
}

/** This is deliberately not a complete semantic grader. Verified figures do not
 * certify prose, completeness beyond declared facts, or additional volunteered claims. */
export function assessTurn(
  expected: TurnExpectation,
  response: unknown,
  context: ScoringContext,
): TurnAssessment {
  const semanticReview: TurnAssessment['semanticReview'] = [
    ...expected.requires.map((criterion) => ({
      criterionId: criterion.id,
      direction: 'required' as const,
      status: 'pending_review' as const,
      requirement: criterion.requirement,
    })),
    ...expected.forbids.map((criterion) => ({
      criterionId: criterion.id,
      direction: 'forbidden' as const,
      status: 'pending_review' as const,
      requirement: criterion.requirement,
    })),
  ];
  const facts = expected.requiredFacts.map((id) => {
    const oracle = oracles.find((o) => o.id === id);
    if (!oracle) return assessment(id, 'needs_review', 'UNKNOWN_ORACLE');
    if (!object(response) || typeof response.answer !== 'string' || !Array.isArray(response.evidence))
      return assessment(id, 'needs_review', 'UNSUPPORTED_RESPONSE_SHAPE');
    try {
      return oracle.kind === 'recorded'
        ? recordedFact(oracle, response, context)
        : calculatedFact(oracle, response, context);
    } catch {
      return assessment(id, 'needs_review', 'UNSUPPORTED_EVIDENCE_SHAPE');
    }
  });
  return {
    status: facts.some((fact) => fact.status === 'failed') ? 'failed' : 'needs_review',
    facts,
    semanticReview,
    limitations: [
      'All prose requirements and forbidden behaviors require independent semantic review.',
      'Only declared required financial facts are assessed automatically; additional and conditional claims remain unassessed.',
      'An overall pass is never issued by this scorer. Unsupported representations require review, not assumed correctness.',
    ],
  };
}
