import { isDesktop } from '@lobechat/const';
import type { DeviceGitLinkedPullRequest, WorkingDirConfig } from '@lobechat/types';
import { getWorkingDirSourcePath } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { mutate } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { gitService } from '@/services/git';
import { topicSelectors } from '@/store/chat/selectors';
import { getChatStoreState } from '@/store/chat/store';
import { getElectronStoreState } from '@/store/electron';

/**
 * Detect git / gh side effects in a heterogeneous CLI agent's successful shell
 * tool call and mirror them onto the run topic's working-directory metadata.
 *
 * Runs from the `claude-code` / `codex` executor's `onAfterCall` hook
 * (renderer-side, fired on `tool_end`). The CLI session cwd stays anchored to
 * the source repo; selected worktree / branch / linked PR are topic metadata.
 *
 * Command parsing is a trigger + hint, not the source of truth: a Codex-style
 * login-shell wrapper (`/bin/zsh -lc "…"`) is peeled off first, `$VAR`
 * references are expanded from assignments earlier in the same command, and a
 * path that still carries shell syntax after that is never recorded literally —
 * the real path is read back from the device's `git worktree list` (matched by
 * the branch hint), or nothing is recorded at all.
 */

/** Flags on `git worktree add` that consume the following token as their value. */
const VALUE_FLAGS = new Set(['-b', '-B', '--reason']);
const BRANCH_VALUE_FLAGS = new Set(['-b', '-B']);
const BRANCH_SWITCH_VALUE_FLAGS = new Set([
  '-b',
  '-B',
  '-c',
  '-C',
  '--create',
  '--force-create',
  '--orphan',
]);
const DETACH_FLAGS = new Set(['-d', '--detach']);
const GIT_BRANCH_SWITCH_SUBCOMMANDS = new Set(['checkout', 'switch']);
const GIT_SWITCH_VALUE_FLAGS = new Set(['--conflict', '--pathspec-from-file']);
const GH_VALUE_FLAGS = new Set([
  '-B',
  '-H',
  '-R',
  '-t',
  '--base',
  '--body',
  '--body-file',
  '--head',
  '--label',
  '--milestone',
  '--project',
  '--recover',
  '--repo',
  '--reviewer',
  '--template',
  '--title',
]);
const GH_GLOBAL_VALUE_FLAGS = new Set([
  '-R',
  '--config-dir',
  '--git-protocol',
  '--hostname',
  '--repo',
]);
const GITHUB_PR_URL_PATTERN = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/i;
const BRANCH_OUTPUT_PATTERNS = [
  /Switched to (?:a new )?branch ['"]([^'"\n]+)['"]/i,
  /Already on ['"]([^'"\n]+)['"]/i,
  /branch ['"]([^'"\n]+)['"] set up to track/i,
] as const;

/**
 * Claude Code's `EnterWorktree` / `ExitWorktree` move the session without ever
 * shelling out, so the `git worktree add` sniffing above cannot see them. Their
 * tool_result ships only CC's `message` string (the structured `worktreePath`
 * never leaves the tool), which makes these sentences the wire contract.
 */
const CC_ENTER_PATTERN = /^(?:Created|Entered) worktree at (.+?)(?: on branch (\S+))?\. /;
const CC_EXIT_PATTERN = /^Exited\b/;
/**
 * Said only on the branch that `chdir`s the SESSION into the worktree. A subagent
 * pinned to its own cwd gets "This agent's working directory …" instead, because it
 * moved only itself — recording that would claim the whole run had relocated.
 * Requiring this sentence fails CLOSED: if CC rewords it we stop recording, rather
 * than record a worktree the session is not in.
 */
const CC_SESSION_ENTER_MARKER = 'The session is now working in the worktree';

interface WorktreeAddInfo {
  branch?: string;
  path: string;
}

interface WorktreeAddParseResult {
  branch?: string;
  /** Resolved absolute path, present only when the command yielded a trustworthy literal. */
  path?: string;
  /** Positional commit-ish (often the checked-out branch) — hint for the device lookup. */
  ref?: string;
}

type BranchSwitchInfo = { branch: string } | { detached: true };

interface PullRequestCreateInfo {
  branch?: string;
  pullRequest: DeviceGitLinkedPullRequest;
}

const stripQuotes = (token: string): string => {
  if (token.length >= 2) {
    const first = token[0];
    const last = token.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1);
    }
  }
  return token;
};

