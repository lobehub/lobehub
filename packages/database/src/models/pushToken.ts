import type { ApnsEnvironment } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';

import type {
  NewPushLiveActivity,
  NewPushToken,
  PushLiveActivityItem,
  PushTokenItem,
} from '../schemas/pushToken';
import { pushLiveActivities, pushTokens } from '../schemas/pushToken';
import type { LobeChatDatabase } from '../type';

export class PushTokenModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Upsert by (userId, deviceId). Re-registering the same device replaces
   * the previous token and refreshes lastSeenAt.
   */
  async upsert(data: Omit<NewPushToken, 'userId'>): Promise<PushTokenItem> {
    const [result] = await this.db
      .insert(pushTokens)
      .values({ ...data, userId: this.userId })
      .onConflictDoUpdate({
        set: {
          apnsEnvironment: data.apnsEnvironment,
          appVersion: data.appVersion,
          expoToken: data.expoToken,
          lastSeenAt: new Date(),
          liveActivityPushToStartToken: data.liveActivityPushToStartToken,
          locale: data.locale,
          platform: data.platform,
        },
        target: [pushTokens.userId, pushTokens.deviceId],
      })
      .returning();

    return result;
  }

  /**
   * Attach or rotate ActivityKit's app-wide push-to-start registration for an
   * already registered device. The ordinary push-token route creates the row
   * first; returning undefined keeps a stale or foreign device fail-closed.
   */
  async updateLiveActivityRegistration(
    deviceId: string,
    data: {
      apnsEnvironment: ApnsEnvironment;
      liveActivityPushToStartToken: string;
    },
  ): Promise<PushTokenItem | undefined> {
    const [result] = await this.db
      .update(pushTokens)
      .set({
        apnsEnvironment: data.apnsEnvironment,
        lastSeenAt: new Date(),
        liveActivityPushToStartToken: data.liveActivityPushToStartToken,
      })
      .where(and(eq(pushTokens.userId, this.userId), eq(pushTokens.deviceId, deviceId)))
      .returning();

    return result;
  }

  /** Delete this user's token for a specific device (e.g. on logout). */
  async unregister(deviceId: string) {
    return this.db
      .delete(pushTokens)
      .where(and(eq(pushTokens.userId, this.userId), eq(pushTokens.deviceId, deviceId)));
  }

  /** All tokens for this user — used by PushChannel to fan out a notification. */
  async listByUserId(): Promise<PushTokenItem[]> {
    return this.db.select().from(pushTokens).where(eq(pushTokens.userId, this.userId));
  }
}

/** Owner-scoped ActivityKit update-token registry, correlated by opaque activity key. */
export class PushLiveActivityModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * One device has one token for one durable activity key. Re-registration
   * refreshes the native ids/tokens without conflating another callback from
   * the same heterogeneous operation.
   */
  async upsert(data: Omit<NewPushLiveActivity, 'userId'>): Promise<PushLiveActivityItem> {
    const [result] = await this.db
      .insert(pushLiveActivities)
      .values({ ...data, userId: this.userId })
      .onConflictDoUpdate({
        set: {
          activityId: data.activityId,
          apnsEnvironment: data.apnsEnvironment,
          lastSeenAt: new Date(),
          operationId: data.operationId,
          pushToken: data.pushToken,
        },
        target: [
          pushLiveActivities.userId,
          pushLiveActivities.deviceId,
          pushLiveActivities.activityKey,
        ],
      })
      .returning();

    return result;
  }

  /** All device tokens for exactly one durable intervention/activity. */
  async listByActivityKey(activityKey: string): Promise<PushLiveActivityItem[]> {
    return this.db
      .select()
      .from(pushLiveActivities)
      .where(
        and(
          eq(pushLiveActivities.userId, this.userId),
          eq(pushLiveActivities.activityKey, activityKey),
        ),
      );
  }

  /** Remove one device registration, or every device registration for the activity. */
  async unregister(activityKey: string, deviceId?: string) {
    return this.db
      .delete(pushLiveActivities)
      .where(
        and(
          eq(pushLiveActivities.userId, this.userId),
          eq(pushLiveActivities.activityKey, activityKey),
          deviceId ? eq(pushLiveActivities.deviceId, deviceId) : undefined,
        ),
      );
  }

  /**
   * Remove exactly the registration that supplied a stale callback.
   *
   * The push-token predicate fences a concurrent ActivityKit token rotation:
   * a late cleanup for the previous token must not delete the newer row that
   * won the same (owner, device, activity) upsert identity.
   */
  async unregisterIfPushToken(activityKey: string, deviceId: string, pushToken: string) {
    return this.db
      .delete(pushLiveActivities)
      .where(
        and(
          eq(pushLiveActivities.userId, this.userId),
          eq(pushLiveActivities.activityKey, activityKey),
          eq(pushLiveActivities.deviceId, deviceId),
          eq(pushLiveActivities.pushToken, pushToken),
        ),
      );
  }

  /** Remove every stale activity registration for one owned device. */
  async unregisterDevice(deviceId: string) {
    return this.db
      .delete(pushLiveActivities)
      .where(
        and(eq(pushLiveActivities.userId, this.userId), eq(pushLiveActivities.deviceId, deviceId)),
      );
  }
}

/**
 * Static helper for the cloud-side receipt cleanup worker.
 * Not bound to a userId — operates across all users at once.
 */
export async function deletePushTokensByExpoTokens(
  db: LobeChatDatabase,
  tokens: string[],
): Promise<void> {
  if (tokens.length === 0) return;
  await db.delete(pushTokens).where(inArray(pushTokens.expoToken, tokens));
}

/**
 * Static helper used by the public `unregister` endpoint — lets a signed-out
 * client clean up its own token without a session, by presenting the
 * (expoToken, deviceId) pair it received at registration. Both fields must
 * match so a stale row for a different device can't be deleted by accident.
 * Matching owner/device Live Activity registrations are removed atomically.
 */
export async function deletePushTokenByExpoTokenAndDevice(
  db: LobeChatDatabase,
  args: { deviceId: string; expoToken: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const deletedTokens = await tx
      .delete(pushTokens)
      .where(and(eq(pushTokens.expoToken, args.expoToken), eq(pushTokens.deviceId, args.deviceId)))
      .returning({ userId: pushTokens.userId });
    const userIds = [...new Set(deletedTokens.map(({ userId }) => userId))];
    if (userIds.length === 0) return;

    await tx
      .delete(pushLiveActivities)
      .where(
        and(
          inArray(pushLiveActivities.userId, userIds),
          eq(pushLiveActivities.deviceId, args.deviceId),
        ),
      );
  });
}
