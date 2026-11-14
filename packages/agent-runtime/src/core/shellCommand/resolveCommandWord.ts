import { skipShellSyntax, stripLeadingGroupingParens } from '../shellQuoting';
import {
  ASSIGNMENT_PATTERN,
  commandBasename,
  isDashWord,
  isUnresolvableCommandWord,
} from './words';
import {
  EXEC_PREFIX_WRAPPERS,
  GLOBAL_VALUE_FREE_LONG_FLAGS,
  WRAPPER_OPTIONAL_ARG_SHORT_FLAGS,
  WRAPPER_POSITIONAL_VALUES,
  WRAPPER_VALUE_FREE_FLAGS,
  WRAPPER_VALUE_FREE_LONG_FLAGS,
  WRAPPER_VALUE_LONG_FLAGS,
  WRAPPER_VALUE_SHORT_FLAGS,
} from './wrapperOptions';

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
export const resolveCommandWord = (words: string[]): { index: number; name: string } | null => {
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
    const optionalArgShortFlags = WRAPPER_OPTIONAL_ARG_SHORT_FLAGS[base];
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
        if (optionalArgShortFlags?.has(flagHead)) {
          // `-i` / `-i{}` / `-eEND` / `-l5`: the argument is optional and, when
          // present, glued to the token — so the option ends here and the next
          // word is always the wrapped command.
          index++;
          continue;
        }
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
        // Unknown short-option arity: this wrapper's tables say nothing about
        // the letter, so "consume the next word" is a GUESS that can hide the
        // real command — `exec -c rm -rf /tmp/cache ~` ate `rm`, made
        // `/tmp/cache` the value of `-rf`, and resolved `~` as a confidently
        // unrelated executable, so every predicate returned false while bash
        // ran the deletion. Report ambiguity and let the segment-level fallback
        // judge the raw words instead of trusting a command found after
        // presumed operands.
        if (valueTakingShortFlags?.has(lettersOfFlag[valueAt]) !== true) return null;
        // The head was value-free, so a later value-taking letter decides:
        // last position takes the NEXT word (`-nu ROOT`), an earlier one can
        // carry an ATTACHED value (`-nuROOT`) — but only for a letter this
        // wrapper is known to give a value to.
        const takesAttachedValue = valueAt !== lettersOfFlag.length - 1;
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