const isAbsolute = (p: string): boolean =>
  p.startsWith('/') || p.startsWith('~') || /^[A-Z]:[\\/]/i.test(p) || p.startsWith('\\\\');

type ShellEnv = Record<string, string>;

const VAR_REFERENCE = /\$\{([A-Z_]\w*)\}|\$([A-Z_]\w*)/gi;

/** Expand `$VAR` / `${VAR}` from assignments seen earlier in the command; unknown refs stay. */
const expandShellVars = (value: string, env: ShellEnv): string =>
  value.replaceAll(VAR_REFERENCE, (ref, braced, bare) => env[braced ?? bare] ?? ref);

/** stripQuotes + variable expansion; single-quoted tokens never expand (shell semantics). */
const resolveToken = (token: string, env?: ShellEnv): string => {
  const value = stripQuotes(token);
  return !env || token.startsWith("'") ? value : expandShellVars(value, env);
};

/**
 * A path token still carrying shell syntax after expansion — an unknown `$VAR`,
 * `$(…)`, backticks, quotes from broken tokenization, or a `~` we cannot resolve
 * against the device home — is NOT the literal directory git created.
 */
const isLiteralPath = (p: string): boolean => !/["$'`]/.test(p) && !p.startsWith('~');

/**
 * Fold a pure-assignment segment (`WT=/x`, `export WT=/x A=b`) into the ongoing
 * env. Assignments prefixing a command (`WT=/x git …`) scope to that command only
 * and are NOT folded — the shell expands that command's args before applying them.
 */
const collectSegmentAssignments = (tokens: string[], env: ShellEnv): void => {
  const start = stripQuotes(tokens[0] ?? '') === 'export' ? 1 : 0;
  if (start >= tokens.length || !tokens.slice(start).every((t) => isAssignment(t))) return;
  for (let i = start; i < tokens.length; i += 1) {
    const eq = tokens[i].indexOf('=');
    env[tokens[i].slice(0, eq)] = resolveToken(tokens[i].slice(eq + 1), env);
  }
};

const getExecutableName = (token: string): string | undefined =>
  stripQuotes(token).split(/[\\/]/).at(-1)?.toLowerCase();

const isGitExecutable = (token: string): boolean => {
  const executable = getExecutableName(token);
  return executable === 'git' || executable === 'git.exe';
};

const isGhExecutable = (token: string): boolean => {
  const executable = getExecutableName(token);
  return executable === 'gh' || executable === 'gh.exe';
};

const normalizeBranch = (branch?: string): string | undefined => {
  const value = branch?.trim();
  // A `$`/backtick here is an unexpanded shell construct, not a branch name.
  if (!value || value === '-' || /[$`]/.test(value)) return undefined;
  return value.includes(':') ? value.split(':').at(-1) : value;
};

const getInlineFlagValue = (token: string, flags: readonly string[]): string | undefined => {
  const stripped = stripQuotes(token);
  for (const flag of flags) {
    if (stripped.startsWith(`${flag}=`)) return stripped.slice(flag.length + 1);
  }
};

const getShortFlagValue = (token: string, flags: readonly string[]): string | undefined => {
  const stripped = stripQuotes(token);
  for (const flag of flags) {
    if (flag.length === 2 && stripped.startsWith(flag) && stripped.length > flag.length) {
      return stripped.slice(flag.length);
    }
  }
};

const isAssignment = (t: string) => /^[A-Z_]\w*=/i.test(t);

const consumeCommandPreamble = (tokens: string[]): number => {
  let i = 0;
  while (i < tokens.length && (isAssignment(tokens[i]) || WRAPPERS.has(stripQuotes(tokens[i])))) {
    i += 1;
  }
  return i;
};

const findInCommand = <T>(
  command: string | string[],
  parser: (tokens: string[], env?: ShellEnv) => T | undefined,
): T | undefined => {
  if (Array.isArray(command)) {
    if (!command.every((t) => typeof t === 'string')) return undefined;
    // A shell-wrapped argv carries a raw shell string as its payload — recurse so
    // it gets the same separator splitting and `$VAR` expansion as the string form.
    const wrapped = unwrapShellArgv(command);
    if (wrapped !== undefined) return findInCommand(wrapped, parser);
    return parser(command);
  }
  if (typeof command !== 'string') return undefined;

  const env: ShellEnv = {};
  for (const segment of unwrapShellCommand(command).split(/[\n;|&]/)) {
    const tokens = tokenize(segment);
    const result = parser(tokens, env);
    if (result) return result;
    collectSegmentAssignments(tokens, env);
  }
};

const parseBranchFromGitOutput = (content?: string): string | undefined => {
  if (!content) return undefined;

  for (const pattern of BRANCH_OUTPUT_PATTERNS) {
    const branch = normalizeBranch(pattern.exec(content)?.[1]);
    if (branch) return branch;
  }
};

const parsePrUrlFromOutput = (content?: string): { number: number; url: string } | undefined => {
  const match = content?.match(GITHUB_PR_URL_PATTERN);
  if (!match) return undefined;

  return { number: Number(match[1]), url: match[0] };
};

const getOptionValue = (
  tokens: string[],
  index: number,
  flags: readonly string[],
  env?: ShellEnv,
) => {
  const token = tokens[index];
  const inlineValue = getInlineFlagValue(token, flags) ?? getShortFlagValue(token, flags);
  if (inlineValue !== undefined) return { value: resolveToken(inlineValue, env) };
  if (flags.includes(stripQuotes(token))) {
    return { skipNext: true, value: resolveToken(tokens[index + 1] ?? '', env) };
  }
  return {};
};

const parseGitSubcommand = (
  tokens: string[],
  cwd?: string,
): { args: string[]; baseCwd?: string; subcommand: string } | undefined => {
  let i = consumeCommandPreamble(tokens);
  if (!isGitExecutable(tokens[i] ?? '')) return undefined;
  i += 1;

  let baseCwd = cwd;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (tokens[i] === '-C') {
      const dir = stripQuotes(tokens[i + 1] ?? '');
      if (dir) baseCwd = resolveWorktreePath(dir, baseCwd);
      i += 2;
    } else if (GIT_VALUE_OPTS.has(tokens[i])) {
      i += 2;
    } else {
      i += 1;
    }
  }

  const subcommand = stripQuotes(tokens[i] ?? '');
  if (!subcommand) return undefined;

  return { args: tokens.slice(i + 1), baseCwd, subcommand };
};

const parseGitBranchSwitchTokens = (
  tokens: string[],
  env?: ShellEnv,
): BranchSwitchInfo | undefined => {
  const git = parseGitSubcommand(tokens);
  if (!git || !GIT_BRANCH_SWITCH_SUBCOMMANDS.has(git.subcommand)) return undefined;

  let branch: string | undefined;
  for (let i = 0; i < git.args.length; i += 1) {
    const token = git.args[i];
    if (DETACH_FLAGS.has(stripQuotes(token))) return { detached: true };

    const branchFlag = getOptionValue(git.args, i, [...BRANCH_SWITCH_VALUE_FLAGS], env);
    if (branchFlag.value) {
      branch = normalizeBranch(branchFlag.value);
      break;
    }
    if (branchFlag.skipNext) {
      i += 1;
      continue;
    }

    const valueFlag = getOptionValue(git.args, i, [...GIT_SWITCH_VALUE_FLAGS]);
    if (valueFlag.skipNext) {
      i += 1;
      continue;
    }
    if (token === '--') break;
    if (token.startsWith('-')) continue;

    // `git checkout <name>` is path-or-branch ambiguous. Use command-only
    // inference only for `git switch <branch>`, whose operand is a branch.
    if (git.subcommand === 'switch') branch = normalizeBranch(resolveToken(token, env));
    break;
  }

  return branch ? { branch } : undefined;
};

const isGitBranchSwitchCommand = (tokens: string[]): boolean | undefined => {
  const git = parseGitSubcommand(tokens);
  return git && GIT_BRANCH_SWITCH_SUBCOMMANDS.has(git.subcommand) ? true : undefined;
};

const parseGitBranchSwitch = (
  command: string | string[],
  resultContent?: string,
): BranchSwitchInfo | undefined => {
  const outputBranch = parseBranchFromGitOutput(resultContent);
  if (outputBranch && findInCommand(command, isGitBranchSwitchCommand)) {
    return { branch: outputBranch };
  }

  return findInCommand(command, parseGitBranchSwitchTokens);
};

const parseGhPrCreateTokens = (
  tokens: string[],
  resultContent?: string,
  env?: ShellEnv,
): PullRequestCreateInfo | undefined => {
  const prUrl = parsePrUrlFromOutput(resultContent);
  if (!prUrl) return undefined;

  let i = consumeCommandPreamble(tokens);
  if (!isGhExecutable(tokens[i] ?? '')) return undefined;
  i += 1;

  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (GH_GLOBAL_VALUE_FLAGS.has(stripQuotes(tokens[i]))) i += 2;
    else i += 1;
  }

  if (stripQuotes(tokens[i] ?? '') !== 'pr') return undefined;
  i += 1;
  if (stripQuotes(tokens[i] ?? '') !== 'create') return undefined;
  i += 1;

  let branch: string | undefined;
  let isDraft = false;
  let title: string | undefined;
  for (; i < tokens.length; i += 1) {
    const token = stripQuotes(tokens[i]);
    if (token === '--draft') {
      isDraft = true;
      continue;
    }

    const titleValue = getOptionValue(tokens, i, ['-t', '--title'], env);
    if (titleValue.value) {
      title = titleValue.value;
      if (titleValue.skipNext) i += 1;
      continue;
    }

    const headValue = getOptionValue(tokens, i, ['-H', '--head'], env);
    if (headValue.value) {
      branch = normalizeBranch(headValue.value) ?? branch;
      if (headValue.skipNext) i += 1;
      continue;
    }

    if (GH_VALUE_FLAGS.has(token)) {
      i += 1;
      continue;
    }
  }

  return {
    branch,
    pullRequest: {
      ...(isDraft ? { isDraft: true } : {}),
      number: prUrl.number,
      state: 'OPEN',
      title: title || `PR #${prUrl.number}`,
      url: prUrl.url,
    },
  };
};

const parseGhPrCreate = (
  command: string | string[],
  resultContent?: string,
): PullRequestCreateInfo | undefined =>
  findInCommand(command, (tokens, env) => parseGhPrCreateTokens(tokens, resultContent, env));

const applyBranchToConfig = (
  currentConfig: WorkingDirConfig | undefined,
  source: string,
  branch: string,
): WorkingDirConfig => {
  const branchChanged = currentConfig?.git?.branch !== branch;
  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    branch,
  };

  delete git.detached;
  if (branchChanged) delete git.github;

  return {
    ...currentConfig,
    git,
    path: source,
    ...(currentConfig?.repoType ? { repoType: currentConfig.repoType } : {}),
  };
};

