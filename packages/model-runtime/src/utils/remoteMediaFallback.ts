import { DEFAULT_INLINE_IMAGE_BUDGET } from '../core/contextBuilders/inlineImageBudget';
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

const INLINE_IMAGE_TIMEOUT_MS = 15_000;

/** `data:<mime>;base64,` plus base64 padding, reserved before converting to binary bytes. */
const DATA_URI_OVERHEAD_BYTES = 64;

/**
 * Reuses the request-size budget the Anthropic context builder already enforces: 5 MB of
 * base64 per image and 20 MB in total. A topic can hold many distinct images, so the
 * fallback must not turn all of them into base64 at once.
 */
const { maxImageBase64Bytes: MAX_IMAGE_BASE64_BYTES, maxTotalBase64Bytes: MAX_TOTAL_BASE64_BYTES } =
  DEFAULT_INLINE_IMAGE_BUDGET;

type MediaPart = Extract<UserMessageContentPart, { type: 'image_url' | 'video_url' }>;

/** Native Responses tool output parts, which `convertOpenAIResponseInputs` forwards verbatim. */
type ResponsesOutputItem = Exclude<
  NonNullable<OpenAIChatMessage['responsesOutput']>,
  string
>[number];

const isMediaPart = (part: UserMessageContentPart): part is MediaPart =>
  part?.type === 'image_url' || part?.type === 'video_url';

const getMediaUrl = (part: MediaPart) =>
  part.type === 'image_url' ? part.image_url.url : part.video_url.url;

const isRemoteImagePart = (part: UserMessageContentPart) =>
  part?.type === 'image_url' && parseDataUri(part.image_url.url).type === 'url';

const isOutputImage = (
  item: ResponsesOutputItem,
): item is Extract<ResponsesOutputItem, { type: 'input_image' }> => item?.type === 'input_image';

const isRemoteOutputImage = (item: ResponsesOutputItem) =>
  isOutputImage(item) && !!item.image_url && parseDataUri(item.image_url).type === 'url';

const outputItems = (message: OpenAIChatMessage) =>
  Array.isArray(message.responsesOutput)
    ? (message.responsesOutput as ResponsesOutputItem[])
    : undefined;

const toPlaceholder = (part: MediaPart): UserMessageContentPart => {
  const url = getMediaUrl(part);
  const kind = part.type === 'image_url' ? 'Image' : 'Video';
  const source = parseDataUri(url).type === 'url' ? ` Original URL: ${url}` : '';

  return {
    text: `[${kind} omitted: the model provider could not download or process it.${source}]`,
    type: 'text',
  };
};

const toOutputPlaceholder = (item: ResponsesOutputItem): ResponsesOutputItem => {
  const url = item.type === 'input_image' ? item.image_url : undefined;
  const source = url && parseDataUri(url).type === 'url' ? ` Original URL: ${url}` : '';

  return {
    text: `[Image omitted: the model provider could not download or process it.${source}]`,
    type: 'input_text',
  };
};

const mapMessageMedia = (
  messages: OpenAIChatMessage[],
  mapPart: (part: UserMessageContentPart) => UserMessageContentPart,
  mapOutputItem: (item: ResponsesOutputItem) => ResponsesOutputItem,
): OpenAIChatMessage[] =>
  messages.map((message) => {
    const hasParts = Array.isArray(message.content);
    const hasOutput = Array.isArray(message.responsesOutput);
    if (!hasParts && !hasOutput) return message;

    const next: OpenAIChatMessage = { ...message };
    if (hasParts) next.content = (message.content as UserMessageContentPart[]).map(mapPart);

    const output = outputItems(message);
    if (output) next.responsesOutput = output.map(mapOutputItem);

    return next;
  });

export const isMediaFetchError = (error: unknown): boolean => {
  const combined = collectErrorStrings(error)
    .map((value) => value.toLowerCase())
    .join('\n');

  return MEDIA_FETCH_ERROR_PATTERNS.some((pattern) => combined.includes(pattern));
};

export const hasRemoteImage = (messages: OpenAIChatMessage[]) =>
  messages.some(
    (message) =>
      (Array.isArray(message.content) && message.content.some(isRemoteImagePart)) ||
      outputItems(message)?.some(isRemoteOutputImage),
  );

