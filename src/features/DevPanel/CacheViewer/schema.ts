import { Buffer } from 'buffer.js';
import { z } from 'zod';

const unstableCacheFileSchema = z.object({
  data: z.object({
    body: z.string(),
    headers: z.object({}).transform(() => null),
    status: z.number(),
    url: z.literal(''),
  }),
  kind: z.union([z.literal('FETCH'), z.unknown()]),
  revalidate: z.number().optional(),
  tags: z.array(z.string()).optional().default([]),
});

const fetchCacheFileSchema = z.object({
  data: z.object({
    body: z.string(),
    headers: z.record(z.string(), z.string()),
    status: z.number(),
    url: z.string().url(),
  }),
  id: z.string(),
  kind: z.union([z.literal('FETCH'), z.unknown()]),
  revalidate: z.number().optional(),
  tags: z.array(z.string()).optional().default([]),
});

const atou = (str: string, type: string) => {
  if (type.startsWith('image/')) return `data:${type};base64,${str}`;
  return Buffer.from(str, 'base64').toString();
};
export const nextCacheFileSchema = z
  .union([unstableCacheFileSchema, fetchCacheFileSchema])
  .transform((item) => {
    const { data, ...cacheEntry } = item;
    const body =
      data.url !== ''
        ? atou(data.body, data.headers ? data.headers['content-type'] : '')
        : data.body;
    return {
      ...cacheEntry,
      ...data,
      body,
      timestamp: data.headers?.date ? new Date(data.headers?.date) : new Date(),
      url: data.url === '' ? 'unstable_cache' : data.url,
    };
  });

export type NextCacheFileData = z.infer<typeof nextCacheFileSchema>;
