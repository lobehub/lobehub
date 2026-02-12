// Disable the auto sort key eslint rule to make the code more logic and readable
import {
  type AgentRuntimeContext,
  type AgentState,
  type Cost,
  type Usage,
} from '@lobechat/agent-runtime';
import { AgentRuntime, computeStepContext, GeneralChatAgent } from '@lobechat/agent-runtime';
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
  type UIChatMessage,
} from '@lobechat/types';
import { TraceNameMap } from '@lobechat/types';
import debug from 'debug';
import { t } from 'i18next';

import { createAgentToolsEngine } from '@/helpers/toolEngineering';
import { chatService } from '@/services/chat';
import { type ResolvedAgentConfig } from '@/services/chat/mecha';
import { resolveAgentConfig } from '@/services/chat/mecha';
import { messageService } from '@/services/message';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { createAgentExecutors } from '@/store/chat/agents/createAgentExecutors';
import { type ChatStore } from '@/store/chat/store';
import { getFileStoreState } from '@/store/file/store';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/lobe-page-agent';
import { type StoreSetter } from '@/store/types';
import { toolInterventionSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';
import { dynamicInterventionAudits } from '@/tools/dynamicInterventionAudits';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { topicSelectors } from '../../../selectors';
import { messageMapKey } from '../../../utils/messageMapKey';
import { topicMapKey } from '../../../utils/topicMapKey';
import { selectTodosFromMessages } from '../../message/selectors/dbMessage';
import { StreamingHandler } from './StreamingHandler';
import { type StreamChunk } from './types/streaming';

const log = debug('lobe-store:streaming-executor');

/**
 * Core streaming execution actions for AI chat
 */

type Setter = StoreSetter<ChatStore>;
export const streamingExecutor = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new StreamingExecutorActionImpl(set, get, _api);

export class StreamingExecutorActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_createAgentState = ({
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
  }: {
    messages: UIChatMessage[];
    parentMessageId: string;
    agentId?: string;
    disableTools?: boolean;
    topicId?: string | null;
    threadId?: string;
    operationId?: string;
    initialState?: AgentState;
    initialContext?: AgentRuntimeContext;
    subAgentId?: string;
    isSubTask?: boolean;
  }): {
    state: AgentState;
    context: AgentRuntimeContext;
    agentConfig: ResolvedAgentConfig;
  } => {
    // Use provided agentId/topicId or fallback to global state
    // Note: Use || instead of ?? to also fallback when paramAgentId is empty string
    const { activeAgentId, activeTopicId } = this.#get();
    const agentId = paramAgentId || activeAgentId;
    const topicId = paramTopicId !== undefined ? paramTopicId : activeTopicId;

    // For group orchestration scenarios:
    // - subAgentId is used for agent config retrieval (model, provider, plugins)
    // - agentId is used for session ID (message storage location)
    const effectiveAgentId = paramSubAgentId || agentId;

    // Get scope and groupId from operation context if available
    const operation = operationId ? this.#get().operations[operationId] : undefined;
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

    const topicWorkingDirectory = topicSelectors.currentTopicWorkingDirectory(this.#get());
    const agentWorkingDirectory = agentSelectors.currentAgentWorkingDirectory(getAgentStoreState());
    const workingDirectory = topicWorkingDirectory ?? agentWorkingDirectory;

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
          workingDirectory,
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
  };

  internal_fetchAIChatMessage = async ({
    messageId,
    messages,
    model,
    provider,
    operationId,
    agentConfig,
    traceId: traceIdParam,
    initialContext,
    stepContext,
  }: {
    messageId: string;
    messages: UIChatMessage[];
    model: string;
    provider: string;
    operationId?: string;
    traceId?: string;
    agentConfig: ResolvedAgentConfig;
    initialContext?: RuntimeInitialContext;
    stepContext?: RuntimeStepContext;
  }): Promise<{
    isFunctionCall: boolean;
    tools?: ChatToolPayload[];
    tool_calls?: MessageToolCall[];
    content: string;
    traceId?: string;
    finishType?: string;
    usage?: ModelUsage;
  }> => {
    const {
      optimisticUpdateMessageContent,
      internal_dispatchMessage,
      internal_toggleToolCallingStreaming,
    } = this.#get();

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
      const operation = this.#get().operations[operationId];
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
      agentId = this.#get().activeAgentId;
      topicId = this.#get().activeTopicId;
      groupId = this.#get().activeGroupId;
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
          const { operationId: reasoningOpId } = this.#get().startOperation({
            type: 'reasoning',
            context: { ...fetchContext, messageId },
            parentOperationId: operationId,
          });
          this.#get().associateMessageWithOperation(messageId, reasoningOpId);
          return reasoningOpId;
        },
        onReasoningComplete: (opId) => this.#get().completeOperation(opId),
        uploadBase64Image: (data) =>
          getFileStoreState()
            .uploadBase64FileWithProgress(data)
            .then((file) => ({
              id: file?.id,
              url: file?.url,
              alt: file?.filename || file?.id,
            })),
        transformToolCalls: this.#get().internal_transformToolCalls,
        toggleToolCallingStreaming: internal_toggleToolCallingStreaming,
      },
    );

    const historySummary = chatConfig.enableCompressHistory
      ? topicSelectors.currentActiveTopicSummary(this.#get())
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
        await this.#get().optimisticUpdateMessageError(messageId, error, { operationId });
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
  };

  internal_execAgentRuntime = async (params: {
    context: ConversationContext;
    disableTools?: boolean;
    initialContext?: AgentRuntimeContext;
    initialState?: AgentState;
    inPortalThread?: boolean;
    inSearchWorkflow?: boolean;
    messages: UIChatMessage[];
    operationId?: string;
    parentMessageId: string;
    parentMessageType: 'user' | 'assistant' | 'tool';
    parentOperationId?: string;
    skipCreateFirstMessage?: boolean;
    isSubTask?: boolean;
  }): Promise<{ cost?: Cost; usage?: Usage } | void> => {
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
      const { operationId: newOperationId } = this.#get().startOperation({
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
      this.#get().associateMessageWithOperation(parentMessageId, operationId);
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
    const messages = [...originalMessages];

    // ===========================================
    // Step 1: Create Agent State (resolves config once)
    // ===========================================
    // agentConfig contains isSubTask filtering and is passed to callLLM executor
    const {
      state: initialAgentState,
      context: initialAgentContext,
      agentConfig,
    } = this.#get().internal_createAgentState({
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
      dynamicInterventionAudits,
      operationId: `${messageKey}/${params.parentMessageId}`,
      modelRuntimeConfig,
    });

    const runtime = new AgentRuntime(agent, {
      executors: createAgentExecutors({
        agentConfig, // Pass pre-resolved config to callLLM executor
        get: this.#get,
        messageKey,
        operationId,
        parentId: params.parentMessageId,
        skipCreateFirstMessage: params.skipCreateFirstMessage,
      }),
      getOperation: (opId: string) => {
        const op = this.#get().operations[opId];
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
      const currentOperation = this.#get().operations[operationId];
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
      const currentDBMessages = this.#get().dbMessagesMap[messageKey] || [];
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
        await this.#get().refreshMessages(context);
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
            const currentMessages = this.#get().messagesMap[messageKey] || [];
            const assistantMessage = currentMessages.findLast((m) => m.role === 'assistant');
            if (assistantMessage) {
              await messageService.updateMessageError(assistantMessage.id, event.error, {
                agentId,
                groupId,
                topicId,
              });
            }
            const finalMessages = this.#get().messagesMap[messageKey] || [];
            this.#get().replaceMessages(finalMessages, { context });
            break;
          }
        }
      }

      state = result.newState;

      // Check if operation was cancelled after step completion
      const operationAfterStep = this.#get().operations[operationId];
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
    const operation = this.#get().operations[operationId];
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
        this.#get().completeOperation(operationId);
        log('[internal_execAgentRuntime] Operation completed successfully');

        // Mark unread completion for background conversations
        const completedOp = this.#get().operations[operationId];
        if (completedOp?.context.agentId) {
          this.#get().markUnreadCompleted(completedOp.context.agentId, completedOp.context.topicId);
        }
        break;
      }
      case 'error': {
        this.#get().failOperation(operationId, {
          type: 'runtime_error',
          message: 'Agent runtime execution failed',
        });
        log('[internal_execAgentRuntime] Operation failed');
        break;
      }
      case 'waiting_for_human': {
        // When waiting for human intervention, complete the current operation
        // A new operation will be created when user approves/rejects
        this.#get().completeOperation(operationId);
        log('[internal_execAgentRuntime] Operation paused for human intervention');
        break;
      }
    }

    log('[internal_execAgentRuntime] completed');

    // Desktop notification (if not in tools calling mode)
    if (isDesktop) {
      try {
        const finalMessages = this.#get().messagesMap[messageKey] || [];
        const lastAssistant = finalMessages.findLast((m) => m.role === 'assistant');

        // Only show notification if there's content and no tools
        if (lastAssistant?.content && !lastAssistant?.tools) {
          const { desktopNotificationService } =
            await import('@/services/electron/desktopNotification');

          // Use topic title or agent title as notification title
          let notificationTitle = t('notification.finishChatGeneration', { ns: 'electron' });
          if (topicId) {
            const key = topicMapKey({ agentId, groupId });
            const topicData = this.#get().topicDataMap[key];
            const topic = topicData?.items?.find((item) => item.id === topicId);
            if (topic?.title) notificationTitle = topic.title;
          } else {
            const agentMeta = agentSelectors.getAgentMetaById(agentId)(getAgentStoreState());
            if (agentMeta?.title) notificationTitle = agentMeta.title;
          }

          await desktopNotificationService.showNotification({
            body: markdownToTxt(lastAssistant.content),
            title: notificationTitle,
          });
        }
      } catch (error) {
        console.error('Desktop notification error:', error);
      }
    }

    // Return usage and cost data for caller to use
    return { cost: state.cost, usage: state.usage };
  };
}

export type StreamingExecutorAction = Pick<
  StreamingExecutorActionImpl,
  keyof StreamingExecutorActionImpl
>;
