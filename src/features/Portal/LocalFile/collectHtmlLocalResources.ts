import { findAttribute, findOpeningTag, findTagEnd } from '@/components/HtmlPreview/htmlTagScanner';

import { getFileExtension } from './Body.helpers';
import { parentDirectory, resolveLocalResourceHref } from './workspaceHtmlPath';

const ALLOWED_ASSET_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'cjs',
  'css',
  'eot',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'js',
  'json',
  'mjs',
  'mp3',
  'mp4',
  'ogg',
  'otf',
  'png',
  'svg',
  'ttf',
  'wasm',
  'wav',
  'webm',
  'webp',
  'woff',
  'woff2',
]);

const HTML_RESOURCE_TAGS = new Set([
  'audio',
  'embed',
  'img',
  'link',
  'object',
  'script',
  'source',
  'video',
]);

export type LocalResourceSkipReason = 'empty' | 'escape' | 'extension' | 'remote';

export interface CollectedLocalResourceRef {
  absolutePath: string;
  href: string;
}

export interface SkippedLocalResourceRef {
  href: string;
  reason: LocalResourceSkipReason;
}

export interface CollectLocalResourceResult {
  refs: CollectedLocalResourceRef[];
  skipped: SkippedLocalResourceRef[];
}

const isAllowedAssetPath = (absolutePath: string): boolean => {
  const extension = getFileExtension(absolutePath).toLowerCase();
  return ALLOWED_ASSET_EXTENSIONS.has(extension);
};

export const isCssAssetPath = (path: string): boolean =>
  getFileExtension(path).toLowerCase() === 'css';

const JS_ASSET_EXTENSIONS = new Set(['cjs', 'js', 'mjs']);

export const isJsAssetPath = (path: string): boolean =>
  JS_ASSET_EXTENSIONS.has(getFileExtension(path).toLowerCase());

const pushRef = (
  result: CollectLocalResourceResult,
  seenRefs: Set<string>,
  resolved: ReturnType<typeof resolveLocalResourceHref>,
) => {
  if (resolved.kind === 'empty') {
    result.skipped.push({ href: resolved.href, reason: 'empty' });
    return;
  }

  if (resolved.kind === 'remote') {
    result.skipped.push({ href: resolved.href, reason: 'remote' });
    return;
  }

  if (resolved.kind === 'escape' || !resolved.absolutePath) {
    result.skipped.push({ href: resolved.href, reason: 'escape' });
    return;
  }

  if (!isAllowedAssetPath(resolved.absolutePath)) {
    result.skipped.push({ href: resolved.href, reason: 'extension' });
    return;
  }

  // Dedupe by (path, href) pair: every distinct spelling of the same file must
  // survive so packing can rewrite each token, not just the first one.
  const refKey = `${resolved.absolutePath}\u0000${resolved.href}`;
  if (seenRefs.has(refKey)) return;
  seenRefs.add(refKey);

  result.refs.push({ absolutePath: resolved.absolutePath, href: resolved.href });
};

const splitSrcset = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim().split(/\s+/, 1)[0])
    .filter(Boolean);

const readQuotedValue = (
  source: string,
  start: number,
): { end: number; value: string } | undefined => {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') return;

  let index = start + 1;
  while (index < source.length && source[index] !== quote) {
    if (quote === '`' && source[index] === '$' && source[index + 1] === '{') return;
    index += 1;
  }
  if (index >= source.length) return;

  return { end: index + 1, value: source.slice(start + 1, index) };
};

const collectTagAttributeHrefs = (tagText: string): string[] => {
  const hrefs: string[] = [];
  for (const attributeName of ['src', 'href', 'poster', 'data']) {
    const value = findAttribute(tagText, attributeName)?.value;
    if (value) hrefs.push(value);
  }

  const srcset = findAttribute(tagText, 'srcset')?.value;
  if (srcset) hrefs.push(...splitSrcset(srcset));

  return hrefs;
};

