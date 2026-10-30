import { z } from 'zod';
import { Decimal } from '../shared/money';
import { accounts, primaryOrganizationId, type ResearchQuestion } from './dataset';
import { calculate, calculationSchema, querySchema, type ToolEvidence } from './analytics';
import type { RetrievedDocument } from './retrieval';

export const factSchema = z
  .object({
    key: z.string().min(1).max(80),
    value: z.string().max(400),
    unit: z.enum(['USD', 'EUR', 'percent', 'days', 'months', 'count', 'text', 'boolean']),
    evidenceIds: z.array(z.string().max(160)).max(20),
    entity: z.string().max(200).nullable(),
    from: z.string().date().nullable(),
    to: z.string().date().nullable(),
    asOf: z.string().date().nullable(),
  })
  .strict();
export const answerSchema = z
  .object({
    behavior: z.enum(['ANSWER', 'CLARIFY', 'BLOCK', 'PROPOSAL']),
    summary: z.string().max(4000),
    facts: z.array(factSchema).max(30),
    evidenceIds: z.array(z.string().max(160)).max(40),
    assumptions: z.array(z.string().max(500)).max(15),
    assumptionTags: z.array(z.string().max(100)).max(20),
    clarificationTopics: z.array(z.string().max(500)).max(10),
    clarificationTopicTags: z.array(z.string().max(100)).max(20),
    proposalLines: z
      .array(
        z
          .object({
            accountCode: z.string(),
            debit: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
            credit: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
            currency: z.string(),
            exchangeRate: z.string().regex(/^\d+(?:\.\d{1,8})?$/),
          })
          .strict(),
      )
      .max(100),
    calculations: z.array(calculationSchema).max(12),
  })
  .strict();
export type ResearchAnswer = z.infer<typeof answerSchema>;
export interface AnswerEvidence {
  id: string;
  kind: 'ledger' | 'document' | 'calculation';
  organizationId: string;
  documentId?: string;
  text?: string;
  facts?: {
    key: string;
    value: string;
    unit: string;
    entity?: string;
    from?: string;
    to?: string;
    asOf?: string;
  }[];
}
export function evidenceFor(queries: ToolEvidence[], docs: RetrievedDocument[]): AnswerEvidence[] {
  return [
    ...queries.map((query) => {
      const plan = querySchema.safeParse(query.plan);
      const q = plan.success ? plan.data : null;
      const unit =
        q?.metric === 'transaction_count'
          ? 'count'
          : q?.metric === 'native_account_balance'
            ? (accounts.find((a) => a.code === q.accountCodes[0])?.currency ?? 'UNKNOWN')
            : 'USD';
      const facts = query.rows.flatMap((row) =>
        Object.entries(row)
          .filter(
            ([key, value]) => key === 'value' && typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value),
          )
          .map(([, value]) => ({
            key:
              q?.metric === 'expenses' && q.groupBy === 'account'
                ? 'expense_total'
                : q?.metric === 'revenue' && q.groupBy === 'vendor'
                  ? 'customer_revenue'
                  : (q?.metric ?? 'query_value'),
            value: String(value),
            unit,
            ...(q?.from ? { from: q.from } : {}),
            ...(q ? { to: q.to } : {}),
            ...(q &&
            [
              'cash_balance',
              'account_balance',
              'native_account_balance',
              'receivables',
              'payables',
              'assets',
              'liabilities',
              'equity',
            ].includes(q.metric)
              ? { asOf: q.to }
              : {}),
            ...(q && ['account', 'vendor'].includes(q.groupBy) && typeof row.label === 'string'
              ? { entity: q.groupBy === 'account' ? row.label.replace(/^\d+\s+/, '') : row.label }
              : {}),
          })),
      );
      return {
        id: query.id,
        kind: 'ledger' as const,
        organizationId: primaryOrganizationId,
        text: JSON.stringify(query),
        facts,
      };
    }),
    ...docs.map((doc) => ({
      id: doc.id,
      kind: 'document' as const,
      organizationId: doc.organizationId,
      documentId: doc.id,
      text: doc.text,
      facts: extractSourceAmounts(doc.text),
    })),
  ];
}
export function extractSourceAmounts(text: string): { key: string; value: string; unit: string }[] {
  const values: { key: string; value: string; unit: string }[] = [];
  for (const match of text.matchAll(/(USD|EUR|\$|€)\s*(-?\d[\d,]*(?:\.\d+)?)/g))
    values.push({
      key: 'source_amount',
      value: match[2].replaceAll(',', ''),
      unit: ['USD', '$'].includes(match[1]) ? 'USD' : 'EUR',
    });
  for (const match of text.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*(USD|EUR)\b/g))
    values.push({ key: 'source_amount', value: match[1].replaceAll(',', ''), unit: match[2] });
  for (const match of text.matchAll(
    /(-?\d[\d,]*(?:\.\d+)?)\s*(percent\b|%|calendar days\b|days\b|months\b)/g,
  ))
    values.push({
      key: 'source_quantity',
      value: match[1].replaceAll(',', ''),
      unit: ['percent', '%'].includes(match[2]) ? 'percent' : match[2].includes('days') ? 'days' : 'months',
    });
  for (const match of text.matchAll(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:months|years|people|employees|hires)\b/gi,
  )) {
    const words = [
      'zero',
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
    ];
    values.push({
      key: 'source_count',
      value: String(
        words.includes(match[1].toLowerCase()) ? words.indexOf(match[1].toLowerCase()) : Number(match[1]),
      ),
      unit: 'count',
    });
  }
  return values;
}
function eq(a: string, b: string) {
  try {
    return new Decimal(a).eq(b);
  } catch {
    return false;
  }
}

