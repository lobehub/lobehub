import { sleep } from '@lobechat/utils';
import debug from 'debug';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';

import { PushTokenModel } from '@/database/models/pushToken';
import type { PushTokenItem } from '@/database/schemas';
import { serverDB } from '@/database/server';

import { APNS_INVALID_TOKEN_REASONS, ApnsClient } from './apns';
import { DEFAULT_PUSH_CHANNEL_ID } from './constants';
import type { PushDeliveryContext, PushDeliveryResult, PushTicketRecord } from './types';

const log = debug('lobe-notification:push');

/** Expo Push Service hard rate limit (messages per second per project) */
const SEND_CHUNK_THROTTLE_MS = 100;

/**
 * Push channel implementation backed by the Expo Push Service, plus direct
 * APNs delivery for native iOS clients that register a raw device token.
 *
 * Structurally compatible with cloud's `NotificationChannel`; can be registered
 * directly into cloud's `channelInstances` map. Also usable standalone by
 * self-hosters who supply their own EAS credentials.
 *
 * Behaviour:
 *  1. Resolves all of `userId`'s registered Expo tokens via `PushTokenModel`
 *  2. Filters out malformed tokens via `Expo.isExpoPushToken`
 *  3. Chunks + sends with `expo.sendPushNotificationsAsync`, with throttling
 *  4. Encodes (ticketId, expoToken) pairs into `providerMessageId` so the
 *     receipt cron can identify invalid tokens later
 *  5. Sends `provider = 'apns'` tokens straight to APNs (when `APNS_*` is
 *     configured; otherwise they are skipped with a log). APNs answers
 *     synchronously, so rejected tokens (`BadDeviceToken` / `Unregistered`)
 *     are removed right away instead of by the receipt cron.
 */
export class PushChannel {
  readonly id = 'push';

  private expo: Expo;
  private apns: ApnsClient | undefined;

  /**
   * @param apnsClient `null` disables native APNs delivery; omitted reads the
   *   `APNS_*` environment.
   */
  constructor(expoClient?: Expo, apnsClient?: ApnsClient | null) {
    // FCM v1 is the only supported FCM API for new projects — Legacy server
    // keys were retired by Google. APNs uses the .p8 auth key uploaded to EAS.
    // (`useFcmV1` is implicit in the current SDK; no constructor flag needed.)
    this.expo = expoClient ?? new Expo();
    this.apns = apnsClient === undefined ? ApnsClient.fromEnv() : (apnsClient ?? undefined);
  }

  async deliver(ctx: PushDeliveryContext): Promise<PushDeliveryResult> {
    const tokens = await new PushTokenModel(serverDB, ctx.userId).listByUserId();

    if (tokens.length === 0) {
      log('No push tokens for userId=%s', ctx.userId);
      return { failedReason: 'no_tokens', status: 'failed' };
    }

    // Build messages, keeping the order so we can map tickets back to tokens by index.
    // Filtering by the stable row deviceId (not the mutable Expo token) lets
    // callers de-duplicate a system-specific delivery without weakening
    // fallback for the user's other devices.
    const excludedDeviceIds = new Set(ctx.pushPresentation?.excludeDeviceIds);
    const included = tokens.filter((t) => !excludedDeviceIds.has(t.deviceId));
    const apnsTokens = included.filter((t) => t.provider === 'apns');
    const validTokens = included.filter(
      (t) => t.provider !== 'apns' && Expo.isExpoPushToken(t.expoToken),
    );
    if (apnsTokens.length > 0 && !this.apns)
      log(
        'APNs not configured (APNS_KEY_ID/APNS_TEAM_ID/APNS_KEY); skipping %d native token(s) for userId=%s',
        apnsTokens.length,
        ctx.userId,
      );
    const sendableApnsTokens = this.apns ? apnsTokens : [];

    if (validTokens.length === 0 && sendableApnsTokens.length === 0) {
      if (tokens.every((token) => excludedDeviceIds.has(token.deviceId))) {
        log('All devices excluded from ordinary push for userId=%s', ctx.userId);
        // The caller excluded these devices only after another system surface
        // accepted delivery, so this is a satisfied channel, not a retryable
        // ordinary-push failure.
        return { status: 'delivered' };
      }

      if (apnsTokens.length > 0 && included.every((t) => t.provider === 'apns'))
        return { failedReason: 'apns_not_configured', status: 'failed' };

      log('All tokens malformed for userId=%s', ctx.userId);
      return { failedReason: 'invalid_tokens', status: 'failed' };
    }

    const messages: ExpoPushMessage[] = validTokens.map((t) => ({
      body: ctx.content,
      channelId: DEFAULT_PUSH_CHANNEL_ID,
      data: {
        ...ctx.pushPresentation?.data,
        // Routing and identity fields are owned by the delivery context. Keep
        // them after caller-provided presentation data so custom metadata can
        // never redirect a tap or impersonate another notification scenario.
        notificationId: ctx.notificationId,
        type: ctx.type,
        url: ctx.actionUrl,
      },
      mutableContent: ctx.pushPresentation?.mutableContent,
      priority: 'high',
      richContent: ctx.pushPresentation?.image ? { image: ctx.pushPresentation.image } : undefined,
      sound: 'default',
      title: ctx.title,
      to: t.expoToken,
    }));

    const ticketRecords: PushTicketRecord[] = [];
    const chunks = messages.length > 0 ? this.expo.chunkPushNotifications(messages) : [];
    let cursor = 0;

    for (const chunk of chunks) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);

