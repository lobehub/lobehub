import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import { HETERO_CONTINUE_PROMPT, LOADING_FLAT } from '@lobechat/const';
import type {
  ChatImageItem,
  ChatTTS,
  ConversationContext,
  HeterogeneousProviderConfig,
} from '@lobechat/types';
import { resolveAgencyConfig } from '@lobechat/types';
import { t } from 'i18next';
import { type StateCreator } from 'zustand';

import { message as antdMessage } from '@/components/AntdStaticMethods';
import { MESSAGE_CANCEL_FLAT } from '@/const/index';
import { saveDraft } from '@/features/ChatInput/draftStorage';
import { isHeterogeneousAgentStatusGuideError } from '@/features/Conversation/Error/heterogeneous';
import { resolveAgentWorkingDirectory } from '@/helpers/agentWorkingDirectory';
import { resolveWorkspaceScoped } from '@/helpers/executionTarget';
import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { messageService } from '@/services/message';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { selectRuntimeType } from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';
import {
  parseMentionedAgentsFromEditorData,
  parseSelectedSkillsFromEditorData,
  parseSelectedToolsFromEditorData,
} from '@/store/chat/slices/agentRun/actions/entries/commandBus';
import { resolveHeteroResume } from '@/store/chat/slices/agentRun/actions/transports/hetero/heteroResume';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { INPUT_LOADING_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import {
  mergeAgentRuntimeInitialContexts,
  resolveActiveTopicDocumentInitialContext,
} from '@/store/chat/utils/activeTopicDocumentContext';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getElectronStoreState } from '@/store/electron';
import { getUserStoreState } from '@/store/user';

import { type Store as ConversationStore } from '../../action';
import { MAX_HETERO_AUTO_RETRIES } from './heteroRetryConfig';

const buildRetryInitialContext = (editorData: Record<string, any> | null | undefined) => {
  const normalizedEditorData = editorData ?? undefined;
  const selectedSkills = parseSelectedSkillsFromEditorData(normalizedEditorData);
  const selectedTools = parseSelectedToolsFromEditorData(normalizedEditorData);
  const mentionedAgents = parseMentionedAgentsFromEditorData(normalizedEditorData);

  const effectiveSelectedTools =
    mentionedAgents.length > 0 &&
    !selectedTools.some((tool) => tool.identifier === AgentManagementIdentifier)
      ? [...selectedTools, { identifier: AgentManagementIdentifier, name: 'Agent Management' }]
      : selectedTools;

  const hasInitialContext =
    effectiveSelectedTools.length > 0 || selectedSkills.length > 0 || mentionedAgents.length > 0;

  if (!hasInitialContext) return undefined;

  return {
    initialContext: {
      ...(selectedSkills.length > 0 ? { selectedSkills } : undefined),
      ...(effectiveSelectedTools.length > 0
        ? { selectedTools: effectiveSelectedTools }
        : undefined),
      ...(mentionedAgents.length > 0 ? { mentionedAgents } : undefined),
    },
    phase: 'init' as const,
  };
};

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
const settleGenerationEntry = (
  chatStore: ReturnType<typeof useChatStore.getState>,
  operationId: string,
  notify?: () => void,
) => {
  chatStore.completeOperation(operationId);
  notify?.();
};

