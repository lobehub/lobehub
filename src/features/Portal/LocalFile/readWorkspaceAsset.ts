import { base64ToBytes, getMimeType } from '@lobechat/utils';

import { cloudSandboxService } from '@/services/cloudSandbox';
import { type LocalFilePreview, projectFileService } from '@/services/projectFile';

export const WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const WORKSPACE_HTML_ARTIFACT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
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
  sizeBytes?: number;
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

export const resolveWorkspaceAssetContentType = (path: string, reported?: string): string => {
  const guessed = getMimeType(path);
  if (guessed !== 'application/octet-stream') return guessed;

  const reportedType = reported?.split(';')[0]?.trim();
  return reportedType || guessed;
};

const quoteShellArg = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

const decodeBase64Bytes = (value: string): Uint8Array | undefined => {
  const compact = value.replaceAll(/\s+/g, '');
  if (!compact) return;
  try {
    return base64ToBytes(compact);
  } catch {
    return;
  }
};

const sandboxCommandOutput = (result: {
  result?: unknown;
  success: boolean;
}): string | undefined => {
  if (!result.success || !result.result || typeof result.result !== 'object') return;
  const payload = result.result as { output?: unknown; stdout?: unknown };
  if (typeof payload.stdout === 'string') return payload.stdout;
  if (typeof payload.output === 'string') return payload.output;
  return;
};

const readSandboxBytes = async (path: string, topicId: string): Promise<Uint8Array | undefined> => {
  const python = await cloudSandboxService.callTool(
    'runCommand',
    {
      command: `python3 -c ${quoteShellArg(`import pathlib,base64; print(base64.b64encode(pathlib.Path(${JSON.stringify(path)}).read_bytes()).decode(), end="")`)}`,
      description: 'Read workspace asset bytes',
    },
    { topicId },
  );
  const pythonBytes = decodeBase64Bytes(sandboxCommandOutput(python) ?? '');
  if (pythonBytes) return pythonBytes;

  const fallback = await cloudSandboxService.callTool(
    'runCommand',
    {
      command: `base64 ${quoteShellArg(path)}`,
      description: 'Read workspace asset bytes',
    },
    { topicId },
  );
  return decodeBase64Bytes(sandboxCommandOutput(fallback) ?? '');
};

const previewToBytes = async (
  preview: LocalFilePreview,
): Promise<ReadWorkspaceAssetResult | undefined> => {
  if (preview.type === 'text') {
    const bytes = new TextEncoder().encode(preview.content);
    if (bytes.byteLength > WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES) {
      return { ok: false, reason: 'oversized', sizeBytes: bytes.byteLength };
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
      return { ok: false, reason: 'oversized', sizeBytes: preview.blob.size };
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
      const contentType = getMimeType(path);
      if (isTextContentType(contentType)) {
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
          return { ok: false, reason: 'oversized', sizeBytes: bytes.byteLength };
        }

        return {
          bytes,
          contentType: resolveWorkspaceAssetContentType(path, result.result.mimeType),
          ok: true,
          text,
        };
      }

      const bytes = await readSandboxBytes(path, sandboxTopicId);
      if (!bytes) return { ok: false, reason: 'unreadable' };
      if (bytes.byteLength > WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES) {
        return { ok: false, reason: 'oversized', sizeBytes: bytes.byteLength };
      }

      return { bytes, contentType, ok: true };
    }

    const preview = await projectFileService.getLocalFilePreview({
      deviceId,
      path,
      workingDirectory,
    });
    const fromPreview = await previewToBytes(preview);
    if (fromPreview) {
      if (!fromPreview.ok) return fromPreview;
      return {
        ...fromPreview,
        contentType: resolveWorkspaceAssetContentType(path, fromPreview.contentType),
      };
    }

    const bytesResult = await projectFileService.readProjectFileBytes({
      deviceId,
      path,
      workingDirectory,
    });
    if (!bytesResult) return { ok: false, reason: 'unreadable' };
    if (bytesResult.bytes.byteLength > WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES) {
      return { ok: false, reason: 'oversized', sizeBytes: bytesResult.bytes.byteLength };
    }

    const contentType = resolveWorkspaceAssetContentType(path, bytesResult.contentType);
    const text = isTextContentType(contentType)
      ? new TextDecoder().decode(bytesResult.bytes)
      : undefined;
    return { ...bytesResult, contentType, ok: true, text };
  } catch {
    return { ok: false, reason: 'missing' };
  }
};
