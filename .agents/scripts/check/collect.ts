import { realpathSync } from 'node:fs';
import path from 'node:path';

import { git } from './exec';
import { getConfig, mountDir } from './paths';
import type { RepoMount } from './types';

const prefixed = (mount: RepoMount, files: string[]) =>
  mount.dir === '' ? files : files.map((file) => `${mount.dir}/${file}`);

/**
 * Changed files across the host repo and all mounted sub-repos, root-relative.
 * Default scope is the whole working tree vs HEAD (staged + unstaged +
 * untracked) so an agent's freshest edits are never skipped just because
 * something else is staged; `stagedOnly` narrows to the pre-commit scope.
 */
export const collectFromGit = async (stagedOnly = false): Promise<string[]> => {
  const { repos } = getConfig();
  // The host repo lists a mounted sub-repo as a bare gitlink entry — drop those.
  const gitlinks = new Set(repos.map((repo) => repo.dir).filter(Boolean));

  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      const dir = mountDir(repo);
      if (stagedOnly) {
        return prefixed(
          repo,
          await git(['diff', '--name-only', '--cached', '--diff-filter=d'], dir),
        );
      }
      return prefixed(repo, [
        ...(await git(['diff', '--name-only', 'HEAD', '--diff-filter=d'], dir)),
        ...(await git(['ls-files', '--others', '--exclude-standard'], dir)),
      ]);
    }),
  );

  return perRepo.flat().filter((file) => !gitlinks.has(file));
};

/**
 * Resolve a path through symlinks. A missing tail (e.g. a deleted file) is kept
 * as written below its nearest existing ancestor, so the ancestor's links still
 * resolve.
 */
const realpathOrSelf = (abs: string): string => {
  try {
    return realpathSync(abs);
  } catch {
    const parent = path.dirname(abs);
    return parent === abs ? abs : path.join(realpathOrSelf(parent), path.basename(abs));
  }
};

/**
 * Resolve CLI file args to root-relative paths; exits on paths outside the repo.
 *
 * Paths are routed by where they really live: a host path that links into a
 * mounted sub-repo (Cloud's `.agents/skills/<name>` -> `lobehub/.agents/skills/<name>`)
 * becomes the sub-repo path, so it gets that repo's pipeline and ignore files
 * instead of the host's fixers rewriting vendored sub-repo files. A link that
 * leaves the repo keeps its written path.
 */
export const normalizeArgs = (args: string[]): string[] => {
  const { rootDir } = getConfig();
  const realRoot = realpathOrSelf(rootDir);

  // A link and its target may both be passed; they normalize to one entry.
  const resolved = args.map((arg) => {
    const abs = path.resolve(process.cwd(), arg);
    const rel = path.relative(rootDir, abs);
    if (rel.startsWith('..')) {
      console.error(`✗ file outside repo: ${arg}`);
      process.exit(2);
    }
    const realRel = path.relative(realRoot, realpathOrSelf(abs));
    return realRel.startsWith('..') || path.isAbsolute(realRel) ? rel : realRel;
  });
  return [...new Set(resolved)];
};
