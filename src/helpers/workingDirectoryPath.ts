import { pickString } from '@lobechat/utils';

export const getWorkingDirectoryPathString = (path: unknown) => {
  const value = pickString(path)?.trim();
  return value || undefined;
};

// Last non-empty path segment — the folder name. Also yields the repo name for
// a web github URL (".../owner/repo" -> "repo").
export const getWorkingDirectoryName = (path: unknown) => {
  const value = getWorkingDirectoryPathString(path);
  if (!value) return;

  return value.replaceAll('\\', '/').split('/').findLast(Boolean) || value;
};
