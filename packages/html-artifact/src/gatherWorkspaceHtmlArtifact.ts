import { bytesToBase64 } from '@lobechat/utils';

import {
  type CollectedLocalResourceRef,
  collectLocalResourceRefs,
  isCssAssetPath,
  isJsAssetPath,
  type LocalResourceSkipReason,
} from './collectHtmlLocalResources';
import { extractHtmlTitle } from './htmlTagScanner';
import {
  type ReadWorkspaceAssetResult,
  WORKSPACE_HTML_ARTIFACT_MAX_FILES,
  WORKSPACE_HTML_ARTIFACT_MAX_TOTAL_BYTES,
} from './limits';
import type { WorkspaceHtmlArtifactFile } from './workspaceHtmlArtifact';
import {
  lowestCommonAncestorDirectory,
  parentDirectory,
  toWorkspaceAbsolutePath,
  toWorkspaceRelativePath,
  workspaceHtmlArtifactIdentifierForFile,
} from './workspaceHtmlPath';

export interface GatheredWorkspaceHtmlArtifact {
  blocked?: 'too-large' | 'too-many';
  entryPath: string;
  escaped: EscapedResourceRef[];
  files: WorkspaceHtmlArtifactFile[];
  identifier: string;
  missing: string[];
  oversized: string[];
  remotes: string[];
  resources: GatheredWorkspaceHtmlResource[];
  title: string;
  totalBytes: number;
  unsupported: string[];
}

export interface EscapedResourceRef {
  absolutePath: string;
  hrefs: string[];
}

export interface GatheredWorkspaceHtmlResource extends EscapedResourceRef {
  contentType?: string;
  text?: string;
}

export const READ_CONCURRENCY = 5;

