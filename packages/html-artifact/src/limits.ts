import { getMimeType } from '@lobechat/utils';

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

export const isTextContentType = (contentType: string): boolean => {
  const bare = contentType.split(';')[0].trim().toLowerCase();
  return bare.startsWith('text/') || TEXT_CONTENT_TYPES.has(bare);
};

export const resolveWorkspaceAssetContentType = (path: string, reported?: string): string => {
  const guessed = getMimeType(path);
  if (guessed !== 'application/octet-stream') return guessed;

  const reportedType = reported?.split(';')[0]?.trim();
  return reportedType || guessed;
};
