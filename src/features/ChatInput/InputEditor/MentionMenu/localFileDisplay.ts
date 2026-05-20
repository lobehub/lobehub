const MAX_FILENAME_LENGTH = 34;
const MAX_TAIL_SEGMENTS = 3;

const splitPathSegments = (path: string) => path.split('/').filter(Boolean);

export const getFileExtension = (name: string) => {
  const index = name.lastIndexOf('.');
  if (index <= 0 || index === name.length - 1) return '';

  return name.slice(index + 1).toLowerCase();
};

export const compactFileName = (name: string) => {
  if (name.length <= MAX_FILENAME_LENGTH) return name;

  const extensionIndex = name.lastIndexOf('.');
  const compoundExtensionIndex =
    extensionIndex > 0 ? name.lastIndexOf('.', extensionIndex - 1) : -1;
  const compoundSuffix =
    compoundExtensionIndex > 0 && name.length - compoundExtensionIndex <= 12
      ? name.slice(compoundExtensionIndex + 1)
      : '';
  const suffix = compoundSuffix || name.slice(-10);
  const suffixBudget = suffix.length;
  const prefixBudget = Math.max(8, MAX_FILENAME_LENGTH - suffixBudget - 3);

  return `${name.slice(0, prefixBudget)}...${suffix}`;
};

export const compactDirectoryTail = (
  pathValue: string,
  fileName: string,
  isDirectory?: boolean,
) => {
  const normalized = pathValue.replaceAll('\\', '/');
  const segments = splitPathSegments(normalized);
  if (segments.length === 0) return '';

  const directorySegments =
    isDirectory || segments.at(-1) !== fileName ? segments : segments.slice(0, -1);
  if (directorySegments.length === 0) return '';

  const tail = directorySegments.slice(-MAX_TAIL_SEGMENTS).join('/');
  const prefix = directorySegments.length > MAX_TAIL_SEGMENTS ? '.../' : '';

  return `${prefix}${tail}/`;
};
