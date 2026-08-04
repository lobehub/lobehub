import debug from 'debug';

import { DiscordApi } from '@/server/services/bot/platforms/discord/api';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import { TelegramApi } from '@/server/services/bot/platforms/telegram/api';

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
 * platform's own REST call are enough.
 *
 * WeChat is absent here because it already had its own direct path
 * (`wechatPush.ts` → `WechatApiClient`); this brings the other three platforms
 * in line with it.
 *
 * Inbound handling is unaffected and still goes through the router.
 */
export const sendOutboundDirectMessage = async (params: {
  content: string;
  credentials: InstallationCredentials;
  /** Platform-side id of the recipient: Telegram chat id, Discord/Slack user id. */
  platformUserId: string;
}): Promise<void> => {
  const { content, credentials, platformUserId } = params;
  const { botToken, platform } = credentials;

  log('sending %s DM to %s', platform, platformUserId);

  switch (platform) {
    case 'telegram': {
      // A Telegram private chat id *is* the user id, so no DM to open.
      await new TelegramApi(botToken).sendMessage(platformUserId, content);
      return;
    }
    case 'discord': {
      // Discord needs the DM channel first; it is idempotent and returns the
      // existing channel when one is already open.
      const api = new DiscordApi(botToken);
      const channel = await api.createDMChannel(platformUserId);
      await api.createMessage(channel.id, content);
      return;
    }
    case 'slack': {
      // Slack resolves a user id passed as `channel` to that user's DM.
      await new SlackApi(botToken).postMessage(platformUserId, content);
      return;
    }
    default: {
      // WeChat never reaches here — `sendMessengerPush` routes it to the
      // windowed path before this point.
      throw new Error(`Outbound direct message is not supported for "${platform}"`);
    }
  }
};
