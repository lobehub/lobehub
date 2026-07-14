// Disable the auto sort key eslint rule to make the code more logic and readable
import {
  type AgentRuntimeContext,
  type AgentState,
  type Cost,
  type Usage,
} from '@lobechat/agent-runtime';
import {
  AgentRuntime,
  computeStepContext,
  GeneralChatAgent,
  isParkedStatus,
} from '@lobechat/agent-runtime';
import { LobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
import { createPathScopeAudit } from '@lobechat/builtin-tool-local-system';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import { isDesktop } from '@lobechat/const';
import { type ToolsEngine } from '@lobechat/context-engine';
import { buildTaskDetailPrompt, buildTaskListPrompt } from '@lobechat/prompts';
import {
  type ConversationContext,
  type MessageMetadata,
  type RunSubAgentResult,
  type RuntimeInitialContext,
  type UIChatMessage,
} from '@lobechat/types';
import debug from 'debug';

import { createAgentToolsEngine } from '@/helpers/toolEngineering';
import { aiAgentService } from '@/services/aiAgent';
import { isCanUseVideo, isCanUseVision } from '@/services/chat/helper';
import { type ResolvedAgentConfig } from '@/services/chat/mecha';
import { composeEnabledTools, resolveAgentConfig } from '@/services/chat/mecha';
import { localFileService } from '@/services/electron/localFileService';
import { messageService } from '@/services/message';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors } from '@/store/aiInfra/selectors';
import { getAiInfraStoreState } from '@/store/aiInfra/store';
import { createAgentExecutors } from '@/store/chat/agents/createAgentExecutors';
import { topicSelectors } from '@/store/chat/selectors';
import { emitClientAgentSignalSourceEvent } from '@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge';
import {
  selectActivatedSkillsFromMessages,
  selectActivatedToolIdsFromMessages,
  selectTodosFromMessages,
} from '@/store/chat/slices/message/selectors/dbMessage';
import { type ChatStore } from '@/store/chat/store';
import { notifyDesktopHumanApprovalRequired } from '@/store/chat/utils/desktopNotification';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getElectronStoreState } from '@/store/electron';
import { getServerConfigStoreState, serverConfigSelectors } from '@/store/serverConfig';
import { getTaskStoreState } from '@/store/task';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/lobe-page-agent';
import { type StoreSetter } from '@/store/types';
import { toolInterventionSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';

import { buildRunLifecycle } from '../../lifecycle/buildRunLifecycle';
import type { RunParkedReason, RunScope } from '../../lifecycle/types';

const log = debug('lobe-store:streaming-executor');

const dynamicInterventionAudits = {
  pathScopeAudit: createPathScopeAudit({
    areAllPathsSafe: async ({ paths, resolveAgainstScope }) => {
      if (!isDesktop) return false;

      const result = await localFileService.auditSafePaths({ paths, resolveAgainstScope });
      return result.allSafe;
    },
  }),
};

const hasReferTopicNode = (editorData: Record<string, any> | null | undefined): boolean => {
  if (!editorData) return false;
  const walk = (node: any): boolean => {
    if (!node) return false;
    if (node.type === 'refer-topic') return true;
    if (Array.isArray(node.children)) return node.children.some(walk);
    return false;
  };
  return walk(editorData.root);
};

const getVisualMediaAvailability = (messages: UIChatMessage[]) => ({
  hasImages: messages.some((message) => message.role === 'user' && !!message.imageList?.length),
  hasVideos: messages.some((message) => message.role === 'user' && !!message.videoList?.length),
});

/**
 * Core streaming execution actions for AI chat
 */

type Setter = StoreSetter<ChatStore>;
export const streamingExecutor = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new StreamingExecutorActionImpl(set, get, _api);

export class StreamingExecutorActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void set;
    void _api;
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
    isSubAgent,
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
    /**
     * Sub Agent ID - behavior depends on scope
     * - scope: 'group' | 'group_agent': Used for agent config and changes message ownership
     * - scope: 'sub_agent': Used for agent config but doesn't change message ownership
     */
    subAgentId?: string;
    isSubAgent?: boolean;
  }): {
    state: AgentState;
    context: AgentRuntimeContext;
    agentConfig: ResolvedAgentConfig;
    toolsEngine?: ToolsEngine;
  } => {
    // Use provided agentId/topicId or fallback to global state
    // Note: Use || instead of ?? to also fallback when paramAgentId is empty string
    const { activeAgentId, activeTopicId } = this.#get();
    const agentId = paramAgentId || activeAgentId;
    const topicId = paramTopicId !== undefined ? paramTopicId : activeTopicId;

    // Determine effectiveAgentId for agent config retrieval:
    // - paramSubAgentId: Used for agent config (behavior depends on scope)
    // - agentId: Default
    const effectiveAgentId = paramSubAgentId || agentId;

    // Get scope and groupId from operation context if available
    const operation = operationId ? this.#get().operations[operationId] : undefined;
    const scope = operation?.context.scope;
    const groupId = operation?.context.groupId;

    // Resolve agent config with builtin agent runtime config merged
    // This ensures runtime plugins (e.g., 'lobe-agent-builder' for Agent Builder) are included
    // - isSubAgent: filters out lobe-agent tool to prevent nested sub-agent creation
    // - disableTools: clears all plugins for broadcast scenarios
    const agentConfig = resolveAgentConfig({
      agentId: effectiveAgentId || '',
      disableTools, // Clear plugins for broadcast scenarios
      groupId, // Pass groupId for supervisor detection
      isSubAgent, // Filter out lobe-agent in sub-agent context
      scope, // Pass scope from operation context
    });

    const { agentConfig: agentConfigData, plugins: pluginIds } = agentConfig;
    const selectedToolIds = initialContext?.initialContext?.selectedTools?.map(
      (tool) => tool.identifier,
    );

    if (!agentConfigData || !agentConfigData.model) {
      throw new Error(
        `[internal_createAgentState] Agent config not found or incomplete for agentId: ${effectiveAgentId}, scope: ${scope}`,
      );
    }

    // Dynamically inject turn-scoped builtin tools.
    const hasTopicReference = messages.some((m) => hasReferTopicNode(m.editorData));
    const visualMediaAvailability = getVisualMediaAvailability(messages);
    const serverConfigState = getServerConfigStoreState();
    const visualUnderstandingConfigured =
      !!serverConfigState && serverConfigSelectors.enableVisualUnderstanding(serverConfigState);
    const shouldEnableVisualUnderstanding =
      visualUnderstandingConfigured &&
      ((visualMediaAvailability.hasImages &&
        !isCanUseVision(agentConfigData.model, agentConfigData.provider!)) ||
        (visualMediaAvailability.hasVideos &&
          !isCanUseVideo(agentConfigData.model, agentConfigData.provider!)));
    const runtimePluginIds = [
      ...new Set([
        ...(pluginIds || []),
        ...(hasTopicReference ? ['lobe-topic-reference'] : []),
        ...(shouldEnableVisualUnderstanding ? [LobeAgentManifest.identifier] : []),
      ]),
    ];
    const effectivePluginIds = runtimePluginIds.length > 0 ? runtimePluginIds : undefined;
    const mergedToolIds =
      selectedToolIds && selectedToolIds.length > 0
        ? [...new Set([...runtimePluginIds, ...selectedToolIds])]
        : effectivePluginIds;

    log(
      '[internal_createAgentState] resolved plugins=%o, isSubAgent=%s, disableTools=%s, hasTopicReference=%s',
      effectivePluginIds,
      isSubAgent,
      disableTools,
      hasTopicReference,
    );

    // Generate tools using ToolsEngine (centralized here, passed to chatService via agentConfig)
    // When disableTools is true (broadcast mode), skipDefaultTools prevents default tools from being added
    const toolsEngine = createAgentToolsEngine(
      { model: agentConfigData.model, provider: agentConfigData.provider! },
      // Use `mergedToolIds` (not `effectivePluginIds`) so the enable rules cover
      // user-selected @-mention ids too — the same id set `generateToolsDetailed`
      // receives below. Otherwise a mentioned tool that isn't pinned to the agent
      // (e.g. a custom MCP connector picked from the @ list) would have its
      // manifest included but be defaulted to disabled by the enable checker, so
      // no function tools are sent. `platformFilter` still gates availability.
      mergedToolIds,
      // Context-aware builtin manifests: lobe-agent hides callSubAgent in group /
      // sub-agent runs. Replaces the former dropSubAgentInGroup + applyPluginFilters
      // isSubAgent hard-coding.
      { isSubAgent, scope },
    );
    // When skillActivateMode is 'manual':
    // Exclude only discovery tools (activator, skill-store) so runtime-managed defaults
    // (skills, web-browsing, sandbox, memory, etc.) remain available for all agents.
    const isManualMode = agentConfig.chatConfig?.skillActivateMode === 'manual';

    const toolsDetailed = toolsEngine.generateToolsDetailed({
      excludeDefaultToolIds: isManualMode ? manualModeExcludeToolIds : undefined,
      model: agentConfigData.model,
      provider: agentConfigData.provider!,
      skipDefaultTools: disableTools || undefined,
      toolIds: mergedToolIds,
    });

    const { enabledToolIds, enabledManifests, tools } = composeEnabledTools({
      context: {
        isPageEditorReady: pageAgentRuntime.isReady(),
        scope,
      },
      injectedManifests: initialContext?.initialContext?.injectedManifests,
      toolsDetailed,
    });

    // Use enabledManifests directly to avoid getEnabledPluginManifests adding default tools again
    const toolManifestMap = Object.fromEntries(
      enabledManifests.map((manifest) => [manifest.identifier, manifest]),
    );

    // Merge tools generation result into agentConfig for chatService to use
    const agentConfigWithTools = {
      ...agentConfig,
      enabledManifests,
      enabledToolIds,
      tools,
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
    const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
    const agentWorkingDirectory =
      agentSelectors.currentAgentWorkingDirectory(currentDeviceId)(getAgentStoreState());
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
        operationToolSet: {
          enabledToolIds,
          manifestMap: toolManifestMap,
          sourceMap: {},
          tools: toolsDetailed.tools ?? [],
        },
        toolManifestMap,
        userInterventionConfig,
      });

    // Build initialContext for page editor if lobe-page-agent is enabled
    let runtimeInitialContext: RuntimeInitialContext | undefined;

    if (scope === 'page' && enabledToolIds.includes(PageAgentIdentifier)) {
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

    const viewedTask = operation?.context.viewedTask;
    if (viewedTask) {
      try {
        const taskState = getTaskStoreState();
        let contextPrompt: string | undefined;

        if (viewedTask.type === 'list') {
          contextPrompt = buildTaskListPrompt({
            defaultAssigneeAgentId: operation.context.defaultTaskAssigneeAgentId,
            tasks: taskState.tasks,
            total: taskState.tasksTotal || taskState.tasks.length,
          });
        } else {
          const detail = taskState.taskDetailMap[viewedTask.taskId];
          if (detail)
            contextPrompt = buildTaskDetailPrompt({
              defaultAssigneeAgentId: operation.context.defaultTaskAssigneeAgentId,
              task: detail,
            });
        }

        if (contextPrompt) {
          runtimeInitialContext = {
            ...runtimeInitialContext,
            taskManager: { contextPrompt },
          };
          log(
            '[internal_createAgentState] injected taskManager context (route=%s)',
            viewedTask.type,
          );
        }
      } catch (error) {
        log('[internal_createAgentState] Failed to build task manager context: %o', error);
      }
    }

    const mergedRuntimeInitialContext =
      runtimeInitialContext || initialContext?.initialContext
        ? {
            ...runtimeInitialContext,
            ...initialContext?.initialContext,
          }
        : undefined;

    const defaultPayload = {
      model: agentConfigData.model,
      parentMessageId,
      provider: agentConfigData.provider,
    };
    const existingPayload =
      initialContext?.payload && typeof initialContext.payload === 'object'
        ? (initialContext.payload as Record<string, unknown>)
        : undefined;

    // Create initial context or use provided context
    const context: AgentRuntimeContext = initialContext
      ? {
          ...initialContext,
          payload: {
            ...defaultPayload,
            ...existingPayload,
          },
          initialContext: mergedRuntimeInitialContext,
        }
      : {
          phase: 'init',
          payload: defaultPayload,
          session: {
            sessionId: agentId,
            messageCount: messages.length,
            status: state.status,
            stepCount: 0,
          },
          // Inject initialContext if available
          initialContext: mergedRuntimeInitialContext,
        };

    return { agentConfig: agentConfigWithTools, context, state, toolsEngine };
  };

  executeClientAgent = async (params: {
    context: ConversationContext;
    disableTools?: boolean;
    initialContext?: AgentRuntimeContext;
    initialState?: AgentState;
    inPortalThread?: boolean;
    metadata?: Pick<MessageMetadata, 'trigger'>;
    messages: UIChatMessage[];
    operationId?: string;
    parentMessageId: string;
    parentMessageType: 'user' | 'assistant' | 'tool';
    parentOperationId?: string;
    skipCreateFirstMessage?: boolean;
    isSubAgent?: boolean;
  }): Promise<{ cost?: Cost; model?: string; provider?: string; usage?: Usage } | void> => {
    const {
      disableTools,
      messages: originalMessages,
      parentMessageId,
      parentMessageType,
      context,
      isSubAgent,
    } = params;

    // Extract values from context
    const { agentId, topicId, threadId, subAgentId, groupId, scope } = context;
    // Determine effectiveAgentId for agent config retrieval:
    // - subAgentId is used when present (behavior depends on scope)
    // - agentId: Default
    const effectiveAgentId = subAgentId || agentId;

    // Generate message key from context
    const messageKey = messageMapKey(context);

    // Create or use provided operation
    let operationId = params.operationId;
    if (!operationId) {
      const { operationId: newOperationId } = this.#get().startOperation({
        type: 'execAgentRuntime',
        context: {
          ...context,
          ...(isSubAgent ? { isSubAgent: true } : {}),
          messageId: parentMessageId,
        },
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
      '[executeClientAgent] start, operationId: %s, agentId: %s, subAgentId: %s, scope: %s, effectiveAgentId: %s, topicId: %s, messageKey: %s, parentMessageId: %s, parentMessageType: %s, messages count: %d, disableTools: %s',
      operationId,
      agentId,
      subAgentId,
      scope,
      effectiveAgentId,
      topicId,
      messageKey,
      parentMessageId,
      parentMessageType,
      originalMessages.length,
      disableTools,
    );
    void emitClientAgentSignalSourceEvent({
      payload: {
        agentId,
        operationId,
        parentMessageId,
        parentMessageType,
        threadId: threadId ?? undefined,
        topicId: topicId ?? undefined,
        ...(parentMessageType === 'user' ? { triggerMessageId: parentMessageId } : {}),
      },
      sourceId: `${operationId}:client:start`,
      sourceType: 'client.runtime.start',
    });

    // Create a new array to avoid modifying the original messages
    const messages = [...originalMessages];

    // Decide tool / function-calling capability from real data, not a guess.
    // The enabled-model list hydrates asynchronously (auth session → aiProvider
    // runtime-state SWR); until it's ready `isCanUseFC` optimistically assumes
    // tool use so we don't drop tools for a capable model. But this is the
    // outbound path: `createAgentToolsEngine` below bakes the tool set into the
    // payload and the `/webapi/chat/[provider]` route forwards it to the provider
    // without rechecking capability. Wait (bounded) for the list so a fast first
    // send after reload never attaches tools to a model that can't use them.
    await getAiInfraStoreState().ensureAiProviderRuntimeStateReady();

    // ===========================================
    // Step 1: Create Agent State (resolves config once)
    // ===========================================
    // agentConfig already has isSubAgent filtering applied and is passed to callLLM executor
    const {
      state: initialAgentState,
      context: initialAgentContext,
      agentConfig,
      toolsEngine,
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
      subAgentId, // Pass subAgentId for agent config retrieval (behavior depends on scope)
      isSubAgent, // Pass isSubAgent to filter out lobe-agent tool in sub-agent context
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
    log('[executeClientAgent] Creating agent runtime with config', modelRuntimeConfig);

    const contextWindowTokens = aiModelSelectors.modelContextWindowTokens(
      model,
      provider!,
    )(getAiInfraStoreState());

    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 1000 },
      compressionConfig: {
        enabled: agentConfigData.chatConfig?.enableContextCompression ?? true, // Default to enabled
        maxWindowToken: contextWindowTokens ?? undefined,
      },
      dynamicInterventionAudits,
      operationId: `${messageKey}/${params.parentMessageId}`,
      modelRuntimeConfig,
    });

    const runtime = new AgentRuntime(agent, {
      executors: createAgentExecutors({
        agentConfig, // Pass pre-resolved config to callLLM executor
        get: this.#get,
        metadata: params.metadata,
        messageKey,
        operationId,
        parentId: params.parentMessageId,
        skipCreateFirstMessage: params.skipCreateFirstMessage,
        toolsEngine, // Pass toolsEngine for dynamic tool injection via activateTools
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

    log('[executeClientAgent] Agent runtime loop start, initial phase: %s', nextContext.phase);

    // Compute contextKey for message queue (per-context, not per-operation)
    const contextKey = messageKey;

    // Execute the agent runtime loop
    let stepCount = 0;
    while (state.status !== 'done' && state.status !== 'error') {
      // Check if operation has been cancelled
      const currentOperation = this.#get().operations[operationId];
      if (currentOperation?.status === 'cancelled') {
        log('[executeClientAgent] Operation cancelled, marking state as interrupted');

        // Update state status to 'interrupted' so agent can handle abort
        state = { ...state, status: 'interrupted' };

        // Let agent handle the abort (will clean up pending tools if needed)
        const result = await runtime.step(state, nextContext);
        state = result.newState;

        log('[executeClientAgent] Operation cancelled, stopping loop');
        break;
      }

      stepCount++;

      // Compute step context from current db messages before each step
      // Use dbMessagesMap which contains persisted state (including pluginState.todos)
      const currentDBMessages = this.#get().dbMessagesMap[messageKey] || [];
      // Use selectTodosFromMessages selector (shared with UI display)
      const todos = selectTodosFromMessages(currentDBMessages);
      // Accumulate activated tool IDs from lobe-activator messages
      const activatedToolIds = selectActivatedToolIdsFromMessages(currentDBMessages)?.filter(
        (id) => scope === 'page' || id !== PageAgentIdentifier,
      );
      // Accumulate activated skills from activateSkill messages
      const activatedSkills = selectActivatedSkillsFromMessages(currentDBMessages);
      const hasQueuedMessages = (this.#get().queuedMessages[contextKey]?.length ?? 0) > 0;
      const stepContext = computeStepContext({
        activatedSkills,
        activatedToolIds,
        hasQueuedMessages,
        todos,
      });

      // If page agent is enabled, get the latest XML for stepPageEditor
      if (scope === 'page' && nextContext.initialContext?.pageEditor) {
        try {
          const pageContentContext = pageAgentRuntime.getPageContentContext('xml');
          stepContext.stepPageEditor = {
            xml: pageContentContext.xml || '',
          };
        } catch (error) {
          // Page agent runtime may not be available, ignore errors
          log('[executeClientAgent] Failed to get page XML for step: %o', error);
        }
      }

      // Inject stepContext into the runtime context for this step
      nextContext = { ...nextContext, stepContext };

      log(
        '[executeClientAgent][step-%d]: phase=%s, status=%s, state.messages=%d, dbMessagesMap[%s]=%d, stepContext=%O',
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
        '[executeClientAgent] Step %d completed, events: %d, newStatus=%s, newState.messages=%d',
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
        ['sub_agents_batch_result', 'tools_batch_result'].includes(result.nextContext?.phase)
      ) {
        log(
          `[executeClientAgent] ${result.nextContext?.phase} completed, refreshing messages to sync state`,
        );
        await this.#get().refreshMessages(context);
      }

      // Handle completion and error events
      for (const event of result.events) {
        switch (event.type) {
          case 'done': {
            log('[executeClientAgent] Received done event');
            break;
          }

          case 'human_approve_required': {
            await notifyDesktopHumanApprovalRequired(this.#get, context);
            if (topicId) {
              const statusWrite = this.#get().updateTopicStatus?.({
                agentId,
                groupId,
                ...(context.scope === 'group' || context.scope === 'group_agent'
                  ? { scope: context.scope }
                  : {}),
                status: 'waitingForHuman',
                topicId,
              });
              void statusWrite?.catch((error) => {
                console.error('[streamingExecutor] updateTopicStatus failed:', error);
              });
            }
            break;
          }

          case 'error': {
            log('[executeClientAgent] Received error event: %o', event.error);
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
          '[executeClientAgent] Operation cancelled after step %d, marking state as interrupted',
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

        log('[executeClientAgent] Operation cancelled, stopping loop');
        break;
      }

      // If no nextContext, stop execution
      if (!result.nextContext) {
        log('[executeClientAgent] No next context, stopping loop');
        break;
      }

      // Preserve initialContext when updating nextContext
      // initialContext is set once at the start and should persist through all steps
      nextContext = { ...result.nextContext, initialContext: nextContext.initialContext };
    }

    log(
      '[executeClientAgent] Agent runtime loop finished, final status: %s, total steps: %d',
      state.status,
      stepCount,
    );

    // Runtime message transports persist through quiet batch mutations. Reconcile
    // once at the run boundary instead of replacing the full list after every write.
    await this.#get().refreshMessages(context);

    // Run-completion side effects are assembled once and invoked at
    // this boundary. The bodies are relocated verbatim into `buildRunLifecycle`,
    // so the streamingExecutor characterization net stays green (behavior-preserving).
    const runScope: RunScope = scope === 'sub_agent' ? 'sub_agent' : 'top_level';
    const runLifecycle = buildRunLifecycle(this.#get, {
      context,
      parentMessageId,
      parentMessageType,
      runId: operationId,
      runScope,
      runtimeType: 'client',
    });
    const lifecycleEventBase = {
      context,
      operationId,
      runId: operationId,
      runScope,
      runtimeType: 'client' as const,
    };

    // Parked (`waiting_for_human` / `waiting_for_async_tool`) is NOT terminal:
    // route to `onRunParked`, which clears the loading UI for human approval but
    // fires NO terminal side effects (title / queue drain / notification /
    // complete signal). The run resumes under a new operation when the user
    // approves / rejects / submits / skips.
    if (isParkedStatus(state.status)) {
      await runLifecycle.onRunParked({
        ...lifecycleEventBase,
        reason: state.status as RunParkedReason,
      });
      return;
    }

    const completeEvent = { ...lifecycleEventBase, runtimeStatus: state.status };

    const { requeued } = await runLifecycle.completeRun(completeEvent);
    // A queued follow-up sendMessage was scheduled — skip the post-run notification.
    if (requeued) return;

    await runLifecycle.afterRunComplete(completeEvent);

    // Return usage and cost data for caller to use
    return { cost: state.cost, model, provider: provider ?? undefined, usage: state.usage };
  };

  /**
   * Run a sub-agent inside an isolated thread using the *current* client
   * runtime, then resolve with its final output so the calling tool can return
   * a normal tool result. This is the client-side implementation behind
   * `BuiltinToolContext.subAgent.run` — a sub-agent run is just a regular
   * `executeClientAgent` invocation scoped to a fresh Thread, with
   * `isSubAgent` set so the sub-agent can't recursively spawn more sub-agents.
   */
  runClientSubAgent = async (params: {
    agentId: string;
    description: string;
    inheritMessages?: boolean;
    instruction: string;
    parentOperationId?: string;
    toolMessageId: string;
    topicId: string;
  }): Promise<RunSubAgentResult> => {
    const {
      agentId,
      topicId,
      instruction,
      description,
      inheritMessages,
      toolMessageId,
      parentOperationId,
    } = params;

    const logId = `runClientSubAgent:${toolMessageId}`;

    try {
      // 1. Create the isolation Thread (persists thread + initial user message)
      const threadResult = await aiAgentService.createClientTaskThread({
        agentId,
        instruction,
        parentMessageId: toolMessageId,
        title: description,
        topicId,
      });

      if (!threadResult.success) {
        log('[%s] Failed to create client task thread', logId);
        return {
          error: 'Failed to create sub-agent thread',
          result: 'Failed to create sub-agent thread',
          success: false,
          threadId: '',
        };
      }

      const { threadId, userMessageId, threadMessages } = threadResult;
      log('[%s] Created thread %s, userMessage %s', logId, threadId, userMessageId);

      // Register the freshly-created isolation thread in the client thread list
      // so the tool Render can locate it (the "View Detail" button) and it shows
      // in the sidebar without waiting for a topic switch to re-fetch threads.
      void this.#get().refreshThreads();

      // 2. Build the sub-agent ConversationContext (threadId provides isolation)
      const workspaceSlug = parentOperationId
        ? this.#get().operations[parentOperationId]?.context.workspaceSlug
        : undefined;
      const subContext: ConversationContext = {
        agentId,
        isSubAgent: true,
        scope: 'thread',
        threadId,
        topicId,
        ...(workspaceSlug ? { workspaceSlug } : {}),
      };

      // 3. Create a child operation chained to the parent runtime operation
      const { operationId: taskOperationId } = this.#get().startOperation({
        context: subContext,
        metadata: { executionMode: 'client', startTime: Date.now(), taskDescription: description },
        parentOperationId,
        type: 'execClientSubAgent',
      });

      // 4. Seed the thread message map so the persisted user message renders
      this.#get().replaceMessages(threadMessages, { context: subContext });

      // 5. Optionally inherit the parent conversation messages
      let subMessages = [...threadMessages];
      if (inheritMessages) {
        const parentMessages = (
          this.#get().dbMessagesMap[messageMapKey({ agentId, topicId })] || []
        ).filter((m) => m.role !== 'task');
        subMessages = [...parentMessages, ...subMessages];
        this.#get().replaceMessages(subMessages, { context: subContext });
      }

      // 6. Run the sub-agent with the current client runtime
      const runtimeResult = await this.#get().executeClientAgent({
        context: subContext,
        isSubAgent: true,
        messages: subMessages,
        operationId: taskOperationId,
        parentMessageId: userMessageId,
        parentMessageType: 'user',
        parentOperationId,
      });

      // 7. Extract the sub-agent's final assistant output as the tool result
      const subMessageKey = messageMapKey(subContext);
      const subTaskMessages = this.#get().dbMessagesMap[subMessageKey] || [];
      const lastAssistant = subTaskMessages.findLast((m) => m.role === 'assistant');
      const resultContent = lastAssistant?.content || 'Task completed';
      const totalToolCalls = subTaskMessages.filter((m) => m.role === 'tool').length;
      const { usage, cost, model } = runtimeResult || {};
      const totalCost = cost?.total;
      const totalInputTokens = usage?.llm?.tokens?.input;
      const totalOutputTokens = usage?.llm?.tokens?.output;
      const totalTokens = usage?.llm?.tokens?.total;

      // 8. Persist final Thread status + metadata
      await aiAgentService.updateClientTaskThreadStatus({
        completionReason: 'done',
        metadata: {
          totalCost,
          totalMessages: subTaskMessages.length,
          totalTokens,
          totalToolCalls,
        },
        resultContent,
        threadId,
      });

      this.#get().completeOperation(taskOperationId);

      log('[%s] Completed, result %d chars', logId, resultContent.length);
      // Cost + the token split ride back to the caller, not just the total: they
      // land on the tool message's pluginState, which is the only place the parent's
      // usage tray can see a sub-agent's spend (its messages are in a thread the
      // parent never loads). Returning tokens alone makes a client sub-agent read as
      // free.
      return {
        model,
        result: resultContent,
        success: true,
        threadId,
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        totalToolCalls,
        totalTokens,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log('[%s] Error: %O', logId, error);
      return {
        error: errorMessage,
        result: `Sub-agent execution failed: ${errorMessage}`,
        success: false,
        threadId: '',
      };
    }
  };
}

export type StreamingExecutorAction = Pick<
  StreamingExecutorActionImpl,
  keyof StreamingExecutorActionImpl
>;
