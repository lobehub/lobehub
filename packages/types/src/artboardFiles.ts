import { z } from 'zod';

export const ARTBOARD_FILE_LIMITS = {
  maxFiles: 500,
  maxImageBytes: 10 * 1024 * 1024,
  maxPathLength: 200,
  maxTextFileBytes: 512 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
} as const;

const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  gif: 'image/gif',
  htm: 'text/html; charset=utf-8',
  html: 'text/html; charset=utf-8',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

const IMAGE_EXTENSIONS = new Set(['gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const TEXT_EXTENSIONS = new Set(['css', 'htm', 'html', 'js', 'json', 'mjs', 'svg', 'txt']);

const SEGMENT = /^[\w.@-]+$/;

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

export const artboardFileContentType = (path: string): string | undefined =>
  CONTENT_TYPES[extensionOf(path)];

export const isArtboardImagePath = (path: string) => IMAGE_EXTENSIONS.has(extensionOf(path));

export const isArtboardHtmlPath = (path: string) => ['htm', 'html'].includes(extensionOf(path));

export const isArtboardTextPath = (path: string) => TEXT_EXTENSIONS.has(extensionOf(path));

export const normalizeArtboardFilePath = (path: string): string | undefined => {
  const trimmed = path.trim().replace(/^\.\//, '');
  if (!trimmed || trimmed.length > ARTBOARD_FILE_LIMITS.maxPathLength) return;
  const segments = trimmed.split('/');
  if (segments.some((segment) => !SEGMENT.test(segment) || segment === '.' || segment === '..'))
    return;
  if (!artboardFileContentType(trimmed)) return;
  return trimmed;
};

const filePathSchema = z
  .string()
  .min(1)
  .max(ARTBOARD_FILE_LIMITS.maxPathLength + 2);

export const artboardFileWriteSchema = z.union([
  z.object({ content: z.string(), path: filePathSchema }).strict(),
  z.object({ fileRef: z.string().min(1), path: filePathSchema }).strict(),
  z.object({ base64: z.string().min(1), path: filePathSchema }).strict(),
  // Already PUT to the URL from artboard.prepareFileUploads; the write only records the change.
  z.object({ path: filePathSchema, uploaded: z.literal(true) }).strict(),
  // Import copies: the content is copied in now and does not follow the source afterwards.
  z
    .object({
      fromCanvas: z
        .object({ canvasId: z.string().min(1), version: z.number().int().positive().optional() })
        .strict(),
      path: filePathSchema,
    })
    .strict(),
]);

export const artboardFileUploadsSchema = z
  .array(z.object({ path: filePathSchema, size: z.number().int().nonnegative() }).strict())
  .min(1)
  .max(ARTBOARD_FILE_LIMITS.maxFiles);

export const artboardFileEditSchema = z
  .object({ newText: z.string(), oldText: z.string().min(1), path: filePathSchema })
  .strict();

export const artboardFileChangesSchema = z
  .object({
    deletes: z.array(filePathSchema).max(ARTBOARD_FILE_LIMITS.maxFiles).optional(),
    edits: z.array(artboardFileEditSchema).max(200).optional(),
    writes: z.array(artboardFileWriteSchema).max(ARTBOARD_FILE_LIMITS.maxFiles).optional(),
  })
  .strict();

export type ArtboardFileChangesInput = z.infer<typeof artboardFileChangesSchema>;
