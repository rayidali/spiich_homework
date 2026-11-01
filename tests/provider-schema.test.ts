import { describe, expect, it } from 'vitest';
import { geminiProviderSchema } from '../server/provider-schema';
import { buildGeminiFinancialRequest } from '../server/ai-provider';
import { financialScenarioTool, financialScenarioSchema } from '../server/financial-calculation';

describe('Gemini schema compatibility, no provider calls', () => {
  it('keeps real scenario reference branches and sends singleton literal enums', () => {
    const original = structuredClone(financialScenarioTool.parameters);
    const body = JSON.parse(
      JSON.stringify(buildGeminiFinancialRequest([financialScenarioTool], 'Test.', []).body),
    );
    const wire = body.tools[0].functionDeclarations[0].parametersJsonSchema as {
      properties: {
        calculations: {
          minItems: number;
          maxItems?: number;
          items: {
            properties: {
              operands: {
                minItems: number;
                maxItems?: number;
                items: {
                  anyOf: {
                    properties: Record<string, unknown>;
                    required: string[];
                    additionalProperties: boolean;
                  }[];
                };
              };
            };
          };
        };
      };
    };
    const calculations = wire.properties.calculations;
    const operands = calculations.items.properties.operands;
    const branches = operands.items.anyOf;
    expect(branches).toHaveLength(4);
    expect(branches.map((b) => b.properties.source)).toEqual([
      { type: 'string', enum: ['query'] },
      { type: 'string', enum: ['query'] },
      { type: 'string', enum: ['assumption'] },
      { type: 'string', enum: ['calculation'] },
    ]);
    expect(branches.map((b) => b.properties.field)).toEqual([
      { type: 'string', enum: ['value'] },
      { type: 'string', enum: ['month_count'] },
      { type: 'string', enum: ['value'] },
      { type: 'string', enum: ['value'] },
    ]);
    expect(branches[0].properties.rowId).toEqual({ type: 'string', minLength: 1, maxLength: 1024 });
    expect(branches.slice(1).every((b) => JSON.stringify(b.properties.rowId) === '{"type":"null"}')).toBe(
      true,
    );
    expect(
      branches.every(
        (b) =>
          b.additionalProperties === false &&
          JSON.stringify(b.required) === '["source","id","rowId","field"]',
      ),
    ).toBe(true);
    expect(operands.minItems).toBe(2);
    expect(operands.maxItems).toBeUndefined();
    expect(calculations.minItems).toBe(1);
    expect(calculations.maxItems).toBeUndefined();
    expect(body.toolConfig.functionCallingConfig.mode).toBe('ANY');
    expect(body.generationConfig.maxOutputTokens).toBe(4000);
    expect(financialScenarioTool.parameters).toEqual(original);
  });

  it.each(['cash_balance', 'sum'])('still rejects the observed invalid operand field %s locally', (field) => {
    const input = {
      queries: [],
      assumptions: [],
      calculations: [
        {
          id: 'delta',
          operation: 'subtract',
          operands: [
            { source: 'query', id: 'june', rowId: 'total:total', field },
            { source: 'query', id: 'may', rowId: 'total:total', field: 'value' },
          ],
        },
      ],
    };
    expect(financialScenarioSchema.safeParse(input).success).toBe(false);
    input.calculations[0].operands[0].field = 'value';
    expect(financialScenarioSchema.safeParse(input).success).toBe(true);
  });

  it('intersects an existing enum instead of broadening it and compares JSON object values structurally', () => {
    expect(
      geminiProviderSchema({ type: 'string', const: 'a', enum: ['a', 'b'], description: 'Fixed.' }),
    ).toEqual({ type: 'string', enum: ['a'], description: 'Fixed.' });
    expect(geminiProviderSchema({ const: { a: 1, b: 2 }, enum: [{ b: 2, a: 1 }] })).toEqual({
      enum: [{ a: 1, b: 2 }],
    });
  });
  it.each([[], ['different'], null, 'value'])(
    'refuses contradictory or invalid existing enum %j',
    (enumeration) => {
      expect(() => geminiProviderSchema({ const: 'value', enum: enumeration })).toThrow(
        'Incompatible provider schema literal constraints.',
      );
    },
  );
  it('supports null, numeric and boolean literals without converting their types', () => {
    expect(geminiProviderSchema({ anyOf: [{ const: null }, { const: false }, { const: 0 }] })).toEqual({
      anyOf: [{ enum: [null] }, { enum: [false] }, { enum: [0] }],
    });
  });
  it('walks schema positions, preserving same-named user properties and annotation data', () => {
    const data = { const: 'literal data', maxItems: 99, anyOf: [{ const: 'data' }] };
    const input = {
      type: 'object',
      properties: {
        const: { type: 'string', const: 'value' },
        maxItems: { type: 'integer', const: 2 },
        list: { type: 'array', maxItems: 4, minItems: 2, items: { const: 'item' } },
      },
      default: data,
      examples: [data],
      enum: [data],
      required: ['const', 'maxItems'],
      additionalProperties: false,
    };
    const before = structuredClone(input);
    const output = geminiProviderSchema(input);
    expect(output).toEqual({
      ...before,
      properties: {
        const: { type: 'string', enum: ['value'] },
        maxItems: { type: 'integer', enum: [2] },
        list: { type: 'array', minItems: 2, items: { enum: ['item'] } },
      },
    });
    expect(input).toEqual(before);
    expect(output.default).not.toBe(input.default);
  });
  it('retains refs and other constraints while visiting definitions and applicators', () => {
    expect(
      geminiProviderSchema({
        $defs: { x: { const: 'x' } },
        allOf: [{ $ref: '#/$defs/x' }],
        not: { const: 'y' },
        additionalProperties: { const: true },
        prefixItems: [{ const: 1 }],
        pattern: '^x$',
        minimum: 0,
        maximum: 5,
      }),
    ).toEqual({
      $defs: { x: { enum: ['x'] } },
      allOf: [{ $ref: '#/$defs/x' }],
      not: { enum: ['y'] },
      additionalProperties: { enum: [true] },
      prefixItems: [{ enum: [1] }],
      pattern: '^x$',
      minimum: 0,
      maximum: 5,
    });
  });
});
