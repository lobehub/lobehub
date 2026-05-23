import type { RawFile } from '@discordjs/rest';
import debug from 'debug';

import type { BotMessageAttachment } from '../types';

const log = debug('bot-platform:discord:send-attachments');

/**
 * Discord caps each message at 10 attachments. Batches beyond that go into
 * follow-up messages.
 *
 * See: https://discord.com/developers/docs/resources/channel#create-message
 */
export const DISCORD_MAX_ATTACHMENTS_PER_MESSAGE = 10;

/**
 * Materialize an attachment's bytes from `data` (base64) or `fetchUrl` (HTTP
 * GET, 15s timeout). Returns undefined if neither source resolves so the
 * caller can skip the failing item without aborting the whole batch.
 */
const loadAttachmentBuffer = async (
  attachment: BotMessageAttachment,
): Promise<Buffer | undefined> => {
  if (attachment.data) {
    try {
      return Buffer.from(attachment.data, 'base64');
    } catch (error) {
      log('loadAttachmentBuffer: failed to decode base64: %O', error);
    }
  }
  if (attachment.fetchUrl) {
    try {
      const response = await fetch(attachment.fetchUrl, {
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
      log('loadAttachmentBuffer: HTTP %d for %s', response.status, attachment.fetchUrl);
    } catch (error) {
      log('loadAttachmentBuffer: fetch failed for %s: %O', attachment.fetchUrl, error);
    }
  }
  return undefined;
};

/**
 * Pick a filename for the Discord upload. Falls back to a generic name with
 * the appropriate extension inferred from `mimeType` so Discord's preview
 * works (Discord uses the filename extension, not mimeType, to pick its
 * viewer).
 */
const resolveFilename = (attachment: BotMessageAttachment, index: number): string => {
  if (attachment.name) return attachment.name;
  if (attachment.fetchUrl) {
    try {
      const base = new URL(attachment.fetchUrl).pathname.split('/').pop();
      if (base) return base;
    } catch {
      // ignore — fall through to the generic name
    }
  }
  const ext = mimeToExt(attachment.mimeType) ?? defaultExtForType(attachment.type);
  return `attachment-${index + 1}${ext}`;
};

const mimeToExt = (mimeType?: string): string | undefined => {
  if (!mimeType) return undefined;
  // Common cases; Discord's previewer covers far more, but we only need the
  // ones the agent runtime is realistically going to emit.
  const map: Record<string, string> = {
    'application/json': '.json',
    'application/pdf': '.pdf',
    'audio/mp4': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'image/bmp': '.bmp',
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/svg+xml': '.svg',
    'image/webp': '.webp',
    'text/plain': '.txt',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
  };
  return map[mimeType];
};

const defaultExtForType = (type: BotMessageAttachment['type']): string => {
  switch (type) {
    case 'image': {
      return '.png';
    }
    case 'video': {
      return '.mp4';
    }
    case 'audio': {
      return '.mp3';
    }
    case 'file':
    default: {
      return '';
    }
  }
};

/**
 * Convert JSON-safe `BotMessageAttachment[]` into `@discordjs/rest`-shaped
 * `RawFile[]` ready to ride along a `rest.post(channelMessages)` call. Each
 * item that fails to materialize is logged and skipped; the rest still ship.
 */
export const materializeAttachmentsForDiscord = async (
  attachments: BotMessageAttachment[],
): Promise<RawFile[]> => {
  const out: RawFile[] = [];
  for (const [index, att] of attachments.entries()) {
    const buffer = await loadAttachmentBuffer(att);
    if (!buffer) {
      log('materializeAttachmentsForDiscord: skipping attachment "%s"', att.name ?? '(unnamed)');
      continue;
    }
    out.push({
      contentType: att.mimeType,
      data: buffer,
      name: resolveFilename(att, index),
    });
  }
  return out;
};

/**
 * Split a list of materialized files into batches of `DISCORD_MAX_ATTACHMENTS_PER_MESSAGE`.
 * Callers send the first batch with `content`, and subsequent batches with no
 * text so the agent's reply doesn't repeat once per batch.
 */
export const batchDiscordFiles = (files: RawFile[]): RawFile[][] => {
  if (files.length === 0) return [];
  const batches: RawFile[][] = [];
  for (let i = 0; i < files.length; i += DISCORD_MAX_ATTACHMENTS_PER_MESSAGE) {
    batches.push(files.slice(i, i + DISCORD_MAX_ATTACHMENTS_PER_MESSAGE));
  }
  return batches;
};
