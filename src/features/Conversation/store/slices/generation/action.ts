import { AgentManagementIdentifier } from '@lobechat/builtin-tool-agent-management';
import { LOADING_FLAT } from '@lobechat/const';
import type { ConversationContext, HeterogeneousProviderConfig } from '@lobechat/types';
import { t } from 'i18next';
import { type StateCreator } from 'zustand';

import { message as antdMessage } from '@/components/AntdStaticMethods';
import { MESSAGE_CANCEL_FLAT } from '@/const/index';
import { messageService } from '@/services/message';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { selectRuntimeType } from '@/store/chat/slices/aiChat/actions/agentDispatcher';
import {
  parseMentionedAgentsFromEditorData,
  parseSelectedSkillsFromEditorData,
  parseSelectedToolsFromEditorData,
} from '@/store/chat/slices/aiChat/actions/commandBus';
import { resolveHeteroResume } from '@/store/chat/slices/aiChat/actions/heteroResume';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { INPUT_LOADING_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import {
  mergeAgentRuntimeInitialContexts,
  resolveActiveTopicDocumentInitialContext,
} from '@/store/chat/utils/activeTopicDocumentContext';

import { type Store as ConversationStore } from '../../action';

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
 * Branch a hetero (Claude Code / Codex) turn off an existing user message.
 *
 * Used by regenerate (parent = user msg, prompt = original user content).
 * Pre-creates the assistant row so `executeHeterogeneousAgent` has a stable
 * `assistantMessageId` to stream into, then runs an `execHeterogeneousAgent`
 * op as a child of the caller's parent op so Stop cancels the executor
 * without killing the parent op early.
 */
const runHeterogeneousFromExistingMessage = async (
  chatStore: ReturnType<typeof useChatStore.getState>,
  params: {
    context: ConversationContext;
    heterogeneousProvider: HeterogeneousProviderConfig;
    parentMessageId: string;
    parentOperationId: string;
    prompt: string;
  },
): Promise<string> => {
  const { context, heterogeneousProvider, parentMessageId, parentOperationId, prompt } = params;
  const agentId = context.agentId;
  if (!agentId) throw new Error('agentId is required for heterogeneous agent');

  // Resolve workingDirectory: topic-level pin (set when bound to a project)
  // wins over the agent-level default. Mirrors the sendMessage hetero branch
  // so regenerate stays on the same project as the original turn.
  const topic = context.topicId
    ? topicSelectors.getTopicById(context.topicId)(chatStore)
    : undefined;
  const agentWorkingDirectory =
    agentByIdSelectors.getAgentWorkingDirectoryById(agentId)(getAgentStoreState());
  const workingDirectory = topic?.metadata?.workingDirectory || agentWorkingDirectory;

  // Drops the saved sessionId when its bound cwd disagrees with the current
  // one — without this CC emits "No conversation found with session ID".
  const { cwdChanged, resumeSessionId } = resolveHeteroResume(topic?.metadata, workingDirectory);
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
      await import('@/store/chat/slices/aiChat/actions/heterogeneousAgentExecutor');
    await executeHeterogeneousAgent(() => useChatStore.getState(), {
      assistantMessageId: assistantMsg.id,
      context,
      heterogeneousProvider,
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

/**
 * Generation Actions
 *
 * Handles generation control (stop, cancel, regenerate, continue)
 */
export interface GenerationAction {
  /**
   * Cancel a specific operation
   */
  cancelOperation: (operationId: string, reason?: string) => void;

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
   * Clear TTS for a message
   * @deprecated Temporary bridge to ChatStore
   */
  clearTTS: (messageId: string) => Promise<void>;

  /**
   * Continue generation from a message
   */
  continueGeneration: (displayMessageId: string) => Promise<void>;

  /**
   * Continue generation from a specific block
   */
  continueGenerationMessage: (displayMessageId: string, messageId: string) => Promise<void>;

  /**
   * Delete and regenerate a message
   */
  delAndRegenerateMessage: (messageId: string) => Promise<void>;

  /**
   * Delete and resend a thread message
   */
  delAndResendThreadMessage: (messageId: string) => Promise<void>;

  /**
   * Open thread creator
   * @deprecated Temporary bridge to ChatStore
   */
  openThreadCreator: (messageId: string) => void;

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
   * Stop current generation
   */
  stopGenerating: () => void;

  /**
   * Translate a message
   * @deprecated Temporary bridge to ChatStore
   */
  translateMessage: (messageId: string, targetLang: string) => Promise<void>;

  /**
   * TTS a message
   * @deprecated Temporary bridge to ChatStore
   */
  ttsMessage: (
    messageId: string,
    state?: { contentMd5?: string; file?: string; voice?: string },
  ) => Promise<void>;
}

export const generationSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  GenerationAction
> = (set, get) => ({
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

  clearTTS: async (messageId: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.clearTTS(messageId);
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

    const agentConfig = agentSelectors.getAgentConfigById(context.agentId)(getAgentStoreState());
    const runtimeType = selectRuntimeType({
      heterogeneousProvider: agentConfig?.agencyConfig?.heterogeneousProvider,
      isGatewayMode: chatStore.isGatewayModeEnabled(),
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
          onComplete: () => {
            chatStore.completeOperation(operationId);
            if (hooks.onContinueComplete) hooks.onContinueComplete(displayMessageId);
          },
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

      chatStore.completeOperation(operationId);

      // ===== Hook: onContinueComplete =====
      if (hooks.onContinueComplete) {
        hooks.onContinueComplete(displayMessageId);
      }
    } catch (error) {
      chatStore.failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'ContinueError',
      });
      throw error;
    }
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

    // IMPORTANT: Delete first, then regenerate
    // If we regenerate first, it switches to a new branch, causing the original
    // message to no longer appear in displayMessages. Then deleteMessage cannot
    // find the message and fails silently.
    await chatStore.deleteMessage(messageId, { operationId });
    await get().regenerateUserMessage(userId);
    chatStore.completeOperation(operationId);
  },

  delAndResendThreadMessage: async (messageId: string) => {
    const { context } = get();
    const chatStore = useChatStore.getState();

    // Create operation to track context (use 'regenerate' type since resend is essentially regenerate)
    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId },
      type: 'regenerate',
    });

    // Resend then delete
    await get().resendThreadMessage(messageId);
    await chatStore.deleteMessage(messageId, { operationId });
    chatStore.completeOperation(operationId);
  },

  openThreadCreator: (messageId: string) => {
    const chatStore = useChatStore.getState();
    chatStore.openThreadCreator(messageId);
  },

  reInvokeToolMessage: async (messageId: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.reInvokeToolMessage(messageId);
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
    const initialContext = mergeAgentRuntimeInitialContexts(
      await resolveActiveTopicDocumentInitialContext(context),
      buildRetryInitialContext(item.editorData),
    );

    // Get context messages up to and including the target message
    const contextMessages = displayMessages.slice(0, currentIndex + 1);
    if (contextMessages.length <= 0) return;

    // ===== Hook: onBeforeRegenerate =====
    if (hooks.onBeforeRegenerate) {
      const shouldProceed = await hooks.onBeforeRegenerate(messageId);
      if (shouldProceed === false) return;
    }

    // Create regenerate operation with context
    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId },
      type: 'regenerate',
    });

    try {
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

      const agentConfig = agentSelectors.getAgentConfigById(context.agentId)(getAgentStoreState());
      const heterogeneousProvider = agentConfig?.agencyConfig?.heterogeneousProvider;
      const runtimeType = selectRuntimeType({
        heterogeneousProvider,
        isGatewayMode: chatStore.isGatewayModeEnabled(),
      });

      // ── Gateway mode: trigger server-side regeneration ──
      if (runtimeType === 'gateway') {
        // Keep the regenerate operation running until the gateway session completes,
        // so isMessageRegenerating stays true and duplicate clicks are blocked.
        await chatStore.executeGatewayAgent({
          context,
          message: item.content,
          onComplete: () => {
            chatStore.completeOperation(operationId);
            if (hooks.onRegenerateComplete) {
              hooks.onRegenerateComplete(messageId);
            }
          },
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
          parentMessageId: messageId,
          parentOperationId: operationId,
          prompt: item.content,
        });
        chatStore.completeOperation(operationId);
        if (hooks.onRegenerateComplete) hooks.onRegenerateComplete(messageId);
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

      chatStore.completeOperation(operationId);

      // ===== Hook: onRegenerateComplete =====
      if (hooks.onRegenerateComplete) {
        hooks.onRegenerateComplete(messageId);
      }
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

  ttsMessage: async (
    messageId: string,
    state?: { contentMd5?: string; file?: string; voice?: string },
  ) => {
    const chatStore = useChatStore.getState();
    await chatStore.ttsMessage(messageId, state);
  },
});
