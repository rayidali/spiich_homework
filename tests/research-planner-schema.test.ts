import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { plannerSchemaFor, wrenPlannerColumns } from '../research/routes';

const common = { intent: 'ANSWER', retrievalQuery: '', clarification: '' };
describe('backend-specific planner grammar', () => {
  it('supplies the actual semantic column types instead of an untyped SQL column list', () => {
    expect(wrenPlannerColumns).toContainEqual({ name: 'is_cash', type: 'boolean' });
    expect(wrenPlannerColumns).toContainEqual({ name: 'account_code', type: 'varchar' });
    expect(wrenPlannerColumns).toContainEqual({ name: 'base_debit', type: 'decimal' });
    expect(wrenPlannerColumns).toContainEqual({ name: 'date', type: 'date' });
    expect(wrenPlannerColumns.every((column) => Object.keys(column).sort().join(',') === 'name,type')).toBe(
      true,
    );
  });
  it('offers only SQL operations to Wren and rejects a custom-query field', () => {
    const schema = plannerSchemaFor('wren');
    const sql = { id: 'cash', sql: 'SELECT SUM(net_debit) AS value FROM ledger WHERE is_cash' };
    expect(schema.parse({ ...common, sqlQueries: [sql] })).toEqual({ ...common, sqlQueries: [sql] });
    expect(schema.safeParse({ ...common, sqlQueries: [], queries: [] }).success).toBe(false);
    const json = z.toJSONSchema(schema) as { properties: Record<string, unknown> };
    expect(Object.keys(json.properties)).toContain('sqlQueries');
    expect(Object.keys(json.properties)).not.toContain('queries');
  });
  it('offers only reviewed analytical plans to the custom backend and rejects SQL', () => {
    const schema = plannerSchemaFor('custom');
    expect(schema.parse({ ...common, queries: [] })).toEqual({ ...common, queries: [] });
    expect(
      schema.safeParse({ ...common, queries: [], sqlQueries: [{ id: 'x', sql: 'SELECT 1' }] }).success,
    ).toBe(false);
    const json = z.toJSONSchema(schema) as { properties: Record<string, unknown> };
    expect(Object.keys(json.properties)).toContain('queries');
    expect(Object.keys(json.properties)).not.toContain('sqlQueries');
  });
});
