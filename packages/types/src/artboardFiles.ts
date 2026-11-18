export const ARTBOARD_FILE_LIMITS = {
  maxFiles: 500,
  maxImageBytes: 10 * 1024 * 1024,
  maxPathLength: 200,
  maxTextFileBytes: 512 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
} as const;

const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  gif: 'image/gif',
  htm: 'text/html; charset=utf-8',
  html: 'text/html; charset=utf-8',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

const IMAGE_EXTENSIONS = new Set(['gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const TEXT_EXTENSIONS = new Set(['css', 'htm', 'html', 'js', 'json', 'mjs', 'svg', 'txt']);

const SEGMENT = /^[\w.@-]+$/;

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

export const artboardFileContentType = (path: string): string | undefined =>
  CONTENT_TYPES[extensionOf(path)];

export const isArtboardImagePath = (path: string) => IMAGE_EXTENSIONS.has(extensionOf(path));

export const isArtboardHtmlPath = (path: string) => ['htm', 'html'].includes(extensionOf(path));

export const isArtboardTextPath = (path: string) => TEXT_EXTENSIONS.has(extensionOf(path));

export const normalizeArtboardFilePath = (path: string): string | undefined => {
  const trimmed = path.trim().replace(/^\.\//, '');
  if (!trimmed || trimmed.length > ARTBOARD_FILE_LIMITS.maxPathLength) return;
  const segments = trimmed.split('/');
  if (segments.some((segment) => !SEGMENT.test(segment) || segment === '.' || segment === '..'))
    return;
  if (!artboardFileContentType(trimmed)) return;
  return trimmed;
};
