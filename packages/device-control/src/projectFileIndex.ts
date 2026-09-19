import { execFile } from 'node:child_process';
import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getGitWorkingTreeFiles } from '@lobechat/local-file-shell/git';
import fg from 'fast-glob';

import { projectFileSearchManager } from './projectFileSearchManager';
import type {
  ProjectDirectoryListParams,
  ProjectDirectoryListResult,
  ProjectFileIndexEntry,
  ProjectFileIndexParams,
  ProjectFileIndexResult,
  ProjectFileSearchParams,
  ProjectFileSearchResult,
} from './types';

const execFileAsync = promisify(execFile);
const PROJECT_FILE_GLOB_LIMIT = 5000;
const PROJECT_FILE_SEARCH_DEFAULT_LIMIT = 100;
const PROJECT_DIRECTORY_LIST_LIMIT = 1000;

const toPosixRelativePath = (filePath: string) => filePath.split(path.sep).join('/');

/** Parent of a posix index path (`a/b/c.ts` → `a/b/`), or null at the root. */
const getParentRelativePath = (relativePath: string): string | null => {
  const cleaned = relativePath.endsWith('/') ? relativePath.slice(0, -1) : relativePath;
  const index = cleaned.lastIndexOf('/');
  if (index < 0) return null;
  return `${cleaned.slice(0, index)}/`;
};

const createProjectFileEntry = (
  root: string,
  absolutePath: string,
  isDirectory: boolean,
  gitIgnored?: boolean,
  collapsed?: boolean,
): ProjectFileIndexEntry => {
  const relativePath = toPosixRelativePath(path.relative(root, absolutePath));
  return {
    ...(collapsed ? { collapsed: true } : {}),
    ...(gitIgnored ? { gitIgnored: true } : {}),
    isDirectory,
    name: path.basename(absolutePath),
    path: absolutePath,
    relativePath: isDirectory ? `${relativePath}/` : relativePath,
  };
};

const collectProjectDirectories = (files: string[], root: string): ProjectFileIndexEntry[] => {
  const directories = new Set<string>();
  for (const filePath of files) {
    let current = path.dirname(filePath);
    while (current && current !== root && current.startsWith(`${root}${path.sep}`)) {
      if (directories.has(current)) break;
      directories.add(current);
      current = path.dirname(current);
    }
  }
  return [...directories].map((directory) => createProjectFileEntry(root, directory, true));
};

/**
 * Build the entry list (synthesized directories first, then files) from a flat
 * list of absolute file paths — the shared shape the Files tree builder expects,
 * so nested files attach to explicit parent directory entries instead of
 * flattening to the root.
 */
const buildEntries = (
  files: string[],
  root: string,
  ignoredPaths: string[] = [],
): ProjectFileIndexEntry[] => {
  const seen = new Set<string>();
  const fileEntries = files
    .filter((filePath) => {
      if (seen.has(filePath)) return false;
      seen.add(filePath);
      return true;
    })
    .map((filePath) => createProjectFileEntry(root, filePath, false));

  // `git ls-files --directory` keeps individual ignored files visible while
  // collapsing fully ignored directories (for example node_modules/) into one
  // bounded entry. The trailing slash is therefore meaningful and must be
  // preserved as directory metadata before resolving the absolute path.
  // A collapsed directory has real children on disk that this index will never
  // list, so it is flagged for the caller to expand on demand.
  const ignoredEntries = ignoredPaths
    .map((relativePath) => {
      const isDirectory = relativePath.endsWith('/');
      const normalizedPath = isDirectory ? relativePath.slice(0, -1) : relativePath;
      return createProjectFileEntry(
        root,
        path.resolve(root, normalizedPath),
        isDirectory,
        true,
        isDirectory,
      );
    })
    .filter((entry) => {
      if (seen.has(entry.path)) return false;
      seen.add(entry.path);
      return true;
    });

  return clearCollapsedOnIndexedDirectories(
    addMissingParentDirectories([...fileEntries, ...ignoredEntries], root),
  );
};

/**
 * A directory Git collapsed can still have indexed descendants — a nested
 * `.gitignore` re-including part of the subtree, for example. Those rows are
 * already complete, so drop the flag to keep the caller from re-listing them.
 */
const clearCollapsedOnIndexedDirectories = (
  entries: ProjectFileIndexEntry[],
): ProjectFileIndexEntry[] => {
  const parentsWithChildren = new Set<string>();
  for (const entry of entries) {
    let parent = getParentRelativePath(entry.relativePath);
    while (parent) {
      if (parentsWithChildren.has(parent)) break;
      parentsWithChildren.add(parent);
      parent = getParentRelativePath(parent);
    }
  }

  return entries.map((entry) => {
    if (!entry.collapsed || !parentsWithChildren.has(entry.relativePath)) return entry;
    const { collapsed: _collapsed, ...rest } = entry;
    return rest;
  });
};

