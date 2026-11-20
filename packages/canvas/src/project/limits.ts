export const CANVAS_ENTRY = 'index.html';

export const CANVAS_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxFiles: 64,
  maxTextFileBytes: 512 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
} as const;

export const CANVAS_TEXT_EXTENSIONS = new Set([
  'css',
  'csv',
  'html',
  'js',
  'json',
  'md',
  'mjs',
  'svg',
  'txt',
]);

export const CANVAS_BINARY_EXTENSIONS = new Set([
  'avif',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'mp3',
  'mp4',
  'ogg',
  'otf',
  'png',
  'ttf',
  'wav',
  'webm',
  'webp',
  'woff',
  'woff2',
]);

export const CANVAS_CONTENT_TYPES: Record<string, string> = {
  avif: 'image/avif',
  css: 'text/css; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  gif: 'image/gif',
  html: 'text/html; charset=utf-8',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  otf: 'font/otf',
  png: 'image/png',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
};
