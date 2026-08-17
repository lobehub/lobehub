import { isDesktop } from '@lobechat/const';

import { cloudSandboxService } from '@/services/cloudSandbox';
import { localFileService } from '@/services/electron/localFileService';
import { type LocalFilePreview, projectFileService } from '@/services/projectFile';

export const WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const WORKSPACE_HTML_ARTIFACT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const WORKSPACE_HTML_ARTIFACT_MAX_FILES = 64;
export const WORKSPACE_HTML_ARTIFACT_INLINE_MAX_BYTES = 32 * 1024;

export type ReadWorkspaceAssetFailure = 'missing' | 'oversized' | 'unreadable';

export interface ReadWorkspaceAssetSuccess {
  bytes: Uint8Array;
  contentType: string;
  ok: true;
  text?: string;
}

export interface ReadWorkspaceAssetError {
  ok: false;
  reason: ReadWorkspaceAssetFailure;
}

export type ReadWorkspaceAssetResult = ReadWorkspaceAssetError | ReadWorkspaceAssetSuccess;

const TEXT_CONTENT_TYPES = new Set([
  'application/javascript',
  'application/json',
  'application/xml',
  'image/svg+xml',
  'text/css',
  'text/html',
  'text/javascript',
  'text/plain',
]);

const isTextContentType = (contentType: string): boolean => {
  const bare = contentType.split(';')[0].trim().toLowerCase();
  return bare.startsWith('text/') || TEXT_CONTENT_TYPES.has(bare);
};

const previewToBytes = async (
  preview: LocalFilePreview,
): Promise<ReadWorkspaceAssetResult | undefined> => {
  if (preview.type === 'text') {
    const bytes = new TextEncoder().encode(preview.content);
    if (bytes.byteLength > WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES) {
      return { ok: false, reason: 'oversized' };
    }
    return {
      bytes,
      contentType: preview.contentType,
      ok: true,
      text: preview.content,
    };
  }

  if (preview.type === 'image' || preview.type === 'document') {
    if (preview.blob.size > WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES) {
      return { ok: false, reason: 'oversized' };
    }
    const bytes = new Uint8Array(await preview.blob.arrayBuffer());
    const text = isTextContentType(preview.contentType)
      ? new TextDecoder().decode(bytes)
      : undefined;
    return { bytes, contentType: preview.contentType, ok: true, text };
  }

  return;
};

export const readWorkspaceAsset = async ({
  deviceId,
  path,
  sandboxTopicId,
  workingDirectory,
}: {
  deviceId?: string;
  path: string;
  sandboxTopicId?: string;
  workingDirectory: string;
}): Promise<ReadWorkspaceAssetResult> => {
  try {
    if (sandboxTopicId) {
      const result = await cloudSandboxService.callTool(
        'readLocalFile',
        { fullContent: true, path },
        { topicId: sandboxTopicId },
      );
      if (!result.success || typeof result.result?.content !== 'string') {
        return { ok: false, reason: 'missing' };
      }

      const text = result.result.content;
      const bytes = new TextEncoder().encode(text);
      if (bytes.byteLength > WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES) {
        return { ok: false, reason: 'oversized' };
      }

      return {
        bytes,
        contentType: result.result.mimeType || 'text/plain',
        ok: true,
        text,
      };
    }

    const preview = await projectFileService.getLocalFilePreview({
      deviceId,
      path,
      workingDirectory,
    });
    const fromPreview = await previewToBytes(preview);
    if (fromPreview) return fromPreview;

    if (!deviceId && isDesktop) {
      const bytesResult = await localFileService.readLocalFileBytes({
        path,
        workingDirectory,
      });
      if (!bytesResult) return { ok: false, reason: 'missing' };
      if (bytesResult.bytes.byteLength > WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES) {
        return { ok: false, reason: 'oversized' };
      }

      const text = isTextContentType(bytesResult.contentType)
        ? new TextDecoder().decode(bytesResult.bytes)
        : undefined;
      return { ...bytesResult, ok: true, text };
    }

    return { ok: false, reason: 'unreadable' };
  } catch {
    return { ok: false, reason: 'missing' };
  }
};
