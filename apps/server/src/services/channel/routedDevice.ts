import type { LobeChatDatabase } from '@lobechat/database';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import { resolveAgentAgencyConfig } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import type { ChannelRoutedDeviceInput } from '@/database/repositories/channel';
import { agents } from '@/database/schemas';
import { resolveExecutionPlan } from '@/helpers/executionTarget';
import { supportsCloudHeterogeneousSandbox } from '@/server/services/aiAgent/helpers/heteroErrors';
import {
  loadWorkspaceMemberOverrides,
  resolveCanManage,
} from '@/server/services/aiAgent/pipeline/resolveRunAgentConfig';
import { findWakeableManagedDevices } from '@/server/services/deviceGateway/managedDeviceWake';

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
): Promise<string | undefined> => {
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
  return plan.kind === 'device' ? plan.deviceId : undefined;
};
