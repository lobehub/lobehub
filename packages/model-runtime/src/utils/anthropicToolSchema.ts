/* eslint-disable unicorn/no-thenable -- then is a JSON Schema keyword, not a promise method. */
const schemaMaps = new Set([
  '$defs',
  'definitions',
  'properties',
  'patternProperties',
  'dependentSchemas',
  'dependencies',
]);
const schemaChildren = new Set([
  'allOf',
  'anyOf',
  'oneOf',
  'prefixItems',
  'items',
  'additionalItems',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
]);

/**
 * Claude rejects root union/intersection keywords. An equivalent conditional
 * keeps their validation AND evaluated-property annotations (unlike double not),
 * without changing the arguments or hiding the root property declarations.
 */
export const normalizeAnthropicToolSchema = (
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!schema || !['oneOf', 'anyOf', 'allOf'].some((key) => key in schema)) return schema;

  const movedKeys = ['oneOf', 'anyOf', 'allOf', 'if', 'then', 'else'].filter(
    (key) => key in schema,
  );
  const constraints = Object.fromEntries(movedKeys.map((key) => [key, schema[key]]));
  const root = Object.fromEntries(
    Object.entries(schema).filter(([key]) => !movedKeys.includes(key)),
  );

  // Relocate local JSON-pointer references, visiting schema positions only:
  // values inside const/enum/default/examples are data, even if they contain $ref.
  const relocateReferences = (value: unknown, isRoot = false): unknown => {
    if (Array.isArray(value)) return value.map((item) => relocateReferences(item));
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (!isRoot && typeof record.$id === 'string') return value;
    return Object.fromEntries(
      Object.entries(record).map(([key, child]) => {
        if ((key === '$ref' || key === '$dynamicRef') && typeof child === 'string') {
          const target = movedKeys.find(
            (moved) => child === `#/${moved}` || child.startsWith(`#/${moved}/`),
          );
          if (target) return [key, child.replace('#/', '#/if/')];
        }
        if (schemaMaps.has(key) && child && typeof child === 'object' && !Array.isArray(child)) {
          return [
            key,
            Object.fromEntries(
              Object.entries(child).map(([name, nested]) => [name, relocateReferences(nested)]),
            ),
          ];
        }
        return [key, schemaChildren.has(key) ? relocateReferences(child) : child];
      }),
    );
  };

  return relocateReferences({ ...root, if: constraints, then: true, else: false }, true) as Record<
    string,
    unknown
  >;
};
