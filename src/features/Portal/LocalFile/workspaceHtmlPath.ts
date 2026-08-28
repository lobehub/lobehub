import { sha256 } from 'js-sha256';

const toSlashPath = (filePath: string): string => filePath.replaceAll('\\', '/');

const fromSlashPath = (filePath: string, sourcePath: string): string => {
  const usesWindowsSeparator = sourcePath.includes('\\') && !sourcePath.includes('/');
  return usesWindowsSeparator ? filePath.replaceAll('/', '\\') : filePath;
};

const stripTrailingSlash = (value: string) => (value.endsWith('/') ? value.slice(0, -1) : value);

const DARWIN_PRIVATE_ROOTS = ['/tmp', '/var', '/etc'] as const;

const canonicalizeWorkspacePath = (filePath: string): string => {
  const slashPath = stripTrailingSlash(toSlashPath(filePath));

  for (const root of DARWIN_PRIVATE_ROOTS) {
    const privateRoot = `/private${root}`;
    if (slashPath === privateRoot || slashPath.startsWith(`${privateRoot}/`)) {
      return slashPath.slice('/private'.length);
    }
  }

  return slashPath;
};

const decodePathSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const splitResourceHref = (href: string): string => {
  const queryIndex = href.indexOf('?');
  const hashIndex = href.indexOf('#');
  const suffixIndex = [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return (suffixIndex === undefined ? href : href.slice(0, suffixIndex)).trim();
};

const normalizeSlashPath = (
  filePath: string,
  { preserveLeadingDoubleSlash = false }: { preserveLeadingDoubleSlash?: boolean } = {},
): string => {
  const leadingEmptySegmentLimit = preserveLeadingDoubleSlash && filePath.startsWith('//') ? 2 : 1;
  const normalizedSegments: string[] = [];

  for (const segment of filePath.split('/')) {
    if (!segment || segment === '.') {
      if (
        segment === '' &&
        normalizedSegments.length < leadingEmptySegmentLimit &&
        normalizedSegments.every((item) => item === '')
      ) {
        normalizedSegments.push('');
      }
      continue;
    }

    if (segment === '..') {
      if (normalizedSegments.length > 1) normalizedSegments.pop();
      continue;
    }

    normalizedSegments.push(segment);
  }

  return normalizedSegments.join('/') || '/';
};

const parentDirectory = (filePath: string): string => {
  const slashPath = toSlashPath(filePath);
  const isUncPath = slashPath.startsWith('//');
  const lastSeparatorIndex = slashPath.lastIndexOf('/');
  if (lastSeparatorIndex < 0) return '';
  if (slashPath.startsWith('/') && lastSeparatorIndex === 0) return '/';
  const directory = slashPath.slice(0, lastSeparatorIndex);
  return fromSlashPath(isUncPath && directory === '' ? '//' : directory, filePath);
};

export const isPathInsideWorkspace = (targetPath: string, workingDirectory: string): boolean => {
  const target = canonicalizeWorkspacePath(targetPath);
  const root = canonicalizeWorkspacePath(workingDirectory);
  return target === root || target.startsWith(`${root}/`);
};

export const toWorkspaceAbsolutePath = (filePath: string, workingDirectory: string): string => {
  const slashPath = toSlashPath(filePath);
  if (isPathInsideWorkspace(filePath, workingDirectory)) {
    return fromSlashPath(slashPath, workingDirectory);
  }

  const isAbsolute = slashPath.startsWith('/') || /^[a-zA-Z]:/u.test(filePath);
  if (isAbsolute) return filePath;

  const root = stripTrailingSlash(toSlashPath(workingDirectory));
  return fromSlashPath(normalizeSlashPath(`${root}/${slashPath}`), workingDirectory);
};

export const toWorkspaceRelativePath = (absolutePath: string, workingDirectory: string): string => {
  const target = canonicalizeWorkspacePath(absolutePath);
  const root = canonicalizeWorkspacePath(workingDirectory);
  if (target === root) return '';
  if (target.startsWith(`${root}/`)) return target.slice(root.length + 1);
  return stripTrailingSlash(toSlashPath(absolutePath)).split('/').at(-1) ?? absolutePath;
};

export const lowestCommonAncestorDirectory = (
  absolutePaths: string[],
  workingDirectory: string,
): string => {
  if (absolutePaths.length === 0) return workingDirectory;

  const relativeDirs = absolutePaths.map((absolutePath) => {
    const relativePath = toWorkspaceRelativePath(absolutePath, workingDirectory);
    const segments = relativePath.split('/').filter(Boolean);
    return segments.slice(0, -1);
  });

  const [first, ...rest] = relativeDirs;
  const common: string[] = [];

  for (const [index, segment] of first.entries()) {
    if (rest.every((dirs) => dirs[index] === segment)) {
      common.push(segment);
      continue;
    }
    break;
  }

  if (common.length === 0) return workingDirectory;

  const slashRoot = `${stripTrailingSlash(toSlashPath(workingDirectory))}/${common.join('/')}`;
  return fromSlashPath(slashRoot, workingDirectory);
};

const joinPath = (basePath: string, segments: string[], sourcePath: string): string => {
  const slashBase = toSlashPath(basePath);
  const isUncPath = slashBase.startsWith('//');
  const resolved = normalizeSlashPath(
    slashBase ? [slashBase, ...segments].join('/') : segments.join('/'),
    {
      preserveLeadingDoubleSlash: isUncPath,
    },
  );
  return fromSlashPath(resolved, sourcePath);
};

const resolveAgainstDirectory = (directory: string, href: string, sourcePath: string): string => {
  const segments = href.split(/[\\/]+/).map(decodePathSegment);
  return joinPath(directory, segments, sourcePath);
};

export const resolveLocalResourceHref = ({
  href,
  rootDirectory,
  sourcePath,
  workingDirectory,
}: {
  href: string;
  rootDirectory?: string;
  sourcePath: string;
  workingDirectory: string;
}): { absolutePath?: string; href: string; kind: 'empty' | 'escape' | 'remote' | 'resolved' } => {
  const assetPath = splitResourceHref(href);
  if (!assetPath || assetPath === '#' || assetPath.startsWith('#')) {
    return { href, kind: 'empty' };
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(assetPath) || assetPath.startsWith('//')) {
    return { href, kind: 'remote' };
  }

  const resolvedPath = assetPath.startsWith('/')
    ? resolveAgainstDirectory(rootDirectory ?? workingDirectory, assetPath.slice(1), sourcePath)
    : resolveAgainstDirectory(parentDirectory(sourcePath), assetPath, sourcePath);

  if (!isPathInsideWorkspace(resolvedPath, workingDirectory)) {
    return { absolutePath: resolvedPath, href, kind: 'escape' };
  }

  return { absolutePath: resolvedPath, href, kind: 'resolved' };
};

export const createWorkspaceHtmlArtifactIdentifier = (relativePath: string): string => {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/u, '');
  const slug = normalized
    .replaceAll(/[^a-z0-9]+/gi, '-')
    .replaceAll(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48);
  const digest = sha256(normalized).slice(0, 10);

  return `workspace-html-${slug || 'page'}-${digest}`;
};

export const workspaceHtmlArtifactIdentifierForFile = (
  filePath: string,
  workingDirectory: string,
): string => {
  const relativePath =
    toWorkspaceRelativePath(
      toWorkspaceAbsolutePath(filePath, workingDirectory),
      workingDirectory,
    ) ||
    (stripTrailingSlash(toSlashPath(filePath)).split('/').at(-1) ?? filePath);
  return createWorkspaceHtmlArtifactIdentifier(relativePath);
};

export { parentDirectory };
