import type { DeviceGitLinkedPullRequest, WorkingDirConfig } from '@lobechat/types';
import { getWorkingDirSourcePath } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { topicSelectors } from '@/store/chat/selectors';
import { getChatStoreState } from '@/store/chat/store';

/**
 * Detect git / gh side effects in a heterogeneous CLI agent's successful shell
 * tool call and mirror them onto the run topic's working-directory metadata.
 *
 * Runs from the `claude-code` / `codex` executor's `onAfterCall` hook
 * (renderer-side, fired on `tool_end`). The CLI session cwd stays anchored to
 * the source repo; selected worktree / branch / linked PR are topic metadata.
 */

/** Flags on `git worktree add` that consume the following token as their value. */
const VALUE_FLAGS = new Set(['-b', '-B', '--reason']);
const BRANCH_VALUE_FLAGS = new Set(['-b', '-B', '--orphan']);
const BRANCH_SWITCH_VALUE_FLAGS = new Set([
  '-b',
  '-B',
  '-c',
  '-C',
  '--create',
  '--force-create',
  '--orphan',
]);
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

interface WorktreeAddInfo {
  branch?: string;
  path: string;
}

interface BranchSwitchInfo {
  branch: string;
}

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
  if (!value || value === '-') return undefined;
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
  parser: (tokens: string[]) => T | undefined,
): T | undefined => {
  if (Array.isArray(command)) {
    return command.every((t) => typeof t === 'string') ? parser(command) : undefined;
  }
  if (typeof command !== 'string') return undefined;

  for (const segment of command.split(/[\n;|&]/)) {
    const result = parser(tokenize(segment));
    if (result) return result;
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

const getOptionValue = (tokens: string[], index: number, flags: readonly string[]) => {
  const token = tokens[index];
  const inlineValue = getInlineFlagValue(token, flags) ?? getShortFlagValue(token, flags);
  if (inlineValue !== undefined) return { value: stripQuotes(inlineValue) };
  if (flags.includes(stripQuotes(token))) {
    return { skipNext: true, value: stripQuotes(tokens[index + 1] ?? '') };
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

const parseGitBranchSwitchTokens = (tokens: string[]): BranchSwitchInfo | undefined => {
  const git = parseGitSubcommand(tokens);
  if (!git || !GIT_BRANCH_SWITCH_SUBCOMMANDS.has(git.subcommand)) return undefined;

  let branch: string | undefined;
  for (let i = 0; i < git.args.length; i += 1) {
    const token = git.args[i];
    const branchFlag = getOptionValue(git.args, i, [...BRANCH_SWITCH_VALUE_FLAGS]);
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
    if (git.subcommand === 'switch') branch = normalizeBranch(token);
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

    const titleValue = getOptionValue(tokens, i, ['-t', '--title']);
    if (titleValue.value) {
      title = titleValue.value;
      if (titleValue.skipNext) i += 1;
      continue;
    }

    const headValue = getOptionValue(tokens, i, ['-H', '--head']);
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
  findInCommand(command, (tokens) => parseGhPrCreateTokens(tokens, resultContent));

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
 * If ONE command's tokens are a real `git … worktree add <path>` invocation, return
 * the path (resolved against the source cwd, honoring a `-C <dir>` override).
 * Requires the executable to actually be `git` — so `echo git worktree add …` or
 * `rg "git worktree add"` never match.
 */
const parseGitWorktreeAddTokens = (tokens: string[], cwd?: string): WorktreeAddInfo | undefined => {
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
      const dir = stripQuotes(tokens[i + 1] ?? '');
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

  // First positional after `add` is the worktree path.
  let branch: string | undefined;
  for (; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (BRANCH_VALUE_FLAGS.has(token)) {
      branch = stripQuotes(tokens[i + 1] ?? '') || branch;
      i += 1; // skip this flag's value
      continue;
    }
    if (VALUE_FLAGS.has(token)) {
      i += 1; // skip this flag's value
      continue;
    }
    if (token.startsWith('-')) continue; // other flags
    const path = stripQuotes(token);
    if (path) return { branch, path: resolveWorktreePath(path, baseCwd) };
  }
  return undefined;
};

const parseWorktreeAddInfo = (
  command: string | string[],
  cwd?: string,
): WorktreeAddInfo | undefined => {
  if (Array.isArray(command)) {
    // Already-tokenized argv → a single command, boundaries preserved.
    return command.every((t) => typeof t === 'string')
      ? parseGitWorktreeAddTokens(command, cwd)
      : undefined;
  }
  if (typeof command !== 'string' || !/\bworktree\s+add\b/.test(command)) return undefined;
  for (const segment of command.split(/[\n;|&]/)) {
    const info = parseGitWorktreeAddTokens(tokenize(segment), cwd);
    if (info) return info;
  }
  return undefined;
};

/**
 * Parse a shell command for a real `git worktree add <path>` invocation and return
 * the target worktree path (resolved to absolute against `cwd` when relative).
 *
 * `command` is a raw string (tokenized, split on shell separators) OR the argv
 * array form some CLIs use (Codex) — for the array we DON'T re-join+re-tokenize, so
 * a path token containing spaces (`['git','worktree','add','/tmp/my wt']`) keeps its
 * boundary. Returns `undefined` when the call isn't an actual worktree-add.
 */
export const parseWorktreeAddPath = (
  command: string | string[],
  cwd?: string,
): string | undefined => {
  return parseWorktreeAddInfo(command, cwd)?.path;
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

  const worktreeInfo = parseWorktreeAddInfo(command, source);
  const worktreePath = worktreeInfo?.path;
  if (!worktreePath || !source || worktreePath === source) return;

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

  const worktreeInfo = parseWorktreeAddInfo(command, source);
  if (worktreeInfo?.path && worktreeInfo.path !== source) {
    nextConfig = applyWorktreeAddToConfig(nextConfig, source, worktreeInfo);
  }

  const branchSwitch = parseGitBranchSwitch(command, resultContent);
  if (branchSwitch) {
    nextConfig = applyBranchToConfig(nextConfig, source, branchSwitch.branch);
  }

  const prCreate = parseGhPrCreate(command, resultContent);
  if (prCreate) {
    nextConfig = applyPullRequestToConfig(nextConfig, source, prCreate);
  }

  if (isEqual(currentConfig, nextConfig)) return;
  await state.updateTopicMetadata(topicId, { workingDirectoryConfig: nextConfig });
};
