import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type {
  ChatTopic,
  ChatTopicMetadata,
  ContextSelection,
  ConversationContext,
  ExecAgentAppContext,
  PageSelection,
  RuntimeMentionedAgent,
} from '@lobechat/types';
import { resolveAgentAgencyConfig } from '@lobechat/types';

import { isDesktop } from '@/const/version';
import {
  ensureAgentManagementAccess,
  getRuntimeCanManageAgent,
} from '@/helpers/agentManagementAccess';
import {
  applyTopicDeviceBinding,
  getTopicBoundDeviceId,
  resolveExecutionTarget,
  resolveWorkspaceScoped,
} from '@/helpers/executionTarget';
import type { QueuedFollowUpRequest } from '@/services/aiAgent';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { topicSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';
import { getElectronStoreState } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { toolInterventionSelectors, userProfileSelectors } from '@/store/user/selectors';

import { resolveNewThreadIntent } from '../../dispatch/newThreadIntent';

/**
 * When the agent runs against the local machine, resolve this desktop's
 * own gateway deviceId so it can be passed as the run's routing `deviceId` and
 * `localDeviceId` capability hint. The server then presets `activeDeviceId`,
 * injects `lobe-local-system` into the first LLM payload, and advertises direct
 * image reads only when the routed device still matches this desktop. This
 * skips the extra `activateDevice` round-trip the model is otherwise forced to
 * make whenever more than one device is online (with a single device the
 * server's heuristic already covered it).
 *
 * Gated on the effective runtime mode (`isLocalSystemEnabledById`), which
 * derives from `agencyConfig.executionTarget` — only a `local` target presets
 * the device. Resolving a device for `sandbox` / `none` / `device` targets
 * would wrongly route the run to this machine.
 *
 * Desktop-only and best-effort: any failure falls back to the server-side
 * device-resolution heuristics. We don't pre-check online status here — an
 * offline id simply fails the server's `onlineDevices` guard and stays unrouted.
 */
export const resolveDesktopDeviceHints = async (
  agentId?: string,
  topic?: ChatTopic,
): Promise<{ deviceId?: string; localDeviceId?: string }> => {
  if (!isDesktop || !agentId) return {};

  const agentState = getAgentStoreState();
  // Chat mode means "no execution environment" — never resolve a device, even
  // when the target is `local`. The server enforces this too (it auto-activates
  // a single online device), but skipping the deviceId round-trip here avoids
  // sending an id the server would only discard.
  if (chatConfigByIdSelectors.isChatModeById(agentId)(agentState)) return {};

  const agent = agentByIdSelectors.getAgentById(agentId)(agentState);
  const userState = useUserStore.getState();
  const currentUserId = userProfileSelectors.userId(userState);
  // Author-or-admin, mirroring the picker (`useAgentManagementAccess`) and the
  // server (`isResourceAuthorOrAdmin`) — an admin's own override must survive
  // a `fixed` selection policy just like the author's does. Resolve from the
  // server first when the picker's hook never primed the cache (cold load /
  // direct mention); no-op for authors and cached answers.
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
  // Every workspace caller's override matters — a manager's / private owner's
  // `local` pick also lives in `agentDeviceOverrides` (the shared row must
  // never reference a personal device); `resolveAgentAgencyConfig` decides how
  // it applies per role.
  const deviceOverride = agent?.workspaceId
    ? userState.workspaceUserPreference.agentDeviceOverrides?.[agentId]
    : undefined;
  // A conversation pinned to another machine must not be preset to this one —
  // the server then routes it by the topic's own binding.
  const { agencyConfig, workspaceScoped } = applyTopicDeviceBinding(
    {
      agencyConfig: resolveAgentAgencyConfig(
        agentByIdSelectors.getAgencyConfigById(agentId)(agentState),
        deviceOverride,
        {
          canManage,
          visibility: agent?.visibility,
          workspaceId: agent?.workspaceId,
        },
      ),
      workspaceScoped: resolveWorkspaceScoped(usesWorkspaceMemberSelection, deviceOverride),
    },
    getTopicBoundDeviceId(topic, agentId),
    getElectronStoreState().gatewayDeviceInfo?.deviceId,
  );
  const isPlatformTask = isRemoteHeterogeneousType(agencyConfig?.heterogeneousProvider?.type ?? '');
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: true,
    isHetero: !!agencyConfig?.heterogeneousProvider,
    workspaceScoped,
  });
  // Platform hints are capability claims, not routing overrides. Always send
  // this desktop best-effort and let the server's authoritative execution plan
  // decide whether the effective target may consume it.
  if (!isPlatformTask && executionTarget !== 'local') return {};

  try {
    const info = await gatewayConnectionService.getDeviceInfo();
    if (!info?.deviceId) return {};
    return isPlatformTask
      ? { localDeviceId: info.deviceId }
      : { deviceId: info.deviceId, localDeviceId: info.deviceId };
  } catch {
    return {};
  }
};

