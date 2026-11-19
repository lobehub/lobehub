import type { LobeChatDatabase } from '@lobechat/database';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { resolveAgentAgencyConfig } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import type {
  ChannelRoutedDevice,
  ChannelRoutedDeviceInput,
} from '@/database/repositories/channel';
import { agents } from '@/database/schemas';
import { defaultsToAuto, resolveExecutionPlan } from '@/helpers/executionTarget';
import { supportsCloudHeterogeneousSandbox } from '@/server/services/aiAgent/helpers/heteroErrors';
import {
  loadWorkspaceMemberOverrides,
  resolveCanManage,
} from '@/server/services/aiAgent/pipeline/resolveRunAgentConfig';
import { findWakeableManagedDevices } from '@/server/services/deviceGateway/managedDeviceWake';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

export interface RoutedDevicePresence {
  /** Whether `userId` can reach `deviceId` online in the run's `workspaceId` scope. */
  isOnline: (userId: string, deviceId: string, workspaceId: string | null) => Promise<boolean>;
  /** Reads the user's presence ahead of the claim, outside the channel lock. */
  prefetch: (userId: string, workspaceId: string | null) => Promise<void>;
}

/**
 * Presence of routed devices for one advance pass, read once per execution identity and scope. A
 * workspace run reaches that workspace's devices and, as `readDevicePool` allows, the executing
 * user's own personal device when the run routes exactly there: the gateway routes it by
 * `(userId, deviceId)`. Only that device is asked about, so no other personal device can stand
 * in for a Channel-picked one.
 *
 * The scope is the run's, not the Channel's: a shared Agent runs as its owner in the owner's
 * scope, so its device is looked up there even when the visitor's Channel sits in a workspace.
 */
export const createRoutedDevicePresence = (db: LobeChatDatabase): RoutedDevicePresence => {
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
  const scopes = (workspaceId: string | null) =>
    workspaceId ? [workspaceId, undefined] : [undefined];
  return {
    isOnline: async (userId, deviceId, workspaceId) => {
      for (const scope of scopes(workspaceId))
        if ((await pool(userId, scope)).has(deviceId)) return true;
      return false;
    },
    // At most two reads: the workspace's pool and, for a workspace run, the personal one.
    prefetch: async (userId, workspaceId) => {
      await Promise.all(scopes(workspaceId).map((scope) => pool(userId, scope)));
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
 * A continued conversation is checked against the device it will actually run on: the topic's
 * pin wins over the Agent binding, except when the workspace fixes the target, or the target is
 * `auto` and the pin was only an earlier auto pick. A project-directory continuation routes to
 * its directory's device, which only the run resolves, so it is not gated here.
 */
export const resolveChannelRoutedDevice = async (
  db: LobeChatDatabase,
  { agentId, continuation, executionConfig, userId, workspaceId }: ChannelRoutedDeviceInput,
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

  // A continued conversation stays on the device it ran on, as `turnSetup` routes it: the topic's
  // pin beats the Agent binding unless the workspace fixes the target, or the target is `auto`
  // and the pin was only an earlier auto pick. A project-directory topic routes to its
  // directory's device, which only the run resolves, so it is not gated here.
  if (continuation?.projectWorkingDirectoryId) return;
  const topicPinnedDeviceId =
    !continuation?.groupId || continuation.agentId === agentId
      ? continuation?.metadata?.boundDeviceId
      : undefined;
  const fixedSelection = !!workspaceId && agencyConfig?.executionTargetSelectionPolicy === 'fixed';
  const autoTarget = agencyConfig?.executionTarget === 'auto' || defaultsToAuto(agencyConfig, true);
  const pinnedDeviceId =
    topicPinnedDeviceId &&
    !fixedSelection &&
    (!autoTarget || continuation?.metadata?.deviceBindingPinned === true)
      ? topicPinnedDeviceId
      : undefined;

  const wakeable = await findWakeableManagedDevices(scope, [
    pinnedDeviceId ?? agencyConfig?.boundDeviceId,
  ]);
  if (pinnedDeviceId) {
    if (wakeable.length) return;
    return {
      deviceId: pinnedDeviceId,
      online: await presence.isOnline(userId, pinnedDeviceId, workspaceId),
    };
  }
  const plan = resolveExecutionPlan({
    agencyConfig,
    clientExecutionAvailable: false,
    isHetero: true,
    sandboxExecutionAvailable: supportsCloudHeterogeneousSandbox(heteroType),
    wakeableDeviceIds: wakeable.map((target) => target.deviceId),
  });
  // No presence here: the plan trusts the binding (personal or not), as hetero dispatch does.
  if (plan.kind !== 'device') return;
  return {
    deviceId: plan.deviceId,
    online: await presence.isOnline(userId, plan.deviceId, workspaceId),
  };
};
