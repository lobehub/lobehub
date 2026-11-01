import debug from 'debug';

import type { AttachmentFailure, AttachmentSendResult } from '../attachmentDelivery';
import { loadAttachmentBufferWithDetail } from '../loadAttachmentBuffer';
import type { BotMessageAttachment } from '../types';
import type { SlackApi } from './api';

const log = debug('bot-platform:slack:send-attachments');

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
 * Single-attachment failures are skipped so the rest still ship, and reported
 * back so the caller can tell the user which ones never landed. Callers use
 * `delivered === 0` to decide whether to fall back to `postMessage` for the
 * text leg.
 */
export const sendSlackAttachments = async (
  api: SlackApi,
  params: {
    attachments: BotMessageAttachment[];
    channelId: string;
    initialComment?: string;
    threadTs?: string;
  },
): Promise<AttachmentSendResult> => {
  const uploaded: Array<{ att: BotMessageAttachment; id: string; title?: string }> = [];
  const failures: AttachmentFailure[] = [];

  for (const [index, att] of params.attachments.entries()) {
    try {
      const loaded = await loadAttachmentBufferWithDetail(att);
      const buffer = loaded.buffer;
      if (!buffer) {
        log('sendSlackAttachments: no resolvable bytes for "%s": %s', att.name, loaded.error);
        failures.push({
          detail: loaded.error,
          name: att.name,
          reason: 'source-unavailable',
          type: att.type,
        });
        continue;
      }
      const filename = fallbackFilename(att, index);
      const { file_id, upload_url } = await api.getFileUploadUrl({
        filename,
        length: buffer.length,
      });
      await api.putFileBytes(upload_url, buffer);
      uploaded.push({ att, id: file_id, title: att.name });
    } catch (error) {
      log('sendSlackAttachments: failed on attachment "%s": %O', att.name ?? '(unnamed)', error);
      failures.push({
        detail: error instanceof Error ? error.message : String(error),
        name: att.name,
        reason: 'upload-failed',
        type: att.type,
      });
    }
  }

  if (uploaded.length === 0) return { delivered: 0, failures };

  try {
    await api.completeFileUpload({
      channelId: params.channelId,
      files: uploaded.map(({ id, title }) => ({ id, title })),
      initialComment: params.initialComment,
      threadTs: params.threadTs,
    });
  } catch (error) {
    log('sendSlackAttachments: completeFileUpload failed: %O', error);
    // The bytes are on Slack's servers but were never posted to the channel,
    // so from the user's point of view every one of them failed.
    const detail = `completeUploadExternal failed: ${error instanceof Error ? error.message : String(error)}`;
    for (const { att } of uploaded) {
      failures.push({ detail, name: att.name, reason: 'upload-failed', type: att.type });
    }
    return { delivered: 0, failures };
  }
  return { delivered: uploaded.length, failures };
};
