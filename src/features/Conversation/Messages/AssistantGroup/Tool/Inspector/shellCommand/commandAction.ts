import { describeCliStep, optionValue } from './cliStep';
import { inlineHeredocSubstitutions } from './readableShellCommand';
import type { SearchPatternDialect } from './searchPattern';
import { searchPatternTerms } from './searchPattern';
import type { ShellCommandTitle } from './types';

/**
 * What a shell command did, when it is one of the file reads, searches, or
 * listings an agent runs to explore a project, or a test run, commit, push, or
 * `gh` / `vc` / `lh` step. The Codex app reads `sed -n '1,40p' src/app.ts` as
 * `Read app.ts`, not as a command line, so a run of exploration reads as what
 * the agent looked at.
 *
 * Ported from Caxri (`packages/protocol/src/agent/agent-shell-command.ts`).
 */
export type ShellCommandAction =
  | { kind: 'read'; paths: string[] }
  | {
      /** `isFileNames` when the pattern filters a file listing (`rg --files src | rg '\.test\.ts$'`). */
      isFileNames?: boolean;
      kind: 'search';
      path?: string;
      pattern: string;
      /** What the pattern looks for, as a person reads it; see `searchPatternTerms`. */
      terms: string[];
    }
  | { kind: 'list'; path?: string }
  /** `targets` are the test files or directories the run names; `command` is the run without wrappers. */
  | { command: string; kind: 'test'; targets: string[] }
  | { isPushed: boolean; kind: 'commit'; message?: string }
  | { branch?: string; kind: 'push' }
  | { kind: 'cli'; title: ShellCommandTitle }
  /** A `gh`, `vc`, or `lh` subcommand with no dedicated title. */
  | { kind: 'other' };

type ExploreAction = Extract<ShellCommandAction, { kind: 'list' | 'read' | 'search' }>;
type StepAction = Exclude<ShellCommandAction, ExploreAction>;

const READ_COMMANDS = new Set(['cat', 'head', 'tail', 'nl', 'bat', 'less', 'more']);
const SEARCH_COMMANDS = new Set(['rg', 'grep', 'egrep', 'ag', 'ack']);
const LIST_COMMANDS = new Set(['ls', 'find', 'fd', 'tree', 'eza']);

/** `find` actions that delete or run commands on what it finds, so it no longer only lists. */
const FIND_ACTIONS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir']);

/** `fd` options that run a command on each result. */
const FD_ACTIONS = new Set(['-x', '--exec', '-X', '--exec-batch']);

/** Commands that only reshape what an earlier pipeline stage printed, so `cat app.ts | head -40` is still a read. */
const FILTER_COMMANDS = new Set([
  'head',
  'tail',
  'nl',
  'wc',
  'sort',
  'uniq',
  'cut',
  'tr',
  'sed',
  'jq',
]);

/** Options whose value is the next word, per command, so `head -n 40 app.ts` names `app.ts`, not `40`. */
const VALUE_OPTIONS: Partial<Record<string, ReadonlySet<string>>> = {
  find: new Set(['-name', '-iname', '-path', '-type', '-maxdepth', '-mindepth', '-newer', '-size']),
  grep: new Set([
    '-A',
    '-B',
    '-C',
    '-m',
    '-e',
    '-f',
    '--regexp',
    '--file',
    '--include',
    '--exclude',
  ]),
  head: new Set(['-n', '-c']),
  rg: new Set([
    '-g',
    '-t',
    '-T',
    '-A',
    '-B',
    '-C',
    '-m',
    '-e',
    '-f',
    '--regexp',
    '--file',
    '--glob',
    '--type',
    '--type-not',
    '--max-count',
    '--context',
    '--after-context',
    '--before-context',
  ]),
  sed: new Set(['-e', '-f']),
  tail: new Set(['-n', '-c']),
};

/**
 * Splits one simple command into words, honoring single and double quotes and
 * backslash escapes (`Release\ Notes.md`). Returns `null` for anything a word
 * split cannot read faithfully: a redirection, a substitution, or a variable.
 */
