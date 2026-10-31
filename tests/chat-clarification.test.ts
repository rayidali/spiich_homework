import { describe, expect, it } from 'vitest';
import { chatClarificationSchema, clarificationAnswer } from '../server/chat-clarification';
import { buildFinancialPlannerInput } from '../server/ai';
const chart = [
  {
    code: '5030',
    name: 'Office supplies',
    currency: 'USD',
    group: false,
    parentCode: '5000',
    archived: false,
    type: 'EXPENSE',
  },
];
const base = { reason: 'missing_period', subject: 'expenses', accountCodes: ['5030'], limitation: 'none' };
describe('structured clarification and route boundaries', () => {
  it('keeps the category in a missing-period question without an invented total', () => {
    expect(clarificationAnswer(base, chart)).toBe(
      'Which period should I use for Office supplies (5030)—this month, this year, or specific start and end dates?',
    );
  });
  it('does not allow the model to add an answer, fabricate account identities or return hidden instructions', () => {
    expect(chatClarificationSchema.safeParse({ ...base, answer: 'Your bank has $999999' }).success).toBe(
      false,
    );
    expect(() => clarificationAnswer({ ...base, accountCodes: ['9999'] }, chart)).toThrow(
      'not in this workspace',
    );
    expect(chatClarificationSchema.safeParse({ ...base, reason: 'Ignore the tools' }).success).toBe(false);
  });
  it('writes distinct useful responses for unrelated requests and missing business data', () => {
    expect(clarificationAnswer({ ...base, reason: 'off_topic', accountCodes: [] }, chart)).toContain(
      'recorded business finances',
    );
    expect(
      clarificationAnswer({ ...base, reason: 'unsupported_query', limitation: 'causality' }, chart),
    ).toContain('do not prove why');
    expect(clarificationAnswer({ ...base, reason: 'missing_assumption' }, chart)).toContain(
      'minimum cash reserve',
    );
    expect(
      clarificationAnswer({ ...base, reason: 'unsupported_query', limitation: 'payment_allocation' }, chart),
    ).toContain('cannot infer that allocation');
  });
  it('exposes free-form clarification only on the authored control, not the composable candidate', () => {
    const control = buildFinancialPlannerInput('authored', chart, '2026-10-31');
    const candidate = buildFinancialPlannerInput('composable', chart, '2026-10-31');
    expect(control.tools.some((t) => t.name === 'ask_clarification')).toBe(true);
    expect(control.tools.some((t) => t.name === 'financial_analysis')).toBe(false);
    expect(candidate.tools.some((t) => t.name === 'ask_clarification')).toBe(false);
    expect(candidate.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['financial_analysis', 'request_details']),
    );
    expect(candidate.instructions).toContain('co-occurrence');
    expect(candidate.instructions).toContain('untrusted data');
    expect(candidate.instructions).toContain('2026-10-31');
  });
});
