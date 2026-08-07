import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { resolveMimeType } from '@lobechat/utils/mimeType';

import type { TrpcClient } from '../api/client';

export interface UploadLocalFileOptions {
  knowledgeBaseId?: string;
  parentId?: string;
}

export interface UploadFileBufferInput {
  /** Raw file bytes to upload. */
  buffer: Buffer;
  /** Display name; its extension seeds the S3 pathname. */
  fileName: string;
  /** MIME type sent as the S3 `Content-Type` and stored on the record. */
  fileType: string;
}

/**
 * Upload an in-memory buffer to S3 via a pre-signed URL and create the file
 * record — the buffer-based core behind {@link uploadLocalFile}.
 *
 * @returns the created file record (`{ id, url, ... }`)
 */
const uploadFileBuffer = async (
  client: TrpcClient,
  { buffer, fileName, fileType }: UploadFileBufferInput,
  options: UploadLocalFileOptions = {},
) => {
  // Compute SHA-256 hash for deduplication
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  const ext = path.extname(fileName).toLowerCase().slice(1);
  const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

  // 1. Dedup: if the same bytes are already stored (and the object still
  // exists), skip the S3 upload entirely and reuse the existing url.
  const existing = (await client.file.checkFileHash.mutate({ hash })) as {
    isExist?: boolean;
    url?: string;
  };

  let pathname: string;
  if (existing?.isExist && existing.url) {
    pathname = existing.url;
  } else {
    // 2. Get a pre-signed upload URL and PUT the bytes to S3
    pathname = ext ? `files/${date}/${hash}.${ext}` : `files/${date}/${hash}`;
    const presigned = await client.upload.createS3PreSignedUrl.mutate({ pathname });

    const presignedUrl = typeof presigned === 'string' ? presigned : (presigned as any).url;
    const uploadRes = await fetch(presignedUrl, {
      body: buffer,
      headers: { 'Content-Type': fileType },
      method: 'PUT',
    });
    if (!uploadRes.ok) {
      throw new Error(`Upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
    }
  }

  // 3. Create the file record
  return await client.file.createFile.mutate({
    fileType,
    hash,
    knowledgeBaseId: options.knowledgeBaseId,
    metadata: {
      date,
      dirname: '',
      filename: fileName,
      path: pathname,
    },
    name: fileName,
    parentId: options.parentId,
    size: buffer.length,
    url: pathname,
  });
};

/**
 * Read a file from the local filesystem, upload it to S3 via a pre-signed URL,
 * and create the corresponding file record. Shared by `file upload` and
 * `kb upload`.
 *
 * @returns the created file record
 */
export const uploadLocalFile = async (
  client: TrpcClient,
  filePath: string,
  options: UploadLocalFileOptions = {},
) => {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${resolved}`);
  }

  const fileName = path.basename(resolved);
  const fileBuffer = fs.readFileSync(resolved);

  const fileType = await resolveMimeType(fileName, fileBuffer);
  return uploadFileBuffer(client, { buffer: fileBuffer, fileName, fileType }, options);
};
