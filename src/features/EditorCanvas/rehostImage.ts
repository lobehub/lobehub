import { toast } from '@lobehub/ui/base-ui';
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

export const rehostImage = async (src: string): Promise<{ url: string }> => {
  try {
    const result = await fileService.rehostImage(resolveImageUrl(src).href);
    registerAttachment(result.url, result.fileId);
    return { url: result.url };
  } catch (error) {
    toast.error(t('uploadDock.body.item.error', { ns: 'file' }));
    throw error;
  }
};
