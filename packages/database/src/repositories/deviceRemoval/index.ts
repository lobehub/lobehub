import { and, eq, isNull } from 'drizzle-orm';

import { DeviceModel } from '../../models/device';
import { agents } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { removeDeviceFromAgents } from '../../utils/agencyConfigDevices';

/**
 * Removes a device together with every agent reference to it. The device row
 * and the agents that picked it are separate aggregates, so the unit of work
 * lives here and composes {@link DeviceModel} with the agent unbind: an agent
 * must never keep routing to, or showing, a device the account no longer has.
 */
export class DeviceRemovalRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  /**
   * Remove a personal device. Only the caller's personal agents can have
   * picked it. Returns the removed rows.
   */
  removePersonalDevice = async (deviceId: string) =>
    this.db.transaction(async (trx) => {
      const removed = await new DeviceModel(trx as LobeChatDatabase, this.userId).delete(deviceId);
      if (removed.length > 0) {
        await removeDeviceFromAgents(
          trx,
          and(eq(agents.userId, this.userId), isNull(agents.workspaceId)),
          deviceId,
        );
      }
      return removed;
    });

  /**
   * Remove a device from the current workspace's pool. Any member's agent in
   * the workspace may have picked it, private ones included. Returns the
   * removed rows, or `undefined` without a current workspace.
   */
  removeWorkspaceDevice = async (deviceId: string) => {
    const workspaceId = this.workspaceId;
    if (!workspaceId) return;

    return this.db.transaction(async (trx) => {
      const removed =
        (await new DeviceModel(
          trx as LobeChatDatabase,
          this.userId,
          workspaceId,
        ).deleteWorkspaceDevice(deviceId)) ?? [];
      if (removed.length > 0) {
        await removeDeviceFromAgents(trx, eq(agents.workspaceId, workspaceId), deviceId);
      }
      return removed;
    });
  };
}