const applyDetachedToConfig = (
  currentConfig: WorkingDirConfig | undefined,
  source: string,
): WorkingDirConfig => {
  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    detached: true,
  };

  delete git.branch;
  delete git.github;

  return {
    ...currentConfig,
    git,
    path: source,
    ...(currentConfig?.repoType ? { repoType: currentConfig.repoType } : {}),
  };
};

const applyPullRequestToConfig = (
  currentConfig: WorkingDirConfig | undefined,
  source: string,
  info: PullRequestCreateInfo,
): WorkingDirConfig => {
  const branch = info.branch ?? currentConfig?.git?.branch;
  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    ...(branch ? { branch } : {}),
    github: {
      pullRequest: info.pullRequest,
      pullRequestStatus: 'ok',
    },
  };

  delete git.detached;

  return {
    ...currentConfig,
    git,
    path: source,
    repoType: 'github',
  };
};

const applyWorktreeAddToConfig = (
  currentConfig: WorkingDirConfig | undefined,
  source: string,
  info: WorktreeAddInfo,
): WorkingDirConfig => {
  const branchChanged = !!info.branch && currentConfig?.git?.branch !== info.branch;
  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    activeWorktree: info.path,
    ...(info.branch ? { branch: info.branch } : {}),
    isWorktree: true,
  };

  if (info.branch) delete git.detached;
  if (branchChanged) delete git.github;

  return {
    ...currentConfig,
    git,
    path: source,
    ...(currentConfig?.repoType ? { repoType: currentConfig.repoType } : {}),
  };
};

