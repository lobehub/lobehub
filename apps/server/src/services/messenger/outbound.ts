import debug from 'debug';

import {
  PLATFORM_ATTACHMENT_BUDGETS,
  prepareAttachmentsForBudget,
  splitFallbackMessages,
} from '@/server/services/bot/platforms/attachmentBudget';
import { DiscordApi } from '@/server/services/bot/platforms/discord/api';
import {
  batchDiscordFiles,
  materializeAttachmentsForDiscord,
} from '@/server/services/bot/platforms/discord/sendAttachments';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import { sendSlackAttachments } from '@/server/services/bot/platforms/slack/sendAttachments';
import { TelegramApi } from '@/server/services/bot/platforms/telegram/api';
import { sendTelegramAttachments } from '@/server/services/bot/platforms/telegram/sendAttachments';
import type { BotMessageAttachment } from '@/server/services/bot/platforms/types';

import type { InstallationCredentials } from './installations/types';

const log = debug('lobe-messenger:outbound');

/**
 * Outbound-only DM delivery for the System Bot, deliberately kept off
 * `MessengerRouter`.
 *
 * The router owns the *inbound* path: `loadBot` builds a Chat SDK bot and runs
 * `registerHandlers`, which needs `AgentBridgeService` — a top-level import, so
 * merely referencing the module pulls the entire agent runtime (sharp, pdf /
 * epub / office parsers, the AI SDKs, Stripe, …) into every serverless function
 * that can reach it. Sending one DM needs none of that: a bot token and the
 * platform's own REST call are enough. The attachment helpers imported above
 * are plain fetch/REST utilities with the same footprint.
 *
 * WeChat is absent here because it already had its own direct path
 * (`wechatPush.ts` → `WechatApiClient`); this brings the other three platforms
 * in line with it.
 *
 * Inbound handling is unaffected and still goes through the router.
 */
export const sendOutboundDirectMessage = async (params: {
  attachments?: BotMessageAttachment[];
  content?: string;
  credentials: InstallationCredentials;
  /** Platform-side id of the recipient: Telegram chat id, Discord/Slack user id. */
  platformUserId: string;
}): Promise<void> => {
  const { attachments, content, credentials, platformUserId } = params;
  const { botToken, platform } = credentials;
  const text = content?.trim();

  if (!text && !attachments?.length)
    throw new Error('Outbound direct message requires content or attachments');

  // Fit attachments to the platform's size budget first: over-budget images
  // get recompressed; files that can't fit at all become download-link lines,
  // delivered as separate follow-up text messages. Separate messages — never
  // merged into the text leg — because Telegram truncates captions at 1024
  // chars and Discord caps messages at 2000, and a truncated URL is a dead
  // link. See attachmentBudget.ts for the budget rationale.
  const budget =
    platform in PLATFORM_ATTACHMENT_BUDGETS
      ? PLATFORM_ATTACHMENT_BUDGETS[platform as keyof typeof PLATFORM_ATTACHMENT_BUDGETS]
      : undefined;
  const prepared =
    attachments?.length && budget
      ? await prepareAttachmentsForBudget(attachments, budget)
      : { attachments: attachments ?? [], fallbackLines: [] };

  // Every prepared attachment lands in exactly one of these two legs, so the
  // guard above already covers "nothing to send". The link leg is batched to
  // the platform's per-message character cap so a long list of fallbacks is
  // never rejected or truncated mid-URL.
  const linkMessages = budget
    ? splitFallbackMessages(prepared.fallbackLines, budget.textMaxChars)
    : [];
  const files = prepared.attachments.length ? prepared.attachments : undefined;

  log(
    'sending %s DM to %s (attachments=%d, link-fallbacks=%d)',
    platform,
    platformUserId,
    files?.length ?? 0,
    prepared.fallbackLines.length,
  );

  switch (platform) {
    case 'telegram': {
      // A Telegram private chat id *is* the user id, so no DM to open.
      const api = new TelegramApi(botToken);
      let textDelivered = false;
      if (files) {
        // The first attachment carries the text as its caption; if every
        // attachment fails, fall back to a plain message so the text leg
        // still lands.
        const delivered = await sendTelegramAttachments(api, platformUserId, files, text);
        textDelivered = delivered > 0;
        if (delivered === 0 && !text && !linkMessages.length)
          throw new Error('All Telegram attachments failed to send');
      }
      if (text && !textDelivered) await api.sendMessage(platformUserId, text);
      for (const message of linkMessages) await api.sendMessage(platformUserId, message);
      return;
    }
    case 'discord': {
      // Discord needs the DM channel first; it is idempotent and returns the
      // existing channel when one is already open.
      const api = new DiscordApi(botToken);
      const channel = await api.createDMChannel(platformUserId);
      let textDelivered = false;
      if (files) {
        const rawFiles = await materializeAttachmentsForDiscord(files);
        if (rawFiles.length > 0) {
          // First batch carries the text leg; follow-up batches are text-less
          // so the message isn't repeated once per batch.
          const batches = batchDiscordFiles(rawFiles);
          for (const [index, batch] of batches.entries()) {
            await api.createMessage(channel.id, index === 0 ? (text ?? '') : '', batch);
          }
          textDelivered = true;
        } else if (!text && !linkMessages.length) {
          throw new Error('All Discord attachments failed to materialize');
        }
      }
      if (text && !textDelivered) await api.createMessage(channel.id, text);
      for (const message of linkMessages) await api.createMessage(channel.id, message);
      return;
    }
    case 'slack': {
      const api = new SlackApi(botToken);
      let textDelivered = false;
      if (files) {
        // `files.completeUploadExternal` needs a real channel id (unlike
        // `chat.postMessage`, which resolves a user id), so open the DM first.
        const channel = await api.openConversation(platformUserId);
        const uploaded = await sendSlackAttachments(api, {
          attachments: files,
          channelId: channel.id,
          initialComment: text,
        });
        textDelivered = uploaded > 0;
        if (uploaded === 0 && !text && !linkMessages.length)
          throw new Error('All Slack attachments failed to upload');
      }
      // Slack resolves a user id passed as `channel` to that user's DM.
      if (text && !textDelivered) await api.postMessage(platformUserId, text);
      for (const message of linkMessages) await api.postMessage(platformUserId, message);
      return;
    }
    default: {
      // WeChat never reaches here — `sendMessengerPush` routes it to the
      // windowed path before this point.
      throw new Error(`Outbound direct message is not supported for "${platform}"`);
    }
  }
};
