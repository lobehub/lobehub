import type { LineApiClient, LineOutboundMessage } from '@lobechat/chat-adapter-line';
import debug from 'debug';

import type { BotMessageAttachment } from '../types';

const log = debug('bot-platform:line:send-attachments');

/** LINE caps a single push at 5 message objects — callers must batch. */
const LINE_MAX_MESSAGES_PER_PUSH = 5;

/**
 * LINE's Messaging API has no inline binary upload — every media message
 * must reference a public HTTPS URL. Attachments delivered as `data` (base64)
 * are degraded into a text fallback so the user at least sees *something*
 * about the missing media. Hosting base64 content via a staging bucket is
 * tracked separately.
 */
const REMOTE_URL_RE = /^https:\/\//;

const renderTextLink = (att: BotMessageAttachment): string => {
  const name = att.name ?? `${att.type}`;
  if (att.fetchUrl) return `📎 ${name}: ${att.fetchUrl}`;
  return `📎 ${name} (attachment dropped: no public URL)`;
};

const isHttpsUrl = (url: string | undefined): url is string => !!url && REMOTE_URL_RE.test(url);

/**
 * Convert outbound `BotMessageAttachment[]` into LINE-shaped push messages.
 *
 * Rules per LINE Messaging API:
 * - `image` (HTTPS URL) → typed `image` message (reuse URL for preview)
 * - `video` / `audio` / `file` / `data`-only → degrade to text-link
 *   (video needs a separate preview URL, audio needs `duration` in ms,
 *   file isn't supported via push at all; we don't have these inputs)
 *
 * `leadingText` is prepended as the first text message so the conversation
 * keeps the "context first, media second" order users expect.
 */
export const buildLineMessages = (
  attachments: BotMessageAttachment[],
  leadingText?: string,
): LineOutboundMessage[] => {
  const out: LineOutboundMessage[] = [];

  if (leadingText?.trim()) {
    out.push({ text: leadingText, type: 'text' });
  }

  const fallbackLines: string[] = [];

  for (const att of attachments) {
    if (att.type === 'image' && isHttpsUrl(att.fetchUrl)) {
      out.push({
        originalContentUrl: att.fetchUrl,
        previewImageUrl: att.fetchUrl,
        type: 'image',
      });
      continue;
    }

    // Video / audio / file: see header comment. Degrade to text-link.
    log(
      'buildLineMessages: degrading %s "%s" to text link (LINE push API limitation)',
      att.type,
      att.name ?? '(unnamed)',
    );
    fallbackLines.push(renderTextLink(att));
  }

  if (fallbackLines.length > 0) {
    out.push({ text: fallbackLines.join('\n'), type: 'text' });
  }

  return out;
};

/**
 * Build LINE messages and push them in batches of `LINE_MAX_MESSAGES_PER_PUSH`.
 * Returns the number of attachments that landed as a typed media message
 * (text-link fallbacks don't count). Single push-batch failures are logged
 * and the next batch still attempts — partial delivery is better than none.
 */
export const sendLineAttachments = async (
  api: LineApiClient,
  recipient: string,
  attachments: BotMessageAttachment[],
  leadingText?: string,
): Promise<number> => {
  const messages = buildLineMessages(attachments, leadingText);
  if (messages.length === 0) return 0;

  for (let i = 0; i < messages.length; i += LINE_MAX_MESSAGES_PER_PUSH) {
    const batch = messages.slice(i, i + LINE_MAX_MESSAGES_PER_PUSH);
    try {
      await api.push(recipient, batch);
    } catch (error) {
      log('sendLineAttachments: push batch failed: %O', error);
    }
  }

  // Count typed media messages (non-text) — they correspond to attachments
  // that successfully became real media. Text and text-link fallbacks
  // aren't "media".
  return messages.filter((m) => m.type !== 'text').length;
};
