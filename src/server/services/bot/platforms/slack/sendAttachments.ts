import debug from 'debug';

import type { BotMessageAttachment } from '../types';
import type { SlackApi } from './api';

const log = debug('bot-platform:slack:send-attachments');

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
 * Upload + post attachments to Slack via the v2 three-step flow:
 *
 * 1. `files.getUploadURLExternal` → signed upload URL + file id
 * 2. PUT bytes to the signed URL (no auth header)
 * 3. `files.completeUploadExternal` — associate file ids with a channel
 *    (and optional thread), posting the file message. `initialComment`
 *    doubles as the text leg of the reply.
 *
 * Single-attachment failures are logged and skipped so the rest still ship.
 * Returns the number of files successfully uploaded — callers use 0 to
 * decide whether to fall back to `postMessage` for the text leg.
 */
export const sendSlackAttachments = async (
  api: SlackApi,
  params: {
    attachments: BotMessageAttachment[];
    channelId: string;
    initialComment?: string;
    threadTs?: string;
  },
): Promise<number> => {
  const uploaded: Array<{ id: string; title?: string }> = [];

  for (const [index, att] of params.attachments.entries()) {
    try {
      const buffer = await loadAttachmentBuffer(att);
      if (!buffer) {
        log('sendSlackAttachments: skipping attachment with no resolvable bytes');
        continue;
      }
      const filename = fallbackFilename(att, index);
      const { file_id, upload_url } = await api.getFileUploadUrl({
        filename,
        length: buffer.length,
      });
      await api.putFileBytes(upload_url, buffer);
      uploaded.push({ id: file_id, title: att.name });
    } catch (error) {
      log('sendSlackAttachments: failed on attachment "%s": %O', att.name ?? '(unnamed)', error);
    }
  }

  if (uploaded.length === 0) return 0;

  try {
    await api.completeFileUpload({
      channelId: params.channelId,
      files: uploaded,
      initialComment: params.initialComment,
      threadTs: params.threadTs,
    });
  } catch (error) {
    log('sendSlackAttachments: completeFileUpload failed: %O', error);
    return 0;
  }
  return uploaded.length;
};
