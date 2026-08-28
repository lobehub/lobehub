import { sleep } from '@lobechat/utils';
import debug from 'debug';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';

import { PushTokenModel } from '@/database/models/pushToken';
import { serverDB } from '@/database/server';

import { DEFAULT_PUSH_CHANNEL_ID } from './constants';
import type { PushDeliveryContext, PushDeliveryResult, PushTicketRecord } from './types';

const log = debug('lobe-notification:push');

/** Expo Push Service hard rate limit (messages per second per project) */
const SEND_CHUNK_THROTTLE_MS = 100;

/**
 * Push channel implementation backed by the Expo Push Service.
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
 */
export class PushChannel {
  readonly id = 'push';

  private expo: Expo;

  constructor(expoClient?: Expo) {
    // FCM v1 is the only supported FCM API for new projects — Legacy server
    // keys were retired by Google. APNs uses the .p8 auth key uploaded to EAS.
    // (`useFcmV1` is implicit in the current SDK; no constructor flag needed.)
    this.expo = expoClient ?? new Expo();
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
    const validTokens = tokens.filter(
      (t) => !excludedDeviceIds.has(t.deviceId) && Expo.isExpoPushToken(t.expoToken),
    );
    if (validTokens.length === 0) {
      if (tokens.every((token) => excludedDeviceIds.has(token.deviceId))) {
        log('All devices excluded from ordinary push for userId=%s', ctx.userId);
        // The caller excluded these devices only after another system surface
        // accepted delivery, so this is a satisfied channel, not a retryable
        // ordinary-push failure.
        return { status: 'delivered' };
      }

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
    const chunks = this.expo.chunkPushNotifications(messages);
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

    if (ticketRecords.length === 0) {
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
}
