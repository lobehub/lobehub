/**
 * Shell word quoting helpers shared by the command splitter.
 *
 * Kept separate from `shellCommand/`: quote removal is a self-contained stage — it takes
 * raw text and returns the word the shell would present as argv — and it is
 * where the ANSI-C semantics (`$'…'`, NUL truncation) live.
 */

/**
 * Grouping operators (`(`, `)`) are shell syntax, never part of a word, but
 * the tokenizer only splits on command separators — so an operand can arrive
 * as `~)` and a command word as `(command`. Hand-scanned instead of
 * `replace(/^\(+/, '').replace(/\)+$/, '')`: operands come straight from the
 * tool call, and a regex over uncontrolled input is a CodeQL
 * js/polynomial-redos finding; index walks are linear.
 */
export const trimGroupingRuns = (word: string, trimTrailing: boolean): string => {
  let start = 0;
  let end = word.length;
  while (start < end && word[start] === '(') start++;
  while (trimTrailing && end > start && word[end - 1] === ')') end--;
  return word.slice(start, end);
};

/** Strip operator runs from both edges (`~)` → `~`, `(rm` → `rm`). */
export const stripGroupingParens = (word: string): string => trimGroupingRuns(word, true);

/** Strip only a leading opener: function definitions (`f()`) and `case` arms
 * (`a)`) keep their trailing `)` as syntax. */
export const stripLeadingGroupingParens = (word: string): string => trimGroupingRuns(word, false);

const ANSI_C_SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "'": "'",
  '?': '?',
  '\\': '\\',
  'E': '\x1B',
  'a': '\x07',
  'b': '\b',
  'e': '\x1B',
  'f': '\f',
  'n': '\n',
  'r': '\r',
  't': '\t',
  'v': '\v',
};

/**
 * Decode an ANSI-C quoted payload starting just after `$'`. Returns the
 * decoded text and the index just past the closing quote (or the end of
 * input when unterminated).
 */
export const decodeAnsiCQuoted = (raw: string, start: number): { end: number; value: string } => {
  let value = '';
  let i = start;
  // Bash stores ANSI-C strings as C strings: a decoded NUL terminates the
  // value, and everything after it is dropped even though the closing quote is
  // still honoured (`$'EOF\0ignored'` is the word `EOF`). Appending the tail
  // made the heredoc delimiter `EOF\0ignored`, so the real terminator line
  // never matched and the `rm -rf ~` after the heredoc was read as stdin data.
  let truncated = false;
  const append = (text: string): void => {
    if (truncated) return;
    const nul = text.indexOf('\0');
    if (nul === -1) {
      value += text;
      return;
    }
    value += text.slice(0, nul);
    truncated = true;
  };
  const readDigits = (pattern: RegExp, max: number): string => {
    let digits = '';
    while (digits.length < max && i < raw.length && pattern.test(raw[i])) digits += raw[i++];
    return digits;
  };
  while (i < raw.length) {
    const char = raw[i];
    if (char === "'") return { end: i + 1, value };
    if (char !== '\\' || i + 1 >= raw.length) {
      append(char);
      i++;
      continue;
    }
    const next = raw[i + 1];
    i += 2;
    if (next in ANSI_C_SIMPLE_ESCAPES) {
      append(ANSI_C_SIMPLE_ESCAPES[next]);
    } else if (next === 'x') {
      const hex = readDigits(/[\da-f]/i, 2);
      append(hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : '\\x');
    } else if (next === 'u' || next === 'U') {
      const hex = readDigits(/[\da-f]/i, next === 'u' ? 4 : 8);
      const codePoint = hex ? Number.parseInt(hex, 16) : Number.NaN;
      append(codePoint <= 0x10_ffff ? String.fromCodePoint(codePoint) : `\\${next}${hex}`);
    } else if (/[0-7]/.test(next)) {
      i--;
      const octal = readDigits(/[0-7]/, 3);
      append(String.fromCodePoint(Number.parseInt(octal, 8) & 0xff));
    } else if (next === 'c' && i < raw.length) {
      append(String.fromCodePoint(raw[i++].toUpperCase().charCodeAt(0) ^ 0x40));
    } else {
      // Unknown escape: bash keeps the backslash.
      append(`\\${next}`);
    }
  }
  return { end: i, value };
};