/**
 * The session left the worktree and is back in the source repo. `branch` and the
 * linked `github` PR described the worktree's branch, not the source repo's, so they
 * are dropped rather than left pointing at a branch the topic is no longer on — the
 * source branch is unknown until the next `git switch` / `checkout` refreshes it.
 */
const applyWorktreeExitToConfig = (
  currentConfig: WorkingDirConfig | undefined,
  source: string,
): WorkingDirConfig => {
  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    isWorktree: false,
  };

  delete git.activeWorktree;
  if (currentConfig?.git?.isWorktree) {
    delete git.branch;
    delete git.github;
  }

  return {
    ...currentConfig,
    git,
    path: source,
    ...(currentConfig?.repoType ? { repoType: currentConfig.repoType } : {}),
  };
};

/** Collapse `.`/`..` segments in a POSIX path without touching the filesystem. */
const normalizePosix = (p: string): string => {
  const isAbs = p.startsWith('/');
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out.at(-1) !== '..') out.pop();
      else if (!isAbs) out.push('..');
    } else {
      out.push(part);
    }
  }
  return (isAbs ? '/' : '') + out.join('/');
};

const resolveWorktreePath = (p: string, cwd?: string): string => {
  // Windows / home-relative paths: can't resolve without the device fs, keep as-is.
  if (isAbsolute(p)) return p.startsWith('/') ? normalizePosix(p) : p;
  if (!cwd) return p;
  return normalizePosix(`${cwd}/${p}`);
};

