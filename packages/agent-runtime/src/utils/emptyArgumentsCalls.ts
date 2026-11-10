import type { ChatToolPayload } from '@lobechat/types';

import type { AgentState } from '../types';
import { selectEffectiveToolManifestMap } from './operationToolSet';

/**
 * What the model reads back when a call arrives with an empty `arguments`
 * string and its tool cannot legally be called without arguments. Parallel
 * tool-call batches from some model/gateway pairs lose the per-call arguments
 * during streaming serialization: the batch reaches the platform as
 * fully-formed calls whose `arguments` is `''` (vent T-673 — 5/7/12 identical
 * retries because the executor only answers with per-call schema errors).
 * Executing them just burns one validation error per call, so the agent
 * rejects them here with one actionable signal instead; the escape that works
 * is re-issuing the calls one at a time with complete arguments.
 */
export const EMPTY_ARGS_TOOL_CONTENT =
  'Tool call rejected: the arguments of this call arrived empty — the parameters were lost before execution, a known failure mode when several tool calls are emitted in parallel. The call was not executed. Call the tool again one call at a time and include the complete arguments JSON for the call.';
export const EMPTY_ARGS_TOOL_REASON = 'tool_arguments_empty';

/**
 * JSON Schema keywords that cannot make an object with no properties
 * invalid, and are therefore safe to ignore when proving that `{}` is a
 * valid input. Any keyword outside this set — combinators (`oneOf` /
 * `allOf` / `anyOf` / `not`), `minProperties`, `enum` / `const`,
 * `if` / `then`, `dependent*`, … — can constrain the shape in ways a
 * missing top-level `required` does not reveal (e.g. connector/MCP schemas
 * like `{ oneOf: [{ required: ['path'] }, { required: ['url'] }] }` accept
 * no empty object even though `required` is absent), so such schemas stay
 * loss-shaped and take the rejection path.
 */
const EMPTY_OBJECT_SAFE_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'patternProperties',
  'propertyNames',
  '$schema',
  '$id',
  '$defs',
  'definitions',
  'title',
  'description',
  'default',
  'examples',
]);

/**
 * Conservative JSON Schema proof that an empty object is a valid input.
 * Only schemas proven to accept `{}` normalize an omitted-arguments call;
 * anything unrecognized or combinator-shaped is not proven.
 */
const schemaProvesEmptyObjectValid = (parameters: object): boolean => {
  const schema = parameters as Record<string, unknown>;
  for (const key of Object.keys(schema)) {
    if (!EMPTY_OBJECT_SAFE_KEYWORDS.has(key)) return false;
  }
  // A non-object type (string, array, number, …) rejects `{}`.
  if (schema.type !== undefined && schema.type !== 'object') return false;
  const required = schema.required;
  if (required !== undefined && (!Array.isArray(required) || required.length > 0)) return false;
  return true;
};

/**
 * Whether the tool's declared parameter schema makes this a legal no-argument
 * call. A tool whose schema is proven to accept `{}` can also be invoked
 * with the `arguments` field omitted entirely — several provider/gateway
 * serialization paths drop an empty arguments string when streaming a tool
 * call — so an empty `arguments` there is not the T-673 serialization-loss
 * shape and must not be rejected. Schemas that are missing, combinator-
 * shaped, or otherwise not proven to accept an empty object stay loss-shaped
 * and take the rejection path.
 */
export const toolExpectsNoArguments = (
  toolCalling: ChatToolPayload,
  state: AgentState,
): boolean => {
  // Effective lookup (static map + step-activated manifests): a tool exposed
  // only through `state.activatedStepTools` has no static entry, and a lookup
  // that misses it degrades a legal no-argument call to the rejection path.
  const manifest = selectEffectiveToolManifestMap(state)[toolCalling.identifier];
  if (!manifest) return false;

  const api = manifest.api?.find((a: any) => a.name === toolCalling.apiName);
  // API-level schema takes precedence over tool-level, mirroring getToolInterventionConfig.
  const parameters = api?.parameters ?? manifest.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return false;

  return schemaProvesEmptyObjectValid(parameters);
};

/**
 * Splits a batch into calls the executor can attempt and calls that arrived
 * with no `arguments` at all. `{}` stays executable — it is a legal
 * no-argument call and JSON-parses fine; only a missing arguments string is
 * the serialization-loss shape, and it cannot survive `JSON.parse` in the
 * executor anyway. Exception: a tool whose schema is proven to accept an
 * empty object accepts an empty `arguments` — providers may omit the field
 * for no-parameter calls, and rejecting it blocks legal listCriteria-style
 * calls (vent T-800), so those calls are normalized to `{}` and executed.
 * Combinator schemas (oneOf/allOf/anyOf) are not proven and stay rejected.
 */
export const partitionEmptyArgumentsCalls = (
  toolsCalling: ChatToolPayload[],
  state: AgentState,
) => {
  const emptyArgsCalls: ChatToolPayload[] = [];
  const executableCalls: ChatToolPayload[] = [];
  for (const toolCalling of toolsCalling) {
    if (toolCalling.arguments && toolCalling.arguments.trim().length > 0) {
      executableCalls.push(toolCalling);
    } else if (toolExpectsNoArguments(toolCalling, state)) {
      executableCalls.push({ ...toolCalling, arguments: '{}' });
    } else {
      emptyArgsCalls.push(toolCalling);
    }
  }
  return { emptyArgsCalls, executableCalls };
};