        tickets.forEach((ticket, i) => {
          const expoToken = chunk[i].to as string;
          const deviceId = validTokens[cursor + i]?.deviceId;

          if (ticket.status === 'ok') {
            ticketRecords.push({ expoToken, ticketId: ticket.id });
          } else {
            // Per-message error at send time — receipt phase won't see this one.
            // Provider messages are intentionally omitted: they are opaque and
            // may echo the Expo token. Keep diagnostics categorical and scoped
            // to our own stable device id.
            log(
              'Send-time error for deviceId=%s category=%s',
              deviceId,
              ticket.details?.error ?? 'unknown',
            );
          }
        });
      } catch (error) {
        const err = error as { statusCode?: number; message?: string };
        if (err.statusCode === 429) {
          log('Rate limited by Expo Push Service for userId=%s', ctx.userId);
          return { failedReason: 'rate_limited', status: 'failed' };
        }
        // Unrecoverable — let the caller log via Promise.allSettled in NotificationService
        throw error;
      }

      // Throttle between chunks to stay under Expo's 600/sec project limit
      cursor += chunk.length;
      if (cursor < messages.length) {
        await sleep(SEND_CHUNK_THROTTLE_MS);
      }
    }

    const apnsDelivered = await this.deliverApns(ctx, sendableApnsTokens);

    if (ticketRecords.length === 0) {
      // APNs accepts synchronously: there is no receipt left to wait for.
      if (apnsDelivered > 0) return { status: 'delivered' };
      return { failedReason: 'all_send_failed', status: 'failed' };
    }

    return {
      // TODO: tracking each (ticketId, expoToken) inline keeps deliveries
      // self-contained but couples PushChannel to processPushReceipts. Migrate
      // to a dedicated push_tickets table if we ever need cross-delivery joins.
      providerMessageId: JSON.stringify(ticketRecords),
      status: 'sent',
    };
  }

  /** Sends to native APNs tokens; returns how many APNs accepted. */
  private async deliverApns(ctx: PushDeliveryContext, tokens: PushTokenItem[]): Promise<number> {
    const apns = this.apns;
    if (!apns || tokens.length === 0) return 0;

    const presentation = ctx.pushPresentation;
    const payload: Record<string, unknown> = {
      ...presentation?.data,
      ...(presentation?.image && { image: presentation.image }),
      aps: {
        alert: { body: ctx.content, title: ctx.title },
        ...(presentation?.mutableContent && { 'mutable-content': 1 }),
        sound: 'default',
      },
      // Same precedence as the Expo payload: routing fields win over custom data.
      notificationId: ctx.notificationId,
      type: ctx.type,
      url: ctx.actionUrl,
    };

    const results = await Promise.all(
      tokens.map(async (t) => {
        try {
          return await apns.send({
            environment: t.apnsEnvironment ?? 'production',
            payload,
            token: t.expoToken,
            topic: t.bundleId ?? undefined,
          });
        } catch (error) {
          log('APNs request failed for deviceId=%s: %s', t.deviceId, (error as Error).message);
          return { reason: 'network_error', status: 'error' as const, statusCode: 0 };
        }
      }),
    );

    const invalid: string[] = [];
    let delivered = 0;
    results.forEach((result, i) => {
      const token = tokens[i];
      if (result.status === 'ok') {
        delivered += 1;
        return;
      }
      // Reasons are categorical; never log the device token itself.
      log(
        'APNs rejected deviceId=%s status=%d reason=%s',
        token.deviceId,
        result.statusCode,
        result.reason,
      );
      if (APNS_INVALID_TOKEN_REASONS.has(result.reason)) invalid.push(token.expoToken);
    });

    if (invalid.length > 0) {
      try {
        await new PushTokenModel(serverDB, ctx.userId).deleteByTokens('apns', invalid);
      } catch (error) {
        // Cleanup is best effort; the next delivery retries it.
        log('Failed to remove rejected APNs tokens: %O', error);
      }
    }

    return delivered;
  }
}
