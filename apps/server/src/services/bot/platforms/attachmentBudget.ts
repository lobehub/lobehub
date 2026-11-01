import type { MessengerAttachmentBudget, MessengerOversizeImageStrategy } from '@lobechat/const';
import {
  DEFAULT_OVERSIZE_IMAGE_STRATEGY,
  MESSENGER_ATTACHMENT_BUDGETS,
  MESSENGER_MAX_COMPRESSION_SOURCE_BYTES,
} from '@lobechat/const';
import debug from 'debug';

import { loadAttachmentBuffer } from './loadAttachmentBuffer';
import { fetchPublicUrl } from './publicUrlFetch';
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
   * Why each degraded attachment could not go out as a file, index-aligned with
   * `degraded`. The delivery boundary logs these once per push; nothing in this
   * module prints, so the volume stays one line per send rather than two per
   * attachment.
   */
  degradations: AttachmentDegradation[];
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

/**
 * Refuse to buffer arbitrarily large remote files into memory for compression.
 * Enforced as the response streams in, so an image with an absent or lying
 * `content-length` cannot be fully allocated before it is rejected. Shared with
 * the push modal, which must not offer a choice this cap will overrule.
 */
const MAX_COMPRESSION_SOURCE_BYTES = MESSENGER_MAX_COMPRESSION_SOURCE_BYTES;

const loadSourceBuffer = async (attachment: BotMessageAttachment): Promise<Buffer | undefined> =>
  loadAttachmentBuffer(attachment, { limit: MAX_COMPRESSION_SOURCE_BYTES });

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
    // Routine input, not a system fault: plenty of things a user attaches are
    // not images sharp can decode. The caller records `compression-failed`
    // against the attachment, which is where the reason belongs.
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
/** How long to wait for a size probe before giving up on it. */
const SIZE_PROBE_TIMEOUT_MS = 5000;

/**
 * The attachment's byte size, established without downloading it.
 *
 * `attachmentsInputSchema` carries no `size`, so raw `botMessage` attachments
 * arrive unmeasured — and an unmeasured attachment used to skip every budget
 * rule, only to be refused later by the loader's in-memory cap and dropped
 * without a trace. Inline base64 is measured directly; a remote URL is probed
 * with a HEAD request through the same SSRF guard the download uses.
 */
const resolveSize = async (attachment: BotMessageAttachment): Promise<number | undefined> => {
  const declared = knownSize(attachment);
  if (declared !== undefined) return declared;

  if (attachment.data) return Buffer.byteLength(attachment.data, 'base64');
  if (!attachment.fetchUrl) return undefined;

  const probed = await fetchPublicUrl(attachment.fetchUrl, SIZE_PROBE_TIMEOUT_MS, {
    allowConfiguredOrigins: attachment.trustedUrl === true,
    method: 'HEAD',
  }).catch(() => undefined);
  if (!probed) return undefined;

  try {
    // A 404's `content-length` describes the error page, not the file.
    if (!probed.response.ok) return undefined;

    // Absent header must stay "unknown": `Number(null)` is 0, which would read
    // as a zero-byte file that fits every budget.
    const header = probed.response.headers.get('content-length');
    if (header === null) return undefined;

    const length = Number(header);
    return Number.isFinite(length) && length >= 0 ? length : undefined;
  } finally {
    await probed.dispose();
  }
};

/**
 * Why an attachment is going out as a download link instead of a file.
 *
 * Returned to the caller rather than printed here. Every failure in this chain
 * collapses into the same visible outcome — a link — so without the reason the
 * sender can only report the symptom, and "the compression failed" stays a
 * guess. But a per-attachment print is the wrong carrier: it is unattributable
 * prose, it scales with attachment count, and it would put routine input (an
 * image sharp cannot decode) into the error stream. The reason travels with the
 * result instead, and the delivery boundary decides what to record.
 */
export type DegradationReason =
  /** Bytes downloaded, but no rung of the ladder produced a small enough JPEG. */
  | 'compression-failed'
  /** Over budget and not an image, so there is nothing smaller to send. */
  | 'not-compressible'
  /** The attachment's bytes could not be fetched at all. */
  | 'source-unavailable'
  /** The sender chose to keep the original and send it as a link. */
  | 'strategy-link'
  /** The server could not establish the byte size, so the budget cannot hold. */
  | 'unverifiable-size';

export interface AttachmentDegradation {
  name?: string;
  reason: DegradationReason;
  size?: number;
  type: BotMessageAttachment['type'];
}

/**
 * Make one user-controlled string safe to put on a log line.
 *
 * A filename is attacker-controlled input that ends up in persistent logs. A
 * newline in it forges a whole additional log entry — the reader cannot tell
 * the forged line from a real one — and other control characters corrupt
 * whatever consumes the stream. Length is capped too, so one absurd name
 * cannot push the rest of the line out of a truncated log record.
 *
 * The name is sanitized rather than dropped: without it the line cannot say
 * WHICH attachment degraded, which is the only reason it is written.
 */
const MAX_LOGGED_NAME_CHARS = 60;

