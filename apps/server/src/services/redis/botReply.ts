import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('botReply');

/**
 * Stop handing out a sessionWebhook this long before DingTalk's stated expiry,
 * so a reply that takes a few seconds to send never races the deadline.
 */
const EXPIRY_MARGIN_MS = 30 * 1000;

export interface DingTalkSessionWebhook {
  /** DingTalk's `sessionWebhookExpiredTime`, Unix ms. */
  expiresAt: number;
  url: string;
}

/**
 * Reply routes an IM platform issues together with an inbound message.
 *
 * DingTalk gives every robot callback a temporary `sessionWebhook` that can
 * answer the conversation without an access token or the robot send
 * permission, and is the only way to reach external contacts. The webhook that
 * receives the message and the callback that posts the agent's reply may run
 * in different processes, so the latest route per conversation lives here.
 * Without Redis every call is a no-op and senders fall back to the OpenAPI.
 */
export const botReply = {
  async rememberDingTalkSessionWebhook(
    applicationId: string,
    threadId: string,
    webhook: DingTalkSessionWebhook,
  ): Promise<void> {
    const ttlMs = webhook.expiresAt - Date.now() - EXPIRY_MARGIN_MS;
    if (ttlMs <= 0) return;

    const redis = await getClient();
    if (!redis) return;

    await redis
      .set(
        RedisKeys.botReply.dingtalkSessionWebhook(applicationId, threadId),
        JSON.stringify(webhook),
        { px: ttlMs },
      )
      .catch(() => undefined);
  },

  async getDingTalkSessionWebhook(
    applicationId: string,
    threadId: string,
  ): Promise<DingTalkSessionWebhook | undefined> {
    const redis = await getClient();
    if (!redis) return undefined;

    const raw = await redis
      .get(RedisKeys.botReply.dingtalkSessionWebhook(applicationId, threadId))
      .catch(() => null);
    if (!raw) return undefined;

    try {
      const parsed = JSON.parse(raw) as DingTalkSessionWebhook;
      if (typeof parsed.url !== 'string' || typeof parsed.expiresAt !== 'number') return undefined;
      if (parsed.expiresAt - EXPIRY_MARGIN_MS <= Date.now()) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  },

  /** Drop a route DingTalk rejected, so later replies go straight to the OpenAPI. */
  async forgetDingTalkSessionWebhook(applicationId: string, threadId: string): Promise<void> {
    const redis = await getClient();
    if (!redis) return;

    await redis
      .del(RedisKeys.botReply.dingtalkSessionWebhook(applicationId, threadId))
      .catch(() => undefined);
  },
};
