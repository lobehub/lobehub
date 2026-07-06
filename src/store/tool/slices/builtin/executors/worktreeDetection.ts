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

/**
 * Pull the shell command out of a tool call's parsed `params`. Only reads the
 * `command`/`cmd` field (CC `Bash`, Codex shell) — deliberately NOT `content`, so
 * a `writeFile` whose body happens to contain "git worktree add" never misfires.
 * Codex may send the command as an argv array; join it.
 */
const extractCommand = (params: unknown): string | undefined => {
  if (!params || typeof params !== 'object') return undefined;
  const raw = (params as any).command ?? (params as any).cmd;
  if (Array.isArray(raw))
    return raw.every((x) => typeof x === 'string') ? raw.join(' ') : undefined;
  return typeof raw === 'string' ? raw : undefined;
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
 * If ONE shell segment is a real `git … worktree add <path>` invocation, return the
 * path (resolved against the source cwd, honoring a `-C <dir>` override). Requires
 * the executable to actually be `git` — so `echo git worktree add …` or
 * `rg "git worktree add"` (P2) never match.
 */
const parseGitWorktreeAddSegment = (segment: string, cwd?: string): string | undefined => {
  const tokens = tokenize(segment);
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
 * Parse a shell tool call's `params` for a real `git worktree add <path>` invocation
 * and return the target worktree path (resolved to absolute against `cwd` when
 * relative). Returns `undefined` when the call isn't an actual worktree-add.
 */
export const parseWorktreeAddPath = (params: unknown, cwd?: string): string | undefined => {
  const command = extractCommand(params);
  // Cheap pre-filter, then verify each shell segment is truly a `git` invocation.
  if (!command || !/\bworktree\s+add\b/.test(command)) return undefined;
  for (const segment of command.split(/[\n;|&]/)) {
    const path = parseGitWorktreeAddSegment(segment, cwd);
    if (path) return path;
  }
  return undefined;
};

/**
 * If the tool call was a successful `git worktree add`, record the new worktree as
 * the ACTIVE topic's active one. `onAfterCall` carries no run topicId, so this
 * targets `activeTopicId` — during a CLI run that IS the run's topic (mirrors how
 * other executors, e.g. Task, key off active store state). No-op when the worktree
 * resolves to the source path itself or nothing would change.
 */
export const applyWorktreeAddFromToolCall = async (params: unknown): Promise<void> => {
  const state = getChatStoreState();
  const topicId = state.activeTopicId;
  if (!topicId) return;

  const topic = topicSelectors.getTopicById(topicId)(state);
  const currentConfig = topic?.metadata?.workingDirectoryConfig;
  const source = getWorkingDirSourcePath(currentConfig) ?? topic?.metadata?.workingDirectory;

  const worktreePath = parseWorktreeAddPath(params, source);
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
