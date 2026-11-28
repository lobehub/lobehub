import type OpenAI from 'openai';

import type { ChatCompletionTool, ChatStreamPayload } from '../../../types';

/**
 * JSON Schema keywords outside the subset OpenAI's strict function-calling mode supports.
 * Strict mode cannot enforce a schema that uses one, so such a tool only ever runs
 * non-strict.
 */
const STRICT_UNSUPPORTED_KEYWORDS = [
  'oneOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'dependentRequired',
  'dependentSchemas',
] as const;

/** Keywords whose value is a map from names to subschemas. */
const SUBSCHEMA_MAP_KEYWORDS = [
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
] as const;

/** Keywords whose value is a subschema or a list of subschemas. */
const SUBSCHEMA_KEYWORDS = [
  'additionalItems',
  'additionalProperties',
  'allOf',
  'anyOf',
  'contains',
  'else',
  'if',
  'items',
  'not',
  'oneOf',
  'prefixItems',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
] as const;

/**
 * Whether a schema uses a keyword strict mode does not support, anywhere a subschema can
 * sit. Only schema positions are visited: a property that happens to be named `not`, or an
 * `enum` / `const` / `default` value shaped like a schema, is data.
 */
const usesStrictUnsupportedKeyword = (schema: unknown): boolean => {
  if (Array.isArray(schema)) return schema.some(usesStrictUnsupportedKeyword);
  if (!schema || typeof schema !== 'object') return false;

  const node = schema as Record<string, unknown>;
  if (STRICT_UNSUPPORTED_KEYWORDS.some((keyword) => keyword in node)) return true;

  for (const keyword of SUBSCHEMA_MAP_KEYWORDS) {
    const map = node[keyword];
    if (
      map &&
      typeof map === 'object' &&
      !Array.isArray(map) &&
      Object.values(map).some(usesStrictUnsupportedKeyword)
    )
      return true;
  }

  return SUBSCHEMA_KEYWORDS.some((keyword) => usesStrictUnsupportedKeyword(node[keyword]));
};

/**
 * Convert a Chat Completions function tool into a Responses function tool.
 *
 * Every place a Responses request declares a function tool goes through here: the
 * top-level `tools` list, a historical `additional_tools` / `tool_search_output` item
 * (`buildAnchoredToolItems`), and the ChatGPT Responses Lite leading item. A tool is
 * therefore serialized identically wherever it is declared, and moving between the
 * top-level list and an anchor never changes its definition.
 *
 * Responses function tools are strict unless `strict` says otherwise. When `strict` is
 * omitted, the top-level list quietly falls back to non-strict for a schema strict mode
 * cannot express, but an `additional_tools` item rejects the whole request instead
 * (`400 invalid_json_schema: oneOf constraints are not supported`) — and since the item is
 * replayed with the history, every later turn of the conversation fails. Such a tool is
 * declared `strict: false` explicitly, the way Codex declares all of its tools: it was
 * already running non-strict at the top level, so only the item's validation changes.
 * Schemas strict mode can express keep their exact previous serialization, and a
 * `strict` the caller set is kept as is.
 */
export const convertChatCompletionToolToResponseTool = (
  tool: ChatCompletionTool,
): OpenAI.Responses.Tool => {
  // Native tools such as `{ type: 'web_search' }` come through here too, without `function`.
  const fn = tool.function as
    (ChatCompletionTool['function'] & { strict?: boolean | null }) | undefined;
  const declareNonStrict =
    (fn?.strict === undefined || fn.strict === null) &&
    usesStrictUnsupportedKeyword(fn?.parameters);

  return {
    type: tool.type,
    ...tool.function,
    ...(declareNonStrict && { strict: false }),
  } as OpenAI.Responses.Tool;
};

/** Remove Chat Completions-only fields before sending a Responses request. */
export const stripChatCompletionParameters = (payload: Partial<ChatStreamPayload>) => {
  const {
    apiMode: _apiMode,
    frequency_penalty: _frequency,
    presence_penalty: _presence,
    preserveThinking: _thinking,
    ...rest
  } = payload;
  return rest;
};