/** The approval settings this user runs agents with, read at send time. */
export const resolveUserInterventionConfig = () => ({
  approvalMode: toolInterventionSelectors.approvalMode(useUserStore.getState()),
  allowList: toolInterventionSelectors.allowList(useUserStore.getState()),
});

/**
 * The `appContext` of a Gateway run request: what the server acts on, read
 * from the conversation the send came from.
 */
export const buildExecAppContext = (
  get: () => ChatStore,
  {
    executionContext,
    initialTopicMetadata,
    messageContext = executionContext,
    projectWorkingDirectoryId,
  }: {
    executionContext: ConversationContext;
    /** Seed metadata for the topic this run creates. */
    initialTopicMetadata?: Partial<ChatTopicMetadata>;
    messageContext?: ConversationContext;
    /** The project directory the topic this run creates is bound to. */
    projectWorkingDirectoryId?: string;
  },
): ExecAgentAppContext => {
  const newThread = resolveNewThreadIntent(executionContext);

  return {
    agentDocumentId: executionContext.agentDocumentId,
    ...(messageContext.agentId !== executionContext.agentId && {
      conversationAgentId: messageContext.agentId,
    }),
    defaultTaskAssigneeAgentId: executionContext.defaultTaskAssigneeAgentId,
    documentId: executionContext.documentId,
    // When AgentBuilder runs, context.agentId is the builtin builder agent.
    // The actual editing target is chatStore.activeAgentId (kept in sync by
    // AgentBuilderProvider). Pass it so the server can route tool calls to
    // the correct agent rather than the builder itself.
    ...(executionContext.scope === 'agent_builder' && {
      editingAgentId: get().activeAgentId ?? undefined,
    }),
    // Same shape as `editingAgentId`, for the Group Agent Builder panel on
    // the group Profile page. The builder conversation is keyed by the
    // builtin builder agent (no groupId in its ConversationContext, so the
    // message map key and the group's own chat stay separate), which left
    // the server runtime with no idea which group it was editing.
    // The context value wins, and every surface that opens this scope sets
    // it from its own route/group: it is fixed for the run, so a mid-run
    // navigation cannot make the server stamp a different group than the
    // panel is reading from. The `activeGroupId` fallback is a last resort
    // for a caller that forgot — it is sampled here, AFTER the async
    // preflight above, so it can already be stale by this point.
    ...(executionContext.scope === 'group_agent_builder' && {
      editingGroupId: executionContext.editingGroupId ?? get().activeGroupId,
    }),
    groupId: executionContext.groupId,
    ...(initialTopicMetadata && { initialTopicMetadata }),
    ...(newThread && { newThread }),
    // Forward the group orchestration role so the server can stamp it onto
    // the assistant message metadata. Without this the gateway-created
    // supervisor turn loses its role on the step_start snapshot / refetch
    // and renders as a generic assistant.
    orchestrationRole: executionContext.orchestrationRole,
    ...(projectWorkingDirectoryId && { projectWorkingDirectoryId }),
    scope: executionContext.scope,
    taskId:
      executionContext.viewedTask?.type === 'detail'
        ? executionContext.viewedTask.taskId
        : undefined,
    threadId: executionContext.threadId,
    topicId: executionContext.topicId,
    // Goal-page side conversation: lets the server build the goal
    // overview injection for gateway-run agents (mirrors the client
    // streaming executor).
    viewedGoal: executionContext.viewedGoal,
  };
};

/**
 * The request a composer send queued behind a running Gateway run is started
 * with, should the server start it: the same fields the send would carry, for
 * an existing topic.
 */
export const buildQueuedFollowUpRequest = async (
  get: () => ChatStore,
  params: {
    context: ConversationContext;
    /** Content attached from the conversation, a page or code, kept on the user row. */
    contextSelections?: ContextSelection[];
    fileIds?: string[];
    mentionedAgents?: RuntimeMentionedAgent[];
    message: string;
    pageSelections?: PageSelection[];
    selectedSkillIds?: string[];
    selectedToolIds?: string[];
    trigger?: string;
  },
): Promise<QueuedFollowUpRequest> => {
  const { context } = params;
  const desktopDeviceHints = await resolveDesktopDeviceHints(
    context.agentId,
    context.topicId ? topicSelectors.getTopicById(context.topicId)(get()) : undefined,
  );

  return {
    agentId: context.agentId,
    appContext: buildExecAppContext(get, { executionContext: context }),
    ...desktopDeviceHints,
    contextSelections: params.contextSelections?.length ? params.contextSelections : undefined,
    fileIds: params.fileIds?.length ? params.fileIds : undefined,
    mentionedAgents: params.mentionedAgents,
    pageSelections: params.pageSelections?.length ? params.pageSelections : undefined,
    prompt: params.message,
    selectedSkillIds: params.selectedSkillIds,
    selectedToolIds: params.selectedToolIds,
    trigger: params.trigger,
    userInterventionConfig: resolveUserInterventionConfig(),
  };
};
