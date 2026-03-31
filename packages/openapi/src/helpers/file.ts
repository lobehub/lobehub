import { PassThrough, Readable } from 'node:stream';

import formidable from 'formidable';
import type { Context } from 'hono';
import urlJoin from 'url-join';

import { fileEnv } from '@/envs/file';

/**
 * Add URL prefix to a file
 * @param file File object
 * @returns File object with URL prefix added
 */
export function addFileUrlPrefix<T extends { url?: string }>(file: T): T {
  // Get the public domain prefix from fileEnv
  const publicDomain = fileEnv.S3_PUBLIC_DOMAIN;

  if (!publicDomain) {
    return file;
  }

  // If the URL is already a full URL, return it directly
  if (file.url && (file.url.startsWith('http://') || file.url.startsWith('https://'))) {
    return file;
  }

  return {
    ...file,
    url: urlJoin(publicDomain, file.url || ''),
  };
}

/**
 * Add URL prefix to an array of files
 * @param files Array of file objects
 * @returns Array of file objects with URL prefix added
 */
export function addFilesUrlPrefix<T extends { path?: string; url?: string }>(files: T[]): T[] {
  return files.map(addFileUrlPrefix);
}

/**
 * Generic multipart/form-data parser
 * Fallback when the native formData() fails
 */
export async function parseFormData(c: Context): Promise<FormData> {
  const contentType = c.req.header('content-type') || '';
  if (!/multipart\/form-data/i.test(contentType)) {
    throw new Error('Content-Type 必须是 multipart/form-data');
  }

  // Prefer formidable (streaming, robust); fall back to native formData() on failure
  try {
    const webReq = c.req.raw as Request;
    const webBody = webReq.body;
    if (!webBody) {
      throw new Error('解析失败：当前请求缺少可读的 body 流');
    }

    // Convert Web ReadableStream to Node Readable (Node 18+)
    const nodeReadable =
      typeof Readable?.fromWeb === 'function' ? Readable.fromWeb(webBody as any) : null;
    if (!nodeReadable) {
      throw new Error('解析失败：运行时不支持 Readable.fromWeb，将不进行回退');
    }

    // Construct a minimal Node-like IncomingMessage for formidable
    const fakeReq: any = nodeReadable;
    fakeReq.headers = Object.fromEntries((webReq.headers as any) || []);
    fakeReq.method = webReq.method;

    const form = formidable({
      allowEmptyFiles: false,
      fileWriteStreamHandler: () => {
        const pass = new PassThrough();
        const chunks: Buffer[] = [];
        pass.on('data', (d: Buffer) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        pass.on('end', function (this: any) {
          // Store the merged buffer temporarily for the parse callback to read
          this._buffer = Buffer.concat(chunks);
        });
        return pass;
      },
      maxFileSize: 100 * 1024 * 1024,
      multiples: true,
    });

    const { fields, files } = await new Promise<{ fields: Record<string, any>; files: any }>(
      (resolve, reject) => {
        form.parse(fakeReq, (err: any, fds: any, fls: any) => {
          if (err) return reject(err);
          resolve({ fields: fds || {}, files: fls || {} });
        });
      },
    );

    const fd = new FormData();

    // Append regular fields (append each value individually for multi-value fields)
    for (const [name, value] of Object.entries(fields)) {
      if (Array.isArray(value)) value.forEach((v) => fd.append(name, String(v)));
      else fd.append(name, String(value));
    }

    // Append file fields (compatible with single-value and multi-value)
    for (const [name, entry] of Object.entries(files)) {
      const list = Array.isArray(entry) ? entry : [entry];
      for (const f of list) {
        const buf: Buffer | undefined = (f as any)?._writeStream?._buffer || (f as any)?._buffer;
        const filename = (f as any).originalFilename || (f as any).newFilename || 'file';
        const mime = (f as any).mimetype || 'application/octet-stream';
        if (buf && typeof File !== 'undefined') {
          const file = new File([Uint8Array.from(buf)], filename, { type: mime });
          fd.append(name, file);
        } else if ((f as any).filepath) {
          // @ts-ignore
          const fs = require('node:fs');
          const bin = fs.readFileSync((f as any).filepath);
          const file = new File([Uint8Array.from(bin)], filename, { type: mime });
          fd.append(name, file);
        }
      }
    }

    return fd;
  } catch (e) {
    // Re-throw the error to let the caller handle it via unified exception handling
    throw e instanceof Error ? e : new Error('parseFormData 解析失败');
  }
}
