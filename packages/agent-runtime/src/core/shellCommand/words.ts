/** Word-level classification shared by command resolution and the predicates. */

/** VAR=value environment assignment prefix (FOO=bar cmd), not a command word. */
export const ASSIGNMENT_PATTERN = /^[A-Z_]\w*=.*$/i;

/** Basename of a path-qualified command word: /bin/rm → rm, ./x.sh → x.sh. */
export const commandBasename = (word: string): string => {
  const lastSlash = word.lastIndexOf('/');
  return lastSlash >= 0 && lastSlash + 1 < word.length ? word.slice(lastSlash + 1) : word;
};

/**
 * A command word whose executable is unknowable at parse time, because the
 * shell substitutes it before exec:
 *
 * - command substitution — `$(printf rm) -rf ~`, `` `printf rm` -rf ~ ``: the
 *   substitution's OUTPUT is the executable;
 * - parameter expansion of ANY shape — `X=rm; $X -rf /`, `${CMD} -rf ~`,
 *   `${CMD:-rm} -rf /`, `${CMD}rm -rf /`, `r${X}m`, `$1`, `$@`: the value
 *   (or default) is the executable, and this analyzer does not track
 *   assignments, positional parameters or defaults.
 *
 * Any `$` in the command word counts — the tokenizer has already removed
 * quotes, so quoting provenance is gone, and a literal `$` in an executable
 * name is not worth trusting. Over-detection here only routes the segment to
 * the conservative fallback (recursive flag + family target), never blocks a
 * command on its own.
 *
 * Such a word must never be trusted as a confident command name; callers
 * resolve it to null so the ambiguity fallback stays conservative.
 */
export const isUnresolvableCommandWord = (word: string): boolean =>
  word.includes('$') || word.includes('`') || hasUnresolvedBraceAlternation(word);

/**
 * A comma-bearing brace group (a real Bash expansion, not the literal `{fd}`
 * named-descriptor prefix) that SURVIVED brace expansion. That happens only
 * when `expandBraceAlternatives` hit its depth or variant budget, or when the
 * group is unbalanced — and an unbalanced `{a,b` is literal in Bash, so it is
 * excluded here.
 *
 * A surviving group means the executable this word becomes is unknowable at
 * parse time: `{{{{{{rm,echo},echo},echo},echo},echo},echo} -rf ~` runs `rm`
 * with `-rf` on the home directory, but the depth cap returns the literal
 * text, which command resolution then trusts as an unrelated executable name.
 * Treat it like a substitution — resolve to null and let the ambiguity
 * fallback stay conservative — instead of as a confident command name.
 */
export const hasUnresolvedBraceAlternation = (word: string): boolean => {
  for (let i = 0; i < word.length; i++) {
    if (word[i] !== '{') continue;
    let level = 0;
    let hasComma = false;
    let close = -1;
    for (let j = i; j < word.length; j++) {
      const char = word[j];
      if (char === '{') level++;
      else if (char === '}') {
        level--;
        if (level === 0) {
          close = j;
          break;
        }
      } else if (char === ',' && level === 1) hasComma = true;
    }
    if (close < 0) continue;
    if (hasComma) return true;
    i = close;
  }
  return false;
};

/**
 * The value a `${NAME<op>WORD}` expansion can produce from its WORD operand:
 * `${X:-rm -rf /}` / `${X-…}` (default), `${X:=…}` / `${X=…}` (assign
 * default) and `${X:+…}` / `${X+…}` (alternate value) all yield WORD under
 * some state of X. Unquoted, that value is word-split and executed (command
 * slot) or deleted (operand), so callers analyze it alongside the word.
 * Returns undefined for any other shape.
 */
export const parameterExpansionOperand = (word: string): string | undefined => {
  const match = /^\$\{[a-z_]\w*:?[-=+]([\S\s]*?)\}?$/i.exec(word);
  return match ? match[1] : undefined;
};

export const isDashWord = (word: string): boolean => word.startsWith('-') && word.length > 1;