const tokenize = (s: string): string[] => s.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];

/** `git` global options that consume the following token as their value. */
const GIT_VALUE_OPTS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
]);
/** Command wrappers that may precede the real `git` executable. */
const WRAPPERS = new Set(['sudo', 'env', 'command', 'nice', 'nohup', 'time']);

/**
 * Codex ships every shell tool call wrapped in a login shell — the wire command is
 * `/bin/zsh -lc "git worktree add …"` (or the argv form `['bash', '-lc', 'git …']`)
 * — so the head token is the shell, never `git`/`gh`, and the real command hides
 * inside a single quoted token. The display layer strips this wrapper
 * (`stripShellWrapper` in `packages/builtin-tools/src/codex/commandExecutionUtils.ts`
 * — keep the accepted shapes in sync), so parsing must strip it too, or the UI shows
 * a bare git command that this module silently rejected.
 */
const SHELL_WRAPPER_PATTERN =
  /^(?:\/usr\/bin\/env\s+)?(?:\/\S+\/)?(?:bash|sh|zsh)\s+(?:-lc|-c|-l\s+-c)\s+(\S[\s\S]*)$/;
const SHELL_EXECUTABLES = new Set(['bash', 'sh', 'zsh']);

/** Undo the shell's own quoting of the wrapper payload (`-lc "git \"…\""` → `git "…"`). */
const stripOuterShellQuotes = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;

  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote) return trimmed;

  const body = trimmed.slice(1, -1);
  if (quote === "'") return body.replaceAll("'\\''", "'");

  return body
    .replaceAll('\\"', '"')
    .replaceAll('\\`', '`')
    .replaceAll('\\$', '$')
    .replaceAll('\\\\', '\\');
};

/** `['/bin/zsh', '-lc', 'git …']` → `git …`; undefined when argv is not a shell wrapper. */
const unwrapShellArgv = (tokens: string[]): string | undefined => {
  let i = getExecutableName(tokens[0] ?? '') === 'env' ? 1 : 0;
  if (!SHELL_EXECUTABLES.has(getExecutableName(tokens[i] ?? '') ?? '')) return undefined;
  i += 1;
  if (stripQuotes(tokens[i] ?? '') === '-l') i += 1;
  const flag = stripQuotes(tokens[i] ?? '');
  if (flag !== '-c' && flag !== '-lc') return undefined;
  return tokens[i + 1];
};

/** Peel `bash|sh|zsh -lc "…"` layers off a raw command string until none remain. */
const unwrapShellCommand = (command: string): string => {
  let current = command;
  // Wrappers can nest (`zsh -lc 'bash -c "git …"'`) but only shallowly; each peel
  // strictly shortens the string, so the depth cap is a formality.
  for (let depth = 0; depth < 4; depth += 1) {
    const match = SHELL_WRAPPER_PATTERN.exec(current.trim());
    if (!match) break;
    const inner = stripOuterShellQuotes(match[1]);
    if (!inner) break;
    current = inner;
  }
  return current;
};

/**
 * If ONE command's tokens are a real `git … worktree add <path>` invocation, return
 * the path (resolved against the source cwd, honoring a `-C <dir>` override).
 * Requires the executable to actually be `git` — so `echo git worktree add …` or
 * `rg "git worktree add"` never match. When the path token stays shell syntax even
 * after `$VAR` expansion, `path` is omitted and only the branch/ref hints survive.
 */
