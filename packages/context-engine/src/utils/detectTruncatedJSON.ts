/**
 * Detect whether a JSON string looks structurally truncated — typical when an
 * LLM's `max_tokens` budget runs out mid-generation of a tool call payload.
 *
 * Returns a short reason string when truncation is suspected, or `null` when
 * the structure looks balanced (in which case any parse failure is more likely
 * a plain syntax error rather than truncation).
 *
 * Intended to be called AFTER `JSON.parse` has already failed, to distinguish
 * "truncated by max_tokens" from "malformed but complete".
 */
export const detectTruncatedJSON = (text: string): string | null => {
  if (!text) return null;

  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of text) {
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }

  if (inString) return 'unterminated string';
  if (braces > 0) return `${braces} unclosed '{'`;
  if (brackets > 0) return `${brackets} unclosed '['`;
  return null;
};
