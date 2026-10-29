/**
 * Raw shell TEXT handling shared by the security analyzer: split a command
 * string into segments, then tokenize each segment into the words the shell
 * would present as argv.
 *
 * Kept separate from `shellCommand.ts` so the segment/predicate layer stays
 * readable: this module owns quoting, escapes, heredocs and command
 * substitutions; command RESOLUTION (wrappers, flags, target families) lives
 * in `shellCommand.ts`.
 */

import { decodeAnsiCQuoted } from './shellQuoting';

/**
 * Characters that terminate an unquoted shell WORD. A heredoc delimiter is a
 * single word, so an operator that follows it without whitespace
 * (`<<EOF>/dev/null`) starts the next token instead of extending the
 * delimiter.
 */
const SHELL_WORD_METACHARACTERS = ['|', '&', ';', '<', '>', '(', ')'];

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

/** A word that EXECUTES a command: `$(…)` and backtick substitutions. */
const EXECUTABLE_EXPANSION = /\$\(|`/;

/**
 * Marker for an expansion sigil that does NOT expand because single quotes (or
 * a backslash) suppress it. `'$(rm -rf ~)'` is literal text: without the marker
 * the quote-stripped word looks exactly like a real substitution and the
 * predicates block a harmless command. A sentinel (not a backslash) keeps the
 * escape parity of real words intact.
 */
export const LITERAL_EXPANSION_MARKER = '\u0001';

const isLiteralExpansionAt = (text: string, index: number): boolean => {
  const char = text[index];
  if (char === '$') return text[index + 1] === '(';
  return char === '`';
};

/**
 * Index of the `)` closing a process-substitution body that starts at `start`
 * (the character after the opening paren). Quotes hide parens, escapes skip
 * one character, and nested parens nest. `text.length` means unbalanced.
 */
const findProcessSubstitutionEnd = (text: string, start: number): number => {
  let depth = 1;
  let quote: '"' | "'" | null = null;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '\\') {
      index++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth++;
      continue;
    }
    if (char === ')' && --depth === 0) return index;
  }
  return text.length;
};

/**
 * Split command string into segments on `;`, `&`, `|`, `&&`, `||` while
 * respecting single/double quotes and skipping command substitution bodies
 * (they stay embedded in words rather than being split as separators).
 */
