import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { TrpcClient } from '../api/client';

/**
 * Minimal extension → MIME map for files uploaded from the local filesystem.
 * Unknown extensions fall back to `application/octet-stream`.
 */
const MIME_MAP: Record<string, string> = {
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  md: 'text/markdown',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Detect a MIME type from a file name's extension.
 */
export const detectMimeType = (fileName: string): string => {
  const ext = path.extname(fileName).toLowerCase().slice(1);
  return MIME_MAP[ext] || 'application/octet-stream';
};

export interface UploadLocalFileOptions {
  knowledgeBaseId?: string;
  parentId?: string;
}

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

  // Compute SHA-256 hash for deduplication
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  const ext = path.extname(fileName).toLowerCase().slice(1);
  const fileType = detectMimeType(fileName);

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
      body: fileBuffer,
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
    size: stat.size,
    url: pathname,
  });
};
