import { PassThrough, Readable } from 'node:stream';

import formidable from 'formidable';
import type { Context } from 'hono';
import urlJoin from 'url-join';

import { fileEnv } from '@/envs/file';

/**
 * 给文件添加URL前缀
 * @param file 文件对象
 * @returns 添加了URL前缀的文件对象
 */
export function addFileUrlPrefix<T extends { url?: string }>(file: T): T {
  // 从 fileEnv 中获取公共域名前缀
  const publicDomain = fileEnv.S3_PUBLIC_DOMAIN;

  if (!publicDomain) {
    return file;
  }

  // 如果已经有完整的URL，直接返回
  if (file.url && (file.url.startsWith('http://') || file.url.startsWith('https://'))) {
    return file;
  }

  return {
    ...file,
    url: urlJoin(publicDomain, file.url || ''),
  };
}

/**
 * 批量给文件数组添加URL前缀
 * @param files 文件数组
 * @returns 添加了URL前缀的文件数组
 */
export function addFilesUrlPrefix<T extends { path?: string; url?: string }>(files: T[]): T[] {
  return files.map(addFileUrlPrefix);
}

/**
 * 通用的 multipart/form-data 解析器
 * 当原生 formData() 失败时的备用方案
 */
export async function parseFormData(c: Context): Promise<FormData> {
  const contentType = c.req.header('content-type') || '';
  if (!/multipart\/form-data/i.test(contentType)) {
    throw new Error('Content-Type 必须是 multipart/form-data');
  }

  // 优先使用 formidable（流式、健壮），失败时回退到原生 formData()
  try {
    const webReq = c.req.raw as Request;
    const webBody = webReq.body;
    if (!webBody) {
      throw new Error('解析失败：当前请求缺少可读的 body 流');
    }

    // 将 Web ReadableStream 转为 Node Readable（Node 18+）
    const nodeReadable =
      typeof Readable?.fromWeb === 'function' ? Readable.fromWeb(webBody as any) : null;
    if (!nodeReadable) {
      throw new Error('解析失败：运行时不支持 Readable.fromWeb，将不进行回退');
    }

    // 构造最小化 Node-like IncomingMessage 供 formidable 使用
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
          // 把合并后的 buffer 暂存，供 parse 回调读取
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

    // 追加普通字段（多值逐项 append）
    for (const [name, value] of Object.entries(fields)) {
      if (Array.isArray(value)) value.forEach((v) => fd.append(name, String(v)));
      else fd.append(name, String(value));
    }

    // 追加文件字段（兼容单值/多值）
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
    // 保持失败即抛错，让上层按统一异常处理返回
    throw e instanceof Error ? e : new Error('parseFormData 解析失败');
  }
}
