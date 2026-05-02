import type { ChatImageItem, ChatVideoItem } from '@lobechat/types';
import { createVisualFileRef, createVisualLocalRef } from '@lobechat/types';

export interface VisualFileItem {
  description: string;
  id?: string;
  localRef: string;
  messageId?: string;
  name: string;
  ref: string;
  type: 'image' | 'video';
  uri: string;
}

export interface VisualSourceMessage {
  id?: string;
  imageList?: ChatImageItem[];
  role?: string;
  videoList?: ChatVideoItem[];
}

const VIDEO_URL_PATTERN = /\.(?:mp4|m4v|mov|webm|mpeg|mpg|avi|mkv)(?:[?#]|$)/i;
const ALLOWED_VISUAL_MEDIA_URL_PROTOCOLS = new Set(['http:', 'https:', 'data:']);

export const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    : [];

export const isAllowedVisualMediaUrl = (url: string) => {
  try {
    return ALLOWED_VISUAL_MEDIA_URL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
};

export const filterAllowedVisualMediaUrls = (urls: string[]) => {
  const validUrls: string[] = [];
  const invalidUrls: string[] = [];

  for (const url of urls) {
    if (isAllowedVisualMediaUrl(url)) {
      validUrls.push(url);
    } else {
      invalidUrls.push(url);
    }
  }

  return { invalidUrls, validUrls };
};

export const hasVisualFiles = (message: unknown): message is VisualSourceMessage =>
  !!message &&
  typeof message === 'object' &&
  (((message as VisualSourceMessage).imageList?.length ?? 0) > 0 ||
    ((message as VisualSourceMessage).videoList?.length ?? 0) > 0);

export const hasUserVisualFiles = (message: unknown): message is VisualSourceMessage =>
  !!message &&
  typeof message === 'object' &&
  (message as VisualSourceMessage).role === 'user' &&
  hasVisualFiles(message);

export const createVisualFileItems = (
  message: VisualSourceMessage | undefined,
  images: ChatImageItem[] = [],
  videos: ChatVideoItem[] = [],
): VisualFileItem[] => [
  ...images.map((image, index) => {
    const name = image.alt || image.id || `Image ${index + 1}`;

    return {
      description: image.alt || `Image ${index + 1}`,
      id: image.id,
      localRef: createVisualLocalRef('image', index),
      messageId: message?.id,
      name,
      ref: createVisualFileRef({ index, messageId: message?.id, type: 'image' }),
      type: 'image' as const,
      uri: image.url,
    };
  }),
  ...videos.map((video, index) => {
    const name = video.alt || video.id || `Video ${index + 1}`;

    return {
      description: video.alt || `Video ${index + 1}`,
      id: video.id,
      localRef: createVisualLocalRef('video', index),
      messageId: message?.id,
      name,
      ref: createVisualFileRef({ index, messageId: message?.id, type: 'video' }),
      type: 'video' as const,
      uri: video.url,
    };
  }),
];

export const inferVisualTypeFromUrl = (url: string): VisualFileItem['type'] => {
  if (url.startsWith('data:video/')) return 'video';
  if (url.startsWith('data:image/')) return 'image';

  return VIDEO_URL_PATTERN.test(url) ? 'video' : 'image';
};

export const getVisualUrlName = (url: string, index: number) => {
  try {
    const parsed = new URL(url);

    if (parsed.protocol === 'data:') return `URL ${index + 1}`;

    return parsed.pathname.split('/').findLast(Boolean) || `URL ${index + 1}`;
  } catch {
    return `URL ${index + 1}`;
  }
};

export const createUrlVisualFileItems = (urls: string[]): VisualFileItem[] =>
  urls.map((url, index) => {
    const type = inferVisualTypeFromUrl(url);
    const name = getVisualUrlName(url, index);

    return {
      description: name,
      localRef: `url_${index + 1}`,
      name,
      ref: `url_${index + 1}`,
      type,
      uri: url,
    };
  });

export const selectVisualFileItems = (items: VisualFileItem[], refs?: string[]) => {
  if (!refs || refs.length === 0) return { availableRefs: [], invalidRefs: [], selected: [] };

  const findItem = (ref: string) => items.find((item) => item.ref === ref);
  const selected = refs
    .map((ref) => findItem(ref))
    .filter((item): item is VisualFileItem => !!item);
  const invalidRefs = refs.filter((ref) => !findItem(ref));
  const availableRefs = items.map((item) => item.ref);

  return { availableRefs, invalidRefs, selected };
};
