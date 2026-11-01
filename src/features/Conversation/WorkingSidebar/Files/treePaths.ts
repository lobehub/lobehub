// Relative file paths cannot contain NUL, so this synthetic id cannot collide with an indexed entry.
export const PROJECT_ROOT_NODE_ID = '\0project-root';

export const stripTrailingSlash = (value: string) =>
  value.endsWith('/') ? value.slice(0, -1) : value;

/** Parent directory id (`src/`) of an entry id, or `null` for a top-level entry. */
export const getParentRelativePath = (relativePath: string): string | null => {
  const cleaned = stripTrailingSlash(relativePath);
  const idx = cleaned.lastIndexOf('/');
  if (idx < 0) return null;
  return `${cleaned.slice(0, idx)}/`;
};

export const getAncestorIds = (filePath: string): string[] => {
  const segments = stripTrailingSlash(filePath).split('/');
  const ancestors: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i).join('/') + '/');
  }
  return ancestors;
};

/** Tree id of an entry at `relativePath` (folders end with `/`). */
export const toEntryId = (relativePath: string, isDirectory: boolean) =>
  isDirectory ? `${stripTrailingSlash(relativePath)}/` : relativePath;
