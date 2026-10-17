import { run } from './exec';
import { getConfig, mountDir } from './paths';
import { resolveMount } from './routing';
import type { RepoMount } from './types';

/** A selected file resolved against its mount's merge base with the configured base ref. */
export interface BaseLocation {
  baseCommit: string;
  /** Mount-relative path of the file at the merge base; differs from `subPath` after a rename. */
  basePath: string;
  baseRef: string;
  mount: RepoMount;
  subPath: string;
}

/** Parse `git diff --name-status -z --diff-filter=R` output into a new-path → old-path map. */
export const parseRenames = (output: string): Map<string, string> => {
  const renames = new Map<string, string>();
  const fields = output.split('\0');
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [status, from, to] = fields.slice(index, index + 3);
    if (status.startsWith('R')) renames.set(to, from);
  }
  return renames;
};

/**
 * Resolve files to their mount's merge base, computing each merge base and
 * rename map once. Renames matter because a split starts with a move-only
 * commit (`Foo.tsx` → `Foo/index.tsx`); without them, a moved file looks new.
 * Returns undefined when the mount has no base ref or the base is unavailable
 * locally: base-dependent checks are best-effort and skip instead of failing.
 */
export const createBaseLocator = () => {
  const bases = new Map<
    RepoMount,
    Promise<{ baseCommit: string; renames: Map<string, string> } | undefined>
  >();

  const resolveBase = async (mount: RepoMount, baseRef: string) => {
    const cwd = mountDir(mount);
    const mergeBase = await run('git', ['merge-base', 'HEAD', baseRef], cwd);
    const baseCommit = mergeBase.code === 0 ? mergeBase.stdout.trim() : '';
    if (!baseCommit) return;

    // Diffing the base against the working tree covers committed and staged renames.
    const diff = await run(
      'git',
      ['diff', '-M', '--name-status', '-z', '--diff-filter=R', baseCommit],
      cwd,
    );
    return { baseCommit, renames: diff.code === 0 ? parseRenames(diff.stdout) : new Map() };
  };

  return async (file: string): Promise<BaseLocation | undefined> => {
    const { mount, subPath } = resolveMount(getConfig().repos, file);
    if (!mount.baseRef) return;

    let base = bases.get(mount);
    if (!base) {
      base = resolveBase(mount, mount.baseRef);
      bases.set(mount, base);
    }

    const resolved = await base;
    if (!resolved) return;

    return {
      baseCommit: resolved.baseCommit,
      basePath: resolved.renames.get(subPath) ?? subPath,
      baseRef: mount.baseRef,
      mount,
      subPath,
    };
  };
};
