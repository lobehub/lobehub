import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Derive the superproject root from a submodule's resolved gitdir: a
 * submodule checkout stores its git data under the host's
 * `<hostRoot>/.git/modules/<name>`. Returns null for anything else (a
 * standalone clone has a `.git` directory, a linked worktree points into
 * `.git/worktrees`).
 */
export const hostRootFromGitdir = (gitdir: string): string | null => {
  const marker = `${path.sep}.git${path.sep}modules${path.sep}`;
  const index = gitdir.lastIndexOf(marker);
  return index === -1 ? null : gitdir.slice(0, index);
};

/**
 * When this repo is mounted as a git submodule of a superproject that ships
 * its own `check` script, return that superproject's root so the standalone
 * entry can delegate — the host entry routes this repo's files through the
 * same engine with the host's full config, so both entries behave
 * identically no matter where they are invoked from.
 */
export const detectHostCheckRoot = async (repoRoot: string): Promise<string | null> => {
  const gitPath = path.join(repoRoot, '.git');
  let content: string;
  try {
    if ((await stat(gitPath)).isDirectory()) return null;
    content = await readFile(gitPath, 'utf8');
  } catch {
    return null;
  }

  // The gitfile format is exactly `gitdir: <path>` (git's repository-layout docs)
  const match = content.match(/^gitdir: ?(.+)$/m);
  if (!match) return null;
  const hostRoot = hostRootFromGitdir(path.resolve(repoRoot, match[1].trim()));
  if (!hostRoot) return null;

  try {
    const pkg = JSON.parse(await readFile(path.join(hostRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts?.check ? hostRoot : null;
  } catch {
    return null;
  }
};
