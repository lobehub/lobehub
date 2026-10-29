import { CANVAS_BINARY_EXTENSIONS, CANVAS_CONTENT_TYPES, CANVAS_TEXT_EXTENSIONS } from './limits';

export const getCanvasFileExtension = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
};

export const isCanvasTextPath = (path: string) =>
  CANVAS_TEXT_EXTENSIONS.has(getCanvasFileExtension(path));

export const isAllowedCanvasPath = (path: string) => {
  const extension = getCanvasFileExtension(path);
  return CANVAS_TEXT_EXTENSIONS.has(extension) || CANVAS_BINARY_EXTENSIONS.has(extension);
};

export const getCanvasContentType = (path: string) =>
  CANVAS_CONTENT_TYPES[getCanvasFileExtension(path)] ?? 'application/octet-stream';

const SEGMENT_PATTERN = /^[\w\-.@ ]+$/;

export const normalizeCanvasPath = (input: string): string | undefined => {
  const segments: string[] = [];

  for (const segment of input.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return;
      segments.pop();
      continue;
    }
    if (!SEGMENT_PATTERN.test(segment)) return;
    segments.push(segment);
  }

  return segments.length > 0 ? segments.join('/') : undefined;
};

export type CanvasHrefKind = 'anchor' | 'data' | 'local' | 'remote';

export interface ResolvedCanvasHref {
  kind: CanvasHrefKind;
  path?: string;
}

const stripQueryAndHash = (href: string) => href.split(/[#?]/)[0];

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const resolveCanvasHref = (fromFile: string, rawHref: string): ResolvedCanvasHref => {
  const href = rawHref.trim();
  if (!href || href.startsWith('#')) return { kind: 'anchor' };
  if (/^data:/i.test(href)) return { kind: 'data' };
  if (/^[a-z][\d+.a-z-]*:/i.test(href) || href.startsWith('//')) return { kind: 'remote' };

  const target = decode(stripQueryAndHash(href)).replaceAll('\\', '/');
  if (!target) return { kind: 'anchor' };
  if (target.startsWith('/')) return { kind: 'local' };

  const baseDir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';

  return { kind: 'local', path: normalizeCanvasPath(`${baseDir}/${target}`) };
};