const isWalkableAssetPath = (absolutePath: string): boolean =>
  isCssAssetPath(absolutePath) || isJsAssetPath(absolutePath);

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
  allowExternalReads = false,
  htmlContent,
  htmlFilePath,
  readAsset,
  workingDirectory,
}: {
  allowExternalReads?: boolean;
  htmlContent: string;
  htmlFilePath: string;
  readAsset: (absolutePath: string) => Promise<ReadWorkspaceAssetResult>;
  workingDirectory: string;
}): Promise<GatheredWorkspaceHtmlArtifact> => {
  const absoluteHtmlPath = toWorkspaceAbsolutePath(htmlFilePath, workingDirectory);
  const htmlRefs = collectLocalResourceRefs({
    allowExternalReads,
    content: htmlContent,
    sourceKind: 'html',
    sourcePath: absoluteHtmlPath,
    workingDirectory,
  });

  const pending: string[] = [];
  const resources = new Map<string, GatheredWorkspaceHtmlResource>();
  const handled = new Set<string>();
  const walkQueue: string[] = [];
  const missing: string[] = [];
  const escaped: EscapedResourceRef[] = [];
  const oversized: string[] = [];
  const remotes: string[] = [];
  const unsupported: string[] = [];
  const htmlDirectory = parentDirectory(absoluteHtmlPath);

  const escapedByPath = new Map<string, EscapedResourceRef>();
  const htmlBytes = new TextEncoder().encode(htmlContent);
  let totalBytes = htmlBytes.byteLength;
  let blocked: GatheredWorkspaceHtmlArtifact['blocked'] =
    totalBytes > WORKSPACE_HTML_ARTIFACT_MAX_TOTAL_BYTES ? 'too-large' : undefined;

  const addResource = ({ absolutePath, href }: CollectedLocalResourceRef) => {
    const existing = resources.get(absolutePath);
    if (existing) {
      if (!existing.hrefs.includes(href)) existing.hrefs.push(href);
      return false;
    }

    resources.set(absolutePath, { absolutePath, hrefs: [href] });
    if (resources.size + 1 > WORKSPACE_HTML_ARTIFACT_MAX_FILES) blocked = 'too-many';
    return true;
  };

  const addPending = (ref: CollectedLocalResourceRef) => {
    if (!addResource(ref)) return;
    pending.push(ref.absolutePath);
    if (isWalkableAssetPath(ref.absolutePath)) walkQueue.push(ref.absolutePath);
  };

  for (const ref of htmlRefs.refs) addPending(ref);

  const bucketForSkipReason = (reason: LocalResourceSkipReason): string[] | undefined => {
    if (reason === 'remote') return remotes;
    if (reason === 'extension') return unsupported;
    return;
  };

  const collectSkipped = (skipped: typeof htmlRefs.skipped) => {
    for (const item of skipped) {
      if (item.reason === 'escape' && item.absolutePath) {
        addResource({ absolutePath: item.absolutePath, href: item.href });
        const existing = escapedByPath.get(item.absolutePath);
        if (existing) {
          if (!existing.hrefs.includes(item.href)) existing.hrefs.push(item.href);
        } else {
          const escapedRef = { absolutePath: item.absolutePath, hrefs: [item.href] };
          escapedByPath.set(item.absolutePath, escapedRef);
          escaped.push(escapedRef);
        }
      }
      const bucket = bucketForSkipReason(item.reason);
      if (!bucket || bucket.includes(item.href)) continue;
      bucket.push(item.href);
    }
  };

  collectSkipped(htmlRefs.skipped);
  const resolvedAssets: Array<{
    absolutePath: string;
    bytes: Uint8Array;
    contentType: string;
    text?: string;
  }> = [];

  const registerAsset = (asset: (typeof resolvedAssets)[number]) => {
    resolvedAssets.push(asset);
    const resource = resources.get(asset.absolutePath);
    if (resource) {
      resource.contentType = asset.contentType;
      resource.text = asset.text;
    }
    totalBytes += asset.bytes.byteLength;
    if (totalBytes > WORKSPACE_HTML_ARTIFACT_MAX_TOTAL_BYTES) blocked = 'too-large';
  };

  const registerReadFailure = (
    asset: Extract<ReadWorkspaceAssetResult, { ok: false }>,
    hrefs: string[],
  ) => {
    if (asset.reason !== 'oversized') {
      for (const href of hrefs) if (!missing.includes(href)) missing.push(href);
      return;
    }

    for (const href of hrefs) if (!oversized.includes(href)) oversized.push(href);
    totalBytes += asset.sizeBytes ?? WORKSPACE_HTML_ARTIFACT_MAX_TOTAL_BYTES + 1;
    blocked = 'too-large';
  };

  const readLeafAsset = async (absolutePath: string) => {
    const resource = resources.get(absolutePath)!;
    const asset = await readAsset(absolutePath);
    if (!asset.ok) {
      registerReadFailure(asset, resource.hrefs);
      return;
    }

    registerAsset({
      absolutePath,
      bytes: asset.bytes,
      contentType: asset.contentType,
      text: asset.text,
    });
  };

  while (!blocked && walkQueue.length > 0) {
    const absolutePath = walkQueue.shift();
    if (!absolutePath) break;
    if (handled.has(absolutePath)) continue;
    handled.add(absolutePath);
    const resource = resources.get(absolutePath)!;

    const asset = await readAsset(absolutePath);
    if (!asset.ok) {
      registerReadFailure(asset, resource.hrefs);
      continue;
    }

    const text =
      asset.text ??
      (isWalkableAssetPath(absolutePath) ? new TextDecoder().decode(asset.bytes) : undefined);

    registerAsset({
      absolutePath,
      bytes: asset.bytes,
      contentType: asset.contentType,
      text,
    });

    if (!text) continue;

    const nested = collectLocalResourceRefs({
      allowExternalReads,
      content: text,
      rootDirectory: isJsAssetPath(absolutePath) ? htmlDirectory : undefined,
      sourceKind: isJsAssetPath(absolutePath) ? 'js' : 'css',
      sourcePath: absolutePath,
      workingDirectory,
    });
    collectSkipped(nested.skipped);

    for (const ref of nested.refs) addPending(ref);
  }

  // Leaf assets are independent reads; batch them so remote transports
  // (sandbox runCommand round trips) don't serialize into seconds.
  const leaves = pending.filter((absolutePath) => {
    if (handled.has(absolutePath)) return false;
    handled.add(absolutePath);
    return true;
  });

  for (let index = 0; index < leaves.length && !blocked; index += READ_CONCURRENCY) {
    await Promise.all(leaves.slice(index, index + READ_CONCURRENCY).map(readLeafAsset));
  }

  const siteRoot = lowestCommonAncestorDirectory(
    [absoluteHtmlPath, ...resolvedAssets.map((asset) => asset.absolutePath)],
    workingDirectory,
  );
  const entryPath = toWorkspaceRelativePath(absoluteHtmlPath, siteRoot) || 'index.html';
  const filename = htmlFilePath.split(/[/\\]/).at(-1) || 'index.html';

  const files: WorkspaceHtmlArtifactFile[] = blocked
    ? []
    : [
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

  return {
    blocked,
    entryPath,
    escaped,
    files,
    identifier: workspaceHtmlArtifactIdentifierForFile(htmlFilePath, workingDirectory),
    missing,
    oversized,
    remotes,
    resources: [...resources.values()],
    title: extractHtmlTitle(htmlContent) || filename,
    totalBytes,
    unsupported,
  };
};
