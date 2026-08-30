import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';

export interface ProjectFileDisplayFilter {
  changedOnly: boolean;
  hideIgnored: boolean;
}

const isPathInsideDirectory = (filePath: string, directoryPath: string) =>
  filePath.startsWith(directoryPath);

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

  const visibleFilePaths = new Set(matchingFiles.map((entry) => entry.relativePath));

  return entries.filter((entry) => {
    if (!entry.isDirectory) return visibleFilePaths.has(entry.relativePath);
    if (filter.hideIgnored && entry.gitIgnored) return false;

    return matchingFiles.some((file) =>
      isPathInsideDirectory(file.relativePath, entry.relativePath),
    );
  });
};
