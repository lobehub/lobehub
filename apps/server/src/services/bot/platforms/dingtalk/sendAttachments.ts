import type { DingTalkApiClient } from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

import type { AttachmentFailure, AttachmentSendResult } from '../attachmentDelivery';
import type { BotMessageAttachment } from '../types';
import { sendDingTalkMessage, sendDingTalkText } from './send';
import type { DingTalkConversation } from './threadId';

const log = debug('bot-platform:dingtalk:send-attachments');

const renderTextLink = (att: BotMessageAttachment): string => {
  const name = att.name ?? att.type;
  if (att.fetchUrl) return `📎 ${name}: ${att.fetchUrl}`;
  return `📎 ${name} (attachment dropped: no public URL)`;
};

/**
 * Deliver attachments alongside an outbound DingTalk reply.
 *
 * - **Images with a public `fetchUrl`** go out as `sampleImageMsg`, whose
 *   `photoURL` accepts a URL directly (protocol-spec §6.1).
 * - **Everything else** — files, audio, video, and base64 `data` images —
 *   degrades to a text link. Native file/voice/video templates need a
 *   `mediaId` from the legacy media upload API, which this integration does not
 *   use; a link still reaches the user.
 *
 * The text leg ships first so the conversation reads context → media, matching
 * the other platforms. Every attachment that did not arrive as media is
 * reported in `failures`, even when a link stood in for it, so the agent never
 * claims a file was attached.
 */
export const sendDingTalkAttachments = async (
  api: DingTalkApiClient,
  applicationId: string,
  conversation: DingTalkConversation,
  attachments: BotMessageAttachment[],
  leadingText?: string,
): Promise<AttachmentSendResult> => {
  const fallbackLines: string[] = [];
  const failures: AttachmentFailure[] = [];
  const images: BotMessageAttachment[] = [];

  for (const att of attachments) {
    if (att.type === 'image' && att.fetchUrl) {
      images.push(att);
      continue;
    }
    fallbackLines.push(renderTextLink(att));
    failures.push(
      att.fetchUrl
        ? {
            detail: 'DingTalk robots cannot send this type natively; sent as a link',
            name: att.name,
            reason: 'upload-failed',
            type: att.type,
          }
        : {
            detail: 'no public URL to send',
            name: att.name,
            reason: 'source-unavailable',
            type: att.type,
          },
    );
  }

  const combinedText = [leadingText, fallbackLines.join('\n')]
    .filter((s) => s && s.trim())
    .join('\n\n');
  if (combinedText) {
    try {
      await sendDingTalkText(api, applicationId, conversation, combinedText);
    } catch (error) {
      log('sendDingTalkAttachments: text leg failed: %O', error);
    }
  }

  let delivered = 0;
  for (const image of images) {
    try {
      await sendDingTalkMessage(api, applicationId, conversation, {
        msgKey: 'sampleImageMsg',
        msgParam: { photoURL: image.fetchUrl! },
      });
      delivered += 1;
    } catch (error) {
      failures.push({
        detail: (error as Error)?.message ?? String(error),
        name: image.name,
        reason: 'upload-failed',
        type: image.type,
      });
      log(
        'sendDingTalkAttachments: image "%s" failed — degrading to text link: %O',
        image.name ?? '(unnamed)',
        error,
      );
      await sendDingTalkText(api, applicationId, conversation, renderTextLink(image)).catch(
        () => undefined,
      );
    }
  }

  return { delivered, failures };
};
