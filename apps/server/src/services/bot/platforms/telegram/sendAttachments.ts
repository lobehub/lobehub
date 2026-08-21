import debug from 'debug';

import { loadAttachmentBuffer, MAX_IN_MEMORY_ATTACHMENT_BYTES } from '../loadAttachmentBuffer';
import type { BotMessageAttachment } from '../types';
import type { TelegramApi } from './api';

const log = debug('bot-platform:telegram:send-attachments');

/**
 * Normalized form fed into the typed `TelegramApi.send{Photo,Document,...}`
 * helpers. URL-source is preferred when available — Telegram fetches the
 * bytes server-side, saving us a round-trip + base64 inflation.
 */
type TelegramMediaSource =
  { url: string } | { buffer: Buffer; filename: string; mimeType?: string };

/**
 * Refuse to buffer arbitrarily large remote files into memory for a multipart
 * upload. Matches the Bot API's 50MB upload cap; the attachment-budget pass
 * has already degraded anything over the platform budget to a download link,
 * so this only guards attachments whose size was unknown up front.
 */
const MAX_UPLOAD_SOURCE_BYTES = MAX_IN_MEMORY_ATTACHMENT_BYTES;

/** Download timeout for materializing an attachment (up to ~50MB). */
const DOWNLOAD_TIMEOUT_MS = 30_000;

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
 * Materialize the attachment's bytes for a multipart upload. The cap is
 * enforced while the body streams in, so an attachment whose size was unknown
 * or under-reported cannot exhaust the worker before being rejected.
 */
const uploadSource = async (
  att: BotMessageAttachment,
  index: number,
): Promise<TelegramMediaSource | undefined> => {
  const buffer = await loadAttachmentBuffer(att, {
    limit: MAX_UPLOAD_SOURCE_BYTES,
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
  });
  if (!buffer) return undefined;

  return { buffer, filename: fallbackFilename(att, index), mimeType: att.mimeType };
};

/**
 * Resolve a `BotMessageAttachment` into a Telegram-ready source.
 *
 * Images and audio prefer `fetchUrl` — Telegram fetches the bytes
 * server-side, saving a round-trip + base64 inflation, and those endpoints
 * accept arbitrary URLs.
 *
 * Documents and videos are ALWAYS materialized into a Buffer for multipart
 * upload instead:
 * - `sendDocument` by URL only works for .pdf/.zip per the Bot API, and the
 *   stable file-proxy URL (`/f/:id`) carries no extension and answers with a
 *   302 — Telegram rejects it for every document type, including PDFs.
 * - Videos ride `sendDocument` too (see `dispatch`), so they need bytes for
 *   the same reason.
 *
 * Returns `undefined` when no source is usable so the caller can skip the
 * item without aborting the whole batch.
 */
const resolveTelegramSource = async (
  att: BotMessageAttachment,
  index: number,
): Promise<TelegramMediaSource | undefined> => {
  if (att.type === 'file' || att.type === 'video') return uploadSource(att, index);
  if (att.fetchUrl) return { url: att.fetchUrl };
  return uploadSource(att, index);
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
      // Deliberately `sendDocument`, not `sendVideo`: Telegram re-encodes a
      // soundless MP4 sent as "video" into an animation (rendered with a GIF
      // badge, original audio-less file lost). Product/screen-recording videos
      // routinely have no audio track, and we cannot detect that server-side
      // without ffprobe. A document upload preserves the original bytes and
      // Telegram still inline-plays MP4 documents.
      await api.sendDocument({ caption, chatId, source });
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
    const source = await resolveTelegramSource(att, index);
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
