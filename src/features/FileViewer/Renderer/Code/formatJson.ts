const INDENT = '  ';
/** Larger documents stay raw: re-indenting can multiply the line count past what the highlighter renders smoothly. */
const MAX_FORMAT_LENGTH = 256 * 1024;
/** Deeper nesting stays raw: indentation grows with depth, so pathological nesting would explode the output. */
const MAX_FORMAT_DEPTH = 64;

const isWhitespace = (char: string) =>
  char === ' ' || char === '\n' || char === '\r' || char === '\t';

/**
 * Re-indent valid JSON text without parsing its values.
 *
 * Use when:
 * - The text is already known to be valid JSON.
 *
 * Returns:
 * - The same tokens with two-space indentation; numbers, strings and escape
 *   sequences are copied verbatim, so large integers keep their precision.
 * - `null` when nesting exceeds `MAX_FORMAT_DEPTH`.
 */
const reindentJson = (text: string): string | null => {
  const out: string[] = [];
  let depth = 0;
  let i = 0;

  const newline = () => `\n${INDENT.repeat(depth)}`;

  while (i < text.length) {
    const char = text[i];

    if (char === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      out.push(text.slice(i, end + 1));
      i = end + 1;
      continue;
    }

    if (isWhitespace(char)) {
      i += 1;
      continue;
    }

    if (char === '{' || char === '[') {
      let next = i + 1;
      while (next < text.length && isWhitespace(text[next])) next += 1;
      const close = char === '{' ? '}' : ']';
      if (text[next] === close) {
        out.push(char + close);
        i = next + 1;
        continue;
      }
      depth += 1;
      if (depth > MAX_FORMAT_DEPTH) return null;
      out.push(char, newline());
    } else if (char === '}' || char === ']') {
      depth -= 1;
      out.push(newline(), char);
    } else if (char === ',') {
      out.push(',', newline());
    } else if (char === ':') {
      out.push(': ');
    } else {
      let end = i + 1;
      while (end < text.length && !isWhitespace(text[end]) && !',:]}'.includes(text[end])) end += 1;
      out.push(text.slice(i, end));
      i = end;
      continue;
    }

    i += 1;
  }

  return out.join('');
};

/**
 * Prepare JSON file text for the read-only code preview.
 *
 * Use when:
 * - Rendering a file whose detected language is `json`.
 *
 * Expects:
 * - The decoded file text and the language from `getLanguageFromFilename`.
 *
 * Returns:
 * - Indented JSON for valid single-line (minified) documents; the original text
 *   for other languages, invalid JSON, files the author already laid out across
 *   several lines, and documents too large or too deeply nested to format.
 */
export const formatJsonForPreview = (text: string, language: string): string => {
  if (language !== 'json') return text;

  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_FORMAT_LENGTH || trimmed.includes('\n')) return text;

  try {
    JSON.parse(trimmed);
  } catch {
    return text;
  }

  return reindentJson(trimmed) ?? text;
};
