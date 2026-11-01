import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  completionInitialTools,
  completionFollowupTools,
  parseCompletionArgs,
  stripCompletionArgs,
} from '../server/completion-tools';
import { financialAnalysisTool, financialAnalysisSchema } from '../server/financial-analysis';
import { financialScenarioTool, parseFinancialScenario } from '../server/financial-calculation';
import {
  inspectFinancialDataTool,
  showInspectedResultsTool,
  calculateFromInspectionTool,
  inspectionArgsSchemas,
} from '../server/financial-inspection';
import { chatClarificationTool, chatClarificationSchema } from '../server/chat-clarification';
import { answerContractSchema, outputBindingsSchema } from '../server/answer-contract';
import type { FinancialTool } from '../server/ai-provider';
import { buildGeminiFinancialRequest } from '../server/ai-provider';

const contract = {
  outputs: [
    {
      id: 'total',
      sourceQuotes: [{ messageIndex: 0, quote: 'Add $2 and $3' }],
      requirement: {
        kind: 'arithmetic',
        operation: 'add',
        operands: [
          { source: 'assumption', value: '2', unit: 'USD', sourceText: '$2' },
          { source: 'assumption', value: '3', unit: 'USD', sourceText: '$3' },
        ],
      },
    },
  ],
};
const bindings = [{ outputId: 'total', source: { kind: 'calculation', calculationId: 'sum' } }];
const scenario = {
  queries: [],
  assumptions: [
    { id: 'first', value: '2', unit: 'USD', sourceText: '$2' },
    { id: 'second', value: '3', unit: 'USD', sourceText: '$3' },
  ],
  calculations: [
    {
      id: 'sum',
      operation: 'add',
      operands: [
        { source: 'assumption', id: 'first', rowId: null, field: 'value' },
        { source: 'assumption', id: 'second', rowId: null, field: 'value' },
      ],
    },
  ],
};
const allTools = [
  financialAnalysisTool,
  financialScenarioTool,
  inspectFinancialDataTool,
  showInspectedResultsTool,
  calculateFromInspectionTool,
  chatClarificationTool,
];
const base = (name: string, args: unknown): Record<string, unknown> => {
  if (name === 'financial_scenario') return parseFinancialScenario(args);
  if (name === 'financial_analysis') return financialAnalysisSchema.parse(args);
  if (name === 'request_details') return chatClarificationSchema.parse(args);
  return inspectionArgsSchemas[name as keyof typeof inspectionArgsSchemas].parse(args);
};
const narrow: FinancialTool = {
  type: 'function',
  name: 'cash_position',
  strict: true,
  description: 'Cash.',
  parameters: {
    type: 'object',
    properties: { asOf: { type: 'string' } },
    required: ['asOf'],
    additionalProperties: false,
  },
};