const stripCssComments = (css: string): string => css.replaceAll(/\/\*[\s\S]*?\*\//g, '');

const readCssUrlArgument = (source: string, openParenIndex: number): string | undefined => {
  let index = openParenIndex + 1;
  while (index < source.length && /\s/.test(source[index])) index += 1;

  const quoted = readQuotedValue(source, index);
  if (quoted) return quoted.value.trim();

  const start = index;
  while (index < source.length && source[index] !== ')' && !/\s/.test(source[index])) index += 1;
  return source.slice(start, index).trim() || undefined;
};

export const collectJsResourceHrefs = (js: string): string[] => {
  const hrefs: string[] = [];
  const lower = js.toLowerCase();
  let index = 0;

  while (index < js.length) {
    const urlIndex = lower.indexOf('new url(', index);
    if (urlIndex === -1) break;

    let cursor = urlIndex + 8;
    while (cursor < js.length && /\s/.test(js[cursor])) cursor += 1;

    const quoted = readQuotedValue(js, cursor);
    if (!quoted) {
      index = urlIndex + 8;
      continue;
    }

    cursor = quoted.end;
    while (cursor < js.length && /\s/.test(js[cursor])) cursor += 1;
    if (js[cursor] !== ',') {
      index = quoted.end;
      continue;
    }

    cursor += 1;
    while (cursor < js.length && /\s/.test(js[cursor])) cursor += 1;
    if (!lower.startsWith('import.meta.url', cursor)) {
      index = quoted.end;
      continue;
    }

    if (quoted.value) hrefs.push(quoted.value);
    index = cursor + 15;
  }

  let quoteIndex = 0;
  while (quoteIndex < js.length) {
    const quote = js[quoteIndex];
    if (quote !== '"' && quote !== "'" && quote !== '`') {
      quoteIndex += 1;
      continue;
    }

    const quoted = readQuotedValue(js, quoteIndex);
    if (!quoted) {
      quoteIndex += 1;
      continue;
    }

    const href = quoted.value.trim().split(/[?#]/, 1)[0] ?? '';
    quoteIndex = quoted.end;
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    if (!isAllowedAssetPath(href)) continue;
    hrefs.push(href);
  }

  return hrefs;
};

export const collectCssResourceHrefs = (css: string): string[] => {
  const hrefs: string[] = [];
  const source = stripCssComments(css);
  const lower = source.toLowerCase();
  let index = 0;

  while (index < source.length) {
    const urlIndex = lower.indexOf('url(', index);
    const importIndex = lower.indexOf('@import', index);
    if (urlIndex === -1 && importIndex === -1) break;

    if (urlIndex !== -1 && (importIndex === -1 || urlIndex < importIndex)) {
      const href = readCssUrlArgument(source, urlIndex + 3);
      if (href) hrefs.push(href);
      index = urlIndex + 4;
      continue;
    }

    let cursor = importIndex + 7;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;

    if (lower.startsWith('url(', cursor)) {
      const href = readCssUrlArgument(source, cursor + 3);
      if (href) hrefs.push(href);
      index = cursor + 4;
      continue;
    }

    const quoted = readQuotedValue(source, cursor);
    if (quoted?.value.trim()) hrefs.push(quoted.value.trim());
    index = cursor + 1;
  }

  return hrefs;
};

const collectInlineStyleHrefs = (html: string): string[] => {
  const hrefs: string[] = [];
  const styleTagPattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  const styleAttrPattern = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

  for (const match of html.matchAll(styleTagPattern)) {
    hrefs.push(...collectCssResourceHrefs(match[1] ?? ''));
  }

  for (const match of html.matchAll(styleAttrPattern)) {
    hrefs.push(...collectCssResourceHrefs(match[1] ?? match[2] ?? ''));
  }

  return hrefs;
};

const resolveHtmlResourceBasePath = (
  html: string,
  htmlFilePath: string,
  workingDirectory: string,
): { remote: boolean; sourcePath: string } => {
  const baseTag = findOpeningTag(html, 'base');
  const baseHref = baseTag ? findAttribute(baseTag.text, 'href')?.value : undefined;
  if (!baseHref) return { remote: false, sourcePath: htmlFilePath };

  const resolved = resolveLocalResourceHref({
    href: baseHref,
    sourcePath: htmlFilePath,
    workingDirectory,
  });

  if (resolved.kind === 'remote') return { remote: true, sourcePath: htmlFilePath };
  if (resolved.kind !== 'resolved' || !resolved.absolutePath) {
    return { remote: false, sourcePath: htmlFilePath };
  }

  const extension = getFileExtension(resolved.absolutePath);
  const directory = extension ? parentDirectory(resolved.absolutePath) : resolved.absolutePath;
  return { remote: false, sourcePath: `${directory}/index.html` };
};

const walkHtmlTags = (html: string, onTag: (tagName: string, tagText: string) => void) => {
  const lower = html.toLowerCase();
  let index = 0;

  while (index < html.length) {
    const start = lower.indexOf('<', index);
    if (start === -1) return;

    let nameEnd = start + 1;
    while (nameEnd < html.length && /[a-z0-9-]/i.test(html[nameEnd])) nameEnd += 1;
    const tagName = lower.slice(start + 1, nameEnd);
    const end = findTagEnd(html, start);
    if (end === -1) return;

    onTag(tagName, html.slice(start, end));
    index = end;
  }
};

export const collectLocalResourceRefs = ({
  content,
  rootDirectory,
  sourceKind,
  sourcePath,
  workingDirectory,
}: {
  content: string;
  rootDirectory?: string;
  sourceKind: 'css' | 'html' | 'js';
  sourcePath: string;
  workingDirectory: string;
}): CollectLocalResourceResult => {
  const result: CollectLocalResourceResult = { refs: [], skipped: [] };
  const seenRefs = new Set<string>();

  if (sourceKind === 'css' || sourceKind === 'js') {
    const hrefs =
      sourceKind === 'css' ? collectCssResourceHrefs(content) : collectJsResourceHrefs(content);
    for (const href of hrefs) {
      pushRef(
        result,
        seenRefs,
        resolveLocalResourceHref({
          href,
          rootDirectory,
          sourcePath,
          workingDirectory,
        }),
      );
    }
    return result;
  }

  const resourceBase = resolveHtmlResourceBasePath(content, sourcePath, workingDirectory);

  const pushHtmlRef = (href: string) => {
    const resolved = resolveLocalResourceHref({
      href,
      sourcePath: resourceBase.sourcePath,
      workingDirectory,
    });

    // An absolute <base href> makes every non-fragment URL resolve against the
    // remote origin — including root-relative ones like /assets/app.css.
    if (resourceBase.remote && resolved.kind !== 'empty') {
      result.skipped.push({ href, reason: 'remote' });
      return;
    }

    pushRef(result, seenRefs, resolved);
  };

  walkHtmlTags(content, (tagName, tagText) => {
    if (!HTML_RESOURCE_TAGS.has(tagName)) return;
    for (const href of collectTagAttributeHrefs(tagText)) pushHtmlRef(href);
  });

  for (const href of collectInlineStyleHrefs(content)) pushHtmlRef(href);

  return result;
};
