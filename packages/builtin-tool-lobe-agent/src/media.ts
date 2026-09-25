import { createMediaFileRef, createMediaLocalRef } from '@lobechat/const/mediaRef';
import type { ChatAudioItem, ChatImageItem, ChatVideoItem } from '@lobechat/types';
import { isLocalOrPrivateUrl } from '@lobechat/utils/url';

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
  pluginState?: {
    filename?: string;
    images?: Array<{
      fileId?: string;
      mediaType?: string;
      name?: string;
      url?: string;
    }>;
  };
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
  /** Inline image data whose bytes are not an image (e.g. `base64,PLACEHOLDER`). */
  invalidDataUrls: string[];
  invalidUrls: string[];
  oversizedUrls: string[];
  tooManyUrls: boolean;
  totalUrls: number;
  /** Loopback / private-network URLs the remote analysis model can never fetch. */
  unreachableUrls: string[];
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

const INLINE_IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpe?g|gif|webp);base64,/i;

const IMAGE_SIGNATURES: Record<string, number[][]> = {
  gif: [[0x47, 0x49, 0x46, 0x38]],
  jpeg: [[0xff, 0xd8, 0xff]],
  jpg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47]],
  webp: [[0x52, 0x49, 0x46, 0x46]],
};

/**
 * Cheap magic-byte check for inline raster images, so a placeholder such as
 * `data:image/jpeg;base64,PLACEHOLDER` fails fast with a clear message instead
 * of an opaque provider error. Other data URLs are left to the provider.
 */
const hasUndecodableInlineImage = (url: string) => {
  const match = url.match(INLINE_IMAGE_DATA_URL_PATTERN);
  if (!match) return false;

  const payload = url.slice(match[0].length, match[0].length + 16);
  let head: string;
  try {
    head = atob(payload);
  } catch {
    return true;
  }

  const signatures = IMAGE_SIGNATURES[match[1].toLowerCase()];
  return !signatures.some((signature) =>
    signature.every((byte, index) => head.charCodeAt(index) === byte),
  );
};

export const validateMediaUrls = (urls: string[]): MediaUrlValidationResult => {
  const validUrls: string[] = [];
  const invalidUrls: string[] = [];
  const invalidDataUrls: string[] = [];
  const oversizedUrls: string[] = [];
  const unreachableUrls: string[] = [];

  for (const url of urls.slice(0, MAX_MEDIA_URLS)) {
    if (url.length > MAX_MEDIA_URL_LENGTH) {
      oversizedUrls.push(url);
      continue;
    }

    if (!isAllowedMediaUrl(url)) {
      invalidUrls.push(url);
    } else if (isLocalOrPrivateUrl(url)) {
      unreachableUrls.push(url);
    } else if (hasUndecodableInlineImage(url)) {
      invalidDataUrls.push(url);
    } else {
      validUrls.push(url);
    }
  }

  return {
    invalidDataUrls,
    invalidUrls,
    oversizedUrls,
    tooManyUrls: urls.length > MAX_MEDIA_URLS,
    totalUrls: urls.length,
    unreachableUrls,
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

  if (validation.unreachableUrls.length > 0) {
    messages.push(
      `Media URLs point to a local or private network address that the analysis model cannot reach: ${validation.unreachableUrls
        .map(formatMediaUrlForError)
        .join(
          ', ',
        )}. Attach the file (or read it with readFile) and pass its ref, or use a public URL.`,
    );
  }

  if (validation.invalidDataUrls.length > 0) {
    messages.push(
      `Inline image data is not a decodable image: ${validation.invalidDataUrls
        .map(formatMediaUrlForError)
        .join(', ')}. Pass real base64 image bytes, not a placeholder.`,
    );
  }

  if (validation.invalidUrls.length > 0) {
    messages.push(
      `Unsupported media URLs: ${validation.invalidUrls.map(formatMediaUrlForError).join(', ')}. Only http:, https:, data:audio/*, data:image/* and data:video/* URLs are supported.`,
    );
  }

  if (messages.length === 0) return;

  return messages.join(' ');
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

const createToolResultImageItems = (message: MediaSourceMessage): MediaFileItem[] => {
  if (message.role !== 'tool' || !Array.isArray(message.pluginState?.images)) return [];

  const { filename, images } = message.pluginState;

  return images.flatMap((image, index) => {
    if (typeof image.url !== 'string') return [];

    try {
      if (!ALLOWED_REMOTE_MEDIA_URL_PROTOCOLS.has(new URL(image.url).protocol)) return [];
    } catch {
      return [];
    }

    const name = image.name || filename || image.fileId || `Image ${index + 1}`;

    return [
      {
        description: name,
        id: image.fileId,
        localRef: createMediaLocalRef('image', index),
        messageId: message.id,
        name,
        ref: createMediaFileRef({ index, messageId: message.id, type: 'image' }),
        type: 'image' as const,
        uri: image.url,
      },
    ];
  });
};

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

export const createMediaFileItemsFromMessage = (message: MediaSourceMessage): MediaFileItem[] => {
  const toolResultImages = createToolResultImageItems(message);
  // Tool result images and imageList entries share the same message/index ref
  // namespace. Prefer the durable tool result to avoid duplicate refs where
  // selectMediaFileItems would otherwise resolve the attachment first.
  const attachmentImages = toolResultImages.length > 0 ? [] : message.imageList;

  return [
    ...createMediaFileItems(message, attachmentImages, message.videoList, message.audioList),
    ...toolResultImages,
  ];
};

export const hasAnalyzableMediaFiles = (message: unknown): message is MediaSourceMessage => {
  if (!message || typeof message !== 'object') return false;

  const mediaMessage = message as MediaSourceMessage;

  return hasUserMediaFiles(mediaMessage) || createToolResultImageItems(mediaMessage).length > 0;
};

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