const splitWords = (command: string): string[] | null => {
  const words: string[] = [];
  let word = '';
  let hasWord = false;
  let quote: '"' | "'" | undefined;
  let isEscaped = false;
  for (const char of command) {
    if (isEscaped) {
      isEscaped = false;
      // A backslash before a newline continues the line; the shell drops both.
      if (char === '\n') continue;
      // Inside double quotes a backslash escapes only `"`, `\`, `$`, and a backtick.
      if (quote === '"' && !/["$\\`]/u.test(char)) word += '\\';
      word += char;
      hasWord = true;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      isEscaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasWord = true;
      continue;
    }
    if (/[<>`$(){}]/u.test(char)) return null;
    if (/\s/u.test(char)) {
      if (hasWord) words.push(word);
      word = '';
      hasWord = false;
      continue;
    }
    word += char;
    hasWord = true;
  }
  if (quote || isEscaped) return null;
  if (hasWord) words.push(word);
  return words;
};

/**
 * Splits on unquoted list operators (`&&`, `;`, a newline) into commands, and
 * each command on unquoted pipes into its stages. Returns `null` for `||` and
 * for an empty command, which no single action describes.
 */
const splitList = (command: string): string[][] | null => {
  const commands: string[][] = [];
  let stages: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let index = 0;
  const didEnd = (isCommandEnd: boolean): boolean => {
    stages.push(current.trim());
    current = '';
    if (stages.includes('')) return false;
    if (isCommandEnd) {
      commands.push(stages);
      stages = [];
    }
    return true;
  };
  while (index < command.length) {
    const char = command[index] ?? '';
    // A backslash keeps the next character from closing a quote or ending a command.
    if (char === '\\' && quote !== "'") {
      current += command.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      current += char;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    if (command.startsWith('||', index)) return null;
    const operator = ['&&', ';', '\n', '|'].find((op) => command.startsWith(op, index));
    if (operator && !quote) {
      // A trailing `;` or newline ends the last command without starting another.
      if (operator !== '|' && current.trim() === '' && stages.length === 0) {
        index += operator.length;
        continue;
      }
      if (!didEnd(operator !== '|')) return null;
      index += operator.length;
      continue;
    }
    current += char;
    index += 1;
  }
  if (quote) return null;
  if ((current.trim() !== '' || stages.length > 0) && !didEnd(true)) return null;
  return commands.length > 0 ? commands : null;
};

/** A heredoc fed to a command's standard input, ending its line: `git commit -q -F - <<'EOF'`. */
const HEREDOC_INPUT = /(\s-F\s+-|\s--file[ =]-)?\s+<<-?\s*(["']?)(\w+)\2[\t ]*\n/u;

/**
 * A heredoc fed to a command (`git commit -F - <<'EOF'`) is the command's
 * input, not part of what it does, so it is dropped with its body; `-F -` reads
 * its first line as the commit message (`-m '<first line>'`). An unterminated
 * heredoc leaves the command unchanged.
 */
const inlineHeredocInputs = (command: string): string => {
  let rest = command;
  let result = '';
  for (let start = HEREDOC_INPUT.exec(rest); start; start = HEREDOC_INPUT.exec(rest)) {
    const [opener, fileOption, , tag] = start;
    const lines = rest.slice(start.index + opener.length).split('\n');
    const endLine = lines.findIndex((line) => line.trim() === tag);
    if (endLine === -1) return command;
    const firstLine = lines.slice(0, endLine).find((line) => line.trim() !== '') ?? '';
    result += rest.slice(0, start.index);
    if (fileOption) result += ` -m '${firstLine.trim().replaceAll("'", '')}'`;
    rest = `\n${lines.slice(endLine + 1).join('\n')}`;
  }
  return result + rest;
};

/**
 * Redirections an agent adds only to merge or silence output (`2>&1`,
 * `2>/dev/null`); any other redirection still makes the command unreadable to
 * {@link splitWords}.
 */
const OUTPUT_PLUMBING = /\s+(?:\d?>&\d|&?\d?>\s*\/dev\/null)(?=\s|$|[;|]|&&)/gu;

/** A command's standard output sent to a file it names: `> ci.log`, `>> ci.log`, `&> ci.log`. */
const OUTPUT_CAPTURE = /^(.*\S)\s+[&1]?>>?\s*(\S+)$/su;

/** A command that only prints a file (`tail -15 ci.log`), with the file as its last word. */
const CAPTURE_READ = /^(?:cat|head|tail)(?:\s.*)?\s(\S+)$/su;

/**
 * A background command often writes its output to a file and prints that file
 * once it ends (`gh pr checks 31 --watch > ci.log 2>&1; tail -15 ci.log`). That
 * pair does what the command does, so the redirection and the reads of its file
 * are dropped. Any other redirection, or a read of a different file, is kept.
 */
const withoutCapturedOutput = (commands: readonly string[][]): readonly string[][] => {
  for (let index = 0; index < commands.length - 1; index += 1) {
    const stages = commands[index] ?? [];
    const [, command = '', file = ''] = OUTPUT_CAPTURE.exec(stages.at(-1) ?? '') ?? [];
    if (!command || file.startsWith('&')) continue;
    const isReadBack = commands
      .slice(index + 1)
      .every(
        (later) => later.length === 1 && CAPTURE_READ.exec(later[0]?.trim() ?? '')?.[1] === file,
      );
    if (isReadBack) return [...commands.slice(0, index), [...stages.slice(0, -1), command]];
  }
  return commands;
};

/**
 * Drops what only changes how a command runs, not what it does: environment
 * assignments, `env`, `time`, and the `rtk` output compressor.
 */
const WRAPPERS = new Set(['command', 'env', 'rtk', 'time']);

const withoutWrappers = (words: readonly string[]): string[] => {
  let rest = [...words];
  for (;;) {
    const [first = ''] = rest;
    if (!WRAPPERS.has(first) && !/^[A-Z_]\w*=/iu.test(first)) return rest;
    rest = rest.slice(1);
  }
};

/**
 * The positional words after the command name, skipping options and the values
 * they take. Patterns given as options (`-e TODO -e FIXME`, `--regexp=TODO`)
 * are collected in order; `hasPatternFile` marks patterns read from a file
 * (`-f patterns.txt`), which the command line cannot name.
 */
const positionals = (
  name: string,
  arguments_: readonly string[],
): { hasPatternFile: boolean; patterns: string[]; values: string[] } => {
  const valueOptions = VALUE_OPTIONS[name];
  const values: string[] = [];
  const patterns: string[] = [];
  let hasPatternFile = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index] ?? '';
    if (argument === '--') {
      values.push(...arguments_.slice(index + 1));
      break;
    }
    if (argument !== '-' && argument.startsWith('-')) {
      if (argument.startsWith('--regexp=')) patterns.push(argument.slice('--regexp='.length));
      if (argument.startsWith('--file=')) hasPatternFile = true;
      if (valueOptions?.has(argument)) {
        const value = arguments_.at(index + 1);
        if ((argument === '-e' || argument === '--regexp') && value !== undefined) {
          patterns.push(value);
        }
        if (argument === '-f' || argument === '--file') hasPatternFile = true;
        index += 1;
      }
      continue;
    }
    values.push(argument);
  }
  return { hasPatternFile, patterns, values };
};

/** Which regular expression syntax a search command reads its pattern in. Short flags may be clustered (`grep -rnE`). */
const searchDialect = (name: string, arguments_: readonly string[]): SearchPatternDialect => {
  const hasFlag = (short: string, long: readonly string[]): boolean =>
    arguments_.some(
      (argument) =>
        long.includes(argument) || (/^-[A-Z]+$/iu.test(argument) && argument.includes(short)),
    );
  if (name === 'ag' || name === 'ack') return hasFlag('Q', ['--literal']) ? 'fixed' : 'extended';
  if (hasFlag('F', ['--fixed-strings'])) return 'fixed';
  if (name !== 'grep') return 'extended';
  return hasFlag('E', ['--extended-regexp']) || hasFlag('P', ['--perl-regexp'])
    ? 'extended'
    : 'basic';
};

/**
 * `sed -i`, `-i.bak`, `-ni`, `--in-place`, and `--in-place=.bak` all rewrite the
 * file, so the command is not a read even with `-n`.
 */
const isSedInPlace = (word: string): boolean =>
  word === '--in-place' || word.startsWith('--in-place=') || /^-[A-Za-z]*i/u.test(word);

/**
 * A sed script that writes a file (`w out`, `s/a/b/w out`) or runs a command
 * (`e`, `s/a/b/e`). Matches loosely: a false match only costs the action title.
 */
const SED_WRITE_SCRIPT = /(?:^|[;{}\s\d$])[wWe](?:\s|$)|\/[gpiImM\d]*[we](?:\s|;|$)/u;

/** Whether a stage that otherwise reads or filters also writes a file or runs a command. */
const writesFiles = (name: string, arguments_: readonly string[]): boolean => {
  switch (name) {
    case 'sed': {
      return arguments_.some(
        (word) => isSedInPlace(word) || (!word.startsWith('-') && SED_WRITE_SCRIPT.test(word)),
      );
    }
    case 'sort': {
      // `-o FILE`, `--output=FILE`, and clusters like `-uo FILE` write the sorted result.
      return arguments_.some((word) => word.startsWith('--output') || /^-[A-Za-z]*o/u.test(word));
    }
    case 'uniq': {
      // `uniq in out` writes its second operand.
      return arguments_.filter((word) => word === '-' || !word.startsWith('-')).length > 1;
    }
    default: {
      return false;
    }
  }
};

const describeStage = (words: readonly string[]): ExploreAction | null => {
  const [name = '', ...arguments_] = words;
  const { hasPatternFile, patterns, values } = positionals(name, arguments_);
  const hasOptionScript = hasPatternFile || patterns.length > 0;
  if (READ_COMMANDS.has(name)) return values.length > 0 ? { kind: 'read', paths: values } : null;
  if (name === 'sed') {
    // Only `sed -n '1,40p' file` prints a file; any other script edits or transforms it.
    if (!arguments_.includes('-n') || writesFiles(name, arguments_)) return null;
    const paths = hasOptionScript ? values : values.slice(1);
    return paths.length > 0 ? { kind: 'read', paths } : null;
  }
  if (SEARCH_COMMANDS.has(name)) {
    if (name === 'rg' && arguments_.includes('--files')) {
      const path = values.at(0);
      return path === undefined ? { kind: 'list' } : { kind: 'list', path };
    }
    // Patterns read from a file have no name to show.
    if (hasPatternFile) return null;
    const optionPatterns = patterns.length > 0 ? patterns : undefined;
    const searched = optionPatterns ?? values.slice(0, 1);
    if (searched.length === 0) return null;
    const dialect = searchDialect(name, arguments_);
    const terms = searched.flatMap((pattern) => searchPatternTerms(pattern, dialect));
    const pattern = searched.join(' ');
    const path = values.at(optionPatterns ? 0 : 1);
    return path === undefined
      ? { kind: 'search', pattern, terms }
      : { kind: 'search', path, pattern, terms };
  }
  if (name === 'find' && arguments_.some((argument) => FIND_ACTIONS.has(argument))) return null;
  if (
    name === 'fd' &&
    arguments_.some((argument) => FD_ACTIONS.has(argument.replace(/=.*$/su, '')))
  ) {
    return null;
  }
  if (LIST_COMMANDS.has(name)) {
    const path = values.at(0);
    return path === undefined ? { kind: 'list' } : { kind: 'list', path };
  }
  return null;
};

/**
 * One pipeline that explores: its first stage reads, searches, or lists, and
 * every later stage only filters what it printed. A search over a file listing
 * (`rg --files src | rg test`) finds files by name.
 */
const describeExplorePipeline = (stages: readonly string[][]): ExploreAction | null => {
  const [first = [], ...rest] = stages;
  const action = describeStage(first);
  if (!action) return null;
  let filtered: ExploreAction = action;
  for (const words of rest) {
    const [name = '', ...arguments_] = words;
    if (FILTER_COMMANDS.has(name)) {
      if (writesFiles(name, arguments_)) return null;
      continue;
    }
    if (!SEARCH_COMMANDS.has(name)) return null;
    const filter = describeStage(words);
    if (filter?.kind !== 'search' || filtered.kind !== 'list') return null;
    filtered = {
      isFileNames: true,
      kind: 'search',
      pattern: filter.pattern,
      terms: filter.terms,
      ...(filtered.path !== undefined && { path: filtered.path }),
    };
  }
  return filtered;
};

/**
 * Several explorations chained with `&&` or `;` read as one when they do the
 * same thing: reads list every file, and searches or listings keep the first.
 */
const mergeExplorations = (actions: readonly ExploreAction[]): ExploreAction | null => {
  const first = actions.at(0);
  if (!first || actions.some((action) => action.kind !== first.kind)) return null;
  if (first.kind !== 'read') return first;
  const paths = actions.flatMap((action) => (action.kind === 'read' ? action.paths : []));
  return { kind: 'read', paths: [...new Set(paths)] };
};

/** Package runners that only fetch or locate the tool they start: `bunx vitest`, `npx jest`. */
const RUNNER_PREFIXES = new Set(['bunx', 'npx', 'pnpx']);

/** Tools that start another tool after one subcommand (`pnpm exec`, `uv run`, `python -m`). */
const RUNNER_SUBCOMMANDS: Readonly<Record<string, readonly string[] | undefined>> = {
  bun: ['x'],
  pnpm: ['exec', 'dlx'],
  poetry: ['run'],
  python: ['-m'],
  python3: ['-m'],
  uv: ['run'],
  yarn: ['exec', 'dlx'],
};

const withoutRunner = (words: readonly string[]): string[] => {
  const [name = '', second = ''] = words;
  let rest: string[];
  if (RUNNER_PREFIXES.has(name)) rest = words.slice(1);
  else if (RUNNER_SUBCOMMANDS[name]?.includes(second)) rest = words.slice(2);
  else return [...words];
  // The runner's own flags (`bunx --bun`, `npx -y`) come before the tool.
  while (rest[0]?.startsWith('-')) rest = rest.slice(1);
  return rest;
};

/** Test runners started by name, and the subcommand that must follow when the tool does more than test. */
const TEST_RUNNERS: Readonly<Record<string, string | undefined>> = {
  ava: undefined,
  cargo: 'test',
  deno: 'test',
  dotnet: 'test',
  go: 'test',
  jest: undefined,
  mix: 'test',
  mocha: undefined,
  phpunit: undefined,
  playwright: 'test',
  pytest: undefined,
  rspec: undefined,
  swift: 'test',
  vitest: undefined,
};

/** Options of a test run whose value is the next word and never a test file (`-c vitest.config.ts`). */
const TEST_VALUE_OPTIONS = new Set([
  '-c',
  '--config',
  '-t',
  '--testNamePattern',
  '-g',
  '--grep',
  '--project',
  '--reporter',
  '--shard',
  '-k',
  '-m',
]);

const PACKAGE_MANAGERS = new Set(['bun', 'npm', 'pnpm', 'yarn']);

/**
 * The words after the runner when `words` runs tests: a test runner
 * (`vitest run`, `go test`), or a package script named `test` or `test:*`
 * (`bun run test`, `pnpm test:unit`). `undefined` for anything else.
 */
const testArguments = (words: readonly string[]): string[] | undefined => {
  const [name = '', second = '', third = ''] = words;
  if (PACKAGE_MANAGERS.has(name)) {
    const isRun = second === 'run' || second === 'run-script';
    const script = isRun ? third : second;
    // `bun test` is Bun's own runner and `npm t` npm's alias; both pass the rest on like a `test` script.
    if (/^test(?::|$)/u.test(script) || (name === 'npm' && script === 't'))
      return words.slice(isRun ? 3 : 2);
    // `pnpm vitest` and `bun run vitest` start the project's own runner binary.
    const rest = words.slice(isRun ? 2 : 1);
    return Object.hasOwn(TEST_RUNNERS, script) ? testArguments(rest) : undefined;
  }
  if (!Object.hasOwn(TEST_RUNNERS, name)) return undefined;
  const subcommand = TEST_RUNNERS[name];
  if (subcommand !== undefined) return second === subcommand ? words.slice(2) : undefined;
  if (name === 'vitest' && (second === 'bench' || second === 'init')) return undefined;
  return words.slice(1).filter((word) => word !== 'run' && word !== 'watch');
};

/**
 * The test files or directories a test run names, skipping options and their
 * values. A bare word that is not a path (a test name filter) is left out.
 */
const testTargets = (arguments_: readonly string[]): string[] => {
  const targets: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index] ?? '';
    if (argument.startsWith('-')) {
      if (TEST_VALUE_OPTIONS.has(argument)) index += 1;
      continue;
    }
    if (/[/\\]|\.[a-z]+$/iu.test(argument)) targets.push(argument);
  }
  return targets;
};

