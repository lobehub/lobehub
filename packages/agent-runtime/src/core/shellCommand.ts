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

import { skipShellSyntax, stripGroupingParens, stripLeadingGroupingParens } from './shellQuoting';
import { splitIntoRawSegments, tokenizeWords } from './shellSegmenter';

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
  // `${HOME}` names the same directory as `$HOME`; normalize the braced
  // spelling so it cannot slip past the classifier.
  const home = operand.replace(/^\$\{HOME\}/, '$HOME');
  return (
    home === '~' ||
    home.startsWith('~/') ||
    home === '$HOME' ||
    home.startsWith('$HOME/') ||
    /^\/(?:Users|home)\/[^/]+/.test(home)
  );
};

const isDashWord = (word: string): boolean => word.startsWith('-') && word.length > 1;

const isBareSlash = (word: string): boolean => word === '/';

/**
 * Parse flags: every isolated dash-word is a flag entry. Combined short flags
 * like -rf expand at query time.
 */
const collectFlags = (words: string[]): string[] =>
  words.flatMap((word) => {
    if (isDashWord(word)) return [word];
    // FLAG-position parameter expansion: `rm ${RM_FLAGS:--rf} ~` expands to
    // `rm -rf ~` whenever RM_FLAGS is unset, but the raw word starts with `$`,
    // so a plain dash-word filter dropped the recursive flag and every
    // predicate returned false while the home directory was deleted.
    // Parameter-expansion operands were already inspected in the command and
    // target positions (`${CMD} -rf /`, `rm -rf ${TARGET}`); the flag position
    // is the same question, so a dash-shaped operand counts as a flag word.
    const operand = parameterExpansionOperand(word);
    if (operand === undefined) return [];
    // A default may hold SEVERAL argv words — `rm ${FLAGS:--r -f} ~` expands to
    // `rm -r -f ~`, so every dash-shaped piece counts, not just a leading one.
    return operand.split(/\s+/).filter(isDashWord);
  });

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
  // GNU xargs value-free flags: -0/--null NUL-separated input,
  // -r/--no-run-if-empty, -t/--verbose, -p/--interactive, -x/--exit,
  // -o/--open-tty, plus the deprecated OPTIONAL-argument forms -e/-i/-l
  // (their argument is attachable only, see
  // WRAPPER_OPTIONAL_ARG_SHORT_FLAGS below). Value-taking: -a FILE, -E
  // EOF-str, -I replstr, -L lines, -n max-args, -P procs, -s size, -d delim.
  // Note the -0 form: an unwhitelisted `-0` would swallow the wrapped command
  // (`xargs -0 rm -rf / harmless` resolved the harmless word as the command),
  // and `-t` failed the same way — `printf x | xargs -t rm -rf /tmp/cache ~`
  // consumed `rm` as an option value and left `~` as a confidently unrelated
  // executable, so every predicate returned false while bash deleted the home
  // directory.
  xargs: new Set(['0', 'r', 't', 'p', 'x', 'o', 'e', 'i', 'l']),
  // `time` is a bash KEYWORD (`time [-p] pipeline`, `help time`: "-p print the
  // timing summary in the portable Posix format") and GNU time's `-p` is the
  // same switch. Without the table `-p` defaulted to "value-taking", ate the
  // wrapped command and left `~` as a confidently unrelated executable, so
  // `time -p rm -rf /tmp/cache ~` passed every predicate.
  time: new Set(['p']),
  // bash `exec` builtin (`help exec`: `exec [-cl] [-a name] [command …]`):
  // `-c` executes the command with an empty environment and `-l` makes it a
  // login shell — neither takes a word (`-a NAME` does, see
  // WRAPPER_VALUE_SHORT_FLAGS). Unlisted, `-c` defaulted to value-taking, ate
  // `rm`, then `/tmp/cache` became the value of `-rf` and `~` resolved as a
  // confidently unrelated executable, so `exec -c rm -rf /tmp/cache ~` passed
  // every predicate while bash ran the deletion.
  exec: new Set(['c', 'l']),
  // util-linux `setsid` (`setsid --help`: `-c, --ctty`, `-f, --fork`,
  // `-w, --wait`) — all switches, none takes a value word. Same failure shape
  // as `exec -c`: `setsid -f rm -rf /tmp/cache ~` resolved `~` as the command.
  setsid: new Set(['c', 'f', 'w']),
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
  // bash `exec -a NAME` (argv[0] override) is the builtin's only value-taking
  // short option.
  exec: new Set(['a']),
  xargs: new Set(['a', 'E', 'I', 'L', 'n', 'P', 's', 'd']),
  runuser: new Set(['u', 'g', 'c']),
  timeout: new Set(['k', 's']),
  nice: new Set(['n']),
  stdbuf: new Set(['i', 'o', 'e']),
  ionice: new Set(['c', 'n', 'p']),
  flock: new Set(['w', 'E']),
};

/**
 * Wrapper short flags whose argument is OPTIONAL (`xargs -i[R]`, `xargs
 * -e[END]`, `xargs -l[MAX-LINES]`). getopt accepts an optional argument only
 * when it is glued to the token, so the bare form is complete on its own and
 * the next word is the wrapped command in BOTH shapes: neither `-i` nor
 * `-i{}` may consume a value word. Reading them as value-taking ate the
 * command (`xargs -i rm -rf ~` resolved `~` as the executable).
 */
const WRAPPER_OPTIONAL_ARG_SHORT_FLAGS: Record<string, ReadonlySet<string>> = {
  xargs: new Set(['e', 'i', 'l']),
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
  // GNU time long switches (the `-p` above is the bash keyword form).
  time: new Set(['--portability', '--verbose', '--quiet']),
  // util-linux `setsid` long forms mirror the short switches above.
  setsid: new Set(['--ctty', '--fork', '--wait']),
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