export const splitIntoRawSegments = (command: string): string[] => {
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
  // Tracks positions of command substitutions: we DO split on separators
  // outside quotes; substitution content retains its separators because $( and
  // backtick regions are tracked below.
  let inSubstitution = 0; // depth for $( )
  // A `$(…)` body is parsed on its own, so its quoting never leaks into the
  // shell that opened it: `subQuote` is the substitution's OWN quote state and
  // `resumeQuote` the quote state to restore when the body closes.
  let subQuote: '"' | "'" | null = null;
  let resumeQuote: '"' | "'" | null = null;
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
  let heredocQuoted = false; // delimiter was quoted/escaped: the body never expands
  let inHeredocBody = false; // body lines are being collected
  let heredocBody = '';

  /**
   * Emit an accumulated heredoc body as the single quoted word downstream
   * consumers analyze.
   *
   * A QUOTED delimiter (`<<'EOF'`, `<<"EOF"`, `<<\EOF`) disables expansion:
   * Bash copies the body verbatim, so `$(rm -rf ~)` inside it is literal text
   * that never runs. Re-attaching every body as a live double-quoted word lost
   * that distinction — the substitution was read as executable and a harmless
   * `cat <<'EOF'` blocked the command. For quoted delimiters the substitution
   * sigils are marked with LITERAL_EXPANSION_MARKER, so the predicate
   * machinery skips them exactly as it skips `'\$(…)'`; unquoted delimiters
   * keep expanding and stay fully analyzed. Bodies that really ARE executable
   * input (`bash <<'EOF'` + `rm -rf /`) contain no sigils, so marking changes
   * nothing for them.
   */
  const heredocBodyWord = (body: string): string => {
    const text = heredocQuoted
      ? body
          .replaceAll('$', (sigil) => LITERAL_EXPANSION_MARKER + sigil)
          .replaceAll('`', (sigil) => LITERAL_EXPANSION_MARKER + sigil)
      : body;
    return ` "${text.replaceAll('"', '\\"')}"`;
  };

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
    heredocQuoted = false;
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
        heredocQuoted = true;
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
        heredocQuoted = true;
        const decoded = decodeAnsiCQuoted(rest, k + 2);
        word += decoded.value;
        k = decoded.end;
        continue;
      }
      if (ch === '"' || ch === "'") {
        heredocQuoted = true;
        wordQuote = ch;
        k++;
        continue;
      }
      if (ch === '\\' && k + 1 < rest.length) {
        heredocQuoted = true;
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
        current += heredocBodyWord(heredocBody);
        heredocBody = '';
        heredocDelimiter = null;
        heredocQuoted = false;
        inHeredocBody = false;
        i = lineEnd === -1 ? PREPARED.length : lineEnd - 1;
        continue;
      }
      heredocBody += lineEnd === -1 ? line : `${line}\n`;
      i = lineEnd === -1 ? PREPARED.length : lineEnd;
      continue;
    }

    // A `$(…)` body is parsed with its OWN quoting, independent of any
    // enclosing double quote: in `echo "$(echo '";')"; rm -rf ~` the inner `"`
    // belongs to the substitution's single-quoted string and does NOT close the
    // outer quote. Reading it as the closing quote split the segment at the
    // inner `;`, left the trailing `')"` as a phantom quoted region that
    // swallowed the real command, and every predicate returned false while
    // bash deleted the home directory.
    if (inSubstitution > 0) {
      if (subQuote) {
        // Inside the substitution's own quotes: `"` keeps live escapes, `'`
        // is fully literal.
        if (subQuote === '"' && char === '\\' && i + 1 < PREPARED.length) {
          current += char + PREPARED[i + 1];
          i++;
          continue;
        }
        if (char === subQuote) subQuote = null;
        current += char;
        continue;
      }
      if (char === '\\' && i + 1 < PREPARED.length) {
        current += char + PREPARED[i + 1];
        i++;
        continue;
      }
      if (char === '"' || char === "'") {
        subQuote = char;
        current += char;
        continue;
      }
      if (char === '(') inSubstitution++;
      if (char === ')' && --inSubstitution === 0) {
        // The body closed: resume the quoting of the shell that opened it, so
        // a `$(…)` inside `"…"` returns to the double-quoted region.
        quote = resumeQuote;
        resumeQuote = null;
        current += char;
        continue;
      }
      current += char;
      continue;
    }

    // `$(…)` is executable wherever it appears, including inside DOUBLE quotes
    // (inside `'…'` and `$'…'` it is literal text and must stay untouched).
    if (!inBacktick && quote !== "'" && char === '$' && PREPARED[i + 1] === '(') {
      resumeQuote = quote;
      quote = null;
      subQuote = null;
      inSubstitution = 1;
      current += '$(';
      i++;
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
      (i === 0 || (/[\s;|&(`]/.test(PREPARED[i - 1] ?? '') && !isEscapedAt(PREPARED, i - 1)))
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

    if (inBacktick) {
      current += char;
      continue;
    }

    if (char === '<' && PREPARED[i + 1] === '<') {
      // `<<<` (here-string) and `<<=` are not heredoc operators.
      // The here-string operator is kept whole: its payload is stdin for the
      // command, and the word scanner needs to see the three characters to
      // keep that payload instead of dropping it as a redirection target.
      if (PREPARED[i + 2] === '<') {
        current += '<<<';
        i += 2;
        continue;
      }
      if (PREPARED[i + 2] === '=') {
        current += '<=';
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
    current += heredocBodyWord(heredocBody);
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
};

/**
 * Tokenize a segment into words, honoring quotes and keeping quoted content
 * as single words (quote markers removed). Redirections are removed here.
 */
export const tokenizeWords = (raw: string): string[] => {
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
  // Executable expansions that live OUTSIDE argv: a redirection operand
  // (`echo >$(rm -rf ~)`) or a process-substitution body (`cat <(rm -rf ~)`).
  // Bash runs them BEFORE the outer command, so dropping them along with the
  // operand hid the deletion from every predicate. They are collected
  // separately and appended after the argv words, so command resolution never
  // reads an operand expansion as an argument.
  const executableWords: string[] = [];

  const flush = () => {
    if (discardNextWord) {
      // The first word after a redirection operator is its target, not argv.
      // Whitespace before it must not clear the pending discard.
      if (hasWord) {
        discardNextWord = false;
        // Only a word that IS an expansion executes; a plain filename is just
        // a path and stays dropped.
        if (EXECUTABLE_EXPANSION.test(word)) executableWords.push(word);
      }
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
        // `\$` and `` \` `` inside double quotes suppress the expansion, so the
        // sigil is literal TEXT here exactly like the single-quote case above:
        // mark it, or `echo "\$(rm -rf ~)"` reads as a running substitution and
        // blocks a command that only prints.
        if (next === '$' || next === '`') {
          word += isLiteralExpansionAt(raw, i + 1) ? LITERAL_EXPANSION_MARKER + next : next;
        } else {
          word += next === '"' || next === '\\' ? next : char + next;
        }
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
      // Single quotes suppress expansion, so `'$(rm -rf ~)'` and
      // `` '`rm -rf ~`' `` are literal TEXT. Quote markers are stripped below,
      // which made the predicate layer read such an argument as a real
      // substitution and block a harmless `echo`. Keep a backslash marker on
      // the sigil so the executable-expansion scan can tell the two apart.
      word +=
        quote === "'" && isLiteralExpansionAt(raw, i) ? LITERAL_EXPANSION_MARKER + char : char;
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
      // safe surface (argv) is what security matching sees — except for an
      // escaped expansion sigil, which never runs: keep its marker.
      // An escaped expansion sigil is literal text too: mark it so the scan
      // does not treat `\$(cmd)` as a running substitution.
      word += isLiteralExpansionAt(raw, i + 1) ? LITERAL_EXPANSION_MARKER + escaped : escaped;
      hasWord = true;
      i += 2;
      continue;
    }

    // ANSI-C quoting $'…': the shell decodes the backslash escapes BEFORE
    // exec, so `$'\x72m' -rf /` runs rm and `rm -rf $'\x2f'` deletes root.
    // Decode the payload here so matching sees the real argv.
    if (char === '$' && raw[i + 1] === "'") {
      const { end, value } = decodeAnsiCQuoted(raw, i + 2);
      // ANSI-C quoting is still QUOTING: `$'$(rm -rf ~)'` only prints, because
      // the decoded sigils never expand. Mark them literal like the
      // single-quote case; appending the decoded text as-is made the predicate
      // read the payload as a running substitution and block a harmless `echo`.
      // The decoded bytes must not be able to FORGE provenance either: `$'\1'`
      // synthesizes U+0001 AFTER the predicate layer sanitized the input, so
      // `echo $'\1'$(rm -rf ~)` made a live substitution look literal. Drop
      // decoded marker bytes — they carry no meaning of their own.
      word += value
        .replaceAll(LITERAL_EXPANSION_MARKER, '')
        .replaceAll('$', LITERAL_EXPANSION_MARKER + '$')
        .replaceAll('`', LITERAL_EXPANSION_MARKER + '`');
      hasWord = true;
      i = end;
      continue;
    }

    // Locale-translation quoting `$"…"` is a QUOTED word too: bash removes the
    // `$`, translates the string, then passes it as double-quoted text, so
    // `rm $"-rf" ~` hands `-rf` and the expanded home directory to rm. Reading
    // the `$` as a literal character produced `$-rf`, which no flag check
    // recognises, and the home predicate returned false.
    if (char === '$' && raw[i + 1] === '"') {
      quote = '"';
      hasWord = true;
      i += 2;
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

    // Process substitution: `<(cmd)` / `>(cmd)` runs `cmd` and hands its file
    // descriptor to the outer command. Reading `<(` as an input redirection
    // discarded `(rm -rf ~)` as a filename, so `cat <(rm -rf ~)` never reached
    // the predicates. Keep the body as an executable word instead.
    if ((char === '<' || char === '>') && raw[i + 1] === '(') {
      flush();
      const end = findProcessSubstitutionEnd(raw, i + 2);
      const body = raw.slice(i + 2, end);
      if (body.trim()) executableWords.push(`$(${body})`);
      // `end` is the closing paren index, or raw.length when unbalanced.
      i = Math.min(end + 1, raw.length);
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
      // `<<<` is a here-string: its payload becomes the command's stdin, and a
      // shell interpreter executes stdin. Keep the payload as a word so the
      // predicate layer can read it as a payload; `<<` (heredoc) still has no
      // inline word to keep.
      if (op === '<' && raw[j + 1] === '<' && raw[j + 2] === '<') {
        i = Math.max(j + 3, i + 1);
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
  // Appended AFTER argv: an operand expansion is not an argument, and letting
  // it shift the command slot would change which word gets resolved.
  return [...words, ...executableWords];
};
