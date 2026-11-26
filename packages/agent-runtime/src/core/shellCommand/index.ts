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

import { stripGroupingParens } from '../shellQuoting';
import { splitIntoRawSegments, tokenizeWords } from '../shellSegmenter';
import { resolveCommandWord } from './resolveCommandWord';
import {
  collectFlagLettersAndNames,
  expandBraceAlternatives,
  isDashWord,
  parameterExpansionOperand,
} from './words';

export {
  collectFlagLettersAndNames,
  isUnresolvableCommandWord,
  parameterExpansionOperand,
} from './words';

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
