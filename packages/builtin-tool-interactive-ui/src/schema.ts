import { z } from 'zod';

export const INTERACTIVE_UI_LIMITS = {
  css: 24_000,
  fallback: 2_000,
  html: 48_000,
  js: 32_000,
  title: 120,
  totalBytes: 128_000,
} as const;

export const LegacyRenderUIParamsSchema = z
  .strictObject({
    css: z.string().max(INTERACTIVE_UI_LIMITS.css),
    fallback: z.string().trim().min(1).max(INTERACTIVE_UI_LIMITS.fallback),
    html: z.string().trim().min(1).max(INTERACTIVE_UI_LIMITS.html),
    js: z.string().max(INTERACTIVE_UI_LIMITS.js),
    title: z.string().trim().min(1).max(INTERACTIVE_UI_LIMITS.title),
    version: z.literal(1),
  })
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      INTERACTIVE_UI_LIMITS.totalBytes,
    { message: 'The interactive UI exceeds the total source size limit.' },
  );

/** Preview is display-only: never treat repaired partial JSON as executable code. */
export const getInteractiveUIPreview = (args: unknown) => {
  if (!args || typeof args !== 'object') return { css: '', html: '', js: '' };
  const value = args as Record<string, unknown>;
  const read = (key: 'html' | 'css') =>
    typeof value[key] === 'string' ? value[key].slice(0, INTERACTIVE_UI_LIMITS[key]) : '';
  return { css: read('css'), html: read('html'), js: '' };
};
