import { createHash } from 'node:crypto';
import { AppError } from './errors';
import { conversationSchema } from '../shared/conversation';
import { Decimal, formatCurrency } from '../shared/money';
import type { InsightEvidence } from '../shared/financial-evidence';
import type { ModelMessages } from './ai-provider';
import {
  compileFinancialQuery,
  resolveCounterpartyRowKey,
  type AnalysisAccount,
  type AnalysisFacts,
  type AnalysisFactRow,
  type FinancialQuery,
} from './financial-analysis';
import {
  evaluateFinancialScenario,
  scenarioAssumptionEvidence,
  scenarioAssumptionQuantityEvidence,
  scenarioCalendarMonthCount,
  type ScenarioAssumption,
  type ScenarioCalculationFact,
  type ScenarioReference,
} from './financial-calculation';
import { compoundRowId, groupingDimensions, groupingPeriod } from './financial-grouping';
import {
  answerContractSchema,
  outputBindingsSchema,
  type AnswerContract,
  type AnswerRequirement,
  type AnswerOperand,
  type OutputBinding,
} from './answer-contract';

export { answerContractSchema, outputBindingsSchema, type OutputBinding } from './answer-contract';
export type PreparedAnswerContract = {
  contract: AnswerContract;
  hash: string;
  resolvedSpans: { outputId: string; messageIndex: number; start: number; end: number }[];
  originalMessages: ModelMessages;
};
export type EvidenceLocation = { tableIndex: number; rowIndex?: number };
export type OutputAssessment = {
  outputId: string;
  status: 'fulfilled' | 'missing' | 'unsupported' | 'invalid';
  reason: string;
  evidence: EvidenceLocation[];
};
export type CompletionAssessment = {
  completionBasis: 'model_declared';
  userIntentVerified: false;
  status: 'fulfilled' | 'partial' | 'unassessed';
  outputs: OutputAssessment[];
};
export type CompletionContext = {
  facts: (AnalysisFacts | ScenarioCalculationFact)[];
  evidence: InsightEvidence[];
  bindings: OutputBinding[];
  organizationId: string;
  /** The chart retained by the successful execution snapshot, never a planning chart. */
  chart: AnalysisAccount[];
  resolveRowReference?: (queryId: string, rowId: string) => string;
};

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
const same = (left: unknown, right: unknown) => stable(left) === stable(right);
const sorted = (items: string[]) => [...new Set(items)].sort();
function fail(message: string): never {
  throw new AppError(422, 'INVALID_ANSWER_CONTRACT', message);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Freezes model-declared duties before financial results; it does not certify full user intent. */
export function prepareAnswerContract(
  input: unknown,
  originalMessages: ModelMessages,
): PreparedAnswerContract {
  if (Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8') > 16 * 1024)
    fail('The answer contract exceeds its size limit.');
  const parsed = answerContractSchema.safeParse(input);
  if (!parsed.success) fail('The answer contract does not match the supported schema.');
  const contract = parsed.data;
  if (Buffer.byteLength(JSON.stringify(contract), 'utf8') > 16 * 1024)
    fail('The normalized answer contract exceeds its size limit.');
  const messages = conversationSchema.parse(originalMessages);
  const previous = new Map<string, AnswerRequirement>();
  const resolvedSpans: PreparedAnswerContract['resolvedSpans'] = [];
  for (const output of contract.outputs) {
    if (previous.has(output.id)) fail('Answer output IDs must be unique.');
    for (const anchor of output.sourceQuotes) {
      const message = messages[anchor.messageIndex];
      const start = message?.content.indexOf(anchor.quote) ?? -1;
      if (message?.role !== 'user' || start < 0 || message.content.indexOf(anchor.quote, start + 1) >= 0)
        fail('Every output needs an unambiguous exact quotation from an original user message.');
      resolvedSpans.push({
        outputId: output.id,
        messageIndex: anchor.messageIndex,
        start,
        end: start + anchor.quote.length,
      });
    }
    const requirement = output.requirement;
    if ('counterpartyFrom' in requirement && requirement.counterpartyFrom !== null) {
      const earlier = previous.get(requirement.counterpartyFrom);
      const scope = requirement.kind === 'value' ? requirement.scope : requirement.query;
      if (
        earlier?.kind !== 'selected_identity' ||
        earlier.query.groupBy !== 'counterparty' ||
        scope.counterparty.mode !== 'any' ||
        scope.counterparty.value !== ''
      )
        fail(
          'A deferred counterparty must reference an earlier selected counterparty, without a copied filter.',
        );
    }
    if (requirement.kind === 'arithmetic') {
      for (const operand of requirement.operands) {
        if (operand.source === 'output') {
          const earlier = previous.get(operand.id);
          if (!earlier || !['value', 'arithmetic'].includes(earlier.kind))
            fail('Arithmetic outputs may reference only earlier scalar outputs.');
        } else if (operand.source === 'assumption') {
          const { source: _source, ...assumption } = operand;
          try {
            scenarioAssumptionEvidence({ id: 'contract_assumption', ...assumption }, messages);
          } catch {
            fail('An answer assumption must be an explicit original-user quantity and unit.');
          }
        }
      }
    }
    previous.set(output.id, requirement);
  }
  return freeze({
    contract,
    hash: hash(contract),
    resolvedSpans,
    originalMessages: structuredClone(messages),
  });
}

class AssessmentFailure extends Error {
  constructor(
    public status: OutputAssessment['status'],
    message: string,
  ) {
    super(message);
  }
}
function invalid(message: string): never {
  throw new AssessmentFailure('invalid', message);
}
function unsupported(message: string): never {
  throw new AssessmentFailure('unsupported', message);
}
function missing(message: string): never {
  throw new AssessmentFailure('missing', message);
}
const isCalculation = (fact: AnalysisFacts | ScenarioCalculationFact): fact is ScenarioCalculationFact =>
  'kind' in fact;
const isBalance = (metric: FinancialQuery['metric']) => ['account_balance', 'cash_balance'].includes(metric);
type Compiled = ReturnType<typeof compileFinancialQuery>;

function effectiveAccounts(compiled: Compiled, chart: AnalysisAccount[]) {
  const p = compiled.plan;
  if (p.accountCodes.length || ['cash_balance', 'net_cash_movement'].includes(p.metric))
    return compiled.selected.map((account) => account.id).sort();
  const types = compiled.metricAccountTypes;
  return chart
    .filter(
      (a) =>
        !a.is_group && types.includes(a.type) && (p.currencyMode === 'base' || a.currency === p.currency),
    )
    .map((a) => a.id)
    .sort();
}

/** Reject forged grain/period metadata before deriving a cell's economic scope. */
function rowIdentity(
  fact: AnalysisFacts,
  row: AnalysisFactRow,
  compiled: Compiled,
  chart: AnalysisAccount[],
) {
  const p = compiled.plan;
  const dimensions = groupingDimensions(p.groupBy);
  const period = groupingPeriod(p.groupBy);
  if (!/^\d{1,20}$/.test(row.entryCount) || (row.value !== null && !/^-?\d+(?:\.\d+)?$/.test(row.value)))
    invalid('The executed row has invalid amount metadata.');
  if (row.value === null && p.aggregation !== 'average_per_entry')
    invalid('A total cannot have a missing amount.');
  if (Array.isArray(p.groupBy)) {
    if (
      !row.dimensions ||
      row.dimensions.length !== dimensions.length ||
      row.dimensions.some((d, i) => d.kind !== dimensions[i]) ||
      compoundRowId(row.dimensions) !== row.rowId
    )
      invalid('The executed compound row has incompatible dimensions.');
  } else if (row.dimensions !== undefined || !row.rowId.startsWith(`${p.groupBy}:`))
    invalid('The executed row does not match its grouping.');
  let accounts = effectiveAccounts(compiled, chart);
  if (dimensions.includes('account')) {
    const dimension = row.dimensions?.find((d) => d.kind === 'account');
    const accountId = dimension?.accountId ?? decodeURIComponent(row.rowId.slice('account:'.length));
    const account = chart.find((a) => a.id === accountId);
    if (!account || !accounts.includes(accountId) || (dimension && dimension.key !== account.code))
      invalid('The row account is outside its executed account set.');
    accounts = [accountId];
  }
  let from = p.from,
    to = p.to;
  if (period) {
    const key = row.dimensions?.find((d) => d.kind === period)?.key ?? row.rowId.slice(period.length + 1);
    const match = (period === 'month' ? /^(\d{4})-(\d{2})$/ : /^(\d{4})-Q([1-4])$/).exec(key);
    if (!match) invalid('The row has an invalid calendar bucket.');
    const year = Number(match[1]);
    const month = period === 'month' ? Number(match[2]) : (Number(match[2]) - 1) * 3 + 1;
    if (month < 1 || month > 12) invalid('The row has an invalid month.');
    const prefix = `${match[1]}-${String(month).padStart(2, '0')}-01`;
    const endMonth = month + (period === 'quarter' ? 2 : 0);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][endMonth - 1];
    const end = `${match[1]}-${String(endMonth).padStart(2, '0')}-${days}`;
    if (!p.from || prefix > p.to || end < p.from) invalid('A calendar row is outside the requested period.');
    from = p.from > prefix ? p.from : prefix;
    to = p.to < end ? p.to : end;
  }
  if (
    row.from !== from ||
    row.to !== to ||
    (isBalance(p.metric) ? row.balanceAsOf !== to : row.balanceAsOf !== undefined)
  )
    invalid('The row period differs from its executed scope.');
  if (p.groupBy === 'total' && row.rowId !== 'total:total')
    invalid('A scalar total has an invalid identity.');
  const counterparty = dimensions.includes('counterparty')
    ? { mode: 'identity', value: resolveCounterpartyRowKey(fact, row.rowId) }
    : p.counterparty;
  return { accounts, from: isBalance(p.metric) ? null : from, to, counterparty };
}

function scopeKey(compiled: Compiled, chart: AnalysisAccount[], cell?: ReturnType<typeof rowIdentity>) {
  const p = compiled.plan;
  const accounts = cell?.accounts ?? effectiveAccounts(compiled, chart);
  return {
    metric: p.metric,
    aggregation: p.aggregation,
    from: cell ? cell.from : p.from,
    to: cell?.to ?? p.to,
    status: p.status,
    currencyMode: p.currencyMode,
    currency: p.currency,
    accounts,
    amountThresholdAccounts:
      p.minimumAmount !== null || p.maximumAmount !== null ? effectiveAccounts(compiled, chart) : null,
    // Two distinct empty groups must never become equivalent through empty sets.
    emptyAccountRoots: accounts.length ? [] : sorted(p.accountCodes),
    cooccurring: compiled.cooccurring.map((a) => a.id).sort(),
    emptyCooccurringRoots: compiled.cooccurring.length ? [] : sorted(p.cooccurringAccountCodes),
    counterparty: (() => {
      const filter = cell?.counterparty ?? p.counterparty;
      return filter.mode === 'exact' || filter.mode === 'contains'
        ? { ...filter, value: filter.value.toLowerCase() }
        : filter;
    })(),
    descriptionSearch: p.descriptionSearch.toLowerCase(),
    minimumAmount: p.minimumAmount === null ? null : new Decimal(p.minimumAmount).toString(),
    maximumAmount: p.maximumAmount === null ? null : new Decimal(p.maximumAmount).toString(),
  };
}

function rowDisplay(fact: AnalysisFacts, row: AnalysisFactRow) {
  if (row.value === null) return 'No matching transactions';
  if (fact.unit === 'count') return row.value;
  return `${formatCurrency(row.value, fact.unit)}${fact.unit !== 'USD' ? ` ${fact.unit}` : ''}`;
}
function calculationDisplay(fact: ScenarioCalculationFact) {
  return fact.unit === 'USD'
    ? `${formatCurrency(fact.value)} USD`
    : fact.unit === 'USD_per_month'
      ? `${formatCurrency(fact.value)} USD/month`
      : `${fact.value} ${fact.unit}`;
}

/** A bounded finalizer: only checks existing results and visible server-assigned references. */
function inspectAnswerContract(prepared: PreparedAnswerContract, context: CompletionContext) {
  if (hash(prepared.contract) !== prepared.hash)
    throw new AppError(422, 'INVALID_ANSWER_CONTRACT', 'The frozen answer contract changed.');
  const parsed = outputBindingsSchema.safeParse(context.bindings);
  if (!parsed.success) throw new AppError(422, 'INVALID_ANSWER_BINDING', 'The output bindings are invalid.');
  const ids = new Set(prepared.contract.outputs.map((o) => o.id));
  if (
    new Set(parsed.data.map((b) => b.outputId)).size !== parsed.data.length ||
    parsed.data.some((b) => !ids.has(b.outputId))
  )
    throw new AppError(422, 'INVALID_ANSWER_BINDING', 'Bindings must identify unique declared outputs.');
  const facts = context.facts.filter((f): f is AnalysisFacts => !isCalculation(f));
  const calculations = context.facts.filter(isCalculation);
  const completed = new Map<
    string,
    { binding: OutputBinding; symbol?: unknown; identity?: { queryId: string; rowId: string; key: string } }
  >();
  const compiledFacts = new Map<string, Compiled>();
  const output = (
    outputId: string,
    status: OutputAssessment['status'],
    reason: string,
    evidence: EvidenceLocation[] = [],
  ): OutputAssessment => ({ outputId, status, reason, evidence });
  function checkedFact(queryId: string) {
    const matches = facts.filter((f) => f.queryId === queryId);
    if (matches.length !== 1) invalid('The binding does not identify one executed query.');
    const fact = matches[0];
    if (compiledFacts.has(queryId)) return { fact, compiled: compiledFacts.get(queryId)! };
    if (!Array.isArray(context.chart)) unsupported('The execution-snapshot chart is unavailable.');
    const compiled = compileFinancialQuery(
      context.organizationId,
      fact.scope.plan,
      context.chart,
      fact.scope.counterpartyIdentity,
    );
    const p = compiled.plan;
    if (
      fact.scope.organizationId !== context.organizationId ||
      p.id !== fact.queryId ||
      fact.metric !== p.metric ||
      fact.aggregation !== p.aggregation ||
      !same(fact.grain, p.groupBy) ||
      !same(sorted(fact.scope.resolvedAccountIds), compiled.selected.map((a) => a.id).sort()) ||
      !same(sorted(fact.scope.cooccurringAccountIds), compiled.cooccurring.map((a) => a.id).sort()) ||
      fact.unit !==
        (p.metric === 'journal_count' ? 'count' : p.currencyMode === 'native' ? p.currency : 'USD') ||
      fact.currency !==
        (p.metric === 'journal_count' ? null : p.currencyMode === 'native' ? p.currency : 'USD') ||
      fact.scope.resolvedAccountIds.length !== new Set(fact.scope.resolvedAccountIds).size ||
      fact.scope.cooccurringAccountIds.length !== new Set(fact.scope.cooccurringAccountIds).size ||
      new Set(fact.rows.map((r) => r.rowId)).size !== fact.rows.length ||
      fact.rows.length > p.limit ||
      (p.groupBy === 'total' && fact.rows.length !== 1)
    )
      invalid('The executed query has incompatible source metadata.');
    const basis =
      p.metric === 'journal_count'
        ? 'full_journal_debit_total_for_amount_filter'
        : p.metric === 'journal_total'
          ? 'full_journal_debit_total'
          : p.metric === 'net_cash_movement'
            ? `net_cash_movement_${p.currencyMode}_lines`
            : isBalance(p.metric)
              ? `inception_to_closing_date_${p.currencyMode}_lines`
              : `selected_metric_${p.currencyMode}_lines`;
    if (
      fact.scope.amountBasis !== basis ||
      fact.scope.statusMeaning !== (p.status === 'POSTED' ? 'booked' : 'unposted_projection')
    )
      invalid('The executed amount basis differs from its accounting metric.');
    for (const [metric, key] of [
      ['cash_balance', 'cashBalanceSource'],
      ['net_cash_movement', 'cashMovementSource'],
    ] as const) {
      const expected =
        p.metric === metric
          ? {
              selection: 'all_cash_asset_posting_accounts',
              accounts: compiled.selected.map(
                ({ id, code, type, currency, is_cash, is_group, archived }) => ({
                  id,
                  code,
                  type,
                  currency,
                  is_cash,
                  is_group,
                  archived,
                }),
              ),
            }
          : undefined;
      if (!same(fact.scope[key], expected))
        invalid('The cash source proof does not match the execution chart.');
    }
    if (
      Array.isArray(p.groupBy) &&
      (!same(fact.scope.groupingAccounts, compiled.groupingAccounts) ||
        !same(fact.scope.compoundGrouping, {
          dimensions: p.groupBy,
          zeroFill: groupingPeriod(p.groupBy)
            ? p.groupBy.includes('counterparty')
              ? 'observed_qualified_tuples'
              : 'all_scoped_accounts'
            : 'none',
          maximumCells: 30000,
        }))
    )
      invalid('The compound grouping source proof is inconsistent.');
    if (fact.scope.counterpartyIdentity) {
      const proof = fact.scope.counterpartyIdentity;
      const earlier = facts.findIndex((f) => f.queryId === proof.queryId);
      if (
        earlier < 0 ||
        earlier >= facts.indexOf(fact) ||
        facts[earlier].scope.organizationId !== context.organizationId ||
        resolveCounterpartyRowKey(facts[earlier], proof.rowId) !== proof.key
      )
        invalid('The exact counterparty proof does not identify an earlier source row.');
    }
    for (const row of fact.rows) rowIdentity(fact, row, compiled, context.chart);
    if (p.order !== 'label_asc') {
      for (let index = 1; index < fact.rows.length; index++) {
        const previous = fact.rows[index - 1].value,
          current = fact.rows[index].value;
        if (
          (previous === null && current !== null) ||
          (previous !== null &&
            current !== null &&
            (p.order === 'value_desc'
              ? new Decimal(previous).lt(current)
              : new Decimal(previous).gt(current)))
        )
          invalid('The ranked result does not retain its requested value ordering.');
      }
    }
    compiledFacts.set(queryId, compiled);
    return { fact, compiled };
  }
  function boundRow(binding: OutputBinding) {
    if (binding.source.kind !== 'query_row') unsupported('This output requires a query row binding.');
    const { queryId } = binding.source;
    const rowId = context.resolveRowReference?.(queryId, binding.source.rowId) ?? binding.source.rowId;
    const { fact, compiled } = checkedFact(queryId);
    const row = fact.rows.find((r) => r.rowId === rowId);
    if (!row) invalid('The row reference is not part of this query and session.');
    return { fact, compiled, row };
  }
  function visibleRow(fact: AnalysisFacts, row: AnalysisFactRow) {
    const locations: EvidenceLocation[] = [];
    context.evidence.forEach((table, tableIndex) =>
      table.rows.forEach((visible, rowIndex) => {
        const ref = visible.factRef;
        if (ref?.kind === 'query_row' && ref.queryId === fact.queryId && ref.rowId === row.rowId) {
          if (
            visible.value !== rowDisplay(fact, row) ||
            table.source !== (fact.scope.plan.status === 'DRAFT' ? 'draft' : 'posted')
          )
            invalid('The visible financial row differs from its server fact.');
          locations.push({ tableIndex, rowIndex });
        }
      }),
    );
    if (!locations.length) missing('The requested fact is not present in visible evidence.');
    return locations;
  }
  function expectedQuery(requirement: Extract<AnswerRequirement, { kind: 'value' | 'table' }>) {
    let plan: FinancialQuery =
      requirement.kind === 'value'
        ? { ...requirement.scope, id: 'required_scope', groupBy: 'total', order: 'label_asc', limit: 50 }
        : { ...requirement.query, id: 'required_scope' };
    let identity;
    if (requirement.counterpartyFrom !== null) {
      identity = completed.get(requirement.counterpartyFrom)?.identity;
      if (!identity) missing('The required selected identity has not been fulfilled.');
      plan = { ...plan, counterparty: { mode: 'identity', value: identity.key } };
    }
    return compileFinancialQuery(context.organizationId, plan, context.chart, identity);
  }
  function expectedValueScope(requirement: Extract<AnswerRequirement, { kind: 'value' }>) {
    const compiled = expectedQuery(requirement);
    if (requirement.selectedAccountCode === null) return scopeKey(compiled, context.chart);
    const account = context.chart.find((a) => a.code === requirement.selectedAccountCode && !a.is_group);
    if (!account || !effectiveAccounts(compiled, context.chart).includes(account.id))
      invalid('The requested account cell is outside the declared financial scope.');
    return scopeKey(compiled, context.chart, {
      accounts: [account.id],
      from: compiled.plan.from,
      to: compiled.plan.to,
      counterparty: compiled.plan.counterparty,
    });
  }
  const actualSymbols = new Map<string, unknown>();
  let calculationsValidated = false;
  function validateCalculations() {
    if (calculationsValidated) return;
    for (const fact of facts) checkedFact(fact.queryId);
    const assumptions = new Map<string, ScenarioAssumption>();
    for (const calculation of calculations)
      for (const item of calculation.assumptions) {
        if (assumptions.has(item.id) && !same(assumptions.get(item.id), item))
          invalid('Calculation assumptions disagree.');
        assumptions.set(item.id, item);
      }
    const replay = evaluateFinancialScenario(
      {
        queries: facts.map((f) => f.scope.plan),
        assumptions: [...assumptions.values()].map(({ id, value, unit, sourceText }) => ({
          id,
          value,
          unit,
          sourceText,
        })),
        calculations: calculations.map(({ id, operation, operands }) => ({ id, operation, operands })),
      },
      facts,
      prepared.originalMessages,
    );
    if (!same(replay.facts.filter(isCalculation), calculations))
      invalid('The calculation facts differ from deterministic replay.');
    calculationsValidated = true;
  }
  function assumptionSymbol(item: Omit<ScenarioAssumption, 'id' | 'userMessageIndex'> & { id?: string }) {
    const checked = scenarioAssumptionQuantityEvidence(
      { id: 'checked_assumption', value: item.value, unit: item.unit, sourceText: item.sourceText },
      prepared.originalMessages,
    );
    return {
      kind: 'assumption',
      value: new Decimal(checked.value).toString(),
      unit: checked.unit,
      message: checked.userMessageIndex,
      start: checked.quantityStart,
      end: checked.quantityEnd,
    };
  }
  function actualReference(ref: ScenarioReference): unknown {
    if (ref.source === 'calculation') return calculationSymbol(ref.id);
    if (ref.source === 'assumption') {
      const item = calculations.flatMap((c) => c.assumptions).find((a) => a.id === ref.id);
      if (!item) invalid('A calculation assumption is missing.');
      return assumptionSymbol(item);
    }
    const { fact, compiled } = checkedFact(ref.id);
    if (ref.field === 'month_count') {
      scenarioCalendarMonthCount(fact);
      return { kind: 'month_count', scope: scopeKey(compiled, context.chart), grain: fact.grain };
    }
    const row = fact.rows.find((r) => r.rowId === ref.rowId);
    if (!row || row.value === null || fact.truncated)
      invalid('Arithmetic requires complete exact source rows.');
    return {
      kind: 'value',
      scope: scopeKey(compiled, context.chart, rowIdentity(fact, row, compiled, context.chart)),
    };
  }
  function calculationSymbol(id: string): unknown {
    if (actualSymbols.has(id)) return actualSymbols.get(id);
    const found = calculations.filter((c) => c.id === id);
    if (found.length !== 1) invalid('The calculation binding is not unique.');
    const calculation = found[0];
    // The replay validates acyclic source ordering before recursion.
    const symbol = {
      kind: 'arithmetic',
      operation: calculation.operation,
      operands: calculation.operands.map(actualReference),
    };
    actualSymbols.set(id, symbol);
    return symbol;
  }
  function expectedOperand(operand: AnswerOperand): unknown {
    if (operand.source === 'output') {
      const symbol = completed.get(operand.id)?.symbol;
      if (!symbol) missing('A required earlier scalar output is missing.');
      return symbol;
    }
    if (operand.source === 'assumption') return assumptionSymbol(operand);
    const compiled = compileFinancialQuery(
      context.organizationId,
      { ...operand.query, id: 'month_scope' },
      context.chart,
    );
    if (compiled.plan.groupBy !== 'month') unsupported('The declared duration is not a monthly series.');
    return { kind: 'month_count', scope: scopeKey(compiled, context.chart), grain: 'month' };
  }
  function symbolsEqual(left: unknown, right: unknown): boolean {
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return same(left, right);
    const a = left as Record<string, unknown>,
      b = right as Record<string, unknown>;
    if (a.kind === 'assumption' && b.kind === 'assumption') {
      return (
        a.value === b.value &&
        a.unit === b.unit &&
        a.message === b.message &&
        a.start === b.start &&
        a.end === b.end
      );
    }
    if (a.kind === 'arithmetic' && b.kind === 'arithmetic')
      return (
        a.operation === b.operation &&
        Array.isArray(a.operands) &&
        Array.isArray(b.operands) &&
        a.operands.length === b.operands.length &&
        a.operands.every((v, i) => symbolsEqual(v, (b.operands as unknown[])[i]))
      );
    return same(left, right);
  }

  const outputs = prepared.contract.outputs.map((requested): OutputAssessment => {
    const binding = parsed.data.find((b) => b.outputId === requested.id);
    if (!binding)
      return output(requested.id, 'missing', 'No final binding was supplied for this declared output.');
    try {
      const requirement = requested.requirement;
      if (requirement.kind === 'value') {
        const { fact, row, compiled } = boundRow(binding);
        if (groupingDimensions(fact.grain).includes('entry'))
          unsupported('Event rows cannot establish aggregate output scope.');
        const actual = scopeKey(compiled, context.chart, rowIdentity(fact, row, compiled, context.chart));
        if (!same(actual, expectedValueScope(requirement)))
          invalid('The bound value has a different financial scope.');
        const evidence = visibleRow(fact, row);
        completed.set(requested.id, { binding, symbol: { kind: 'value', scope: actual } });
        return output(
          requested.id,
          'fulfilled',
          'The scoped value is visibly linked to its executed fact.',
          evidence,
        );
      }
      if (requirement.kind === 'table' || requirement.kind === 'selected_identity') {
        const rowBinding = requirement.kind === 'selected_identity' ? boundRow(binding) : undefined;
        if (!rowBinding && binding.source.kind !== 'query_result')
          unsupported('A table output requires a query-result binding.');
        const queryId = rowBinding?.fact.queryId ?? (binding.source as { queryId: string }).queryId;
        const { fact, compiled } = checkedFact(queryId);
        const expected =
          requirement.kind === 'table'
            ? expectedQuery(requirement)
            : compileFinancialQuery(
                context.organizationId,
                { ...requirement.query, id: 'required_identity' },
                context.chart,
              );
        if (
          !same(scopeKey(compiled, context.chart), scopeKey(expected, context.chart)) ||
          !same(fact.grain, expected.plan.groupBy) ||
          compiled.plan.order !== expected.plan.order ||
          compiled.plan.limit !== expected.plan.limit
        )
          invalid('The bound result has a different scope, grouping or ranking contract.');
        if (requirement.kind === 'selected_identity') {
          if (
            !rowBinding ||
            !fact.rows.length ||
            fact.rows[0].rowId !== rowBinding.row.rowId ||
            rowBinding.row.value === null
          )
            invalid('The selected identity is not the first ranked source row.');
          if (
            requirement.tiePolicy === 'unique' &&
            ((fact.rows.length === 1 && fact.truncated) ||
              (fact.rows[1]?.value !== null &&
                fact.rows[1]?.value !== undefined &&
                new Decimal(fact.rows[1].value).eq(rowBinding.row.value)))
          )
            unsupported('The returned ranking does not prove a unique leader.');
          const evidence = visibleRow(fact, rowBinding.row);
          completed.set(requested.id, {
            binding,
            ...(requirement.query.groupBy === 'counterparty'
              ? {
                  identity: {
                    queryId: fact.queryId,
                    rowId: rowBinding.row.rowId,
                    key: resolveCounterpartyRowKey(fact, rowBinding.row.rowId),
                  },
                }
              : {}),
          });
          return output(
            requested.id,
            'fulfilled',
            'The declared ranked identity is linked to its exact source row.',
            evidence,
          );
        }
        if (requirement.coverage === 'all' && fact.truncated)
          missing('The requested complete table is truncated.');
        const evidence: EvidenceLocation[] = [];
        context.evidence.forEach((table, tableIndex) => {
          if (table.factSource?.queryId !== queryId) return;
          if (
            table.factSource.kind !== 'query_result' ||
            table.factSource.truncated !== fact.truncated ||
            table.source !== (fact.scope.plan.status === 'DRAFT' ? 'draft' : 'posted') ||
            table.rows.length !== fact.rows.length
          )
            invalid('The visible table coverage differs from the executed result.');
          table.rows.forEach((visible, index) => {
            const row = fact.rows[index];
            if (
              !same(visible.factRef, { kind: 'query_row', queryId, rowId: row.rowId }) ||
              visible.value !== rowDisplay(fact, row)
            )
              invalid('The visible table order or amount differs from its exact result.');
          });
          evidence.push({ tableIndex });
        });
        if (!evidence.length) missing('The requested table is not present in visible evidence.');
        completed.set(requested.id, { binding });
        return output(
          requested.id,
          'fulfilled',
          'The requested table and coverage are visibly linked.',
          evidence,
        );
      }
      if (binding.source.kind !== 'calculation')
        unsupported('Arithmetic requires an executed calculation binding.');
      validateCalculations();
      const symbol = calculationSymbol(binding.source.calculationId);
      const expected = {
        kind: 'arithmetic',
        operation: requirement.operation,
        operands: requirement.operands.map(expectedOperand),
      };
      if (!symbolsEqual(expected, symbol))
        invalid('The executed arithmetic has different ordered source operands.');
      const calculation = calculations.find(
        (c) => c.id === (binding.source as { calculationId: string }).calculationId,
      )!;
      const evidence: EvidenceLocation[] = [];
      context.evidence.forEach((table, tableIndex) =>
        table.rows.forEach((row, rowIndex) => {
          if (row.factRef?.kind === 'calculation' && row.factRef.calculationId === calculation.id) {
            if (row.value !== calculationDisplay(calculation) || table.source !== calculation.source)
              invalid('The visible calculation differs from its validated fact.');
            evidence.push({ tableIndex, rowIndex });
          }
        }),
      );
      if (!evidence.length) missing('The executed calculation is not present in visible evidence.');
      completed.set(requested.id, { binding, symbol });
      return output(
        requested.id,
        'fulfilled',
        'The declared arithmetic and visible result share exact source ancestry.',
        evidence,
      );
    } catch (error) {
      if (error instanceof AssessmentFailure) return output(requested.id, error.status, error.message);
      return output(
        requested.id,
        'invalid',
        'The bound source could not pass the existing financial validators.',
      );
    }
  });
  const assessment: CompletionAssessment = {
    completionBasis: 'model_declared',
    userIntentVerified: false,
    status: outputs.every((o) => o.status === 'fulfilled')
      ? 'fulfilled'
      : outputs.every((o) => o.status === 'unsupported')
        ? 'unassessed'
        : 'partial',
    outputs,
  };
  return {
    assessment,
    validateExistingCalculations: validateCalculations,
    assumptionIdentity: assumptionSymbol,
    outputReference(outputId: string): ScenarioReference {
      const fulfilled = completed.get(outputId);
      if (!fulfilled?.symbol) missing('The required earlier scalar output is not fulfilled.');
      if (fulfilled.binding.source.kind === 'query_row') {
        const { fact, row } = boundRow(fulfilled.binding);
        const ref: ScenarioReference = {
          source: 'query',
          id: fact.queryId,
          rowId: row.rowId,
          field: 'value',
        };
        actualReference(ref);
        return ref;
      }
      if (fulfilled.binding.source.kind === 'calculation') {
        validateCalculations();
        return {
          source: 'calculation',
          id: fulfilled.binding.source.calculationId,
          rowId: null,
          field: 'value',
        };
      }
      return unsupported('This output does not bind a scalar operand.');
    },
    monthCountReference(
      query: Extract<AnswerOperand, { source: 'month_count' }>['query'],
    ): ScenarioReference {
      const expected = expectedOperand({ source: 'month_count', query });
      const matches: string[] = [];
      for (const fact of facts) {
        const { compiled } = checkedFact(fact.queryId);
        const actual = { kind: 'month_count', scope: scopeKey(compiled, context.chart), grain: fact.grain };
        if (!same(expected, actual)) continue;
        try {
          scenarioCalendarMonthCount(fact);
          matches.push(fact.queryId);
        } catch {
          /* Incomplete or unsupported series cannot supply a divisor. */
        }
      }
      if (matches.length !== 1)
        missing('A calendar divisor needs one complete, exactly scoped inspected series.');
      return { source: 'query', id: matches[0], rowId: null, field: 'month_count' };
    },
  };
}

/** Checks existing facts only; this public function never creates an operation. */
export function finalizeAnswerContract(
  prepared: PreparedAnswerContract,
  context: CompletionContext,
): CompletionAssessment {
  return inspectAnswerContract(prepared, context).assessment;
}

export type DeclaredArithmeticResult = Pick<CompletionContext, 'facts' | 'evidence' | 'bindings'> & {
  generatedCalculations: { outputId: string; calculationId: string }[];
};

/** Executes only absent bindings for operations already frozen in the contract.
 * No provider, query, inferred operand, or alteration of an existing binding.
 * Every candidate node is replayed and checked before its atomic local commit. */
export function completeDeclaredArithmetic(
  prepared: PreparedAnswerContract,
  context: CompletionContext,
): DeclaredArithmeticResult {
  const result: DeclaredArithmeticResult = {
    facts: structuredClone(context.facts),
    evidence: structuredClone(context.evidence),
    bindings: structuredClone(context.bindings),
    generatedCalculations: [],
  };
  const currentContext = (): CompletionContext => ({
    ...context,
    facts: result.facts,
    evidence: result.evidence,
    bindings: result.bindings,
  });
  let inspected = inspectAnswerContract(prepared, currentContext());
  if (inspected.assessment.outputs.some((output) => output.status === 'invalid')) return result;
  const queries = result.facts.filter((fact): fact is AnalysisFacts => !isCalculation(fact));
  if (queries.length > 4) return result;
  const assumptions = new Map<string, Pick<ScenarioAssumption, 'id' | 'value' | 'unit' | 'sourceText'>>();
  const assumptionIds = new Set<string>();
  // The calculator emits all assumption rows, including unused ones. Count their
  // server-owned IDs without recovering quantities from presentation text.
  for (const table of result.evidence)
    for (const row of table.rows)
      if (row.factRef?.kind === 'assumption') assumptionIds.add(row.factRef.assumptionId);
  for (const fact of result.facts.filter(isCalculation))
    for (const item of fact.assumptions) {
      assumptionIds.add(item.id);
      const input = { id: item.id, value: item.value, unit: item.unit, sourceText: item.sourceText };
      if (assumptions.has(item.id) && !same(assumptions.get(item.id), input)) return result;
      assumptions.set(item.id, input);
    }
  if (assumptionIds.size > 8 || result.facts.filter(isCalculation).length > 8) return result;
  try {
    if (result.facts.some(isCalculation)) inspected.validateExistingCalculations();
  } catch {
    return result;
  }
  const usedIds = new Set([
    ...queries.map((fact) => fact.queryId),
    ...result.facts.filter(isCalculation).map((fact) => fact.id),
    ...assumptionIds,
    ...prepared.contract.outputs.map((output) => output.id),
  ]);
  function allocate(prefix: string, ids: Set<string>) {
    // At most36 occupied identifiers can exist under the surrounding limits.
    for (let index = 1; index <= 64; index++) {
      const id = `${prefix}_${index}`;
      if (!ids.has(id)) {
        ids.add(id);
        return id;
      }
    }
    return unsupported('The declared calculation identifier budget is exhausted.');
  }
  for (const output of prepared.contract.outputs) {
    if (
      output.requirement.kind !== 'arithmetic' ||
      result.bindings.some((binding) => binding.outputId === output.id)
    )
      continue;
    const existingCalculations = result.facts.filter(isCalculation);
    if (existingCalculations.length >= 8) break;
    const candidateIds = new Set(usedIds);
    const candidateAssumptions = new Map(assumptions);
    const candidateAssumptionIds = new Set(assumptionIds);
    const addedAssumptionIds = new Set<string>();
    try {
      const operands = output.requirement.operands.map((operand): ScenarioReference => {
        if (operand.source === 'output') return inspected.outputReference(operand.id);
        if (operand.source === 'month_count') return inspected.monthCountReference(operand.query);
        const identity = inspected.assumptionIdentity(operand);
        const equivalent = [...candidateAssumptions.values()].find((item) =>
          same(inspected.assumptionIdentity(item), identity),
        );
        if (equivalent) return { source: 'assumption', id: equivalent.id, rowId: null, field: 'value' };
        if (candidateAssumptionIds.size >= 8) unsupported('The combined assumption budget is exhausted.');
        const id = allocate('completion_assumption', candidateIds);
        candidateAssumptions.set(id, {
          id,
          value: operand.value,
          unit: operand.unit,
          sourceText: operand.sourceText,
        });
        candidateAssumptionIds.add(id);
        addedAssumptionIds.add(id);
        return { source: 'assumption', id, rowId: null, field: 'value' };
      });
      const calculationId = allocate('completion_calculation', candidateIds);
      const replay = evaluateFinancialScenario(
        {
          queries: queries.map((fact) => fact.scope.plan),
          assumptions: [...candidateAssumptions.values()],
          calculations: [
            ...existingCalculations.map(({ id, operation, operands }) => ({ id, operation, operands })),
            { id: calculationId, operation: output.requirement.operation, operands },
          ],
        },
        queries,
        prepared.originalMessages,
      );
      const replayedCalculations = replay.facts.filter(isCalculation);
      if (!same(replayedCalculations.slice(0, -1), existingCalculations))
        invalid('Declared completion cannot change an existing calculated fact.');
      const generated = replayedCalculations.at(-1)!;
      const evidence = replay.evidence.flatMap((table) => {
        const rows = table.rows.filter((row) =>
          row.factRef?.kind === 'calculation'
            ? row.factRef.calculationId === calculationId
            : row.factRef?.kind === 'assumption' && addedAssumptionIds.has(row.factRef.assumptionId),
        );
        return rows.length ? [{ ...table, rows }] : [];
      });
      const binding: OutputBinding = { outputId: output.id, source: { kind: 'calculation', calculationId } };
      const candidateContext: CompletionContext = {
        ...context,
        facts: [...result.facts, generated],
        evidence: [...result.evidence, ...evidence],
        bindings: [...result.bindings, binding],
      };
      const candidate = inspectAnswerContract(prepared, candidateContext);
      if (candidate.assessment.outputs.find((item) => item.outputId === output.id)?.status !== 'fulfilled')
        continue;
      // A valid dependency can expose an invalid supplied downstream formula.
      // Retain that coherent context so the caller's finalizer withholds it;
      // rolling back the dependency would mask the now-detectable mismatch.
      result.facts = candidateContext.facts;
      result.evidence = candidateContext.evidence;
      result.bindings = candidateContext.bindings;
      result.generatedCalculations.push({ outputId: output.id, calculationId });
      candidateIds.forEach((id) => usedIds.add(id));
      candidateAssumptions.forEach((item, id) => assumptions.set(id, item));
      candidateAssumptionIds.forEach((id) => assumptionIds.add(id));
      inspected = candidate;
      if (candidate.assessment.outputs.some((item) => item.status === 'invalid')) break;
    } catch {
      // Unsupported arithmetic, missing operands and exhausted budgets stay
      // missing. No half node, new evidence, replacement or allowance commits.
    }
  }
  return result;
}
