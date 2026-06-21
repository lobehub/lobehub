import type OpenAI from 'openai';

/**
 * Normalize a JSON Schema fragment into a shape that strict provider
 * function-schema validators (OpenAI / DeepSeek, Gemini, ...) accept.
 *
 * User-supplied MCP tool schemas sometimes carry non-trivial JSON Schema
 * constructs that are individually valid but rejected by upstream validators:
 *
 *  - **Boolean sub-schema** (`items: true`, meaning "any element"). Valid JSON
 *    Schema, but OpenAI / DeepSeek reject it with
 *    `Invalid schema for function '...': true is not of type "array"`.
 *    → rewrite the boolean schema to an empty object schema `{}`.
 *  - **Array property missing `type`** — a node carries `items` but omits
 *    `type: 'array'`. Gemini rejects it with
 *    `field predicate failed: $type == Type.ARRAY`.
 *    → backfill `type: 'array'`.
 *
 * Normalization is the harness's responsibility (the same family as the Gemini
 * enum / required sanitizers), so we clean the schema before it reaches any
 * provider rather than letting the request fail anonymously upstream.
 *
 * @see https://linear.app/lobehub/issue/LOBE-10066
 */
export const normalizeToolJsonSchema = (schema: any): any => {
  // A boolean schema (`true` = accept anything, `false` = accept nothing) is
  // valid JSON Schema but rejected by function-schema validators that expect an
  // object. Collapse it to the permissive empty object schema.
  if (typeof schema === 'boolean') return {};
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map((item) => normalizeToolJsonSchema(item));

  const normalized: Record<string, any> = { ...schema };

  // Recurse object property schemas
  if (normalized.properties && typeof normalized.properties === 'object') {
    const props: Record<string, any> = {};
    for (const key of Object.keys(normalized.properties)) {
      props[key] = normalizeToolJsonSchema(normalized.properties[key]);
    }
    normalized.properties = props;
  }

  // A node carrying `items` is an array node. Normalize the `items` sub-schema
  // (collapsing a boolean such as `items: true`) and backfill a missing `type`
  // so predicate-checking validators (Gemini) accept it.
  if ('items' in normalized) {
    normalized.items = normalizeToolJsonSchema(normalized.items);
    if (normalized.type === undefined) normalized.type = 'array';
  }

  // Tuple-style validation (`prefixItems`) — same boolean-collapse treatment.
  if (Array.isArray(normalized.prefixItems)) {
    normalized.prefixItems = normalized.prefixItems.map(normalizeToolJsonSchema);
  }

  // `additionalProperties` may be a nested schema. Leave the boolean form alone
  // (a boolean is meaningful and accepted here); only recurse the object form.
  if (normalized.additionalProperties && typeof normalized.additionalProperties === 'object') {
    normalized.additionalProperties = normalizeToolJsonSchema(normalized.additionalProperties);
  }

  // Combinators
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(normalized[key])) {
      normalized[key] = normalized[key].map(normalizeToolJsonSchema);
    }
  }

  // Definition maps
  for (const key of ['definitions', '$defs']) {
    if (normalized[key] && typeof normalized[key] === 'object') {
      const defs: Record<string, any> = {};
      for (const defKey of Object.keys(normalized[key])) {
        defs[defKey] = normalizeToolJsonSchema(normalized[key][defKey]);
      }
      normalized[key] = defs;
    }
  }

  return normalized;
};

/**
 * Normalize the parameter JSON Schema of every function tool in a tool list.
 * Non-function tools and tools without parameters are returned untouched.
 *
 * @see {@link normalizeToolJsonSchema}
 */
export const normalizeToolsParameters = <T extends OpenAI.ChatCompletionTool[] | undefined>(
  tools: T,
): T => {
  if (!tools) return tools;

  return tools.map((tool) => {
    if (tool.type !== 'function' || !tool.function?.parameters) return tool;

    return {
      ...tool,
      function: {
        ...tool.function,
        parameters: normalizeToolJsonSchema(tool.function.parameters),
      },
    };
  }) as T;
};
