import type { LobeChatDatabase } from '@/database/type';
import type { WechatOutboundAttachment } from '@/server/services/bot/platforms/wechat/sendAttachments';
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

export const MESSENGER_PUSH_PLATFORMS = ['wechat'] as const;

export type MessengerPushPlatform = (typeof MESSENGER_PUSH_PLATFORMS)[number];

export type MessengerPushResult = WechatPushResult;

export interface MessengerPushWindowStatus extends WechatPushWindowStatus {
  /** How the platform delivers proactive messages. */
  deliverability: 'windowed' | 'always';
}

export const sendMessengerPush = async (params: {
  attachments?: WechatOutboundAttachment[];
  content?: string;
  platform: MessengerPushPlatform;
  serverDB: LobeChatDatabase;
  userId: string;
}): Promise<MessengerPushResult> => {
  const { platform, ...rest } = params;
  switch (platform) {
    case 'wechat': {
      return sendProactiveWechatMessage(rest);
    }
  }
};

export const getMessengerPushWindow = async (params: {
  platform: MessengerPushPlatform;
  serverDB: LobeChatDatabase;
  userId: string;
}): Promise<MessengerPushWindowStatus> => {
  const { platform, ...rest } = params;
  switch (platform) {
    case 'wechat': {
      return { ...(await getWechatPushWindowStatus(rest)), deliverability: 'windowed' };
    }
  }
};
