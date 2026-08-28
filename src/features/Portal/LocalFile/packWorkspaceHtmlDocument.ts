import { decodeFromBase64, encodeToBase64 } from '@lobechat/utils';
import { escapeRegExp } from 'es-toolkit';

import {
  collectCssResourceHrefs,
  collectJsResourceHrefs,
  collectLocalResourceRefs,
  isCssAssetPath,
  isJsAssetPath,
} from './collectHtmlLocalResources';
import {
  resolveWorkspaceAssetContentType,
  WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES,
} from './readWorkspaceAsset';
import type { WorkspaceHtmlArtifactFile } from './workspaceHtmlArtifact';
import { resolveLocalResourceHref, toWorkspaceRelativePath } from './workspaceHtmlPath';

const SITE_ROOT = '/__workspace_html_site__';

export interface PackedWorkspaceHtmlSite {
  html: string;
  inlinedPaths: string[];
  sidecars: WorkspaceHtmlArtifactFile[];
  unresolvedHrefs: string[];
}

export const normalizePath = (path: string) => path.replaceAll('\\', '/').replace(/^\/+/u, '');

export const hostedPath = (path: string) => `/${normalizePath(path)}`;

const exceedsInlineLimit = (file: WorkspaceHtmlArtifactFile): boolean => {
  if (file.encoding === 'utf8') {
    // UTF-8 byte length is never below the UTF-16 unit count, so oversized
    // content short-circuits without encoding multi-MB strings.
    if (file.content.length > WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES) return true;
    return (
      new TextEncoder().encode(file.content).byteLength > WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES
    );
  }

  const padding = file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0;
  return (
    Math.max(0, Math.floor((file.content.length * 3) / 4) - padding) >
    WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES
  );
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
  file.contentType.includes('css') || isCssAssetPath(file.path);

const isJsFile = (file: WorkspaceHtmlArtifactFile) =>
  file.contentType.includes('javascript') || isJsAssetPath(file.path);

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
  const decodedText = new Map<string, string>();
  const rewrittenCss = new Map<string, string>();
  const inlinableCache = new Map<string, boolean>();
  const jsPinnedPaths = new Set<string>();

  const fileText = (file: WorkspaceHtmlArtifactFile): string => {
    const key = normalizePath(file.path);
    const cached = decodedText.get(key);
    if (cached !== undefined) return cached;

    const text = file.encoding === 'utf8' ? file.content : decodeFromBase64(file.content);
    decodedText.set(key, text);
    return text;
  };

  for (const file of files) {
    if (!isJsFile(file)) continue;

    const localTargets = collectJsResourceHrefs(fileText(file))
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

    if (exceedsInlineLimit(file)) {
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
    const nestedInlinable = collectCssResourceHrefs(fileText(file)).every((href) => {
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
      const css = rewriteCss(fileText(file), file.path);
      return `data:text/css;base64,${encodeToBase64(css)}`;
    }

    const contentType = resolveWorkspaceAssetContentType(file.path, file.contentType);

    if (file.encoding === 'base64') {
      return `data:${contentType};base64,${file.content}`;
    }

    return `data:${contentType};base64,${encodeToBase64(file.content)}`;
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

  const html = fileText(entry);
  const collected = collectLocalResourceRefs({
    content: html,
    sourceKind: 'html',
    sourcePath: `${SITE_ROOT}/${normalizePath(entry.path)}`,
    workingDirectory: SITE_ROOT,
  });

  let packed = html;
  const unresolvedHrefs: string[] = [];
  for (const ref of collected.refs) {
    // Collection already resolved <base href>, so reuse its absolute path
    // instead of re-resolving the href against the entry directory.
    const target = normalizePath(toWorkspaceRelativePath(ref.absolutePath, SITE_ROOT));
    const replacement = fileMap.has(target)
      ? (fileToDataUri(target) ?? hostedPath(target))
      : undefined;
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
            content: rewriteCss(fileText(file), file.path),
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