export const sanitizeForLog = (value: string): string => {
  // Strip C0/C1 controls, DEL, and the Unicode line/paragraph separators —
  // \u2028 and \u2029 are line breaks to plenty of log viewers.
  const flattened = value
    // eslint-disable-next-line no-control-regex
    .replaceAll(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (!flattened) return '(unnamed)';
  return flattened.length <= MAX_LOGGED_NAME_CHARS
    ? flattened
    : `${flattened.slice(0, MAX_LOGGED_NAME_CHARS - 1)}…`;
};

/**
 * One short clause per degraded attachment, for the boundary's single log line.
 * Deliberately loose in `reason` so a caller can append platform detail (an
 * iLink `errmsg`) without widening the reason union itself — which is also
 * caller-controlled text, so it goes through the same sanitizer.
 */
export const summarizeDegradations = (
  degradations: { name?: string; reason: string; type: string }[],
): string =>
  degradations
    .map(
      (d) =>
        `${d.name ? sanitizeForLog(d.name) : `(unnamed ${d.type})`}: ${sanitizeForLog(d.reason)}`,
    )
    .join('; ');

export interface PrepareAttachmentsOptions {
  /**
   * What to do with an image over `imageMaxBytes`. Defaults to `compress` —
   * the behavior every caller had before the choice existed.
   */
  oversizeImageStrategy?: MessengerOversizeImageStrategy;
}

export const prepareAttachmentsForBudget = async (
  attachments: BotMessageAttachment[],
  budget: PlatformAttachmentBudget,
  { oversizeImageStrategy = DEFAULT_OVERSIZE_IMAGE_STRATEGY }: PrepareAttachmentsOptions = {},
): Promise<PreparedAttachments> => {
  const kept: BotMessageAttachment[] = [];
  const keptOriginals: BotMessageAttachment[] = [];
  const degraded: BotMessageAttachment[] = [];
  const degradations: AttachmentDegradation[] = [];
  const fallbackLines: string[] = [];

  const recordDegradation = (
    attachment: BotMessageAttachment,
    reason: DegradationReason,
    size?: number,
  ) => {
    log('degrading "%s" to a link: %s', attachment.name ?? '(unnamed)', reason);
    degradations.push({
      name: attachment.name,
      reason,
      size: size ?? attachment.size,
      type: attachment.type,
    });
  };

  // Probe every unmeasured attachment at once rather than once per loop turn:
  // serially, N slow URLs cost N x the probe timeout before the first send.
  const sizes = await Promise.all(attachments.map((attachment) => resolveSize(attachment)));

  for (const [index, attachment] of attachments.entries()) {
    const limit = attachment.type === 'image' ? budget.imageMaxBytes : budget.fileMaxBytes;
    const size = sizes[index];

    if (size !== undefined && size <= limit) {
      kept.push(attachment);
      keptOriginals.push(attachment);
      continue;
    }

    // Size still unknown after the probe: the server declared no length, so we
    // cannot promise the bytes fit. Uploading anyway is the silent-loss case —
    // the loader's in-memory cap would refuse it during materialization and the
    // sender would skip it, delivering neither file nor link. Degrade instead;
    // an attachment with no link to fall back to is kept as a last resort
    // below.
    if (size === undefined) {
      if (!attachment.fetchUrl) {
        kept.push(attachment);
        keptOriginals.push(attachment);
        continue;
      }
      recordDegradation(attachment, 'unverifiable-size');
      degraded.push(attachment);
      fallbackLines.push(buildAttachmentFallbackLine(attachment, attachment.fetchUrl));
      continue;
    }

    // Only images are worth downloading — and only when the declared size is
    // small enough that buffering it for re-encode is safe. A 500MB "image"
    // goes straight to the link fallback instead of into memory. `link` is the
    // sender's explicit choice to keep the original, so the download and
    // re-encode are skipped entirely rather than attempted and thrown away.
    if (
      oversizeImageStrategy === 'compress' &&
      attachment.type === 'image' &&
      size <= MAX_COMPRESSION_SOURCE_BYTES
    ) {
      const source = await loadSourceBuffer(attachment);
      const compressed = source && (await compressImageToBudget(source, budget.imageMaxBytes));
      if (!compressed)
        recordDegradation(attachment, source ? 'compression-failed' : 'source-unavailable', size);
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
      // A `link` strategy is the sender's deliberate choice, not a failure, and
      // an image that just failed to compress has already been reported above.
      // An image that already recorded `compression-failed` / `source-unavailable`
      // above is not recorded twice; `link` is the sender's own choice, not a
      // failure, and is labelled as such.
      if (oversizeImageStrategy === 'link' && attachment.type === 'image')
        recordDegradation(attachment, 'strategy-link', size);
      else if (attachment.type !== 'image' || size > MAX_COMPRESSION_SOURCE_BYTES)
        recordDegradation(attachment, 'not-compressible', size);
      fallbackLines.push(buildAttachmentFallbackLine(attachment, attachment.fetchUrl));
      degraded.push(attachment);
      continue;
    }

    // No URL to link to and no smaller representation — keep the original and
    // let the platform sender try (matches pre-budget behavior).
    kept.push(attachment);
    keptOriginals.push(attachment);
  }

  return { attachments: kept, degradations, degraded, fallbackLines, keptOriginals };
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
