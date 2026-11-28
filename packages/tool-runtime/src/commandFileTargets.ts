import { parseShellCommandSegments } from '@lobechat/utils/shellCommandParsing';

/**
 * A path a shell command reads, writes or enters, as written in the command
 * (relative to the command's working directory unless absolute or `~/…`).
 */
export interface CommandFileTarget {
  /** `dir` for a `cd`, whose argument is the directory itself; `file` otherwise. */
  kind: 'dir' | 'file';
  path: string;
}

/**
 * Commands whose operands are files the model reads or writes — the shell
 * spellings of `readFile` / `writeFile`. Searches (`grep`, `find`, `ls`) stay out for the
 * same reason the file-tool trigger leaves out `grepContent` and `listFiles`:
 * a search over a tree does not say which directory the model works in.
 */
const READ_COMMANDS = new Set(['bat', 'cat', 'head', 'less', 'more', 'nl', 'sed', 'tail', 'tee']);

/** Prefixes that run the next word as the command (`sudo cat x`, `time cat x`). */
const COMMAND_PREFIXES = new Set(['builtin', 'command', 'exec', 'nohup', 'sudo', 'time']);

/** Options whose value is the next token, per command (`head -n 20 file`, `sed -e s/a/b/ file`). */
const OPTIONS_WITH_VALUE: Record<string, ReadonlySet<string>> = {
  head: new Set(['-c', '-n', '--bytes', '--lines']),
  sed: new Set(['-e', '-f']),
  tail: new Set(['-c', '-n', '--bytes', '--lines']),
};

/** A cap so one long script does not turn into dozens of scans. */
const MAX_TARGETS = 5;

const isAbsoluteLike = (target: string) =>
  target.startsWith('/') || target.startsWith('~') || /^[A-Za-z]:[\\/]/.test(target);

/** Shell text the shell would still expand, or no path at all. */
const isLiteralPath = (token: string) =>
  token.length > 0 && !/[$*?[\]{}`]/.test(token) && !token.startsWith('/dev/') && token !== '-';

/**
 * Split segments further at words ending in `;`: the tokenizer only splits on
 * a free-standing operator, and `cd pkg; cat a` spells it glued to a word.
 */
const splitGluedSemicolons = (segments: string[][]) =>
  segments.flatMap((segment) => {
    const parts: string[][] = [[]];
    for (const word of segment) {
      if (word.endsWith(';') && word.length > 1) {
        parts.at(-1)!.push(word.slice(0, -1));
        parts.push([]);
      } else {
        parts.at(-1)!.push(word);
      }
    }
    return parts.filter((part) => part.length > 0);
  });

const joinPath = (base: string | undefined, target: string) => {
  if (!base || isAbsoluteLike(target)) return target;
  return `${base.replace(/[\\/]+$/, '')}/${target}`;
};

/** The operands of one read command, skipping options and their values. */
const readOperands = (command: string, args: string[]) => {
  const operands: string[] = [];
  let scriptPending = command === 'sed';
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === '--') continue;
    if (token.startsWith('-') && token !== '-') {
      if (command === 'sed' && (token === '-e' || token === '-f')) scriptPending = false;
      if (OPTIONS_WITH_VALUE[command]?.has(token)) index++;
      continue;
    }
    // `head -20 file` and `tail +5 file` carry their count in the flag.
    if (/^[+-]?\d+$/.test(token)) continue;
    // sed's first operand is its script unless `-e` / `-f` already gave one.
    if (scriptPending) {
      scriptPending = false;
      continue;
    }
    operands.push(token);
  }
  return operands;
};

/**
 * Split a command's words into its arguments and the targets of its output
 * redirects (`echo x > out.md`, `cat a >out.md`). `2>&1` names no file;
 * input redirects (`< in.txt`) stay arguments, which read commands treat as
 * the file they read anyway.
 */
const splitRedirects = (words: string[]) => {
  const args: string[] = [];
  const redirects: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const match = /^(?:\d*|&)>>?(.*)$/.exec(words[index]);
    if (!match) {
      // `< in.txt` / `<in.txt`: the file is read, like an operand.
      const input = words[index].replace(/^</, '');
      if (input) args.push(input);
      continue;
    }
    const inline = match[1];
    if (inline.startsWith('&')) continue;
    if (inline) {
      redirects.push(inline);
    } else {
      redirects.push(words[index + 1] ?? '');
      index++;
    }
  }
  return { args, redirects };
};

/**
 * The files and directories a shell command works in, in order: `cd` targets
 * and the operands of read commands and output redirects. Relative paths
 * after a `cd` are joined onto it, as the shell would resolve them. Best
 * effort by design — anything the parser cannot read, or that the shell would
 * expand (`$VAR`, globs), yields nothing, and the worst case is a directory
 * whose agent files load on a later call instead of this one.
 */
export const extractCommandFileTargets = (command: string): CommandFileTarget[] => {
  const parsed = parseShellCommandSegments(command);
  if (!parsed) return [];
  const segments = splitGluedSemicolons(parsed);

  const targets: CommandFileTarget[] = [];
  const seen = new Set<string>();
  let base: string | undefined;
  // After a `cd` this parser cannot follow (`cd $DIR`, `cd -`, bare `cd`),
  // relative paths resolve somewhere unknown, so they are dropped.
  let baseUnknown = false;

  const add = (raw: string, kind: CommandFileTarget['kind']) => {
    if (!isLiteralPath(raw)) return;
    if (baseUnknown && !isAbsoluteLike(raw)) return;
    const target = joinPath(base, raw);
    if (seen.has(target)) return;
    seen.add(target);
    targets.push({ kind, path: target });
  };

  for (const segment of segments) {
    let start = 0;
    // `FOO=1 cat x`, `sudo cat x`
    while (
      start < segment.length &&
      (/^[A-Z_a-z]\w*=/.test(segment[start]) || COMMAND_PREFIXES.has(segment[start]))
    ) {
      start++;
    }
    const name = segment[start]?.split('/').pop();
    if (!name) continue;
    const { args, redirects } = splitRedirects(segment.slice(start + 1));

    if (name === 'cd' || name === 'pushd') {
      const dir = args.find((token) => !token.startsWith('-'));
      if (dir && isLiteralPath(dir) && (!baseUnknown || isAbsoluteLike(dir))) {
        add(dir, 'dir');
        base = joinPath(base, dir);
        baseUnknown = false;
      } else {
        baseUnknown = true;
      }
    } else if (READ_COMMANDS.has(name)) {
      for (const operand of readOperands(name, args)) add(operand, 'file');
    }
    for (const target of redirects) add(target, 'file');

    if (targets.length >= MAX_TARGETS) break;
  }

  return targets.slice(0, MAX_TARGETS);
};
