import type { MessageItem, MessageItemAttachment } from '../types';

/**
 * At most this many images ride on one readMessages / searchMessages result. Each one costs
 * vision tokens on every later turn until the result goes stale, so only the newest are kept.
 */
export const MAX_MESSAGE_IMAGES = 4;

/** Formats a vision model reads natively; anything else stays a text marker. */
const IMAGE_MEDIA_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

const MEDIA_TYPE_BY_EXT: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** An image attachment the model may be shown, newest message first. */
export interface MessageImageCandidate {
  mediaType: string;
  messageId: string;
  name: string;
  size?: number;
  url: string;
}

/** A candidate stored where the model provider can fetch it (`pluginState.images` entry). */
export interface MessageToolImage {
  fileId?: string;
  mediaType: string;
  messageId: string;
  name: string;
  url: string;
}

/**
 * Turns platform image URLs into URLs a model provider can fetch for as long as the topic lives.
 * Platform CDN links expire (Discord signs them for about a day), so the server copies the bytes
 * into file storage. Candidates it cannot or will not store are left out of the result.
 */
export type MessageImageResolver = (
  candidates: MessageImageCandidate[],
) => Promise<MessageToolImage[]>;

/** The image media type of an attachment, or undefined when it is not a readable image. */
export const imageMediaType = (attachment: MessageItemAttachment): string | undefined => {
  const declared = attachment.contentType?.split(';')[0].trim().toLowerCase();
  if (declared) return IMAGE_MEDIA_TYPES.has(declared) ? declared : undefined;

  const ext = attachment.name.split('.').pop()?.toLowerCase();
  return ext ? MEDIA_TYPE_BY_EXT[ext] : undefined;
};

const timeOf = (message: MessageItem) => {
  const time = Date.parse(message.timestamp);
  return Number.isFinite(time) ? time : 0;
};

/**
 * Image attachments across a page of messages, newest message first and capped. Returns the
 * total too, so the result can say how many were left out.
 */
export const collectImageCandidates = (
  messages: MessageItem[] | undefined,
  limit = MAX_MESSAGE_IMAGES,
): { candidates: MessageImageCandidate[]; total: number } => {
  const all = [...(messages ?? [])]
    .sort((a, b) => timeOf(b) - timeOf(a))
    .flatMap((message) =>
      (message.attachments ?? []).flatMap((attachment) => {
        const mediaType = imageMediaType(attachment);
        if (!mediaType || !attachment.url) return [];
        return [
          {
            mediaType,
            messageId: message.id,
            name: attachment.name,
            size: attachment.size,
            url: attachment.url,
          },
        ];
      }),
    );

  return { candidates: all.slice(0, limit), total: all.length };
};

/**
 * One message per line. Attachments are named after the text, so an image-only message no
 * longer reads as an empty line; an image that rides on this result says which one it is.
 */
export const formatMessageLines = (
  messages: MessageItem[] | undefined,
  images: MessageToolImage[] = [],
): string | undefined => {
  if (!messages) return undefined;

  return messages
    .map((m) => {
      const attachments = (m.attachments ?? []).map((attachment) => {
        const index = images.findIndex(
          (image) => image.messageId === m.id && image.name === attachment.name,
        );
        if (index >= 0) return `[image #${index + 1} attached to this result: ${attachment.name}]`;
        const type = attachment.contentType ? `, ${attachment.contentType}` : '';
        return `[attachment: ${attachment.name}${type}]`;
      });
      const body = [m.content, ...attachments].filter(Boolean).join(' ');

      return `[${m.timestamp}] [messageId: ${JSON.stringify(m.id)}] ${m.author.name}: ${body}`;
    })
    .join('\n');
};

/** Footer telling the model what it can see and what was left out. */
export const describeAttachedImages = (images: MessageToolImage[], total: number): string => {
  if (total === 0) return '';
  if (images.length === 0) {
    return `\n\n[${total} image attachment(s) in these messages could not be loaded, so you cannot see them. Do not describe them; ask the user what they show if it matters.]`;
  }
  const skipped = total - images.length;
  const range = images.length === 1 ? 'image #1' : `images #1–#${images.length}, newest first`;
  return `\n\n[${images.length} image(s) from these messages are attached to this result as ${range}.${skipped > 0 ? ` ${skipped} older image(s) are not attached.` : ''}]`;
};