const addMissingParentDirectories = (
  entries: ProjectFileIndexEntry[],
  root: string,
): ProjectFileIndexEntry[] => {
  const indexedPaths = entries.map((entry) => entry.path);
  const seen = new Set(indexedPaths);
  // Explicit entries carry ignore metadata; only synthesize missing parents.
  const directories = collectProjectDirectories(indexedPaths, root).filter(
    (entry) => !seen.has(entry.path),
  );

  return [...directories, ...entries];
};

const collectGlobEntries = async (scope: string): Promise<ProjectFileIndexEntry[]> => {
  const entries: ProjectFileIndexEntry[] = [];
  const stream = fg.stream('**/*', {
    cwd: scope,
    dot: true,
    ignore: ['**/node_modules/**', '**/.git/**'],
    objectMode: true,
    onlyFiles: false,
  });

  for await (const entry of stream as AsyncIterable<fg.Entry>) {
    entries.push(
      createProjectFileEntry(scope, path.resolve(scope, entry.path), entry.dirent.isDirectory()),
    );
    if (entries.length >= PROJECT_FILE_GLOB_LIMIT) break;
  }

  return addMissingParentDirectories(entries, scope);
};

/**
 * Children of a single directory inside a project, read straight from disk.
 *
 * The index collapses fully ignored directories, so their contents never reach
 * the tree. This fills one level at a time when the user expands such a row —
 * an ignored subtree is enumerated only if someone actually looks at it, which
 * is what keeps `node_modules` from ever being walked.
 */
export const defaultListProjectDirectory = async ({
  limit = PROJECT_DIRECTORY_LIST_LIMIT,
  relativePath,
  root,
}: ProjectDirectoryListParams): Promise<ProjectDirectoryListResult> => {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);

  // Never step outside the project the caller already has access to. The check
  // runs on real paths: `path.resolve` does not follow links, so a symlink
  // inside the project pointing outside it would pass a lexical prefix check
  // and then have its target enumerated. Entries are still built from the
  // lexical path below, so their ids stay anchored to the path the caller
  // asked for rather than wherever a link happened to land.
  const realRoot = await realpath(resolvedRoot);
  const realTarget = await realpath(target);
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error('Directory is outside the project root');
  }

  const dirents = await readdir(target, { withFileTypes: true });
  const visible = dirents
    .filter((dirent) => dirent.isDirectory() || dirent.isFile() || dirent.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name));

  const entries = visible.slice(0, limit).map((dirent) => {
    // Symlinks stay leaf rows — following one could walk outside the project
    // root, or into a cycle.
    const isDirectory = !dirent.isSymbolicLink() && dirent.isDirectory();

    return createProjectFileEntry(
      resolvedRoot,
      path.join(target, dirent.name),
      isDirectory,
      // Everything under a collapsed directory is ignored by the same rule
      // that collapsed the parent.
      true,
      isDirectory,
    );
  });

  return { entries, truncated: visible.length > entries.length };
};

/**
 * Shared project file index for desktop and CLI devices. Prefers
 * `git ls-files` (tracked + untracked + collapsed ignored entries,
 * submodule-aware) to enumerate the repo, falling back to a `fast-glob` walk
 * when the scope is not a git repo. Platform adapters own preview authorization.
 */
export const defaultGetProjectFileIndex = async (
  params: ProjectFileIndexParams = {},
): Promise<ProjectFileIndexResult> => {
  const requestedScope = params.scope || process.cwd();

  try {
    const rootResult = await execFileAsync(
      'git',
      ['-C', requestedScope, 'rev-parse', '--show-toplevel'],
      { timeout: 5000 },
    ).catch((error) => error);
    const exitCode = rootResult?.code ?? rootResult?.exitCode;
    const root =
      rootResult?.stdout && !exitCode ? rootResult.stdout.trim() || requestedScope : requestedScope;

    if (rootResult?.stdout && !exitCode) {
      const [trackedResult, untrackedResult, ignoredResult] = await Promise.all([
        execFileAsync(
          'git',
          ['-C', root, '-c', 'core.quotepath=false', 'ls-files', '--recurse-submodules'],
          { maxBuffer: 64 * 1024 * 1024, timeout: 10_000 },
        ),
        execFileAsync(
          'git',
          ['-C', root, '-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard'],
          { maxBuffer: 64 * 1024 * 1024, timeout: 10_000 },
        ).catch(() => ({ stdout: '' })),
        execFileAsync(
          'git',
          [
            '-C',
            root,
            '-c',
            'core.quotepath=false',
            'ls-files',
            '--others',
            '--ignored',
            '--exclude-standard',
            '--directory',
          ],
          { maxBuffer: 64 * 1024 * 1024, timeout: 10_000 },
        ).catch(() => ({ stdout: '' })),
      ]);

      const files = [...trackedResult.stdout.split('\n'), ...untrackedResult.stdout.split('\n')]
        .map((item) => item.trim())
        .filter(Boolean)
        .map((relativePath) => path.resolve(root, relativePath));

      const ignoredPaths = ignoredResult.stdout
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean);
      const entries = buildEntries(files, root, ignoredPaths);

      return {
        entries,
        indexedAt: new Date().toISOString(),
        root,
        source: 'git',
      };
    }
  } catch {
    // fall through to glob
  }

  // Include hidden and empty directories consistently across desktop and CLI.
  const entries = await collectGlobEntries(requestedScope);

  return {
    entries,
    indexedAt: new Date().toISOString(),
    root: requestedScope,
    source: 'glob',
  };
};