const parseGitWorktreeAddTokens = (
  tokens: string[],
  cwd?: string,
  env?: ShellEnv,
): WorktreeAddParseResult | undefined => {
  let i = 0;

  // Strip leading `VAR=val` assignments and command wrappers (sudo/env/…).
  while (i < tokens.length && (isAssignment(tokens[i]) || WRAPPERS.has(stripQuotes(tokens[i])))) {
    i += 1;
  }
  if (!isGitExecutable(tokens[i] ?? '')) return undefined;
  i += 1;

  // git global options; `-C <dir>` rebases relative worktree paths.
  let baseCwd = cwd;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (tokens[i] === '-C') {
      const dir = resolveToken(tokens[i + 1] ?? '', env);
      if (dir) baseCwd = resolveWorktreePath(dir, baseCwd);
      i += 2;
    } else if (GIT_VALUE_OPTS.has(tokens[i])) {
      i += 2;
    } else {
      i += 1; // valueless flag or `--opt=val`
    }
  }

  // Subcommand must be exactly `worktree add`.
  if (stripQuotes(tokens[i] ?? '') !== 'worktree') return undefined;
  i += 1;
  if (stripQuotes(tokens[i] ?? '') !== 'add') return undefined;
  i += 1;

  // Positionals after `add`: first is the worktree path, second the commit-ish.
  let branch: string | undefined;
  let path: string | undefined;
  let ref: string | undefined;
  for (; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (BRANCH_VALUE_FLAGS.has(token)) {
      branch = resolveToken(tokens[i + 1] ?? '', env) || branch;
      i += 1; // skip this flag's value
      continue;
    }
    if (VALUE_FLAGS.has(token)) {
      i += 1; // skip this flag's value
      continue;
    }
    if (/^\d*[<>]/.test(token)) break; // redirection — git's args end here
    if (token.startsWith('-')) continue; // other flags
    const value = resolveToken(token, env);
    if (!value) continue;
    if (path === undefined) {
      path = value;
      continue;
    }
    ref = value;
    break;
  }
  if (path === undefined) return undefined;

  return {
    ...(branch ? { branch } : {}),
    ...(ref ? { ref } : {}),
    ...(isLiteralPath(path) ? { path: resolveWorktreePath(path, baseCwd) } : {}),
  };
};

const parseWorktreeAddInfo = (
  command: string | string[],
  cwd?: string,
): WorktreeAddParseResult | undefined => {
  if (Array.isArray(command)) {
    if (!command.every((t) => typeof t === 'string')) return undefined;
    // A shell-wrapped argv carries a raw shell string as its payload — recurse so
    // it gets the same separator splitting and `$VAR` expansion as the string form.
    const wrapped = unwrapShellArgv(command);
    if (wrapped !== undefined) return parseWorktreeAddInfo(wrapped, cwd);
    // Already-tokenized argv → a single command, boundaries preserved. No shell
    // ran, so tokens are literal — no assignments to collect or vars to expand.
    return parseGitWorktreeAddTokens(command, cwd);
  }
  if (typeof command !== 'string') return undefined;

  const unwrapped = unwrapShellCommand(command);
  if (!/\bworktree\s+add\b/.test(unwrapped)) return undefined;

  const env: ShellEnv = {};
  for (const segment of unwrapped.split(/[\n;|&]/)) {
    const tokens = tokenize(segment);
    const info = parseGitWorktreeAddTokens(tokens, cwd, env);
    if (info) return info;
    collectSegmentAssignments(tokens, env);
  }
  return undefined;
};

/**
 * Parse a shell command for a real `git worktree add <path>` invocation and return
 * the target worktree path (resolved to absolute against `cwd` when relative).
 * `$VAR` references are expanded from assignments earlier in the same command.
 *
 * `command` is a raw string (tokenized, split on shell separators) OR the argv
 * array form some CLIs use (Codex) — for the array we DON'T re-join+re-tokenize, so
 * a path token containing spaces (`['git','worktree','add','/tmp/my wt']`) keeps its
 * boundary. Returns `undefined` when the call isn't an actual worktree-add, or when
 * the path token cannot be statically resolved to a literal directory.
 */
export const parseWorktreeAddPath = (
  command: string | string[],
  cwd?: string,
): string | undefined => {
  return parseWorktreeAddInfo(command, cwd)?.path;
};

/**
 * Ground truth for a worktree-add whose path token never survives static parsing
 * (`git worktree add "$WT" …`, `$(mktemp -d)`, `~/wt`): ask the run's target
 * device which worktree actually holds the branch the command referenced. Fails
 * closed — no usable branch hint, no match, or an unreachable device records
 * nothing rather than a bogus literal.
 */
