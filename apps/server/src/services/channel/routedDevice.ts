import type { LobeChatDatabase } from '@lobechat/database';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { resolveAgentAgencyConfig } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import type {
  ChannelRoutedDevice,
  ChannelRoutedDeviceInput,
} from '@/database/repositories/channel';
import { agents } from '@/database/schemas';
import { resolveExecutionPlan } from '@/helpers/executionTarget';
import { supportsCloudHeterogeneousSandbox } from '@/server/services/aiAgent/helpers/heteroErrors';
import {
  loadWorkspaceMemberOverrides,
  resolveCanManage,
} from '@/server/services/aiAgent/pipeline/resolveRunAgentConfig';
import { findWakeableManagedDevices } from '@/server/services/deviceGateway/managedDeviceWake';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

export interface RoutedDevicePresence {
  /** Whether `userId` can reach `deviceId` online in this Channel's scope. */
  isOnline: (userId: string, deviceId: string) => Promise<boolean>;
  /** Reads the user's presence ahead of the claim, outside the channel lock. */
  prefetch: (userId: string) => Promise<void>;
}

/**
 * Presence of requesters' routed devices for one advance pass, read once per requester. A
 * workspace run reaches the Channel workspace's devices and, as `readDevicePool` allows, the
 * requester's own personal device when the run routes exactly there: the gateway routes it by
 * `(userId, deviceId)`. Only that device is asked about, so no other personal device can stand
 * in for a Channel-picked one.
 */
export const createRoutedDevicePresence = (
  db: LobeChatDatabase,
  workspaceId: string | null,
): RoutedDevicePresence => {
  const pools = new Map<string, Promise<Set<string>>>();
  const pool = (userId: string, scope?: string) => {
    const key = `${userId}\0${scope ?? ''}`;
    let ids = pools.get(key);
    if (!ids) {
      ids = getScopedOnlineDevices(db, userId, scope)
        .then((devices) => new Set(devices.filter((d) => d.online).map((d) => d.deviceId)))
        .catch(() => new Set<string>());
      pools.set(key, ids);
    }
    return ids;
  };
  const scopes = workspaceId ? [workspaceId, undefined] : [undefined];
  return {
    isOnline: async (userId, deviceId) => {
      for (const scope of scopes) if ((await pool(userId, scope)).has(deviceId)) return true;
      return false;
    },
    prefetch: async (userId) => {
      await Promise.all(scopes.map((scope) => pool(userId, scope)));
    },
  };
};

/**
 * The device a Channel run with no device picked in the Channel routes to, resolved from the
 * same inputs the run itself uses: the claimed Agent config, the requester's own device override
 * for the Agent (`snapshotFollowsCallerDevice`) and the local CLI execution plan of
 * `resolveHeteroRouting`. Undefined when the run needs no device to start: a Native run, a
 * remote (platform) Agent, a sandbox or unrouted plan, or a managed device dispatch would wake.
 *
 * It does not see a device pinned by a reused topic or a project directory, which only the
 * ordinary pipeline resolves; those still fail at dispatch when offline.
 */
export const resolveChannelRoutedDevice = async (
  db: LobeChatDatabase,
  { agentId, executionConfig, userId, workspaceId }: ChannelRoutedDeviceInput,
  presence: RoutedDevicePresence,
): Promise<ChannelRoutedDevice | undefined> => {
  const heteroType = executionConfig.agencyConfig?.heterogeneousProvider?.type;
  if (!heteroType || isRemoteHeterogeneousType(heteroType)) return;

  const [agent] = await db
    .select({
      userId: agents.userId,
      visibility: agents.visibility,
      workspaceId: agents.workspaceId,
    })
    .from(agents)
    .where(eq(agents.id, agentId));
  if (!agent) return;
  const scope = { db, userId, workspaceId: workspaceId ?? undefined };
  // As `resolveRunAgentConfig` decides it for the same caller and Agent.
  const agentWorkspaceId = agent.workspaceId ?? scope.workspaceId;
  const [{ device }, canManage] = await Promise.all([
    loadWorkspaceMemberOverrides(scope, agentId),
    resolveCanManage(
      scope,
      agent,
      agentWorkspaceId,
      !!agentWorkspaceId && agent.visibility !== 'private',
    ),
  ]);
  const agencyConfig = resolveAgentAgencyConfig(executionConfig.agencyConfig, device, {
    canManage,
    visibility: agent.visibility ?? undefined,
    workspaceId: agentWorkspaceId,
  });

  const wakeable = await findWakeableManagedDevices(scope, [agencyConfig?.boundDeviceId]);
  const plan = resolveExecutionPlan({
    agencyConfig,
    clientExecutionAvailable: false,
    isHetero: true,
    sandboxExecutionAvailable: supportsCloudHeterogeneousSandbox(heteroType),
    wakeableDeviceIds: wakeable.map((target) => target.deviceId),
  });
  // No presence here: the plan trusts the binding (personal or not), as hetero dispatch does.
  if (plan.kind !== 'device') return;
  return { deviceId: plan.deviceId, online: await presence.isOnline(userId, plan.deviceId) };
};
