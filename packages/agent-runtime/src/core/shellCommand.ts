/**
 * Lightweight shell command analysis for security rules.
 *
 * The goal is NOT to be a full shell parser. It is a conservative,
 * security-oriented splitter that turns a raw command string into semantic
 * segments so rules can match on "command + flags + targets" instead of
 * brittle full-string regex.
 *
 * Design principles (security checker context):
 * - Over-detection is acceptable; under-detection is not. When unsure, segments
 *   keep MORE raw context rather than less.
 * - Quotes are honored: separators/flags/redirections inside quotes are inert.
 * - Command substitution (backticks, $(...)) does not split the outer command;
 *   its content is preserved inside words and rules must stay conservative
 *   about segments that contain substitutions.
 * - Wrappers (sudo / env / nohup) are unwrapped to expose the real command.
 */

export interface ShellSegment {
  /**
   * Flag words as they appeared (e.g. '-rf', '--recursive'), collected from
   * dash-prefixed words. Quoted words never count as flags.
   */
  flags: string[];

  /** Check whether a single-letter flag is active (expands combined flags like -rf). */
  hasFlag: (letter: string) => boolean;

  /** Check whether a long flag name is active (--recursive). */
  hasLongFlag: (name: string) => boolean;

  /** Argument targets that resolve into a home directory (~, $HOME, /Users/x, /home/x). */
  homeTargets: string[];

  /** Raw text of this segment (trimmed of surrounding whitespace). */
  raw: string;

  /** Command name after unwrapping sudo/env/nohup (first word if no wrapper). */
  resolvedCommand: string | null;

  /** Argument targets that end with '/' (including bare '/'). */
  trailingSlashTargets: string[];

  /**
   * Words after stripping redirections, respecting quotes.
   * Quoted strings are kept as single words with quotes removed.
   */
  words: string[];
}

/** VAR=value environment assignment prefix (FOO=bar cmd), not a command word. */
const ASSIGNMENT_PATTERN = /^[A-Z_]\w*=.*$/i;

