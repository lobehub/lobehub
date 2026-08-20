import type { MessengerAttachmentBudget } from '@lobechat/const';
import { MESSENGER_ATTACHMENT_BUDGETS } from '@lobechat/const';
import debug from 'debug';

import type { BotMessageAttachment } from './types';

const log = debug('bot-platform:attachment-budget');

/**
 * Per-platform attachment size budgets for the proactive push path.
 *
 * Every platform enforces (or silently applies) its own attachment cap, and
 * an over-budget upload either errors at the platform API (Telegram, Discord)
 * or — worse — succeeds end-to-end and never renders on the recipient's
 * client (WeChat iLink: a 2.3MB PNG returns 200 on `getuploadurl`, the CDN
 * upload AND `sendmessage`, yet the message never appears). Budgets let the
 * sender degrade deliberately instead of failing silently:
 *
 *   original attachment → recompressed image → download-link text
 *
 * The values live in `@lobechat/const` (MESSENGER_ATTACHMENT_BUDGETS) because
 * the push modal uses the same table to warn the user before sending.
 */
export type PlatformAttachmentBudget = MessengerAttachmentBudget;

export const PLATFORM_ATTACHMENT_BUDGETS = MESSENGER_ATTACHMENT_BUDGETS;

const MB = 1024 * 1024;

export interface PreparedAttachments {
  attachments: BotMessageAttachment[];
  /**
   * The original attachments behind `fallbackLines`. Callers with a replay
   * queue requeue these (rather than the whole input) when the link leg fails,
   * so an attachment that already uploaded is not sent twice.
   */
  degraded: BotMessageAttachment[];
  /**
   * One line per attachment that could not be delivered as a file within the
   * platform budget. Callers append these to the outbound text leg so the
   * recipient still gets the resource as a download link.
   */
  fallbackLines: string[];
  /**
   * The untouched inputs behind `attachments`, index-aligned with it. A
   * recompressed image carries megabytes of base64 in `attachments`; a caller
   * requeueing a failed send wants the small original back, not that.
   */
  keptOriginals: BotMessageAttachment[];
}

const formatBytes = (bytes: number): string => {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
};

/**
 * Cap the displayed filename so one fallback line stays well inside every
 * platform's message limit — a name can legitimately be 255 chars, and the
 * URL after it is the part that must never be truncated.
 */
const MAX_FALLBACK_NAME_CHARS = 60;

const truncateName = (name: string): string =>
  name.length <= MAX_FALLBACK_NAME_CHARS ? name : `${name.slice(0, MAX_FALLBACK_NAME_CHARS - 1)}…`;

/**
 * Language-neutral download-link line for an attachment that exceeds the
 * platform budget. In production `fetchUrl` is the stable anonymous
 * file-proxy URL (`/f/:id`), so the link keeps working after the presigned
 * storage snapshot would have expired.
 */
export const buildAttachmentFallbackLine = (
  attachment: BotMessageAttachment,
  url: string,
): string => {
  const name = truncateName(attachment.name?.trim() || 'file');
  const size = attachment.size ? ` (${formatBytes(attachment.size)})` : '';
  return `📎 ${name}${size}\n${url}`;
};

/**
 * Re-point a filename at the JPEG bytes we just produced. Discord and Slack
 * upload `name` verbatim and Discord picks its preview from the extension,
 * so leaving a recompressed PNG named `.png` ships JPEG bytes under a lying
 * extension. `undefined` stays undefined — the platform senders then infer a
 * generic name from `mimeType`, which is already `image/jpeg`.
 */
const toJpegFilename = (name: string | undefined): string | undefined => {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  return `${trimmed.replace(/\.[^./\\]*$/, '')}.jpg`;
};

/** Refuse to buffer arbitrarily large remote files into memory for compression. */
const MAX_COMPRESSION_SOURCE_BYTES = 100 * MB;

const loadSourceBuffer = async (attachment: BotMessageAttachment): Promise<Buffer | undefined> => {
  if (attachment.data) {
    try {
      return Buffer.from(attachment.data, 'base64');
    } catch (error) {
      log('loadSourceBuffer: failed to decode base64: %O', error);
    }
  }
  if (attachment.fetchUrl) {
    try {
      const response = await fetch(attachment.fetchUrl, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length <= MAX_COMPRESSION_SOURCE_BYTES) return buffer;
        log('loadSourceBuffer: %d bytes exceeds compression source cap', buffer.length);
      } else {
        log('loadSourceBuffer: HTTP %d for %s', response.status, attachment.fetchUrl);
      }
    } catch (error) {
      log('loadSourceBuffer: fetch failed for %s: %O', attachment.fetchUrl, error);
    }
  }
  return undefined;
};

/**
 * Ladder of (max dimension, JPEG quality) attempts, largest/best first. The
 * first re-encode that fits the byte budget wins. JPEG is deliberate: chat
 * screenshots and photos re-encode an order of magnitude smaller than PNG,
 * and every push platform renders JPEG. Alpha flattens to white.
 */
const COMPRESSION_LADDER: Array<[number, number]> = [
  [4096, 82],
  [2048, 80],
  [2048, 65],
  [1600, 60],
  [1200, 55],
  [900, 50],
];

