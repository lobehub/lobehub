import debug from 'debug';

import type { BotMessageAttachment } from '../types';
import type { TelegramApi } from './api';

const log = debug('bot-platform:telegram:send-attachments');

/**
 * Normalized form fed into the typed `TelegramApi.send{Photo,Document,...}`
 * helpers. URL-source is preferred when available — Telegram fetches the
 * bytes server-side, saving us a round-trip + base64 inflation.
 */
type TelegramMediaSource =
  | { url: string }
  | { buffer: Buffer; filename: string; mimeType?: string };

const fallbackFilename = (att: BotMessageAttachment, index: number): string => {
  if (att.name) return att.name;
  if (att.fetchUrl) {
    try {
      const base = new URL(att.fetchUrl).pathname.split('/').pop();
      if (base) return base;
    } catch {
      // fall through
    }
  }
  return `attachment-${index + 1}`;
};

/**
 * Resolve a `BotMessageAttachment` into a Telegram-ready source. Prefers
 * `fetchUrl` so Telegram fetches the bytes server-side. Falls back to
 * materializing `data` (base64) as a Buffer for multipart upload. Returns
 * `undefined` when neither source is usable so the caller can skip the item.
 */
const resolveTelegramSource = (
  att: BotMessageAttachment,
  index: number,
): TelegramMediaSource | undefined => {
  if (att.fetchUrl) {
    return { url: att.fetchUrl };
  }
  if (att.data) {
    try {
      return {
        buffer: Buffer.from(att.data, 'base64'),
        filename: fallbackFilename(att, index),
        mimeType: att.mimeType,
      };
    } catch (error) {
      log('resolveTelegramSource: failed to decode base64 for "%s": %O', att.name, error);
    }
  }
  return undefined;
};

const dispatch = async (
  api: TelegramApi,
  chatId: string | number,
  att: BotMessageAttachment,
  source: TelegramMediaSource,
  caption: string | undefined,
): Promise<void> => {
  switch (att.type) {
    case 'image': {
      await api.sendPhoto({ caption, chatId, source });
      return;
    }
    case 'video': {
      await api.sendVideo({ caption, chatId, source });
      return;
    }
    case 'audio': {
      await api.sendAudio({ caption, chatId, source });
      return;
    }
    case 'file':
    default: {
      await api.sendDocument({ caption, chatId, source });
    }
  }
};

/**
 * Deliver each attachment as its own typed Telegram media call. The first
 * attachment carries `caption` (acting as the text leg of the reply); the
 * rest are caption-less so the body isn't repeated. Single-item failures
 * are logged and skipped so the rest still ship.
 *
 * Returns the number of successfully delivered attachments — callers can
 * use 0 to decide whether to fall back to a plain `sendMessage` for the
 * text leg.
 */
export const sendTelegramAttachments = async (
  api: TelegramApi,
  chatId: string | number,
  attachments: BotMessageAttachment[],
  caption?: string,
): Promise<number> => {
  let delivered = 0;
  for (const [index, att] of attachments.entries()) {
    const source = resolveTelegramSource(att, index);
    if (!source) {
      log('sendTelegramAttachments: skipping attachment without resolvable source');
      continue;
    }
    try {
      await dispatch(api, chatId, att, source, delivered === 0 ? caption : undefined);
      delivered += 1;
    } catch (error) {
      log(
        'sendTelegramAttachments: failed to send %s "%s": %O',
        att.type,
        att.name ?? '(unnamed)',
        error,
      );
    }
  }
  return delivered;
};
