import { InvalidUrlError } from './errorType';

/**
 * File extensions that never carry a readable page body. Crawling them wastes a
 * (billed) provider call and always ends in an empty result, so they are rejected
 * before any provider is contacted.
 */
const NON_DOCUMENT_EXTENSIONS = new Set([
  // images
  'apng',
  'avif',
  'bmp',
  'gif',
  'heic',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
  // fonts
  'eot',
  'otf',
  'ttf',
  'woff',
  'woff2',
  // audio / video
  'aac',
  'avi',
  'flac',
  'flv',
  'm4a',
  'm4v',
  'mkv',
  'mov',
  'mp3',
  'mp4',
  'ogg',
  'wav',
  'webm',
  // archives / binaries
  '7z',
  'apk',
  'bin',
  'bz2',
  'deb',
  'dmg',
  'exe',
  'gz',
  'iso',
  'msi',
  'rar',
  'rpm',
  'tar',
  'tgz',
  'wasm',
  'xz',
  'zip',
]);

const NON_DOCUMENT_CONTENT_TYPE_PREFIXES = ['audio/', 'font/', 'image/', 'video/'];

const NON_DOCUMENT_CONTENT_TYPES = new Set([
  'application/font-sfnt',
  'application/font-woff',
  'application/font-woff2',
  'application/gzip',
  'application/octet-stream',
  'application/vnd.ms-fontobject',
  'application/wasm',
  'application/x-7z-compressed',
  'application/x-font-ttf',
  'application/x-rar-compressed',
  'application/x-tar',
  'application/zip',
]);

const SCHEME_RE = /^[a-z][\d+.a-z-]*:/i;
const HTTP_SCHEME_RE = /^https?:\/\//i;
// "example.com:8443/app" — a port, not a scheme
const HOST_PORT_RE = /^[^/:]+:\d+(?:\/|$)/;
const MARKDOWN_LINK_RE = /^\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)$/;

const LEADING_WRAPPERS = new Set(['<', '"', "'", '`']);
const TRAILING_WRAPPERS = new Set(['>', '"', "'", '`']);
// sentence punctuation the model tends to glue onto a link
const TRAILING_PUNCTUATION = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  '!',
  ',',
  '.',
  ':',
  ';',
  '?',
  "'",
  '"',
  '`',
]);

// Character-set trimming is done with loops rather than anchored `[…]+$` regexes:
// this input is model- and user-controlled, and those regexes backtrack
// quadratically on long runs of the trimmed characters.
const trimStart = (value: string, chars: Set<string>): string => {
  let start = 0;
  while (start < value.length && chars.has(value[start])) start++;

  return start === 0 ? value : value.slice(start);
};

const trimEnd = (value: string, chars: Set<string>): string => {
  let end = value.length;
  while (end > 0 && chars.has(value[end - 1])) end--;

  return end === value.length ? value : value.slice(0, end);
};

/**
 * Drop trailing ")" that closes a parenthesis opened outside the URL, as in
 * prose like "(see https://example.com)". Parens balanced within the URL stay.
 */
const trimUnbalancedTrailingParens = (value: string): string => {
  let opened = 0;
  let closed = 0;

  for (const char of value) {
    if (char === '(') opened++;
    else if (char === ')') closed++;
  }

  let end = value.length;
  let unbalanced = closed - opened;
  while (unbalanced > 0 && end > 0 && value[end - 1] === ')') {
    end--;
    unbalanced--;
  }

  return end === value.length ? value : value.slice(0, end);
};

/**
 * Return the resource-file extension of a URL path (lower-cased, without the dot),
 * or `undefined` when the path does not end in a known non-document extension.
 */
export const getNonDocumentExtension = (url: string): string | undefined => {
  let pathname: string;

  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }

  const lastSegment = pathname.split('/').pop() ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');

  if (dotIndex <= 0) return undefined;

  const ext = lastSegment.slice(dotIndex + 1).toLowerCase();

  return NON_DOCUMENT_EXTENSIONS.has(ext) ? ext : undefined;
};

/**
 * Whether a response `Content-Type` describes bytes that have no readable page body.
 */
export const isNonDocumentContentType = (contentType?: string | null): boolean => {
  if (!contentType) return false;

  const mime = contentType.split(';')[0].trim().toLowerCase();

  return (
    NON_DOCUMENT_CONTENT_TYPES.has(mime) ||
    NON_DOCUMENT_CONTENT_TYPE_PREFIXES.some((prefix) => mime.startsWith(prefix))
  );
};

const stripWrapping = (input: string): string => {
  let value = input.trim();

  // markdown link: [label](https://example.com "title")
  const markdown = value.match(MARKDOWN_LINK_RE);
  if (markdown) value = markdown[1];

  // <https://example.com>, "https://example.com", `https://example.com`
  value = trimEnd(trimStart(value, LEADING_WRAPPERS), TRAILING_WRAPPERS);

  value = trimEnd(value, TRAILING_PUNCTUATION);

  return trimUnbalancedTrailingParens(value);
};

const isPlausibleHostname = (hostname: string): boolean =>
  hostname === 'localhost' || hostname.includes('.') || hostname.includes(':');

const parseHttpUrl = (candidate: string): URL | undefined => {
  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  if (!isPlausibleHostname(parsed.hostname)) return undefined;

  return parsed;
};

/**
 * Turn a model-generated string into an absolute http(s) URL, or throw `InvalidUrlError`.
 *
 * Repairs the shapes that dominate provider-side 422s — bare domains without a scheme,
 * markdown links, surrounding quotes / angle brackets, trailing punctuation — and rejects
 * everything that still does not parse as http(s) so no provider call is made for it.
 *
 * Returns the input untouched (modulo trimming) when it is already a clean absolute
 * http(s) URL.
 */
export const normalizeCrawlUrl = (input: string): string => {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new InvalidUrlError('URL is empty');
  }

  const stripped = stripWrapping(input);
  const candidates = [stripped];

  if (stripped.startsWith('//')) {
    candidates.push(`https:${stripped}`);
  } else if (
    !HTTP_SCHEME_RE.test(stripped) &&
    (!SCHEME_RE.test(stripped) || HOST_PORT_RE.test(stripped))
  ) {
    // no scheme (or a host:port that only looks like one) → assume https
    candidates.push(`https://${stripped}`);
  }

  for (const candidate of candidates) {
    if (parseHttpUrl(candidate)) return candidate;
  }

  const preview = input.length > 120 ? `${input.slice(0, 120)}…` : input;

  throw new InvalidUrlError(
    `"${preview}" is not a valid absolute http(s) URL (expected something like https://example.com/path)`,
  );
};
