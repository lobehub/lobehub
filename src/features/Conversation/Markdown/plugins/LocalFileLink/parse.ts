export const LOBE_LOCAL_FILE_LINK_TAG = 'lobeLocalFileLink';

export interface ParsedLocalFileHref {
  column?: number;
  filePath: string;
  line?: number;
  workingDirectory: string;
}

interface ParseLocalFileHrefOptions {
  workingDirectory?: string;
}

const WINDOWS_ABSOLUTE_PATH_REGEX = /^(?:[a-z]:[\\/]|\\\\)/i;
const URL_PROTOCOL_REGEX = /^[a-z][a-z\d+.-]*:/i;
const LINE_SUFFIX_REGEX = /:(\d+)(?::(\d+))?$/;

const KNOWN_LOCAL_PATH_PREFIXES = [
  '/Applications/',
  '/Users/',
  '/Volumes/',
  '/home/',
  '/mnt/',
  '/opt/',
  '/private/',
  '/tmp/',
  '/var/',
  '/workspace/',
] as const;

const safeDecodeURIComponent = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeForCompare = (filePath: string) => {
  const normalized = filePath.replaceAll('\\', '/');
  if (normalized === '/') return normalized;
  return normalized.replace(/\/+$/, '');
};

const isWindowsAbsolutePath = (filePath: string) => WINDOWS_ABSOLUTE_PATH_REGEX.test(filePath);

const isPosixAbsolutePath = (filePath: string) => filePath.startsWith('/');

const isAbsoluteLocalPath = (filePath: string) =>
  isPosixAbsolutePath(filePath) || isWindowsAbsolutePath(filePath);

const isWithinDirectory = (filePath: string, directory: string) => {
  const normalizedFilePath = normalizeForCompare(filePath);
  const normalizedDirectory = normalizeForCompare(directory);

  return (
    normalizedFilePath === normalizedDirectory ||
    normalizedFilePath.startsWith(`${normalizedDirectory}/`)
  );
};

const hasKnownLocalRoot = (filePath: string) => {
  if (isWindowsAbsolutePath(filePath)) return true;

  const normalized = normalizeForCompare(filePath);
  return KNOWN_LOCAL_PATH_PREFIXES.some((prefix) => {
    const root = prefix.slice(0, -1);
    return normalized === root || normalized.startsWith(prefix);
  });
};

const dirname = (filePath: string) => {
  const normalized = filePath.replace(/[\\/]+$/, '');
  const slashIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));

  if (slashIndex <= 0) {
    if (normalized.startsWith('/')) return '/';
    return normalized;
  }

  return normalized.slice(0, slashIndex);
};

const extractLineSuffix = (candidate: string) => {
  const match = candidate.match(LINE_SUFFIX_REGEX);
  if (!match) return { filePath: candidate };

  const filePath = candidate.slice(0, -match[0].length);
  if (!filePath) return { filePath: candidate };

  const line = Number.parseInt(match[1]!, 10);
  const column = match[2] ? Number.parseInt(match[2], 10) : undefined;

  return {
    column: column && column > 0 ? column : undefined,
    filePath,
    line: line > 0 ? line : undefined,
  };
};

const hrefToPathCandidate = (href: string) => {
  const isFileUrl = href.toLowerCase().startsWith('file:');

  if (isFileUrl) {
    try {
      const url = new URL(href);
      if (url.protocol !== 'file:') return null;

      const pathname = safeDecodeURIComponent(url.pathname);
      return /^\/[a-z]:/i.test(pathname) ? pathname.slice(1) : pathname;
    } catch {
      return null;
    }
  }

  if (URL_PROTOCOL_REGEX.test(href) && !isWindowsAbsolutePath(href)) return null;

  return safeDecodeURIComponent(href);
};

export const parseLocalFileHref = (
  href?: string,
  { workingDirectory }: ParseLocalFileHrefOptions = {},
): ParsedLocalFileHref | null => {
  const rawHref = href?.trim();
  if (!rawHref) return null;

  const candidate = hrefToPathCandidate(rawHref);
  if (!candidate) return null;

  const { filePath, line, column } = extractLineSuffix(candidate);
  if (!isAbsoluteLocalPath(filePath)) return null;

  const matchedWorkingDirectory =
    workingDirectory && isWithinDirectory(filePath, workingDirectory)
      ? workingDirectory
      : undefined;

  if (
    !matchedWorkingDirectory &&
    !rawHref.toLowerCase().startsWith('file:') &&
    !hasKnownLocalRoot(filePath)
  ) {
    return null;
  }

  return {
    column,
    filePath,
    line,
    workingDirectory: matchedWorkingDirectory || dirname(filePath),
  };
};
