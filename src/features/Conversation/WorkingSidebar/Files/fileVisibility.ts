import {
  WORKSPACE_FILE_TREE_EXCLUDED_NAMES,
  WORKSPACE_FILE_TREE_EXCLUDED_SUFFIXES,
  WORKSPACE_FILE_TREE_GIT_IGNORED_OUTPUT_NAMES,
} from '@lobechat/const';
import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';

const excludedNames = new Set(WORKSPACE_FILE_TREE_EXCLUDED_NAMES);
const gitIgnoredOutputNames = new Set(WORKSPACE_FILE_TREE_GIT_IGNORED_OUTPUT_NAMES);

export const isExcludedProjectFileEntry = (entry: ProjectFileIndexEntry): boolean => {
  const segments = entry.relativePath.split('/');

  return (
    segments.some(
      (segment) =>
        excludedNames.has(segment) ||
        WORKSPACE_FILE_TREE_EXCLUDED_SUFFIXES.some((suffix) => segment.endsWith(suffix)),
    ) ||
    (entry.gitIgnored === true && segments.some((segment) => gitIgnoredOutputNames.has(segment)))
  );
};
