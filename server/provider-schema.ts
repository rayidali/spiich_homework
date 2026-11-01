import { isDeepStrictEqual } from 'node:util';

const schemaMaps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const schemaLists = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems']);
const schemaChildren = new Set([
  'items',
  'additionalProperties',
  'additionalItems',
  'contains',
  'not',
  'if',
  'then',
  'else',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
]);

/** Completion declarations use a large nested grammar. AUTO permits generation
 * without the forced ANY decoder; the application still requires exactly one
 * known call and validates its original strict schema before financial reads.
 * Ordinary tools retain their existing forced-call behavior. */
export function geminiFunctionCallingConfig(tools: { name: string; parameters: Record<string, unknown> }[]) {
  const completionDeclaration = tools.some(({ parameters }) => {
    const properties = parameters.properties;
    return (
      properties &&
      typeof properties === 'object' &&
      Object.hasOwn(properties, 'answerContract') &&
      Object.hasOwn(properties, 'outputBindings')
    );
  });
  return completionDeclaration
    ? { mode: 'AUTO' as const }
    : { mode: 'ANY' as const, allowedFunctionNames: tools.map((tool) => tool.name) };
}

/** Gemini wire compatibility only; the original application schema remains authoritative. */
export function geminiProviderSchema(schema: Record<string, unknown>): Record<string, unknown> {
  // Clone JSON data first. In particular, enum/default/example objects are data,
  // not schemas: a property named "const" inside them must remain unchanged.
  const copy = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const current = node as Record<string, unknown>;
    if (Object.hasOwn(current, 'const')) {
      const literal = current.const;
      if (
        Object.hasOwn(current, 'enum') &&
        (!Array.isArray(current.enum) || !current.enum.some((value) => isDeepStrictEqual(value, literal)))
      ) {
        // Never broaden an impossible intersection into an allowed literal.
        throw new Error('Incompatible provider schema literal constraints.');
      }
      current.enum = [literal];
      delete current.const;
    }
    // Existing Gemini compatibility exception: large finite array grammars can
    // exceed decoding limits. Original Zod maxima still validate every response.
    if (typeof current.maxItems === 'number') delete current.maxItems;
    for (const [key, child] of Object.entries(current)) {
      if (schemaMaps.has(key) && child && typeof child === 'object' && !Array.isArray(child)) {
        for (const value of Object.values(child)) visit(value);
      } else if (schemaLists.has(key) && Array.isArray(child)) {
        child.forEach(visit);
      } else if (schemaChildren.has(key)) {
        if (key === 'items' && Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
    }
  };
  visit(copy);
  return copy;
}
