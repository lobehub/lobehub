import { stripAssistantReasoningForReplay } from '@lobechat/agent-runtime';
import {
  REQUEST_AGENT_ID_HEADER,
  REQUEST_TOPIC_ID_HEADER,
  REQUEST_TRIGGER_HEADER,
} from '@lobechat/const';
import { type FetchSSEOptions } from '@lobechat/fetch-sse';
import { fetchSSE, standardizeAnimationStyle } from '@lobechat/fetch-sse';
import type { ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { isResponsesAPIModel } from '@lobechat/model-runtime/providers/openai/modelId';
import { AgentRuntimeError } from '@lobechat/model-runtime/utils/createError';
import {
  ChatErrorType,
  getDisabledPluginIds,
  type RuntimeAdditionalContextFragment,
  type RuntimeInitialContext,
  type RuntimeStepContext,
  type TracePayload,
  TraceTagMap,
  type UIChatMessage,
} from '@lobechat/types';
import { merge } from 'es-toolkit/compat';
import { ModelProvider } from 'model-bank/modelProvider';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { getSearchConfig } from '@/helpers/getSearchConfig';
import { getAgentStoreState } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { getUserStoreState, useUserStore } from '@/store/user';
import {
  settingsSelectors,
  userGeneralSettingsSelectors,
  userProfileSelectors,
} from '@/store/user/selectors';
import { type ChatStreamPayload, type OpenAIChatMessage } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';
import { createTraceHeader } from '@/utils/trace';

import { createHeaderWithAuth } from '../_auth';
import { API_ENDPOINTS } from '../_url';
import { findDeploymentName, isEnableFetchOnClient, resolveRuntimeProvider } from './helper';
import { type ResolvedAgentConfig } from './mecha';
import {
  contextEngineering,
  getTargetAgentId,
  initializeWithClientStore,
  resolveBrowserModelParams,
} from './mecha';
import { type FetchOptions } from './types';

const providersWithDeploymentName = new Set<string>([
  ModelProvider.Azure,
  ModelProvider.AzureAI,
  ModelProvider.KimiCodingPlan,
  ModelProvider.Qwen,
  ModelProvider.Spark,
  ModelProvider.Volcengine,
  ModelProvider.VolcengineCodingPlan,
]);
export interface GetChatCompletionPayload extends Partial<Omit<ChatStreamPayload, 'messages'>> {
  additionalContexts?: readonly RuntimeAdditionalContextFragment[];
  agentId?: string;
  groupId?: string;
  messages: UIChatMessage[];
  /**
   * Pre-resolved agent config from AgentRuntime layer.
   * Required to ensure config consistency and proper isSubAgent filtering.
   */
  resolvedAgentConfig: ResolvedAgentConfig;
  topicId?: string;
}

export interface PreparedAssistantMessageContext {
  options: FetchOptions;
  params: Partial<ChatStreamPayload>;
  /** Forced or configured `preserveThinking` for the payload, when the model supports it. */
  preserveThinking?: boolean;
  /** Whether the assistant reasoning in history is replayed to the model. */
  replayAssistantReasoning: boolean;
}

type ChatStreamInputParams = Partial<Omit<ChatStreamPayload, 'messages'>> & {
  messages?: (UIChatMessage | OpenAIChatMessage)[];
};

interface FetchAITaskResultParams extends FetchSSEOptions {
  abortController?: AbortController;
  onError?: (e: Error, rawError?: any) => void;
  /**
   * Loading state change handler function
   * @param loading - Whether in loading state
   */
  onLoadingChange?: (loading: boolean) => void;
  /**
   * Request object
   */
  params: ChatStreamInputParams;
  trace?: TracePayload;
}

interface CreateAssistantMessageStream extends FetchSSEOptions {
  abortController?: AbortController;
  historySummary?: string;
  /** Initial context for page editor (captured at operation start) */
  initialContext?: RuntimeInitialContext;
  metadata?: FetchOptions['metadata'];
  params: GetChatCompletionPayload;
  /** Step context for page editor (updated each step) */
  stepContext?: RuntimeStepContext;
  trace?: TracePayload;
}

class ChatService {
  buildAssistantMessageContext = async (
    {
      messages,
      agentId,
      groupId,
      additionalContexts,
      topicId,
      resolvedAgentConfig,
      ...params
    }: GetChatCompletionPayload,
    options?: FetchOptions,
  ): Promise<PreparedAssistantMessageContext> => {
    const payload = merge(
      {
        model: DEFAULT_AGENT_CONFIG.model,
        stream: true,
        ...DEFAULT_AGENT_CONFIG.params,
      },
      params,
    );

    // =================== 1. use pre-resolved agent config =================== //
    // Config is resolved in AgentRuntime layer (internal_createAgentState)
    // which handles isSubAgent filtering, disableTools, and tools generation

    const targetAgentId = getTargetAgentId(agentId);

    // Tools are pre-generated in internal_createAgentState and passed via resolvedAgentConfig
    // This avoids duplicate toolsEngine creation and ensures disableTools is properly handled
    const {
      agentConfig,
      chatConfig,
      enabledManifests = [],
      enabledToolIds = [],
      plugins,
      tools,
    } = resolvedAgentConfig;

    // Get search config with agentId for agent-specific settings
    const searchConfig = getSearchConfig(payload.model, payload.provider!, targetAgentId);

    // =================== 1.1 process user memories =================== //

    const userLevelMemoryEnabled = settingsSelectors.memoryEnabled(getUserStoreState());
    // Agent-level memory toggle takes priority over user-level setting,
    // matching the logic in useMemoryEnabled hook
    const enableUserMemories = chatConfig.memory?.enabled ?? userLevelMemoryEnabled;
    const userMemorySettings = settingsSelectors.currentMemorySettings(getUserStoreState());
    const effectiveMemoryEffort =
      chatConfig.memory?.effort ?? userMemorySettings.effort ?? 'medium';

    // =================== 1.2 resolve model parameters =================== //

    // Make sure the user's saved model-instance reasoning config is loaded
    // before the synchronous store reads below — after a reload the
    // ReasoningConfigLoader SWR fetch may still be in flight when the user
    // sends the first message. No-op once cached; failures fall back to
    // level defaults.
    await getAiInfraStoreState().ensureModelReasoningConfig(payload.model, payload.provider!);

    // Which extend params apply, where the reasoning effort comes from,
    // whether assistant reasoning is replayed, the history window and the
    // stream flag are decided by the shared rules — the same ones the server
    // runtime applies — over the browser's stores.
    const modelParams = await resolveBrowserModelParams({
      agentId: targetAgentId,
      chatConfig,
      groupId,
      model: payload.model,
      provider: payload.provider!,
      searchDecision: searchConfig,
      subAgentChatConfigOverride: resolvedAgentConfig.subAgentChatConfigOverride,
      topicId,
    });
    const messagesForContext = modelParams.shouldReplayAssistantReasoning
      ? messages
      : stripAssistantReasoningForReplay(messages);

    // The context builder reads the agent's knowledge files straight from the
    // config and skips any whose parse has not run, so an unparsed file would be
    // missing from the prompt without a trace. Hydrate those first; the call
    // resolves even when an individual parse fails.
    await getAgentStoreState().ensureAgentFileContents(targetAgentId, options?.signal);

    // Apply context engineering with preprocessing configuration
    // Note: agentConfig.systemRole is already resolved by resolveAgentConfig for builtin agents
    const modelMessages = await contextEngineering({
      agentId: targetAgentId,
      // `agentConfig.plugins` is the raw (pre-filter) field — `plugins` below
      // is already pinned-only (resolved upstream in agentConfigResolver).
      disabledPluginIds: getDisabledPluginIds(agentConfig.plugins),
      // The stored mode passes through: a model without function calling is
      // not demoted to chat mode here, matching the server runtime.
      enableAgentMode: modelParams.enableAgentMode,
      // Use raw chatConfig values, not selectors with business logic that may force false
      enableHistoryCount: chatConfig.enableHistoryCount,
      enableUserMemories,
      groupId,
      additionalContexts,
      // History messages + the current turn; unset means no truncation.
      historyCount: modelParams.historyCount,
      // Page editor context from agent runtime
      initialContext: options?.initialContext,
      inputTemplate: chatConfig.inputTemplate,
      manifests: enabledManifests,
      messages: messagesForContext,
      model: payload.model,
      plugins,
      provider: payload.provider!,
      sessionId: options?.trace?.sessionId,
      stepContext: options?.stepContext,
      systemRole: agentConfig.systemRole,
      tools: enabledToolIds,
      topicId,
      memoryContext: {
        effort: effectiveMemoryEffort,
      },
    });

    return {
      options: { ...options, agentId: targetAgentId, topicId },
      params: {
        ...params,
        ...modelParams.resolvedExtendParams,
        // Always present on the browser payload, even when unset.
        enabledSearch: modelParams.resolvedExtendParams?.enabledSearch,
        messages: modelMessages,
        stream: modelParams.stream,
        tools,
      },
      preserveThinking: modelParams.preserveThinkingForPayload,
      replayAssistantReasoning: modelParams.shouldReplayAssistantReasoning,
    };
  };

  createAssistantMessage = async (params: GetChatCompletionPayload, options?: FetchOptions) => {
    const prepared = await this.buildAssistantMessageContext(params, options);

    return this.getChatCompletion(prepared.params, prepared.options);
  };

  createAssistantMessageStream = async ({
    params,
    abortController,
    onAbort,
    onMessageHandle,
    onErrorHandle,
    onFinish,
    metadata,
    trace,
    historySummary,
    initialContext,
    stepContext,
  }: CreateAssistantMessageStream) => {
    await this.createAssistantMessage(params, {
      historySummary,
      initialContext,
      onAbort,
      onErrorHandle,
      onFinish,
      onMessageHandle,
      metadata,
      signal: abortController?.signal,
      stepContext,
      trace: this.mapChatTrace(trace),
    });
  };

  mapChatTrace = (trace?: TracePayload): TracePayload => this.mapTrace(trace, TraceTagMap.Chat);

  getChatCompletion = async (params: Partial<ChatStreamPayload>, options?: FetchOptions) => {
    const { agentId, metadata, signal, responseAnimation, topicId } = options ?? {};
    const requestTrigger = metadata?.trigger;

    const { provider = ModelProvider.OpenAI, ...res } = params;

    // =================== process model =================== //
    // ===================================================== //
    let model = res.model || DEFAULT_AGENT_CONFIG.model;
    const deploymentName = providersWithDeploymentName.has(provider)
      ? findDeploymentName(model, provider)
      : undefined;
    const shouldUseDeploymentField =
      (provider === ModelProvider.Azure && isResponsesAPIModel(model)) ||
      provider === ModelProvider.Spark;

    if (!shouldUseDeploymentField && deploymentName) {
      model = deploymentName;
    }

    // When user explicitly disables Responses API, set apiMode to 'chatCompletion'
    // This ensures the user's preference takes priority over provider's useResponseModels config
    // When user enables Responses API, set to 'responses' to force use Responses API
    const apiMode: 'responses' | 'chatCompletion' = aiProviderSelectors.isProviderEnableResponseApi(
      provider,
    )(getAiInfraStoreState())
      ? 'responses'
      : 'chatCompletion';

    // Get the chat config to check streaming preference
    const chatConfig = agentChatConfigSelectors.currentChatConfig(getAgentStoreState());

    delete (res as any).scope;
    // Fork flow stores market metadata in agent.params; must not reach OpenAI-compatible / Responses API
    delete (res as any).forkedFromIdentifier;

    const payload = merge(
      {
        model: DEFAULT_AGENT_CONFIG.model,
        stream: chatConfig.enableStreaming !== false, // Default to true if not set
        ...DEFAULT_AGENT_CONFIG.params,
      },
      {
        ...res,
        apiMode,
        ...(shouldUseDeploymentField &&
          deploymentName &&
          deploymentName !== model && { deploymentName }),
        model,
      },
    );

    // Convert null to undefined for model params to prevent sending null values to API
    if (payload.temperature === null) payload.temperature = undefined;
    if (payload.top_p === null) payload.top_p = undefined;
    if (payload.presence_penalty === null) payload.presence_penalty = undefined;
    if (payload.frequency_penalty === null) payload.frequency_penalty = undefined;

    const sdkType = resolveRuntimeProvider(provider);

    /**
     * Use browser agent runtime
     */
    const enableFetchOnClient = isEnableFetchOnClient(provider);

    let fetcher: typeof fetch | undefined = undefined;

    if (enableFetchOnClient) {
      /**
       * Notes:
       * 1. Browser agent runtime will skip auth check if a key and endpoint provided by
       *    user which will cause abuse of plugins services
       * 2. This feature will be disabled by default
       */
      fetcher = async () => {
        try {
          return await this.fetchOnClient({
            payload,
            provider,
            runtimeProvider: sdkType,
            signal,
            topicId,
          });
        } catch (e) {
          const {
            errorType = ChatErrorType.BadRequest,
            error: errorContent,
            ...res
          } = e as ChatCompletionErrorPayload;

          const error = errorContent || e;
          // track the error at server side
          console.error(`Route: [${provider}] ${errorType}:`, error);

          return createErrorResponse(errorType, { error, ...res, provider });
        }
      };
    }

    const traceHeader = createTraceHeader({ ...options?.trace });

    const headers = await createHeaderWithAuth({
      headers: {
        'Content-Type': 'application/json',
        ...traceHeader,
        ...(agentId && { [REQUEST_AGENT_ID_HEADER]: agentId }),
        ...(requestTrigger && { [REQUEST_TRIGGER_HEADER]: requestTrigger }),
        ...(topicId && { [REQUEST_TOPIC_ID_HEADER]: topicId }),
      },
      provider,
    });
    const { getBusinessTrpcHeaders } = await import('@/business/client/trpc-headers');
    Object.assign(headers as Record<string, string>, await getBusinessTrpcHeaders());

    const { DEFAULT_MODEL_PROVIDER_LIST } = await import('model-bank/modelProviders');
    const providerConfig = DEFAULT_MODEL_PROVIDER_LIST.find((item) => item.id === provider);

    const userPreferTransitionMode =
      userGeneralSettingsSelectors.transitionMode(getUserStoreState());

    // The order of the array is very important.
    const mergedResponseAnimation = [
      providerConfig?.settings?.responseAnimation || {},
      userPreferTransitionMode,
      responseAnimation,
    ].reduce((acc, cur) => merge(acc, standardizeAnimationStyle(cur)), {});

    return fetchSSE(API_ENDPOINTS.chat(provider), {
      body: JSON.stringify(payload),
      fetcher,
      headers,
      method: 'POST',
      onAbort: options?.onAbort,
      onErrorHandle: options?.onErrorHandle,
      onFinish: options?.onFinish,
      onMessageHandle: options?.onMessageHandle,
      requestContext: {
        apiMode,
        fetchOnClient: enableFetchOnClient,
        model,
        provider,
      },
      responseAnimation: mergedResponseAnimation,
      signal,
    });
  };

  fetchPresetTaskResult = async ({
    params,
    onMessageHandle,
    onFinish,
    onError,
    onLoadingChange,
    abortController,
    trace,
  }: FetchAITaskResultParams) => {
    const errorHandle = (error: Error, errorContent?: any) => {
      onLoadingChange?.(false);
      if (abortController?.signal.aborted) {
        return;
      }
      onError?.(error, errorContent);
      console.error(error);
    };

    onLoadingChange?.(true);

    try {
      const llmMessages = await contextEngineering({
        messages: params.messages as any,
        model: params.model!,
        provider: params.provider!,
      });

      await this.getChatCompletion(
        { ...params, messages: llmMessages },
        {
          onErrorHandle: (error) => {
            errorHandle(new Error(error.message), error);
          },
          onFinish,
          onMessageHandle,
          signal: abortController?.signal,
          trace: this.mapTrace(trace, TraceTagMap.SystemChain),
        },
      );

      onLoadingChange?.(false);
    } catch (e) {
      errorHandle(e as Error);
    }
  };

  private mapTrace = (trace?: TracePayload, tag?: TraceTagMap): TracePayload => {
    const tags = agentSelectors.currentAgentMeta(getAgentStoreState()).tags || [];

    const enabled = userGeneralSettingsSelectors.telemetry(getUserStoreState());

    if (!enabled) return { ...trace, enabled: false };

    return {
      ...trace,
      enabled: true,
      tags: [tag, ...(trace?.tags || []), ...tags].filter(Boolean) as string[],
      userId: userProfileSelectors.userId(useUserStore.getState()),
    };
  };

  /**
   * Fetch chat completion on the client side.

   */
  private fetchOnClient = async (params: {
    payload: Partial<ChatStreamPayload>;
    provider: string;
    runtimeProvider: string;
    signal?: AbortSignal;
    topicId?: string;
  }) => {
    /**
     * if enable login and not signed in, return unauthorized error
     */
    const userStore = useUserStore.getState();
    if (!userStore.isSignedIn) {
      throw AgentRuntimeError.createError(ChatErrorType.InvalidAccessCode);
    }

    const agentRuntime = await initializeWithClientStore({
      payload: params.payload,
      provider: params.provider,
      runtimeProvider: params.runtimeProvider,
    });
    const data = params.payload as ChatStreamPayload;

    return agentRuntime.chat(data, {
      metadata: { topicId: params.topicId },
      signal: params.signal,
    });
  };
}

export const chatService = new ChatService();
