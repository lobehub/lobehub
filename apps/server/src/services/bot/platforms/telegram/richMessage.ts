import { StreamingMarkdownRenderer } from 'chat';

import type { BotMessageAttachment } from '../types';
import type { TelegramMediaSource } from './mediaSource';
import { resolveTelegramSource, telegramMediaTypeFor } from './mediaSource';

export const TELEGRAM_RICH_MESSAGE_LIMIT = 32_768;

type TelegramRichMediaType = 'audio' | 'document' | 'photo' | 'video';

export interface TelegramInputMedia {
  media: string;
  supports_streaming?: boolean;
  type: TelegramRichMediaType;
}

export interface TelegramInputRichMessageMedia {
  id: string;
  media: TelegramInputMedia;
}

export interface TelegramInputRichMessage {
  markdown: string;
  media?: TelegramInputRichMessageMedia[];
}

export interface TelegramRichUpload {
  buffer: Buffer;
  fieldName: string;
  filename: string;
  mimeType?: string;
}

export interface PreparedTelegramRichMessage {
  richMessage: TelegramInputRichMessage;
  uploads: TelegramRichUpload[];
}

const escapeMarkdownTitle = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');

const richMediaTypeFor = (attachment: BotMessageAttachment): TelegramRichMediaType => {
  return telegramMediaTypeFor(attachment);
};

const richMediaLink = (mediaType: TelegramRichMediaType, id: string, caption?: string): string => {
  const title = caption?.trim() ? ` "${escapeMarkdownTitle(caption.trim())}"` : '';
  return `![](tg://${mediaType}?id=${id}${title})`;
};

export const truncateTelegramRichMarkdown = (markdown: string): string => {
  const characters = Array.from(markdown);
  if (characters.length <= TELEGRAM_RICH_MESSAGE_LIMIT) return markdown;

  let end = TELEGRAM_RICH_MESSAGE_LIMIT - 3;
  while (end > 0) {
    const renderer = new StreamingMarkdownRenderer();
    renderer.push(characters.slice(0, end).join(''));
    const rendered = `${renderer.finish()}...`;
    if (Array.from(rendered).length <= TELEGRAM_RICH_MESSAGE_LIMIT) return rendered;
    end -= 1;
  }
  return '...';
};

const inputMediaFromSource = (
  type: TelegramRichMediaType,
  source: TelegramMediaSource,
  fieldName: string,
): { input: TelegramInputMedia; upload?: TelegramRichUpload } => {
  if ('url' in source) {
    return {
      input: {
        media: source.url,
        supports_streaming: type === 'video' ? true : undefined,
        type,
      },
    };
  }

  return {
    input: {
      media: `attach://${fieldName}`,
      supports_streaming: type === 'video' ? true : undefined,
      type,
    },
    upload: {
      buffer: source.buffer,
      fieldName,
      filename: source.filename,
      mimeType: source.mimeType,
    },
  };
};

export const prepareTelegramRichMessage = async (
  markdown: string,
  attachments?: BotMessageAttachment[],
  options: { allowUploads?: boolean } = {},
): Promise<PreparedTelegramRichMessage> => {
  const media: TelegramInputRichMessageMedia[] = [];
  const mediaBlocks: string[] = [];
  const uploads: TelegramRichUpload[] = [];

  for (const [index, attachment] of attachments?.entries() ?? []) {
    if (options.allowUploads === false && !attachment.fetchUrl) continue;
    const source = attachment.fetchUrl
      ? ({ url: attachment.fetchUrl } satisfies TelegramMediaSource)
      : await resolveTelegramSource(attachment, index);
    if (!source) continue;

    const id = `media_${index}`;
    const fieldName = `file_${index}`;
    const type = richMediaTypeFor(attachment);
    const { input, upload } = inputMediaFromSource(type, source, fieldName);
    media.push({ id, media: input });
    mediaBlocks.push(richMediaLink(type, id, attachment.name));
    if (upload) uploads.push(upload);
  }

  const body = [markdown.trim(), ...mediaBlocks].filter(Boolean).join('\n\n');

  return {
    richMessage: {
      markdown: truncateTelegramRichMarkdown(body),
      ...(media.length > 0 ? { media } : {}),
    },
    uploads,
  };
};
