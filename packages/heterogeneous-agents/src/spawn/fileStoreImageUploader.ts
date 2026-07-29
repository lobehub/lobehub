import crypto from 'node:crypto';

import type { UploadHeterogeneousImage } from './agentStreamPipeline';

/** Extension seed for an uploaded tool_result image, by IANA media type. */
const IMAGE_EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface FileStoreCreateFileInput {
  fileType: string;
  hash: string;
  metadata: { date: string; dirname: string; filename: string; path: string };
  name: string;
  size: number;
  url: string;
}

/**
 * The three LobeHub file-store procedures the image echo needs, decoupled from
 * how a runtime reaches them: `lh hetero exec` calls them through its typed
 * tRPC client, Electron main through a hand-rolled authed fetch. Only the
 * runtime that spawned the CLI holds those credentials.
 */
export interface FileStorePort {
  checkFileHash: (input: { hash: string }) => Promise<{ isExist?: boolean; url?: string }>;
  createFile: (input: FileStoreCreateFileInput) => Promise<{ id: string; url: string }>;
  createS3PreSignedUrl: (input: { pathname: string }) => Promise<string | { url: string }>;
}

/**
 * Build the {@link UploadHeterogeneousImage} hook `AgentStreamPipeline` calls
 * for each base64 image a tool_result echoes (CC `Read` on an image file).
 *
 * `resolvePort` returning `undefined` means the runtime has no file store to
 * upload into (e.g. a desktop that was never signed in to a remote server);
 * the pipeline then drops the image and keeps the `[Image: …]` placeholder.
 */
export const createFileStoreImageUploader =
  (resolvePort: () => Promise<FileStorePort | undefined>): UploadHeterogeneousImage =>
  async ({ data, mediaType }) => {
    const port = await resolvePort();
    if (!port) return undefined;

    const buffer = Buffer.from(data, 'base64');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = IMAGE_EXT_BY_MEDIA_TYPE[mediaType] ?? 'png';
    const fileName = `cc-read-image.${ext}`;
    const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

    // Dedup: if the same bytes are already stored (and the object still
    // exists), skip the S3 upload entirely and reuse the existing pathname.
    const existing = await port.checkFileHash({ hash });

    let pathname: string;
    if (existing?.isExist && existing.url) {
      pathname = existing.url;
    } else {
      pathname = `files/${date}/${hash}.${ext}`;
      const presigned = await port.createS3PreSignedUrl({ pathname });
      const presignedUrl = typeof presigned === 'string' ? presigned : presigned.url;

      const uploadRes = await fetch(presignedUrl, {
        body: buffer,
        headers: { 'Content-Type': mediaType },
        method: 'PUT',
      });
      if (!uploadRes.ok) {
        throw new Error(`Upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
      }
    }

    const record = await port.createFile({
      fileType: mediaType,
      hash,
      metadata: { date, dirname: '', filename: fileName, path: pathname },
      name: fileName,
      size: buffer.length,
      url: pathname,
    });

    return { fileId: record.id, url: record.url };
  };
