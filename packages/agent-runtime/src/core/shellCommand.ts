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

/**
 * Bash builtin that executes its argument as a command, bypassing aliases and
 * functions: `command rm -rf /` runs rm directly. Unwrapped like sudo/env.
 * Options `-p` (default PATH), `-v`/`-V` (describe) take no value.
 */
const ASSIGNMENT_PATTERN = /^[A-Z_]\w*=.*$/i;

/**
 * Split command string into segments on `;`, `&`, `|`, `&&`, `||` while
 * respecting single/double quotes and skipping command substitution bodies
 * (they stay embedded in words rather than being split as separators).
 */
const splitIntoRawSegments = (command: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  // Tracks positions of unquoted command substitutions: we DO split on
  // separators outside quotes; substitution content retains its separators
  // because $( and backtick regions are tracked below.
  let inSubstitution = 0; // depth for $( )
  let inBacktick = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (quote) {
      current += char;
      // No escapes inside single quotes; \" and \\ possible in double quotes
      if (quote === '"' && char === '\\' && i + 1 < command.length) {
        current += command[i + 1];
        i++;
        continue;
      }
      if (char === quote) quote = null;
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

    if (!inSubstitution && !inBacktick && char === '$' && command[i + 1] === '(') {
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

    // Unescaped CR/LF is a command separator just like `;` (multi-line
    // commands are legal shell). Inside quotes/substitutions they are inert.
    if (char === '\n' || char === '\r') {
      parts.push(current);
      current = '';
      // Treat \r\n as one separator
      if (char === '\r' && command[i + 1] === '\n') i++;
      continue;
    }

    if (char === '&' && command[i + 1] === '&') {
      parts.push(current);
      current = '';
      i++;
      continue;
    }

    if (char === '|' && command[i + 1] === '|') {
      parts.push(current);
      current = '';
      i++;
      continue;
    }

    if (char === ';' || char === '&' || char === '|') {
      parts.push(current);
      current = '';
      continue;
    }

    current += char;
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
        word += raw[i + 1];
        i++;
        hasWord = true;
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

    if (inSubstitution) {
      if (char === '(') inSubstitution++;
      if (char === ')') inSubstitution--;
      word += char;
      if (inSubstitution === 0) {
        // substitution closed; continue same word
      }
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
const collectFlagLettersAndNames = (
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
  // GNU env value-free flags: -i ignore-env, -0 null-sep, -v verbose.
  // Value-taking: -u unset NAME, -S split-string (its value IS a command —
  // consumed as a value word, which hides it; covered by the predicate-level
  // ambiguity fallback in semanticShellPredicates.ts).
  env: new Set(['i', '0', 'v']),
  nohup: new Set(),
  // bash command builtin: -p default PATH, -v/-V describe.
  command: new Set(['p', 'v', 'V']),
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
  'env', // env VAR=… cmd
  'nohup', // hangup-immune exec
  'command', // bash builtin: bypass aliases/functions
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

  // Unwrap exec-prefix wrappers. The loop naturally terminates: `index`
  // strictly increases every iteration and is bounded by words.length. No
  // artificial counter — pathologically chained wrappers still resolve fully.
  while (index < words.length) {
    const word = words[index];
    if (!EXEC_PREFIX_WRAPPERS.has(word)) break;
    const valueFreeFlags = WRAPPER_VALUE_FREE_FLAGS[word];
    index++;
    // Consume wrapper-owned positional values first (timeout DURATION, flock
    // LOCKFILE): bare words that are NOT the wrapped command.
    let positional = WRAPPER_POSITIONAL_VALUES[word] ?? 0;
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
        // `-abc` combined short flags: consumes a value unless EVERY letter
        // is whitelisted value-free. Unknown/foreign flags consume — the
        // safe direction for a blacklist (over-detection).
        const letters = /^-([a-z]+)$/i.exec(token);
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

  const commandWord = words[index];
  if (!commandWord) return null;
  if (isDashWord(commandWord) || ASSIGNMENT_PATTERN.test(commandWord)) return null;
  // Normalize path-qualified executables to their basename so predicates can
  // compare on the bare command name: /bin/rm → rm, ./script.sh → script.sh,
  // /usr/bin/env → env. Bare `/` (root target) has no basename and stays.
  const lastSlash = commandWord.lastIndexOf('/');
  return lastSlash >= 0 && lastSlash + 1 < commandWord.length
    ? commandWord.slice(lastSlash + 1)
    : commandWord;
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
    const flags = collectFlags(words);

    // Targets: non-flag words after the command word. Match on the raw word
    // index (basename normalization is display-level only; /bin/rm and rm
    // occupy the same slot), so arg extraction works for both spellings.
    const commandIndex = resolvedCommand
      ? words.findIndex((word) => word === resolvedCommand || word.endsWith(`/${resolvedCommand}`))
      : -1;
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
