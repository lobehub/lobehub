import type { MessageItem, WechatApiClient } from '@lobechat/chat-adapter-wechat';
import { MessageItemType, WechatUploadMediaType } from '@lobechat/chat-adapter-wechat';
import debug from 'debug';

import {
  buildAttachmentFallbackLine,
  compressImageToBudget,
  PLATFORM_ATTACHMENT_BUDGETS,
  splitFallbackMessages,
} from '../attachmentBudget';
import { loadAttachmentBuffer } from '../loadAttachmentBuffer';

const log = debug('bot-platform:wechat:send-attachments');

/**
 * Shared JSON-safe attachment shape used on the WeChat outbound path.
 * Either `data` (base64-encoded bytes) or `fetchUrl` (remote URL) must be
 * set; `fetchUrl` is preferred so we don't blow up webhook payloads.
 *
 * Kept in sync with `BotMessageAttachment` (bot/platforms/types.ts) and
 * `SendMessageAttachment` (@lobechat/builtin-tool-message); both flow into
 * this helper through different entry points (agent reply callback vs. the
 * Messager `sendMessage` tool / TRPC / CLI).
 */
export interface WechatOutboundAttachment {
  data?: string;
  fetchUrl?: string;
  mimeType?: string;
  name?: string;
  /** Byte size when known — lets the push path apply size budgets up front. */
  size?: number;
  type: 'image' | 'file' | 'video' | 'audio';
}

const mapAttachmentTypeToUploadMediaType = (
  type: WechatOutboundAttachment['type'],
): WechatUploadMediaType => {
  switch (type) {
    case 'image': {
      return WechatUploadMediaType.IMAGE;
    }
    case 'video': {
      return WechatUploadMediaType.VIDEO;
    }
    case 'audio': {
      return WechatUploadMediaType.VOICE;
    }
    case 'file':
    default: {
      return WechatUploadMediaType.FILE;
    }
  }
};

const buildMediaItemFromUpload = (
  mediaType: WechatUploadMediaType,
  cdnMedia: { aes_key: string; encrypt_query_param: string; encrypt_type: 1 },
  uploadResult: { cipherSize: number },
  attachment: WechatOutboundAttachment,
  bufferLength: number,
): MessageItem => {
  switch (mediaType) {
    case WechatUploadMediaType.IMAGE: {
      return {
        image_item: { media: cdnMedia },
        type: MessageItemType.IMAGE,
      };
    }
    case WechatUploadMediaType.VIDEO: {
      return {
        type: MessageItemType.VIDEO,
        video_item: { media: cdnMedia, video_size: uploadResult.cipherSize },
      };
    }
    case WechatUploadMediaType.VOICE: {
      return {
        type: MessageItemType.VOICE,
        voice_item: { media: cdnMedia },
      };
    }
    case WechatUploadMediaType.FILE:
    default: {
      return {
        file_item: {
          file_name: attachment.name,
          len: String(bufferLength),
          media: cdnMedia,
        },
        type: MessageItemType.FILE,
      };
    }
  }
};

/**
 * Upload + send each attachment as its own iLink sendmessage call (per
 * protocol §6.7, one MessageItem per request). Single-attachment failures
 * are logged and skipped so the rest still ship — mirroring the chat-adapter
 * adapter's per-item try/catch.
 *
 * Returns the attachments that did NOT reach the user, so a caller with a
 * replay queue can requeue exactly those instead of assuming the whole leg
 * landed. Attachments degraded to a download link count as delivered once
 * the link message sends; if that send throws, the whole call throws and the
 * return value is moot.
 */
export const sendWechatAttachments = async (
  api: WechatApiClient,
  toUserId: string,
  attachments: WechatOutboundAttachment[],
  contextToken: string,
): Promise<WechatOutboundAttachment[]> => {
  const budget = PLATFORM_ATTACHMENT_BUDGETS.wechat;
  const fallbackLines: string[] = [];
  const undelivered: WechatOutboundAttachment[] = [];

  for (const attachment of attachments) {
    try {
      let buffer = await loadAttachmentBuffer(attachment);
      if (!buffer) {
        log('sendWechatAttachments: skipping attachment without resolvable bytes');
        undelivered.push(attachment);
        continue;
      }

      // Enforcement backstop for callers that reach this helper without the
      // push path's budget pass (bot replies, queued payloads with no size):
      // iLink accepts over-budget media with a 200 on every call and then
      // never renders the message, so an unchecked upload is a silent loss.
      const limit = attachment.type === 'image' ? budget.imageMaxBytes : budget.fileMaxBytes;
      if (buffer.length > limit && attachment.type === 'image') {
        const compressed = await compressImageToBudget(buffer, budget.imageMaxBytes);
        if (compressed) buffer = compressed;
      }
      if (buffer.length > limit) {
        if (attachment.fetchUrl) {
          log(
            'sendWechatAttachments: "%s" (%d bytes) over %d-byte budget — sending link instead',
            attachment.name ?? '(unnamed)',
            buffer.length,
            limit,
          );
          // Queued, not sent here: the send must sit OUTSIDE the per-attachment
          // catch below. That catch exists so one bad upload cannot take down
          // the rest, but a failing `sendMessage` means the text channel itself
          // is down — swallowing it would let `deliver` resolve and the replay
          // queue drop a payload that was never delivered.
          fallbackLines.push(buildAttachmentFallbackLine(attachment, attachment.fetchUrl));
        } else {
          log('sendWechatAttachments: skipping over-budget attachment without fetchUrl');
          undelivered.push(attachment);
        }
        continue;
      }

      const mediaType = mapAttachmentTypeToUploadMediaType(attachment.type);
      const uploadResult = await api.uploadCdnMedia(toUserId, mediaType, buffer);
      const cdnMedia = {
        aes_key: uploadResult.aesKey,
        encrypt_query_param: uploadResult.encryptQueryParam,
        encrypt_type: 1 as const,
      };
      const item = buildMediaItemFromUpload(
        mediaType,
        cdnMedia,
        uploadResult,
        attachment,
        buffer.length,
      );
      await api.sendItem(toUserId, item, contextToken);
    } catch (error) {
      log(
        'sendWechatAttachments: failed to send %s attachment "%s": %O',
        attachment.type,
        attachment.name ?? '(unnamed)',
        error,
      );
      undelivered.push(attachment);
    }
  }

  // Deliberately outside the loop's try/catch — see the note above.
  const linkMessages = splitFallbackMessages(fallbackLines, budget.textMaxChars);
  for (const message of linkMessages) {
    await api.sendMessage(toUserId, message, contextToken);
  }

  return undelivered;
};
