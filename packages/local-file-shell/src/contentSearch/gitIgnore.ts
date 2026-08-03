import path from 'node:path';

import { execa } from 'execa';

import { createLogger } from '../logger';

const logger = createLogger('contentSearch:gitIgnore');

/** Whether git considers `target` itself ignored. False when git can't answer. */
const isIgnored = async (target: string): Promise<boolean> => {
  try {
    const { exitCode } = await execa('git', ['check-ignore', '--no-index', '-q', target], {
      cwd: path.dirname(target),
      reject: false,
    });
    return exitCode === 0;
  } catch {
    return false;
  }
};

/**
 * Drop results that git would ignore.
 *
 * `rg` and `ag` read ignore files themselves; `grep` and the Node fallback have
 * no such notion, so the same query returns different results depending on which
 * engine ran. Rather than reimplement gitignore semantics (nested ignore files,
 * negations, `.git/info/exclude`, `core.excludesFile`), shell out to
 * `git check-ignore`, which *is* the semantics — one batched call for the whole
 * result set via `--stdin`.
 *
 * Best-effort by design: outside a repo, or when git is unavailable, the caller
 * keeps its unfiltered results. This is a noise filter, not a security boundary.
 */
export const filterGitIgnored = async (
  searchPath: string,
  absolutePaths: string[],
): Promise<string[]> => {
  if (absolutePaths.length === 0) return absolutePaths;

  // An explicitly requested root wins over the ignore rules — the same call that
  // `rg <ignored-dir>` honours. Without this, deliberately searching `dist/`
  // would come back empty from every engine except ripgrep.
  if (await isIgnored(searchPath)) return absolutePaths;

  const unique = [...new Set(absolutePaths)];

  try {
    // `check-ignore` needs a repo cwd; a non-repo exits 128 and we bail below.
    const { stdout, exitCode } = await execa(
      'git',
      ['check-ignore', '--no-index', '--stdin', '-z'],
      {
        cwd: searchPath,
        input: unique.join('\0'),
        reject: false,
        stripFinalNewline: false,
      },
    );

    // 0 = some paths ignored, 1 = none ignored, anything else (128 = not a repo,
    // 127 = git missing) means we cannot answer and must not drop anything.
    if (exitCode !== 0 && exitCode !== 1) return absolutePaths;

    const ignored = new Set(stdout.split('\0').filter(Boolean));
    if (ignored.size === 0) return absolutePaths;

    return absolutePaths.filter((p) => !ignored.has(p));
  } catch (error) {
    logger.debug('git check-ignore unavailable, keeping unfiltered results:', error);
    return absolutePaths;
  }
};

/**
 * Apply {@link filterGitIgnored} to match lines that carry a leading file path
 * (`<abs path>`, `<abs path>:12:text`, `<abs path>:3`).
 *
 * The path is split off at the first `:` that follows the search root, so
 * Windows drive letters and `:`-bearing match text both survive intact.
 */
export const filterGitIgnoredMatches = async (
  searchPath: string,
  matches: string[],
): Promise<string[]> => {
  if (matches.length === 0) return matches;

  const pathOf = (line: string): string | undefined => {
    if (!line.startsWith(searchPath)) return undefined;
    const rest = line.slice(searchPath.length);
    const sep = rest.indexOf(':');
    return sep === -1 ? line : searchPath + rest.slice(0, sep);
  };

  const filePaths = matches.map(pathOf).filter((p): p is string => !!p);
  if (filePaths.length === 0) return matches;

  const kept = new Set(await filterGitIgnored(searchPath, filePaths));

  return matches.filter((line) => {
    const p = pathOf(line);
    // Context/separator lines (`--`) carry no path — keep them.
    return p === undefined || kept.has(p);
  });
};

/**
 * Resolve an external tool's `./`-relative output line against the search root.
 *
 * External tools run with `cwd = searchPath` and search `.`, so every line they
 * emit starts with `./` — for *all* output modes (`./f.ts`, `./f.ts:12:text`,
 * `./f.ts:3`). Rewriting only that prefix therefore normalises every mode without
 * having to parse `:`/`-` separators, and leaves context separators (`--`) alone.
 *
 * The Node fallback already yields absolute paths, so after this the engine no
 * longer decides the shape of what the caller gets back.
 */
export const toAbsoluteMatchLine = (searchPath: string, line: string): string => {
  // `./` on unix, `.\` from ripgrep on Windows.
  if (!line.startsWith('./') && !line.startsWith('.\\')) return line;
  const root = searchPath.endsWith(path.sep) ? searchPath.slice(0, -1) : searchPath;
  return `${root}${path.sep}${line.slice(2)}`;
};
