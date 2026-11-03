import type { QQApiClient } from '@lobechat/chat-adapter-qq';
import debug from 'debug';

import type { BotMessageAttachment } from '../types';

const log = debug('bot-platform:qq:send-attachments');

/**
 * QQ openplatform rich-media file_type enum.
 * 1 = image, 2 = video, 3 = voice, 4 = file
 */
type QQFileType = 1 | 2 | 3 | 4;

const inferQQFileType = (att: BotMessageAttachment): QQFileType => {
  switch (att.type) {
    case 'image': {
      return 1;
    }
    case 'video': {
      return 2;
    }
    case 'audio': {
      return 3;
    }
    case 'file':
    default: {
      return 4;
    }
  }
};

const renderTextLink = (att: BotMessageAttachment): string => {
  const name = att.name ?? att.type;
  if (att.fetchUrl) return `📎 ${name}: ${att.fetchUrl}`;
  return `📎 ${name} (attachment dropped: no public URL)`;
};

type ThreadType = 'group' | 'guild' | 'c2c' | 'dms' | string;

const supportsRichMedia = (threadType: ThreadType): threadType is 'group' | 'c2c' =>
  threadType === 'group' || threadType === 'c2c';

/**
 * Dispatch a text-only message to the right QQ endpoint. Mirrors the
 * `sendQQMessage` helper in `qq/client.ts` but kept private here so the
 * attachments path doesn't pull a circular dep.
 */
const sendText = async (
  api: QQApiClient,
  threadType: ThreadType,
  targetId: string,
  text: string,
): Promise<void> => {
  if (!text.trim()) return;
  switch (threadType) {
    case 'group': {
      await api.sendGroupMessage(targetId, text);
      return;
    }
    case 'guild': {
      await api.sendGuildMessage(targetId, text);
      return;
    }
    case 'c2c': {
      await api.sendC2CMessage(targetId, text);
      return;
    }
    case 'dms': {
      await api.sendDmsMessage(targetId, text);
      return;
    }
    default: {
      await api.sendGroupMessage(targetId, text);
    }
  }
};

/**
 * Deliver attachments alongside an outbound QQ reply.
 *
 * Two flavours, chosen by `threadType`:
 *
 * - **`group` / `c2c`** — full rich-media path. For each attachment with a
 *   public HTTPS `fetchUrl`, upload it to get a `file_info` token, then
 *   post a separate `msg_type: 7 (MEDIA)` message. QQ doesn't allow media
 *   + content on the same message, so the text leg ships as its own call.
 * - **`guild` / `dms`** — the channel API requires multipart upload which
 *   isn't implemented here yet; attachments degrade to a text-link line.
 *
 * `data` (base64) attachments also degrade to text-link because QQ's
 * upload API only accepts URLs and this codebase has no staging bucket.
 *
 * Returns the number of attachments successfully delivered as media (not
 * text-link fallbacks).
 */
export const sendQQAttachments = async (
  api: QQApiClient,
  threadType: ThreadType,
  targetId: string,
  attachments: BotMessageAttachment[],
  leadingText?: string,
): Promise<number> => {
  // Text leg first so the conversation reads context → media.
  const fallbackLines: string[] = [];
  let mediaDelivered = 0;

  if (supportsRichMedia(threadType)) {
    for (const att of attachments) {
      if (!att.fetchUrl) {
        fallbackLines.push(renderTextLink(att));
        continue;
      }
      try {
        const fileType = inferQQFileType(att);
        const upload =
          threadType === 'group'
            ? await api.uploadGroupRichMedia(targetId, fileType, att.fetchUrl)
            : await api.uploadC2CRichMedia(targetId, fileType, att.fetchUrl);
        if (threadType === 'group') {
          await api.sendGroupMedia(targetId, upload.file_info);
        } else {
          await api.sendC2CMedia(targetId, upload.file_info);
        }
        mediaDelivered += 1;
      } catch (error) {
        log(
          'sendQQAttachments: failed on %s "%s" — degrading to text link: %O',
          att.type,
          att.name ?? '(unnamed)',
          error,
        );
        fallbackLines.push(renderTextLink(att));
      }
    }
  } else {
    // guild / dms / unknown — all attachments degrade.
    for (const att of attachments) {
      fallbackLines.push(renderTextLink(att));
    }
  }

  const combinedText = [leadingText, fallbackLines.join('\n')]
    .filter((s) => s && s.trim())
    .join('\n\n');
  if (combinedText) {
    try {
      await sendText(api, threadType, targetId, combinedText);
    } catch (error) {
      log('sendQQAttachments: text leg failed: %O', error);
    }
  }
  return mediaDelivered;
};
