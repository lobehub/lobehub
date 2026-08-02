import type { MessengerPlatform } from '@/config/messenger';
import type { SafeMessengerAccountLink } from '@/database/models/messengerAccountLink';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import type { LobeChatDatabase } from '@/database/type';
import type { WechatOutboundAttachment } from '@/server/services/bot/platforms/wechat/sendAttachments';
import { getInstallationStore } from '@/server/services/messenger/installations';
import { getMessengerRouter } from '@/server/services/messenger/MessengerRouter';
import {
  getWechatPushWindowStatus,
  sendProactiveWechatMessage,
  type WechatPushResult,
  type WechatPushWindowStatus,
} from '@/server/services/messenger/wechatPush';

/**
 * Platform-agnostic proactive push for messenger channels.
 *
 * This is the single entry the notification-channel integration and the
 * settings UI build on. Delivery semantics differ per platform:
 *
 * - `windowed` platforms (WeChat iLink) can only deliver inside a send window
 *   opened by the user's inbound message; outside it the message is queued and
 *   replayed on the next inbound message.
 * - `always` platforms (Telegram / Slack / Discord bots) can DM the linked
 *   user at any time — their adapters report an always-open window.
 *
 * To add a platform: implement its send + window status against the user's
 * `messenger_account_links` row, then extend `MESSENGER_PUSH_PLATFORMS` and
 * the two switches below. Keep the result contract identical so callers stay
 * platform-blind.
 */

export const MESSENGER_PUSH_PLATFORMS = [
  'telegram',
  'slack',
  'discord',
  'wechat',
] as const satisfies readonly MessengerPlatform[];

export type MessengerPushPlatform = (typeof MESSENGER_PUSH_PLATFORMS)[number];

export type MessengerPushResult = WechatPushResult;

export interface MessengerPushWindowStatus extends WechatPushWindowStatus {
  /** How the platform delivers proactive messages. */
  deliverability: 'windowed' | 'always';
}

const resolveAccountLink = async (params: {
  platform: MessengerPushPlatform;
  serverDB: LobeChatDatabase;
  tenantId?: string;
  userId: string;
}): Promise<SafeMessengerAccountLink | undefined> => {
  const linkModel = new MessengerAccountLinkModel(params.serverDB, params.userId);

  // Slack can have several workspace links. Callers normally pass tenantId;
  // preserving the implicit target is safe only when exactly one link exists.
  if (params.platform === 'slack' && params.tenantId === undefined) {
    const links = (await linkModel.list()).filter((link) => link.platform === 'slack');
    return links.length === 1 ? links[0] : undefined;
  }

  return linkModel.findByPlatform(params.platform, params.tenantId);
};

const sendAlwaysAvailableMessage = async (params: {
  content?: string;
  platform: Exclude<MessengerPushPlatform, 'wechat'>;
  serverDB: LobeChatDatabase;
  tenantId?: string;
  userId: string;
}): Promise<MessengerPushResult> => {
  const content = params.content?.trim();
  if (!content) return { status: 'unavailable' };

  const link = await resolveAccountLink(params);
  if (!link) return { status: 'unlinked' };

  const store = getInstallationStore(params.platform);
  const installationKey = link.tenantId
    ? `${params.platform}:${link.tenantId}`
    : `${params.platform}:singleton`;
  const credentials = await store?.resolveByKey(installationKey);
  if (!credentials) return { status: 'unavailable' };

  try {
    await getMessengerRouter().sendDirectMessage({
      content,
      credentials,
      platformUserId: link.platformUserId,
    });
    return { status: 'sent' };
  } catch (error) {
    console.error(`[messenger:push] ${params.platform} direct message failed`, error);
    return { status: 'unavailable' };
  }
};

export const sendMessengerPush = async (params: {
  attachments?: WechatOutboundAttachment[];
  content?: string;
  platform: MessengerPushPlatform;
  serverDB: LobeChatDatabase;
  tenantId?: string;
  userId: string;
}): Promise<MessengerPushResult> => {
  const { platform, ...rest } = params;
  switch (platform) {
    case 'wechat': {
      return sendProactiveWechatMessage(rest);
    }
    default: {
      return sendAlwaysAvailableMessage({ ...rest, platform });
    }
  }
};

export const getMessengerPushWindow = async (params: {
  platform: MessengerPushPlatform;
  serverDB: LobeChatDatabase;
  tenantId?: string;
  userId: string;
}): Promise<MessengerPushWindowStatus> => {
  const { platform, ...rest } = params;
  switch (platform) {
    case 'wechat': {
      return { ...(await getWechatPushWindowStatus(rest)), deliverability: 'windowed' };
    }
    default: {
      const link = await resolveAccountLink({ ...rest, platform });
      return {
        deliverability: 'always',
        expiresInSeconds: null,
        linked: !!link,
        maxSends: 0,
        queued: 0,
        remaining: 0,
        windowOpen: !!link,
      };
    }
  }
};