/** Checks provenance existence, exact arithmetic and posting invariants, not semantics.
 * Semantic support is separately measured against gold and optionally reviewed. */
export function validateAnswer(input: unknown, question: ResearchQuestion, evidence: AnswerEvidence[]) {
  const answer = answerSchema.parse(input),
    reasons: string[] = [];
  const sources = new Map(evidence.map((item) => [item.id, item]));
  if (evidence.some((item) => item.organizationId !== question.organizationId))
    reasons.push('CROSS_WORKSPACE_EVIDENCE');
  const ids = [
    ...answer.evidenceIds,
    ...answer.facts.flatMap((f) => f.evidenceIds),
    ...answer.calculations.flatMap((c) => c.evidenceIds),
  ];
  const allowed = new Set([...sources.keys(), ...answer.calculations.map((c) => `calc:${c.id}`), 'user']);
  if (ids.some((id) => !allowed.has(id))) reasons.push('UNKNOWN_EVIDENCE');
  const resolved = new Map<string, { value: string; unit: string }>();
  const calculationSources = new Map(answer.calculations.map((c) => [`calc:${c.id}`, c.evidenceIds]));
  const hasLedger = (ids: string[], seen = new Set<string>()): boolean =>
    ids.some((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return sources.get(id)?.kind === 'ledger' || hasLedger(calculationSources.get(id) ?? [], seen);
    });
  if (new Set(answer.calculations.map((c) => c.id)).size !== answer.calculations.length)
    reasons.push('DUPLICATE_CALCULATION_ID');
  const availableFacts = (ids: string[]) =>
    ids.flatMap((id) =>
      id === 'user'
        ? extractSourceAmounts(question.question)
        : resolved.has(id)
          ? [{ key: id, ...resolved.get(id)! }]
          : (sources.get(id)?.facts ?? []),
    );
  for (const c of answer.calculations) {
    const available = availableFacts(c.evidenceIds);
    // Unit conversion constants are explicit arithmetic conventions, not invented data.
    available.push(...['100', '12', '1', '0'].map((value) => ({ key: 'constant', value, unit: 'count' })));
    if (
      c.operands.some(
        (operand, i) => !available.some((n) => eq(operand, n.value) && n.unit === c.operandUnits[i]),
      )
    ) {
      reasons.push('UNSUPPORTED_CALCULATION_OPERAND');
      continue;
    }
    try {
      const value = calculate(c);
      resolved.set(`calc:${c.id}`, { value, unit: c.unit });
    } catch {
      reasons.push('INVALID_CALCULATION');
    }
  }
  for (const f of answer.facts) {
    if (!f.evidenceIds.length && answer.behavior === 'ANSWER') reasons.push('UNCITED_FACT');
    if (
      [
        'cash_balance',
        'cash_native',
        'cash_carrying',
        'revenue',
        'expenses',
        'net_income',
        'receivables',
        'payables',
        'loan_payable',
        'expense_total',
        'customer_revenue',
        'revenue_share',
        'supplies_purchases',
        'equipment_purchases',
        'matching_entries',
        'posted_expense',
        'remaining_buffer',
        'runway',
      ].includes(f.key) &&
      !hasLedger(f.evidenceIds)
    )
      reasons.push('LEDGER_METRIC_REQUIRES_LEDGER');
    if (!['text', 'boolean'].includes(f.unit)) {
      if (!availableFacts(f.evidenceIds).some((n) => eq(f.value, n.value) && n.unit === f.unit))
        reasons.push('UNSUPPORTED_NUMERIC_FACT');
    }
  }
  if (answer.behavior === 'PROPOSAL') {
    if (answer.proposalLines.length < 2) reasons.push('PROPOSAL_LINE_COUNT');
    let debit = new Decimal(0),
      credit = new Decimal(0);
    for (const line of answer.proposalLines) {
      const account = accounts.find((a) => a.code === line.accountCode),
        d = new Decimal(line.debit),
        c = new Decimal(line.credit),
        rate = new Decimal(line.exchangeRate);
      if (
        !account ||
        account.currency !== line.currency ||
        rate.lte(0) ||
        (line.currency === 'USD' && !rate.eq(1)) ||
        d.isZero() === c.isZero()
      )
        reasons.push('INVALID_PROPOSAL_LINE');
      debit = debit.plus(d.times(rate).toDecimalPlaces(2));
      credit = credit.plus(c.times(rate).toDecimalPlaces(2));
    }
    if (!debit.eq(credit) || debit.isZero()) reasons.push('UNBALANCED_PROPOSAL');
  } else if (answer.proposalLines.length) reasons.push('UNEXPECTED_PROPOSAL');
  if (!reasons.length)
    for (const c of answer.calculations)
      if (resolved.has(`calc:${c.id}`))
        evidence.push({
          id: `calc:${c.id}`,
          kind: 'calculation',
          organizationId: question.organizationId,
          text: resolved.get(`calc:${c.id}`)!.value,
          facts: [{ key: c.id, ...resolved.get(`calc:${c.id}`)! }],
        });
  return {
    answer,
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    calculations: Object.fromEntries(resolved),
  };
}