/**
 * Re-encode an image to fit `maxBytes`, or return undefined when it cannot
 * (not an image sharp can decode, or still over budget at the smallest rung).
 *
 * sharp is imported lazily: this module is reachable from the outbound push
 * path, which deliberately keeps heavy native dependencies out of its module
 * graph (see services/messenger/outbound.ts) — the import cost is only paid
 * when an over-budget image actually needs recompression.
 */
export const compressImageToBudget = async (
  source: Buffer,
  maxBytes: number,
): Promise<Buffer | undefined> => {
  try {
    const { default: sharp } = await import('sharp');

    // An animated GIF or WebP re-encodes to a single static frame, silently
    // turning the user's animation into a still. There is no JPEG that can
    // carry it, so refuse and let the caller fall back to a download link.
    const { pages } = await sharp(source).metadata();
    if (pages && pages > 1) {
      log('refusing to flatten a %d-page animated image — falling back to a link', pages);
      return undefined;
    }

    for (const [dimension, quality] of COMPRESSION_LADDER) {
      const result = await sharp(source)
        .rotate() // apply EXIF orientation before it is stripped by re-encode
        .resize(dimension, dimension, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality })
        .toBuffer();
      if (result.length <= maxBytes) {
        log(
          'compressed image %d → %d bytes (dim=%d q=%d)',
          source.length,
          result.length,
          dimension,
          quality,
        );
        return result;
      }
    }
    log('compression exhausted ladder without fitting %d bytes', maxBytes);
    return undefined;
  } catch (error) {
    log('compressImageToBudget failed: %O', error);
    return undefined;
  }
};

const knownSize = (attachment: BotMessageAttachment): number | undefined => {
  if (typeof attachment.size === 'number' && attachment.size > 0) return attachment.size;
  // Base64 inflates by 4/3 — close enough for a budget check.
  if (attachment.data) return Math.floor(attachment.data.length * 0.75);
  return undefined;
};

/**
 * Fit attachments to a platform budget before handing them to the platform
 * sender. Three-tier degradation per attachment:
 *
 * 1. Within budget (or size unknown): passed through untouched — senders keep
 *    their existing behavior, including Telegram's URL pass-through.
 * 2. Over-budget image: downloaded and recompressed under `imageMaxBytes`;
 *    the attachment is rewritten to carry the compressed bytes as base64
 *    `data` (the platform senders all accept `data` over `fetchUrl`).
 * 3. Over-budget file / video / audio — or an image that cannot be
 *    compressed under budget: replaced by a download-link line in
 *    `fallbackLines` when a `fetchUrl` exists. Without a URL the original
 *    attachment is kept as a last resort (old behavior) rather than dropped.
 */
export const prepareAttachmentsForBudget = async (
  attachments: BotMessageAttachment[],
  budget: PlatformAttachmentBudget,
): Promise<PreparedAttachments> => {
  const kept: BotMessageAttachment[] = [];
  const keptOriginals: BotMessageAttachment[] = [];
  const degraded: BotMessageAttachment[] = [];
  const fallbackLines: string[] = [];

  for (const attachment of attachments) {
    const limit = attachment.type === 'image' ? budget.imageMaxBytes : budget.fileMaxBytes;
    const size = knownSize(attachment);

    if (size === undefined || size <= limit) {
      kept.push(attachment);
      keptOriginals.push(attachment);
      continue;
    }

    // Only images are worth downloading — and only when the declared size is
    // small enough that buffering it for re-encode is safe. A 500MB "image"
    // goes straight to the link fallback instead of into memory.
    if (attachment.type === 'image' && size <= MAX_COMPRESSION_SOURCE_BYTES) {
      const source = await loadSourceBuffer(attachment);
      const compressed = source && (await compressImageToBudget(source, budget.imageMaxBytes));
      if (compressed) {
        kept.push({
          ...attachment,
          data: compressed.toString('base64'),
          fetchUrl: undefined,
          mimeType: 'image/jpeg',
          name: toJpegFilename(attachment.name),
          size: compressed.length,
        });
        keptOriginals.push(attachment);
        continue;
      }
    }

    if (attachment.fetchUrl) {
      log(
        'attachment "%s" (%d bytes) exceeds %d-byte budget — degrading to link',
        attachment.name ?? '(unnamed)',
        size,
        limit,
      );
      fallbackLines.push(buildAttachmentFallbackLine(attachment, attachment.fetchUrl));
      degraded.push(attachment);
      continue;
    }

    // No URL to link to and no smaller representation — keep the original and
    // let the platform sender try (matches pre-budget behavior).
    kept.push(attachment);
    keptOriginals.push(attachment);
  }

  return { attachments: kept, degraded, fallbackLines, keptOriginals };
};

/**
 * Pack fallback link lines into as few follow-up text messages as fit under
 * `maxChars`. Batching is by whole line: Discord rejects a message over its
 * limit outright and Telegram truncates at its own, either of which would
 * cut a URL in half and hand the user a dead link. Lines are already length
 * capped (see MAX_FALLBACK_NAME_CHARS), so a single line always fits.
 */
export const splitFallbackMessages = (fallbackLines: string[], maxChars: number): string[] => {
  const messages: string[] = [];
  let current = '';

  for (const line of fallbackLines) {
    const candidate = current ? `${current}\n\n${line}` : line;
    if (current && candidate.length > maxChars) {
      messages.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) messages.push(current);

  return messages;
};
