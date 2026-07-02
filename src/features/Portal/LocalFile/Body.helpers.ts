const EXT_TO_LANG: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  dockerfile: 'dockerfile',
  fish: 'fish',
  go: 'go',
  graphql: 'graphql',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  lua: 'lua',
  md: 'markdown',
  mdx: 'mdx',
  php: 'php',
  prisma: 'prisma',
  proto: 'protobuf',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scala: 'scala',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  swift: 'swift',
  tf: 'hcl',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  txt: 'txt',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

export const extensionToLanguage = (ext: string): string => {
  if (!ext) return 'txt';
  return EXT_TO_LANG[ext.toLowerCase()] ?? 'txt';
};

export const getFileExtension = (filename: string): string => {
  const base = filename.split('/').at(-1) ?? filename;
  if (base.startsWith('.') && !base.slice(1).includes('.')) return '';
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx < 0) return '';
  return base.slice(dotIdx + 1);
};

const URL_LIKE_PREFIX = /^(?:[a-z][a-z\d+.-]*:|\/\/|#|\/)/i;

const splitAssetPath = (src: string): string => {
  const queryIndex = src.indexOf('?');
  const hashIndex = src.indexOf('#');
  const suffixIndex = [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  return (suffixIndex === undefined ? src : src.slice(0, suffixIndex)).trim();
};

const decodePathSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const toSlashPath = (filePath: string): string => filePath.replaceAll('\\', '/');

const fromSlashPath = (filePath: string, sourcePath: string): string => {
  const usesWindowsSeparator = sourcePath.includes('\\') && !sourcePath.includes('/');
  return usesWindowsSeparator ? filePath.replaceAll('/', '\\') : filePath;
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

  const normalized = normalizedSegments.join('/');
  return normalized || '/';
};

export const resolveMarkdownRelativeAssetPath = ({
  markdownFilePath,
  src,
}: {
  markdownFilePath: string;
  src?: string;
}): string | undefined => {
  const assetPath = src ? splitAssetPath(src) : '';
  if (!assetPath || URL_LIKE_PREFIX.test(assetPath)) return;

  const slashMarkdownPath = toSlashPath(markdownFilePath);
  const isUncPath = slashMarkdownPath.startsWith('//');
  const lastSeparatorIndex = slashMarkdownPath.lastIndexOf('/');
  const baseDirectory =
    lastSeparatorIndex > 0 ? slashMarkdownPath.slice(0, lastSeparatorIndex) : '';
  const assetSegments = assetPath.split(/[\\/]+/).map(decodePathSegment);
  const basePath =
    slashMarkdownPath.startsWith('/') && lastSeparatorIndex === 0 ? '/' : baseDirectory;
  const resolvedPath = normalizeSlashPath(
    basePath ? [basePath, ...assetSegments].join('/') : assetSegments.join('/'),
    { preserveLeadingDoubleSlash: isUncPath },
  );

  return fromSlashPath(resolvedPath, markdownFilePath);
};
