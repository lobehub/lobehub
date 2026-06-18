import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import fg from 'fast-glob';

import type {
  ProjectFileIndexEntry,
  ProjectFileIndexParams,
  ProjectFileIndexResult,
} from './types';

const execFileAsync = promisify(execFile);

const toPosixRelativePath = (filePath: string) => filePath.split(path.sep).join('/');

const createProjectFileEntry = (
  root: string,
  absolutePath: string,
  isDirectory: boolean,
): ProjectFileIndexEntry => {
  const relativePath = toPosixRelativePath(path.relative(root, absolutePath));
  return {
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
const buildEntries = (files: string[], root: string): ProjectFileIndexEntry[] => {
  const seen = new Set<string>();
  const fileEntries = files
    .filter((filePath) => {
      if (seen.has(filePath)) return false;
      seen.add(filePath);
      return true;
    })
    .map((filePath) => createProjectFileEntry(root, filePath, false));

  return [...collectProjectDirectories(files, root), ...fileEntries];
};

/**
 * Portable project file index for the CLI (and any non-desktop device). Prefers
 * `git ls-files` (tracked + untracked, submodule-aware) to enumerate the repo,
 * falling back to a `fast-glob` walk when the scope is not a git repo. Mirrors
 * the desktop `LocalFileCtr.getProjectFileIndex` output shape.
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
      const [trackedResult, untrackedResult] = await Promise.all([
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
      ]);

      const files = [...trackedResult.stdout.split('\n'), ...untrackedResult.stdout.split('\n')]
        .map((item) => item.trim())
        .filter(Boolean)
        .map((relativePath) => path.resolve(root, relativePath));

      const entries = buildEntries(files, root);

      return {
        entries,
        indexedAt: new Date().toISOString(),
        root,
        source: 'git',
        totalCount: entries.length,
      };
    }
  } catch {
    // fall through to glob
  }

  // Non-git scope: walk with fast-glob. `dot: true` keeps dot-directories (e.g.
  // `.agents`) that the git path would surface via `ls-files`, and `onlyFiles`
  // leaves directory entries to `buildEntries` so nesting matches the git path.
  const relFiles = await fg('**/*', {
    cwd: requestedScope,
    dot: true,
    ignore: ['**/node_modules/**', '**/.git/**'],
    onlyFiles: true,
  });
  const files = relFiles.map((relativePath) => path.resolve(requestedScope, relativePath));
  const entries = buildEntries(files, requestedScope);

  return {
    entries,
    indexedAt: new Date().toISOString(),
    root: requestedScope,
    source: 'glob',
    totalCount: entries.length,
  };
};
