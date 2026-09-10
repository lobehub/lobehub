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
  /** True when the command could not be split/parsed with confidence. */
  ambiguous: boolean;

  /**
   * Flag words as they appeared (e.g. '-rf', '--recursive'), collected from
   * dash-prefixed words. Quoted words never count as flags.
   */
  flags: string[];

  /** Whether this segment contains command substitution (backticks or $()) / variables. */
  hasCommandSubstitution: boolean;

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

/** Words that wrap the real command and must be skipped during resolution. */
const WRAPPER_COMMANDS = new Set(['sudo', 'env', 'nohup']);

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

const doesSegmentContainSubstitution = (raw: string): boolean => {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (quote) {
      if (quote === '"' && char === '\\') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '`') return true;
    if (char === '$' && (raw[i + 1] === '(' || /\{/.test(raw[i + 1] ?? ''))) return true;
  }
  return false;
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
 * Unwrap wrapper commands (sudo/env/nohup) plus leading VAR=value assignments
 * and reveal the real command word.
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

  // Unwrap wrappers. The loop naturally terminates: `index` strictly increases
  // every iteration and is bounded by words.length. No artificial counter —
  // pathologically chained wrappers (e.g. 50x `sudo`) still resolve fully.
  while (index < words.length) {
    const word = words[index];
    if (WRAPPER_COMMANDS.has(word)) {
      index++;
      // Skip wrapper-owned tokens: inline assignments after `env`, wrapper
      // flags like `sudo -u alice` / `env -i` / `nohup --`, and the VALUE
      // argument of wrapper flags that take one (`-u alice`, `-g group`).
      // Never skip the real command itself.
      while (index < words.length) {
        const token = words[index];
        if (ASSIGNMENT_PATTERN.test(token) || isDashWord(token)) {
          index++;
          continue;
        }
        // A bare word right after a value-taking wrapper flag is that flag's
        // value, not the command. Only `-u`/`-g` style single-letter flags
        // consume a value; `--user=alice` already embeds it.
        const previous = words[index - 1];
        if (/^-[a-z]$/i.test(previous)) {
          index++;
          continue;
        }
        break;
      }
      continue;
    }
    break;
  }

  const commandWord = words[index];
  if (!commandWord) return null;
  if (isDashWord(commandWord) || ASSIGNMENT_PATTERN.test(commandWord)) return null;
  return commandWord;
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

    // Targets: non-flag words after the command word
    const commandIndex = resolvedCommand ? words.indexOf(resolvedCommand) : -1;
    const argWords = commandIndex >= 0 ? words.slice(commandIndex + 1) : [];
    const trailingSlashTargets = argWords.filter(
      (word) => !isDashWord(word) && (word.endsWith('/') || isBareSlash(word)),
    );
    const homeTargets = argWords.filter((word) => !isDashWord(word) && isHomePath(word));

    const { letters, names } = collectFlagLettersAndNames(flags);

    const ambiguous = words.length === 0;

    return {
      raw: rawSegment,
      words,
      resolvedCommand,
      flags,
      trailingSlashTargets,
      homeTargets,
      hasCommandSubstitution: doesSegmentContainSubstitution(rawSegment),
      ambiguous,
      hasFlag: (letter: string) => letters.has(letter) || names.has(letter),
      hasLongFlag: (name: string) => names.has(name),
    };
  });
};

export const SHELL_SEGMENT_TYPE = 'shellSemantic';
