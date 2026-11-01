import { describe, expect, it } from 'vitest';
import { completionWireTools, decodeCompletionWireCall } from '../server/completion-wire';
import {
  completionInitialTools,
  completionFollowupTools,
  parseCompletionArgs,
} from '../server/completion-tools';
import { financialAnalysisTool, financialAnalysisSchema } from '../server/financial-analysis';
import { financialScenarioTool, parseFinancialScenario } from '../server/financial-calculation';
import {
  inspectFinancialDataTool,
  showInspectedResultsTool,
  inspectionArgsSchemas,
} from '../server/financial-inspection';
import { chatClarificationTool } from '../server/chat-clarification';
import { buildGeminiFinancialRequest, parseGeminiFinancialResponse } from '../server/ai-provider';
import { geminiProviderSchema } from '../server/provider-schema';

const baseTools = [
  financialAnalysisTool,
  financialScenarioTool,
  inspectFinancialDataTool,
  chatClarificationTool,
];
const originalTools = completionInitialTools(baseTools);
const query = {
  id: 'q1',
  metric: 'net_expense',
  aggregation: 'sum',
  from: '2026-08-01',
  to: '2026-08-31',
  status: 'POSTED',
  currencyMode: 'base',
  currency: null,
  groupBy: 'total',
  accountCodes: ['5030'],
  cooccurringAccountCodes: [],
  counterparty: { mode: 'exact', value: 'Fixture supplier' },
  descriptionSearch: '',
  minimumAmount: null,
  maximumAmount: null,
  order: 'label_asc',
  limit: 50,
};
const scope = {
  metric: query.metric,
  aggregation: query.aggregation,
  from: query.from,
  to: query.to,
  status: query.status,
  currencyMode: query.currencyMode,
  currency: query.currency,
  accountCodes: query.accountCodes,
  cooccurringAccountCodes: [],
  counterparty: query.counterparty,
  descriptionSearch: '',
  minimumAmount: null,
  maximumAmount: null,
};
const output = {
  id: 'total',
  sourceQuotes: [{ messageIndex: 2, quote: 'Use August instead.' }],
  requirement: { kind: 'value', scope, counterpartyFrom: null, selectedAccountCode: null },
};
const binding = { outputId: 'total', source: { kind: 'query_row', queryId: 'q1', rowId: 'total:total' } };
const arithmeticOutput = {
  id: 'sum_output',
  sourceQuotes: [{ messageIndex: 0, quote: 'Add $2 and $3' }],
  requirement: {
    kind: 'arithmetic',
    operation: 'add',
    operands: [
      { source: 'assumption', value: '2', unit: 'USD', sourceText: '$2' },
      { source: 'assumption', value: '3', unit: 'USD', sourceText: '$3' },
    ],
  },
};
const assumptions = [
  { id: 'first', value: '2', unit: 'USD', sourceText: '$2' },
  { id: 'second', value: '3', unit: 'USD', sourceText: '$3' },
];
const calculations = [
  {
    id: 'sum',
    operation: 'add',
    operands: [
      { source: 'assumption', id: 'first', rowId: null, field: 'value' },
      { source: 'assumption', id: 'second', rowId: null, field: 'value' },
    ],
  },
];
const wire = (change: Record<string, unknown> = {}) => ({
  mode: 'analysis',
  queries: [structuredClone(query)],
  assumptions: [],
  calculations: [],
  outputs: [structuredClone(output)],
  bindings: [structuredClone(binding)],
  ...change,
});
function decoded(args: unknown, tools = originalTools) {
  return decodeCompletionWireCall(tools, { name: 'plan_complete_answer', args });
}
function parseBase(name: string, args: unknown): Record<string, unknown> {
  if (name === 'financial_analysis') return financialAnalysisSchema.parse(args);
  if (name === 'financial_scenario') return parseFinancialScenario(args);
  if (name === 'inspect_financial_data') return inspectionArgsSchemas.inspect_financial_data.parse(args);
  throw Error('Unexpected test function');
}
function fullParse(args: unknown) {
  const call = decoded(args);
  return { name: call.name, args: parseCompletionArgs(call.name, call.args, 'initial', parseBase) };
}

