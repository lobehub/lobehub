/** A real U+0000 character. Built at runtime so no source file carries one. */
const NUL = String.fromCodePoint(0);

/**
 * A NUL immediately followed by two hex digits is a double-decoding artifact:
 * an `é` that round-tripped as NUL + `e9` instead of `é`. Fold those back into
 * the character they meant.
 */
const CORRUPTED_ESCAPE = new RegExp(`${NUL}([0-9a-f]{2})`, 'gi');

const sanitizeString = (value: string): string =>
  value.includes(NUL)
    ? value
        .replaceAll(CORRUPTED_ESCAPE, (_match, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        )
        .replaceAll(NUL, '')
    : value;

/**
 * Sanitize null bytes from values before PostgreSQL insertion — PostgreSQL
 * cannot store U+0000 in text/jsonb columns.
 *
 * Walks the value and rewrites every string in place. It deliberately does NOT
 * round-trip through `JSON.stringify` -> string surgery -> `JSON.parse`.
 *
 * That round trip corrupts any payload whose TEXT spells out a unicode escape
 * for U+0000 (regex character classes, `GROUP_KEY_SEP` constants, smali /
 * Kotlin metadata, base64 dumps — everything a coding agent reads out of real
 * source files). `stringify` doubles that text's leading backslash, so the
 * six-character needle then matches one character late; stripping it eats the
 * escape's own backslash and leaves an orphan trailing backslash, and the
 * re-parse dies with `SyntaxError: Bad escaped character in JSON at position
 * N`. Thrown from the tool-result persist path, that killed the whole agent
 * operation. Operating on decoded values can never reach an escape sequence,
 * so the literal text is left untouched.
 *
 * Mirrors `stripNulDeep` in `@lobechat/heterogeneous-agents`, plus the
 * corrupted-Unicode recovery above.
 */
export const sanitizeNullBytes = <T>(val: T): T => {
  if (val == null) return val;

  if (typeof val === 'string') return sanitizeString(val) as T;

  if (Array.isArray(val)) return val.map((item) => sanitizeNullBytes(item)) as T;

  if (typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val).map(([key, value]) => [sanitizeString(key), sanitizeNullBytes(value)]),
    ) as T;
  }

  return val;
};
