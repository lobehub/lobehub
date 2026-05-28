import { and, desc, eq } from 'drizzle-orm';

import type { DeviceItem } from '../schemas';
import { devices } from '../schemas';
import type { LobeChatDatabase } from '../type';

export interface RegisterDeviceParams {
  deviceId: string;
  hostname?: string | null;
  identitySource: string;
  platform?: string | null;
}

/** Columns the user owns — never overwritten by an auto-register upsert. */
export interface UpdateDeviceParams {
  defaultCwd?: string | null;
  friendlyName?: string | null;
  recentCwds?: string[];
}

export class DeviceModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * Auto-register from desktop/CLI. Upserts on the (userId, deviceId) unique
   * index. On conflict only the machine-reported fields + lastSeenAt are
   * refreshed — friendlyName / defaultCwd / recentCwds are user-owned and
   * must survive re-registration.
   */
  register = async (params: RegisterDeviceParams) => {
    const now = new Date();
    const [result] = await this.db
      .insert(devices)
      .values({
        deviceId: params.deviceId,
        hostname: params.hostname,
        identitySource: params.identitySource,
        lastSeenAt: now,
        platform: params.platform,
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: {
          hostname: params.hostname,
          identitySource: params.identitySource,
          lastSeenAt: now,
          platform: params.platform,
        },
        target: [devices.userId, devices.deviceId],
      })
      .returning();

    return result;
  };

  query = async (): Promise<DeviceItem[]> => {
    return this.db.query.devices.findMany({
      orderBy: [desc(devices.lastSeenAt)],
      where: eq(devices.userId, this.userId),
    });
  };

  findByDeviceId = async (deviceId: string) => {
    return this.db.query.devices.findFirst({
      where: and(eq(devices.userId, this.userId), eq(devices.deviceId, deviceId)),
    });
  };

  update = async (deviceId: string, value: UpdateDeviceParams) => {
    return this.db
      .update(devices)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(devices.userId, this.userId), eq(devices.deviceId, deviceId)));
  };

  delete = async (deviceId: string) => {
    return this.db
      .delete(devices)
      .where(and(eq(devices.userId, this.userId), eq(devices.deviceId, deviceId)));
  };
}
