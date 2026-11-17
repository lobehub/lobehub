import { escapeJsonStringControlChars } from '../engine/tools/toolArguments';
import { safeParseJSON, safeParsePartialJSON } from './safeParseJSON';

/**
 * Ensure a tool_call `arguments` string is always valid JSON before it
 * enters history or gets replayed to providers.
 *
 * Strict providers (e.g. NVIDIA NIM) validate the full message history on
 * every request. A single malformed `arguments` string — even one produced
 * many turns ago — causes a 400 on the entire request, terminating the op
 * and wasting all accumulated tokens. See .
 *
 * Behavior:
 *   - Valid JSON → returned as-is (preserves prompt-cache keys).
 *   - Valid once raw control characters inside strings are escaped → the
 *     escaped string, so a multi-line value written with literal newlines
 *     keeps its content (partial-json drops that whole field).
 *   - Recoverable via partial-json → re-stringified.
 *   - Unrecoverable → "{}" so the tool_call structure survives and the
 *     model can replan on the next turn.
 */
export const sanitizeToolCallArguments = (argsStr: string | undefined): string => {
  if (typeof argsStr !== 'string' || argsStr.length === 0) return '{}';

  if (safeParseJSON(argsStr) !== undefined) return argsStr;

  const escaped = escapeJsonStringControlChars(argsStr);
  if (escaped !== argsStr && safeParseJSON(escaped) !== undefined) return escaped;

  const recovered = safeParsePartialJSON(escaped);
  if (recovered !== undefined && typeof recovered === 'object' && recovered !== null) {
    return JSON.stringify(recovered);
  }

  return '{}';
};