describe('Completion-required tool envelopes, no provider calls', () => {
  it('exposes only supported initial paths and leaves original declarations unchanged', () => {
    const tools = [...allTools, narrow];
    const before = structuredClone(tools);
    const wrapped = completionInitialTools(tools);
    expect(wrapped.map((tool) => tool.name)).toEqual([
      'financial_analysis',
      'financial_scenario',
      'inspect_financial_data',
      'request_details',
    ]);
    for (const tool of wrapped.filter((tool) => tool.name !== 'request_details')) {
      expect(tool.parameters.required).toEqual(expect.arrayContaining(['answerContract', 'outputBindings']));
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.strict).toBe(true);
    }
    expect(wrapped.at(-1)).toEqual(chatClarificationTool);
    expect(wrapped.at(-1)).not.toBe(chatClarificationTool);
    expect(tools).toEqual(before);
  });
  it('preserves all original scenario properties, union branches and literal constraints', () => {
    const wrapped = completionInitialTools([financialScenarioTool])[0];
    const properties = wrapped.parameters.properties as Record<string, unknown>;
    for (const [key, schema] of Object.entries(financialScenarioTool.parameters.properties as object)) {
      expect(properties[key]).toEqual(schema);
    }
    expect(properties.answerContract).toEqual(
      z.toJSONSchema(z.object({ answerContract: answerContractSchema })).properties!.answerContract,
    );
    expect(properties.outputBindings).toEqual(
      z.toJSONSchema(z.object({ outputBindings: outputBindingsSchema })).properties!.outputBindings,
    );
  });
  it('retains the caller tool subset on followup and adds bindings only to finish tools', () => {
    const full = completionFollowupTools([...allTools, narrow]);
    expect(full.map((tool) => tool.name)).toEqual([
      'inspect_financial_data',
      'show_inspected_results',
      'calculate_from_inspection',
      'request_details',
    ]);
    expect(full[0]).toEqual(inspectFinancialDataTool);
    expect(full[3]).toEqual(chatClarificationTool);
    for (const tool of full.slice(1, 3)) {
      expect(tool.parameters.required).toEqual(expect.arrayContaining(['outputBindings']));
      expect(tool.parameters.properties).not.toHaveProperty('answerContract');
    }
    expect(
      completionFollowupTools([showInspectedResultsTool, chatClarificationTool]).map((tool) => tool.name),
    ).toEqual(['show_inspected_results', 'request_details']);
  });
  it('parses the initial scenario through its unchanged base parser and separates metadata', () => {
    const input = { ...scenario, answerContract: contract, outputBindings: bindings };
    const before = structuredClone(input);
    const parse = vi.fn(base);
    const parsed = parseCompletionArgs('financial_scenario', input, 'initial', parse);
    expect(parse).toHaveBeenCalledExactlyOnceWith('financial_scenario', scenario);
    expect(stripCompletionArgs(parsed)).toEqual({ args: scenario, contract, bindings });
    expect(input).toEqual(before);
  });
  it.each(['answerContract', 'outputBindings'])(
    'rejects a missing initial %s before the base parser executes',
    (key) => {
      const input: Record<string, unknown> = {
        ...scenario,
        answerContract: contract,
        outputBindings: bindings,
      };
      delete input[key];
      const parse = vi.fn(base);
      expect(() => parseCompletionArgs('financial_scenario', input, 'initial', parse)).toThrow(z.ZodError);
      expect(parse).not.toHaveBeenCalled();
    },
  );
  it('requires empty initial inspection bindings before any executor can be called', () => {
    const parse = vi.fn(() => ({ queries: [] }));
    expect(() =>
      parseCompletionArgs(
        'inspect_financial_data',
        { queries: [], answerContract: contract, outputBindings: bindings },
        'initial',
        parse,
      ),
    ).toThrow(z.ZodError);
    expect(parse).not.toHaveBeenCalled();
    expect(
      parseCompletionArgs(
        'inspect_financial_data',
        { queries: [], answerContract: contract, outputBindings: [] },
        'initial',
        parse,
      ),
    ).toEqual({ queries: [], answerContract: contract, outputBindings: [] });
    const properties = completionInitialTools([inspectFinancialDataTool])[0].parameters.properties as Record<
      string,
      { maxItems?: number }
    >;
    expect(properties.outputBindings.maxItems).toBe(0);
  });
  it('does not weaken strict base argument validation or accept additional envelope fields', () => {
    expect(() =>
      parseCompletionArgs(
        'financial_scenario',
        { ...scenario, answerContract: contract, outputBindings: [], injected: true },
        'initial',
        base,
      ),
    ).toThrow(z.ZodError);
    expect(() =>
      parseCompletionArgs(
        'financial_scenario',
        { ...scenario, answerContract: { ...contract, injected: true }, outputBindings: [] },
        'initial',
        base,
      ),
    ).toThrow(z.ZodError);
    expect(() =>
      parseCompletionArgs(
        'financial_scenario',
        { ...scenario, answerContract: contract, outputBindings: [{ ...bindings[0], injected: true }] },
        'initial',
        base,
      ),
    ).toThrow(z.ZodError);
    expect(() =>
      parseCompletionArgs(
        'financial_scenario',
        { ...scenario, calculations: [], answerContract: contract, outputBindings: [] },
        'initial',
        base,
      ),
    ).toThrow(z.ZodError);
  });
  it.each(['show_inspected_results', 'calculate_from_inspection'])(
    'requires bindings on followup %s and rejects contract replacement',
    (name) => {
      const args =
        name === 'show_inspected_results'
          ? {}
          : { assumptions: scenario.assumptions, calculations: scenario.calculations };
      expect(() => parseCompletionArgs(name, args, 'followup', base)).toThrow(z.ZodError);
      expect(() =>
        parseCompletionArgs(
          name,
          { ...args, answerContract: contract, outputBindings: [] },
          'followup',
          base,
        ),
      ).toThrow(z.ZodError);
      expect(
        stripCompletionArgs(
          parseCompletionArgs(name, { ...args, outputBindings: bindings }, 'followup', base),
        ),
      ).toEqual({ args, bindings });
    },
  );
  it.each(['inspect_financial_data', 'request_details'])(
    'rejects metadata on unwrapped followup %s',
    (name) => {
      const parse = vi.fn(() => ({}));
      for (const metadata of [{ answerContract: contract }, { outputBindings: [] }]) {
        expect(() => parseCompletionArgs(name, metadata, 'followup', parse)).toThrow(z.ZodError);
      }
      expect(parse).not.toHaveBeenCalled();
    },
  );
  it('allows clarification without a contract and preserves its original base validation', () => {
    const parser = vi.fn((_name: string, value: unknown) =>
      z.strictObject({ reason: z.literal('missing') }).parse(value),
    );
    for (const phase of ['initial', 'followup'] as const) {
      expect(parseCompletionArgs('request_details', { reason: 'missing' }, phase, parser)).toEqual({
        reason: 'missing',
      });
      expect(() =>
        parseCompletionArgs(
          'request_details',
          { reason: 'missing', answerContract: contract },
          phase,
          parser,
        ),
      ).toThrow(z.ZodError);
    }
  });
  it.each([null, [], 'not an object'])('rejects non-object envelope %j', (args) => {
    const parse = vi.fn(base);
    expect(() => parseCompletionArgs('financial_scenario', args, 'initial', parse)).toThrow(z.ZodError);
    expect(parse).not.toHaveBeenCalled();
  });
  it('blocks legacy and out-of-phase tool bypasses without invoking the base parser', () => {
    const parse = vi.fn(base);
    for (const [name, phase] of [
      ['cash_position', 'initial'],
      ['financial_analysis', 'followup'],
      ['show_inspected_results', 'initial'],
      ['__proto__', 'initial'],
    ] as const) {
      expect(() => parseCompletionArgs(name, {}, phase, parse)).toThrowError(
        expect.objectContaining({ code: 'UNSUPPORTED_TOOL' }),
      );
    }
    expect(parse).not.toHaveBeenCalled();
  });
  it('refuses ambiguous tool names, reserved base properties and base parser metadata injection', () => {
    expect(() => completionInitialTools([financialScenarioTool, financialScenarioTool])).toThrow('unique');
    const collision = structuredClone(financialScenarioTool);
    (collision.parameters.properties as Record<string, unknown>).answerContract = { type: 'string' };
    expect(() => completionInitialTools([collision])).toThrow('strict, unwrapped');
    expect(() =>
      parseCompletionArgs(
        'financial_scenario',
        { ...scenario, answerContract: contract, outputBindings: [] },
        'initial',
        () => ({ answerContract: {} }),
      ),
    ).toThrow('returned completion metadata');
  });
  it('leaves user-anchor meaning unfrozen and unverified for the caller to validate before a read', () => {
    const unverified = structuredClone(contract);
    unverified.outputs[0].sourceQuotes[0].quote = 'Not present in the original user message';
    const result = parseCompletionArgs(
      'financial_scenario',
      { ...scenario, answerContract: unverified, outputBindings: [] },
      'initial',
      base,
    );
    expect(result.answerContract).toEqual(unverified);
    expect(Object.isFrozen(result.answerContract)).toBe(false);
  });
  it('sends added literal unions through the same Gemini enum adapter without another provider path', () => {
    const tools = completionInitialTools([financialScenarioTool]);
    const wire = JSON.parse(JSON.stringify(buildGeminiFinancialRequest(tools, 'Test.', []).body));
    const params = wire.tools[0].functionDeclarations[0].parametersJsonSchema;
    expect(params.required).toEqual(expect.arrayContaining(['answerContract', 'outputBindings']));
    expect(
      params.properties.answerContract.properties.outputs.items.properties.requirement.anyOf.map(
        (branch: { properties: { kind: unknown } }) => branch.properties.kind,
      ),
    ).toEqual([
      { type: 'string', enum: ['value'] },
      { type: 'string', enum: ['table'] },
      { type: 'string', enum: ['selected_identity'] },
      { type: 'string', enum: ['arithmetic'] },
    ]);
    expect(wire.toolConfig.functionCallingConfig).toEqual({ mode: 'AUTO' });
    expect(wire.generationConfig.maxOutputTokens).toBe(4000);
  });
});
