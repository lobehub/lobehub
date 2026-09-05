import type { BrowserScreenshotState } from '../../types';

/**
 * The image source for a capture, whichever shape produced it.
 *
 * The client executor returns the JPEG inline as `dataUrl`; the server-proxied
 * device path stores the image and returns its URL instead, so the base64 never
 * reaches the DB. Reading only `dataUrl` blanks every server-proxied capture.
 */
export const resolveScreenshotSrc = (state?: BrowserScreenshotState): string | undefined =>
  state?.dataUrl || state?.url || state?.images?.[0]?.url;