/** Git subcommands that only look at or stage the work, so `git add -A && git commit -m x` still reads as a commit. */
const GIT_SETUP_COMMANDS = new Set(['add', 'status', 'diff', 'log', 'fetch', 'show', 'stash']);

/**
 * What one command (its first pipeline stage) does among tests, Git, and CLI
 * steps: `setup` for a step such as `cd` or `git add` that only prepares the
 * action next to it.
 */
const describeStep = (words: readonly string[], text: string): StepAction | 'setup' | null => {
  const [name = ''] = words;
  if (name === 'cd') return 'setup';
  if (name === 'git') {
    let rest = words.slice(1);
    // Global options before the subcommand (`git -C apps/server commit`).
    while (rest[0] === '-C' || rest[0] === '-c') rest = rest.slice(2);
    const [subcommand = '', ...arguments_] = rest;
    if (GIT_SETUP_COMMANDS.has(subcommand)) return 'setup';
    if (subcommand === 'commit') {
      const message = optionValue(arguments_, ['-m', '--message', '-am']);
      return {
        isPushed: false,
        kind: 'commit',
        ...(message?.trim() && { message: message.trim() }),
      };
    }
    if (subcommand === 'push') {
      const [, branch] = arguments_.filter((word) => !word.startsWith('-'));
      return branch ? { branch, kind: 'push' } : { kind: 'push' };
    }
    return null;
  }
  const cliStep = describeCliStep(words);
  if (cliStep === 'other') return { kind: 'other' };
  if (cliStep) return { kind: 'cli', title: cliStep };
  const arguments_ = testArguments(withoutRunner(words));
  if (arguments_ === undefined) return null;
  return { command: text, kind: 'test', targets: testTargets(arguments_) };
};

