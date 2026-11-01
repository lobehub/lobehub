import { LOADING_FLAT } from '@lobechat/const';
import { type HeteroAttachedFileRef } from '@lobechat/heterogeneous-agents';
import type {
  ChatImageItem,
  ChatTopic,
  ConversationContext,
  HeterogeneousProviderConfig,
} from '@lobechat/types';
import { applyTopicModelToHeterogeneousProvider, resolveAgentAgencyConfig } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { t } from 'i18next';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import {
  ensureAgentManagementAccess,
  getRuntimeCanManageAgent,
} from '@/helpers/agentManagementAccess';
import { resolveAgentWorkingDirectory } from '@/helpers/agentWorkingDirectory';
import {
  applyTopicDeviceBinding,
  getTopicBoundDeviceId,
  resolveWorkspaceScoped,
} from '@/helpers/executionTarget';
import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { messageService } from '@/services/message';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import {
  getNativeHeteroSessionBindingKey,
  resolveHeteroResume,
} from '@/store/chat/slices/agentRun/actions/transports/hetero/heteroResume';
import { resolveTopicHeteroPin } from '@/store/chat/slices/topic/selectors';
import { getElectronStoreState } from '@/store/electron';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

/**
 * Hetero (Claude Code / Codex) run helpers shared by the generation actions,
 * continue-after-error and desktop restart recovery. Kept out of `action.ts`
 * so modules the slice imports can use them without a circular import.
 */
/**
 * Settle a regenerate / continue entry's OUTER tracking operation and fire its
 * thin UI completion hook (`onRegenerateComplete` / `onContinueComplete`).
 *
 * Each of these entries owns an outer tracking op distinct from the executor's
 * run op (`${messageKey}/${parentMessageId}`). The unified run lifecycle
 * (`buildRunLifecycle`, inside the executor) already drove the run-level terminal
 * side effects — title / queue drain / notification / complete signal — so the
 * entry only retires its own tracking op and broadcasts the UI hook. Five runtime
 * branches (regenerate × client/gateway/hetero, continue × client/gateway) shared
 * this identical two-line tail; centralized here so they converge on one adapter
 * instead of hand-rolling completion at each call site.
 */
export const settleGenerationEntry = (
  chatStore: ReturnType<typeof useChatStore.getState>,
  operationId: string,
  notify?: () => void,
) => {
  chatStore.completeOperation(operationId);
  notify?.();
};

/**
 * Resolve management access from the server before `getEffectiveAgencyConfig`
 * runs on a cold cache (page reload straight into regenerate/continue) — an
 * admin must not be downgraded to member just because the picker's hook never
 * mounted. No-ops for authors, members-with-resolved-answers, and non-workspace
 * agents; a failed fetch falls back to authorship for this run.
 */
export const ensureEffectiveAgencyAccess = async (agentId: string) => {
  const agentState = getAgentStoreState();
  const agent = agentByIdSelectors.getAgentById(agentId)(agentState);
  await ensureAgentManagementAccess({
    agentId,
    agentUserId: agent?.userId,
    currentUserId: userProfileSelectors.userId(getUserStoreState()),
    visibility: agent?.visibility,
    workspaceId: agent?.workspaceId,
  });
};

/**
 * `topic` keeps the run on the machine that conversation already ran on — see
 * `applyTopicDeviceBinding`. Omit it for agent-level decisions only.
 */
export const getEffectiveAgencyConfig = (agentId: string, topic?: ChatTopic | null) => {
  const agentState = getAgentStoreState();
  const sharedAgencyConfig = agentSelectors.getAgentConfigById(agentId)(agentState)?.agencyConfig;
  const agent = agentByIdSelectors.getAgentById(agentId)(agentState);
  const currentUserId = userProfileSelectors.userId(getUserStoreState());
  // Author-or-admin, mirroring the picker (`useAgentManagementAccess`) and the
  // server (`isResourceAuthorOrAdmin`) — an admin's own override must survive
  // a `fixed` selection policy just like the author's does.
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
    ? getUserStoreState().workspaceUserPreference.agentDeviceOverrides?.[agentId]
    : undefined;

  const { agencyConfig, workspaceScoped } = applyTopicDeviceBinding(
    {
      agencyConfig: resolveAgentAgencyConfig(sharedAgencyConfig, deviceOverride, {
        canManage,
        visibility: agent?.visibility,
        workspaceId: agent?.workspaceId,
      }),
      workspaceScoped: resolveWorkspaceScoped(usesWorkspaceMemberSelection, deviceOverride),
    },
    getTopicBoundDeviceId(topic, agentId),
    getElectronStoreState().gatewayDeviceInfo?.deviceId,
  );

  return {
    agencyConfig,
    /** True workspace membership — stays true for the author, unlike `workspaceScoped`. */
    isWorkspaceAgent: !!agent?.workspaceId,
    workspaceScoped,
  };
};

