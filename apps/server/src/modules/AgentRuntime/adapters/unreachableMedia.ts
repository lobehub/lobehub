import { AgentRuntimeErrorType } from '@lobechat/types';

/**
 * Remote media the provider could not fetch, and how to drop it from a request.
 *
 * Image and video parts reach the provider as links it downloads itself. When
 * one link is dead (its file was deleted, its storage object is gone, or the
 * provider cannot reach the host), OpenAI-compatible upstreams reject the WHOLE
 * request — "Error while downloading <url>" — so a single stale image anywhere
 * in a long history blocks every later turn of that conversation, and every
 * sub-agent dispatched with it.
 *
 * These helpers let one attempt recover: find the link the provider named, and
 * replace that part with a text note so the model knows an image was there and
 * could not be shown.
 *
 * Only the code the provider adapter assigned is trusted (its pattern registry
 * maps "Error while downloading" to `RemoteMediaDownloadFailed`); the message
 * text is used just to find which link failed.
 */

const MEDIA_FETCH_ERROR_CODES = new Set<string>([
  AgentRuntimeErrorType.RemoteMediaDownloadFailed,
  AgentRuntimeErrorType.RemoteMediaDownloadTimeout,
]);

/** Most dead links one attempt drops before it gives up and reports the error. */
export const MAX_UNREACHABLE_MEDIA_STRIPS = 8;

type MediaPart =
  | { image_url: { url: string }; type: 'image_url' }
  | { type: 'video_url'; video_url: { url: string } };

const mediaUrlOf = (part: unknown): string | undefined => {
  if (!part || typeof part !== 'object') return;
  const { type } = part as { type?: unknown };
  if (type === 'image_url')
    return (part as Extract<MediaPart, { type: 'image_url' }>).image_url?.url;
  if (type === 'video_url')
    return (part as Extract<MediaPart, { type: 'video_url' }>).video_url?.url;
};

const isRemoteUrl = (url: string) => url.startsWith('http://') || url.startsWith('https://');

const collectRemoteMediaUrls = (messages: readonly unknown[]): Set<string> => {
  const urls = new Set<string>();
  for (const message of messages) {
    const content = (message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const url = mediaUrlOf(part);
      if (url && isRemoteUrl(url)) urls.add(url);
    }
  }
  return urls;
};

/** Everything the error says, including messages nested in Error instances. */
const errorText = (error: unknown): string => {
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error, (_key, value) =>
      value instanceof Error ? { ...value, message: value.message } : value,
    );
  } catch {
    return String(error);
  }
};

const isMediaFetchError = (error: unknown) => {
  const errorType = (error as { errorType?: unknown } | undefined)?.errorType;
  return typeof errorType === 'string' && MEDIA_FETCH_ERROR_CODES.has(errorType);
};

/**
 * The remote media link a provider failed to download, when the error names
 * one that is in the request. Undefined for any other failure, and when the
 * provider did not say which link failed — guessing would drop media that is
 * fine.
 */
export const findUnreachableMediaUrl = (
  error: unknown,
  messages: readonly unknown[],
): string | undefined => {
  if (!isMediaFetchError(error)) return;
  const text = errorText(error);

  let found: string | undefined;
  for (const url of collectRemoteMediaUrls(messages)) {
    // Prefer the longest match so `/f/file_1` does not claim `/f/file_10`.
    if (text.includes(url) && (!found || url.length > found.length)) found = url;
  }
  return found;
};

const unavailableNote = (part: unknown) => ({
  text: `[${(part as { type: string }).type === 'video_url' ? 'Video' : 'Image'} unavailable: the model provider could not download it, so it was removed from this request.]`,
  type: 'text' as const,
});

/** The link without its query, so a presigned signature never reaches the logs. */
export const redactMediaUrl = (url: string): string => {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return '[invalid url]';
  }
};

/**
 * Replace every image/video part that links to one of `urls` with a text note.
 * Messages without such a part are returned as-is.
 */
export const stripUnreachableMedia = <T>(messages: readonly T[], urls: ReadonlySet<string>): T[] =>
  messages.map((message) => {
    const content = (message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) return message;

    let changed = false;
    const next = content.map((part) => {
      const url = mediaUrlOf(part);
      if (!url || !urls.has(url)) return part;
      changed = true;
      return unavailableNote(part);
    });

    return changed ? ({ ...message, content: next } as T) : message;
  });