const filterSearchCandidates = (
  entries: ProjectFileIndexEntry[],
  params: ProjectFileSearchParams,
  includePaths?: string[],
) => {
  if (!params.excludeIgnored && !includePaths) return entries;

  const includedPaths = includePaths ? new Set(includePaths) : undefined;
  return entries.filter(
    (entry) =>
      entry.isDirectory ||
      ((!params.excludeIgnored || !entry.gitIgnored) &&
        (!includedPaths || includedPaths.has(entry.relativePath))),
  );
};

const includeMissingSearchCandidates = (
  entries: ProjectFileIndexEntry[],
  includePaths: string[] | undefined,
  root: string,
) => {
  if (!includePaths) return entries;

  const indexedPaths = new Set(entries.map((entry) => entry.relativePath));
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  const missingFiles = includePaths
    .filter((relativePath) => !indexedPaths.has(relativePath))
    .map((relativePath) => path.resolve(root, relativePath))
    .filter((absolutePath) => absolutePath.startsWith(rootPrefix));

  if (missingFiles.length === 0) return entries;

  const additions = buildEntries(missingFiles, root).filter((entry) => {
    if (indexedPaths.has(entry.relativePath)) return false;
    indexedPaths.add(entry.relativePath);
    return true;
  });

  return [...entries, ...additions];
};

export const defaultSearchProjectFiles = async (
  params: ProjectFileSearchParams,
): Promise<ProjectFileSearchResult> => {
  const requestedScope = params.scope || process.cwd();
  const limit = Math.max(1, params.limit ?? PROJECT_FILE_SEARCH_DEFAULT_LIMIT);

  try {
    const rootResult = await execFileAsync(
      'git',
      ['-C', requestedScope, 'rev-parse', '--show-toplevel'],
      { timeout: 5000 },
    ).catch((error) => error);
    const exitCode = rootResult?.code ?? rootResult?.exitCode;
    const root =
      rootResult?.stdout && !exitCode ? rootResult.stdout.trim() || requestedScope : requestedScope;

    if (rootResult?.stdout && !exitCode) {
      const includePaths = params.changedOnly
        ? Object.values(await getGitWorkingTreeFiles(root)).flat()
        : undefined;
      const [trackedResult, untrackedResult, ignoredResult] = await Promise.all([
        execFileAsync(
          'git',
          ['-C', root, '-c', 'core.quotepath=false', 'ls-files', '--recurse-submodules'],
          { maxBuffer: 64 * 1024 * 1024, timeout: 10_000 },
        ),
        execFileAsync(
          'git',
          ['-C', root, '-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard'],
          { maxBuffer: 64 * 1024 * 1024, timeout: 10_000 },
        ).catch(() => ({ stdout: '' })),
        execFileAsync(
          'git',
          [
            '-C',
            root,
            '-c',
            'core.quotepath=false',
            'ls-files',
            '--others',
            '--ignored',
            '--exclude-standard',
            '--directory',
          ],
          { maxBuffer: 64 * 1024 * 1024, timeout: 10_000 },
        ).catch(() => ({ stdout: '' })),
      ]);

      const files = [...trackedResult.stdout.split('\n'), ...untrackedResult.stdout.split('\n')]
        .map((item) => item.trim())
        .filter(Boolean)
        .map((relativePath) => path.resolve(root, relativePath));
      const ignoredPaths = ignoredResult.stdout
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean);
      const entries = filterSearchCandidates(
        includeMissingSearchCandidates(buildEntries(files, root, ignoredPaths), includePaths, root),
        params,
        includePaths,
      );

      return {
        entries: projectFileSearchManager.selectEntries(entries, params.query, limit),
        root,
        searchedAt: new Date().toISOString(),
        source: 'git',
      };
    }
  } catch {
    // fall through to glob
  }

  const files = await projectFileSearchManager.collectNonGitFilePaths(requestedScope);
  const entries = filterSearchCandidates(
    includeMissingSearchCandidates(buildEntries(files, requestedScope), undefined, requestedScope),
    params,
    params.changedOnly ? [] : undefined,
  );

  return {
    entries: projectFileSearchManager.selectEntries(entries, params.query, limit),
    root: requestedScope,
    searchedAt: new Date().toISOString(),
    source: 'glob',
  };
};