const getEffectiveAgencyConfig = (agentId: string) => {
  const agentState = getAgentStoreState();
  const sharedAgencyConfig = agentSelectors.getAgentConfigById(agentId)(agentState)?.agencyConfig;
  const isWorkspaceAgent = agentByIdSelectors.isWorkspaceAgentById(agentId)(agentState);
  const deviceOverride = isWorkspaceAgent
    ? getUserStoreState().workspaceUserPreference.agentDeviceOverrides?.[agentId]
    : undefined;

  return {
    agencyConfig: resolveAgencyConfig(sharedAgencyConfig, deviceOverride),
    workspaceScoped: resolveWorkspaceScoped(isWorkspaceAgent, deviceOverride),
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
const resolveHeteroRunContext = (
  chatStore: ReturnType<typeof useChatStore.getState>,
  context: ConversationContext,
  agentId: string,
) => {
  const topic = context.topicId
    ? topicSelectors.getTopicById(context.topicId)(chatStore)
    : undefined;
  const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
  const agentState = getAgentStoreState();
  const desktopContext = globalAgentContextManager.getContext();
  const { agencyConfig, workspaceScoped } = getEffectiveAgencyConfig(agentId);
  const agentWorkingDirectory = resolveAgentWorkingDirectory({
    agencyConfig,
    currentDeviceId,
    fallback: desktopContext?.desktopPath ?? desktopContext?.homePath,
    legacyAgentWorkingDirectory: agentState.localAgentWorkingDirectoryMap[agentId],
    workspaceScoped,
  });
  const workingDirectory = topic?.metadata?.workingDirectory || agentWorkingDirectory;

  // Drops the saved sessionId when its bound cwd disagrees with the current
  // one — without this CC emits "No conversation found with session ID".
  const { cwdChanged, resumeSessionId } = resolveHeteroResume(topic?.metadata, workingDirectory);

  return { cwdChanged, resumeSessionId, workingDirectory };
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
const runHeterogeneousFromExistingMessage = async (
  chatStore: ReturnType<typeof useChatStore.getState>,
  params: {
    context: ConversationContext;
    heterogeneousProvider: HeterogeneousProviderConfig;
    /** Image attachments from the original user message — forwarded to the CLI for vision support */
    imageList?: ChatImageItem[];
    parentMessageId: string;
    parentOperationId: string;
    prompt: string;
  },
): Promise<string> => {
  const { context, heterogeneousProvider, imageList, parentMessageId, parentOperationId, prompt } =
    params;
  const agentId = context.agentId;
  if (!agentId) throw new Error('agentId is required for heterogeneous agent');

  const { cwdChanged, resumeSessionId, workingDirectory } = resolveHeteroRunContext(
    chatStore,
    context,
    agentId,
  );
  if (cwdChanged) antdMessage.info(t('heteroAgent.resumeReset.cwdChanged', { ns: 'chat' }));

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

  // Pull the new row into the store so the loading bubble is visible while
  // the executor runs (the executor only dispatches updates, not creates).
  await chatStore.refreshMessages();

  if (context.topicId) chatStore.internal_updateTopicLoading(context.topicId, true);

  const { operationId: heteroOpId } = chatStore.startOperation({
    context,
    label: 'Heterogeneous Agent Execution',
    metadata: { heterogeneousType: heterogeneousProvider.type },
    parentOperationId,
    type: 'execHeterogeneousAgent',
  });
  chatStore.associateMessageWithOperation(assistantMsg.id, heteroOpId);

  try {
    const { executeHeterogeneousAgent } =
      await import('@/store/chat/slices/agentRun/actions/transports/hetero/heterogeneousAgentExecutor');
    await executeHeterogeneousAgent(() => useChatStore.getState(), {
      assistantMessageId: assistantMsg.id,
      context,
      heterogeneousProvider,
      imageList: imageList?.length ? imageList : undefined,
      message: prompt,
      operationId: heteroOpId,
      resumeSessionId,
      workingDirectory,
    });
  } finally {
    if (context.topicId)
      useChatStore.getState().internal_updateTopicLoading(context.topicId, false);
  }

  return assistantMsg.id;
};

export interface HeteroContinuationScheduleParams {
  failedAssistantMessageId: string;
  rateLimit?: {
    rateLimitType?: string;
    resetsAt?: number;
  };
}

/**
 * Generation Actions
 *
 * Handles generation control (stop, cancel, regenerate, continue)
 */
export interface GenerationAction {
  cancelHeteroContinuation: () => Promise<void>;
  /**
   * Cancel a specific operation
   */
  cancelOperation: (operationId: string, reason?: string) => void;
  /**
   * Cancel a user-deferred run ("send this in 3 hours") before it fires.
   *
   * Distinct from {@link cancelHeteroContinuation}, which parks the topic at
   * `failed` because it is cancelling the retry of a turn that already failed.
   * Nothing has failed here — the topic drops back to `active` and keeps the
   * pending user message, so the user can send it now or delete the topic.
   */
  cancelScheduledRun: () => Promise<void>;

  /**
   * Clear TTS for a message
   * @deprecated Temporary bridge to ChatStore
   */
  clearMessageTTS: (messageId: string) => Promise<void>;

  /**
   * Clear all operations
   */
  clearOperations: () => void;

  /**
   * Clear translate for a message
   * @deprecated Temporary bridge to ChatStore
   */
  clearTranslate: (messageId: string) => Promise<void>;

  /**
   * Continue generation from a message
   */
  continueGeneration: (displayMessageId: string) => Promise<void>;

  /**
   * Continue generation from a specific block
   */
  continueGenerationMessage: (displayMessageId: string, messageId: string) => Promise<void>;

  /**
   * Resume a heterogeneous (CC / Codex) run whose LAST step died on a status
   * error (rate limit, upstream overload, ...), keeping every step that
   * succeeded before it. Falls back to `delAndRegenerateMessage` when there is
   * nothing to keep or no CLI session left to resume.
   *
   * @param groupMessageId - the assistantGroup id of the failed run
   */
  continueHeteroAfterError: (groupMessageId: string) => Promise<void>;

  /**
   * Delete and regenerate a message
   */
  delAndRegenerateMessage: (messageId: string) => Promise<void>;

  /**
   * Delete and resend a thread message
   */
  delAndResendThreadMessage: (messageId: string) => Promise<void>;

  /**
   * Start (or reuse) the long-lived `autoRetryPending` operation for a turn so
   * the input/turn stays in its loading state during the auto-retry countdown.
   * Idempotent: reuses an existing still-running wait op for the scope.
   */
  internal_beginHeteroOverloadWait: (scopeId: string) => void;

  /**
   * End the `autoRetryPending` operation for a turn (the countdown handed off to
   * a real retry attempt, or the sequence ended).
   */
  internal_endHeteroOverloadWait: (scopeId: string) => void;

  /**
   * Whether the turn's `autoRetryPending` operation was cancelled out from under
   * us (e.g. the global Stop button) — the scheduled retry must then abort.
   */
  isHeteroOverloadWaitAborted: (scopeId: string) => boolean;

  /**
   * Pin the heterogeneous "overloaded" auto-retry counter past the cap so
   * scheduling stops and the guide falls back to manual retry (used by the
   * user's "cancel auto-retry" action).
   */
  markHeteroOverloadRetryExhausted: (scopeId: string) => void;

  /**
   * Open thread creator
   * @deprecated Temporary bridge to ChatStore
   */
  openThreadCreator: (messageId: string) => void;

  /**
   * Increment the heterogeneous "overloaded" auto-retry counter for a turn,
   * keyed by its parent user message id.
   */
  recordHeteroOverloadRetry: (scopeId: string) => void;

  /**
   * Regenerate an assistant message
   */
  regenerateAssistantMessage: (messageId: string) => Promise<void>;

  /**
   * Regenerate a user message
   */
  regenerateUserMessage: (messageId: string) => Promise<void>;

  /**
   * Re-invoke a tool message
   * @deprecated Temporary bridge to ChatStore
   */
  reInvokeToolMessage: (messageId: string) => Promise<void>;

  /**
   * Resend a thread message
   */
  resendThreadMessage: (messageId: string) => Promise<void>;

  /**
   * Clear the heterogeneous "overloaded" auto-retry counter for a turn so a
   * fresh auto-retry budget is granted (used when a human retries manually).
   */
  resetHeteroOverloadRetry: (scopeId: string) => void;

  /**
   * Save TTS metadata for a message
   * @deprecated Temporary bridge to ChatStore
   */
  saveMessageTTS: (messageId: string, data: Required<ChatTTS>) => Promise<void>;

  scheduleHeteroContinuation: (params: HeteroContinuationScheduleParams) => Promise<void>;

  /**
   * Start TTS for a message
   * @deprecated Temporary bridge to ChatStore
   */
  startMessageTTS: (messageId: string) => void;

  /**
   * Stop current generation
   */
  stopGenerating: () => void;

  /**
   * Translate a message
   * @deprecated Temporary bridge to ChatStore
   */
  translateMessage: (messageId: string, targetLang: string) => Promise<void>;
}

export const generationSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  GenerationAction
> = (set, get) => ({
  cancelHeteroContinuation: async () => {
    const topicId = get().context.topicId;
    if (!topicId) return;

    const chatStore = useChatStore.getState();
    await chatStore.updateTopicStatus({ status: 'failed', topicId });
    await chatStore.updateTopicMetadata(topicId, { scheduledRun: null });
  },
  cancelScheduledRun: async () => {
    const { context, dbMessages, editor } = get();
    const topicId = context.topicId;
    if (!topicId) return;

    const chatStore = useChatStore.getState();
    const topic = topicSelectors.getTopicById(topicId)(chatStore);
    const scheduledRun = topic?.metadata?.scheduledRun;
    const userMessageId =
      scheduledRun?.kind === 'delayed_start' ? scheduledRun.userMessageId : undefined;
    // Capture the text before anything is deleted — cancelling a scheduled send
    // hands the user's words back to the composer rather than discarding them.
    const pendingContent = userMessageId
      ? dbMessages.find((message) => message.id === userMessageId)?.content
      : undefined;

    await chatStore.updateTopicStatus({ status: 'active', topicId });
    await chatStore.updateTopicMetadata(topicId, { scheduledRun: null });

    // A `delayed_start` topic exists solely to hold the deferred turn, so once
    // that turn is cancelled the topic has nothing left in it — drop it instead
    // of stranding an empty row in the sidebar. Guarded on the message count so
    // a topic that somehow holds other turns keeps them and only loses the
    // pending one.
    const isOnlyMessage = dbMessages.length === 1 && dbMessages[0]?.id === userMessageId;

    if (pendingContent && editor) {
      // Load the text into the live editor first — that is also how we get it in
      // the editor's own JSON shape, which is the only thing a draft can carry.
      editor.setDocument('markdown', pendingContent);

      if (isOnlyMessage) {
        // Deleting the topic navigates back to the agent's compose surface, which
        // mounts a DIFFERENT ChatInput — anything written to the editor we hold
        // here dies with it. Stash the text as that surface's draft instead; the
        // new composer restores it on mount. (Re-reading `get().editor` after the
        // switch doesn't work either: the new instance hasn't registered yet.)
        saveDraft(messageMapKey({ ...context, topicId: null }), editor.getJSONState());
      } else {
        editor.focus();
      }
    }

    if (isOnlyMessage) await chatStore.removeTopic(topicId);
    else if (userMessageId) await get().deleteMessage(userMessageId);
  },
  cancelOperation: (operationId: string, reason?: string) => {
    const state = get();
    const { hooks } = state;

    const chatStore = useChatStore.getState();
    chatStore.cancelOperation(operationId, reason || 'User cancelled');

    // ===== Hook: onOperationCancelled =====
    if (hooks.onOperationCancelled) {
      hooks.onOperationCancelled(operationId);
    }
  },

  clearOperations: () => {
    // Operations are now managed by ChatStore, nothing to clear locally
  },

  clearMessageTTS: async (messageId: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.clearMessageTTS(messageId);
  },

  clearTranslate: async (messageId: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.clearTranslate(messageId);
  },

  continueGeneration: async (groupMessageId: string) => {
    const { displayMessages } = get();

    // Find the message
    const message = displayMessages.find((m) => m.id === groupMessageId);
    if (!message) return;

    // If it's an assistantGroup, find the last child's ID as blockId
    let lastBlockId: string | undefined;

    if (message.role !== 'assistantGroup') return;

    if (message.children && message.children.length > 0) {
      const lastChild = message.children.at(-1);

      if (lastChild) {
        lastBlockId = lastChild.id;
      }
    }

    if (!lastBlockId) return;

    await get().continueGenerationMessage(groupMessageId, lastBlockId);
  },

  continueGenerationMessage: async (displayMessageId: string, dbMessageId: string) => {
    const { context, displayMessages, hooks } = get();
    const chatStore = useChatStore.getState();

    // Find the message (blockId refers to the assistant message to continue from)
    const message = displayMessages.find((m) => m.id === displayMessageId);
    if (!message) return;

    // ===== Hook: onBeforeContinue =====
    if (hooks.onBeforeContinue) {
      const shouldProceed = await hooks.onBeforeContinue(displayMessageId);
      if (shouldProceed === false) return;
    }

    const { agencyConfig, workspaceScoped } = getEffectiveAgencyConfig(context.agentId);
    const runtimeType = selectRuntimeType({
      boundDeviceId: agencyConfig?.boundDeviceId,
      executionTarget: agencyConfig?.executionTarget,
      heterogeneousProvider: agencyConfig?.heterogeneousProvider,
      isGatewayMode: chatStore.isGatewayModeEnabled(context.agentId),
      isWorkspaceAgent: workspaceScoped,
    });

    // Hetero CLIs (CC / Codex) have no "continue a cut-off response" primitive
    // — each prompt is a fresh user turn from their perspective. Bail out
    // rather than synthesize a fake "please continue" turn that would pollute
    // the session and confuse the model. The button is a no-op in this mode.
    if (runtimeType === 'hetero') return;

    // Create continue operation with ConversationStore context (includes groupId)
    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId: displayMessageId },
      type: 'continue',
    });

    try {
      // ── Gateway mode: branch a server-side run from the cut-off message ──
      // `parentMessageId` triggers `resume: true` on the router, so the server
      // skips user-message creation and continues from the existing chain.
      // Empty prompt is intentional and matches the approve/reject resume path.
      if (runtimeType === 'gateway') {
        await chatStore.executeGatewayAgent({
          context,
          message: '',
          onComplete: () =>
            settleGenerationEntry(chatStore, operationId, () =>
              hooks.onContinueComplete?.(displayMessageId),
            ),
          parentMessageId: dbMessageId,
        });
        return;
      }

      // ── Client mode: run agent locally ──
      await chatStore.executeClientAgent({
        context,
        messages: displayMessages,
        parentMessageId: dbMessageId,
        parentMessageType: message.role as 'assistant' | 'tool' | 'user',
        parentOperationId: operationId,
      });

      settleGenerationEntry(chatStore, operationId, () =>
        hooks.onContinueComplete?.(displayMessageId),
      );
    } catch (error) {
      chatStore.failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'ContinueError',
      });
      throw error;
    }
  },

  continueHeteroAfterError: async (groupMessageId: string) => {
    const { context, dbMessages, displayMessages, hooks } = get();
    const chatStore = useChatStore.getState();

    const group = displayMessages.find((m) => m.id === groupMessageId);
    const erroredStep = group?.children?.at(-1);
    if (!erroredStep) return;

    // Only the dedicated hetero status errors (rate limit, upstream overload,
    // auth, missing CLI) mean "the run died but its session survives". A generic
    // tool/provider error on a grouped reply is not resumable this way.
    if (!isHeterogeneousAgentStatusGuideError(erroredStep.error?.body)) return;

    const { agencyConfig, workspaceScoped } = getEffectiveAgencyConfig(context.agentId);
    const heterogeneousProvider = agencyConfig?.heterogeneousProvider;
    const runtimeType = selectRuntimeType({
      boundDeviceId: agencyConfig?.boundDeviceId,
      executionTarget: agencyConfig?.executionTarget,
      heterogeneousProvider,
      isGatewayMode: chatStore.isGatewayModeEnabled(context.agentId),
      isWorkspaceAgent: workspaceScoped,
    });
    const agentId = context.agentId;

    const resumeSessionId = agentId
      ? resolveHeteroRunContext(chatStore, context, agentId).resumeSessionId
      : undefined;

    // Nothing to continue from: the failed step IS the group's head (the run
    // died before producing a second step, so no work was preserved anyway), or
    // the topic has no CLI session left to resume (never started, or its cwd
    // moved). Both degrade to replacing the whole turn.
    const hasEarlierSteps = erroredStep.id !== groupMessageId;
    if (
      runtimeType !== 'hetero' ||
      !heterogeneousProvider ||
      !hasEarlierSteps ||
      !resumeSessionId
    ) {
      await get().delAndRegenerateMessage(groupMessageId);
      return;
    }

    // A step that streamed content or landed tool calls before dying is worth
    // keeping: clear its error and chain the continuation onto it. A step that
    // carries nothing but the error (its content echo was suppressed) would
    // render as an empty block, so drop it and chain onto its parent instead.
    const hasSalvageableWork =
      !!erroredStep.tools?.length ||
      (!!erroredStep.content && erroredStep.content !== LOADING_FLAT);

    const continueParentId = hasSalvageableWork
      ? erroredStep.id
      : dbMessages.find((m) => m.id === erroredStep.id)?.parentId;
    if (!continueParentId) {
      await get().delAndRegenerateMessage(groupMessageId);
      return;
    }

    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId: groupMessageId },
      type: 'regenerate',
    });

    try {
      if (hasSalvageableWork) await get().updateMessageError(erroredStep.id, null);
      else await get().deleteAssistantMessage(erroredStep.id);

      // Chaining off the run's tail (not off the user message) keeps the new
      // steps inside the same assistantGroup, so the bubble grows instead of
      // being replaced.
      await runHeterogeneousFromExistingMessage(chatStore, {
        context,
        heterogeneousProvider,
        parentMessageId: continueParentId,
        parentOperationId: operationId,
        prompt: HETERO_CONTINUE_PROMPT,
      });

      settleGenerationEntry(chatStore, operationId, () =>
        hooks.onRegenerateComplete?.(groupMessageId),
      );
    } catch (error) {
      // Settle the wrapper op on failure — see delAndRegenerateMessage.
      chatStore.failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'RegenerateError',
      });
      throw error;
    }
  },

  scheduleHeteroContinuation: async ({ failedAssistantMessageId, rateLimit }) => {
    const { context, dbMessages } = get();
    const topicId = context.topicId;
    if (!topicId) return;

    const messagesById = new Map(dbMessages.map((message) => [message.id, message]));
    let ancestor = messagesById.get(failedAssistantMessageId);
    while (ancestor?.parentId && ancestor.role !== 'user') {
      ancestor = messagesById.get(ancestor.parentId);
    }
    const userMessageId = ancestor?.role === 'user' ? ancestor.id : undefined;
    if (!userMessageId) return;

    const chatStore = useChatStore.getState();
    const topic = topicSelectors.getTopicById(topicId)(chatStore);
    const nowDate = new Date();
    const now = nowDate.toISOString();
    // The rate-limit reset is the "not before" gate. Absent (some providers don't
    // report one) means "retry on the next tick" — never "already due", which is
    // why `runAt` is always written.
    const runAt = rateLimit?.resetsAt
      ? new Date(rateLimit.resetsAt * 1000).toISOString()
      : nowDate.toISOString();

    await chatStore.updateTopicMetadata(topicId, {
      scheduledRun: {
        createdAt: now,
        failedAssistantMessageId,
        kind: 'resume_after_rate_limit',
        rateLimit,
        resume: {
          sessionId: topic?.metadata?.heteroSessionId,
          workingDirectory: topic?.metadata?.workingDirectory,
        },
        runAt,
        source: 'heterogeneous_agent',
        updatedAt: now,
        userMessageId,
      },
    });
    await chatStore.updateTopicStatus({ status: 'scheduled', topicId });
  },

  delAndRegenerateMessage: async (messageId: string) => {
    const { context, displayMessages } = get();
    const chatStore = useChatStore.getState();

    // Find the assistant message and get parent user message ID before deletion
    // This is needed because after deletion, we can't find the parent anymore
    const currentMessage = displayMessages.find((c) => c.id === messageId);
    if (!currentMessage) return;

    const userId = currentMessage.parentId;
    if (!userId) return;

    // Create operation to track context (use 'regenerate' type since this is a regenerate action)
    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId },
      type: 'regenerate',
    });

    try {
      // IMPORTANT: Delete first, then regenerate
      // If we regenerate first, it switches to a new branch, causing the original
      // message to no longer appear in displayMessages. Then deleteMessage cannot
      // find the message and fails silently.
      await chatStore.deleteMessage(messageId, { operationId });

      // NOTE: intentionally do NOT bail on Stop here. The old assistant message is
      // already deleted above; returning early would leave the turn deleted with
      // nothing regenerated — destructive data loss. Stop pressed in this
      // sub-second window is best-effort; complete the retry atomically and honor
      // the next Stop (on the fresh run) normally.
      await get().regenerateUserMessage(userId);
      chatStore.completeOperation(operationId);
    } catch (error) {
      // Settle the wrapper op on failure. `regenerate` now drives input-loading +
      // queue-blocking, so a never-settled op would wedge the input in loading
      // forever and queue every future send behind it.
      chatStore.failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'RegenerateError',
      });
      throw error;
    }
  },

  delAndResendThreadMessage: async (messageId: string) => {
    const { context } = get();
    const chatStore = useChatStore.getState();

    // Create operation to track context (use 'regenerate' type since resend is essentially regenerate)
    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId },
      type: 'regenerate',
    });

    try {
      // Resend then delete
      await get().resendThreadMessage(messageId);

      // Honor a Stop pressed during the resend: the whitelisted outer op gets
      // cancelled by stopGenerating, so skip the follow-up delete and leave the
      // original message intact rather than mutating state after Stop. The
      // cancelled op is no longer `running`, so it stops driving loading — no
      // need to settle it here.
      const outerOp = operationSelectors.getOperationById(operationId)(useChatStore.getState());
      if (outerOp && outerOp.status !== 'running') return;

      await chatStore.deleteMessage(messageId, { operationId });
      chatStore.completeOperation(operationId);
    } catch (error) {
      // Settle the wrapper op on failure — see delAndRegenerateMessage.
      chatStore.failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'RegenerateError',
      });
      throw error;
    }
  },

  openThreadCreator: (messageId: string) => {
    const chatStore = useChatStore.getState();
    chatStore.openThreadCreator(messageId);
  },

  reInvokeToolMessage: async (messageId: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.reInvokeToolMessage(messageId);
  },

  internal_beginHeteroOverloadWait: (scopeId: string) => {
    const chatStore = useChatStore.getState();
    const existingId = get().heteroOverloadWaitOpIds[scopeId];
    // Reuse an existing wait op that's still running (effect re-runs / remounts).
    if (existingId && chatStore.operations[existingId]?.status === 'running') return;

    const { context } = get();
    const { operationId } = chatStore.startOperation({
      context: {
        agentId: context.agentId,
        messageId: scopeId,
        threadId: context.threadId ?? undefined,
        topicId: context.topicId ?? undefined,
      },
      label: 'Auto-retry pending',
      type: 'autoRetryPending',
    });
    set(
      { heteroOverloadWaitOpIds: { ...get().heteroOverloadWaitOpIds, [scopeId]: operationId } },
      false,
      'internal_beginHeteroOverloadWait',
    );
  },

  internal_endHeteroOverloadWait: (scopeId: string) => {
    const opId = get().heteroOverloadWaitOpIds[scopeId];
    if (!opId) return;
    const chatStore = useChatStore.getState();
    // Only complete a still-running op; if it was already cancelled (Stop), leave
    // its terminal state intact.
    if (chatStore.operations[opId]?.status === 'running') chatStore.completeOperation(opId);
    const next = { ...get().heteroOverloadWaitOpIds };
    delete next[scopeId];
    set({ heteroOverloadWaitOpIds: next }, false, 'internal_endHeteroOverloadWait');
  },

  isHeteroOverloadWaitAborted: (scopeId: string) => {
    const opId = get().heteroOverloadWaitOpIds[scopeId];
    // A missing id means the wait was already torn down (cancel/Stop cleanup
    // can race the timer near the deadline) — treat that as aborted so a stale
    // queued retry doesn't run after the user asked to stop.
    if (!opId) return true;
    const op = useChatStore.getState().operations[opId];
    return !op || op.status !== 'running';
  },

  markHeteroOverloadRetryExhausted: (scopeId: string) => {
    set(
      {
        heteroOverloadRetryAttempts: {
          ...get().heteroOverloadRetryAttempts,
          [scopeId]: MAX_HETERO_AUTO_RETRIES,
        },
      },
      false,
      'markHeteroOverloadRetryExhausted',
    );
  },

  recordHeteroOverloadRetry: (scopeId: string) => {
    const current = get().heteroOverloadRetryAttempts;
    set(
      {
        heteroOverloadRetryAttempts: { ...current, [scopeId]: (current[scopeId] ?? 0) + 1 },
      },
      false,
      'recordHeteroOverloadRetry',
    );
  },

  resetHeteroOverloadRetry: (scopeId: string) => {
    const current = get().heteroOverloadRetryAttempts;
    if (!(scopeId in current)) return;
    const next = { ...current };
    delete next[scopeId];
    set({ heteroOverloadRetryAttempts: next }, false, 'resetHeteroOverloadRetry');
  },

  regenerateAssistantMessage: async (messageId: string) => {
    const { displayMessages } = get();

    // Find the assistant message
    const currentIndex = displayMessages.findIndex((c) => c.id === messageId);
    const currentMessage = displayMessages[currentIndex];

    if (!currentMessage) return;

    // Find the parent user message
    const userId = currentMessage.parentId;
    if (!userId) return;

    // Delegate to regenerateUserMessage with the parent user message
    await get().regenerateUserMessage(userId);
  },

  regenerateUserMessage: async (messageId: string) => {
    const { context, displayMessages, hooks } = get();
    const chatStore = useChatStore.getState();

    // Check if already regenerating via operation system
    const isRegenerating = operationSelectors.isMessageProcessing(messageId)(chatStore);
    if (isRegenerating) return;

    // Find the message in current conversation messages
    const currentIndex = displayMessages.findIndex((c) => c.id === messageId);
    const item = displayMessages[currentIndex];
    if (!item) return;
    // Start the interim regenerate op BEFORE the async preflight below
    // (document-context resolve + onBeforeRegenerate hook). In page / bound-
    // document contexts those reads are real round trips, so creating the op
    // afterwards would leave the input/Stop state dead during exactly the
    // pre-generation window the INPUT_LOADING_OPERATION_TYPES whitelist covers.
    // Complete it if any preflight guard bails out before generation starts.
    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId },
      type: 'regenerate',
    });

    try {
      const initialContext = mergeAgentRuntimeInitialContexts(
        await resolveActiveTopicDocumentInitialContext(context),
        buildRetryInitialContext(item.editorData),
      );

      // Get context messages up to and including the target message
      const contextMessages = displayMessages.slice(0, currentIndex + 1);
      if (contextMessages.length <= 0) {
        chatStore.completeOperation(operationId);
        return;
      }

      // ===== Hook: onBeforeRegenerate =====
      if (hooks.onBeforeRegenerate) {
        const shouldProceed = await hooks.onBeforeRegenerate(messageId);
        if (shouldProceed === false) {
          chatStore.completeOperation(operationId);
          return;
        }
      }

      // If the user hit Stop during the preflight awaits above, stopGenerating has
      // already cancelled this interim op (cancelOperation flips its status but
      // keeps the record). Bail out before switching branches or starting a run —
      // otherwise the Stop is swallowed and a new assistant turn starts anyway. No
      // child runtime exists yet, so cancelOperation had nothing to propagate to;
      // this is the only place that can honour the Stop.
      const preflightOp = operationSelectors.getOperationById(operationId)(useChatStore.getState());
      if (preflightOp && preflightOp.status !== 'running') return;

      // Calculate next branch index by counting children of this user message
      // We need to count how many assistant messages have this user message as parent
      const { dbMessages } = get();
      const childrenCount = dbMessages.filter((m) => m.parentId === messageId).length;
      // New branch index = current children count (since index is 0-based)
      const nextBranchIndex = childrenCount;

      // Switch to the new branch so the UI shows the incoming response immediately
      await chatStore.switchMessageBranch(messageId, nextBranchIndex, {
        operationId,
      });

      // Re-check after switchMessageBranch: it is another await round-trip, so a
      // Stop pressed during it lands *after* the preflight guard above. Bail
      // before starting the runtime so the Stop isn't swallowed. The branch is
      // already switched, which is harmless — no assistant turn has started yet.
      const postSwitchOp = operationSelectors.getOperationById(operationId)(
        useChatStore.getState(),
      );
      if (postSwitchOp && postSwitchOp.status !== 'running') return;

      const { agencyConfig, workspaceScoped } = getEffectiveAgencyConfig(context.agentId);
      const heterogeneousProvider = agencyConfig?.heterogeneousProvider;
      const runtimeType = selectRuntimeType({
        boundDeviceId: agencyConfig?.boundDeviceId,
        executionTarget: agencyConfig?.executionTarget,
        heterogeneousProvider,
        isGatewayMode: chatStore.isGatewayModeEnabled(context.agentId),
        isWorkspaceAgent: workspaceScoped,
      });

      // ── Gateway mode: trigger server-side regeneration ──
      if (runtimeType === 'gateway') {
        // Keep the regenerate operation running until the gateway session completes,
        // so isMessageRegenerating stays true and duplicate clicks are blocked.
        await chatStore.executeGatewayAgent({
          context,
          message: item.content,
          onComplete: () =>
            settleGenerationEntry(chatStore, operationId, () =>
              hooks.onRegenerateComplete?.(messageId),
            ),
          parentMessageId: messageId,
        });

        return;
      }

      // ── Hetero mode: re-run the local CLI against the original user prompt ──
      // Creates a fresh assistant row branched off the existing user message so
      // the CC / Codex turn replaces the previous attempt without rewriting
      // history, and resumes the same session id (when the cwd still matches)
      // so prior context is preserved.
      if (runtimeType === 'hetero' && heterogeneousProvider) {
        await runHeterogeneousFromExistingMessage(chatStore, {
          context,
          heterogeneousProvider,
          // Forward the original user message's images so regenerate re-runs
          // the CLI with the same vision input as the first attempt. Without
          // this, regenerate silently drops attachments (the send path reads
          // imageList off the persisted user message; this path must too).
          imageList: item.imageList,
          parentMessageId: messageId,
          parentOperationId: operationId,
          prompt: item.content,
        });
        settleGenerationEntry(chatStore, operationId, () =>
          hooks.onRegenerateComplete?.(messageId),
        );
        return;
      }

      // ── Client mode: run agent locally ──
      // Execute agent runtime with full context from ConversationStore
      await chatStore.executeClientAgent({
        context,
        initialContext,
        messages: contextMessages,
        parentMessageId: messageId,
        parentMessageType: 'user',
        parentOperationId: operationId,
      });

      settleGenerationEntry(chatStore, operationId, () => hooks.onRegenerateComplete?.(messageId));
    } catch (error) {
      chatStore.failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'RegenerateError',
      });
      throw error;
    }
  },

  resendThreadMessage: async (messageId: string) => {
    // Resend is essentially regenerating the user message in thread context
    await get().regenerateUserMessage(messageId);
  },

  stopGenerating: () => {
    const state = get();
    const { context, hooks } = state;
    const { agentId, topicId } = context;

    const chatStore = useChatStore.getState();

    // Cancel all running operations in this conversation context
    // Includes sendMessage, AI runtime (client-side and server-side), and agent mode stream
    chatStore.cancelOperations(
      { agentId, status: 'running', topicId, type: INPUT_LOADING_OPERATION_TYPES },
      MESSAGE_CANCEL_FLAT,
    );

    // Restore editor content if a sendMessage operation was cancelled
    chatStore.cancelSendMessageInServer(topicId ?? undefined);

    // ===== Hook: onGenerationStop =====
    if (hooks.onGenerationStop) {
      hooks.onGenerationStop();
    }
  },

  translateMessage: async (messageId: string, targetLang: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.translateMessage(messageId, targetLang);
  },

  saveMessageTTS: async (messageId: string, data: Required<ChatTTS>) => {
    const chatStore = useChatStore.getState();
    await chatStore.saveMessageTTS(messageId, data);
  },

  startMessageTTS: (messageId: string) => {
    const chatStore = useChatStore.getState();
    chatStore.startMessageTTS(messageId);
  },
});
