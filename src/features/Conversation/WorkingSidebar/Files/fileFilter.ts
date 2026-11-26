import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import path from 'pathe';

export interface ProjectFileDisplayFilter {
  changedOnly: boolean;
  hideIgnored: boolean;
}

const getDirectoryPaths = (relativePath: string): string[] => {
  const segments = relativePath.split('/');
  return segments.slice(0, -1).map((_, index) => `${segments.slice(0, index + 1).join('/')}/`);
};

/**
 * A staged deletion is absent from `git ls-files`, so the project index cannot
 * supply its row. Recreate only those missing rows (and ancestors) from Git's
 * status paths so the Changes view remains complete.
 */
export const mergeMissingDeletedEntries = (
  entries: ProjectFileIndexEntry[],
  deletedPaths: string[],
  root: string,
): ProjectFileIndexEntry[] => {
  const existingPaths = new Set(entries.map((entry) => entry.relativePath));
  const missingPaths = deletedPaths.filter((relativePath) => !existingPaths.has(relativePath));
  if (missingPaths.length === 0) return entries;

  const additions: ProjectFileIndexEntry[] = [];
  for (const relativePath of missingPaths) {
    for (const directoryPath of getDirectoryPaths(relativePath)) {
      if (existingPaths.has(directoryPath)) continue;
      existingPaths.add(directoryPath);
      additions.push({
        isDirectory: true,
        name: path.basename(directoryPath),
        path: path.join(root, directoryPath),
        relativePath: directoryPath,
      });
    }

    existingPaths.add(relativePath);
    additions.push({
      isDirectory: false,
      name: path.basename(relativePath),
      path: path.join(root, relativePath),
      relativePath,
    });
  }

  return [...entries, ...additions];
};

export const filterProjectFileEntries = (
  entries: ProjectFileIndexEntry[],
  dirtyFilePaths: Set<string>,
  filter: ProjectFileDisplayFilter,
) => {
  if (!filter.changedOnly && !filter.hideIgnored) return entries;

  const matchingFiles = entries.filter((entry) => {
    if (entry.isDirectory) return false;
    if (filter.hideIgnored && entry.gitIgnored) return false;
    return !filter.changedOnly || dirtyFilePaths.has(entry.relativePath);
  });

  const visibleFilePaths = new Set<string>();
  // Every directory above a visible file, collected in one pass. Asking each
  // directory to scan every file instead is quadratic and stalls a large
  // project for most of a second per filter change.
  const visibleDirectoryPaths = new Set<string>();
  for (const { relativePath } of matchingFiles) {
    visibleFilePaths.add(relativePath);
    let end = relativePath.lastIndexOf('/');
    while (end > 0) {
      const directoryPath = relativePath.slice(0, end + 1);
      // An ancestor already recorded has had its own ancestors recorded too.
      if (visibleDirectoryPaths.has(directoryPath)) break;
      visibleDirectoryPaths.add(directoryPath);
      end = relativePath.lastIndexOf('/', end - 1);
    }
  }

  return entries.filter((entry) => {
    if (!entry.isDirectory) return visibleFilePaths.has(entry.relativePath);
    if (filter.hideIgnored && entry.gitIgnored) return false;

    return visibleDirectoryPaths.has(
      entry.relativePath.endsWith('/') ? entry.relativePath : `${entry.relativePath}/`,
    );
  });
};
