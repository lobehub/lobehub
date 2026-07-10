import type { WorkingDirEntry } from '@lobechat/types';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

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
  workingDirs?: WorkingDirEntry[];
}

/**
 * Two distinct kinds of device live in this table, told apart by `workspace_id`:
 *
 * - **Personal devices** (`workspace_id IS NULL`): a user's own machine, keyed
 *   by `(userId, deviceId)`. The personal read/write path (`query` / `register`
 *   / `update` / `delete` / `findByDeviceId`) is scoped by `userId` and must
 *   stay that way — a user's machine belongs to them across all their
 *   workspaces.
 * - **Workspace devices** (`workspace_id = <ws>`): a machine enrolled into a
 *   workspace by an admin (e.g. a shared build server). Owned by the workspace,
 *   reachable by every member. `userId` records the enrolling admin. These are
 *   read via `queryWorkspaceDevices` / `findWorkspaceDeviceById` (scoped by
 *   `workspace_id`), never mixed into the personal `query`.
 *
 * `workspaceId` here is the caller's current workspace (for the workspace
 * reads); the personal path ignores it.
 */
export class DeviceModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  /**
   * Auto-register from desktop/CLI. Upserts on the (userId, deviceId) unique
   * index. On conflict only the machine-reported fields + lastSeenAt are
   * refreshed — friendlyName / defaultCwd / workingDirs are user-owned and
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
        targetWhere: sql`${devices.workspaceId} IS NULL`,
      })
      .returning();

    return result;
  };

  /**
   * Enroll a machine as a WORKSPACE device (admin-driven). Upserts on
   * `(userId, deviceId)` like {@link register}, but stamps `workspace_id` so the
   * row belongs to the workspace and surfaces to all its members. `userId`
   * records the enrolling admin.
   */
  registerWorkspaceDevice = async (params: RegisterDeviceParams & { workspaceId: string }) => {
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
        workspaceId: params.workspaceId,
      })
      // Dedupe on (workspaceId, deviceId): a machine enrolled into a workspace is
      // ONE device no matter which admin (re-)runs the enrollment. `userId` is
      // left untouched on conflict — it stays the original enroller. The partial
      // unique index requires its predicate be repeated in `targetWhere`.
      .onConflictDoUpdate({
        set: {
          hostname: params.hostname,
          identitySource: params.identitySource,
          lastSeenAt: now,
          platform: params.platform,
        },
        target: [devices.workspaceId, devices.deviceId],
        targetWhere: sql`${devices.workspaceId} IS NOT NULL`,
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

  /** The caller's PERSONAL devices only (excludes any workspace-enrolled rows). */
  queryPersonal = async (): Promise<DeviceItem[]> => {
    return this.db.query.devices.findMany({
      orderBy: [desc(devices.lastSeenAt)],
      where: and(eq(devices.userId, this.userId), isNull(devices.workspaceId)),
    });
  };

  /** Every device enrolled into the current workspace (any enrolling admin). */
  queryWorkspaceDevices = async (): Promise<DeviceItem[]> => {
    if (!this.workspaceId) return [];
    return this.db.query.devices.findMany({
      orderBy: [desc(devices.lastSeenAt)],
      where: eq(devices.workspaceId, this.workspaceId),
    });
  };

  /** A single workspace device by id, scoped to the current workspace. */
  findWorkspaceDeviceById = async (deviceId: string) => {
    if (!this.workspaceId) return undefined;
    return this.db.query.devices.findFirst({
      where: and(eq(devices.workspaceId, this.workspaceId), eq(devices.deviceId, deviceId)),
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

  /**
   * Update a WORKSPACE device's user-editable fields, scoped by `workspace_id`
   * (not the enrolling user's `userId`), so any authorized caller can manage
   * any device in the pool. Permission (workspace owner, or the enroller acting
   * on their own device) is enforced at the router via `canEditWorkspaceDevice`.
   */
  updateWorkspaceDevice = async (deviceId: string, value: UpdateDeviceParams) => {
    if (!this.workspaceId) return;
    return this.db
      .update(devices)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(devices.workspaceId, this.workspaceId), eq(devices.deviceId, deviceId)));
  };

  /**
   * Remove a WORKSPACE device, scoped by `workspace_id`. Permission
   * (workspace owner, or the enroller acting on their own device) is enforced
   * at the router via `canEditWorkspaceDevice`.
   */
  deleteWorkspaceDevice = async (deviceId: string) => {
    if (!this.workspaceId) return;
    return this.db
      .delete(devices)
      .where(and(eq(devices.workspaceId, this.workspaceId), eq(devices.deviceId, deviceId)));
  };
}
