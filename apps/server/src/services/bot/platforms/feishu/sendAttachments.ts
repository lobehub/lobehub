import type { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import debug from 'debug';

import type { AttachmentFailure, AttachmentSendResult } from '../attachmentDelivery';
import { loadAttachmentBufferWithDetail } from '../loadAttachmentBuffer';
import type { BotMessageAttachment } from '../types';

const log = debug('bot-platform:feishu:send-attachments');

type LarkFileType = 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream';

/**
 * Map a `BotMessageAttachment` to the Lark/Feishu `file_type` enum used by
 * `POST /im/v1/files`. The upload API rejects unknown values, so when we
 * can't infer a known extension we fall back to `stream` (generic binary).
 */
const inferFeishuFileType = (att: BotMessageAttachment): LarkFileType => {
  // Honor explicit attachment.type first.
  if (att.type === 'audio') return 'opus';
  if (att.type === 'video') return 'mp4';

  const name = (att.name ?? '').toLowerCase();
  const mime = (att.mimeType ?? '').toLowerCase();

  if (name.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (name.endsWith('.doc') || name.endsWith('.docx') || mime.includes('msword')) return 'doc';
  if (name.endsWith('.xls') || name.endsWith('.xlsx') || mime.includes('excel')) return 'xls';
  if (name.endsWith('.ppt') || name.endsWith('.pptx') || mime.includes('powerpoint')) return 'ppt';
  if (mime.startsWith('audio/')) return 'opus';
  if (mime.startsWith('video/')) return 'mp4';
  return 'stream';
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
 * Upload + send each attachment as its own Lark/Feishu message:
 *
 * - `image` → `POST /im/v1/images` → `sendMessageWithMsgType(chatId, 'image', {image_key})`
 * - `file` / `video` / `audio` → `POST /im/v1/files` → `sendMessageWithMsgType`
 *   with msg_type `'file'` / `'media'` / `'audio'` respectively.
 *
 * Lark/Feishu has no single "text + media" composite message, so the caller
 * sends the text leg through a separate `sendMessage` (or `replyMessage`)
 * first. Single-attachment failures are skipped so the rest still ship, and
 * reported back so the caller can tell the user which ones never landed.
 */
export const sendFeishuAttachments = async (
  api: LarkApiClient,
  chatId: string,
  attachments: BotMessageAttachment[],
): Promise<AttachmentSendResult> => {
  let delivered = 0;
  const failures: AttachmentFailure[] = [];
  for (const [index, att] of attachments.entries()) {
    try {
      const loaded = await loadAttachmentBufferWithDetail(att);
      const buffer = loaded.buffer;
      if (!buffer) {
        log('sendFeishuAttachments: no resolvable bytes for "%s": %s', att.name, loaded.error);
        failures.push({
          detail: loaded.error,
          name: att.name,
          reason: 'source-unavailable',
          type: att.type,
        });
        continue;
      }
      const filename = fallbackFilename(att, index);
      if (att.type === 'image') {
        const { image_key } = await api.uploadImage(buffer, filename);
        await api.sendMessageWithMsgType(chatId, 'image', JSON.stringify({ image_key }));
      } else {
        const fileType = inferFeishuFileType(att);
        const { file_key } = await api.uploadFile(buffer, filename, fileType);
        const msgType: 'file' | 'media' | 'audio' =
          att.type === 'video' ? 'media' : att.type === 'audio' ? 'audio' : 'file';
        await api.sendMessageWithMsgType(chatId, msgType, JSON.stringify({ file_key }));
      }
      delivered += 1;
    } catch (error) {
      log(
        'sendFeishuAttachments: failed to send %s "%s": %O',
        att.type,
        att.name ?? '(unnamed)',
        error,
      );
      failures.push({
        detail: error instanceof Error ? error.message : String(error),
        name: att.name,
        reason: 'upload-failed',
        type: att.type,
      });
    }
  }
  return { delivered, failures };
};
