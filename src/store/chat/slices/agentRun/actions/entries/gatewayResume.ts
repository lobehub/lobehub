import { isHeterogeneousAgentModelId } from '@lobechat/const';
import { type ConversationContext, resolveAgentAgencyConfig } from '@lobechat/types';

import {
  ensureAgentManagementAccess,
  getRuntimeCanManageAgent,
} from '@/helpers/agentManagementAccess';
import {
  applyTopicDeviceBinding,
  getTopicBoundDeviceId,
  resolveWorkspaceScoped,
} from '@/helpers/executionTarget';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { topicSelectors } from '@/store/chat/selectors';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import { type ChatStore } from '@/store/chat/store';
import { getElectronStoreState } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { selectRuntimeType } from '../dispatch/agentDispatcher';

/** A persisted server source survives reloads and changes to the agent's execution target. */
export const shouldUseGatewayResume = async (
  context: ConversationContext,
  toolMessageIds: string[],
  get: () => ChatStore,
): Promise<boolean> => {
  const interventions = toolMessageIds.map(
    (id) => dbMessageSelectors.getDbMessageById(id)(get())?.pluginIntervention,
  );
  if (
    interventions.some(
      (source) => source?.runtimeType === 'server' && !!source.operationId && !!source.batchId,
    )
  )
    return true;
  if (interventions.length > 0 && interventions.every((source) => source?.runtimeType === 'client'))
    return false;

  return shouldUseConfiguredGatewayResume(context, get);
};

/** The legacy route applies when this deployment does not handle the persisted source. */
export const shouldUseConfiguredGatewayResume = async (
  context: ConversationContext,
  get: () => ChatStore,
): Promise<boolean> => {
  // A share run only ever executes on the server through the share gateway;
  // the visitor has no local runtime nor access to the owner's agent config.
  if (context.agentShareId) return true;

  const agentId = context.agentId;
  if (!agentId) return false;

  const agentState = getAgentStoreState();
  const agentConfig = agentSelectors.getAgentConfigById(agentId)(agentState);
  const agent = agentByIdSelectors.getAgentById(agentId)(agentState);
  const currentUserId = userProfileSelectors.userId(useUserStore.getState());
  await ensureAgentManagementAccess({
    agentId,
    agentUserId: agent?.userId,
    currentUserId,
    visibility: agent?.visibility,
    workspaceId: agent?.workspaceId,
  });
  const canManage = getRuntimeCanManageAgent({
    agentId,
    agentUserId: agent?.userId,
    currentUserId,
  });
  const usesWorkspaceMemberSelection =
    !!agent?.workspaceId && agent.visibility !== 'private' && !canManage;
  const deviceOverride = agent?.workspaceId
    ? useUserStore.getState().workspaceUserPreference.agentDeviceOverrides?.[agentId]
    : undefined;
  // Same topic machine binding as sendMessage, so the resume takes the path
  // the paused run was dispatched on.
  const { agencyConfig, workspaceScoped } = applyTopicDeviceBinding(
    {
      agencyConfig: resolveAgentAgencyConfig(agentConfig?.agencyConfig, deviceOverride, {
        canManage,
        visibility: agent?.visibility,
        workspaceId: agent?.workspaceId,
      }),
      workspaceScoped: resolveWorkspaceScoped(usesWorkspaceMemberSelection, deviceOverride),
    },
    getTopicBoundDeviceId(
      context.topicId ? topicSelectors.getTopicById(context.topicId)(get()) : undefined,
      agentId,
    ),
    getElectronStoreState().gatewayDeviceInfo?.deviceId,
    { isHetero: isHeterogeneousAgentModelId(agentConfig?.model) },
  );
  const isGatewayMode = get().isGatewayModeEnabled(agentId);
  const heterogeneousProvider =
    agencyConfig?.heterogeneousProvider ??
    (!isGatewayMode && isHeterogeneousAgentModelId(agentConfig?.model)
      ? { type: agentConfig.model }
      : undefined);

  return (
    selectRuntimeType({
      boundDeviceId: agencyConfig?.boundDeviceId,
      executionTarget: agencyConfig?.executionTarget,
      heterogeneousProvider,
      isGatewayMode,
      isWorkspaceAgent: !!agent?.workspaceId,
      workspaceScoped,
    }) === 'gateway'
  );
};
