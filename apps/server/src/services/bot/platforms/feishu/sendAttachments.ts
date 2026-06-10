import type { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import debug from 'debug';

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
 * Upload + send each attachment as its own Lark/Feishu message:
 *
 * - `image` → `POST /im/v1/images` → `sendMessageWithMsgType(chatId, 'image', {image_key})`
 * - `file` / `video` / `audio` → `POST /im/v1/files` → `sendMessageWithMsgType`
 *   with msg_type `'file'` / `'media'` / `'audio'` respectively.
 *
 * Lark/Feishu has no single "text + media" composite message, so the caller
 * sends the text leg through a separate `sendMessage` (or `replyMessage`)
 * first. Single-attachment failures are logged and skipped so the rest
 * still ship.
 */
export const sendFeishuAttachments = async (
  api: LarkApiClient,
  chatId: string,
  attachments: BotMessageAttachment[],
): Promise<number> => {
  let delivered = 0;
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
    }
  }
  return delivered;
};
