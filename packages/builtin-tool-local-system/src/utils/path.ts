import path from 'path-browserify-esm';

const normalizeDriveLetter = (input: string): string =>
  input.replace(/^[A-Za-z]:/, (match) => match.toLowerCase());

const toNormalizedAbsolute = (input: string): string => {
  const trimmed = input.trim();
  const withPosixSeparators = trimmed.replaceAll('\\', '/');
  const withNormalizedDrive = normalizeDriveLetter(withPosixSeparators);

  if (withNormalizedDrive === '') return '/';

  const hasDriveLetter = /^[A-Za-z]:/.test(withNormalizedDrive);
  const hasLeadingSlash = withNormalizedDrive.startsWith('/');
  const absolutePath =
    hasDriveLetter || hasLeadingSlash ? withNormalizedDrive : `/${withNormalizedDrive}`;

  return path.normalize(absolutePath);
};

export const normalizePathForScope = (input: string): string => {
  const normalized = toNormalizedAbsolute(input);
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
};
