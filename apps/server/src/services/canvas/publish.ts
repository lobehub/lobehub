import {
  CANVAS_ENTRY,
  type CanvasManifest,
  getCanvasFileExtension,
  isCanvasTextPath,
} from '@lobechat/canvas';
import type { CanvasPublishBundle, CanvasPublishFile } from '@lobechat/types';
import { z } from 'zod';

import type { CanvasStorageService } from './storage';

export const resolveCanvasPublicRuntimeUrl = async (
  major: number,
  baseUrl?: string,
): Promise<string | undefined> => {
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) return;
  const base = `${baseUrl.replace(/\/+$/, '')}/v${major}`;
  const response = await fetch(`${base}/manifest.json`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Canvas runtime v${major} has not been published`);
  const manifest = z
    .object({ major: z.literal(major), revision: z.string().regex(/^[\da-f]{64}$/) })
    .parse(await response.json());
  return `${base}/${manifest.revision}/canvas-runtime.js`;
};

const injectCanvasRuntime = (html: string, runtimeUrl: string) => {
  const injection = `<script defer src="${runtimeUrl}"></script>`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (!head)
    return `<!doctype html><html><head><meta charset="utf-8">${injection}</head><body>${html}</body></html>`;
  const at = head.index + head[0].length;
  return html.slice(0, at) + injection + html.slice(at);
};

export const buildCanvasPublishBundle = async (
  storage: Pick<CanvasStorageService, 'readFile'>,
  manifest: CanvasManifest,
  runtimeUrl: string,
): Promise<CanvasPublishBundle> => {
  const decoder = new TextDecoder();
  const entry = manifest.entry || CANVAS_ENTRY;
  let html = '';
  const files: CanvasPublishFile[] = [];

  for (const path of Object.keys(manifest.files).toSorted()) {
    const file = await storage.readFile(manifest, path);
    if (!file) throw new Error(`Canvas file ${path} is missing`);

    if (getCanvasFileExtension(path) === 'html') {
      const page = injectCanvasRuntime(decoder.decode(file.bytes), runtimeUrl);
      if (path === entry) html = page;
      else
        files.push({
          content: page,
          contentType: file.contentType,
          encoding: 'utf8',
          path: `/${path}`,
        });
      continue;
    }

    files.push(
      isCanvasTextPath(path)
        ? {
            content: decoder.decode(file.bytes),
            contentType: file.contentType,
            encoding: 'utf8',
            path: `/${path}`,
          }
        : {
            content: Buffer.from(file.bytes).toString('base64'),
            contentType: file.contentType,
            encoding: 'base64',
            path: `/${path}`,
          },
    );
  }

  return { files, html };
};
