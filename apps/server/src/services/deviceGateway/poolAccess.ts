import type { LobeChatDatabase } from '@lobechat/database';
import { agentOperations } from '@lobechat/database/schemas';
import type { DevicePoolRunContext } from '@lobechat/types';
import { devicePoolRunContextSchema } from '@lobechat/types';
import { and, eq, isNull } from 'drizzle-orm';

import { DevicePoolModel } from '@/database/models/devicePool';
import { UserModel } from '@/database/models/user';

/**
 * Resolves trusted run provenance and re-evaluates current device-pool grants.
 *
 * Use when:
 * - Initial planning or an execution boundary needs device authorization
 *
 * Expects:
 * - userId/workspaceId come from the authenticated runtime
 *
 * Returns:
 * - Scoped provenance and live grants; missing or foreign operation state denies access
 *
 * Call stack:
 * setupTurn / getScopedOnlineDevices / resolveDeviceDispatchAuthorizationFailure
 *   -> DevicePoolAccessService -> DevicePoolModel.authorizedDevices
 */
export class DevicePoolAccessService {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}

  /**
   * Reads the principal's persisted opt-in without caching grants.
   *
   * Use when:
   * - Choosing experimental pool authorization or the existing device path
   *
   * Expects:
   * - The authenticated caller or execution principal owns this preference
   *
   * Returns:
   * - True only for an explicit Labs opt-in; missing preferences disable pools
   */
  async isEnabled(): Promise<boolean> {
    const preference = await new UserModel(this.db, this.userId).getUserPreference();
    return preference?.lab?.enableDevicePools === true;
  }

  /** Reads only the operation belonging to this storage principal and scope. */
  async loadContext(operationId: string): Promise<DevicePoolRunContext | undefined> {
    if (!(await this.isEnabled())) return undefined;
    const [row] = await this.db
      .select({ metadata: agentOperations.metadata })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.id, operationId),
          eq(agentOperations.userId, this.userId),
          this.workspaceId
            ? eq(agentOperations.workspaceId, this.workspaceId)
            : isNull(agentOperations.workspaceId),
        ),
      )
      .limit(1);
    const result = devicePoolRunContextSchema.safeParse(row?.metadata?.devicePoolContext);
    return result.success
      ? result.data
      : {
          agentId: '',
          blocked: true,
          trigger: 'chat',
          workspaceId: this.workspaceId,
        };
  }

  /** Inherits a parent's scope, or creates a root context from server-authored entry facts. */
  async createContext(input: {
    actorUserId?: string;
    agentId: string;
    bot: boolean;
    parentOperationId?: string;
    shareVisitor: boolean;
    task: boolean;
    trigger?: string;
  }): Promise<DevicePoolRunContext | undefined> {
    if (!(await this.isEnabled())) return undefined;
    if (input.parentOperationId) return this.loadContext(input.parentOperationId);
    return {
      // Unmapped Bot users match Everyone only; storage ownership is never sender identity.
      actorUserId: input.shareVisitor ? undefined : input.bot ? input.actorUserId : this.userId,
      agentId: input.agentId,
      blocked:
        input.shareVisitor ||
        (!input.bot &&
          !input.task &&
          ![undefined, 'chat', 'topic', 'api', 'cli', 'openapi'].includes(input.trigger)),
      trigger: input.bot ? 'bot' : input.task ? 'task' : 'chat',
      workspaceId: this.workspaceId,
    };
  }

  /** Rechecks policies and current Workspace membership; no positive permission cache. */
  async authorizedDevices(context: DevicePoolRunContext) {
    if (!(await this.isEnabled())) return [];
    return new DevicePoolModel(this.db, this.userId, this.workspaceId).authorizedDevices(context);
  }
}
