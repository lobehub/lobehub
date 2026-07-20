import type { WorkingDirEntry } from '@lobechat/types';
import { and, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';

import type { DeviceItem } from '../schemas';
import { agents, devices, workspaces } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export type DeviceVisibility = 'private' | 'public';

/**
 * A workspace enrollment collided with ANOTHER member's PRIVATE row.
 * `registerWorkspaceDevice` fails closed on this instead of mutating the row —
 * deviceId is client-supplied, so treating the collision as "same physical
 * machine" would let any member expose a device its enroller kept private.
 * Routers map this to a CONFLICT response telling the caller to ask the
 * enroller (or an owner) to publish the device first.
 */
export class WorkspaceDevicePrivateConflictError extends Error {
  constructor(deviceId: string) {
    super(
      `Device "${deviceId}" is already privately enrolled by another workspace member — ask them (or a workspace owner) to publish it first.`,
    );
    this.name = 'WorkspaceDevicePrivateConflictError';
  }
}

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
   * Whether this workspace device is the enforced target of any fixed agent.
   * Returns only a boolean so device-management callers cannot infer private
   * agent metadata from the reference guard.
   */
  hasFixedAgentBinding = async (deviceId: string): Promise<boolean> => {
    if (!this.workspaceId) return false;

    const [row] = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.workspaceId, this.workspaceId),
          sql`${agents.agencyConfig}->>'executionTargetSelectionPolicy' = 'fixed'`,
          sql`${agents.agencyConfig}->>'executionTarget' = 'device'`,
          sql`${agents.agencyConfig}->>'boundDeviceId' = ${deviceId}`,
        ),
      )
      .limit(1);

    return !!row;
  };

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
  /**
   * Fail closed when `deviceId` collides with ANOTHER member's PRIVATE
   * enrollment: `deviceId` is CLIENT-SUPPLIED (explicit `--device-id`, stale
   * cache), so the server cannot verify it names this physical machine, and
   * treating the collision as "same machine" would let any member expose (or
   * otherwise mutate) a device its enroller deliberately kept private. The
   * genuine shared-box flow recovers by the enroller (or an owner) publishing
   * the device first.
   *
   * Called by {@link registerWorkspaceDevice} pre-upsert, and exposed
   * separately so flows with device-side effects (`shareDeviceToWorkspace`)
   * can check BEFORE the machine opens a workspace gateway connection.
   */
  assertNoCrossUserPrivateConflict = async (deviceId: string, workspaceId?: string) => {
    const wsId = workspaceId ?? this.workspaceId;
    if (!wsId) return;
    const conflicting = await this.db.query.devices.findFirst({
      where: and(eq(devices.workspaceId, wsId), eq(devices.deviceId, deviceId)),
    });
    if (conflicting && conflicting.userId !== this.userId && conflicting.visibility === 'private') {
      throw new WorkspaceDevicePrivateConflictError(deviceId);
    }
  };

  registerWorkspaceDevice = async (
    params: RegisterDeviceParams & {
      sharedFromDeviceId?: string;
      visibility?: DeviceVisibility;
      workspaceId: string;
    },
  ) => {
    await this.assertNoCrossUserPrivateConflict(params.deviceId, params.workspaceId);

    const now = new Date();
    const [result] = await this.db
      .insert(devices)
      .values({
        deviceId: params.deviceId,
        hostname: params.hostname,
        identitySource: params.identitySource,
        lastSeenAt: now,
        platform: params.platform,
        // Set for enrollments driven from the owner's personal device list —
        // links this workspace row back to its personal twin (see the schema
        // comment on `devices.sharedFromDeviceId`).
        sharedFromDeviceId: params.sharedFromDeviceId,
        userId: this.userId,
        // 'public' shares the device with the whole workspace; defaults to
        // 'private' (enroller-only) — see the schema comment on
        // `devices.visibility`.
        visibility: params.visibility ?? 'private',
        workspaceId: params.workspaceId,
      })
      // Dedupe on (workspaceId, deviceId): a machine enrolled into a workspace is
      // ONE device no matter which member (re-)runs the enrollment. `userId` and
      // `sharedFromDeviceId` are left untouched on conflict — the original
      // enroller keeps the enrollment. `visibility` on conflict:
      //   - an EXPLICIT `visibility: 'public'` (`lh connect --workspace --public`)
      //     always publishes — the caller just asked for it, silently keeping the
      //     row private would make the flag a no-op on re-enroll. Callers pass
      //     `visibility` only when the user chose explicitly, so a plain
      //     reconnect (undefined) still preserves the stored choice;
      //   - anything else preserves the stored choice. An explicit 'private'
      //     never demotes a published row here — pulling a shared device out of
      //     the pool must stay an explicit `setWorkspaceDeviceVisibility` call.
      // A DIFFERENT member colliding with an existing PRIVATE row never reaches
      // this upsert — the guard above fails closed (see
      // `WorkspaceDevicePrivateConflictError`); a cross-user collision with a
      // public row is the legit shared-infra flow and just refreshes liveness.
      // The partial unique index requires its predicate be repeated in
      // `targetWhere`.
      .onConflictDoUpdate({
        set: {
          hostname: params.hostname,
          identitySource: params.identitySource,
          lastSeenAt: now,
          platform: params.platform,
          visibility: params.visibility === 'public' ? 'public' : sql`${devices.visibility}`,
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

  /**
   * Devices of the current workspace VISIBLE to the caller: every public device
   * plus the caller's own private enrollments. Other members' private devices
   * are excluded at the SQL level (`buildWorkspaceWhere`) so no read path — the
   * settings list, the run-device picker, the CLI, the device tool — can leak
   * them.
   */
  queryWorkspaceDevices = async (): Promise<DeviceItem[]> => {
    if (!this.workspaceId) return [];
    return this.db.query.devices.findMany({
      orderBy: [desc(devices.lastSeenAt)],
      where: buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, devices),
    });
  };

  /**
   * DeviceIds of workspace devices HIDDEN from the caller (other members'
   * private enrollments). Read paths that merge the DB rows with the live
   * gateway pool need this to drop those devices from the "online but not
   * registered" fallback — the gateway pool is per-workspace and doesn't know
   * about visibility, so without this exclusion a private device would resurface
   * as a transient online entry.
   */
  queryWorkspaceHiddenDeviceIds = async (): Promise<string[]> => {
    if (!this.workspaceId) return [];
    const rows = await this.db
      .select({ deviceId: devices.deviceId })
      .from(devices)
      .where(
        and(
          eq(devices.workspaceId, this.workspaceId),
          eq(devices.visibility, 'private'),
          ne(devices.userId, this.userId),
        ),
      );
    return rows.map((r) => r.deviceId);
  };

  /**
   * A single workspace device by id, scoped to the current workspace and the
   * caller's visibility — another member's private device resolves to
   * `undefined`, exactly like a device that doesn't exist, so every write path
   * gated on this lookup fails closed with NOT_FOUND.
   */
  findWorkspaceDeviceById = async (deviceId: string) => {
    if (!this.workspaceId) return undefined;
    return this.db.query.devices.findFirst({
      where: and(
        eq(devices.deviceId, deviceId),
        buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, devices),
      ),
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

  /**
   * Publish a private workspace device to the shared pool, or pull a public one
   * back to private. Uses UPDATE … RETURNING (mirrors `AgentModel.setVisibility`)
   * because after a demotion the row may no longer match the caller-visible
   * predicate, so a read-back would return nothing. Authorization (enroller, or
   * workspace owner for visible devices) is enforced at the router.
   */
  setWorkspaceDeviceVisibility = async (deviceId: string, visibility: DeviceVisibility) => {
    if (!this.workspaceId) return undefined;
    const [row] = await this.db
      .update(devices)
      .set({ updatedAt: new Date(), visibility })
      .where(and(eq(devices.workspaceId, this.workspaceId), eq(devices.deviceId, deviceId)))
      .returning();
    return row;
  };

  /**
   * Overwrite an EXISTING workspace enrollment from an explicit, confirmed
   * share: apply the sharer's requested visibility and link the row back to
   * their personal device (`sharedFromDeviceId`) so the personal list can
   * render and revoke the share. Unlike `registerWorkspaceDevice`'s upsert —
   * which deliberately preserves visibility on conflict — this is only called
   * after the user has confirmed the overwrite. Permission (enroller or
   * workspace owner) is enforced at the router via `canEditWorkspaceDevice`.
   *
   * A confirmed overwrite transfers the row to the sharer (`userId`): the
   * workspace row is now a twin of the sharer's personal device, so share
   * listing (`querySharedWorkspaceDevices`), the personal revoke UI, and the
   * member-departure cleanup must all follow the sharer, not the original
   * enroller.
   */
  overwriteSharedWorkspaceDevice = async (
    deviceId: string,
    params: { sharedFromDeviceId: string; visibility: DeviceVisibility },
  ) => {
    if (!this.workspaceId) return undefined;
    const now = new Date();
    const [row] = await this.db
      .update(devices)
      .set({
        lastSeenAt: now,
        sharedFromDeviceId: params.sharedFromDeviceId,
        updatedAt: now,
        userId: this.userId,
        visibility: params.visibility,
      })
      .where(and(eq(devices.workspaceId, this.workspaceId), eq(devices.deviceId, deviceId)))
      .returning();
    return row;
  };

  /**
   * The caller's workspace enrollments that were shared from one of their
   * PERSONAL devices, across EVERY workspace (deliberately not scoped to
   * `this.workspaceId` — the personal device list renders the full share map
   * for each machine). Joined with the workspace name so the UI can label each
   * share without a second lookup.
   */
  querySharedWorkspaceDevices = async () => {
    return this.db
      .select({
        deviceId: devices.deviceId,
        sharedFromDeviceId: devices.sharedFromDeviceId,
        visibility: devices.visibility,
        workspaceId: devices.workspaceId,
        workspaceName: workspaces.name,
      })
      .from(devices)
      .innerJoin(workspaces, eq(devices.workspaceId, workspaces.id))
      .where(and(eq(devices.userId, this.userId), isNotNull(devices.sharedFromDeviceId)));
  };
}
