import fs from 'node:fs/promises';

import {
  isTextContentType,
  type ReadWorkspaceAssetResult,
  resolveWorkspaceAssetContentType,
  WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES,
} from '@lobechat/html-artifact';

export const readLocalHtmlAsset = async (
  absolutePath: string,
): Promise<ReadWorkspaceAssetResult> => {
  let size: number;
  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) return { ok: false, reason: 'missing' };
    size = stats.size;
  } catch {
    return { ok: false, reason: 'missing' };
  }

  if (size > WORKSPACE_HTML_ARTIFACT_MAX_FILE_BYTES) {
    return { ok: false, reason: 'oversized', sizeBytes: size };
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(absolutePath);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  const contentType = resolveWorkspaceAssetContentType(absolutePath);

  return {
    bytes: new Uint8Array(buffer),
    contentType,
    ok: true,
    text: isTextContentType(contentType) ? buffer.toString('utf8') : undefined,
  };
};
