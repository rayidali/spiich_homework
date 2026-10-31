import { buildFinancialPlannerInput, parseInsightArgs } from '../../server/ai';
import { buildGeminiFinancialRequest, parseGeminiFinancialResponse } from '../../server/ai-provider';
import type { ChatRoute, Fixture, RecordedCall, TokenUsage } from './types';
import type { ModelMessages } from '../../server/ai-provider';
import { hash } from './io';
export const MODEL = 'gemini-3.5-flash-lite';
export const MAX_RESPONSE_BYTES = 128 * 1024;
/** Projection intentionally mirrors each product route's actual chart, not a gold-aware adapter. */
export function plannerRequest(route: ChatRoute, fixture: Fixture, messages: ModelMessages) {
  const all = fixture.accounts
    .filter((a) => a.organization_id === fixture.primaryOrganizationId)
    .sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
  const chart = all
    .filter((a) => route === 'composable' || a.type === 'EXPENSE')
    .map((a) => ({
      code: a.code,
      name: a.name,
      currency: a.currency,
      group: a.is_group,
      parentCode: all.find((p) => p.id === a.parent_id)?.code ?? null,
      archived: a.archived,
      ...(route === 'composable' ? { type: a.type, isCash: a.is_cash } : {}),
    }));
  const input = buildFinancialPlannerInput(route, chart, fixture.today);
  const request = buildGeminiFinancialRequest(input.tools, input.instructions, messages, MODEL);
  return { ...request, tools: input.tools, hash: hash(JSON.stringify(request.body)) };
}
export function modelIdentityMatches(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && 'modelVersion' in raw && raw.modelVersion === MODEL;
}
/** Billing is settled only for the pinned returned identity, even if its tool call is malformed. */
export function reportedUsage(raw: unknown): TokenUsage | null {
  if (!modelIdentityMatches(raw) || !raw || typeof raw !== 'object' || !('usageMetadata' in raw)) return null;
  const u = raw.usageMetadata as Record<string, unknown> | undefined;
  if (!u || typeof u !== 'object') return null;
  const values = [u.promptTokenCount, u.candidatesTokenCount, u.thoughtsTokenCount ?? 0, u.totalTokenCount];
  if (!values.every((v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)) return null;
  const [inputTokens, outputTokens, thinkingTokens, totalTokens] = values as number[];
  if (inputTokens + outputTokens + thinkingTokens !== totalTokens) return null;
  return { inputTokens, outputTokens, thinkingTokens, totalTokens };
}
export function parsePlan(
  request: ReturnType<typeof plannerRequest>,
  raw: unknown,
): { call: RecordedCall; modelVersion?: string } {
  if (!modelIdentityMatches(raw)) throw Error('MODEL_IDENTITY_UNVERIFIED');
  const parsed = parseGeminiFinancialResponse(request.tools, raw);
  return {
    call: { name: parsed.call.name, args: parseInsightArgs(parsed.call.name, parsed.call.args) },
    ...(parsed.modelVersion ? { modelVersion: parsed.modelVersion } : {}),
  };
}
