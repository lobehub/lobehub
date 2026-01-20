/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import {
  AgentRuntime,
  type AgentRuntimeContext,
  type AgentState,
  GeneralChatAgent,
  computeStepContext,
} from '@lobechat/agent-runtime';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { isDesktop } from '@lobechat/const';
import {
  type ChatToolPayload,
  type ConversationContext,
  type MessageMapScope,
  type MessageToolCall,
  type ModelUsage,
  type RuntimeInitialContext,
  type RuntimeStepContext,
  TraceNameMap,
  type UIChatMessage,
} from '@lobechat/types';
import debug from 'debug';
import { t } from 'i18next';
import { type StateCreator } from 'zustand/vanilla';

import { createAgentToolsEngine } from '@/helpers/toolEngineering';
import { chatService } from '@/services/chat';
import { resolveAgentConfig } from '@/services/chat/mecha';
import { messageService } from '@/services/message';
import { createAgentExecutors } from '@/store/chat/agents/createAgentExecutors';
import { type ChatStore } from '@/store/chat/store';
import { getFileStoreState } from '@/store/file/store';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/lobe-page-agent';
import { toolInterventionSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';

import { topicSelectors } from '../../../selectors';
import { messageMapKey } from '../../../utils/messageMapKey';
import { selectTodosFromMessages } from '../../message/selectors/dbMessage';
import { StreamingHandler } from './StreamingHandler';
import type { StreamChunk } from './types/streaming';

const log = debug('lobe-store:streaming-executor');

/**
 * Core streaming execution actions for AI chat
 */
export interface StreamingExecutorAction {
  /**
   * Creates initial agent state and context with user intervention config
   */
  internal_createAgentState: (params: {
    messages: UIChatMessage[];
    parentMessageId: string;
    /**
     * Explicit agentId for this execution (avoids using global activeAgentId)
     */
    agentId?: string;
    /**
     * Explicit topicId for this execution (avoids using global activeTopicId)
     */
    topicId?: string | null;
    threadId?: string;
    operationId?: string;
    initialState?: AgentState;
    initialContext?: AgentRuntimeContext;
    /**
     * Sub Agent ID for group orchestration scenarios
     * Used to get Agent config (model, provider, plugins) instead of agentId
     */
    subAgentId?: string;
  }) => {
    state: AgentState;
    context: AgentRuntimeContext;
  };
  /**
   * Retrieves an AI-generated chat message from the backend service with streaming
   */
  internal_fetchAIChatMessage: (params: {
    messageId: string;
    messages: UIChatMessage[];
    model: string;
    provider: string;
    operationId?: string;
    agentConfig?: any;
    traceId?: string;
    /** Initial context for page editor (captured at operation start) */
    initialContext?: RuntimeInitialContext;
    /** Step context for page editor (updated each step) */
    stepContext?: RuntimeStepContext;
  }) => Promise<{
    isFunctionCall: boolean;
    tools?: ChatToolPayload[];
    tool_calls?: MessageToolCall[];
    content: string;
    traceId?: string;
    finishType?: string;
    usage?: ModelUsage;
  }>;
  /**
   * Executes the core processing logic for AI messages
   * including preprocessing and postprocessing steps
   */
  internal_execAgentRuntime: (params: {
    /**
     * Full conversation context (required)
     * Contains agentId, topicId, threadId, groupId, scope, etc.
     */
    context: ConversationContext;
    /**
     * Initial agent runtime context (for resuming execution from a specific phase)
     */
    initialContext?: AgentRuntimeContext;
    /**
     * Initial agent state (for resuming execution from a specific point)
     */
    initialState?: AgentState;
    inPortalThread?: boolean;
    inSearchWorkflow?: boolean;
    messages: UIChatMessage[];
    /**
     * Operation ID for this execution (automatically created if not provided)
     */
    operationId?: string;
    parentMessageId: string;
    parentMessageType: 'user' | 'assistant' | 'tool';
    /**
     * Parent operation ID (creates a child operation if provided)
     */
    parentOperationId?: string;
    skipCreateFirstMessage?: boolean;
  }) => Promise<void>;
}

export const streamingExecutor: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  StreamingExecutorAction
> = (set, get) => ({
  internal_createAgentState: ({
    messages,
    parentMessageId,
    agentId: paramAgentId,
    topicId: paramTopicId,
    threadId,
    initialState,
    initialContext,
    operationId,
    subAgentId: paramSubAgentId,
  }) => {
    // Use provided agentId/topicId or fallback to global state
    const { activeAgentId, activeTopicId } = get();
    const agentId = paramAgentId ?? activeAgentId;
    const topicId = paramTopicId !== undefined ? paramTopicId : activeTopicId;

    // For group orchestration scenarios:
    // - subAgentId is used for agent config retrieval (model, provider, plugins)
    // - agentId is used for session ID (message storage location)
    const effectiveAgentId = paramSubAgentId || agentId;

    // Get scope and groupId from operation context if available
    const operation = operationId ? get().operations[operationId] : undefined;
    const scope = operation?.context.scope;
    const groupId = operation?.context.groupId;

    // Resolve agent config with builtin agent runtime config merged
    // This ensures runtime plugins (e.g., 'lobe-agent-builder' for Agent Builder) are included
    const { agentConfig: agentConfigData, plugins: pluginIds } = resolveAgentConfig({
      agentId: effectiveAgentId || '',
      groupId, // Pass groupId for supervisor detection
      scope, // Pass scope from operation context
    });

    // Get tools manifest map
    const toolsEngine = createAgentToolsEngine({
      model: agentConfigData.model,
      provider: agentConfigData.provider!,
    });
    const { enabledToolIds } = toolsEngine.generateToolsDetailed({
      model: agentConfigData.model,
      provider: agentConfigData.provider!,
      toolIds: pluginIds,
    });
    const toolManifestMap = Object.fromEntries(
      toolsEngine.getEnabledPluginManifests(enabledToolIds).entries(),
    );

    // Get user intervention config
    const userStore = getUserStoreState();
    const userInterventionConfig = {
      approvalMode: toolInterventionSelectors.approvalMode(userStore),
      allowList: toolInterventionSelectors.allowList(userStore),
    };

    // Create initial state or use provided state
    const state =
      initialState ||
      AgentRuntime.createInitialState({
        operationId: operationId ?? agentId,
        messages,
        maxSteps: 400,
        metadata: {
          sessionId: agentId,
          topicId,
          threadId,
        },
        toolManifestMap,
        userInterventionConfig,
      });

    // Build initialContext for page editor if lobe-page-agent is enabled
    let runtimeInitialContext: RuntimeInitialContext | undefined;

    if (enabledToolIds.includes(PageAgentIdentifier)) {
      try {
        // Get page content context from page agent runtime
        const pageContentContext = pageAgentRuntime.getPageContentContext('both');

        runtimeInitialContext = {
          pageEditor: {
            markdown: pageContentContext.markdown || '',
            xml: pageContentContext.xml || '',
            metadata: {
              title: pageContentContext.metadata.title,
              charCount: pageContentContext.metadata.charCount,
              lineCount: pageContentContext.metadata.lineCount,
            },
          },
        };
        log(
          '[internal_createAgentState] Page Agent detected, injected initialContext.pageEditor with title: %s',
          pageContentContext.metadata.title,
        );
      } catch (error) {
        // Page agent runtime may not be initialized (e.g., editor not set)
        // This is expected in some scenarios, so we just log and continue
        log('[internal_createAgentState] Failed to get page content context: %o', error);
      }
    }

    // Create initial context or use provided context
    const context: AgentRuntimeContext = initialContext || {
      phase: 'init',
      payload: {
        model: agentConfigData.model,
        provider: agentConfigData.provider,
        parentMessageId,
      },
      session: {
        sessionId: agentId,
        messageCount: messages.length,
        status: state.status,
        stepCount: 0,
      },
      // Inject initialContext if available
      initialContext: runtimeInitialContext,
    };

    return { state, context };
  },

  internal_fetchAIChatMessage: async ({
    messageId,
    messages,
    model,
    provider,
    operationId,
    agentConfig,
    traceId: traceIdParam,
    initialContext,
    stepContext,
  }) => {
    const {
      optimisticUpdateMessageContent,
      internal_dispatchMessage,
      internal_toggleToolCallingStreaming,
    } = get();

    // Get agentId, topicId, groupId and abortController from operation
    let agentId: string;
    let subAgentId: string | undefined;
    let topicId: string | null | undefined;
    let threadId: string | undefined;
    let groupId: string | undefined;
    let scope: MessageMapScope | undefined;
    let traceId: string | undefined = traceIdParam;
    let abortController: AbortController;

    if (operationId) {
      const operation = get().operations[operationId];
      if (!operation) {
        log('[internal_fetchAIChatMessage] ERROR: Operation not found: %s', operationId);
        throw new Error(`Operation not found: ${operationId}`);
      }
      agentId = operation.context.agentId!;
      subAgentId = operation.context.subAgentId;
      topicId = operation.context.topicId;
      threadId = operation.context.threadId ?? undefined;
      groupId = operation.context.groupId;
      scope = operation.context.scope;
      abortController = operation.abortController; // 👈 Use operation's abortController
      log(
        '[internal_fetchAIChatMessage] get context from operation %s: agentId=%s, subAgentId=%s, topicId=%s, groupId=%s, aborted=%s',
        operationId,
        agentId,
        subAgentId,
        topicId,
        groupId,
        abortController.signal.aborted,
      );
      // Get traceId from operation metadata if not explicitly provided
      if (!traceId) {
        traceId = operation.metadata?.traceId;
      }
    } else {
      // Fallback to global state (for legacy code paths without operation)
      agentId = get().activeAgentId;
      topicId = get().activeTopicId;
      groupId = get().activeGroupId;
      abortController = new AbortController();
      log(
        '[internal_fetchAIChatMessage] use global context: agentId=%s, topicId=%s, groupId=%s',
        agentId,
        topicId,
        groupId,
      );
    }

    // Create base context for child operations and message queries
    const fetchContext = { agentId, topicId, threadId, groupId, scope };

    // For group orchestration scenarios:
    // - subAgentId is used for agent config retrieval (model, provider, plugins)
    // - agentId is used for session ID (message storage location)
    const effectiveAgentId = subAgentId || agentId;

    // Resolve agent config with params adjusted based on chatConfig
    // If agentConfig is passed in, use it directly (it's already resolved)
    // Otherwise, resolve from mecha layer which handles:
    // - Builtin agent runtime config merging
    // - max_tokens/reasoning_effort based on chatConfig settings
    const resolved = resolveAgentConfig({
      agentId: effectiveAgentId,
      groupId, // Pass groupId for supervisor detection
      scope, // scope is already available from line 329
    });
    const finalAgentConfig = agentConfig || resolved.agentConfig;
    const chatConfig = resolved.chatConfig;

    let finalUsage: ModelUsage | undefined;
    let finalToolCalls: MessageToolCall[] | undefined;

    // Create streaming handler with callbacks
    const handler = new StreamingHandler(
      { messageId, operationId, agentId, groupId, topicId },
      {
        onContentUpdate: (content, reasoning) => {
          internal_dispatchMessage(
            {
              id: messageId,
              type: 'updateMessage',
              value: { content, reasoning },
            },
            { operationId },
          );
        },
        onReasoningUpdate: (reasoning) => {
          internal_dispatchMessage(
            {
              id: messageId,
              type: 'updateMessage',
              value: { reasoning },
            },
            { operationId },
          );
        },
        onToolCallsUpdate: (tools) => {
          internal_dispatchMessage(
            {
              id: messageId,
              type: 'updateMessage',
              value: { tools },
            },
            { operationId },
          );
        },
        onGroundingUpdate: (grounding) => {
          internal_dispatchMessage(
            {
              id: messageId,
              type: 'updateMessage',
              value: { search: grounding },
            },
            { operationId },
          );
        },
        onImagesUpdate: (images) => {
          internal_dispatchMessage(
            {
              id: messageId,
              type: 'updateMessage',
              value: { imageList: images },
            },
            { operationId },
          );
        },
        onReasoningStart: () => {
          const { operationId: reasoningOpId } = get().startOperation({
            type: 'reasoning',
            context: { ...fetchContext, messageId },
            parentOperationId: operationId,
          });
          get().associateMessageWithOperation(messageId, reasoningOpId);
          return reasoningOpId;
        },
        onReasoningComplete: (opId) => get().completeOperation(opId),
        uploadBase64Image: (data) =>
          getFileStoreState()
            .uploadBase64FileWithProgress(data)
            .then((file) => ({
              id: file?.id,
              url: file?.url,
              alt: file?.filename || file?.id,
            })),
        transformToolCalls: get().internal_transformToolCalls,
        toggleToolCallingStreaming: internal_toggleToolCallingStreaming,
      },
    );

    const historySummary = chatConfig.enableCompressHistory
      ? topicSelectors.currentActiveTopicSummary(get())
      : undefined;
    await chatService.createAssistantMessageStream({
      abortController,
      params: {
        // Use effectiveAgentId for agent config resolution (system role, tools, etc.)
        // In group orchestration: subAgentId for the actual speaking agent
        // In normal chat: agentId for the main agent
        agentId: effectiveAgentId || undefined,
        groupId,
        messages,
        model,
        provider,
        scope, // Pass scope to chat service for page-agent injection
        topicId, // Pass topicId for GTD context injection
        ...finalAgentConfig.params,
        plugins: finalAgentConfig.plugins,
      },
      historySummary: historySummary?.content,
      // Pass page editor context from agent runtime
      initialContext,
      stepContext,
      trace: {
        traceId,
        topicId: topicId ?? undefined,
        traceName: TraceNameMap.Conversation,
      },
      onErrorHandle: async (error) => {
        log(
          '[internal_fetchAIChatMessage] onError: messageId=%s, error=%s, operationId=%s',
          messageId,
          error.message,
          operationId,
        );
        await get().optimisticUpdateMessageError(messageId, error, { operationId });
      },
      onFinish: async (
        content,
        { traceId, observationId, toolCalls, reasoning, grounding, usage, speed, type },
      ) => {
        // if there is traceId, update it
        if (traceId) {
          messageService.updateMessage(
            messageId,
            { traceId, observationId: observationId ?? undefined },
            { agentId, groupId, topicId },
          );
        }

        // Handle finish using StreamingHandler
        const result = await handler.handleFinish({
          traceId,
          observationId,
          toolCalls,
          reasoning,
          grounding,
          usage,
          speed,
          type,
        });

        // Store for return value
        finalUsage = result.usage;
        finalToolCalls = result.toolCalls;

        // update the content after fetch result
        await optimisticUpdateMessageContent(
          messageId,
          result.content,
          {
            tools: result.tools,
            reasoning: result.metadata.reasoning,
            search: result.metadata.search,
            imageList: result.metadata.imageList,
            metadata: {
              ...result.metadata.usage,
              ...result.metadata.performance,
              performance: result.metadata.performance,
              usage: result.metadata.usage,
              finishType: result.metadata.finishType,
              ...(result.metadata.isMultimodal && { isMultimodal: true }),
            },
          },
          { operationId },
        );
      },
      onMessageHandle: async (chunk) => {
        // Delegate chunk handling to StreamingHandler
        handler.handleChunk(chunk as StreamChunk);
      },
    });

    log(
      '[internal_fetchAIChatMessage] completed: messageId=%s, finishType=%s, isFunctionCall=%s, operationId=%s',
      messageId,
      handler.getFinishType(),
      handler.getIsFunctionCall(),
      operationId,
    );

    return {
      isFunctionCall: handler.getIsFunctionCall(),
      traceId: handler.getTraceId(),
      content: handler.getOutput(),
      tools: handler.getTools(),
      usage: finalUsage,
      tool_calls: finalToolCalls,
      finishType: handler.getFinishType(),
    };
  },

  internal_execAgentRuntime: async (params) => {
    const { messages: originalMessages, parentMessageId, parentMessageType, context } = params;

    // Extract values from context
    const { agentId, topicId, threadId, subAgentId, groupId } = context;

    // For group orchestration scenarios:
    // - subAgentId is used for agent config retrieval (model, provider, plugins)
    // - agentId is used for message storage location (via messageMapKey)
    const effectiveAgentId = subAgentId || agentId;

    // Generate message key from context
    const messageKey = messageMapKey(context);

    // Create or use provided operation
    let operationId = params.operationId;
    if (!operationId) {
      const { operationId: newOperationId } = get().startOperation({
        type: 'execAgentRuntime',
        context: { ...context, messageId: parentMessageId },
        parentOperationId: params.parentOperationId, // Pass parent operation ID
        label: 'AI Generation',
        metadata: {
          // Mark if this operation is in thread context
          // Thread operations should not affect main window UI state
          inThread: params.inPortalThread || false,
        },
      });
      operationId = newOperationId;

      // Associate message with operation
      get().associateMessageWithOperation(parentMessageId, operationId);
    }

    log(
      '[internal_execAgentRuntime] start, operationId: %s, agentId: %s, subAgentId: %s, effectiveAgentId: %s, topicId: %s, messageKey: %s, parentMessageId: %s, parentMessageType: %s, messages count: %d',
      operationId,
      agentId,
      subAgentId,
      effectiveAgentId,
      topicId,
      messageKey,
      parentMessageId,
      parentMessageType,
      originalMessages.length,
    );

    // Create a new array to avoid modifying the original messages
    let messages = [...originalMessages];

    // Use effectiveAgentId to get agent config (subAgentId in group orchestration, agentId otherwise)
    // resolveAgentConfig handles:
    // - Builtin agent runtime config merging
    // - max_tokens/reasoning_effort based on chatConfig settings
    const { agentConfig: agentConfigData } = resolveAgentConfig({
      agentId: effectiveAgentId || '',
      groupId, // Pass groupId for supervisor detection
      scope: context.scope, // Pass scope from context parameter
    });

    // Use agent config from agentId
    const model = agentConfigData.model;
    const provider = agentConfigData.provider;

    // ===========================================
    // Step 1: Knowledge Base Tool Integration
    // ===========================================
    // RAG retrieval is now handled by the Knowledge Base Tool
    // The AI will decide when to call searchKnowledgeBase and readKnowledge tools
    // based on the conversation context and available knowledge bases

    // TODO: Implement selected files full-text injection if needed
    // User-selected files should be handled differently from knowledge base files

    // ===========================================
    // Step 2: Create and Execute Agent Runtime
    // ===========================================
    log('[internal_execAgentRuntime] Creating agent runtime');

    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 1000 },
      operationId: `${messageKey}/${params.parentMessageId}`,
      modelRuntimeConfig: {
        model,
        provider: provider!,
      },
    });

    const runtime = new AgentRuntime(agent, {
      executors: createAgentExecutors({
        get,
        messageKey,
        operationId,
        parentId: params.parentMessageId,
        skipCreateFirstMessage: params.skipCreateFirstMessage,
      }),
      getOperation: (opId: string) => {
        const op = get().operations[opId];
        if (!op) throw new Error(`Operation not found: ${opId}`);
        return {
          abortController: op.abortController,
          context: op.context,
        };
      },
      operationId,
    });

    // Create agent state and context with user intervention config
    const { state: initialAgentState, context: initialAgentContext } =
      get().internal_createAgentState({
        messages,
        parentMessageId: params.parentMessageId,
        agentId,
        topicId,
        threadId: threadId ?? undefined,
        initialState: params.initialState,
        initialContext: params.initialContext,
        operationId,
        subAgentId, // Pass subAgentId for agent config retrieval
      });

    let state = initialAgentState;
    let nextContext = initialAgentContext;

    log(
      '[internal_execAgentRuntime] Agent runtime loop start, initial phase: %s',
      nextContext.phase,
    );

    // Execute the agent runtime loop
    let stepCount = 0;
    while (state.status !== 'done' && state.status !== 'error') {
      // Check if operation has been cancelled
      const currentOperation = get().operations[operationId];
      if (currentOperation?.status === 'cancelled') {
        log('[internal_execAgentRuntime] Operation cancelled, marking state as interrupted');

        // Update state status to 'interrupted' so agent can handle abort
        state = { ...state, status: 'interrupted' };

        // Let agent handle the abort (will clean up pending tools if needed)
        const result = await runtime.step(state, nextContext);
        state = result.newState;

        log('[internal_execAgentRuntime] Operation cancelled, stopping loop');
        break;
      }

      stepCount++;

      // Compute step context from current db messages before each step
      // Use dbMessagesMap which contains persisted state (including pluginState.todos)
      const currentDBMessages = get().dbMessagesMap[messageKey] || [];
      // Use selectTodosFromMessages selector (shared with UI display)
      const todos = selectTodosFromMessages(currentDBMessages);
      const stepContext = computeStepContext({ todos });

      // If page agent is enabled, get the latest XML for stepPageEditor
      if (nextContext.initialContext?.pageEditor) {
        try {
          const pageContentContext = pageAgentRuntime.getPageContentContext('xml');
          stepContext.stepPageEditor = {
            xml: pageContentContext.xml || '',
          };
        } catch (error) {
          // Page agent runtime may not be available, ignore errors
          log('[internal_execAgentRuntime] Failed to get page XML for step: %o', error);
        }
      }

      // Inject stepContext into the runtime context for this step
      nextContext = { ...nextContext, stepContext };

      log(
        '[internal_execAgentRuntime][step-%d]: phase=%s, status=%s, stepContext=%O',
        stepCount,
        nextContext.phase,
        state.status,
        stepContext,
      );

      const result = await runtime.step(state, nextContext);

      log(
        '[internal_execAgentRuntime] Step %d completed, events: %d, newStatus=%s',
        stepCount,
        result.events.length,
        result.newState.status,
      );

      // Handle completion and error events
      for (const event of result.events) {
        switch (event.type) {
          case 'done': {
            log('[internal_execAgentRuntime] Received done event');
            break;
          }

          case 'error': {
            log('[internal_execAgentRuntime] Received error event: %o', event.error);
            // Find the assistant message to update error
            const currentMessages = get().messagesMap[messageKey] || [];
            const assistantMessage = currentMessages.findLast((m) => m.role === 'assistant');
            if (assistantMessage) {
              await messageService.updateMessageError(assistantMessage.id, event.error, {
                agentId,
                groupId,
                topicId,
              });
            }
            const finalMessages = get().messagesMap[messageKey] || [];
            get().replaceMessages(finalMessages, { context });
            break;
          }
        }
      }

      state = result.newState;

      // Check if operation was cancelled after step completion
      const operationAfterStep = get().operations[operationId];
      if (operationAfterStep?.status === 'cancelled') {
        log(
          '[internal_execAgentRuntime] Operation cancelled after step %d, marking state as interrupted',
          stepCount,
        );

        // Set state.status to 'interrupted' to trigger agent abort handling
        state = { ...state, status: 'interrupted' };

        // Let agent handle the abort (will clean up pending tools if needed)
        // Use result.nextContext if available (e.g., llm_result with tool calls)
        // otherwise fallback to current nextContext
        const contextForAbort = result.nextContext || nextContext;
        const abortResult = await runtime.step(state, contextForAbort);
        state = abortResult.newState;

        log('[internal_execAgentRuntime] Operation cancelled, stopping loop');
        break;
      }

      // If no nextContext, stop execution
      if (!result.nextContext) {
        log('[internal_execAgentRuntime] No next context, stopping loop');
        break;
      }

      // Preserve initialContext when updating nextContext
      // initialContext is set once at the start and should persist through all steps
      nextContext = { ...result.nextContext, initialContext: nextContext.initialContext };
    }

    log(
      '[internal_execAgentRuntime] Agent runtime loop finished, final status: %s, total steps: %d',
      state.status,
      stepCount,
    );

    // Execute afterCompletion hooks before completing operation
    // These are registered by tools (e.g., speak/broadcast/delegate) that need to
    // trigger actions after the AgentRuntime finishes
    const operation = get().operations[operationId];
    const afterCompletionCallbacks = operation?.metadata?.runtimeHooks?.afterCompletionCallbacks;
    if (afterCompletionCallbacks && afterCompletionCallbacks.length > 0) {
      log(
        '[internal_execAgentRuntime] Executing %d afterCompletion callbacks',
        afterCompletionCallbacks.length,
      );

      for (const callback of afterCompletionCallbacks) {
        try {
          await callback();
        } catch (error) {
          console.error('[internal_execAgentRuntime] afterCompletion callback error:', error);
        }
      }

      log('[internal_execAgentRuntime] afterCompletion callbacks executed');
    }

    // Complete operation based on final state
    switch (state.status) {
      case 'done': {
        get().completeOperation(operationId);
        log('[internal_execAgentRuntime] Operation completed successfully');
        break;
      }
      case 'error': {
        get().failOperation(operationId, {
          type: 'runtime_error',
          message: 'Agent runtime execution failed',
        });
        log('[internal_execAgentRuntime] Operation failed');
        break;
      }
      case 'waiting_for_human': {
        // When waiting for human intervention, complete the current operation
        // A new operation will be created when user approves/rejects
        get().completeOperation(operationId);
        log('[internal_execAgentRuntime] Operation paused for human intervention');
        break;
      }
    }

    log('[internal_execAgentRuntime] completed');

    // Desktop notification (if not in tools calling mode)
    if (isDesktop) {
      try {
        const finalMessages = get().messagesMap[messageKey] || [];
        const lastAssistant = finalMessages.findLast((m) => m.role === 'assistant');

        // Only show notification if there's content and no tools
        if (lastAssistant?.content && !lastAssistant?.tools) {
          const { desktopNotificationService } =
            await import('@/services/electron/desktopNotification');

          await desktopNotificationService.showNotification({
            body: lastAssistant.content,
            title: t('notification.finishChatGeneration', { ns: 'electron' }),
          });
        }
      } catch (error) {
        console.error('Desktop notification error:', error);
      }
    }
  },
});
