import type { WorkingDirConfig } from '@lobechat/types';
import { getWorkingDirSourcePath } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { topicSelectors } from '@/store/chat/selectors';
import { getChatStoreState } from '@/store/chat/store';

/**
 * Detect `git worktree add <path>` in a heterogeneous CLI agent's shell tool call
 * and flip the active topic's working-directory state into that worktree.
 *
 * Runs from the `claude-code` / `codex` executor's `onAfterCall` hook (renderer-side,
 * fired on `tool_end`). Mirrors what `WorktreeSwitcher` writes on a manual selection:
 * only `git.activeWorktree` / `isWorktree` change — the CLI session cwd stays anchored
 * to the source repo (hetero anchors cwd to source; the worktree is a record).
 */

/** Flags on `git worktree add` that consume the following token as their value. */
const VALUE_FLAGS = new Set(['-b', '-B', '--reason']);

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
const isAssignment = (t: string) => /^[A-Z_]\w*=/i.test(t);

/**
 * If ONE command's tokens are a real `git … worktree add <path>` invocation, return
 * the path (resolved against the source cwd, honoring a `-C <dir>` override).
 * Requires the executable to actually be `git` — so `echo git worktree add …` or
 * `rg "git worktree add"` never match.
 */
const parseGitWorktreeAddTokens = (tokens: string[], cwd?: string): string | undefined => {
  let i = 0;

  // Strip leading `VAR=val` assignments and command wrappers (sudo/env/…).
  while (i < tokens.length && (isAssignment(tokens[i]) || WRAPPERS.has(stripQuotes(tokens[i])))) {
    i += 1;
  }
  if (stripQuotes(tokens[i] ?? '') !== 'git') return undefined;
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
  for (; i < tokens.length; i += 1) {
    if (VALUE_FLAGS.has(tokens[i])) {
      i += 1; // skip this flag's value
      continue;
    }
    if (tokens[i].startsWith('-')) continue; // other flags
    const path = stripQuotes(tokens[i]);
    if (path) return resolveWorktreePath(path, baseCwd);
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
  if (Array.isArray(command)) {
    // Already-tokenized argv → a single command, boundaries preserved.
    return command.every((t) => typeof t === 'string')
      ? parseGitWorktreeAddTokens(command, cwd)
      : undefined;
  }
  if (typeof command !== 'string' || !/\bworktree\s+add\b/.test(command)) return undefined;
  for (const segment of command.split(/[\n;|&]/)) {
    const path = parseGitWorktreeAddTokens(tokenize(segment), cwd);
    if (path) return path;
  }
  return undefined;
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

  const worktreePath = parseWorktreeAddPath(command, source);
  if (!worktreePath || !source || worktreePath === source) return;

  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    activeWorktree: worktreePath,
    isWorktree: true,
  };
  const nextConfig: WorkingDirConfig = {
    ...currentConfig,
    git,
    path: source,
    ...(currentConfig?.repoType ? { repoType: currentConfig.repoType } : {}),
  };

  if (isEqual(currentConfig, nextConfig)) return;
  await state.updateTopicMetadata(topicId, { workingDirectoryConfig: nextConfig });
};
