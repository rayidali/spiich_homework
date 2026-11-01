import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FinancialTool } from '../server/ai-provider';
import {
  decodeFinancialExplanation,
  financialExplanationInstructions,
  withFinancialExplanations,
} from '../server/financial-explanation';

const tool = (name = 'income_summary'): FinancialTool => ({
  type: 'function',
  name,
  description: 'Read an exact recorded result.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      metric: { type: 'string', enum: ['profit', 'revenue', 'expenses'] },
      from: { type: 'string' },
      to: { type: 'string' },
    },
    required: ['metric', 'from', 'to'],
  },
});
const args = { metric: 'profit', from: '2026-10-01', to: '2026-10-31' };
const offered = () => withFinancialExplanations([tool()]);
const call = (change: Record<string, unknown> = {}): { name: string; args: Record<string, unknown> } => ({
  name: 'income_summary',
  args: { ...args, ...change },
});

describe('Optional general explanations on existing financial tools', () => {
  it('clones eligible declarations without mutating or duplicating the financial grammar', () => {
    const original = tool();
    const before = structuredClone(original);
    const [wrapped] = withFinancialExplanations([original]);
    expect(original).toEqual(before);
    expect(wrapped).not.toBe(original);
    expect(wrapped.parameters.properties).not.toBe(original.parameters.properties);
    expect(wrapped.parameters).toMatchObject({
      additionalProperties: false,
      required: ['metric', 'from', 'to', 'generalExplanation'],
      properties: original.parameters.properties,
    });
    const properties = wrapped.parameters.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(['metric', 'from', 'to', 'generalExplanation']);
    expect(withFinancialExplanations([wrapped])).toEqual([wrapped]);
    properties.metric = { type: 'boolean' };
    expect(original).toEqual(before);
  });

  it.each([
    'discuss_business',
    'request_details',
    'ask_clarification',
    'inspect_financial_data',
    'unknown_tool',
  ])('does not annotate %s', (name) => {
    const original = tool(name);
    const [wrapped] = withFinancialExplanations([original]);
    expect(wrapped).toBe(original);
    expect(wrapped.parameters.properties).not.toHaveProperty('generalExplanation');
  });

  it.each([
    'financial_analysis',
    'financial_scenario',
    'show_inspected_results',
    'calculate_from_inspection',
  ])('supports the final financial tool %s', (name) => {
    const [wrapped] = withFinancialExplanations([tool(name)]);
    expect(wrapped.parameters.properties).toHaveProperty('generalExplanation');
  });

  it.each([{}, { generalExplanation: null }])('keeps legacy missing/null explanations absent', (change) => {
    const input = call(change);
    const before = structuredClone(input);
    expect(decodeFinancialExplanation(offered(), input)).toEqual({ call: { name: input.name, args } });
    expect(input).toEqual(before);
  });

  it('separates general text from unchanged financial arguments and assigns provenance itself', () => {
    const input = call({ generalExplanation: '  Profit is revenue minus expenses.  ' });
    const before = structuredClone(input);
    expect(decodeFinancialExplanation(offered(), input)).toEqual({
      call: { name: 'income_summary', args },
      generalExplanation: {
        text: 'Profit is revenue minus expenses.',
        grounding: 'general_knowledge',
        verifiedFinancialData: false,
      },
    });
    expect(input).toEqual(before);
  });

  it('does not repair, erase or normalize financial fields or other unexpected fields', () => {
    const nested = { operator: 'invented', amount: '001.000', reference: '$not-a-reference' };
    const input = call({
      from: 'wrong-date',
      metric: 'unsupported',
      nested,
      evidence: [{ value: '$99999' }],
      generalExplanation: 'General accounting explanation.',
    });
    const decoded = decodeFinancialExplanation(offered(), input);
    const { generalExplanation: _text, ...unchanged } = input.args;
    expect(decoded.call.args).toEqual(unchanged);
    expect(decoded.call.args).toHaveProperty('nested', nested);
    // The existing strict financial parser, not this metadata decoder, must
    // reject the invalid financial fields and forged evidence that remain.
    const base = z.strictObject({
      metric: z.enum(['profit', 'revenue', 'expenses']),
      from: z.iso.date(),
      to: z.iso.date(),
    });
    expect(() => base.parse(decoded.call.args)).toThrow(z.ZodError);
  });

  it.each([undefined, null, [], 'not an object', 7])(
    'rejects a malformed root for annotated calls %#',
    (value) => {
      expect(() => decodeFinancialExplanation(offered(), { name: 'income_summary', args: value })).toThrow(
        z.ZodError,
      );
    },
  );

  it.each([
    '',
    '   ',
    'x'.repeat(1601),
    12,
    true,
    [],
    { text: 'Profit explanation', verifiedFinancialData: true },
    { text: 'Profit explanation', sources: ['https://invented.invalid'] },
  ])('rejects invalid explanation values within the existing schema-repair boundary %#', (value) => {
    try {
      decodeFinancialExplanation(offered(), call({ generalExplanation: value }));
      throw new Error('Expected invalid explanation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(z.ZodError);
      expect((error as z.ZodError).issues.some((issue) => issue.path[0] === 'generalExplanation')).toBe(true);
    }
  });

  it('accepts the length boundary and rejects an oversized raw value even if whitespace trims away', () => {
    const accepted = decodeFinancialExplanation(offered(), call({ generalExplanation: 'x'.repeat(1600) }));
    expect(accepted.generalExplanation?.text).toHaveLength(1600);
    expect(() =>
      decodeFinancialExplanation(offered(), call({ generalExplanation: ` ${'x'.repeat(1600)}` })),
    ).toThrow(z.ZodError);
  });

  it('leaves unknown, unannotated, excluded or ambiguously offered calls unchanged', () => {
    const input = call({ generalExplanation: { invalid: true } });
    const cases = [
      { tools: [], input },
      { tools: [tool()], input },
      { tools: offered(), input: { ...input, name: 'unknown_tool' } },
      {
        tools: withFinancialExplanations([tool('discuss_business')]),
        input: { ...input, name: 'discuss_business' },
      },
      { tools: [...offered(), ...offered()], input },
    ];
    for (const entry of cases)
      expect(decodeFinancialExplanation(entry.tools, entry.input)).toEqual({ call: entry.input });
  });

  it('does not treat a different same-name property as our annotation', () => {
    const original = tool();
    (original.parameters.properties as Record<string, unknown>).generalExplanation = { type: 'number' };
    const input = call({ generalExplanation: 9 });
    expect(decodeFinancialExplanation([original], input)).toEqual({ call: input });
    expect(() => withFinancialExplanations([original])).toThrow('unchanged strict object');
  });

  it.each([
    { type: 'array' },
    { type: 'object', properties: {}, additionalProperties: true },
    { type: 'object', properties: {}, additionalProperties: false, required: [5] },
  ])('refuses incompatible financial declarations without mutation %#', (parameters) => {
    const original = { ...tool(), parameters };
    const before = structuredClone(original);
    expect(() => withFinancialExplanations([original])).toThrow('unchanged strict object');
    expect(original).toEqual(before);
  });

  it('adds a bounded shallow schema for the nine direct financial tools', () => {
    const names = [
      'expense_summary',
      'expense_by_account',
      'revenue_comparison',
      'income_summary',
      'period_comparison',
      'find_transactions',
      'cash_position',
      'financial_analysis',
      'financial_scenario',
    ];
    const originals = names.map((name) => tool(name));
    const wrapped = withFinancialExplanations(originals);
    const added = Buffer.byteLength(JSON.stringify(wrapped)) - Buffer.byteLength(JSON.stringify(originals));
    // Linear metadata overhead; no duplicated query/assumption grammar. This
    // assertion measures bytes only, not provider latency or accuracy.
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThan(3000);
    expect(wrapped).toHaveLength(originals.length);
  });

  it('does not claim prose truth or make explanation instructions a financial validator', () => {
    const text = 'Your business is thriving and payroll is $999999.';
    const value = decodeFinancialExplanation(offered(), call({ generalExplanation: text }));
    expect(value.generalExplanation).toEqual({
      text,
      grounding: 'general_knowledge',
      verifiedFinancialData: false,
    });
    expect(value.call.args).toEqual(args);
    expect(financialExplanationInstructions).toContain('Do not choose discuss_business alone');
    expect(financialExplanationInstructions).toContain('not evidence');
    // Deliberately records the semantic limitation: valid shape is not proof
    // that the model obeyed the no-company-facts instruction.
  });
});