/**
 * Bash reserved words that introduce a command whose FIRST follower executes:
 * `if CMD; then CMD; else CMD; fi`, `while/until CMD; do CMD; done`. They are
 * shell SYNTAX, not executables — resolving them as the command hides the
 * real one behind them (`then rm -rf /` deleted via `if true; then …`).
 */
const SHELL_RESERVED_COMMAND_PREFIXES = new Set([
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
]);

/**
 * Compound-command syntax that introduces (rather than is) a command:
 * `{ rm -rf /; }`, `( rm -rf / )`, `case x in a) rm -rf /;; esac`.
 * Resolving these words as the command hides the real one behind them.
 */
const SHELL_COMPOUND_SYNTAX_WORDS = new Set(['{', '}', '(', ')', 'case', 'esac', 'select', 'in']);

/**
 * Skip leading shell syntax so the real command word can be resolved.
 *
 * `case WORD in PATTERN) COMMAND;; esac` is the awkward shape: the selector
 * and `in` precede the arm, and the arm's PATTERN (which ends in `)`) precedes
 * its COMMAND. Everything up to and including that pattern is syntax and is
 * consumed as a unit — otherwise the selector or the pattern would be mistaken
 * for the command and the deletion behind it would resolve to a confident,
 * unrelated word. A word ending in `)` in the command position is the arm
 * pattern (or a group/subshell close), never an executable.
 */
export const skipShellSyntax = (words: string[], start: number): number => {
  let index = start;
  while (index < words.length) {
    // Grouping operators are glued onto the word beside them (`(if`, `(rm`),
    // so normalize BEFORE dispatching on the reserved-word sets. Skipping this
    // made `(if rm -rf ~; …)` resolve to the reserved word `if` as a confident
    // executable — every predicate then returned false while Bash ran the
    // deletion inside the subshell.
    const word = stripLeadingGroupingParens(words[index]);
    if (SHELL_RESERVED_COMMAND_PREFIXES.has(word) || SHELL_COMPOUND_SYNTAX_WORDS.has(word)) {
      index++;
      if (word === 'case') {
        // Consume the selector, `in`, and the first arm pattern (`a)`, `a|b)`).
        // `)` is a shell metacharacter, so the pattern ends mid-token when the
        // command is glued to it (`case x in x)rm -rf ~`). Keeping `x)rm` as
        // one word swallowed the executable with the pattern and left
        // resolution with no words at all. Split at the LAST `)` — an earlier
        // one can only come from a quoted pattern (`"a)b")`), which reaches
        // this loop quote-stripped.
        while (index < words.length) {
          const arm = words[index];
          const close = arm.lastIndexOf(')');
          if (close === -1) {
            index++;
            continue;
          }
          const command = stripLeadingGroupingParens(arm.slice(close + 1));
          if (command.length > 0) {
            // Keep the executable in the pattern's slot so the caller resolves it.
            words[index] = command;
          } else {
            index++;
          }
          break;
        }
      }
      continue;
    }
    // A `)` in command position closes a `case` pattern or a grouping run, and
    // the tail after the LAST `)` is the executable. Splitting at `)` used to
    // run only for the FIRST arm, under the `case` introducer — later arms
    // start their own segment, so `case x in y)true;; x)rm -rf ~;; esac`
    // resolved that segment's command to the unrelated word `x)rm` and every
    // predicate missed the deletion bash performs. Quoted patterns are
    // already quote-stripped by the time they reach this loop, so a word like
    // `"a)b"` over-splits; for a blacklist that is the safe direction.
    const armClose = word.lastIndexOf(')');
    // `zap(){ rm -rf "$@" }` is a function DEFINITION head, not an arm: the
    // body opener follows the `)` and the raw word must stay intact so the
    // definition is parsed (`zap` is later invoked as a forwarding `rm`).
    if (armClose !== -1 && word.slice(armClose + 1) !== '{') {
      const command = stripLeadingGroupingParens(word.slice(armClose + 1));
      if (command.length > 0) {
        // Re-enter the loop with the executable in the pattern's slot: the
        // remainder can itself be syntax (`zap(){ rm … }` leaves `{`).
        words[index] = command;
        continue;
      }
      index++;
      continue;
    }
    break;
  }
  return index;
};
