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
  word.includes('$') || word.includes('`');

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
 * the unexpanded word when a shape exceeds them — an unexpanded token only
 * costs detection, never correctness of the parser.
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
    for (const tail of tails) {
      expanded.push(`${prefix}${member}${tail}`);
      if (expanded.length > 32) return [word];
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
