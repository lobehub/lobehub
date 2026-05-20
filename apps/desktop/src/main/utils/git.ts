import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { readdir } from 'fs-extra';

/**
 * Resolve the actual `.git` directory for a working tree.
 * Supports both standard layouts and worktree pointer files (`.git` as a regular file
 * containing `gitdir: <path>`).
 */
export const resolveGitDir = async (dirPath: string): Promise<string | undefined> => {
  const gitPath = path.join(dirPath, '.git');
  try {
    const content = await readFile(gitPath, 'utf8');
    const worktreeMatch = /^gitdir:\s*(\S.*)$/m.exec(content.trim());
    if (worktreeMatch) {
      const resolved = worktreeMatch[1].trim();
      return path.isAbsolute(resolved) ? resolved : path.resolve(dirPath, resolved);
    }
  } catch {
    // `.git` is a directory (EISDIR) or missing — fall through
  }
  try {
    const stat = await readdir(gitPath);
    if (stat.length > 0) return gitPath;
  } catch {
    return undefined;
  }
  return undefined;
};

/**
 * Resolve the common git dir — where shared state like `config` and
 * `packed-refs` lives. For linked worktrees, `resolveGitDir` returns
 * `.git/worktrees/<name>/` which has its own `HEAD` but no `config`;
 * the `commondir` pointer inside it resolves to the main repo's gitdir.
 */
export const resolveCommonGitDir = async (dirPath: string): Promise<string | undefined> => {
  const gitDir = await resolveGitDir(dirPath);
  if (!gitDir) return undefined;
  try {
    const commondir = (await readFile(path.join(gitDir, 'commondir'), 'utf8')).trim();
    if (!commondir) return gitDir;
    return path.isAbsolute(commondir) ? commondir : path.resolve(gitDir, commondir);
  } catch {
    return gitDir;
  }
};

// Match `github.com` only in a remote-URL host position: preceded by `@`, `/`,
// or line start (covers `git@github.com:`, `https://github.com/`,
// `ssh://git@github.com/`, etc.) and followed by `:` or `/`. Avoids matching
// look-alikes like `evilgithub.com` or `github.com.attacker.com`.
const GITHUB_REMOTE_HOST_RE = /(?:^|[@/])github\.com[:/]/m;

/**
 * Classify a working tree as `git` (plain) / `github` (origin points at github.com) /
 * `undefined` (not a git repo). Reads the shared gitdir's `config` so submodules and
 * linked worktrees resolve the same as the main repo.
 */
export const detectRepoType = async (dirPath: string): Promise<'git' | 'github' | undefined> => {
  const commonDir = await resolveCommonGitDir(dirPath);
  if (!commonDir) return undefined;
  try {
    const config = await readFile(path.join(commonDir, 'config'), 'utf8');
    if (GITHUB_REMOTE_HOST_RE.test(config)) return 'github';
    return 'git';
  } catch {
    return undefined;
  }
};
