import type { ShellSegment } from '../shellCommand';
import { LITERAL_EXPANSION_MARKER } from '../shellSegmenter';

/**
 * Whether the sigil at `index` is marked as literal text (single quotes or a
 * backslash suppressed its expansion). The segmenter writes the marker right
 * before the sigil.
 */
const isLiteralExpansionAt = (text: string, index: number): boolean =>
  index > 0 && text[index - 1] === LITERAL_EXPANSION_MARKER;

/**
 * Shells that execute one of their arguments as NEW shell source (`bash -c '…'`,
 * `eval '…'`), including when the interpreter sits behind another wrapper
 * (`xargs bash -c '…'`). Quote provenance from the calling shell stops at that
 * boundary, so the markers the tokenizer wrote for the CALLER's quotes must be
 * dropped before the payload is re-parsed: `bash -c 'echo $(rm -rf ~)'` still
 * runs the substitution in the child shell.
 */
const SHELL_INTERPRETER_COMMANDS = new Set(['bash', 'dash', 'eval', 'ksh', 'sh', 'zsh']);

export const isShellInterpreterWord = (word: string): boolean =>
  SHELL_INTERPRETER_COMMANDS.has(word.replace(/^.*\//, ''));

/** Drop literal-expansion markers: the payload is a fresh shell level. */
export const withoutLiteralMarkers = (word: string): string =>
  word.includes(LITERAL_EXPANSION_MARKER) ? word.split(LITERAL_EXPANSION_MARKER).join('') : word;

/**
 * Command substitutions execute BEFORE the surrounding command, so a confident
 * outer command says nothing about them: `echo $(rm -rf ~)` deletes the home
 * directory and then echoes the empty result. The outer words themselves are
 * still safe to ignore — a literal `rm -rf ~` inside a quoted argument is data,
 * not a command — so only the bodies of `$( … )` and backtick substitutions are
 * extracted here and re-analyzed as payloads.
 */

export const substitutionPayloads = (word: string): string[] => {
  const payloads: string[] = [];
  for (let index = 0; index < word.length; index++) {
    if (word[index] === '$' && word[index + 1] === '(') {
      // A literal, non-expanding sigil — never a substitution.
      if (isLiteralExpansionAt(word, index)) continue;
      // `$((…))` is arithmetic, not a command substitution.
      if (word[index + 2] === '(') continue;
      let depth = 0;
      let body: string | undefined;
      for (let cursor = index + 1; cursor < word.length; cursor++) {
        if (word[cursor] === '(') depth++;
        else if (word[cursor] === ')' && --depth === 0) {
          body = word.slice(index + 2, cursor);
          index = cursor;
          break;
        }
      }
      // Quoting provenance is gone by now (the tokenizer strips quotes), so a
      // parenthesis that was QUOTED arrives as a bare one and the depth counter
      // either never closes (`echo $(printf "("; rm -rf ~)`) or closes on the
      // wrong paren (`echo $(printf ")"; rm -rf ~)`). Re-analyze the whole
      // remainder as a payload in both cases instead of trusting the split:
      // the executed command is still in there, merely with a stray paren.
      const tail = word.slice(index + 2).replace(/\)$/, '');
      for (const candidate of [body, tail]) {
        if (candidate && candidate.trim() && !payloads.includes(candidate))
          payloads.push(candidate);
      }
      continue;
    }
    if (word[index] === '`') {
      // Same provenance rule: `'\` … \`'` inside single quotes is literal text.
      if (isLiteralExpansionAt(word, index)) continue;
      const end = word.indexOf('`', index + 1);
      if (end < 0) continue;
      payloads.push(word.slice(index + 1, end));
      index = end;
    }
  }
  return payloads;
};

/**
 * Payload words the segment hands to a NEW shell level as source: the word
 * after `-c` (`bash -c '<payload>'`, combined flags like `-ec '<payload>'`
 * included) and, for `eval`, every following argument — Bash joins them with
 * spaces before executing the result (`help eval`: "Combine ARGs into a single
 * string").
 *
 * Both shapes must be analyzed whatever ELSE the segment contains:
 *  - a positional `rm` in `bash -c 'echo $(rm -rf ~)' rm` used to divert the
 *    fallback into its bare-rm branch and skip the payload inspection; and
 *  - reparsing `eval 'rm -rf' ~` argument by argument split the command from
 *    its target, so neither half looked dangerous on its own.
 */
/**
 * Long interpreter options that take their value as the NEXT word
 * (`bash --rcfile FILE`, `bash --init-file FILE`). Long options written as
 * `--opt=value` carry the operand inline and are skipped as a single word.
 */
const INTERPRETER_LONG_OPTIONS_WITH_VALUE = new Set(['--init-file', '--rcfile']);

export const interpreterPayloadWords = (segment: ShellSegment): string[] => {
  const words = segment.words;
  const payloads: string[] = [];
  for (let index = 0; index < words.length; index++) {
    if (!isShellInterpreterWord(words[index])) continue;
    if (words[index].replace(/^.*\//, '') === 'eval') {
      // `eval` concatenates its arguments; `eval 'rm -rf' ~` runs `rm -rf ~`.
      const joined = words
        .slice(index + 1)
        .join(' ')
        .trim();
      if (joined) payloads.push(joined);
      continue;
    }
    // Walk the interpreter's option words: `bash -e -c '<payload>'` puts the
    // command payload after any number of preceding options (`bash [GNU long
    // option] [option] ...`), so requiring `-c` right after the executable
    // missed the payload and let the deletion run in the child shell.
    //
    // The walk models Bash's own parse instead of the shape of one word:
    //  - `c` sets a PENDING command and may sit anywhere in a cluster (`-c`,
    //    `-ec`, `-xce`), so the payload is the first NON-OPTION word after it;
    //  - `+`-prefixed words stay option words (`bash +e -c '…'`; `help set`:
    //    "Using + rather than - causes these flags to be turned off"), so they
    //    must not end the walk;
    //  - `-o option` / `-O shopt_option` take their operand from the NEXT word
    //    and a cluster can carry both (`bash -xoc pipefail -c '<payload>'`), so
    //    each such letter before `c` shifts where the payload starts.
    let cursor = index + 1;
    let commandPending = false;
    while (cursor < words.length) {
      const option = words[cursor];
      if (option === '--') {
        // End of options: a pending `-c` takes the next word as its payload.
        if (commandPending && words[cursor + 1]) payloads.push(words[cursor + 1]);
        break;
      }
      if (option.startsWith('+')) {
        // `+`-prefixed options still take their operand from the NEXT word:
        // `help set` documents `-o option-name` and says "Using + rather than -
        // causes these flags to be turned off", so `bash +o posix -c '<src>'`
        // skips `+o` but leaves `posix`, and the walk stopped before `-c` — the
        // positional `rm` in `bash +o posix -c 'echo $(rm -rf ~)' rm` then
        // suppressed the fallback and all three predicates returned false.
        const plusLetters = option.slice(1);
        cursor += 1 + [...plusLetters].filter((letter) => /o/i.test(letter)).length;
        continue;
      }
      if (!option.startsWith('-')) {
        // First non-option word: the pending `-c` payload (`bash -c '<src>'`,
        // `bash -xce '<src>'`) or the script file of a plain `bash script.sh`.
        if (commandPending) payloads.push(option);
        break;
      }
      if (option.startsWith('--')) {
        // Value-taking long options (`bash --rcfile FILE -c …`) keep their
        // operand in the NEXT word. Skipping only the flag made the operand
        // look like the end of the option list (`FILE` does not start with
        // `-`), so the walk broke before `-c` and the payload stayed invisible.
        cursor += INTERPRETER_LONG_OPTIONS_WITH_VALUE.has(option) ? 2 : 1;
        continue;
      }
      const letters = option.slice(1);
      const commandAt = letters.indexOf('c');
      if (commandAt === 0 && letters.length > 1) {
        // Glued form `-c<source>`: keep the remainder as a candidate so a
        // command written without a space is still inspected. Over-detection is
        // the safe direction: `bash -cecho hi` makes `echo` more flags and `hi`
        // the `-o` operand (`bash: hi: invalid option name`), never source.
        payloads.push(letters.slice(1));
      }
      if (commandAt !== -1) commandPending = true;
      // Operand letters before `c` consume the next word, which moves the
      // payload: `bash -xoc pipefail -c '<payload>'` runs `<payload>`, not
      // `pipefail`, and all three predicates returned false for it.
      const operandLetters = commandAt === -1 ? letters : letters.slice(0, commandAt);
      const operands = [...operandLetters].filter((letter) => /o/i.test(letter)).length;
      cursor += 1 + operands;
    }
  }
  return payloads;
};
