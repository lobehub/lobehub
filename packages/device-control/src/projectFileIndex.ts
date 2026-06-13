import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { globLocalFiles } from '@lobechat/local-file-shell';

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

const createDetectedProjectFileEntry = async (
  root: string,
  absolutePath: string,
): Promise<ProjectFileIndexEntry> => {
  try {
    const stats = await stat(absolutePath);
    return createProjectFileEntry(root, absolutePath, stats.isDirectory());
  } catch {
    return createProjectFileEntry(root, absolutePath, false);
  }
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

      const seen = new Set<string>();
      const fileEntries = files
        .filter((filePath) => {
          if (seen.has(filePath)) return false;
          seen.add(filePath);
          return true;
        })
        .map((filePath) => createProjectFileEntry(root, filePath, false));

      const entries = [...collectProjectDirectories(files, root), ...fileEntries];

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

  const fallback = await globLocalFiles({ pattern: '**/*', scope: requestedScope });
  const files = fallback.files.map((filePath) => path.resolve(requestedScope, filePath));
  const entries = await Promise.all(
    files.map((filePath) => createDetectedProjectFileEntry(requestedScope, filePath)),
  );

  return {
    entries,
    indexedAt: new Date().toISOString(),
    root: requestedScope,
    source: 'glob',
    totalCount: entries.length,
  };
};
