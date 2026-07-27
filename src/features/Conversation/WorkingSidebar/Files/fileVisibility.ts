import {
  WORKSPACE_FILE_TREE_EXCLUDED_NAMES,
  WORKSPACE_FILE_TREE_EXCLUDED_SUFFIXES,
  WORKSPACE_FILE_TREE_GIT_IGNORED_OUTPUT_NAMES,
} from '@lobechat/const';
import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';

export const isExcludedProjectFileEntry = (entry: ProjectFileIndexEntry): boolean => {
  const segments = entry.relativePath.split('/');

  return (
    segments.some(
      (segment) =>
        WORKSPACE_FILE_TREE_EXCLUDED_NAMES.includes(segment) ||
        WORKSPACE_FILE_TREE_EXCLUDED_SUFFIXES.some((suffix) => segment.endsWith(suffix)) ||
        segment.endsWith('~'),
    ) ||
    (entry.gitIgnored === true &&
      segments.some((segment) => WORKSPACE_FILE_TREE_GIT_IGNORED_OUTPUT_NAMES.includes(segment)))
  );
};
