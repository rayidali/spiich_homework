import { isDeepStrictEqual } from 'node:util';
import type { FinancialTool } from './ai-provider';

type Scalar = string | number | boolean | null;
type Path = (string | number)[];
export type SchemaRepairHint =
  | { code: 'allowed_values'; path: Path; allowedValues: Scalar[] }
  | { code: 'type'; path: Path; expectedTypes: string[] }
  | { code: 'required' | 'unexpected_properties'; path: Path }
  | { code: 'array_size'; path: Path; minItems?: number; maxItems?: number };
const safeName = (name: string) =>
  /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) && !['constructor', 'prototype'].includes(name);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const safeScalar = (value: unknown): value is Scalar =>
  value === null ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,64}$/.test(value));
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const matchesType = (type: string, value: unknown) =>
  type === 'null'
    ? value === null
    : type === 'array'
      ? Array.isArray(value)
      : type === 'object'
        ? record(value)
        : type === 'integer'
          ? Number.isInteger(value)
          : type === 'number'
            ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === type;

/**
 * Advisory repair data from trusted tool schemas, never a substitute validator.
 * Does not echo candidate values/unknown keys, schema descriptions or Zod messages.
 * Unsupported constraints and ambiguous union leaves deliberately produce no hint.
 */
export function schemaRepairHints(
  tools: readonly Pick<FinancialTool, 'name' | 'parameters'>[],
  name: string,
  candidate: unknown,
): SchemaRepairHint[] {
  if (!safeName(name)) return [];
  const matches = tools.filter((tool) => tool.name === name);
  if (matches.length !== 1) return [];
  let visited = 0;
  let exhausted = false;
  const walk = (schema: unknown, value: unknown, path: Path, depth: number): SchemaRepairHint[] => {
    if (++visited > 4000 || depth > 32 || path.length > 12) {
      exhausted = true;
      return [];
    }
    if (!record(schema) || Object.hasOwn(schema, '$ref')) return [];
    const hints: SchemaRepairHint[] = [];
    const alternatives = schema.anyOf ?? schema.oneOf;
    if (Array.isArray(alternatives)) {
      if (!alternatives.length || alternatives.length > 32) return [];
      const choices = alternatives.map((branch) => walk(branch, value, path, depth + 1));
      const minimum = Math.min(...choices.map((choice) => choice.length));
      const closest = choices.filter((choice) => choice.length === minimum);
      // Closest branches provide suggestions only. For a tie, emit only shared
      // leaf paths/codes, combining their trusted enum/type alternatives.
      for (const first of closest[0]) {
        const same = closest.map((choice) =>
          choice.find((hint) => hint.code === first.code && isDeepStrictEqual(hint.path, first.path)),
        );
        if (same.some((hint) => !hint)) continue;
        if (first.code === 'allowed_values') {
          const values = same.flatMap((hint) => (hint?.code === 'allowed_values' ? hint.allowedValues : []));
          hints.push({ ...first, allowedValues: [...new Set(values)] });
        } else if (first.code === 'type') {
          hints.push({
            ...first,
            expectedTypes: [
              ...new Set(same.flatMap((hint) => (hint?.code === 'type' ? hint.expectedTypes : []))),
            ],
          });
        } else if (same.every((hint) => isDeepStrictEqual(hint, first))) hints.push(first);
      }
    }
    if (Array.isArray(schema.allOf) && schema.allOf.length <= 32) {
      for (const branch of schema.allOf) hints.push(...walk(branch, value, path, depth + 1));
    }
    const expectedTypes = (Array.isArray(schema.type) ? schema.type : [schema.type]).filter(
      (type): type is string => typeof type === 'string' && types.has(type),
    );
    if (expectedTypes.length && !expectedTypes.some((type) => matchesType(type, value))) {
      return [...hints, { code: 'type', path, expectedTypes }];
    }
    const allowed = Object.hasOwn(schema, 'const') ? [schema.const] : schema.enum;
    if (
      Array.isArray(allowed) &&
      allowed.length > 0 &&
      allowed.length <= 16 &&
      allowed.every(safeScalar) &&
      !allowed.some((item) => isDeepStrictEqual(item, value))
    ) {
      hints.push({ code: 'allowed_values', path, allowedValues: allowed });
    }
    if (record(value) && record(schema.properties)) {
      const properties = schema.properties;
      const required = Array.isArray(schema.required) ? schema.required : [];
      if (
        schema.additionalProperties === false &&
        Object.keys(value).some((key) => !Object.hasOwn(properties, key))
      ) {
        hints.push({ code: 'unexpected_properties', path });
      }
      for (const [key, child] of Object.entries(properties)) {
        if (!safeName(key)) continue;
        if (!Object.hasOwn(value, key)) {
          if (required.includes(key)) hints.push({ code: 'required', path: [...path, key] });
        } else hints.push(...walk(child, value[key], [...path, key], depth + 1));
      }
    }
    if (Array.isArray(value)) {
      const bound = (input: unknown): input is number =>
        typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 && input <= 1000;
      if (
        (bound(schema.minItems) && value.length < schema.minItems) ||
        (bound(schema.maxItems) && value.length > schema.maxItems)
      ) {
        hints.push({
          code: 'array_size',
          path,
          ...(bound(schema.minItems) ? { minItems: schema.minItems } : {}),
          ...(bound(schema.maxItems) ? { maxItems: schema.maxItems } : {}),
        });
      }
      if (value.length > 1000) {
        exhausted = true;
        return [];
      }
      for (let index = 0; index < value.length; index++) {
        const child =
          Array.isArray(schema.prefixItems) && index < schema.prefixItems.length
            ? schema.prefixItems[index]
            : schema.items;
        if (child) hints.push(...walk(child, value[index], [...path, index], depth + 1));
      }
    }
    return hints;
  };
  const found = walk(matches[0].parameters, candidate, [], 0);
  if (exhausted) return [];
  const result: SchemaRepairHint[] = [];
  for (const hint of found) {
    if (hint.path.length > 12) continue;
    if (hint.code === 'allowed_values' && hint.allowedValues.length > 16) continue;
    if (result.some((other) => isDeepStrictEqual(other, hint))) continue;
    if (result.length === 12 || Buffer.byteLength(JSON.stringify([...result, hint]), 'utf8') > 4096) break;
    result.push(hint);
  }
  return result;
}
