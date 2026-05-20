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
const VISUAL_DATA_URL_PATTERN = /^data:(?:image|video)\//i;
const ALLOWED_REMOTE_VISUAL_MEDIA_URL_PROTOCOLS = new Set(['http:', 'https:']);
const ANALYZE_VISUAL_MEDIA_ARGUMENT_KEYS = new Set(['question', 'refs', 'urls']);

export const MAX_VISUAL_MEDIA_URLS = 8;
export const MAX_VISUAL_MEDIA_URL_LENGTH = 2_000_000;

export interface AnalyzeVisualMediaContentOptions {
  includeFallbackInstruction?: boolean;
  includeFileSummary?: boolean;
}

export interface AnalyzeVisualMediaNormalizedInput {
  requestedRefs: string[];
  requestedUrls: string[];
}

export interface VisualMediaUrlValidationResult {
  invalidUrls: string[];
  oversizedUrls: string[];
  tooManyUrls: boolean;
  totalUrls: number;
  validUrls: string[];
}

export const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    : [];

export const normalizeAnalyzeVisualMediaInput = (
  params: Record<PropertyKey, unknown>,
): AnalyzeVisualMediaNormalizedInput => ({
  requestedRefs: normalizeStringArray(params.refs),
  requestedUrls: normalizeStringArray(params.urls),
});

export const getUnexpectedAnalyzeVisualMediaArgumentKeys = (params: Record<PropertyKey, unknown>) =>
  Object.keys(params).filter((key) => !ANALYZE_VISUAL_MEDIA_ARGUMENT_KEYS.has(key));

export const isAllowedVisualMediaUrl = (url: string) => {
  try {
    const parsed = new URL(url);

    if (ALLOWED_REMOTE_VISUAL_MEDIA_URL_PROTOCOLS.has(parsed.protocol)) return true;

    return parsed.protocol === 'data:' && VISUAL_DATA_URL_PATTERN.test(url);
  } catch {
    return false;
  }
};

export const validateVisualMediaUrls = (urls: string[]): VisualMediaUrlValidationResult => {
  const validUrls: string[] = [];
  const invalidUrls: string[] = [];
  const oversizedUrls: string[] = [];

  for (const url of urls.slice(0, MAX_VISUAL_MEDIA_URLS)) {
    if (url.length > MAX_VISUAL_MEDIA_URL_LENGTH) {
      oversizedUrls.push(url);
      continue;
    }

    if (isAllowedVisualMediaUrl(url)) {
      validUrls.push(url);
    } else {
      invalidUrls.push(url);
    }
  }

  return {
    invalidUrls,
    oversizedUrls,
    tooManyUrls: urls.length > MAX_VISUAL_MEDIA_URLS,
    totalUrls: urls.length,
    validUrls,
  };
};

export const filterAllowedVisualMediaUrls = (urls: string[]) => {
  const { invalidUrls, validUrls } = validateVisualMediaUrls(urls);

  return { invalidUrls, validUrls };
};

const formatVisualMediaUrlForError = (url: string) => {
  const value = url.startsWith('data:') ? `${url.split(',')[0]},...` : url;

  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
};

export const formatVisualMediaUrlValidationError = (validation: VisualMediaUrlValidationResult) => {
  const messages: string[] = [];

  if (validation.tooManyUrls) {
    messages.push(
      `Too many visual media URLs: ${validation.totalUrls}. At most ${MAX_VISUAL_MEDIA_URLS} URLs are supported.`,
    );
  }

  if (validation.oversizedUrls.length > 0) {
    messages.push(
      `Visual media URLs exceed the ${MAX_VISUAL_MEDIA_URL_LENGTH} character limit: ${validation.oversizedUrls
        .map(formatVisualMediaUrlForError)
        .join(', ')}.`,
    );
  }

  if (validation.invalidUrls.length > 0) {
    messages.push(
      `Unsupported visual media URLs: ${validation.invalidUrls
        .map(formatVisualMediaUrlForError)
        .join(', ')}.`,
    );
  }

  if (messages.length === 0) return;

  return `${messages.join(' ')} Only http:, https:, data:image/* and data:video/* URLs are supported.`;
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
  if (/^data:video\//i.test(url)) return 'video';
  if (/^data:image\//i.test(url)) return 'image';

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

export const buildAnalyzeVisualMediaContent = (
  items: VisualFileItem[],
  question: string,
  options: AnalyzeVisualMediaContentOptions = {},
) => {
  const textLines = ['Analyze the attached visual media and answer the user question.'];

  if (options.includeFallbackInstruction) {
    textLines.push('Do not mention that you are a fallback tool unless it is relevant.');
  }

  if (options.includeFileSummary) {
    textLines.push(
      '',
      'Files:',
      items.map((file) => `- ${file.ref}: ${file.name} (${file.type})`).join('\n'),
    );
  }

  textLines.push('', `Question: ${question}`);

  return [
    {
      text: textLines.join('\n'),
      type: 'text' as const,
    },
    ...items.map((file) =>
      file.type === 'image'
        ? {
            image_url: { detail: 'auto' as const, url: file.uri },
            type: 'image_url' as const,
          }
        : {
            type: 'video_url' as const,
            video_url: { url: file.uri },
          },
    ),
  ];
};