const resolveWorktreeAddFromDevice = async (
  parsed: WorktreeAddParseResult,
  source: string,
  boundDeviceId?: string,
): Promise<WorktreeAddInfo | undefined> => {
  const branchHint = normalizeBranch(parsed.branch ?? parsed.ref);
  if (!branchHint) return undefined;

  // The topic's bound device (written at dispatch) or, unbound, this machine.
  // Mirrors WorkingDirectorySection: the local device answers over IPC
  // (deviceId omitted), a remote one over RPC.
  const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
  const targetDeviceId = boundDeviceId ?? currentDeviceId;
  const isLocalDevice = isDesktop && !!targetDeviceId && targetDeviceId === currentDeviceId;

  try {
    const worktrees = await gitService.listGitWorktrees({
      deviceId: isLocalDevice ? undefined : targetDeviceId,
      path: source,
    });
    const match = worktrees.find((worktree) => worktree.branch === branchHint);
    if (!match) return undefined;
    return { ...(match.branch ? { branch: match.branch } : {}), path: match.path };
  } catch {
    return undefined;
  }
};

/**
 * Turn a parse result into a recordable worktree: trust a statically resolved
 * path directly, otherwise read the real one back from the device.
 */
const resolveWorktreeAddInfo = async (
  parsed: WorktreeAddParseResult | undefined,
  source: string,
  boundDeviceId?: string,
): Promise<WorktreeAddInfo | undefined> => {
  if (!parsed) return undefined;
  if (parsed.path) {
    const branch = normalizeBranch(parsed.branch);
    return { ...(branch ? { branch } : {}), path: parsed.path };
  }
  return resolveWorktreeAddFromDevice(parsed, source, boundDeviceId);
};

/**
 * Record a successful `git worktree add` as the run topic's active worktree. Writes
 * to the passed `topicId` (the bound operation's topic — from the `onAfterCall`
 * context), NOT the globally-active topic, so a run whose topic the user has
 * navigated away from still updates its own state. No-op when the worktree resolves
 * to the source path itself or nothing would change.
 */
export const recordWorktreeAdd = async (params: {
  command: string | string[];
  topicId: string;
}): Promise<void> => {
  const { command, topicId } = params;
  const state = getChatStoreState();

  const topic = topicSelectors.getTopicById(topicId)(state);
  const currentConfig = topic?.metadata?.workingDirectoryConfig;
  const source = getWorkingDirSourcePath(currentConfig) ?? topic?.metadata?.workingDirectory;
  if (!source) return;

  const worktreeInfo = await resolveWorktreeAddInfo(
    parseWorktreeAddInfo(command, source),
    source,
    topic?.metadata?.boundDeviceId,
  );
  if (!worktreeInfo || worktreeInfo.path === source) return;

  const nextConfig = applyWorktreeAddToConfig(currentConfig, source, worktreeInfo);

  if (isEqual(currentConfig, nextConfig)) return;
  await state.updateTopicMetadata(topicId, { workingDirectoryConfig: nextConfig });
};

/**
 * Record successful heterogeneous CLI shell side effects onto the run topic:
 * - `git worktree add` selects the created worktree and explicit branch.
 * - `git switch` / confirmed `git checkout` updates the branch snapshot.
 * - `gh pr create` binds the created PR URL to the topic.
 */
export const recordGitCommandEffects = async (params: {
  command: string | string[];
  resultContent?: string;
  topicId: string;
}): Promise<void> => {
  const { command, resultContent, topicId } = params;
  const state = getChatStoreState();

  const topic = topicSelectors.getTopicById(topicId)(state);
  const currentConfig = topic?.metadata?.workingDirectoryConfig;
  const source = getWorkingDirSourcePath(currentConfig) ?? topic?.metadata?.workingDirectory;
  if (!source) return;

  let nextConfig = currentConfig;

  const worktreeInfo = await resolveWorktreeAddInfo(
    parseWorktreeAddInfo(command, source),
    source,
    topic?.metadata?.boundDeviceId,
  );
  if (worktreeInfo && worktreeInfo.path !== source) {
    nextConfig = applyWorktreeAddToConfig(nextConfig, source, worktreeInfo);
  }

  const branchSwitch = parseGitBranchSwitch(command, resultContent);
  if (branchSwitch) {
    nextConfig =
      'detached' in branchSwitch
        ? applyDetachedToConfig(nextConfig, source)
        : applyBranchToConfig(nextConfig, source, branchSwitch.branch);
  }

  const prCreate = parseGhPrCreate(command, resultContent);
  if (prCreate) {
    nextConfig = applyPullRequestToConfig(nextConfig, source, prCreate);
  }

  if (!isEqual(currentConfig, nextConfig)) {
    await state.updateTopicMetadata(topicId, { workingDirectoryConfig: nextConfig });
  }

  // A checkout performed inside the heterogeneous CLI bypasses ChatInput's
  // BranchSwitcher, which normally refreshes this cache itself. Revalidate the
  // shared branch key so the control bar (and its branch-keyed PR lookup) follows
  // the repository's actual HEAD immediately after the tool call completes.
  if (branchSwitch) {
    const boundDeviceId = topic?.metadata?.boundDeviceId;
    const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
    const cacheDeviceId =
      currentDeviceId && boundDeviceId === currentDeviceId ? 'local' : boundDeviceId;
    await mutate(deviceKeys.gitBranch(cacheDeviceId ?? 'local', source));
  }
};

