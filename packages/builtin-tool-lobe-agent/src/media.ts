import { createMediaFileRef, createMediaLocalRef } from '@lobechat/const/mediaRef';
import type { ChatAudioItem, ChatImageItem, ChatVideoItem } from '@lobechat/types';

export interface MediaFileItem {
  description: string;
  id?: string;
  localRef: string;
  messageId?: string;
  name: string;
  ref: string;
  type: 'audio' | 'image' | 'video';
  uri: string;
}

export interface MediaSourceMessage {
  audioList?: ChatAudioItem[];
  id?: string;
  imageList?: ChatImageItem[];
  role?: string;
  videoList?: ChatVideoItem[];
}

const AUDIO_URL_PATTERN = /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|weba)(?:[?#]|$)/i;
const VIDEO_URL_PATTERN = /\.(?:mp4|m4v|mov|webm|mpeg|mpg|avi|mkv)(?:[?#]|$)/i;
const MEDIA_DATA_URL_PATTERN = /^data:(?:audio|image|video)\//i;
const ALLOWED_REMOTE_MEDIA_URL_PROTOCOLS = new Set(['http:', 'https:']);
const ANALYZE_MEDIA_ARGUMENT_KEYS = new Set(['question', 'refs', 'urls']);

export const MAX_MEDIA_URLS = 8;
export const MAX_MEDIA_URL_LENGTH = 2_000_000;

export interface AnalyzeMediaContentOptions {
  includeFallbackInstruction?: boolean;
  includeFileSummary?: boolean;
}

export interface AnalyzeMediaNormalizedInput {
  requestedRefs: string[];
  requestedUrls: string[];
}

export interface MediaUrlValidationResult {
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

export const normalizeAnalyzeMediaInput = (
  params: Record<PropertyKey, unknown>,
): AnalyzeMediaNormalizedInput => ({
  requestedRefs: normalizeStringArray(params.refs),
  requestedUrls: normalizeStringArray(params.urls),
});

export const getUnexpectedAnalyzeMediaArgumentKeys = (params: Record<PropertyKey, unknown>) =>
  Object.keys(params).filter((key) => !ANALYZE_MEDIA_ARGUMENT_KEYS.has(key));

export const isAllowedMediaUrl = (url: string) => {
  try {
    const parsed = new URL(url);

    if (ALLOWED_REMOTE_MEDIA_URL_PROTOCOLS.has(parsed.protocol)) return true;

    return parsed.protocol === 'data:' && MEDIA_DATA_URL_PATTERN.test(url);
  } catch {
    return false;
  }
};

export const validateMediaUrls = (urls: string[]): MediaUrlValidationResult => {
  const validUrls: string[] = [];
  const invalidUrls: string[] = [];
  const oversizedUrls: string[] = [];

  for (const url of urls.slice(0, MAX_MEDIA_URLS)) {
    if (url.length > MAX_MEDIA_URL_LENGTH) {
      oversizedUrls.push(url);
      continue;
    }

    if (isAllowedMediaUrl(url)) {
      validUrls.push(url);
    } else {
      invalidUrls.push(url);
    }
  }

  return {
    invalidUrls,
    oversizedUrls,
    tooManyUrls: urls.length > MAX_MEDIA_URLS,
    totalUrls: urls.length,
    validUrls,
  };
};

export const filterAllowedMediaUrls = (urls: string[]) => {
  const { invalidUrls, validUrls } = validateMediaUrls(urls);

  return { invalidUrls, validUrls };
};

const formatMediaUrlForError = (url: string) => {
  const value = url.startsWith('data:') ? `${url.split(',')[0]},...` : url;

  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
};

export const formatMediaUrlValidationError = (validation: MediaUrlValidationResult) => {
  const messages: string[] = [];

  if (validation.tooManyUrls) {
    messages.push(
      `Too many media URLs: ${validation.totalUrls}. At most ${MAX_MEDIA_URLS} URLs are supported.`,
    );
  }

  if (validation.oversizedUrls.length > 0) {
    messages.push(
      `Media URLs exceed the ${MAX_MEDIA_URL_LENGTH} character limit: ${validation.oversizedUrls
        .map(formatMediaUrlForError)
        .join(', ')}.`,
    );
  }

  if (validation.invalidUrls.length > 0) {
    messages.push(
      `Unsupported media URLs: ${validation.invalidUrls.map(formatMediaUrlForError).join(', ')}.`,
    );
  }

  if (messages.length === 0) return;

  return `${messages.join(' ')} Only http:, https:, data:audio/*, data:image/* and data:video/* URLs are supported.`;
};

export const hasMediaFiles = (message: unknown): message is MediaSourceMessage =>
  !!message &&
  typeof message === 'object' &&
  (((message as MediaSourceMessage).audioList?.length ?? 0) > 0 ||
    ((message as MediaSourceMessage).imageList?.length ?? 0) > 0 ||
    ((message as MediaSourceMessage).videoList?.length ?? 0) > 0);

export const hasUserMediaFiles = (message: unknown): message is MediaSourceMessage =>
  !!message &&
  typeof message === 'object' &&
  (message as MediaSourceMessage).role === 'user' &&
  hasMediaFiles(message);

export const createMediaFileItems = (
  message: MediaSourceMessage | undefined,
  images: ChatImageItem[] = [],
  videos: ChatVideoItem[] = [],
  audios: ChatAudioItem[] = [],
): MediaFileItem[] => [
  ...images.map((image, index) => {
    const name = image.alt || image.id || `Image ${index + 1}`;

    return {
      description: image.alt || `Image ${index + 1}`,
      id: image.id,
      localRef: createMediaLocalRef('image', index),
      messageId: message?.id,
      name,
      ref: createMediaFileRef({ index, messageId: message?.id, type: 'image' }),
      type: 'image' as const,
      uri: image.url,
    };
  }),
  ...videos.map((video, index) => {
    const name = video.alt || video.id || `Video ${index + 1}`;

    return {
      description: video.alt || `Video ${index + 1}`,
      id: video.id,
      localRef: createMediaLocalRef('video', index),
      messageId: message?.id,
      name,
      ref: createMediaFileRef({ index, messageId: message?.id, type: 'video' }),
      type: 'video' as const,
      uri: video.url,
    };
  }),
  ...audios.map((audio, index) => {
    const name = audio.alt || audio.id || `Audio ${index + 1}`;

    return {
      description: audio.alt || `Audio ${index + 1}`,
      id: audio.id,
      localRef: createMediaLocalRef('audio', index),
      messageId: message?.id,
      name,
      ref: createMediaFileRef({ index, messageId: message?.id, type: 'audio' }),
      type: 'audio' as const,
      uri: audio.url,
    };
  }),
];

export const inferMediaTypeFromUrl = (url: string): MediaFileItem['type'] => {
  if (/^data:audio\//i.test(url)) return 'audio';
  if (/^data:video\//i.test(url)) return 'video';
  if (/^data:image\//i.test(url)) return 'image';

  if (AUDIO_URL_PATTERN.test(url)) return 'audio';
  return VIDEO_URL_PATTERN.test(url) ? 'video' : 'image';
};

export const getMediaUrlName = (url: string, index: number) => {
  try {
    const parsed = new URL(url);

    if (parsed.protocol === 'data:') return `URL ${index + 1}`;

    return parsed.pathname.split('/').findLast(Boolean) || `URL ${index + 1}`;
  } catch {
    return `URL ${index + 1}`;
  }
};

export const createUrlMediaFileItems = (urls: string[]): MediaFileItem[] =>
  urls.map((url, index) => {
    const type = inferMediaTypeFromUrl(url);
    const name = getMediaUrlName(url, index);

    return {
      description: name,
      localRef: `url_${index + 1}`,
      name,
      ref: `url_${index + 1}`,
      type,
      uri: url,
    };
  });

export const selectMediaFileItems = (items: MediaFileItem[], refs?: string[]) => {
  if (!refs || refs.length === 0) return { availableRefs: [], invalidRefs: [], selected: [] };

  const findItem = (ref: string) => items.find((item) => item.ref === ref);
  const selected = refs.map((ref) => findItem(ref)).filter((item): item is MediaFileItem => !!item);
  const invalidRefs = refs.filter((ref) => !findItem(ref));
  const availableRefs = items.map((item) => item.ref);

  return { availableRefs, invalidRefs, selected };
};

export const buildAnalyzeMediaContent = (
  items: MediaFileItem[],
  question: string,
  options: AnalyzeMediaContentOptions = {},
) => {
  const textLines = ['Analyze the attached media and answer the user question.'];

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
      file.type === 'audio'
        ? {
            audio_url: { url: file.uri },
            type: 'audio_url' as const,
          }
        : file.type === 'image'
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