/**
 * Prompt that resumes an interrupted hetero run instead of restarting it.
 *
 * Neither CLI exposes a "keep going, no new input" primitive — `claude --resume`
 * and `codex exec resume` both require a prompt — so continuing necessarily adds
 * one user turn to the CLI's own transcript. That transcript already holds every
 * completed step (we resume the same session id), so the instruction only has to
 * stop the model from redoing them. Not localized: it is model input, not UI.
 */
/**
 * Where a hetero (Claude Code / Codex) run should execute, and whether it can
 * pick up the topic's existing CLI session.
 *
 * `workingDirectory`: the topic-level pin (set when bound to a project) wins
 * over the agent-level default, so regenerate/continue stay on the same project
 * as the original turn.
 */
export const resolveHeteroRunContext = (
  chatStore: ReturnType<typeof useChatStore.getState>,
  context: ConversationContext,
  agentId: string,
  /** Topic row when the caller already holds it (the paginated store may not). */
  topicOverride?: ChatTopic,
) => {
  const topic =
    topicOverride ??
    (context.topicId ? topicSelectors.getTopicById(context.topicId)(chatStore) : undefined);
  const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
  const agentState = getAgentStoreState();
  const desktopContext = globalAgentContextManager.getContext();
  const { agencyConfig, workspaceScoped } = getEffectiveAgencyConfig(agentId, topic);
  const agentWorkingDirectory = resolveAgentWorkingDirectory({
    agencyConfig,
    currentDeviceId,
    fallback: desktopContext?.desktopPath ?? desktopContext?.homePath,
    legacyAgentWorkingDirectory: agentState.localAgentWorkingDirectoryMap[agentId],
    workspaceScoped,
  });
  const workingDirectory = topic?.metadata?.workingDirectory || agentWorkingDirectory;
  const heterogeneousProvider = agencyConfig?.heterogeneousProvider;
  const providerBinding = heterogeneousProvider?.authMode === 'api';

  // Drops the saved sessionId when its bound cwd disagrees with the current
  // one — without this CC emits "No conversation found with session ID".
  const { cwdChanged, reason, resumeBindingKey, resumeSessionId } = resolveHeteroResume(
    topic?.metadata,
    workingDirectory,
    {
      currentBindingKey:
        heterogeneousProvider && !providerBinding
          ? getNativeHeteroSessionBindingKey(heterogeneousProvider.type)
          : undefined,
      providerBinding,
    },
  );

  return { cwdChanged, reason, resumeBindingKey, resumeSessionId, workingDirectory };
};

/**
 * Branch a hetero (Claude Code / Codex) turn off an existing message.
 *
 * Used by regenerate (parent = user msg, prompt = original user content) and by
 * continue-after-error (parent = the run's chain tail, prompt = a continuation
 * instruction). Pre-creates the assistant row so `executeHeterogeneousAgent` has
 * a stable `assistantMessageId` to stream into, then runs an
 * `execHeterogeneousAgent` op as a child of the caller's parent op so Stop
 * cancels the executor without killing the parent op early.
 */
