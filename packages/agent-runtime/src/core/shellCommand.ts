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

import {
  decodeAnsiCQuoted,
  skipShellSyntax,
  stripGroupingParens,
  stripLeadingGroupingParens,
} from './shellQuoting';

/**
 * Characters that terminate an unquoted shell WORD. A heredoc delimiter is a
 * single word, so an operator that follows it without whitespace
 * (`<<EOF>/dev/null`) starts the next token instead of extending the
 * delimiter.
 */
const SHELL_WORD_METACHARACTERS = ['|', '&', ';', '<', '>', '(', ')'];

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
   * Words after stripping redirections, respecting quotes, with brace
   * alternatives expanded the way Bash expands them before exec — these are
   * the words the shell would present as argv.
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
 * Whether the character at `index` is escaped by an ODD run of backslashes.
 * Looking only at the immediately preceding character treated `\\$'…'` as
 * escaped, although the two backslashes form ONE literal backslash and `$`
 * still opens an ANSI-C quote — bash then ran the deletion after the
 * separator while every predicate read the whole line as one `echo` word.
 */
const isEscapedAt = (text: string, index: number): boolean => {
  let backslashes = 0;
  for (let k = index - 1; k >= 0 && text[k] === '\\'; k--) backslashes++;
  return backslashes % 2 === 1;
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
  // `$'…'` (ANSI-C) quoting: escapes are live, so the quote is only closed by
  // an UNESCAPED apostrophe. Plain `'…'` keeps every backslash literal.
  let inAnsiCQuote = false;
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
  let heredocStripTabs = false; // `<<-`: the terminator line may be tab-indented
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
  // escape. The delimiter is ONE shell word: a redirection that follows the
  // operator on the same line (`cat <<EOF >/dev/null`) is declaration-line
  // syntax, not part of the delimiter. Folding it in (`EOF >/dev/null`) means
  // the real terminator line never matches, the heredoc never closes, and the
  // commands after it (`rm -rf ~`) are swallowed as stdin data — invisible to
  // every predicate.
  const finalizeHeredocOperator = () => {
    if (!heredocPending) return;
    heredocPending = false;
    const marker = current.lastIndexOf('<<');
    if (marker < 0) return;
    let rest = current.slice(marker + 2);
    // `<<-` allows the body and terminator to be tab-indented.
    heredocStripTabs = false;
    if (rest.trimStart().startsWith('-')) {
      heredocStripTabs = true;
      rest = rest.trimStart().slice(1);
    }
    rest = rest.replace(/^[ \t]+/, '');
    // Read exactly one shell word (quote- and backslash-aware) so the rest of
    // the declaration line — redirections such as `>/dev/null` — stays in the
    // segment instead of being folded into the delimiter.
    let word = '';
    let wordQuote: '"' | "'" | null = null;
    let k = 0;
    while (k < rest.length) {
      const ch = rest[k];
      if (wordQuote) {
        if (ch === wordQuote) {
          wordQuote = null;
          k++;
          continue;
        }
        // Shell quote removal inside double quotes: a backslash escapes only
        // `$`, `` ` ``, `"`, `\` and a newline; before anything else it stays
        // literal. Reading both declaration backslashes verbatim made the
        // delimiter `E\\OF`, so the real terminator `E\OF` never matched and
        // the home deletion below the heredoc was swallowed as `cat` data.
        if (wordQuote === '"' && ch === '\\' && k + 1 < rest.length) {
          const escaped = rest[k + 1];
          if (escaped === '\n') {
            k += 2;
            continue;
          }
          if (escaped === '$' || escaped === '`' || escaped === '"' || escaped === '\\') {
            word += escaped;
            k += 2;
            continue;
          }
        }
        word += ch;
        k++;
        continue;
      }
      // Locale-translation quoting `$"…"` is a QUOTED word too: bash removes
      // the `$`, translates the string, then treats it as double-quoted, so
      // `<<$"EOF"` terminates at `EOF`. Keeping the `$` made the delimiter
      // `$EOF`, the real terminator line never matched, and the `rm -rf ~` below
      // the heredoc was read as `cat` stdin data.
      if (ch === '$' && rest[k + 1] === '"') {
        wordQuote = '"';
        k += 2;
        continue;
      }
      // ANSI-C quoting `$'…'` is still a QUOTED word: bash decodes the
      // escapes and removes the `$` and quotes before the word becomes the
      // terminator, so `<<$'EOF'` terminates at `EOF`. Keeping the `$` made
      // the delimiter `$EOF`, the real terminator line never matched, and the
      // `rm -rf ~` below the heredoc was read as `cat` stdin data.
      if (ch === '$' && rest[k + 1] === "'") {
        const decoded = decodeAnsiCQuoted(rest, k + 2);
        word += decoded.value;
        k = decoded.end;
        continue;
      }
      if (ch === '"' || ch === "'") {
        wordQuote = ch;
        k++;
        continue;
      }
      if (ch === '\\' && k + 1 < rest.length) {
        word += rest[k + 1];
        k += 2;
        continue;
      }
      // The delimiter is ONE shell WORD, so it ends at the shell's word
      // delimiters — whitespace AND unquoted metacharacters. `EOF>/dev/null`
      // (no space) folded the redirection into the delimiter, so the real
      // terminator line never matched, the heredoc never closed, and the
      // `rm -rf ~` after it was swallowed as stdin data.
      if (/[ \t\n\r]/.test(ch) || SHELL_WORD_METACHARACTERS.includes(ch)) break;
      word += ch;
      k++;
    }
    current = current.slice(0, marker) + rest.slice(k);
    heredocDelimiter = word.length > 0 ? word : null;
  };

  for (let i = 0; i < PREPARED.length; i++) {
    const char = PREPARED[i];

    if (inHeredocBody && heredocDelimiter !== null) {
      // Heredoc body: accumulate lines until the delimiter line. The body is
      // appended to the consuming segment as one double-quoted word — never
      // split into command segments.
      const lineEnd = PREPARED.indexOf('\n', i);
      const raw = PREPARED.slice(i, lineEnd === -1 ? PREPARED.length : lineEnd).replace(/\r$/, '');
      // `<<-` strips leading tabs from the terminator line before matching.
      const line = heredocStripTabs ? raw.replace(/^\t+/, '') : raw;
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
      // ANSI-C quoting keeps backslash escapes live: `\'` is a literal
      // apostrophe, never the closing quote. Consume the pair so the quote
      // state survives the escape instead of ending the segment early.
      if (inAnsiCQuote) {
        if (char === '\\' && i + 1 < PREPARED.length) {
          current += PREPARED[i + 1];
          i++;
          continue;
        }
        if (char === "'") {
          quote = null;
          inAnsiCQuote = false;
        }
        continue;
      }
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

    // Any other backslash outside quotes escapes the NEXT character: `\"` is a
    // literal double quote and `\;` a literal semicolon, so neither quote nor
    // operator state may be entered here. Without this, `echo \"; rm -rf ~`
    // opens a phantom double-quoted region at the escaped quote, the real `rm`
    // command is absorbed into the `echo` segment, and every predicate misses
    // it. Consume the pair so the escaped character is never reinterpreted.
    if (char === '\\' && i + 1 < PREPARED.length) {
      current += char + PREPARED[i + 1];
      i++;
      continue;
    }

    // A `#` that STARTS A WORD opens a shell comment: the rest of the line is
    // inert text, so quotes and operators inside it are not syntax. Reading
    // them as syntax let an apostrophe in prose (`# Clean up the user's
    // files`) open a phantom single-quoted region that swallowed the following
    // newline and the real command — `# Clean up the user's files\nrm -rf ~`
    // then resolved to command `#`, and every predicate missed the deletion
    // that bash executes. Skip to the line end WITHOUT consuming the newline so
    // it still separates segments. `#` inside a word (`foo#bar`), inside
    // `${#var}` (preceded by `{`) and inside legacy backtick substitution stay
    // literal. A separator that was ESCAPED does not start a new word: in
    // `echo foo\ #; rm -rf ~` the space belongs to the word, so `#` is a
    // literal argument character and the deletion after `;` still runs.
    // Reading the escaped separator as a word boundary opened a phantom
    // comment that swallowed the `rm`, and every predicate missed it.
    if (
      char === '#' &&
      !inBacktick &&
      (i === 0 ||
        (/[\s;|&(`]/.test(PREPARED[i - 1] ?? '') && !isEscapedAt(PREPARED, i - 1)))
    ) {
      const commentEnd = PREPARED.indexOf('\n', i);
      i = commentEnd === -1 ? PREPARED.length : commentEnd - 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      // `$'\''` is ANSI-C quoting: backslash escapes are LIVE inside it, so
      // an escaped apostrophe does not close the quote. Treating `\''` as the
      // terminator reopened a phantom quote that swallowed the following
      // separator — `echo $'\''; rm -rf ~` then resolved to `echo` and the
      // deletion reached no predicate.
      inAnsiCQuote = char === "'" && PREPARED[i - 1] === '$' && !isEscapedAt(PREPARED, i - 1);
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

    // `>&` / `&>` are redirection operators, not control operators. Treating
    // the `&` in `2>&1` as a separator splits a leading descriptor
    // duplication into the bogus commands `2>` and `1 rm -rf ~`, which
    // resolves as command `1` and lets the recursive home deletion through
    // every semantic predicate. Redirections are recognized BEFORE control
    // operators, matching how the shell parses the line.
    // Descriptor duplication applies to BOTH directions: `>&` (output) and
    // `<&` (input, e.g. `0<&0 rm -rf ~`). Recognizing only `>&` split the
    // input form into `0<` and `0 rm -rf ~`, whose resolved command was `0`.
    const previousChar = current.at(-1) ?? '';
    if (char === '&' && (previousChar === '>' || previousChar === '<' || PREPARED[i + 1] === '>')) {
      current += char;
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
  // A redirection target is one shell word, so it has to be read through the
  // same quote/escape machinery as every other word: in `>"/tmp/a b" rm -rf ~`
  // a naive scan stops inside the filename and the trailing quote then swallows
  // `rm -rf ~` into an unrelated word, hiding the real command.
  let discardNextWord = false;

  const flush = () => {
    if (discardNextWord) {
      // The first word after a redirection operator is its target, not argv.
      // Whitespace before it must not clear the pending discard.
      if (hasWord) discardNextWord = false;
    } else if (hasWord) {
      words.push(word);
    }
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

    // `&>` / `&>>` redirect both streams at once: an operator, never argv.
    // Without this the `&` becomes a word and the command after the
    // redirection (`&>/dev/null rm -rf ~`) is discarded as its target.
    if (char === '&' && raw[i + 1] === '>') {
      flush();
      i += 2;
      discardNextWord = true;
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
      // Read the target with the normal word scanner and drop it in flush(), so
      // quoting (`>"/tmp/a b"`, `>'a b'`, `>a\ b`) cannot leak into argv.
      discardNextWord = true;
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

/**
 * Grouping parentheses are shell OPERATORS, not part of the word they sit
 * beside: the segment text `(rm -rf ~)` tokenizes as `(rm` / `-rf` / `~)`,
 * because the tokenizer only splits on command separators. Strip the operator
 * runs before classifying an operand — otherwise a subshell-wrapped home
 * target stays `~)` and every predicate misses the real deletion.
 */
/** Leading subshell openers only: the trailing `)` still belongs to compound
 * syntax (`f()`, `case a)`), so it is not stripped here. */

const isHomePath = (word: string): boolean => {
  const operand = stripGroupingParens(word);
  return (
    operand === '~' ||
    operand.startsWith('~/') ||
    operand === '$HOME' ||
    operand.startsWith('$HOME/') ||
    /^\/(?:Users|home)\/[^/]+/.test(operand)
  );
};

const isDashWord = (word: string): boolean => word.startsWith('-') && word.length > 1;

const isBareSlash = (word: string): boolean => word === '/';

/**
 * Parse flags: every isolated dash-word is a flag entry. Combined short flags
 * like -rf expand at query time.
 */
const collectFlags = (words: string[]): string[] => words.filter(isDashWord);

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
const expandBraceAlternatives = (word: string, depth = 0): string[] => {
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
 * Wrapper short flags that TAKE a value (`env -uNAME`, `sudo -p prompt`).
 * Only used to tell an ATTACHED value (`-uFOO`: the rest of the token is the
 * argument, so the next word is the command) from a foreign cluster (`-rf`
 * arriving after a swallowed command). A letter absent here is not known to
 * take a value, so the security-first "consume the next word" default stays.
 */
const WRAPPER_VALUE_SHORT_FLAGS: Record<string, ReadonlySet<string>> = {
  env: new Set(['u', 'C', 'S']),
  sudo: new Set(['p', 'u', 'g', 'C', 'R', 'r', 't', 'T', 'D']),
  xargs: new Set(['a', 'E', 'I', 'L', 'n', 'P', 's', 'd']),
  runuser: new Set(['u', 'g', 'c']),
  timeout: new Set(['k', 's']),
  nice: new Set(['n']),
  stdbuf: new Set(['i', 'o', 'e']),
  ionice: new Set(['c', 'n', 'p']),
  flock: new Set(['w', 'E']),
};

/**
 * Wrapper-owned LONG options, split by arity. The single-letter model above
 * cannot answer the question for `--long` names, and guessing is not safe in
 * either direction: assuming "value-free" resolves the option's VALUE as the
 * command (`sudo --user root rm -rf ~` → "root"), while assuming
 * "value-taking" eats the wrapped command (`env --ignore-environment rm -rf
 * /tmp/cache ~` → `-rf` ate `/tmp/cache` and left `~` as a confidently
 * unrelated executable, so every predicate returned false while bash deleted
 * the home dir). Both shapes are listed explicitly per wrapper below; a long
 * option with unknown arity makes resolution report ambiguity instead.
 */
const WRAPPER_VALUE_FREE_LONG_FLAGS: Record<string, ReadonlySet<string>> = {
  // GNU coreutils env: -i/-0/-v and the optional-argument signal switches
  // (`--default-signal[=SIG]`) take no separate word.
  env: new Set([
    '--ignore-environment',
    '--null',
    '--debug',
    '--list-signal-handling',
    '--default-signal',
    '--ignore-signal',
    '--block-signal',
  ]),
  // sudo 1.9 value-free long forms (mirrors the short whitelist above).
  sudo: new Set([
    '--askpass',
    '--background',
    '--bell',
    '--edit',
    '--set-home',
    '--login',
    '--remove-timestamp',
    '--reset-timestamp',
    '--list',
    '--non-interactive',
    '--preserve-env',
    '--shell',
    '--stdin',
    '--validate',
  ]),
  // GNU xargs: switches without a value word, including the OPTIONAL-argument
  // forms (`--replace[=R]`, `--eof[=END]`): getopt_long only accepts an
  // optional argument attached with `=`, so the bare form takes no value word
  // and `xargs --replace rm -rf ~` runs rm.
  xargs: new Set([
    '--null',
    '--no-run-if-empty',
    '--verbose',
    '--interactive',
    '--exit',
    '--open-tty',
    '--replace',
    '--eof',
  ]),
};

/**
 * `runuser` is deliberately absent from both tables: `runuser --login nobody
 * rm -rf /` takes the USER as a positional, so no listed arity describes it —
 * unknown-arity → ambiguity keeps the segment blockable.
 *
 * Wrapper LONG options that consume the NEXT WORD as their value. GNU
 * getopt_long accepts the space-separated form for required arguments, so
 * `--user root` and `--user=root` are both valid and both must consume.
 */
const WRAPPER_VALUE_LONG_FLAGS: Record<string, ReadonlySet<string>> = {
  env: new Set(['--unset', '--chdir', '--split-string']),
  sudo: new Set([
    '--prompt',
    '--user',
    '--group',
    '--close-from',
    '--chroot',
    '--role',
    '--type',
    '--command-timeout',
    '--chdir',
    '--other-user',
  ]),
  xargs: new Set([
    '--arg-file',
    '--delimiter',
    '--max-lines',
    '--max-args',
    '--max-procs',
    '--max-chars',
  ]),
};

/** Long options that never run a command, so their arity cannot hide one. */
const GLOBAL_VALUE_FREE_LONG_FLAGS = new Set(['--help', '--version']);

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
 * WRAPPER_VALUE_FREE_FLAGS); a long flag's arity comes from its own
 * per-wrapper table (WRAPPER_VALUE_FREE_LONG_FLAGS / WRAPPER_VALUE_LONG_FLAGS),
 * and an unlisted long flag yields an ambiguous resolution rather than a
 * confident guess. A bare word after a value-consuming flag is that flag's
 * value, not the command.
 */
/**
 * Resolved command word plus the token index it came from. The index is
 * carried through resolution because the normalized name cannot be found
 * again by exact-word match (`(rm` resolves to `rm`).
 */
const resolveCommandWord = (words: string[]): { index: number; name: string } | null => {
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
    // `(` is an operator glued onto the first word (`(command rm -rf ~)`), not
    // part of the executable name: strip it before the wrapper lookup, or
    // `(command` misses the builtin and resolution returns `command`.
    const word = stripLeadingGroupingParens(words[index]);
    // `!` is reserved negation syntax, not a command: `(! rm -rf ~)` and
    // `if ! rm -rf ~` both execute `rm`. Resolving the negation made the
    // segment look like an unrelated confident command (`!`), so every
    // predicate returned false while the delete still ran. Skip it like any
    // other shell operator and keep looking for the real command word.
    if (word === '!') {
      index++;
      continue;
    }
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
    const valueFreeLongFlags = WRAPPER_VALUE_FREE_LONG_FLAGS[base];
    const valueTakingShortFlags = WRAPPER_VALUE_SHORT_FLAGS[base];
    const valueTakingLongFlags = WRAPPER_VALUE_LONG_FLAGS[base];
    index++;
    // Consume wrapper-owned positional values first (timeout DURATION, flock
    // LOCKFILE): bare words that are NOT the wrapped command.
    let positional = WRAPPER_POSITIONAL_VALUES[base] ?? 0;
    // Skip wrapper-owned tokens: assignments after `env`, wrapper flags, and
    // the value word of any flag presumed to consume one (security-first
    // default, see WRAPPER_VALUE_FREE_FLAGS).
    // `--` is the end-of-options marker, not a value-taking flag: for
    // `env -- rm -rf /tmp/cache ~` GNU coreutils delimits the option list, so
    // `rm` is the wrapped command. Treating `--` as consuming a value ate
    // `rm`, then read `/tmp/cache` as the value of `-rf` and left `~` as a
    // confidently unrelated executable — every predicate returned false while
    // bash deleted the home directory.
    let optionsEnded = false;
    while (index < words.length) {
      const token = words[index];
      if (ASSIGNMENT_PATTERN.test(token)) {
        index++;
        continue;
      }
      if (!optionsEnded && token === '--') {
        optionsEnded = true;
        index++;
        continue;
      }
      if (!optionsEnded && isDashWord(token)) {
        // `--flag=value` / `-u=value` embed the value: consume nothing extra.
        if (token.includes('=')) {
          index++;
          continue;
        }
        // Long options have their own arity table; the single-letter regex
        // below cannot read them, and `--name` always failed it, so the
        // "unknown flags consume" default swallowed the wrapped command.
        if (token.startsWith('--')) {
          if (GLOBAL_VALUE_FREE_LONG_FLAGS.has(token) || valueFreeLongFlags?.has(token)) {
            index++;
            continue;
          }
          if (valueTakingLongFlags?.has(token)) {
            index += 2;
            continue;
          }
          // Unknown arity: the next word is either this option's value or the
          // wrapped command, and either guess hides a real rm invocation.
          // Report ambiguity and let the segment-level fallback judge it.
          return null;
        }
        // `-abc` / `-0` / `-uFOO` combined short flags. getopt reads letters
        // left to right and the FIRST value-taking letter decides the arity:
        // alone as the last letter it takes the NEXT word (`-u FOO`), and an
        // earlier one carries the REST of the token as its ATTACHED value
        // (`-uFOO`, `-C/tmp`). That remainder is an arbitrary string, not a
        // letter run: restricting the token to `[a-z0-9]` made
        // `env -uFOO_BAR rm -rf /tmp/cache ~` look like a foreign cluster, so
        // the loop swallowed `rm` and `~` became a confidently unrelated
        // executable.
        const shortFlag = /^-(.+)$/s.exec(token);
        if (shortFlag === null) {
          // Foreign/unknown short form: keep the security-first default and
          // assume the next word is its value.
          index += 2;
          continue;
        }
        const flagBody = shortFlag[1];
        const flagHead = flagBody[0];
        if (valueTakingShortFlags?.has(flagHead)) {
          // `-u` reads the next word; `-uFOO` / `-C/tmp` already carry it.
          index += flagBody.length === 1 ? 2 : 1;
          continue;
        }
        const lettersOfFlag = flagBody.split('');
        const valueAt = lettersOfFlag.findIndex((letter) => !valueFreeFlags?.has(letter));
        // Every letter whitelisted: a pure flag cluster (`env -i0`).
        if (valueAt === -1) {
          index++;
          continue;
        }
        // The head was value-free, so a later value-taking letter decides:
        // last position takes the NEXT word (`-nu ROOT`), an earlier one can
        // carry an ATTACHED value (`-nuROOT`) — but only for a letter this
        // wrapper is known to give a value to. A foreign cluster like `-rf`
        // (left over after a swallowed command) keeps the security-first
        // default and consumes the next word.
        const takesAttachedValue =
          valueAt !== lettersOfFlag.length - 1 &&
          valueTakingShortFlags?.has(lettersOfFlag[valueAt]) === true;
        index += takesAttachedValue ? 1 : 2;
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
  return { index, name: commandBasename(commandWord) };
};

/**
 * Analyze a shell command string into semantic segments.
 */
export const analyzeShellCommand = (command: string): ShellSegment[] => {
  if (typeof command !== 'string' || command.trim().length === 0) return [];

  const rawSegments = splitIntoRawSegments(command);
  return rawSegments.map((rawSegment) => {
    const tokens = tokenizeWords(rawSegment);

    // Bash brace-expands every word before it resolves argv, so the literal
    // token is NOT what runs: `{rm,echo} -rf ~` executes `rm echo -rf <home>`.
    // Expanding here — rather than only inside flag classification — puts the
    // generated words in the argv view the predicates read, so a brace group
    // in the command position cannot hide the real executable. Parameter
    // expansions (`${A:-x,y}`) are skipped: Bash does not brace-expand them.
    const words = tokens.flatMap((word) =>
      word.includes('${') ? [word] : expandBraceAlternatives(word),
    );

    // Words eligible for command resolution: everything before the first
    // non-flag, non-argument word matters; we keep it simple: resolution uses
    // the full word list.
    const resolved = resolveCommandWord(words);
    const resolvedCommand = resolved ? resolved.name : null;
    // Flags belong to the RESOLVED command's argv: collecting dash-words from
    // the whole segment would attribute wrapper options to the wrapped
    // command (`xargs -r rm /` — -r is xargs' no-run-if-empty, not an rm
    // flag; `sudo -r sysadm_r rm /` — same for sudo's role option) and make
    // the rm predicates fire on flag-less rm calls. When the command slot
    // resolved, slice from its raw word; otherwise keep the legacy
    // whole-segment view for the ambiguity fallback (which does not rely on
    // precise flag attribution).
    // The index comes from resolution, not from re-matching the normalized
    // name: `(rm -rf ~ )` resolves to `rm`, and an exact-word search for `rm`
    // missed the raw `(rm` token, leaving argv empty so every predicate read
    // the deletion as a bare subshell word.
    const commandIndex = resolved ? resolved.index : -1;
    const flags = collectFlags(commandIndex >= 0 ? words.slice(commandIndex) : words);
    const argWords = commandIndex >= 0 ? words.slice(commandIndex + 1) : [];
    const trailingSlashTargets = argWords.filter((word) => {
      const operand = stripGroupingParens(word);
      return !isDashWord(word) && (operand.endsWith('/') || isBareSlash(operand));
    });
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
