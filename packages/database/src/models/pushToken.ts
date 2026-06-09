import { and, eq, inArray } from 'drizzle-orm';

import type { NewPushToken, PushTokenItem } from '../schemas/pushToken';
import { pushTokens } from '../schemas/pushToken';
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
          appVersion: data.appVersion,
          expoToken: data.expoToken,
          lastSeenAt: new Date(),
          locale: data.locale,
          platform: data.platform,
        },
        target: [pushTokens.userId, pushTokens.deviceId],
      })
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