/**
 * Steps chained together read as one when they are one action with its
 * preparation (`git add -A && git commit`), or the same action repeated: test
 * runs list every target, and a commit followed by a push reads as both.
 */
const mergeSteps = (steps: readonly StepAction[]): StepAction | null => {
  const first = steps.at(0);
  if (!first) return null;
  if (first.kind === 'test' && steps.every((step) => step.kind === 'test'))
    return {
      ...first,
      targets: [...new Set(steps.flatMap((step) => (step.kind === 'test' ? step.targets : [])))],
    };
  if (first.kind === 'commit' && steps.slice(1).every((step) => step.kind === 'push'))
    return { ...first, isPushed: steps.length > 1 };
  return steps.length === 1 ? first : null;
};

/**
 * Reads an unwrapped shell command as the action it performs; anything else
 * returns `null`. Within each command only the first pipeline stage acts, and
 * every later stage must be a filter such as `head`. A leading `cd <dir>` only
 * moves where the rest runs.
 */
export const describeShellCommand = (command: string): ShellCommandAction | null => {
  const inlined = inlineHeredocInputs(inlineHeredocSubstitutions(command.trim()));
  const listed = splitList(inlined.replaceAll(OUTPUT_PLUMBING, ''));
  if (!listed) return null;
  const parsed: Array<{ stages: string[][]; text: string }> = [];
  for (const stages of withoutCapturedOutput(listed)) {
    const words = stages.map((stage) => splitWords(stage));
    if (words.some((stage) => !stage?.[0])) return null;
    const [first = [], ...rest] = words as string[][];
    const unwrapped = withoutWrappers(first);
    if (unwrapped.length === 0) return null;
    parsed.push({
      stages: [unwrapped, ...rest.map((stage) => withoutWrappers(stage))],
      text: unwrapped.join(' '),
    });
  }
  const body = parsed.filter(({ stages }, index) => index > 0 || stages[0]?.[0] !== 'cd');
  const explorations = body.map(({ stages }) => describeExplorePipeline(stages));
  if (explorations.length > 0 && explorations.every(Boolean))
    return mergeExplorations(explorations as ExploreAction[]);
  const steps: StepAction[] = [];
  for (const { stages, text } of body) {
    const [first = [], ...rest] = stages;
    if (rest.some(([name = '']) => !FILTER_COMMANDS.has(name))) return null;
    const step = describeStep(first, text);
    if (step === null) return null;
    if (step !== 'setup') steps.push(step);
  }
  return mergeSteps(steps);
};
