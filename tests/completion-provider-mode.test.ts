import { describe, expect, it, vi } from 'vitest';
import { buildGeminiFinancialRequest, parseGeminiFinancialResponse } from '../server/ai-provider';
import { geminiFunctionCallingConfig, geminiProviderSchema } from '../server/provider-schema';
import {
  completionInitialTools,
  completionFollowupTools,
  parseCompletionArgs,
} from '../server/completion-tools';
import { financialAnalysisTool } from '../server/financial-analysis';
import { financialScenarioTool } from '../server/financial-calculation';
import { inspectFinancialDataTool, showInspectedResultsTool } from '../server/financial-inspection';
import { completionWireTools } from '../server/completion-wire';

const base = [financialAnalysisTool, financialScenarioTool, inspectFinancialDataTool];
const tools = completionInitialTools(base);
const response = (parts: unknown[]) => ({ candidates: [{ finishReason: 'STOP', content: { parts } }] });

describe('Completion declaration provider mode with unchanged validation', () => {
  it('uses one compact initial declaration with ANY while preserving canonical tools and input', () => {
    const before = structuredClone(tools);
    const request = buildGeminiFinancialRequest(tools, 'Plan one tool call.', [
      { role: 'user', content: 'Repair parts spending in August 2026?' },
    ]);
    const wire = JSON.parse(JSON.stringify(request.body)) as {
      toolConfig: { functionCallingConfig: unknown };
      tools: { functionDeclarations: unknown }[];
    };
    const projected = completionWireTools(tools);
    expect(wire.toolConfig.functionCallingConfig).toEqual({
      mode: 'ANY',
      allowedFunctionNames: projected.map((tool) => tool.name),
    });
    expect(wire.tools[0].functionDeclarations).toEqual(
      projected.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: geminiProviderSchema(t.parameters),
      })),
    );
    expect(request.body.systemInstruction.parts[0].text).toBe('Plan one tool call.');
    expect(projected[0].description).toContain('INITIAL WIRE FORMAT:');
    expect(request.body.generationConfig.maxOutputTokens).toBe(4000);
    expect(request.body.contents[0].parts).toEqual([{ text: 'Repair parts spending in August 2026?' }]);
    expect(tools).toEqual(before);
  });
  it('retains ANY and allowed function names for ordinary and follow-up tools', () => {
    for (const selection of [
      base,
      completionFollowupTools([inspectFinancialDataTool, showInspectedResultsTool]),
    ])
      expect(geminiFunctionCallingConfig(selection)).toEqual({
        mode: 'ANY',
        allowedFunctionNames: selection.map((t) => t.name),
      });
  });
  it.each([
    { parts: [{ text: 'I think the answer is $999.' }] },
    { parts: [{ functionCall: { name: 'execute_sql', args: { sql: 'delete from accounts' } } }] },
    {
      parts: [
        { functionCall: { name: 'financial_analysis', args: {} } },
        { functionCall: { name: 'financial_scenario', args: {} } },
      ],
    },
  ])('rejects prose-only, unknown and multiple calls before execution', ({ parts }) => {
    expect(() => parseGeminiFinancialResponse(tools, response(parts))).toThrow();
  });
  it('never treats prose accompanying a recognized call as an answer', () => {
    const parsed = parseGeminiFinancialResponse(
      tools,
      response([
        { text: 'The balance is $999.' },
        { functionCall: { name: 'financial_analysis', args: {} } },
      ]),
    );
    expect(parsed.call).toEqual({ name: 'financial_analysis', args: {} });
    expect(JSON.stringify(parsed)).not.toContain('$999');
  });
  it.each([
    {},
    { answerContract: { outputs: [] }, outputBindings: [] },
    {
      answerContract: { outputs: [{ id: 'a', sourceQuotes: [], requirement: { kind: 'value' } }] },
      outputBindings: [],
    },
    {
      answerContract: { outputs: [] },
      outputBindings: [{ outputId: 'a', source: { kind: 'query_row', calculationId: 'wrong' } }],
    },
  ])('keeps strict envelope rejection before the base query parser', (args) => {
    const parseBase = vi.fn(() => ({}));
    expect(() => parseCompletionArgs('financial_analysis', args, 'initial', parseBase)).toThrow();
    expect(parseBase).not.toHaveBeenCalled();
  });
});
