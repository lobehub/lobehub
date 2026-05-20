import type { MessageItem, WechatApiClient } from '@lobechat/chat-adapter-wechat';
import { MessageItemType, WechatUploadMediaType } from '@lobechat/chat-adapter-wechat';
import debug from 'debug';

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

/**
 * Materialize an attachment's bytes from `data` (base64) or `fetchUrl` (HTTP
 * GET, 15s timeout). Returns undefined if neither source resolves.
 */
const loadAttachmentBuffer = async (
  attachment: WechatOutboundAttachment,
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
 */
export const sendWechatAttachments = async (
  api: WechatApiClient,
  toUserId: string,
  attachments: WechatOutboundAttachment[],
  contextToken: string,
): Promise<void> => {
  for (const attachment of attachments) {
    try {
      const buffer = await loadAttachmentBuffer(attachment);
      if (!buffer) {
        log('sendWechatAttachments: skipping attachment without resolvable bytes');
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
    }
  }
};
