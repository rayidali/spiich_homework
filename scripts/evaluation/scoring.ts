import { isDeepStrictEqual } from 'node:util';
import { Decimal, baseAmount } from '../../shared/money';
import { entrySchema } from '../../shared/schema';
import type { EvaluationCase, ExpectedLine } from './cases';

export type Score = { passed: boolean; failures: string[] };
type ExpectedEntry = Extract<EvaluationCase['expected'], { action: 'READY' }>;
const decimal = (value: string) => new Decimal(value).toString();
function canonical(lines: ExpectedLine[]) {
  return lines
    .map((line) => ({
      code: line.code,
      debit: decimal(line.debit),
      credit: decimal(line.credit),
      exchangeRate: decimal(line.exchangeRate),
      baseDebit: baseAmount(line.debit, line.exchangeRate),
      baseCredit: baseAmount(line.credit, line.exchangeRate),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
export function scoreEntry(
  actual: unknown,
  expected: ExpectedEntry,
  codesById: Record<string, string>,
): Score {
  const failures: string[] = [];
  if (!actual || typeof actual !== 'object' || !('action' in actual) || actual.action !== 'READY')
    return {
      passed: false,
      failures: ['Expected a complete READY proposal, not clarification or an error.'],
    };
  const parsed = entrySchema.safeParse('entry' in actual ? actual.entry : null);
  if (!parsed.success) return { passed: false, failures: ['Missing or malformed entry.'] };
  if (parsed.data.date !== expected.date)
    failures.push(`Date differs: expected ${expected.date}, got ${parsed.data.date}.`);
  if (parsed.data.source !== 'AI') failures.push('Proposal source must be AI.');
  const normalized = parsed.data.lines.map((line) => ({
    ...line,
    code: codesById[line.accountId] ?? 'FOREIGN_OR_UNKNOWN_ACCOUNT',
  }));
  if (normalized.some((line) => line.code === 'FOREIGN_OR_UNKNOWN_ACCOUNT'))
    failures.push('Unknown or cross-organization account.');
  try {
    if (!isDeepStrictEqual(canonical(normalized), canonical(expected.lines)))
      failures.push(
        'The complete line multiset differs in accounts, native amounts, rates, or rounded base amounts.',
      );
    if (normalized.some((line) => new Decimal(line.debit).gt(0) === new Decimal(line.credit).gt(0)))
      failures.push('Every line must have exactly one positive side.');
    const sum = normalized.reduce(
      (total, line) =>
        total
          .plus(baseAmount(line.debit, line.exchangeRate))
          .minus(baseAmount(line.credit, line.exchangeRate)),
      new Decimal(0),
    );
    if (!sum.isZero()) failures.push('Base-currency debits and credits do not balance.');
  } catch {
    failures.push('Invalid decimal amounts or exchange rates.');
  }
  return { passed: failures.length === 0, failures };
}

export function scoreClarification(actual: unknown, mode: 'entry' | 'chat'): Score {
  if (!actual || typeof actual !== 'object')
    return { passed: false, failures: ['No clarification response.'] };
  if (mode === 'entry') {
    const r = actual as { action?: unknown; entry?: unknown; questions?: unknown };
    const passed =
      r.action === 'CLARIFY' &&
      r.entry === null &&
      Array.isArray(r.questions) &&
      r.questions.some((q) => typeof q === 'string' && q.trim().length > 0);
    return { passed, failures: passed ? [] : ['Expected clarification questions and no ready entry.'] };
  }
  const r = actual as { query?: { name?: unknown }; answer?: unknown; evidence?: unknown };
  const passed =
    r.query?.name === 'ask_clarification' &&
    typeof r.answer === 'string' &&
    r.answer.trim().length > 0 &&
    Array.isArray(r.evidence) &&
    r.evidence.length === 0;
  return {
    passed,
    failures: passed
      ? []
      : ['Expected the clarification tool, a nonempty question, and no financial evidence.'],
  };
}

export function scoreInsight(
  actual: unknown,
  expected: Extract<EvaluationCase['expected'], { tool: string }>,
  expectedResult: { answer: string; evidence: unknown },
): Score {
  const failures: string[] = [];
  if (!actual || typeof actual !== 'object') return { passed: false, failures: ['No financial response.'] };
  const r = actual as { query?: { name?: unknown; args?: unknown }; answer?: unknown; evidence?: unknown };
  if (r.query?.name !== expected.tool) failures.push('Wrong financial query selected.');
  if (!isDeepStrictEqual(r.query?.args, expected.args))
    failures.push('Query dates, scope, or search arguments differ.');
  if (r.answer !== expectedResult.answer)
    failures.push('Answer differs from the deterministic SQL-backed answer.');
  if (!isDeepStrictEqual(r.evidence, [expectedResult.evidence]))
    failures.push('Evidence values, record identities, links, or period differ.');
  return { passed: failures.length === 0, failures };
}

export function shouldStop(code: string, status?: number) {
  return (
    [
      'AI_AUTH_ERROR',
      'AI_RATE_LIMIT',
      'AI_MODEL_UNAVAILABLE',
      'AI_REQUEST_REJECTED',
      'AI_USAGE_UNAVAILABLE',
      'AI_BUDGET_EXCEEDED',
      'AI_NOT_CONFIGURED',
      'EVALUATION_CONTEXT_SCOPE',
    ].includes(code) ||
    status === 401 ||
    status === 403 ||
    status === 429
  );
}

export function percentile(values: number[], percentileValue: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}
