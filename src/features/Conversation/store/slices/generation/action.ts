import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import { collectHeteroAttachedFiles } from '@lobechat/heterogeneous-agents';
import { shouldDropUnsupportedClaudeAssistantPrefill } from '@lobechat/model-runtime/providers/anthropic/modelId';
import type { ConversationContext } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { t } from 'i18next';
import { type StateCreator } from 'zustand';

import { MESSAGE_CANCEL_FLAT } from '@/const/index';
import { saveDraft } from '@/features/ChatInput/draftStorage';
import { isHeterogeneousAgentStatusGuideError } from '@/features/Conversation/Error/heterogeneous';
import { getEffectiveConversationModel } from '@/features/Conversation/store/utils/effectiveModel';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { selectRuntimeType } from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';
import {
  parseMentionedAgentsFromEditorData,
  parseSelectedSkillsFromEditorData,
  parseSelectedToolsFromEditorData,
} from '@/store/chat/slices/agentRun/actions/entries/commandBus';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { INPUT_LOADING_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import {
  mergeAgentRuntimeInitialContexts,
  resolveActiveTopicDocumentInitialContext,
} from '@/store/chat/utils/activeTopicDocumentContext';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { type Store as ConversationStore } from '../../action';
import { dataSelectors } from '../data/selectors';
import { continueHeteroAfterError } from './continueHeteroAfterError';
import { MAX_HETERO_AUTO_RETRIES } from './heteroRetryConfig';
import {
  ensureEffectiveAgencyAccess,
  getEffectiveAgencyConfig,
  runHeterogeneousFromExistingMessage,
  settleGenerationEntry,
} from './heteroRun';

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

export {
  ensureEffectiveAgencyAccess,
  getEffectiveAgencyConfig,
  resolveHeteroRunContext,
  runHeterogeneousFromExistingMessage,
  settleGenerationEntry,
} from './heteroRun';

export interface HeteroContinuationScheduleParams {
  failedAssistantMessageId: string;
  rateLimit?: {
    rateLimitType?: string;
    resetsAt?: number;
  };
}

interface RegenerateUserMessageSource {
  context: ConversationContext;
  displayMessages: ConversationStore['displayMessages'];
  hooks: ConversationStore['hooks'];
  readDbMessages: () => ConversationStore['dbMessages'];
}

const captureRegenerateUserMessageSource = (
  get: () => ConversationStore,
): RegenerateUserMessageSource => {
  const { context, dbMessages, displayMessages, hooks } = get();
  const contextKey = messageMapKey(context);

  return {
    context,
    displayMessages,
    hooks,
    readDbMessages: () => {
      const currentState = get();
      if (messageMapKey(currentState.context) === contextKey) return currentState.dbMessages;

      return useChatStore.getState().dbMessagesMap[contextKey] ?? dbMessages;
    },
  };
};

const regenerateUserMessageFromSource = async (
  messageId: string,
  source: RegenerateUserMessageSource,
) => {
  const { context, displayMessages, hooks, readDbMessages } = source;
  const chatStore = useChatStore.getState();

  // Block a genuine double-regenerate, and ONLY that. The guard used to be
  // `isMessageProcessing`, i.e. "this message has any running operation at all" —
  // so an unrelated op that outlived its run (a translate, a never-settled
  // gateway regenerate whose WS dropped non-terminally) permanently and silently
  // killed retry for that turn. Narrowing to the regenerate op keeps the
  // duplicate-click protection without letting any stray op wedge the turn, and
  // the toast means the refusal is never invisible again.
  if (operationSelectors.isMessageRegenerating(messageId)(chatStore)) {
    toast.info(t('messageAction.regenerateAlreadyRunning', { ns: 'chat' }));
    return;
  }

  // Find the message in the captured conversation messages. The source remains
  // bound to the initiating context even if StoreUpdater reuses this store for
  // another topic while an earlier delete or preflight request is in flight.
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

    // Read the database messages from the captured conversation. If the shared
    // ConversationStore has switched context, the source falls back to the old
    // context's ChatStore bucket instead of observing the new topic.
    const dbMessages = readDbMessages();
    const childrenCount = dbMessages.filter((m) => m.parentId === messageId).length;
    const nextBranchIndex = childrenCount;

    // Switch to the new branch so the UI shows the incoming response immediately
    await chatStore.switchMessageBranch(messageId, nextBranchIndex, {
      operationId,
    });

    // Re-check after switchMessageBranch: it is another await round-trip, so a
    // Stop pressed during it lands *after* the preflight guard above. Bail
    // before starting the runtime so the Stop isn't swallowed. The branch is
    // already switched, which is harmless — no assistant turn has started yet.
    const postSwitchOp = operationSelectors.getOperationById(operationId)(useChatStore.getState());
    if (postSwitchOp && postSwitchOp.status !== 'running') return;

    await ensureEffectiveAgencyAccess(context.agentId);
    const { agencyConfig, isWorkspaceAgent, workspaceScoped } = getEffectiveAgencyConfig(
      context.agentId,
      context.topicId
        ? topicSelectors.getTopicById(context.topicId)(useChatStore.getState())
        : undefined,
    );
    const heterogeneousProvider = agencyConfig?.heterogeneousProvider;
    const runtimeType = selectRuntimeType({
      boundDeviceId: agencyConfig?.boundDeviceId,
      executionTarget: agencyConfig?.executionTarget,
      heterogeneousProvider,
      isGatewayMode: chatStore.isGatewayModeEnabled(context.agentId),
      isWorkspaceAgent,
      workspaceScoped,
    });

    // ── Gateway mode: trigger server-side regeneration ──
    if (runtimeType === 'gateway') {
      // Hand the wrapper op off at phase-1 (`executeGatewayAgent` completes
      // `parentOperationId` once the child `execServerAgentRuntime` op is
      // running) — the documented interim-op contract this branch used to
      // deviate from by keeping the wrapper alive until session end. That
      // deviation is what made a WS drop before `onComplete` leave a running
      // `regenerate` op on the user turn FOREVER, and the retry guard reads
      // exactly that op type — so one dropped socket permanently bricked
      // retry for the turn. Forwarding the id also wires the wrapper's abort
      // signal into the preflight round trip, so a Stop pressed there now
      // actually aborts the request instead of being swallowed.
      // `onComplete` still fires at session end for the UI hook; re-completing
      // the already-settled wrapper is an idempotent no-op.
      await chatStore.executeGatewayAgent({
        context,
        message: item.content,
        onComplete: () =>
          settleGenerationEntry(chatStore, operationId, () =>
            hooks.onRegenerateComplete?.(messageId),
          ),
        parentMessageId: messageId,
        parentOperationId: operationId,
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
        attachedFiles: collectHeteroAttachedFiles(item),
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
      settleGenerationEntry(chatStore, operationId, () => hooks.onRegenerateComplete?.(messageId));
      return;
    }

    // ── Client mode: run agent locally ──
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
};

/** A replacement prompt for an edited Codex user message. */
export interface CodexMessageEdit {
  content: string;
  /** Updated rich editor state; omitted keeps the original message's state. */
  editorData?: Record<string, unknown>;
  /** Called once the copied message is ready, before the replacement run starts. */
  onAccepted?: () => void;
  /** Unsent destination retained by the open editor after a preparation failure. */
  preparedTopic?: {
    /** Last prompt persisted in the copied message. */
    content: string;
    /** Serialized editor state last persisted in the copied message. */
    editorData?: string;
    /** Destination user message, never the source message. */
    messageId: string;
    /** Source boundary used to prevent reuse by another editor. */
    sourceMessageId: string;
    /** Source conversation used to prevent cross-topic reuse. */
    sourceTopicId: string;
    /** Destination created for this editor but not yet dispatched. */
    topicId: string;
  };
}

/**
 * Edit-and-resend for a Codex user message. Codex cannot rewind its native
 * thread, so the server branches the conversation up to the message into a new
 * topic carrying the edited prompt, and that topic's ordinary regenerate path
 * runs it in a fresh session (the executor replays the copied history). The
 * source topic and its native session are left untouched.
 *
 * Rejects until the copied message is ready so the editor keeps the draft;
 * after acceptance, the run reports its own failures.
 */
const editCodexUserMessage = async (
  messageId: string,
  source: RegenerateUserMessageSource,
  edit: CodexMessageEdit,
) => {
  const { context, hooks } = source;
  const chatStore = useChatStore.getState();
  if (!context.agentId || !context.topicId)
    throw new Error(t('messageAction.codexEdit.sourceUnavailable', { ns: 'chat' }));

  let branch = edit.preparedTopic;
  if (branch?.sourceMessageId !== messageId || branch.sourceTopicId !== context.topicId) {
    const created = await topicService
      .branchTopicAtMessage({
        content: edit.content,
        editorData: edit.editorData,
        messageId,
        title: edit.content.slice(0, 80),
        topicId: context.topicId,
      })
      .catch((error: unknown) => {
        // Transport/parse errors are not user-facing; the editor toasts this and keeps the draft.
        console.error('[Codex edit] Could not create the branch topic:', error);
        throw new Error(t('messageAction.codexEdit.branchFailed', { ns: 'chat' }), {
          cause: error,
        });
      });
    branch = {
      ...created,
      content: edit.content,
      editorData: JSON.stringify(edit.editorData),
      sourceMessageId: messageId,
      sourceTopicId: context.topicId,
    };
    edit.preparedTopic = branch;
  }
  const target: ConversationContext = { ...context, threadId: null, topicId: branch.topicId };
  const key = messageMapKey(target);
  if (branch.content !== edit.content || branch.editorData !== JSON.stringify(edit.editorData)) {
    // The draft can change after a failed read. Update only its unsent copy,
    // then refresh that bucket before accepting; the source row stays untouched.
    await messageService.updateMessage(branch.messageId, {
      content: edit.content,
      editorData: edit.editorData,
    });
    await chatStore.refreshMessages(target);
    branch.content = edit.content;
    branch.editorData = JSON.stringify(edit.editorData);
  }
  await chatStore.prefetchMessages(target);
  const displayMessages = useChatStore.getState().messagesMap[key] ?? [];
  // Background warming may swallow a failed fetch or skip an in-flight request.
  // Keep the source editor until the copied user message can actually start a run.
  if (
    !displayMessages.some(
      (message) =>
        message.id === branch.messageId &&
        message.role === 'user' &&
        message.content === edit.content,
    )
  ) {
    throw new Error(t('messageAction.codexEdit.prepareFailed', { ns: 'chat' }));
  }
  edit.preparedTopic = undefined;
  edit.onAccepted?.();

  await chatStore.refreshTopic();
  if (context.isolatedTopic) {
    // Embedded hosts own their visible topic independently of global navigation.
    hooks.onTopicCreated?.(branch.topicId);
  } else {
    await chatStore.switchTopic(branch.topicId, {
      onlyIfActiveAgentId: context.agentId,
      onlyIfActiveTopicIn: [context.topicId],
    });
  }

  // The run outlives the editor; it surfaces its own errors.
  void regenerateUserMessageFromSource(branch.messageId, {
    context: target,
    displayMessages,
    hooks,
    readDbMessages: () => useChatStore.getState().dbMessagesMap[key] ?? [],
  }).catch((error: unknown) => {
    toast.error(error instanceof Error ? error.message : String(error));
  });
};

/**
 * Generation Actions
 *
 * Handles generation control (stop, cancel, regenerate, continue)
 */
export interface GenerationAction {
  cancelHeteroContinuation: (topicId?: string | null) => Promise<void>;
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
   * Clear all operations
   */
  clearOperations: () => void;

  /**
   * Clear translate for a message
   * @deprecated Temporary bridge to ChatStore
   */
  clearTranslate: (messageId: string) => Promise<void>;

  /**
   * Continue generation from a message.
   *
   * Resolves `true` only when a generation actually started. Every bail-out
   * (message gone, no longer a group, no block to continue from) resolves
   * `false` so a caller that already mutated history can recover instead of
   * silently leaving the turn dead — see {@link retryFailedAssistantStep}.
   */
  continueGeneration: (displayMessageId: string) => Promise<boolean>;

  /**
   * Continue generation from a specific block. Resolves `true` only when a
   * generation actually started; see {@link continueGeneration}.
   */
  continueGenerationMessage: (displayMessageId: string, messageId: string) => Promise<boolean>;

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
   * Regenerate a user message. With `edit`, resend an edited Codex prompt in a
   * branched topic instead (see {@link editCodexUserMessage}).
   */
  regenerateUserMessage: (messageId: string, edit?: CodexMessageEdit) => Promise<void>;

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
   * Retry the failed step of an assistant turn, from the error card rendered on
   * that step.
   *
   * Guarantees a terminal outcome: either a continuation actually starts, or the
   * whole turn is regenerated. The previous call site deleted the failed block
   * and then *hoped* `continueGeneration` still found a group to continue — when
   * it didn't (single-step turn, or a turn that stops parsing as a group once the
   * block is gone) the user was left with a deleted answer and nothing running.
   *
   * @param groupMessageId - the assistantGroup id (the turn)
   * @param blockId - the child block that carries the error
   */
  retryFailedAssistantStep: (groupMessageId: string, blockId: string) => Promise<void>;

  scheduleHeteroContinuation: (params: HeteroContinuationScheduleParams) => Promise<void>;

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
  cancelHeteroContinuation: async (sourceTopicId) => {
    const topicId = sourceTopicId ?? get().context.topicId;
    if (!topicId) return;

    const result = await topicService.cancelRateLimitContinuation(topicId);
    if (result)
      useChatStore.getState().internal_dispatchTopic({
        id: topicId,
        type: 'updateTopic',
        value: { metadata: result.metadata, status: 'failed' },
      });
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

  clearTranslate: async (messageId: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.clearTranslate(messageId);
  },

  continueGeneration: async (groupMessageId: string) => {
    const { displayMessages } = get();

    // Find the message
    const message = displayMessages.find((m) => m.id === groupMessageId);
    if (!message) return false;

    // If it's an assistantGroup, find the last child's ID as blockId
    let lastBlockId: string | undefined;

    if (message.role !== 'assistantGroup') return false;

    if (message.children && message.children.length > 0) {
      const lastChild = message.children.at(-1);

      if (lastChild) {
        lastBlockId = lastChild.id;
      }
    }

    if (!lastBlockId) return false;

    return get().continueGenerationMessage(groupMessageId, lastBlockId);
  },

  continueGenerationMessage: async (displayMessageId: string, dbMessageId: string) => {
    const { context, displayMessages, hooks } = get();
    const chatStore = useChatStore.getState();

    // Find the message (blockId refers to the assistant message to continue from)
    const message = displayMessages.find((m) => m.id === displayMessageId);
    if (!message) return false;

    // ===== Hook: onBeforeContinue =====
    if (hooks.onBeforeContinue) {
      const shouldProceed = await hooks.onBeforeContinue(displayMessageId);
      if (shouldProceed === false) return false;
    }

    await ensureEffectiveAgencyAccess(context.agentId);
    const { agencyConfig, isWorkspaceAgent, workspaceScoped } = getEffectiveAgencyConfig(
      context.agentId,
      context.topicId
        ? topicSelectors.getTopicById(context.topicId)(useChatStore.getState())
        : undefined,
    );
    const runtimeType = selectRuntimeType({
      boundDeviceId: agencyConfig?.boundDeviceId,
      executionTarget: agencyConfig?.executionTarget,
      heterogeneousProvider: agencyConfig?.heterogeneousProvider,
      isGatewayMode: chatStore.isGatewayModeEnabled(context.agentId),
      isWorkspaceAgent,
      workspaceScoped,
    });

    // Hetero CLIs (CC / Codex) have no "continue a cut-off response" primitive
    // — each prompt is a fresh user turn from their perspective. Bail out
    // rather than synthesize a fake "please continue" turn that would pollute
    // the session and confuse the model. The button is a no-op in this mode.
    if (runtimeType === 'hetero') return false;

    // Claude 4.6+/5 removed assistant prefill: a payload ending with an
    // assistant turn is rejected (400), and the model runtime strips trailing
    // assistant messages for these models — so "continue" would silently
    // regenerate instead of continuing. Surface that instead of pretending.
    // Resolve the effective model (topic override > agent default) — the topic
    // may have been switched to/from a prefill-capable model independently.
    const continueModel = getEffectiveConversationModel(context);
    if (continueModel && shouldDropUnsupportedClaudeAssistantPrefill(continueModel)) {
      toast.warning(t('messageAction.continueGenerationUnsupported', { ns: 'chat' }));
      return false;
    }

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
        return true;
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

      return true;
    } catch (error) {
      chatStore.failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'ContinueError',
      });
      throw error;
    }
  },

  continueHeteroAfterError: (groupMessageId: string) =>
    continueHeteroAfterError(get, groupMessageId),

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
    const regenerationSource = captureRegenerateUserMessageSource(get);
    const { context, displayMessages } = regenerationSource;
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
      await regenerateUserMessageFromSource(userId, regenerationSource);
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
    // Anchor the subtopic on the row's tail. A steered row's id is its host (the
    // chain's *first* turn) while the user is looking at the chain's last turn —
    // passing the raw id anchors the fork at the top of the row instead of where
    // the user is. See `dataSelectors.rowTailId`.
    chatStore.openThreadCreator(dataSelectors.rowTailId(messageId)(get()));
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

  retryFailedAssistantStep: async (groupMessageId: string, blockId: string) => {
    const { displayMessages } = get();

    const group = displayMessages.find((m) => m.id === groupMessageId);
    const erroredBlock = group?.children?.find((child) => child.id === blockId);

    // A hetero status error (rate limit, upstream overload, auth, missing CLI)
    // means the run died but its CLI session survives — that path resumes the
    // session and already owns its own whole-turn fallback.
    if (isHeterogeneousAgentStatusGuideError(erroredBlock?.error?.body)) {
      await get().continueHeteroAfterError(groupMessageId);
      return;
    }

    // Captured BEFORE any mutation: once the failed block is gone the turn may
    // stop resolving as a group, and the parent user message is the only anchor
    // left to regenerate from.
    const parentUserId = group?.parentId;

    // Nothing to continue from — the failed block IS the whole turn, so deleting
    // it would destroy the group and leave `continueGeneration` with nothing to
    // find. Replace the turn outright instead of deleting speculatively.
    const hasEarlierSteps = (group?.children?.length ?? 0) > 1;
    if (!hasEarlierSteps) {
      await get().delAndRegenerateMessage(groupMessageId);
      return;
    }

    await get().deleteDBMessage(blockId);

    if (await get().continueGeneration(groupMessageId)) return;

    // Continue turned out to be impossible after all (the turn stopped parsing
    // as a group once the block was removed, the runtime has no continue
    // primitive, ...). The failed block is already gone, so the only honest
    // outcome left is replacing the whole turn — never a silent no-op.
    const groupStillExists = get().displayMessages.some((m) => m.id === groupMessageId);
    if (groupStillExists) await get().delAndRegenerateMessage(groupMessageId);
    else if (parentUserId) await get().regenerateUserMessage(parentUserId);
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

  regenerateUserMessage: async (messageId: string, edit?: CodexMessageEdit) => {
    const source = captureRegenerateUserMessageSource(get);
    if (edit) return editCodexUserMessage(messageId, source, edit);
    return regenerateUserMessageFromSource(messageId, source);
  },

  resendThreadMessage: async (messageId: string) => {
    // Resend is essentially regenerating the user message in thread context
    await get().regenerateUserMessage(messageId);
  },

  stopGenerating: () => {
    const state = get();
    const { context, editor, hooks } = state;
    const { agentId, groupId, isNew, scope, threadId, topicId } = context;

    const chatStore = useChatStore.getState();

    // Cancel all running operations in this conversation context
    // Includes sendMessage, AI runtime (client-side and server-side), and agent mode stream
    chatStore.cancelOperations(
      {
        agentId,
        groupId,
        isNew,
        scope,
        status: 'running',
        threadId,
        topicId,
        type: INPUT_LOADING_OPERATION_TYPES,
      },
      MESSAGE_CANCEL_FLAT,
    );

    // Restore editor content if a sendMessage operation was cancelled
    chatStore.cancelSendMessageInServer(context, editor);

    // ===== Hook: onGenerationStop =====
    if (hooks.onGenerationStop) {
      hooks.onGenerationStop();
    }
  },

  translateMessage: async (messageId: string, targetLang: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.translateMessage(messageId, targetLang);
  },
});