export const runHeterogeneousFromExistingMessage = async (
  chatStore: ReturnType<typeof useChatStore.getState>,
  params: {
    /** Non-image attachments from the original user message — forwarded to the CLI as download links */
    attachedFiles?: HeteroAttachedFileRef[];
    context: ConversationContext;
    heterogeneousProvider: HeterogeneousProviderConfig;
    /** Image attachments from the original user message — forwarded to the CLI for vision support */
    imageList?: ChatImageItem[];
    parentMessageId: string;
    parentOperationId: string;
    prompt: string;
    /**
     * Replay the topic's on-disk CLI transcript into this row instead of spawning the CLI
     * (desktop restart recovery). The saved session id must resolve, or there is nothing to read.
     */
    replayTranscript?: boolean;
    /** Claude profile root the interrupted run's transcript was written under. */
    replayTranscriptConfigDir?: string;
    /** ISO spawn time of the interrupted run; pins the replay to that run's own turn. */
    replayTranscriptStartedAt?: string;
    /** Topic row when the caller already holds it (not necessarily in the paginated store). */
    topic?: ChatTopic;
    workspaceId?: string | null; // where the caller's flow started; omitted = read now
  },
): Promise<{
  assistantMessageId: string;
  replayComplete?: boolean;
  /** The executor persisted a terminal error instead of throwing. */
  terminalError?: boolean;
}> => {
  const {
    attachedFiles,
    context,
    heterogeneousProvider,
    imageList,
    parentMessageId,
    parentOperationId,
    prompt,
    replayTranscript,
    replayTranscriptConfigDir,
    replayTranscriptStartedAt,
    topic: topicOverride,
  } = params;
  const agentId = context.agentId;
  if (!agentId) throw new Error('agentId is required for heterogeneous agent');
  const workspaceId = 'workspaceId' in params ? params.workspaceId : getActiveWorkspaceId();
  await ensureEffectiveAgencyAccess(agentId);
  const { cwdChanged, reason, resumeBindingKey, resumeSessionId, workingDirectory } =
    resolveHeteroRunContext(chatStore, context, agentId, topicOverride);
  if (replayTranscript && !resumeSessionId) {
    throw new Error('Transcript replay needs a resumable CLI session on the topic');
  }
  if (cwdChanged) toast.info(t('heteroAgent.resumeReset.cwdChanged', { ns: 'chat' }));
  else if (reason === 'binding_changed')
    toast.info(t('heteroAgent.resumeReset.bindingChanged', { ns: 'chat' }));

  const topicPin =
    (topicOverride ? resolveTopicHeteroPin(topicOverride) : undefined) ??
    (context.topicId
      ? topicSelectors.getTopicHeteroPinById(context.topicId)(chatStore)
      : undefined);
  const effectiveHeterogeneousProvider = applyTopicModelToHeterogeneousProvider(
    heterogeneousProvider,
    topicPin,
  );

  const assistantMsg = await messageService.createMessage({
    agentId,
    content: LOADING_FLAT,
    parentId: parentMessageId,
    // External CLIs own model selection; persist only the runtime provider up
    // front. The adapter backfills the actual model later if the CLI reports it.
    provider: heterogeneousProvider.type,
    role: 'assistant',
    threadId: context.threadId ?? undefined,
    topicId: context.topicId ?? undefined,
  });

  // Pull the new row into the store so the loading bubble shows while the executor
  // runs (it only dispatches updates, not creates). Scoped to THIS context: restart
  // recovery runs this for a topic the user may not be looking at, and an unscoped
  // refresh would leave the new row out, orphaning every step chained under it.
  await chatStore.refreshMessages(context);

  const { operationId: heteroOpId } = chatStore.startOperation({
    context,
    label: 'Heterogeneous Agent Execution',
    metadata: {
      heteroAutoRetryAvailable: !replayTranscript,
      heterogeneousType: heterogeneousProvider.type,
    },
    parentOperationId,
    type: 'execHeterogeneousAgent',
  });
  chatStore.associateMessageWithOperation(assistantMsg.id, heteroOpId);

  const { executeHeterogeneousAgent } =
    await import('@/store/chat/slices/agentRun/actions/transports/hetero/heterogeneousAgentExecutor');
  const outcome = await executeHeterogeneousAgent(() => useChatStore.getState(), {
    assistantMessageId: assistantMsg.id,
    attachedFiles: attachedFiles?.length ? attachedFiles : undefined,
    context,
    heterogeneousProvider: effectiveHeterogeneousProvider,
    imageList: imageList?.length ? imageList : undefined,
    message: prompt,
    operationId: heteroOpId,
    ...(replayTranscript
      ? { replayTranscript: true, replayTranscriptConfigDir, replayTranscriptStartedAt }
      : {}),
    resumeBindingKey,
    resumeSessionId,
    workingDirectory,
    workspaceId,
  });

  return {
    assistantMessageId: assistantMsg.id,
    replayComplete: outcome?.replay?.complete,
    terminalError: outcome?.terminalError,
  };
};
