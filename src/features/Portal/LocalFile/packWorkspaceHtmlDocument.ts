import type { WorkspaceHtmlArtifactFile } from '@/business/client/features/WorkspaceHtmlArtifactPublish';

import {
  collectCssResourceHrefs,
  collectJsResourceHrefs,
  collectLocalResourceRefs,
} from './collectHtmlLocalResources';
import {
  resolveWorkspaceAssetContentType,
  WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES,
} from './readWorkspaceAsset';
import { resolveLocalResourceHref, toWorkspaceRelativePath } from './workspaceHtmlPath';

const SITE_ROOT = '/__workspace_html_site__';

export interface PackedWorkspaceHtmlSite {
  html: string;
  inlinedPaths: string[];
  sidecars: WorkspaceHtmlArtifactFile[];
  unresolvedHrefs: string[];
}

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizePath = (path: string) => path.replaceAll('\\', '/').replace(/^\/+/u, '');

const hostedPath = (path: string) => `/${normalizePath(path)}`;

const decodeFileText = (file: WorkspaceHtmlArtifactFile): string => {
  if (file.encoding === 'utf8') return file.content;

  const binary = globalThis.atob(file.content);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const utf8ToBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 8192;
  for (let index = 0; index < bytes.byteLength; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(binary);
};

const fileByteLength = (file: WorkspaceHtmlArtifactFile): number => {
  if (file.encoding === 'utf8') return new TextEncoder().encode(file.content).byteLength;

  const padding = file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((file.content.length * 3) / 4) - padding);
};

const resolveSitePath = (href: string, sourcePath: string): string | undefined => {
  const resolved = resolveLocalResourceHref({
    href,
    sourcePath: `${SITE_ROOT}/${normalizePath(sourcePath)}`,
    workingDirectory: SITE_ROOT,
  });
  if (resolved.kind !== 'resolved' || !resolved.absolutePath) return;

  return toWorkspaceRelativePath(resolved.absolutePath, SITE_ROOT);
};

const isCssFile = (file: WorkspaceHtmlArtifactFile) =>
  file.contentType.includes('css') || normalizePath(file.path).toLowerCase().endsWith('.css');

const isJsFile = (file: WorkspaceHtmlArtifactFile) => {
  const path = normalizePath(file.path).toLowerCase();
  return (
    file.contentType.includes('javascript') ||
    path.endsWith('.js') ||
    path.endsWith('.mjs') ||
    path.endsWith('.cjs')
  );
};

const replaceHrefToken = (source: string, href: string, replacement: string): string => {
  const escaped = escapeRegExp(href);

  return source
    .replaceAll(new RegExp(`(["'])${escaped}\\1`, 'g'), `$1${replacement}$1`)
    .replaceAll(new RegExp(`url\\((['"]?)${escaped}\\1\\)`, 'gi'), `url($1${replacement}$1)`)
    .replaceAll(new RegExp(`(^|[,\\s])${escaped}(?=\\s+\\d+[wx]|\\s*,|$)`, 'g'), `$1${replacement}`)
    .replaceAll(
      new RegExp(`(\\s(?:src|href|poster|data)=)${escaped}(?=[\\s>]|$)`, 'gi'),
      `$1${replacement}`,
    );
};