/**
 * Brace-expand a word the way Bash does before the word reaches argv:
 * `rm -r{f,} /` really runs `rm -rf -r /`, and `{rm,echo} -rf ~` runs
 * `rm echo -rf <home>` — the generated words must be visible to command,
 * flag and target classification. A brace group with no top-level comma
 * (`-r{x}`) is literal in Bash and stays untouched, and parameter expansions
 * (`${A:-x,y}`) are not brace-expanded at all.
 *
 * Bounded on both axes (nesting depth and total variants) and falls back to
 * the unexpanded word when a shape exceeds them. That leftover literal is NOT
 * a safe argv word: it still contains a group Bash would have expanded, so
 * `hasUnresolvedBraceAlternation` marks it unresolvable and command
 * resolution refuses to name an executable from it.
 */
export const expandBraceAlternatives = (word: string, depth = 0): string[] => {
  if (depth > 4 || !word.includes('{')) return [word];

  const open = word.indexOf('{');
  let level = 0;
  let close = -1;
  for (let i = open; i < word.length; i++) {
    if (word[i] === '{') level++;
    else if (word[i] === '}') {
      level--;
      if (level === 0) {
        close = i;
        break;
      }
    }
  }
  // Unbalanced brace: Bash leaves it literal.
  if (close < 0) return [word];

  const prefix = word.slice(0, open);
  const suffix = word.slice(close + 1);
  const body = word.slice(open + 1, close);
  const members: string[] = [];
  let buffer = '';
  level = 0;
  for (const char of body) {
    if (char === '{') level++;
    else if (char === '}') level--;
    if (char === ',' && level === 0) {
      members.push(buffer);
      buffer = '';
    } else {
      buffer += char;
    }
  }
  members.push(buffer);

  const tails = expandBraceAlternatives(suffix, depth + 1);
  if (members.length < 2) {
    // `{x}` is literal, but a later brace in the same word may still expand:
    // keep this group as-is and expand only the tail.
    return tails.map((tail) => `${word.slice(0, close + 1)}${tail}`);
  }

  const expanded: string[] = [];
  for (const member of members) {
    // A member can be a brace group of its own (`{{rm,echo},true}`): Bash
    // expands the inner group before exec, so keeping `{rm,echo}` literal let
    // the resolver treat it as an unrelated executable and miss the `rm`
    // deletion. Expand each member recursively; the depth/budget caps below
    // still bound the work.
    for (const variant of expandBraceAlternatives(member, depth + 1)) {
      for (const tail of tails) {
        expanded.push(`${prefix}${variant}${tail}`);
        if (expanded.length > 32) return [word];
      }
    }
  }
  return expanded;
};

/**
 * Collect all long-flag names (e.g. 'recursive' from --recursive / --recursive=yes)
 * and all single-letter flags from short-flag words (e.g. r, f from -rf).
 *
 * Brace-generated flags count too: the shell expands `-r{f,}` into `-rf` and
 * `-r` before exec, so the recursive flag must be classified here rather than
 * left inside the literal `{…}` token.
 */
export const collectFlagLettersAndNames = (
  flags: string[],
): { letters: Set<string>; names: Set<string> } => {
  const letters = new Set<string>();
  const names = new Set<string>();
  for (const flag of flags) {
    for (const variant of expandBraceAlternatives(flag)) {
      // A dash word whose brace group SURVIVED expansion (depth or variant
      // budget exhausted) still becomes real flags before exec:
      // `rm -r{f,}{f,}…{f,} ~` is 2048 words, and every one of them is
      // recursive. The exact letters are unknowable at parse time, so a regex
      // that requires a brace-free `-rf` would drop the flag and report no
      // recursion at all. Register every candidate letter instead — over
      // detection only routes the segment to the conservative fallback.
      if (isDashWord(variant) && hasUnresolvedBraceAlternation(variant)) {
        for (const letter of variant.replaceAll(/[{}]/g, '')) {
          if (!/[a-z\d]/i.test(letter)) continue;
          letters.add(letter);
          letters.add(letter.toLowerCase());
        }
        continue;
      }
      // Long flag: --name or --name=value → register both the name and, for
      // security conservatism, its first letter (rm -R / -r alias semantic).
      const longMatch = /^--([^=]+)(?:=.*)?$/.exec(variant);
      if (longMatch) {
        names.add(longMatch[1]);
        letters.add(longMatch[1][0]);
        continue;
      }
      // Combined short flags: -rf → r, f
      const shortMatch = /^-([A-Z0-9]+)$/i.exec(variant);
      if (shortMatch) {
        for (const letter of shortMatch[1]) letters.add(letter);
        continue;
      }
      // Negative number like -1 or lone '-' → not a flag
    }
  }
  return { letters, names };
};
