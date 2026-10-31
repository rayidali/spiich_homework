import { describe, expect, it } from 'vitest';
import { buildFinancialPlannerInput } from '../../server/ai';
import { buildGeminiFinancialRequest } from '../../server/ai-provider';
import { MODEL, parsePlan, plannerRequest, reportedUsage } from '../../scripts/chat-evaluation/planner';
import type { Fixture } from '../../scripts/chat-evaluation/types';
const fixture: Fixture = {
  version: 'offline',
  today: '2026-07-15',
  timezone: 'America/New_York',
  primaryOrganizationId: 'primary',
  foreignOrganizationId: 'foreign',
  organizations: [],
  entries: [],
  accounts: [
    {
      id: 'bank',
      organization_id: 'primary',
      code: '1010',
      name: 'Bank',
      type: 'ASSET',
      currency: 'USD',
      is_cash: true,
      is_group: false,
      archived: false,
      parent_id: null,
    },
    {
      id: 'expense',
      organization_id: 'primary',
      code: '5010',
      name: 'Rent',
      type: 'EXPENSE',
      currency: 'USD',
      is_cash: false,
      is_group: false,
      archived: false,
      parent_id: null,
    },
    {
      id: 'foreign',
      organization_id: 'foreign',
      code: '9000',
      name: 'PRIVATE FOREIGN SENTINEL',
      type: 'EXPENSE',
      currency: 'USD',
      is_cash: false,
      is_group: false,
      archived: false,
      parent_id: null,
    },
  ],
};
const messages = [{ role: 'user' as const, content: 'Show rent for June 2026.' }];
const valid = (name: string, args: unknown) => ({
  candidates: [
    {
      finishReason: 'STOP',
      content: { parts: [{ functionCall: { name, args }, thoughtSignature: 'benign' }] },
    },
  ],
  usageMetadata: {
    promptTokenCount: 100,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 10,
    totalTokenCount: 130,
    serviceTier: 'standard',
  },
  modelVersion: MODEL,
});
describe('shared actual chat planner request/parser (offline)', () => {
  it('uses the production factory verbatim, with authored expense-only context', () => {
    const actual = plannerRequest('authored', fixture, messages),
      p = buildFinancialPlannerInput(
        'authored',
        [{ code: '5010', name: 'Rent', currency: 'USD', group: false, parentCode: null, archived: false }],
        fixture.today,
      );
    expect(actual.body).toEqual(buildGeminiFinancialRequest(p.tools, p.instructions, messages, MODEL).body);
    expect(JSON.stringify(actual.body)).not.toContain('PRIVATE FOREIGN SENTINEL');
    expect(JSON.stringify(actual.body)).not.toContain('"expected"');
  });
  it('passes all authorized chart types to the composable production factory and no oracle', () => {
    const body = JSON.stringify(plannerRequest('composable', fixture, messages).body);
    expect(body).toContain('1010');
    expect(body).not.toContain('PRIVATE FOREIGN SENTINEL');
    expect(body).not.toContain('commonCapability');
  });
  it('recovers additive usage even if the function call is wrong and rejects inconsistent token math', () => {
    const raw = valid('not_a_tool', {});
    expect(reportedUsage(raw)).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      thinkingTokens: 10,
      totalTokens: 130,
    });
    expect(
      reportedUsage({ ...raw, usageMetadata: { ...raw.usageMetadata, totalTokenCount: 999 } }),
    ).toBeNull();
    expect(reportedUsage({})).toBeNull();
  });
  it('enforces route tool membership, strict args and exactly one actual call', () => {
    const req = plannerRequest('authored', fixture, messages);
    expect(
      parsePlan(
        req,
        valid('expense_by_account', { accountCode: '5010', from: '2026-06-01', to: '2026-06-30' }),
      ).call.name,
    ).toBe('expense_by_account');
    expect(() => parsePlan(req, valid('financial_analysis', { queries: [] }))).toThrow();
    expect(() =>
      parsePlan(req, valid('cash_position', { asOf: '2026-06-30', organizationId: 'foreign' })),
    ).toThrow();
    const raw = valid('cash_position', { asOf: '2026-06-30' });
    raw.candidates[0].content.parts.push(raw.candidates[0].content.parts[0]);
    expect(() => parsePlan(req, raw)).toThrow();
  });
});