/** Basename of a path-qualified command word: /bin/rm → rm, ./x.sh → x.sh. */
const commandBasename = (word: string): string => {
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
const skipShellSyntax = (words: string[], start: number): number => {
  let index = start;
  while (index < words.length) {
    const word = words[index];
    if (SHELL_RESERVED_COMMAND_PREFIXES.has(word) || SHELL_COMPOUND_SYNTAX_WORDS.has(word)) {
      index++;
      if (word === 'case') {
        // Consume the selector, `in`, and the first arm pattern (`a)`, `a|b)`).
        while (index < words.length) {
          const arm = words[index];
          index++;
          if (arm.endsWith(')')) break;
        }
      }
      continue;
    }
    if (word.endsWith(')')) {
      index++;
      continue;
    }
    break;
  }
  return index;
};

/**
 * Split command string into segments on `;`, `&`, `|`, `&&`, `||` while
 * respecting single/double quotes and skipping command substitution bodies
 * (they stay embedded in words rather than being split as separators).
 */
const splitIntoRawSegments = (command: string): string[] => {
  // Unquoted ${IFS} expands to the field separator (a space under the
  // default IFS): `rm${IFS}-rf${IFS}/` field-splits into `rm -rf /` and
  // performs the deletion. Conservatively replace it with a space so the
  // tokenizer sees the real argv; quoted '${IFS}' is NOT affected because
  // quote state is tracked while scanning below... (pre-processing cannot
  // see quotes, so only bare, non-'${IFS}'-literal occurrences — the
  // attack form — are replaced; a quoted occurrence would arrive as the
  // literal text '${IFS}' inside quotes and is restored by NOT replacing
  // inside single quotes. The conservative scan below tracks quotes.)
  const PREPARED = (() => {
    let out = '';
    let scanQuote: string | null = null;
    for (let k = 0; k < command.length; k++) {
      const c = command[k];
      if (scanQuote) {
        out += c;
        if (c === scanQuote) scanQuote = null;
        continue;
      }
      if (c === '"' || c === "'") {
        scanQuote = c;
        out += c;
        continue;
      }
      if (c === '$' && command.slice(k, k + 6) === '${IFS}') {
        out += ' ';
        k += 5;
        continue;
      }
      out += c;
    }
    return out;
  })();
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  // Tracks positions of unquoted command substitutions: we DO split on
  // separators outside quotes; substitution content retains its separators
  // because $( and backtick regions are tracked below.
  let inSubstitution = 0; // depth for $( )
  let inBacktick = false;
  // Heredoc state: once an unquoted `<<`/`<<-` operator (optionally fd-
  // prefixed, e.g. `2<<`) is seen, the delimiter word follows on the SAME
  // line and every line after that belongs to the body — but ONLY when the
  // heredoc operator is still the last operator of its command: a `;`/`&`/`
  // |` on the operator line closes the command, and the text after it is a
  // real, blockable command again. The shell feeds the body to the consuming
  // command as stdin DATA — newline separators inside it are inert
  // (`cat <<'EOF'
  // rm -rf /
  // EOF` reads text, it does not execute rm). Without this tracking the
  // splitter would emit body lines as independent command segments and
  // re-create the substring false-positive class the module exists to fix.
  // The body is re-attached to its consuming segment as a double-quoted word
  // so downstream consumers can still analyze it: when the consumer is a
  // shell interpreter (`bash <<EOF` + `rm -rf /`) the payload IS executed
  // and the predicate machinery still blocks it; when the consumer is cat or
  // a plain command, the confident-command guard keeps it allowed. Neither
  // the operator nor the delimiter enters the segment text — only the quoted
  // body word does.
  let heredocPending = false; // operator seen on this line, delimiter not yet extracted
  let heredocDelimiter: string | null = null; // quote-stripped delimiter, body not yet started
  let inHeredocBody = false; // body lines are being collected
  let heredocBody = '';

  // Finalize a pending heredoc operator: everything after the last `<<` in
  // the segment text is the delimiter word. The operator marker and the
  // delimiter are REMOVED from the segment text — only the body ever returns
  // (as a quoted word), so the tokenizer cannot mistake body lines for words
  // or redirection targets. An fd prefix (`cat 2<<EOF`) stays in the segment
  // as a bare digit word: it is an inert argument for command resolution and
  // must NOT be stripped (digit-stripping would corrupt commands ending in
  // digits, e.g. `base64 << EOF` → `base`, and hide the body from analysis).
  // Strip order for the delimiter: `<<-` dash, surrounding quotes, backslash
  // escape.
  const finalizeHeredocOperator = () => {
    if (!heredocPending) return;
    heredocPending = false;
    const marker = current.lastIndexOf('<<');
    if (marker < 0) return;
    let delimiter = current.slice(marker + 2).trim();
    if (delimiter.startsWith('-')) delimiter = delimiter.slice(1);
    delimiter = delimiter.replaceAll(/^['"]|['"]$/g, '').replace(/^\\/, '');
    current = current.slice(0, marker);
    heredocDelimiter = delimiter.length > 0 ? delimiter : null;
  };

  for (let i = 0; i < PREPARED.length; i++) {
    const char = PREPARED[i];

    if (inHeredocBody && heredocDelimiter !== null) {
      // Heredoc body: accumulate lines until the delimiter line. The body is
      // appended to the consuming segment as one double-quoted word — never
      // split into command segments.
      const lineEnd = PREPARED.indexOf('\n', i);
      const line = PREPARED.slice(i, lineEnd === -1 ? PREPARED.length : lineEnd).replace(/\r$/, '');
      if (line === heredocDelimiter) {
        // Delimiter found: close the heredoc (the delimiter line is
        // consumed) and attach the body to the segment that holds the
        // operator. Emitted as a quoted word: the tokenizer keeps it as ONE
        // word regardless of internal whitespace or separators. Rewind to
        // just BEFORE this line's newline so the loop re-processes it as a
        // command separator — text after the heredoc (`EOF\nls`) starts a
        // new segment.
        current += ` "${heredocBody.replaceAll('"', '\\"')}"`;
        heredocBody = '';
        heredocDelimiter = null;
        inHeredocBody = false;
        i = lineEnd === -1 ? PREPARED.length : lineEnd - 1;
        continue;
      }
      heredocBody += lineEnd === -1 ? line : `${line}\n`;
      i = lineEnd === -1 ? PREPARED.length : lineEnd;
      continue;
    }

    if (quote) {
      current += char;
      // Escape handling inside quotes. In double quotes `\<newline>` is a
      // line continuation (removed by the shell); other escaped chars stay.
      if (quote === '"' && char === '\\' && i + 1 < PREPARED.length) {
        if (PREPARED[i + 1] !== '\n' && PREPARED[i + 1] !== '\r') {
          current += PREPARED[i + 1];
        }
        i++;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    // Backslash-newline outside quotes is a line continuation: the shell
    // removes it (`rm -rf \<newline>/` deletes '/') — never a separator.
    if (char === '\\' && (PREPARED[i + 1] === '\n' || PREPARED[i + 1] === '\r')) {
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '`') {
      inBacktick = !inBacktick;
      current += char;
      continue;
    }

    if (!inSubstitution && !inBacktick && char === '$' && PREPARED[i + 1] === '(') {
      inSubstitution = 1;
      current += '$(';
      i++;
      continue;
    }

    if (inSubstitution) {
      if (char === '(') inSubstitution++;
      if (char === ')') inSubstitution--;
      current += char;
      continue;
    }

    if (inBacktick) {
      current += char;
      continue;
    }

    if (char === '<' && PREPARED[i + 1] === '<') {
      // `<<<` (here-string) and `<<=` are not heredoc operators.
      if (PREPARED[i + 2] === '<' || PREPARED[i + 2] === '=') {
        current += PREPARED[i + 2];
        i += 2;
        continue;
      }
      // The operator begins a heredoc only at a word boundary: preceded by
      // whitespace, or by fd digits (`2<<`). Inside a word (`a<<b`) this
      // stays textual, keeping arithmetic comparisons out of the heredoc
      // path.
      const prev = current.length > 0 ? (current.at(-1) ?? ' ') : ' ';
      if (!/\s/.test(prev) && !/\d/.test(prev)) {
        current += char;
        continue;
      }
      heredocPending = true;
      current += '<<';
      i += 1;
      continue;
    }

    if (heredocPending && (char === '\n' || char === '\r')) {
      // End of the operator line: finalize the delimiter from the segment
      // tail, then start collecting the body on the NEXT line — but only
      // when the heredoc is still the last operator of its command. A
      // `;`/`&`/`|` on the operator line already finalized the operator and
      // closed the command (`cat << EOF; rm -rf /`), leaving the delimiter
      // null here, so the rm that follows stays a real, blockable command.
      finalizeHeredocOperator();
      if (heredocDelimiter !== null) inHeredocBody = true;
      heredocPending = false;
      // Treat \r\n as one separator
      if (char === '\r' && PREPARED[i + 1] === '\n') i++;
      continue;
    }

    // Unescaped CR/LF is a command separator just like `;` (multi-line
    // commands are legal shell). Inside quotes/substitutions they are inert.
    if (char === '\n' || char === '\r') {
      parts.push(current);
      current = '';
      // Treat \r\n as one separator
      if (char === '\r' && PREPARED[i + 1] === '\n') i++;
      continue;
    }

    // A `;`/`&`/`|` on the operator line ends the consuming command: finalize
    // the operator so the delimiter is extracted from THIS segment, and the
    // following text starts a clean new segment (`cat << EOF; rm -rf /`
    // still blocks the real rm command that follows — the body never opens
    // after the command was closed).
    if (char === '&' && PREPARED[i + 1] === '&') {
      finalizeHeredocOperator();
      parts.push(current);
      current = '';
      i++;
      continue;
    }

    if (char === '|' && PREPARED[i + 1] === '|') {
      finalizeHeredocOperator();
      parts.push(current);
      current = '';
      i++;
      continue;
    }

    if (char === ';' || char === '&' || char === '|') {
      finalizeHeredocOperator();
      parts.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  // Unterminated heredoc at end of input: attach whatever body accumulated —
  // `bash <<EOF` + `rm -rf /` with a missing delimiter line still executes,
  // so the body must stay visible to the predicate machinery. A merely
  // pending operator (no body yet) is just stripped.
  finalizeHeredocOperator();
  if (inHeredocBody && heredocDelimiter !== null) {
    current += ` "${heredocBody.replaceAll('"', '\\"')}"`;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
};

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
const decodeAnsiCQuoted = (raw: string, start: number): { end: number; value: string } => {
  let value = '';
  let i = start;
  const readDigits = (pattern: RegExp, max: number): string => {
    let digits = '';
    while (digits.length < max && i < raw.length && pattern.test(raw[i])) digits += raw[i++];
    return digits;
  };
  while (i < raw.length) {
    const char = raw[i];
    if (char === "'") return { end: i + 1, value };
    if (char !== '\\' || i + 1 >= raw.length) {
      value += char;
      i++;
      continue;
    }
    const next = raw[i + 1];
    i += 2;
    if (next in ANSI_C_SIMPLE_ESCAPES) {
      value += ANSI_C_SIMPLE_ESCAPES[next];
    } else if (next === 'x') {
      const hex = readDigits(/[\da-f]/i, 2);
      value += hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : '\\x';
    } else if (next === 'u' || next === 'U') {
      const hex = readDigits(/[\da-f]/i, next === 'u' ? 4 : 8);
      const codePoint = hex ? Number.parseInt(hex, 16) : Number.NaN;
      value += codePoint <= 0x10_ffff ? String.fromCodePoint(codePoint) : `\\${next}${hex}`;
    } else if (/[0-7]/.test(next)) {
      i--;
      const octal = readDigits(/[0-7]/, 3);
      value += String.fromCodePoint(Number.parseInt(octal, 8) & 0xff);
    } else if (next === 'c' && i < raw.length) {
      value += String.fromCodePoint(raw[i++].toUpperCase().charCodeAt(0) ^ 0x40);
    } else {
      // Unknown escape: bash keeps the backslash.
      value += `\\${next}`;
    }
  }
  return { end: i, value };
};

/**
 * Tokenize a segment into words, honoring quotes and keeping quoted content
 * as single words (quote markers removed). Redirections are removed here.
 */
const tokenizeWords = (raw: string): string[] => {
  const words: string[] = [];
  let word = '';
  let quote: '"' | "'" | null = null;
  let hasWord = false;
  let inSubstitution = 0;
  let inBrace = 0;
  let inBacktick = false;

  const flush = () => {
    if (hasWord) words.push(word);
    word = '';
    hasWord = false;
  };

  const isRedirectAt = (index: number): boolean => {
    // A redirection starts with optional fd digits then < or >
    let j = index;
    while (j < raw.length && /\d/.test(raw[j])) j++;
    const op = raw[j];
    return op === '<' || op === '>';
  };

  let i = 0;
  while (i < raw.length) {
    const char = raw[i];

    if (quote) {
      // Escape handling inside double quotes: consume backslash + escaped char
      if (quote === '"' && char === '\\' && i + 1 < raw.length) {
        const next = raw[i + 1];
        if (next === '\n' || next === '\r') {
          // Line continuation inside double quotes: both characters vanish.
          i += 2;
          continue;
        }
        // Bash double-quote rule: the backslash only escapes `$`, backtick,
        // `"` and `\` (handled above for newline). Before any other character
        // it is a LITERAL backslash — `rm -rf "\/"` passes the two-character
        // operand `\/`, not the filesystem root. Dropping the backslash here
        // turned it into `//` and falsely matched the root predicate.
        word += next === '$' || next === '`' || next === '"' || next === '\\' ? next : char + next;
        hasWord = true;
        i += 2;
        continue;
      }
      // Closing quote: leave quote mode WITHOUT appending the quote marker
      if (char === quote) {
        quote = null;
        i++;
        continue;
      }
      word += char;
      hasWord = true;
      i++;
      continue;
    }

    if (char === '\\' && i + 1 < raw.length) {
      const escaped = raw[i + 1];
      // Backslash-newline is a line continuation: the shell removes it, so
      // argv keeps the surrounding words as-is (`rm -rf \\<newline>/` → '/').
      if (escaped === '\n' || escaped === '\r') {
        i += 2;
        continue;
      }
      // POSIX unquoted backslash escape: the next character is LITERAL (`\/`
      // passes `/` as the target; `\rm` invokes rm). Consume the escape so the
      // safe surface (argv) is what security matching sees.
      word += escaped;
      hasWord = true;
      i += 2;
      continue;
    }

    // ANSI-C quoting $'…': the shell decodes the backslash escapes BEFORE
    // exec, so `$'\x72m' -rf /` runs rm and `rm -rf $'\x2f'` deletes root.
    // Decode the payload here so matching sees the real argv.
    if (char === '$' && raw[i + 1] === "'") {
      const { end, value } = decodeAnsiCQuoted(raw, i + 2);
      word += value;
      hasWord = true;
      i = end;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasWord = true;
      i++;
      continue;
    }

    if (char === '`') {
      inBacktick = !inBacktick;
      word += char;
      hasWord = true;
      i++;
      continue;
    }

    if (!inSubstitution && !inBacktick && char === '$' && raw[i + 1] === '(') {
      inSubstitution = 1;
      word += '$(';
      hasWord = true;
      i += 2;
      continue;
    }

    // Parameter expansion `${…}` is ONE word at parse time: whitespace inside
    // it (`${X:-rm -rf /}`) does not split until expansion. Keep the whole
    // expansion together so its operand can be analyzed as a payload instead
    // of leaking as fragments (`/}` is not a root target).
    if (!inSubstitution && !inBacktick && !inBrace && char === '$' && raw[i + 1] === '{') {
      inBrace = 1;
      word += '${';
      hasWord = true;
      i += 2;
      continue;
    }

    if (inBrace) {
      if (char === '{') inBrace++;
      if (char === '}') inBrace--;
      word += char;
      hasWord = true;
      i++;
      continue;
    }

    if (inSubstitution) {
      if (char === '(') inSubstitution++;
      if (char === ')') inSubstitution--;
      // On ')' the substitution closes but the word continues.
      word += char;
      hasWord = true;
      i++;
      continue;
    }

    if (inBacktick) {
      word += char;
      hasWord = true;
      i++;
      continue;
    }

    if (/\s/.test(char)) {
      flush();
      i++;
      continue;
    }

    if (isRedirectAt(i)) {
      // Skip the redirection operator (and any fd digits before it).
      flush();
      let j = i;
      while (j < raw.length && /\d/.test(raw[j])) j++;
      const op = raw[j];
      if (op !== '<' && op !== '>') {
        // Should not happen (isRedirectAt guarantees), but never stall: eat one char.
        i++;
        continue;
      }
      // '>>' counts as two operator chars; '<<' (heredoc) has no target to skip.
      if (raw[j + 1] === op) {
        j += 2;
      } else {
        j += 1;
      }
      // Skip the redirection target token (next word), if any.
      while (j < raw.length && /\s/.test(raw[j])) j++;
      while (j < raw.length && !/\s/.test(raw[j])) j++;
      // Advance at least past the operator to guarantee progress.
      i = Math.max(j, i + 1);
      continue;
    }

    word += char;
    hasWord = true;
    i++;
  }

  flush();
  return words;
};

const isHomePath = (word: string): boolean =>
  word === '~' ||
  word.startsWith('~/') ||
  word === '$HOME' ||
  word.startsWith('$HOME/') ||
  /^\/(?:Users|home)\/[^/]+/.test(word);

const isDashWord = (word: string): boolean => word.startsWith('-') && word.length > 1;

const isBareSlash = (word: string): boolean => word === '/';

/**
 * Parse flags: every isolated dash-word is a flag entry. Combined short flags
 * like -rf expand at query time.
 */
const collectFlags = (words: string[]): string[] => words.filter(isDashWord);

/**
 * Collect all long-flag names (e.g. 'recursive' from --recursive / --recursive=yes)
 * and all single-letter flags from short-flag words (e.g. r, f from -rf).
 */
export const collectFlagLettersAndNames = (
  flags: string[],
): { letters: Set<string>; names: Set<string> } => {
  const letters = new Set<string>();
  const names = new Set<string>();
  for (const flag of flags) {
    // Long flag: --name or --name=value → register both the name and, for
    // security conservatism, its first letter (rm -R / -r alias semantic).
    const longMatch = /^--([^=]+)(?:=.*)?$/.exec(flag);
    if (longMatch) {
      names.add(longMatch[1]);
      letters.add(longMatch[1][0]);
      continue;
    }
    // Combined short flags: -rf → r, f
    const shortMatch = /^-([A-Z0-9]+)$/i.exec(flag);
    if (shortMatch) {
      for (const letter of shortMatch[1]) letters.add(letter);
      continue;
    }
    // Negative number like -1 or lone '-' → not a flag
  }
  return { letters, names };
};

/**
 * Security-first wrapper option model: a single-letter wrapper flag is
 * presumed to CONSUME the next word unless it is whitelisted here as
 * value-free. The whitelist direction matters: a missed value-free flag only
 * over-skips one harmless token (over-detection), whereas a missed
 * value-taking flag resolves the wrapper's VALUE as the command and lets a
 * real `rm -rf /` slip through (under-detection) — e.g. `sudo -p x rm -rf /`
 * previously resolved to command "x:".
 *
 * Flags not valid for a wrapper (typo/foreign) also consume a value under
 * this model — acceptable: unknown-flag invocations fail at exec time anyway,
 * and erring toward over-detection is the safe direction for a blacklist.
 */
const WRAPPER_VALUE_FREE_FLAGS: Record<string, ReadonlySet<string>> = {
  // GNU sudo value-free flags only (verified against sudo 1.9 --help):
  // -A askpass, -B beep, -b badge, -e edit, -H set HOME, -h help,
  // -i login, -k kill ticket, -K kill all, -l list, -n non-interactive,
  // -s shell, -v validate. Value-taking (deliberately NOT whitelisted):
  // -p prompt, -u user, -g group, -C fd, -R chroot, -r role, -t type,
  // -T timeout, -D cwd.
  sudo: new Set(['A', 'B', 'b', 'e', 'H', 'h', 'i', 'k', 'K', 'l', 'n', 's', 'v']),
  // util-linux runuser value-free flags: --login/-l implied shell (no arg in
  // the exec form), -c is command-taking like su. The `-u USER` user flag and
  // the `--` end-of-options marker are consumed as value words below; the
  // command after `--` resolves as the real executable.
  runuser: new Set(['l']),
  // GNU env value-free flags: -i ignore-env, -0 null-sep, -v verbose.
  // Value-taking: -u unset NAME, -S split-string (its value IS a command —
  // consumed as a value word, which hides it; covered by the predicate-level
  // ambiguity fallback in semanticShellPredicates.ts).
  env: new Set(['i', '0', 'v']),
  nohup: new Set(),
  // bash command builtin: -p default PATH, -v/-V describe.
  command: new Set(['p', 'v', 'V']),
  // GNU xargs value-free flags: -0/--null NUL-separated input, -r/--no-run-if-empty,
  // -a FILE (value!), -E EOF-str, -I replstr, -L lines, -n max-args, -P procs,
  // -s size, -d delim — all value-taking besides -0/-r. Note the -0 form: an
  // unwhitelisted `-0` would swallow the wrapped command (`xargs -0 rm -rf /
  // harmless` resolved the harmless word as the command).
  xargs: new Set(['0', 'r']),
};

/**
 * Exec-prefix commands that run their first non-flag argument as a program.
 * Unwrapped so `exec rm -rf /`, `xargs rm -rf /`, `timeout 30 rm -rf /`,
 * `nice rm -rf /` … resolve to the real command. (The old substring regex
 * blocked these shapes incidentally; semantic matching must unwrap them
 * explicitly or coverage narrows.)
 */
const EXEC_PREFIX_WRAPPERS = new Set([
  'sudo', // superuser exec
  'runuser', // util-linux run-as-user exec (runuser -u u -- cmd)
  'env', // env VAR=… cmd
  'nohup', // hangup-immune exec
  'command', // bash builtin: bypass aliases/functions
  'builtin', // bash builtin: run the named shell builtin (`builtin command rm -rf /`)
  'exec', // bash builtin: replace the shell with the command
  'xargs', // stdin-driven invocation: `find … | xargs rm …`
  'time', // bash keyword + binary: runs the command
  'nice', // runs the command with niceness
  'setsid', // runs the command in a new session
  'ionice', // runs the command with I/O niceness
  'stdbuf', // runs the command with adjusted stdio buffering
  'timeout', // runs the command with a time limit (first arg = duration value)
  'flock', // runs the command holding a lock (first arg = lockfile value)
  'strace', // traces execution by running the command
  'ltrace', // traces execution by running the command
  'chroot', // runs the command with NEWROOT as '/': `chroot /mnt rm -rf /`
]);

/**
 * Exec-prefix wrappers whose FIRST POSITIONAL argument is a value (not the
 * wrapped command): `timeout 30 rm …`, `flock /tmp/lock rm …`. The unwrap
 * loop consumes that many bare words after the wrapper before treating the
 * next bare word as the command. Flags and assignments are always skipped.
 */
const WRAPPER_POSITIONAL_VALUES: Record<string, number> = {
  timeout: 1, // DURATION
  flock: 1, // LOCKFILE (when not -n form with command only)
  chroot: 1, // NEWROOT (GNU chroot has no short value-free flags; its options are long-only)
  nice: 0, // nice -N cmd handled by flag model; bare `nice cmd` has none
  time: 0,
};

/**
 * Unwrap exec-prefix wrappers (sudo/env/nohup/command/exec/xargs/timeout/…)
 * plus leading VAR=value assignments and reveal the real command word.
 *
 * Option model is security-first: a single-letter flag is presumed to
 * consume the next word unless whitelisted value-free (see
 * WRAPPER_VALUE_FREE_FLAGS); long flags are presumed value-free unless they
 * embed `=value`. A bare word after a value-consuming flag is that flag's
 * value, not the command.
 */
const resolveCommandWord = (words: string[]): string | null => {
  let index = 0;
  // Skip leading assignments (FOO=bar)
  while (index < words.length) {
    const word = words[index];
    if (ASSIGNMENT_PATTERN.test(word) && !word.startsWith('-') && !word.startsWith('/')) {
      // An assignment whose "value" is empty and looks like `FOO=bar cmd` is a prefix.
      index++;
      continue;
    }
    break;
  }

  // `!` is the shell negation keyword: `! rm -rf ~` still RUNS the deletion
  // (only its exit status is inverted). It is syntax, not an executable —
  // skip it like any other exec prefix.
  if (words[index] === '!') index++;

  // Reserved words (`if true; then rm -rf /; fi`, `while …; do …; done`)
  // introduce a command whose first follower executes. Skipping only the
  // reserved word itself keeps the REAL first command resolvable; the body's
  // later segments were already split by `;` and resolve on their own.
  // Unwrap exec-prefix wrappers and skip shell compound-command syntax. The
  // loop naturally terminates: `index` strictly increases every iteration or
  // the loop breaks. No artificial counter — pathologically chained wrappers
  // still resolve fully.
  while (index < words.length) {
    index = skipShellSyntax(words, index);
    if (index >= words.length) break;
    const word = words[index];
    // Path-qualified wrappers execute identically to bare ones
    // (/usr/bin/sudo rm …). Normalize to basename before lookup.
    const base = commandBasename(word);
    // BusyBox launcher: `busybox <applet> args` executes the applet
    // (busybox rm -rf / deletes). The applet is the real command — unwrap
    // one level by skipping the launcher word.
    if (base === 'busybox') {
      index++;
      continue;
    }
    if (!EXEC_PREFIX_WRAPPERS.has(base)) break;
    const valueFreeFlags = WRAPPER_VALUE_FREE_FLAGS[base];
    index++;
    // Consume wrapper-owned positional values first (timeout DURATION, flock
    // LOCKFILE): bare words that are NOT the wrapped command.
    let positional = WRAPPER_POSITIONAL_VALUES[commandBasename(word)] ?? 0;
    // Skip wrapper-owned tokens: assignments after `env`, wrapper flags, and
    // the value word of any flag presumed to consume one (security-first
    // default, see WRAPPER_VALUE_FREE_FLAGS).
    while (index < words.length) {
      const token = words[index];
      if (ASSIGNMENT_PATTERN.test(token)) {
        index++;
        continue;
      }
      if (isDashWord(token)) {
        // `--flag=value` / `-u=value` embed the value: consume nothing extra.
        if (token.includes('=')) {
          index++;
          continue;
        }
        // `-abc` / `-0` combined short flags: consumes a value unless EVERY
        // letter/digit is whitelisted value-free. Unknown/foreign flags
        // consume — the safe direction for a blacklist (over-detection).
        const letters = /^-([a-z0-9]+)$/i.exec(token);
        const consumesValue =
          letters === null || !letters[1].split('').every((letter) => valueFreeFlags?.has(letter));
        index += consumesValue ? 2 : 1;
        continue;
      }
      // Bare word: either a positional wrapper value (timeout 30) or the
      // wrapped command itself (the common case).
      if (positional > 0) {
        positional--;
        index++;
        continue;
      }
      break;
    }
    continue;
  }

  // A subshell opener can glue to the command word (`(rm -rf /)`): `(` is an
  // operator, not part of the executable name.
  const commandWord = words[index]?.replace(/^\(+/, '');
  if (!commandWord) return null;
  if (isDashWord(commandWord) || ASSIGNMENT_PATTERN.test(commandWord)) return null;
  // Stays null when the command word IS a substitution or a variable: the
  // real executable is unknowable at parse time, and resolving the literal
  // text as a confident command would let the ambiguity fallback skip the
  // segment.
  if (isUnresolvableCommandWord(commandWord)) return null;
  // Normalize path-qualified executables to their basename so predicates can
  // compare on the bare command name: /bin/rm → rm, ./script.sh → script.sh,
  // /usr/bin/env → env. Bare `/` (root target) has no basename and stays.
  return commandBasename(commandWord);
};

/**
 * Analyze a shell command string into semantic segments.
 */
export const analyzeShellCommand = (command: string): ShellSegment[] => {
  if (typeof command !== 'string' || command.trim().length === 0) return [];

  const rawSegments = splitIntoRawSegments(command);
  return rawSegments.map((rawSegment) => {
    const words = tokenizeWords(rawSegment);

    // Words eligible for command resolution: everything before the first
    // non-flag, non-argument word matters; we keep it simple: resolution uses
    // the full word list.
    const resolvedCommand = resolveCommandWord(words);
    // Flags belong to the RESOLVED command's argv: collecting dash-words from
    // the whole segment would attribute wrapper options to the wrapped
    // command (`xargs -r rm /` — -r is xargs' no-run-if-empty, not an rm
    // flag; `sudo -r sysadm_r rm /` — same for sudo's role option) and make
    // the rm predicates fire on flag-less rm calls. When the command slot
    // resolved, slice from its raw word; otherwise keep the legacy
    // whole-segment view for the ambiguity fallback (which does not rely on
    // precise flag attribution).
    const commandIndex = resolvedCommand
      ? words.findIndex((word) => word === resolvedCommand || word.endsWith(`/${resolvedCommand}`))
      : -1;
    const flags = collectFlags(commandIndex >= 0 ? words.slice(commandIndex) : words);
    const argWords = commandIndex >= 0 ? words.slice(commandIndex + 1) : [];
    const trailingSlashTargets = argWords.filter(
      (word) => !isDashWord(word) && (word.endsWith('/') || isBareSlash(word)),
    );
    const homeTargets = argWords.filter((word) => !isDashWord(word) && isHomePath(word));

    const { letters, names } = collectFlagLettersAndNames(flags);

    return {
      raw: rawSegment,
      words,
      resolvedCommand,
      flags,
      trailingSlashTargets,
      homeTargets,
      hasFlag: (letter: string) => letters.has(letter) || names.has(letter),
      hasLongFlag: (name: string) => names.has(name),
    };
  });
};