export const hasMediaPart = (messages: OpenAIChatMessage[]) =>
  messages.some(
    (message) =>
      (Array.isArray(message.content) && message.content.some(isMediaPart)) ||
      outputItems(message)?.some(isOutputImage),
  );

export interface InlineRemoteImagesOptions {
  /** Caller abort signal; stops pending downloads together with the per-image timeout. */
  signal?: AbortSignal;
}

const downloadDataUri = async (
  url: string,
  remainingBase64Bytes: number,
  signal?: AbortSignal,
): Promise<string | undefined> => {
  const base64Allowance = Math.min(MAX_IMAGE_BASE64_BYTES, remainingBase64Bytes);
  const maxBytes = Math.floor((Math.max(0, base64Allowance - DATA_URI_OVERHEAD_BYTES) * 3) / 4);
  // `imageUrlToBase64` reads 0 as "no limit", so a leftover allowance below one byte has to
  // skip the download instead of passing it a value that disables the cap.
  if (maxBytes <= 0) return undefined;

  const timeout = AbortSignal.timeout(INLINE_IMAGE_TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const { base64, mimeType } = await imageUrlToBase64(url, { maxBytes, signal: abort });

    // A failed fetch can still return an HTML error page; never send that as an image.
    return mimeType.startsWith('image/') ? `data:${mimeType};base64,${base64}` : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Downloads remote images on our side and sends them as data URIs, so the request no
 * longer depends on the provider reaching the URL. An image we cannot download, or that
 * does not fit the request budget, becomes a text placeholder.
 *
 * Downloads are deduplicated per URL, but every emitted occurrence is charged against the
 * aggregate budget: a topic that repeats one 5 MB image seven times would otherwise send
 * 35 MB of base64 while only 5 MB was accounted for. Parts are visited in message order,
 * so the same conversation always produces the same inlining.
 */
export const inlineRemoteImages = async (
  messages: OpenAIChatMessage[],
  { signal }: InlineRemoteImagesOptions = {},
): Promise<OpenAIChatMessage[]> => {
  const cache = new Map<string, string | undefined>();
  let remainingBase64Bytes = MAX_TOTAL_BASE64_BYTES;

  const resolve = async (url: string) => {
    if (!cache.has(url)) {
      cache.set(
        url,
        remainingBase64Bytes > 0
          ? await downloadDataUri(
              url,
              Math.min(MAX_IMAGE_BASE64_BYTES, remainingBase64Bytes),
              signal,
            )
          : undefined,
      );
    }

    const dataUri = cache.get(url);
    if (!dataUri || dataUri.length > remainingBase64Bytes) return undefined;

    remainingBase64Bytes -= dataUri.length;
    return dataUri;
  };

  const result: OpenAIChatMessage[] = [];

  for (const message of messages) {
    const parts = Array.isArray(message.content)
      ? (message.content as UserMessageContentPart[])
      : undefined;
    const output = outputItems(message);

    if (!parts && !output) {
      result.push(message);
      continue;
    }

    const next: OpenAIChatMessage = { ...message };

    if (parts) {
      const mapped: UserMessageContentPart[] = [];
      for (const part of parts) {
        if (part?.type !== 'image_url' || parseDataUri(part.image_url.url).type !== 'url') {
          mapped.push(part);
          continue;
        }

        const dataUri = await resolve(part.image_url.url);
        mapped.push(
          dataUri
            ? { ...part, image_url: { ...part.image_url, url: dataUri } }
            : toPlaceholder(part),
        );
      }
      next.content = mapped;
    }

    if (output) {
      const mapped: ResponsesOutputItem[] = [];
      for (const item of output) {
        if (
          item?.type !== 'input_image' ||
          !item.image_url ||
          parseDataUri(item.image_url).type !== 'url'
        ) {
          mapped.push(item);
          continue;
        }

        const dataUri = await resolve(item.image_url);
        mapped.push(dataUri ? { ...item, image_url: dataUri } : toOutputPlaceholder(item));
      }
      next.responsesOutput = mapped;
    }

    result.push(next);
  }

  return result;
};

/** Last resort: keep the conversation usable as text by replacing every media part. */
export const replaceMediaWithPlaceholders = async (
  messages: OpenAIChatMessage[],
): Promise<OpenAIChatMessage[]> =>
  mapMessageMedia(
    messages,
    (part) => (isMediaPart(part) ? toPlaceholder(part) : part),
    (item) => (isOutputImage(item) ? toOutputPlaceholder(item) : item),
  );
