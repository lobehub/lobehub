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
 * Only IMAGES prefer `fetchUrl` — `sendPhoto` is the one endpoint that ingests
 * an arbitrary URL reliably, and letting Telegram pull the bytes saves a
 * round-trip + base64 inflation. Everything else is materialized into a Buffer
 * for multipart upload, because Bot API URL ingestion is documented per method
 * and our URL shape satisfies none of it:
 * - `sendDocument` by URL only works for .pdf/.zip, and the stable file-proxy
 *   URL (`/f/:id`) carries no extension and answers with a 302 — Telegram
 *   rejects it for every document type, including PDFs.
 * - `sendAudio` by URL needs the declared MIME type to match (audio/mpeg);
 *   anything else comes back as `failed to get HTTP URL content`.
 * - `sendVideo` is just as fragile on that URL shape, and uploading the bytes
 *   is also what lets Telegram probe duration/dimensions so the message arrives
 *   with a real player rather than a bare blob.
 *
 * Returns `undefined` when no source is usable so the caller can skip the
 * item without aborting the whole batch.
 */
const resolveTelegramSource = async (
  att: BotMessageAttachment,
  index: number,
): Promise<TelegramMediaSource | undefined> => {
  if (att.type === 'image' && att.fetchUrl) return { url: att.fetchUrl };
  return uploadSource(att, index);
};

/**
 * `sendAudio` renders a playable audio message, but the Bot API accepts only
 * .MP3 / .M4A there — a .wav / .flac / .ogg is rejected outright rather than
 * degraded. Those still reach the user as a document, which Telegram happily
 * plays inline for common audio types.
 */
const TELEGRAM_AUDIO_MIME_TYPES = new Set(['audio/mp4', 'audio/mpeg', 'audio/x-m4a']);
const TELEGRAM_AUDIO_EXTENSIONS = new Set(['m4a', 'mp3']);

const isTelegramPlayableAudio = (att: BotMessageAttachment): boolean => {
  const mime = att.mimeType?.toLowerCase().split(';')[0].trim();
  if (mime && TELEGRAM_AUDIO_MIME_TYPES.has(mime)) return true;

  // A correct extension still wins when the MIME type is a generic
  // `application/octet-stream`, which object storage hands back often enough.
  const name = att.name?.toLowerCase() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && TELEGRAM_AUDIO_EXTENSIONS.has(name.slice(dot + 1));
};

type TelegramMediaMethod = 'sendAudio' | 'sendDocument' | 'sendPhoto' | 'sendVideo';

const methodFor = (att: BotMessageAttachment): TelegramMediaMethod => {
  switch (att.type) {
    case 'image': {
      return 'sendPhoto';
    }
    case 'video': {
      return 'sendVideo';
    }
    case 'audio': {
      return isTelegramPlayableAudio(att) ? 'sendAudio' : 'sendDocument';
    }
    default: {
      return 'sendDocument';
    }
  }
};

const dispatch = async (
  api: TelegramApi,
  method: TelegramMediaMethod,
  params: { caption?: string; chatId: string | number; source: TelegramMediaSource },
): Promise<void> => {
  switch (method) {
    case 'sendPhoto': {
      await api.sendPhoto(params);
      return;
    }
    case 'sendVideo': {
      await api.sendVideo(params);
      return;
    }
    case 'sendAudio': {
      await api.sendAudio(params);
      return;
    }
    default: {
      await api.sendDocument(params);
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

    const attemptCaption = delivered === 0 ? caption : undefined;
    const method = methodFor(att);
    try {
      await dispatch(api, method, { caption: attemptCaption, chatId, source });
      delivered += 1;
      continue;
    } catch (error) {
      log(
        'sendTelegramAttachments: %s failed for %s "%s": %O',
        method,
        att.type,
        att.name ?? '(unnamed)',
        error,
      );
    }

    // Every typed endpoint enforces format rules of its own, and each time one
    // of them rejected us the attachment was DROPPED — the caller saw zero
    // deliveries and the user got "push unavailable" with no file at all
    // (.md/.csv/.pdf, then .wav, all the same shape). `sendDocument` takes
    // arbitrary bytes, so spend one more call there before giving up.
    if (method === 'sendDocument') continue;
    const bytes = 'buffer' in source ? source : await uploadSource(att, index);
    if (!bytes) continue;
    try {
      await api.sendDocument({ caption: attemptCaption, chatId, source: bytes });
      delivered += 1;
    } catch (error) {
      log('sendTelegramAttachments: document fallback failed for "%s": %O', att.name, error);
    }
  }
  return delivered;
};
