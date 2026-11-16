/**
 * How a search command reads its pattern. `basic` is POSIX grep's default,
 * where `\|` and `\(` are operators and a bare `|` is a literal; `extended` is
 * `grep -E`, `rg`, `ag`, and `ack`, where `|` and `(` are operators; `fixed` is
 * a literal string (`grep -F`, `rg -F`).
 */
export type SearchPatternDialect = 'basic' | 'extended' | 'fixed';

/**
 * Backslash escapes that only make punctuation literal (`\.`, `\$`, `\-`).
 * Letter escapes such as `\b` or `\d` mean something, so they stay as written.
 */
const LITERAL_ESCAPE = /^[^\dA-Z]$/iu;

/**
 * The terms a search pattern looks for, as a person reads them:
 * `grep "foo\|bar\.ts"` searches `foo` and `bar.ts`. Top-level alternation
 * splits into terms; alternation inside a group or a bracket expression stays
 * in its term. A pattern that yields no term reads as written.
 *
 * Ported from Caxri (`packages/protocol/src/agent/tool-rows/shell/agent-shell-search-pattern.ts`).
 */
export const searchPatternTerms = (pattern: string, dialect: SearchPatternDialect): string[] => {
  if (dialect === 'fixed') return [pattern];
  const terms: string[] = [];
  let current = '';
  let depth = 0;
  let isInBracket = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern.charAt(index);
    if (isInBracket) {
      current += char;
      if (char === ']') isInBracket = false;
      continue;
    }
    if (char === '[') {
      isInBracket = true;
      current += char;
      continue;
    }
    if (char === '\\') {
      const next = pattern.at(index + 1);
      index += 1;
      if (next === undefined) {
        current += char;
      } else if (dialect === 'basic' && next === '|' && depth === 0) {
        terms.push(current);
        current = '';
      } else if (dialect === 'basic' && (next === '(' || next === ')')) {
        depth = Math.max(0, depth + (next === '(' ? 1 : -1));
        current += next;
      } else {
        current += LITERAL_ESCAPE.test(next) ? next : `${char}${next}`;
      }
      continue;
    }
    if (dialect === 'extended' && char === '|' && depth === 0) {
      terms.push(current);
      current = '';
      continue;
    }
    if (dialect === 'extended' && (char === '(' || char === ')'))
      depth = Math.max(0, depth + (char === '(' ? 1 : -1));
    current += char;
  }
  terms.push(current);
  const readable = terms.map((term) => term.trim()).filter(Boolean);
  return readable.length > 0 ? [...new Set(readable)] : [pattern];
};
