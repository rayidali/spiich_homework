import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFinancialPlannerInput, type FinancialPlannerAccount } from '../../server/ai';
import { buildGeminiFinancialRequest } from '../../server/ai-provider';
import { pool } from '../../server/db';
import { fixtureMessages, loadCases, loadLedger } from '../../scripts/completeness-evaluation/fixtures';
import type { CompletenessRoute } from '../../scripts/completeness-evaluation/types';

const ledger = loadLedger();
const chart: FinancialPlannerAccount[] = ledger.accounts.map((account) => ({
  code: account.code,
  name: account.name,
  currency: account.currency,
  group: account.isGroup,
  parentCode: account.parentCode,
  archived: account.archived,
  type: account.type,
  isCash: account.isCash,
}));
const largest = loadCases('development').find((item) => item.id === 'D03')!;
afterEach(() => vi.restoreAllMocks());

describe('Offline development request-size preflight', () => {
  it.each<CompletenessRoute>(['composable', 'adaptive', 'complete'])(
    'keeps the actual %s wire payload below 256 KiB without provider calls or label leakage',
    (route) => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('Preflight must be offline');
      });
      const database = vi.spyOn(pool, 'connect').mockImplementation(() => {
        throw new Error('Preflight must not read a database');
      });
      const messages = fixtureMessages(largest);
      expect(largest.expected.required).toHaveLength(8);
      const planner = buildFinancialPlannerInput(route, chart, '2026-10-31');
      const request = buildGeminiFinancialRequest(
        planner.tools,
        planner.instructions,
        messages,
        'gemini-3.5-flash-lite',
      );
      const body = JSON.parse(JSON.stringify(request.body));
      const serialized = JSON.stringify(body);
      expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(256 * 1024);
      expect(Buffer.byteLength(JSON.stringify(body.tools), 'utf8')).toBeLessThanOrEqual(256 * 1024);
      expect(body.generationConfig.maxOutputTokens).toBe(4000);
      expect(body.contents).toEqual(
        messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
      );
      expect(body.systemInstruction.parts[0].text).toBe(planner.instructions);
      for (const claim of largest.expected.required) {
        expect(serialized).not.toContain(`"${claim.id}"`);
        expect(serialized).not.toContain(claim.value);
      }
      expect(serialized).not.toContain('completeness-fixture-v1');
      expect(serialized).not.toContain('"supporting"');
      expect(serialized).not.toContain('"split":"development"');
      expect(fetch).not.toHaveBeenCalled();
      expect(database).not.toHaveBeenCalled();
      // This validates input bytes and a configured cap only. It cannot establish
      // that a future model can finish all eight outputs within4000 output tokens.
    },
  );
});