export const packWorkspaceHtmlDocument = ({
  entryPath,
  files,
}: {
  entryPath: string;
  files: WorkspaceHtmlArtifactFile[];
}): PackedWorkspaceHtmlSite => {
  const fileMap = new Map(files.map((file) => [normalizePath(file.path), file]));
  const entry = fileMap.get(normalizePath(entryPath));
  if (!entry) {
    throw new Error('entry missing');
  }

  const visiting = new Set<string>();
  const rewrittenCss = new Map<string, string>();
  const inlinableCache = new Map<string, boolean>();
  const jsPinnedPaths = new Set<string>();

  for (const file of files) {
    if (!isJsFile(file)) continue;

    const localTargets = collectJsResourceHrefs(decodeFileText(file))
      .map((href) => resolveSitePath(href, file.path))
      .filter((target): target is string => Boolean(target && fileMap.has(normalizePath(target))))
      .map((target) => normalizePath(target));

    if (localTargets.length === 0) continue;

    jsPinnedPaths.add(normalizePath(file.path));
    for (const target of localTargets) jsPinnedPaths.add(target);
  }

  const isInlinable = (relativePath: string): boolean => {
    const key = normalizePath(relativePath);
    const cached = inlinableCache.get(key);
    if (cached !== undefined) return cached;

    const file = fileMap.get(key);
    if (!file || key === normalizePath(entryPath) || jsPinnedPaths.has(key)) {
      inlinableCache.set(key, false);
      return false;
    }

    if (fileByteLength(file) > WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES) {
      inlinableCache.set(key, false);
      return false;
    }

    if (!isCssFile(file)) {
      inlinableCache.set(key, true);
      return true;
    }

    if (visiting.has(key)) {
      inlinableCache.set(key, false);
      return false;
    }

    visiting.add(key);
    const css = decodeFileText(file);
    const nestedInlinable = collectCssResourceHrefs(css).every((href) => {
      const target = resolveSitePath(href, file.path);
      return !target || !fileMap.has(normalizePath(target)) || isInlinable(target);
    });
    visiting.delete(key);
    inlinableCache.set(key, nestedInlinable);
    return nestedInlinable;
  };

  const fileToDataUri = (relativePath: string): string | undefined => {
    const file = fileMap.get(normalizePath(relativePath));
    if (!file || !isInlinable(relativePath)) return;

    if (isCssFile(file)) {
      const css = rewriteCss(decodeFileText(file), file.path);
      return `data:text/css;base64,${utf8ToBase64(css)}`;
    }

    const contentType = resolveWorkspaceAssetContentType(file.path, file.contentType);

    if (file.encoding === 'base64') {
      return `data:${contentType};base64,${file.content}`;
    }

    return `data:${contentType};base64,${utf8ToBase64(file.content)}`;
  };

  const rewriteHref = (href: string, sourcePath: string): string | undefined => {
    const target = resolveSitePath(href, sourcePath);
    if (!target || !fileMap.has(normalizePath(target))) return;
    return fileToDataUri(target) ?? hostedPath(target);
  };

  const rewriteCss = (css: string, sourcePath: string): string => {
    const key = normalizePath(sourcePath);
    const cached = rewrittenCss.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(`rewrite:${key}`)) return css;

    visiting.add(`rewrite:${key}`);
    let next = css;
    for (const href of collectCssResourceHrefs(css)) {
      const replacement = rewriteHref(href, sourcePath);
      if (!replacement) continue;
      next = replaceHrefToken(next, href, replacement);
    }
    visiting.delete(`rewrite:${key}`);
    rewrittenCss.set(key, next);
    return next;
  };

  const html = decodeFileText(entry);
  const collected = collectLocalResourceRefs({
    content: html,
    sourceKind: 'html',
    sourcePath: `${SITE_ROOT}/${normalizePath(entry.path)}`,
    workingDirectory: SITE_ROOT,
  });

  let packed = html;
  const unresolvedHrefs: string[] = [];
  for (const ref of collected.refs) {
    const replacement = rewriteHref(ref.href, entry.path);
    if (!replacement) {
      unresolvedHrefs.push(ref.href);
      continue;
    }
    packed = replaceHrefToken(packed, ref.href, replacement);
  }

  const inlinedPaths = files
    .map((file) => normalizePath(file.path))
    .filter((path) => path !== normalizePath(entryPath) && isInlinable(path))
    .sort();

  const sidecars = files
    .filter((file) => {
      const path = normalizePath(file.path);
      return path !== normalizePath(entryPath) && !isInlinable(path);
    })
    .map((file) =>
      isCssFile(file)
        ? {
            ...file,
            content: rewriteCss(decodeFileText(file), file.path),
            encoding: 'utf8' as const,
          }
        : file,
    );

  return {
    html: packed,
    inlinedPaths,
    sidecars,
    unresolvedHrefs,
  };
};
