import type { OpenAIChatMessage, UserMessageContentPart } from '../types';
import { imageUrlToBase64 } from './imageToBase64';
import { collectErrorStrings } from './routeFallback';
import { parseDataUri } from './uriParser';

/**
 * Provider-side failures to fetch or decode a media part. The rejected part stays in
 * the conversation history, so without a fallback every later turn of the topic
 * fails with the same 400, including plain-text follow-ups.
 */
const MEDIA_FETCH_ERROR_PATTERNS = [
  'error getting file type: failed to download file',
  'failed to download or process media content',
  'unable to download content from the provided url',
  'unable to download the file. please verify the url',
];

const INLINE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const INLINE_IMAGE_TIMEOUT_MS = 15_000;

type MediaPart = Extract<UserMessageContentPart, { type: 'image_url' | 'video_url' }>;

const isMediaPart = (part: UserMessageContentPart): part is MediaPart =>
  part?.type === 'image_url' || part?.type === 'video_url';

const getMediaUrl = (part: MediaPart) =>
  part.type === 'image_url' ? part.image_url.url : part.video_url.url;

const isRemoteImagePart = (part: UserMessageContentPart) =>
  part?.type === 'image_url' && parseDataUri(part.image_url.url).type === 'url';

const toPlaceholder = (part: MediaPart): UserMessageContentPart => {
  const url = getMediaUrl(part);
  const kind = part.type === 'image_url' ? 'Image' : 'Video';
  const source = parseDataUri(url).type === 'url' ? ` Original URL: ${url}` : '';

  return {
    text: `[${kind} omitted: the model provider could not download or process it.${source}]`,
    type: 'text',
  };
};

const mapContentParts = async (
  messages: OpenAIChatMessage[],
  mapPart: (part: UserMessageContentPart) => Promise<UserMessageContentPart>,
): Promise<OpenAIChatMessage[]> =>
  Promise.all(
    messages.map(async (message) =>
      Array.isArray(message.content)
        ? { ...message, content: await Promise.all(message.content.map(mapPart)) }
        : message,
    ),
  );

const someContentPart = (
  messages: OpenAIChatMessage[],
  predicate: (part: UserMessageContentPart) => boolean,
) => messages.some((m) => Array.isArray(m.content) && m.content.some(predicate));

export const isMediaFetchError = (error: unknown): boolean => {
  const combined = collectErrorStrings(error)
    .map((value) => value.toLowerCase())
    .join('\n');

  return MEDIA_FETCH_ERROR_PATTERNS.some((pattern) => combined.includes(pattern));
};

export const hasRemoteImage = (messages: OpenAIChatMessage[]) =>
  someContentPart(messages, isRemoteImagePart);

export const hasMediaPart = (messages: OpenAIChatMessage[]) =>
  someContentPart(messages, isMediaPart);

/**
 * Downloads remote images on our side and sends them as data URIs, so the request no
 * longer depends on the provider reaching the URL. An image we cannot download either
 * becomes a text placeholder.
 */
export const inlineRemoteImages = async (
  messages: OpenAIChatMessage[],
): Promise<OpenAIChatMessage[]> => {
  const downloads = new Map<string, Promise<string | undefined>>();

  const download = (url: string) => {
    let pending = downloads.get(url);
    if (!pending) {
      pending = imageUrlToBase64(url, {
        maxBytes: INLINE_IMAGE_MAX_BYTES,
        signal: AbortSignal.timeout(INLINE_IMAGE_TIMEOUT_MS),
      })
        // A failed fetch can still return an HTML error page; never send that as an image.
        .then(({ base64, mimeType }) =>
          mimeType.startsWith('image/') ? `data:${mimeType};base64,${base64}` : undefined,
        )
        .catch(() => undefined);
      downloads.set(url, pending);
    }
    return pending;
  };

  return mapContentParts(messages, async (part) => {
    if (part?.type !== 'image_url' || !isRemoteImagePart(part)) return part;

    const dataUri = await download(part.image_url.url);
    if (!dataUri) return toPlaceholder(part);

    return { ...part, image_url: { ...part.image_url, url: dataUri } };
  });
};

/** Last resort: keep the conversation usable as text by replacing every media part. */
export const replaceMediaWithPlaceholders = (
  messages: OpenAIChatMessage[],
): Promise<OpenAIChatMessage[]> =>
  mapContentParts(messages, async (part) => (isMediaPart(part) ? toPlaceholder(part) : part));