describe('Single completion wire tool without changing canonical financial meaning', () => {
  it('maps analysis and inspection through the same strict canonical schemas without changing any semantic field', () => {
    for (const mode of ['analysis', 'inspect']) {
      const args = wire({ mode, bindings: mode === 'inspect' ? [] : [binding] });
      const before = structuredClone(args);
      const result = fullParse(args);
      expect(result).toEqual({
        name: mode === 'analysis' ? 'financial_analysis' : 'inspect_financial_data',
        args: {
          queries: [mode === 'inspect' ? { ...query, counterpartySource: null } : query],
          answerContract: { outputs: [output] },
          outputBindings: args.bindings,
        },
      });
      expect(args).toEqual(before);
    }
  });
  it('maps scenario assumptions, exact operands, output declaration and calculation binding unchanged', () => {
    const bindings = [{ outputId: 'sum_output', source: { kind: 'calculation', calculationId: 'sum' } }];
    const args = wire({
      mode: 'scenario',
      queries: [],
      assumptions,
      calculations,
      outputs: [arithmeticOutput],
      bindings,
    });
    expect(fullParse(args)).toEqual({
      name: 'financial_scenario',
      args: {
        queries: [],
        assumptions,
        calculations,
        answerContract: { outputs: [arithmeticOutput] },
        outputBindings: bindings,
      },
    });
  });
  it.each(['mode', 'queries', 'assumptions', 'calculations', 'outputs', 'bindings'])(
    'rejects a missing %s instead of filling it',
    (field) => {
      const args: Record<string, unknown> = wire();
      delete args[field];
      expect(() => decoded(args)).toThrow();
    },
  );
  it.each([
    { unexpected: true },
    { type: 'OBJECT' },
    { '"outputs"': [output] },
    { mode: 'execute_sql' },
    { assumptions },
    { calculations },
    { mode: 'inspect', bindings: [binding] },
    { mode: 'scenario', assumptions, calculations: [] },
    { mode: 'inspect', assumptions, bindings: [] },
    { mode: 'inspect', calculations, bindings: [] },
  ])('rejects extra fields and incompatible mode payloads %j', (change) => {
    expect(() => decoded(wire(change))).toThrow();
  });
  it('rejects nested schema decorations and invalid values instead of stripping or repairing them', () => {
    expect(() => decoded(wire({ outputs: [{ ...output, type: 'OBJECT' }] }))).toThrow();
    expect(() =>
      decoded(wire({ outputs: [{ ...output, requirement: { ...output.requirement, extra: null } }] })),
    ).toThrow();
    expect(() => decoded(wire({ queries: [{ ...query, from: 20260801 }] }))).toThrow();
    expect(() =>
      decoded(wire({ bindings: [{ ...binding, source: { ...binding.source, sql: 'SELECT 1' } }] })),
    ).toThrow();
  });
  it('preserves structurally valid wrong semantic references for downstream source guards to assess', () => {
    const wrong = { ...output, sourceQuotes: [{ messageIndex: 1, quote: 'Use August instead.' }] };
    const wrongBinding = { outputId: 'total', source: { kind: 'query_result', queryId: 'q1' } };
    expect(fullParse(wire({ outputs: [wrong], bindings: [wrongBinding] })).args).toMatchObject({
      answerContract: { outputs: [wrong] },
      outputBindings: [wrongBinding],
    });
  });
  it('preserves legacy known calls and refuses the wire alias for ordinary or follow-up tools', () => {
    const legacy = {
      name: 'financial_analysis',
      args: { queries: [query], answerContract: { outputs: [output] }, outputBindings: [binding] },
    };
    expect(decodeCompletionWireCall(originalTools, legacy)).toEqual(legacy);
    expect(() => decodeCompletionWireCall(originalTools, { name: 'execute_sql', args: {} })).toThrow();
    expect(() => decoded(wire(), baseTools)).toThrow();
    expect(() =>
      decoded(wire(), completionFollowupTools([inspectFinancialDataTool, showInspectedResultsTool])),
    ).toThrow();
  });
  it('collapses only initial completion, keeps clarification and leaves source tool objects unchanged', () => {
    const before = structuredClone(originalTools);
    const collapsed = completionWireTools(originalTools);
    expect(collapsed.map((tool) => tool.name).sort()).toEqual(['plan_complete_answer', 'request_details']);
    expect(collapsed.find((tool) => tool.name === 'request_details')).toEqual(chatClarificationTool);
    expect(originalTools).toEqual(before);
    expect(completionWireTools(baseTools)).toEqual(baseTools);
    const followup = completionFollowupTools([inspectFinancialDataTool, showInspectedResultsTool]);
    expect(completionWireTools(followup)).toEqual(followup);
  });
  it('sends one output schema instead of three while retaining the full strict nested grammar', () => {
    const collapsed = completionWireTools(originalTools);
    const original = JSON.stringify(originalTools.map((tool) => geminiProviderSchema(tool.parameters)));
    const reduced = JSON.stringify(collapsed.map((tool) => geminiProviderSchema(tool.parameters)));
    expect(original.match(/"sourceQuotes":/g)).toHaveLength(3);
    expect(reduced.match(/"sourceQuotes":/g)).toHaveLength(1);
    expect(Buffer.byteLength(reduced)).toBeLessThan(Buffer.byteLength(original) * 0.6);
    const tool = collapsed.find((tool) => tool.name === 'plan_complete_answer')!;
    expect(tool.strict).toBe(true);
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.parameters.required).toEqual(
      expect.arrayContaining(['mode', 'queries', 'assumptions', 'calculations', 'outputs', 'bindings']),
    );
  });
  it('uses the compact Gemini declaration with unchanged conversation, ANY and output cap; parsing still requires one known call', () => {
    const messages = [{ role: 'user' as const, content: 'Show recorded August expenses.' }];
    const request = buildGeminiFinancialRequest(originalTools, 'Plan only verified tools.', messages);
    const body = JSON.parse(JSON.stringify(request.body)) as {
      toolConfig: { functionCallingConfig: unknown };
      tools: { functionDeclarations: { name: string }[] }[];
    };
    expect(body.toolConfig.functionCallingConfig).toEqual({
      mode: 'ANY',
      allowedFunctionNames: ['plan_complete_answer', 'request_details'],
    });
    expect(body.tools[0].functionDeclarations.map((tool) => tool.name).sort()).toEqual([
      'plan_complete_answer',
      'request_details',
    ]);
    expect(request.body.contents).toEqual([{ role: 'user', parts: [{ text: messages[0].content }] }]);
    expect(request.body.generationConfig.maxOutputTokens).toBe(4000);
    const call = { name: 'plan_complete_answer', args: wire() };
    const response = (parts: unknown[]) => ({ candidates: [{ finishReason: 'STOP', content: { parts } }] });
    expect(parseGeminiFinancialResponse(originalTools, response([{ functionCall: call }])).call).toEqual(
      call,
    );
    expect(() =>
      parseGeminiFinancialResponse(originalTools, response([{ functionCall: call }, { functionCall: call }])),
    ).toThrow();
    expect(() => parseGeminiFinancialResponse(originalTools, response([{ text: '$999' }]))).toThrow();
  });
});
