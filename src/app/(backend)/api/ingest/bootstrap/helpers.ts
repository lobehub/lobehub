import { UAParser } from 'ua-parser-js';
import { z } from 'zod';

const spanSchema = z.object({
  durMs: z.number().finite().nonnegative(),
  name: z.string().max(64),
  startMs: z.number().finite().nonnegative(),
});

export const bootstrapPayloadSchema = z.object({
  anonId: z.string().max(64).optional(),
  appVersion: z.string().max(64),
  cold: z.boolean(),
  isLogin: z.boolean(),
  platform: z.enum(['web', 'desktop', 'mobile']),
  spans: z.array(spanSchema).max(64),
  totalMs: z.number().finite().nonnegative(),
  userId: z.string().max(64).optional(),
});

export type BootstrapPayload = z.infer<typeof bootstrapPayloadSchema>;

export const MAX_BODY_BYTES = 8 * 1024;

export const isBodyTooLarge = (text: string): boolean =>
  Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES;

const extraAllowedOrigins = (): Set<string> =>
  new Set(
    (process.env.BOOTSTRAP_METRICS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

export const isOriginAllowed = (origin: string | null, requestOrigin: string): boolean => {
  if (!origin) return true;
  if (origin === requestOrigin) return true;
  return extraAllowedOrigins().has(origin);
};

export interface ParsedUA {
  browser: string | null;
  os: string | null;
}

export const parseUA = (ua: string | null): ParsedUA => {
  if (!ua) return { browser: null, os: null };
  const parser = new UAParser(ua);
  const browser = parser.getBrowser().name ?? null;
  const os = parser.getOS().name ?? null;
  return { browser, os };
};
