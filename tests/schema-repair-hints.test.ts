import { describe, expect, it } from 'vitest';
import { schemaRepairHints } from '../server/schema-repair-hints';
import { financialScenarioTool, financialScenarioSchema } from '../server/financial-calculation';

const base = (field: string, rowId: string | null = 'total:total', source = 'query') => ({
  queries: [],
  assumptions: [],
  calculations: [
    {
      id: 'delta',
      operation: 'subtract',
      operands: [
        { source, id: 'june', rowId, field },
        { source: 'query', id: 'may', rowId: 'total:total', field: 'value' },
      ],
    },
  ],
});
const get = (value: unknown) => schemaRepairHints([financialScenarioTool], 'financial_scenario', value);
const fieldPath = ['calculations', 0, 'operands', 0, 'field'];

describe('Bounded schema-derived repair hints', () => {
  it('enforces byte and path limits even for long trusted enums and missing deep properties', () => {
    const properties = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [
        `field${i}`,
        { enum: Array.from({ length: 16 }, (_, j) => `${j}${'a'.repeat(62)}`) },
      ]),
    );
    const candidate = Object.fromEntries(Object.keys(properties).map((key) => [key, 'bad']));
    const hints = schemaRepairHints(
      [{ name: 'read', parameters: { type: 'object', properties } }],
      'read',
      candidate,
    );
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.length).toBeLessThan(12);
    expect(Buffer.byteLength(JSON.stringify(hints))).toBeLessThanOrEqual(4096);
    let schema: Record<string, unknown> = {
      type: 'object',
      properties: { missing: { type: 'string' } },
      required: ['missing'],
    };
    let value: unknown = {};
    for (let i = 0; i < 12; i++) {
      schema = { type: 'object', properties: { next: schema } };
      value = { next: value };
    }
    expect(schemaRepairHints([{ name: 'read', parameters: schema }], 'read', value)).toEqual([]);
  });
  it.each(['cash_balance', 'sum'])(
    'identifies the exact failing field for recorded %s-shaped failures',
    (field) => {
      const candidate = base(field);
      const before = structuredClone(candidate);
      expect(financialScenarioSchema.safeParse(candidate).success).toBe(false);
      expect(get(candidate)).toEqual([{ code: 'allowed_values', path: fieldPath, allowedValues: ['value'] }]);
      expect(candidate).toEqual(before);
    },
  );
  it('uses null rowId to suggest month_count rather than changing the request to a value reference', () => {
    expect(get(base('sum', null))).toEqual([
      { code: 'allowed_values', path: fieldPath, allowedValues: ['month_count'] },
    ]);
  });
  it.each(['assumption', 'calculation'])('keeps %s references on the value branch', (source) => {
    expect(get(base('sum', null, source))).toEqual([
      { code: 'allowed_values', path: fieldPath, allowedValues: ['value'] },
    ]);
  });
  it('returns no hints for a structurally valid scenario', () => {
    expect(get(base('value'))).toEqual([]);
    expect(get(base('month_count', null))).toEqual([]);
  });
  it('combines equally plausible enum alternatives instead of claiming one branch is mandatory', () => {
    const tool = {
      name: 'choice',
      parameters: {
        anyOf: [
          { type: 'object', properties: { field: { const: 'value' } } },
          { type: 'object', properties: { field: { const: 'month_count' } } },
        ],
      },
    };
    expect(schemaRepairHints([tool], 'choice', { field: 'PRIVATE_BAD_VALUE' })).toEqual([
      { code: 'allowed_values', path: ['field'], allowedValues: ['value', 'month_count'] },
    ]);
    tool.parameters.anyOf[1].properties = { other: { const: 'other' } } as never;
    expect(schemaRepairHints([tool], 'choice', { field: 'PRIVATE_BAD_VALUE', other: 'bad' })).toEqual([]);
  });
  it('diagnoses trusted required/type/array/extra-key constraints without echoing input', () => {
    const tool = {
      name: 'read',
      parameters: {
        type: 'object',
        properties: {
          rows: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
          status: { type: 'string' },
        },
        required: ['rows', 'status'],
        additionalProperties: false,
      },
    };
    const hints = schemaRepairHints([tool], 'read', {
      rows: ['SECRET_VALUE'],
      'SECRET_KEY: instructions': true,
    });
    expect(hints).toEqual([
      { code: 'unexpected_properties', path: [] },
      { code: 'array_size', path: ['rows'], minItems: 2, maxItems: 2 },
      { code: 'type', path: ['rows', 0], expectedTypes: ['number'] },
      { code: 'required', path: ['status'] },
    ]);
    expect(JSON.stringify(hints)).not.toContain('SECRET');
  });
  it('rejects unknown or ambiguous tool names and never follows inherited candidate properties', () => {
    expect(schemaRepairHints([financialScenarioTool], 'unknown', base('sum'))).toEqual([]);
    expect(
      schemaRepairHints([financialScenarioTool, financialScenarioTool], 'financial_scenario', base('sum')),
    ).toEqual([]);
    const tool = {
      name: 'read',
      parameters: { type: 'object', properties: { status: { const: 'ok' } }, required: ['status'] },
    };
    expect(schemaRepairHints([tool], 'read', Object.create({ status: 'secret' }))).toEqual([
      { code: 'required', path: ['status'] },
    ]);
  });
  it('omits descriptions, arbitrary regex messages, object literals and unsafe schema property names', () => {
    const tool = {
      name: 'read',
      parameters: {
        type: 'object',
        properties: {
          'unsafe-key SECRET': { const: 'ok' },
          text: { type: 'string', description: 'SECRET', pattern: 'SECRET' },
          object: { const: { private: 'SECRET' } },
        },
      },
    };
    expect(
      schemaRepairHints([tool], 'read', { 'unsafe-key SECRET': 'bad', text: 'different', object: {} }),
    ).toEqual([]);
  });
  it('bounds output to twelve small hints and refuses excessive traversal', () => {
    const tool = {
      name: 'read',
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`field${i}`, { const: 'ok' }])),
      },
    };
    const hints = schemaRepairHints(
      [tool],
      'read',
      Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`field${i}`, 'bad'])),
    );
    expect(hints).toHaveLength(12);
    expect(Buffer.byteLength(JSON.stringify(hints))).toBeLessThanOrEqual(4096);
    const arrayTool = { name: 'read', parameters: { type: 'array', items: { const: 'ok' } } };
    expect(schemaRepairHints([arrayTool], 'read', Array(1001).fill('bad'))).toEqual([]);
    let deep: Record<string, unknown> = { const: 'ok' };
    let input: unknown = 'bad';
    for (let i = 0; i < 40; i++) {
      deep = { type: 'object', properties: { next: deep } };
      input = { next: input };
    }
    expect(schemaRepairHints([{ name: 'read', parameters: deep }], 'read', input)).toEqual([]);
  });
});
