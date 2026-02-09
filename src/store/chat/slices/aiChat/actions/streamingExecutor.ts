/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import {
  AgentRuntime,
  type AgentRuntimeContext,
  type AgentState,
  type Cost,
  GeneralChatAgent,
  type Usage,
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
import { type ResolvedAgentConfig, resolveAgentConfig } from '@/services/chat/mecha';
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
     * Whether to disable tools for this agent execution
     * When true, agent will respond without calling any tools
     */
    disableTools?: boolean;
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
    /**
     * Whether this is a sub-task execution (disables lobe-gtd tools to prevent nested sub-tasks)
     */
    isSubTask?: boolean;
  }) => {
    state: AgentState;
    context: AgentRuntimeContext;
    /** Resolved agent config with isSubTask filtering applied */
    agentConfig: ResolvedAgentConfig;
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
    /** Pre-resolved agent config (from internal_createAgentState) with isSubTask filtering applied */
    agentConfig: ResolvedAgentConfig;
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
     * Whether to disable tools for this agent execution
     * When true, agent will respond without calling any tools
     */
    disableTools?: boolean;
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
    /**
     * Whether this is a sub-task execution (disables lobe-gtd tools to prevent nested sub-tasks)
     */
    isSubTask?: boolean;
  }) => Promise<{ cost?: Cost; usage?: Usage } | void>;
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
    disableTools,
    topicId: paramTopicId,
    threadId,
    initialState,
    initialContext,
    operationId,
    subAgentId: paramSubAgentId,
    isSubTask,
  }) => {
    // Use provided agentId/topicId or fallback to global state
    // Note: Use || instead of ?? to also fallback when paramAgentId is empty string
    const { activeAgentId, activeTopicId } = get();
    const agentId = paramAgentId || activeAgentId;
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
    // - isSubTask: filters out lobe-gtd tools to prevent nested sub-task creation
    // - disableTools: clears all plugins for broadcast scenarios
    const agentConfig = resolveAgentConfig({
      agentId: effectiveAgentId || '',
      disableTools, // Clear plugins for broadcast scenarios
      groupId, // Pass groupId for supervisor detection
      isSubTask, // Filter out lobe-gtd in sub-task context
      scope, // Pass scope from operation context
    });
    const { agentConfig: agentConfigData, plugins: pluginIds } = agentConfig;

    log(
      '[internal_createAgentState] resolved plugins=%o, isSubTask=%s, disableTools=%s',
      pluginIds,
      isSubTask,
      disableTools,
    );

    // Generate tools using ToolsEngine (centralized here, passed to chatService via agentConfig)
    // When disableTools is true (broadcast mode), skipDefaultTools prevents default tools from being added
    const toolsEngine = createAgentToolsEngine({
      model: agentConfigData.model,
      provider: agentConfigData.provider!,
    });

    const toolsDetailed = toolsEngine.generateToolsDetailed({
      model: agentConfigData.model,
      provider: agentConfigData.provider!,
      skipDefaultTools: disableTools,
      toolIds: pluginIds,
    });

    const enabledToolIds = toolsDetailed.enabledToolIds;
    // Use enabledManifests directly to avoid getEnabledPluginManifests adding default tools again
    const toolManifestMap = Object.fromEntries(
      toolsDetailed.enabledManifests.map((manifest) => [manifest.identifier, manifest]),
    );

    // Merge tools generation result into agentConfig for chatService to use
    const agentConfigWithTools = {
      ...agentConfig,
      enabledManifests: toolsDetailed.enabledManifests,
      enabledToolIds,
      tools: toolsDetailed.tools,
    };

    log(
      '[internal_createAgentState] toolManifestMap keys=%o, count=%d',
      Object.keys(toolManifestMap),
      Object.keys(toolManifestMap).length,
    );

    // Get user intervention config
    const userStore = getUserStoreState();
    const userInterventionConfig = {
      approvalMode: toolInterventionSelectors.approvalMode(userStore),
      allowList: toolInterventionSelectors.allowList(userStore),
    };

    // Build modelRuntimeConfig for compression and other runtime features
    const modelRuntimeConfig = {
      compressionModel: {
        model: agentConfigData.model,
        provider: agentConfigData.provider!,
      },
      model: agentConfigData.model,
      provider: agentConfigData.provider!,
    };

    // Create initial state or use provided state
    const state =
      initialState ||
      AgentRuntime.createInitialState({
        maxSteps: 400,
        messages,
        metadata: {
          sessionId: agentId,
          threadId,
          topicId,
        },
        modelRuntimeConfig,
        operationId: operationId ?? agentId,
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

    return { agentConfig: agentConfigWithTools, context, state };
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
      topicId = operation.context.topicId;
      threadId = operation.context.threadId ?? undefined;
      groupId = operation.context.groupId;
      scope = operation.context.scope;
      subAgentId = operation.context.subAgentId;
      abortController = operation.abortController; // 👈 Use operation's abortController

      // In group orchestration scenarios (has groupId), subAgentId is the actual responding agent
      // Use it for context injection instead of the session agentId
      if (groupId && subAgentId) {
        agentId = subAgentId;
      } else {
        agentId = operation.context.agentId!;
      }

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

    // Use pre-resolved agent config (from internal_createAgentState)
    // This ensures isSubTask filtering and other runtime modifications are preserved
    const { agentConfig: agentConfigData, chatConfig, plugins: pluginIds } = agentConfig;
    log('[internal_fetchAIChatMessage] using pre-resolved config, plugins=%o', pluginIds);

    let finalUsage: ModelUsage | undefined;
    let finalToolCalls: MessageToolCall[] | undefined;

    // Create streaming handler with callbacks
    const handler = new StreamingHandler(
      { messageId, operationId, agentId, groupId, topicId },
      {
        onContentUpdate: (content, reasoning, contentMetadata) => {
          internal_dispatchMessage(
            {
              id: messageId,
              type: 'updateMessage',
              value: {
                content,
                reasoning,
                ...(contentMetadata && {
                  metadata: {
                    isMultimodal: contentMetadata.isMultimodal,
                    tempDisplayContent: contentMetadata.tempDisplayContent,
                  },
                }),
              },
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
        // agentId is used for context, not for config resolution (config is pre-resolved)
        agentId: agentId || undefined,
        groupId,
        messages,
        model,
        provider,
        // Pass pre-resolved config to avoid duplicate resolveAgentConfig calls
        // This ensures isSubTask filtering and other runtime modifications are preserved
        resolvedAgentConfig: agentConfig,
        topicId: topicId ?? undefined, // Pass topicId for GTD context injection
        ...agentConfigData.params,
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
    const {
      disableTools,
      messages: originalMessages,
      parentMessageId,
      parentMessageType,
      context,
      isSubTask,
    } = params;

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
      '[internal_execAgentRuntime] start, operationId: %s, agentId: %s, subAgentId: %s, effectiveAgentId: %s, topicId: %s, messageKey: %s, parentMessageId: %s, parentMessageType: %s, messages count: %d, disableTools: %s',
      operationId,
      agentId,
      subAgentId,
      effectiveAgentId,
      topicId,
      messageKey,
      parentMessageId,
      parentMessageType,
      originalMessages.length,
      disableTools,
    );

    // Create a new array to avoid modifying the original messages
    let messages = [...originalMessages];

    // ===========================================
    // Step 1: Create Agent State (resolves config once)
    // ===========================================
    // agentConfig contains isSubTask filtering and is passed to callLLM executor
    const {
      state: initialAgentState,
      context: initialAgentContext,
      agentConfig,
    } = get().internal_createAgentState({
      messages,
      parentMessageId: params.parentMessageId,
      agentId,
      disableTools,
      topicId,
      threadId: threadId ?? undefined,
      initialState: params.initialState,
      initialContext: params.initialContext,
      operationId,
      subAgentId, // Pass subAgentId for agent config retrieval
      isSubTask, // Pass isSubTask to filter out lobe-gtd tools in sub-task context
    });

    // Use model/provider from resolved agentConfig
    const { agentConfig: agentConfigData } = agentConfig;
    const model = agentConfigData.model;
    const provider = agentConfigData.provider;

    const modelRuntimeConfig = {
      model,
      provider: provider!,
      // TODO: Support dedicated compression model from chatConfig.compressionModelId
      compressionModel: { model, provider: provider! },
    };
    // ===========================================
    // Step 2: Create and Execute Agent Runtime
    // ===========================================
    log('[internal_execAgentRuntime] Creating agent runtime with config', modelRuntimeConfig);

    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 1000 },
      compressionConfig: {
        enabled: agentConfigData.chatConfig?.enableContextCompression ?? true, // Default to enabled
      },
      operationId: `${messageKey}/${params.parentMessageId}`,
      modelRuntimeConfig,
    });

    const runtime = new AgentRuntime(agent, {
      executors: createAgentExecutors({
        agentConfig, // Pass pre-resolved config to callLLM executor
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
        '[internal_execAgentRuntime][step-%d]: phase=%s, status=%s, state.messages=%d, dbMessagesMap[%s]=%d, stepContext=%O',
        stepCount,
        nextContext.phase,
        state.status,
        state.messages.length,
        messageKey,
        currentDBMessages.length,
        stepContext,
      );

      const result = await runtime.step(state, nextContext);

      log(
        '[internal_execAgentRuntime] Step %d completed, events: %d, newStatus=%s, newState.messages=%d',
        stepCount,
        result.events.length,
        result.newState.status,
        result.newState.messages.length,
      );

      // After parallel tool batch completes, refresh messages to ensure all tool results are synced
      // This fixes the race condition where each tool's replaceMessages may overwrite others
      // REMEMBER: There is no test for it (too hard to add), if you want to change it , ask @arvinxx first
      if (
        result.nextContext?.phase &&
        ['tasks_batch_result', 'tools_batch_result'].includes(result.nextContext?.phase)
      ) {
        log(
          `[internal_execAgentRuntime] ${result.nextContext?.phase} completed, refreshing messages to sync state`,
        );
        await get().refreshMessages(context);
      }

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

    // Return usage and cost data for caller to use
    return { cost: state.cost, usage: state.usage };
  },
});
