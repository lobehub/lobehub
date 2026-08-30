import type { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import debug from 'debug';

import { loadAttachmentBuffer } from '../loadAttachmentBuffer';
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
 * - `image` → `POST /im/v1/images` → send with msg_type `'image'`
 * - `file` / `video` / `audio` → `POST /im/v1/files` → send with msg_type
 *   `'file'` / `'media'` / `'audio'` respectively
 *
 * Sending goes through the reply API when `replyToMessageId` is set (keeps
 * the attachment inside the trigger's topic thread), otherwise through a
 * direct chat send. Lark/Feishu has no single "text + media" composite
 * message, so the caller sends the text leg through a separate
 * `sendMessage`/`replyMessage` call first. Single-attachment failures are
 * logged and skipped so the rest still ship.
 *
 * @returns the platform message ids of the attachments actually delivered
 * (empty on total failure).
 */
export const sendFeishuAttachments = async (
  api: LarkApiClient,
  receiveId: string,
  attachments: BotMessageAttachment[],
  replyToMessageId?: string,
  directMessage = false,
): Promise<string[]> => {
  const sentIds: string[] = [];
  for (const [index, att] of attachments.entries()) {
    try {
      const buffer = await loadAttachmentBuffer(att);
      if (!buffer) {
        log('sendFeishuAttachments: skipping attachment with no resolvable bytes');
        continue;
      }
      const filename = fallbackFilename(att, index);
      if (att.type === 'image') {
        const { image_key } = await api.uploadImage(buffer, filename);
        const payload = JSON.stringify({ image_key });
        const { messageId } = replyToMessageId
          ? await api.replyMessageWithMsgType(replyToMessageId, 'image', payload)
          : directMessage
            ? await api.sendDirectMessageWithMsgType(receiveId, 'image', payload)
            : await api.sendMessageWithMsgType(receiveId, 'image', payload);
        sentIds.push(messageId);
      } else {
        const fileType = inferFeishuFileType(att);
        const { file_key } = await api.uploadFile(buffer, filename, fileType);
        const msgType: 'file' | 'media' | 'audio' =
          att.type === 'video' ? 'media' : att.type === 'audio' ? 'audio' : 'file';
        const payload = JSON.stringify({ file_key });
        const { messageId } = replyToMessageId
          ? await api.replyMessageWithMsgType(replyToMessageId, msgType, payload)
          : directMessage
            ? await api.sendDirectMessageWithMsgType(receiveId, msgType, payload)
            : await api.sendMessageWithMsgType(receiveId, msgType, payload);
        sentIds.push(messageId);
      }
    } catch (error) {
      log(
        'sendFeishuAttachments: failed to send %s "%s": %O',
        att.type,
        att.name ?? '(unnamed)',
        error,
      );
      console.error(`[Feishu] failed to send ${att.type} attachment at index ${index}:`, error);
    }
  }
  return sentIds;
};
