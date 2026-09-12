import type { SendMessageAttachmentOutcome } from '@lobechat/builtin-tool-message/delivery';
import type { MessageItem, WechatApiClient } from '@lobechat/chat-adapter-wechat';
import { MessageItemType, WechatUploadMediaType } from '@lobechat/chat-adapter-wechat';
import debug from 'debug';

import {
  buildAttachmentFallbackLine,
  compressImageToBudget,
  PLATFORM_ATTACHMENT_BUDGETS,
  splitFallbackMessageBatches,
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

/**
 * Why one attachment never reached the user. Carried back to the delivery
 * boundary instead of printed here: `detail` holds the iLink `errmsg`, which is
 * the part that actually diagnoses a refused upload, and the boundary is the
 * only place that knows the push it belongs to.
 */
export interface WechatAttachmentFailure {
  /** Platform error text, when the failure came from an iLink call. */
  detail?: string;
  name?: string;
  reason: 'over-budget-no-link' | 'source-unavailable' | 'upload-failed';
  type: WechatOutboundAttachment['type'];
}

export interface WechatAttachmentSendResult {
  /** Describes the same attachments as `undelivered`. */
  failures: WechatAttachmentFailure[];
  outcomes: SendMessageAttachmentOutcome[];
  undelivered: WechatOutboundAttachment[];
}

/** Carries known progress to the service while preserving rejection for replay callers. */
export class WechatAttachmentSendError extends Error {
  readonly result: WechatAttachmentSendResult;

  constructor(result: WechatAttachmentSendResult, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'WechatAttachmentSendError';
    this.result = {
      failures: [...result.failures],
      outcomes: result.outcomes.map((item) => ({ ...item })),
      undelivered: [...result.undelivered],
    };
  }
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
 * Retains the legacy failure arrays for replay callers and records submission
 * outcomes by input index. Link fallback counts as handled for the legacy
 * arrays once the link message sends. A link failure still rejects, carrying
 * the known outcomes for callers that report partial progress.
 */
export const sendWechatAttachments = async (
  api: WechatApiClient,
  toUserId: string,
  attachments: WechatOutboundAttachment[],
  contextToken: string,
): Promise<WechatAttachmentSendResult> => {
  const budget = PLATFORM_ATTACHMENT_BUDGETS.wechat;
  const fallbackLines: Array<{
    attachment: WechatOutboundAttachment;
    index: number;
    line: string;
  }> = [];
  const undelivered: WechatOutboundAttachment[] = [];
  const failures: WechatAttachmentFailure[] = [];
  const outcomes: SendMessageAttachmentOutcome[] = attachments.map((attachment, index) => ({
    index,
    reason: 'prior_failure',
    status: 'not_attempted',
    type: attachment.type,
  }));

  for (const [index, attachment] of attachments.entries()) {
    let stage: 'prepare' | 'upload' | 'send' = 'prepare';
    try {
      let buffer = await loadAttachmentBuffer(attachment);
      if (!buffer) {
        log('sendWechatAttachments: no resolvable bytes for "%s"', attachment.name ?? '(unnamed)');
        failures.push({
          name: attachment.name,
          reason: 'source-unavailable',
          type: attachment.type,
        });
        undelivered.push(attachment);
        outcomes[index] = {
          index,
          reason: 'source_unavailable',
          status: 'failed',
          type: attachment.type,
        };
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
          fallbackLines.push({
            attachment,
            index,
            line: buildAttachmentFallbackLine(attachment, attachment.fetchUrl),
          });
        } else {
          log('sendWechatAttachments: skipping over-budget attachment without fetchUrl');
          failures.push({
            name: attachment.name,
            reason: 'over-budget-no-link',
            type: attachment.type,
          });
          undelivered.push(attachment);
          outcomes[index] = {
            index,
            reason: 'over_budget_no_link',
            status: 'failed',
            type: attachment.type,
          };
        }
        continue;
      }

      const mediaType = mapAttachmentTypeToUploadMediaType(attachment.type);
      stage = 'upload';
      const uploadResult = await api.uploadCdnMedia(toUserId, mediaType, buffer);
      stage = 'prepare';
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
      stage = 'send';
      await api.sendItem(toUserId, item, contextToken);
      outcomes[index] = { index, status: 'accepted', type: attachment.type };
    } catch (error) {
      // iLink refusing an upload is the other half of "it sent a link instead
      // of the picture". The message is the diagnostic part — it carries the
      // iLink `errmsg` — so it rides the reason back to the delivery boundary
      // rather than being printed once per attachment here.
      log(
        'sendWechatAttachments: failed to send %s attachment "%s": %O',
        attachment.type,
        attachment.name ?? '(unnamed)',
        error,
      );
      failures.push({
        detail: error instanceof Error ? error.message : String(error),
        name: attachment.name,
        reason: 'upload-failed',
        type: attachment.type,
      });
      undelivered.push(attachment);
      outcomes[index] =
        stage === 'send'
          ? { index, reason: 'send_unconfirmed', status: 'unknown', type: attachment.type }
          : {
              index,
              reason: stage === 'upload' ? 'upload_failed' : 'prepare_failed',
              status: 'failed',
              type: attachment.type,
            };
    }
  }

  // Deliberately outside the loop's try/catch — see the note above.
  const linkMessages = splitFallbackMessageBatches(
    fallbackLines,
    (item) => item.line,
    budget.textMaxChars,
  );
  for (const { items, message } of linkMessages) {
    try {
      await api.sendMessage(toUserId, message, contextToken);
      for (const { attachment, index } of items) {
        outcomes[index] = {
          index,
          reason: 'over_budget',
          status: 'link_fallback',
          type: attachment.type,
        };
      }
    } catch (error) {
      // sendMessage can submit multiple text chunks before rejecting.
      for (const { attachment, index } of items) {
        outcomes[index] = {
          index,
          reason: 'link_send_unconfirmed',
          status: 'unknown',
          type: attachment.type,
        };
      }
      throw new WechatAttachmentSendError({ failures, outcomes, undelivered }, error);
    }
  }

  return { failures, outcomes, undelivered };
};
