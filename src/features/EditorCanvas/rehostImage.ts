import { toast } from '@lobehub/ui';
import { t } from 'i18next';

import { fileService } from '@/services/file';

import { getRegisteredAttachment, registerAttachment } from './attachmentRegistry';

const resolveImageUrl = (src: string) =>
  new URL(src.startsWith('//') ? `https:${src}` : src, window.location.href);

export const needsImageRehost = (src: string): boolean => {
  if (getRegisteredAttachment(src)) return false;

  try {
    const url = resolveImageUrl(src);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return url.origin !== window.location.origin || !url.pathname.startsWith('/f/');
  } catch {
    return false;
  }
};

/**
 * Pasting a page with many external images asks the editor to rehost all of them at once. Each
 * rehost is a server-side upload transaction serialized on the owner's storage lock, and tRPC
 * batches simultaneous calls into one request, so an unbounded paste (78 images on 2026-11-02)
 * lands as dozens of competing transactions on a single server instance.
 */
export const MAX_CONCURRENT_REHOSTS = 3;

let activeRehosts = 0;
const waitingRehosts: (() => void)[] = [];

const withRehostSlot = async <T>(run: () => Promise<T>): Promise<T> => {
  if (activeRehosts >= MAX_CONCURRENT_REHOSTS) {
    await new Promise<void>((resolve) => waitingRehosts.push(resolve));
  } else {
    activeRehosts += 1;
  }

  try {
    return await run();
  } finally {
    // Hand the slot straight to the next waiter so the count never dips and refills.
    const next = waitingRehosts.shift();
    if (next) next();
    else activeRehosts -= 1;
  }
};

export const rehostImage = async (src: string): Promise<{ url: string }> => {
  try {
    const result = await withRehostSlot(() => fileService.rehostImage(resolveImageUrl(src).href));
    registerAttachment(result.url, result.fileId);
    return { url: result.url };
  } catch (error) {
    toast.error(t('uploadDock.body.item.error', { ns: 'file' }));
    throw error;
  }
};
