import { detectTruncatedJSON } from '../../utils/detectTruncatedJSON';

const CONTROL_CHAR_ESCAPES: Record<string, string> = {
  '\b': String.raw`\b`,
  '\f': String.raw`\f`,
  '\n': String.raw`\n`,
  '\r': String.raw`\r`,
  '\t': String.raw`\t`,
};

/**
 * Escape raw control characters (U+0000–U+001F) inside JSON string literals.
 *
 * Some models write literal newlines and tabs into long string values (HTML, code, Markdown)
 * instead of `\n` / `\t`. JSON forbids them, but each one has exactly one meaning, so escaping
 * them keeps every character the model wrote. Control characters outside strings are JSON
 * whitespace (or invalid either way) and stay as they are.
 *
 * Returns the input itself when there is nothing to escape.
 */
export const escapeJsonStringControlChars = (text: string): string => {
  const parts: string[] = [];
  let changed = false;
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      } else if (char < ' ') {
        parts.push(
          CONTROL_CHAR_ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
        );
        changed = true;
        continue;
      }
    } else if (char === '"') {
      inString = true;
    }
    parts.push(char);
  }

  return changed ? parts.join('') : text;
};

/**
 * Parse a tool-call arguments string, repairing only what cannot change its meaning: raw
 * control characters inside string values.
 *
 * Returns `undefined` when the text is empty or is still not valid JSON. Callers report that
 * instead of guessing, because a lossy repair hands the tool an object that silently lacks
 * fields (createCanvas then failed with "provide content" for content the model did send).
 */
export const parseToolArgumentsLossless = <T = Record<string, unknown>>(
  text?: string,
): T | undefined => {
  if (typeof text !== 'string' || !text.trim()) return undefined;

  try {
    return JSON.parse(text) as T;
  } catch {
    // fall through to the control-character repair
  }

  const repaired = escapeJsonStringControlChars(text);
  if (repaired === text) return undefined;

  try {
    return JSON.parse(repaired) as T;
  } catch {
    return undefined;
  }
};

export interface UnparseableToolArguments {
  code: 'INVALID_JSON_ARGUMENTS' | 'TRUNCATED_ARGUMENTS';
  /** Model-facing tool result: the explanation followed by the raw arguments string. */
  content: string;
  /** The explanation alone, for the tool error. */
  message: string;
}

/**
 * Explain arguments that `parseToolArgumentsLossless` could not parse. Both runtimes return
 * this as the tool result instead of running the tool, so the model sees exactly what it sent
 * and can resend the call.
 *
 * The truncation cause is unknown at this point: an exhausted output budget and an upstream
 * that closed the stream early look identical. Naming max_tokens made models tell users the
 * platform caps output and that they should raise a setting, which was wrong for interrupted
 * streams, so the message lists both causes and asks the model not to assert either one.
 */
export const describeUnparseableToolArguments = (argsStr: string): UnparseableToolArguments => {
  const truncationReason = detectTruncatedJSON(argsStr);
  const message = truncationReason
    ? `The tool call arguments JSON appears to be truncated (${truncationReason}), ` +
      `so the tool was not invoked. The output was cut off before the call was complete, ` +
      `either because the output length limit was reached or because the response stream ` +
      `was interrupted; the cause cannot be determined here, so do not tell the user it ` +
      `was a specific limit or setting. ` +
      `If the arguments carry large content, split it into smaller pieces across several calls. ` +
      `Do not resend the same truncated arguments.`
    : `The tool call arguments string is not valid JSON and could not be parsed, ` +
      `so the tool was not invoked. Fix the JSON syntax and try again.`;

  return {
    code: truncationReason ? 'TRUNCATED_ARGUMENTS' : 'INVALID_JSON_ARGUMENTS',
    content: `${message}\n\nThe received arguments string was:\n${argsStr}`,
    message,
  };
};