/**
 * Read the worktree CC entered out of `EnterWorktree`'s result message:
 *
 *   `${'Created' | 'Entered'} worktree at ${path}[ on branch ${branch}]. The session…`
 *
 * The path is delimited by ` on branch <ref>` or the `. ` before the next sentence,
 * so a path containing spaces survives; one containing `". "` would not. Returns
 * undefined unless the SESSION moved (see {@link CC_SESSION_ENTER_MARKER}).
 */
export const parseWorktreeEnterInfo = (content?: string): WorktreeAddInfo | undefined => {
  if (!content?.includes(CC_SESSION_ENTER_MARKER)) return undefined;

  const match = CC_ENTER_PATTERN.exec(content);
  const path = match?.[1]?.trim();
  if (!path) return undefined;

  const branch = normalizeBranch(match?.[2]);
  return { ...(branch ? { branch } : {}), path };
};

/**
 * Every successful `ExitWorktree` outcome — kept, removed, or "could not remove it"
 * — opens with `Exited …`, and all three leave the session back in its original
 * directory. The no-op ("no active EnterWorktree session") and the refusals are
 * validation failures, so they arrive with `success: false` and never get here.
 */
export const isWorktreeExitContent = (content?: string): boolean =>
  !!content && CC_EXIT_PATTERN.test(content);

/**
 * Record a successful `EnterWorktree` as the run topic's active worktree. Unlike
 * `git worktree add`, the path is never in the arguments — a bare call generates a
 * random name — so it is read back out of the result message.
 */
export const recordWorktreeEnter = async (params: {
  content?: string;
  topicId: string;
}): Promise<void> => {
  const { content, topicId } = params;
  const state = getChatStoreState();

  const topic = topicSelectors.getTopicById(topicId)(state);
  const currentConfig = topic?.metadata?.workingDirectoryConfig;
  const source = getWorkingDirSourcePath(currentConfig) ?? topic?.metadata?.workingDirectory;

  const worktreeInfo = parseWorktreeEnterInfo(content);
  if (!worktreeInfo || !source || worktreeInfo.path === source) return;

  const nextConfig = applyWorktreeAddToConfig(currentConfig, source, worktreeInfo);

  if (isEqual(currentConfig, nextConfig)) return;
  await state.updateTopicMetadata(topicId, { workingDirectoryConfig: nextConfig });
};

/**
 * Record a successful `ExitWorktree` — the session is back in its original directory,
 * so the topic drops its worktree whether it was kept on disk or removed. Keeping it
 * would leave the topic pointing at a directory the run has left (and, on `remove`,
 * one that no longer exists).
 */
export const recordWorktreeExit = async (params: {
  content?: string;
  topicId: string;
}): Promise<void> => {
  const { content, topicId } = params;
  if (!isWorktreeExitContent(content)) return;

  const state = getChatStoreState();

  const topic = topicSelectors.getTopicById(topicId)(state);
  const currentConfig = topic?.metadata?.workingDirectoryConfig;
  const source = getWorkingDirSourcePath(currentConfig) ?? topic?.metadata?.workingDirectory;
  if (!source) return;

  // Never in a worktree → nothing to clear, and don't materialize an empty `git`.
  const currentGit = currentConfig?.git;
  if (!currentGit?.activeWorktree && !currentGit?.isWorktree) return;

  const nextConfig = applyWorktreeExitToConfig(currentConfig, source);

  if (isEqual(currentConfig, nextConfig)) return;
  await state.updateTopicMetadata(topicId, { workingDirectoryConfig: nextConfig });
};
