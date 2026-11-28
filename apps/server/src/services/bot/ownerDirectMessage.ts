import { LarkApiClient } from '@lobechat/chat-adapter-feishu';

import { createMessageServiceForCredentials } from './messageTarget';
import { resolveWeComOutbound } from './platforms/wecom/outbound';

/**
 * Platforms where a bot can message its owner privately without the owner
 * writing first, given the owner's platform user ID (`settings.userId`).
 */
export const OWNER_DIRECT_MESSAGE_PLATFORMS = [
  'dingtalk',
  'discord',
  'feishu',
  'lark',
  'qq',
  'slack',
  'wecom',
] as const;

export interface SendBotOwnerDirectMessageParams {
  applicationId: string;
  content: string;
  credentials: Record<string, any>;
  /** The owner's user ID on the platform (`settings.userId`). */
  ownerId: string;
  platform: string;
}

/**
 * QQ addresses users by a per-bot `openid`, never by QQ number. The owner ID
 * field asks for a QQ number, so a value of digits only cannot be messaged.
 */
const isQQOpenId = (id: string) => !/^\d+$/.test(id);

/**
 * Slack member IDs start with `U` or `W`. `chat.postMessage` accepts a
 * channel ID in the same argument, so anything else (a pasted `C…` channel
 * ID) is refused rather than posted to a channel.
 */
const isSlackMemberId = (id: string) => /^[UW][\dA-Z]+$/.test(id);

/**
 * Send `content` to the bot owner's private chat with the bot. Resolves
 * `false` when the platform or owner ID cannot be messaged this way; platform
 * errors (no permission, owner never added the bot, rate limits) throw.
 *
 * - Discord: opens the DM channel with the user.
 * - Slack: `chat.postMessage` to a user ID posts in the app's DM with them.
 * - Feishu / Lark: sends to the user's `open_id`.
 * - DingTalk: robot one-to-one message to the staff ID.
 * - WeCom: active push (`aibot_send_msg`) to the userid over the bot's
 *   connection, which is still up before the bot sleeps.
 * - QQ: active C2C message to the user's openid. Allowed by the platform within
 *   its active-message rate limits, unless the user switched off the bot's
 *   active messages (`40034105`).
 */
export const sendBotOwnerDirectMessage = async ({
  applicationId,
  content,
  credentials,
  ownerId,
  platform,
}: SendBotOwnerDirectMessageParams): Promise<boolean> => {
  const target = ownerId.trim();
  if (!target) return false;

  switch (platform) {
    case 'discord': {
      const service = createMessageServiceForCredentials(platform, applicationId, credentials);
      await service.sendDirectMessage!({ content, platform, userId: target });
      return true;
    }
    case 'slack': {
      if (!isSlackMemberId(target)) return false;
      const service = createMessageServiceForCredentials(platform, applicationId, credentials);
      await service.sendMessage({ channelId: target, content, platform });
      return true;
    }
    case 'feishu':
    case 'lark': {
      await new LarkApiClient(applicationId, credentials.appSecret, platform).sendMessage(
        target,
        content,
        'open_id',
      );
      return true;
    }
    case 'dingtalk': {
      const service = createMessageServiceForCredentials(platform, applicationId, credentials);
      await service.sendMessage({ channelId: `single:${target}`, content, platform });
      return true;
    }
    case 'qq': {
      if (!isQQOpenId(target)) return false;
      const service = createMessageServiceForCredentials(platform, applicationId, credentials);
      await service.sendMessage({ channelId: `c2c:${target}`, content, platform });
      return true;
    }
    case 'wecom': {
      await resolveWeComOutbound(applicationId).deliver({ id: target, type: 'single' }, content);
      return true;
    }
    default: {
      return false;
    }
  }
};
