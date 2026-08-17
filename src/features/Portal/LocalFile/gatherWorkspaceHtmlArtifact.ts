import type { WorkspaceHtmlArtifactFile } from '@/business/client/features/WorkspaceHtmlArtifactPublish';

import { getFileExtension } from './Body.helpers';
import {
  collectLocalResourceRefs,
  createWorkspaceHtmlArtifactIdentifier,
  extractHtmlTitle,
  lowestCommonAncestorDirectory,
  parentDirectory,
  toWorkspaceRelativePath,
} from './collectHtmlLocalResources';
import {
  type ReadWorkspaceAssetResult,
  WORKSPACE_HTML_ARTIFACT_MAX_FILES,
  WORKSPACE_HTML_ARTIFACT_MAX_TOTAL_BYTES,
} from './readWorkspaceAsset';

export interface GatheredWorkspaceHtmlArtifact {
  blocked?: 'too-large' | 'too-many';
  entryPath: string;
  files: WorkspaceHtmlArtifactFile[];
  identifier: string;
  missing: string[];
  oversized: string[];
  remotes: string[];
  title: string;
  totalBytes: number;
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 8192;
  for (let index = 0; index < bytes.byteLength; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(binary);
};

const isCssPath = (absolutePath: string): boolean =>
  getFileExtension(absolutePath).toLowerCase() === 'css';

const isJsPath = (absolutePath: string): boolean => {
  const extension = getFileExtension(absolutePath).toLowerCase();
  return extension === 'js' || extension === 'mjs' || extension === 'cjs';
};

const isWalkableAssetPath = (absolutePath: string): boolean =>
  isCssPath(absolutePath) || isJsPath(absolutePath);

const toArtifactFile = (
  relativePath: string,
  contentType: string,
  bytes: Uint8Array,
  text?: string,
): WorkspaceHtmlArtifactFile => {
  if (text !== undefined) {
    return {
      content: text,
      contentType,
      encoding: 'utf8',
      path: relativePath,
    };
  }

  return {
    content: bytesToBase64(bytes),
    contentType,
    encoding: 'base64',
    path: relativePath,
  };
};

export const gatherWorkspaceHtmlArtifact = async ({
  htmlContent,
  htmlFilePath,
  readAsset,
  workingDirectory,
}: {
  htmlContent: string;
  htmlFilePath: string;
  readAsset: (absolutePath: string) => Promise<ReadWorkspaceAssetResult>;
  workingDirectory: string;
}): Promise<GatheredWorkspaceHtmlArtifact> => {
  const htmlRefs = collectLocalResourceRefs({
    content: htmlContent,
    sourceKind: 'html',
    sourcePath: htmlFilePath,
    workingDirectory,
  });

  const pending = [...htmlRefs.refs];
  const seen = new Set(pending.map((ref) => ref.absolutePath));
  const handled = new Set<string>();
  const walkQueue = pending.filter((ref) => isWalkableAssetPath(ref.absolutePath));
  const missing: string[] = [];
  const oversized: string[] = [];
  const remotes: string[] = [];
  const htmlDirectory = parentDirectory(htmlFilePath);

  const addRemotes = (skipped: typeof htmlRefs.skipped) => {
    for (const item of skipped) {
      if (item.reason !== 'remote') continue;
      if (!remotes.includes(item.href)) remotes.push(item.href);
    }
  };

  addRemotes(htmlRefs.skipped);
  const resolvedAssets: Array<{
    absolutePath: string;
    bytes: Uint8Array;
    contentType: string;
    text?: string;
  }> = [];

  while (walkQueue.length > 0) {
    const walkRef = walkQueue.shift();
    if (!walkRef) break;
    handled.add(walkRef.absolutePath);

    const asset = await readAsset(walkRef.absolutePath);
    if (!asset.ok) {
      if (asset.reason === 'oversized') oversized.push(walkRef.href);
      else missing.push(walkRef.href);
      continue;
    }

    const text =
      asset.text ??
      (isWalkableAssetPath(walkRef.absolutePath)
        ? new TextDecoder().decode(asset.bytes)
        : undefined);

    resolvedAssets.push({
      absolutePath: walkRef.absolutePath,
      bytes: asset.bytes,
      contentType: asset.contentType,
      text,
    });

    if (!text) continue;

    const nested = collectLocalResourceRefs({
      content: text,
      rootDirectory: isJsPath(walkRef.absolutePath) ? htmlDirectory : undefined,
      sourceKind: isJsPath(walkRef.absolutePath) ? 'js' : 'css',
      sourcePath: walkRef.absolutePath,
      workingDirectory,
    });
    addRemotes(nested.skipped);

    for (const ref of nested.refs) {
      if (seen.has(ref.absolutePath)) continue;
      seen.add(ref.absolutePath);
      pending.push(ref);
      if (isWalkableAssetPath(ref.absolutePath)) walkQueue.push(ref);
    }
  }

  for (const ref of pending) {
    if (handled.has(ref.absolutePath)) continue;
    handled.add(ref.absolutePath);

    const asset = await readAsset(ref.absolutePath);
    if (!asset.ok) {
      if (asset.reason === 'oversized') oversized.push(ref.href);
      else missing.push(ref.href);
      continue;
    }

    resolvedAssets.push({
      absolutePath: ref.absolutePath,
      bytes: asset.bytes,
      contentType: asset.contentType,
      text: asset.text,
    });
  }

  const htmlBytes = new TextEncoder().encode(htmlContent);
  const siteRoot = lowestCommonAncestorDirectory(
    [htmlFilePath, ...resolvedAssets.map((asset) => asset.absolutePath)],
    workingDirectory,
  );
  const entryPath = toWorkspaceRelativePath(htmlFilePath, siteRoot) || 'index.html';
  const relativeHtmlPath = toWorkspaceRelativePath(htmlFilePath, workingDirectory);
  const filename = htmlFilePath.split(/[/\\]/).at(-1) || 'index.html';

  const files: WorkspaceHtmlArtifactFile[] = [
    toArtifactFile(entryPath, 'text/html', htmlBytes, htmlContent),
    ...resolvedAssets.map((asset) =>
      toArtifactFile(
        toWorkspaceRelativePath(asset.absolutePath, siteRoot),
        asset.contentType,
        asset.bytes,
        asset.text,
      ),
    ),
  ];

  const totalBytes =
    htmlBytes.byteLength + resolvedAssets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
  const blocked =
    files.length > WORKSPACE_HTML_ARTIFACT_MAX_FILES
      ? 'too-many'
      : totalBytes > WORKSPACE_HTML_ARTIFACT_MAX_TOTAL_BYTES
        ? 'too-large'
        : undefined;

  return {
    blocked,
    entryPath,
    files,
    identifier: createWorkspaceHtmlArtifactIdentifier(relativeHtmlPath),
    missing,
    oversized,
    remotes,
    title: extractHtmlTitle(htmlContent) || filename,
    totalBytes,
  };
};
