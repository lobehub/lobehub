import { AgentBuilderIdentifier } from '@lobechat/builtin-tool-agent-builder';
import { KLAVIS_SERVER_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { type OfficialToolItem } from '@lobechat/context-engine';
import { type FetchSSEOptions } from '@lobechat/fetch-sse';
import { fetchSSE, getMessageError, standardizeAnimationStyle } from '@lobechat/fetch-sse';
import { type ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { AgentRuntimeError } from '@lobechat/model-runtime';
import {
  type RuntimeInitialContext,
  type RuntimeStepContext,
  type TracePayload,
  type UIChatMessage,
} from '@lobechat/types';
import { ChatErrorType, TraceTagMap } from '@lobechat/types';
import { type PluginRequestPayload } from '@lobehub/chat-plugin-sdk';
import { createHeadersWithPluginSettings } from '@lobehub/chat-plugin-sdk';
import { merge } from 'es-toolkit/compat';
import { ModelProvider } from 'model-bank';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { getSearchConfig } from '@/helpers/getSearchConfig';
import { getAgentStoreState } from '@/store/agent';
import {
  agentByIdSelectors,
  agentChatConfigSelectors,
  agentSelectors,
  chatConfigByIdSelectors,
} from '@/store/agent/selectors';
import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { getChatStoreState } from '@/store/chat';
import { getToolStoreState } from '@/store/tool';
import {
  builtinToolSelectors,
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { getUserStoreState, useUserStore } from '@/store/user';
import {
  settingsSelectors,
  userGeneralSettingsSelectors,
  userProfileSelectors,
} from '@/store/user/selectors';
import { type ChatStreamPayload, type OpenAIChatMessage } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';
import { createTraceHeader, getTraceId } from '@/utils/trace';

import { createHeaderWithAuth } from '../_auth';
import { API_ENDPOINTS } from '../_url';
import { findDeploymentName, isEnableFetchOnClient, resolveRuntimeProvider } from './helper';
import { type ResolvedAgentConfig } from './mecha';
import {
  contextEngineering,
  getTargetAgentId,
  initializeWithClientStore,
  resolveModelExtendParams,
} from './mecha';
import { type FetchOptions } from './types';

interface GetChatCompletionPayload extends Partial<Omit<ChatStreamPayload, 'messages'>> {
  agentId?: string;
  groupId?: string;
  messages: UIChatMessage[];
  /**
   * Pre-resolved agent config from AgentRuntime layer.
   * Required to ensure config consistency and proper isSubTask filtering.
   */
  resolvedAgentConfig: ResolvedAgentConfig;
  topicId?: string;
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
  params: GetChatCompletionPayload;
  /** Step context for page editor (updated each step) */
  stepContext?: RuntimeStepContext;
  trace?: TracePayload;
}

class ChatService {
  createAssistantMessage = async (
    {
      messages,
      agentId,
      groupId,
      topicId,
      resolvedAgentConfig,
      ...params
    }: GetChatCompletionPayload,
    options?: FetchOptions,
  ) => {
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
    // which handles isSubTask filtering, disableTools, and tools generation

    const targetAgentId = getTargetAgentId(agentId);

    // Tools are pre-generated in internal_createAgentState and passed via resolvedAgentConfig
    // This avoids duplicate toolsEngine creation and ensures disableTools is properly handled
    const {
      agentConfig,
      chatConfig,
      enabledManifests = [],
      enabledToolIds = [],
      tools,
    } = resolvedAgentConfig;

    // Get search config with agentId for agent-specific settings
    const searchConfig = getSearchConfig(payload.model, payload.provider!, targetAgentId);

    // =================== 1.1 process user memories =================== //

    const enableUserMemories = settingsSelectors.memoryEnabled(getUserStoreState());

    // =================== 1.2 build agent builder context =================== //

    // Check if Agent Builder tool is enabled and build context for it
    // Note: When Agent Builder is active, we need to get the context of the agent being edited,
    // which is stored in chatStore.activeAgentId, not the targetAgentId (which is the Agent Builder itself)
    const isAgentBuilderEnabled = enabledToolIds.includes(AgentBuilderIdentifier);
    let agentBuilderContext;

    if (isAgentBuilderEnabled) {
      const activeAgentId = getChatStoreState().activeAgentId || '';
      const baseContext =
        agentByIdSelectors.getAgentBuilderContextById(activeAgentId)(getAgentStoreState());

      // Build official tools list (builtin tools + Klavis tools)
      const toolState = getToolStoreState();
      const enabledPlugins =
        agentSelectors.getAgentConfigById(activeAgentId)(getAgentStoreState()).plugins || [];

      const officialTools: OfficialToolItem[] = [];

      // Get builtin tools (excluding Klavis tools)
      const builtinTools = builtinToolSelectors.metaList(toolState);
      const klavisIdentifiers = new Set(KLAVIS_SERVER_TYPES.map((t) => t.identifier));

      for (const tool of builtinTools) {
        // Skip Klavis tools in builtin list (they'll be shown separately)
        if (klavisIdentifiers.has(tool.identifier)) continue;

        officialTools.push({
          description: tool.meta?.description,
          enabled: enabledPlugins.includes(tool.identifier),
          identifier: tool.identifier,
          installed: true,
          name: tool.meta?.title || tool.identifier,
          type: 'builtin',
        });
      }

      // Get Klavis tools (if enabled)
      const isKlavisEnabled =
        typeof window !== 'undefined' &&
        window.global_serverConfigStore?.getState()?.serverConfig?.enableKlavis;

      if (isKlavisEnabled) {
        const allKlavisServers = klavisStoreSelectors.getServers(toolState);

        for (const klavisType of KLAVIS_SERVER_TYPES) {
          const server = allKlavisServers.find((s) => s.identifier === klavisType.identifier);

          officialTools.push({
            description: `LobeHub Mcp Server: ${klavisType.label}`,
            enabled: enabledPlugins.includes(klavisType.identifier),
            identifier: klavisType.identifier,
            installed: !!server,
            name: klavisType.label,
            type: 'klavis',
          });
        }
      }

      // Get LobehubSkill providers (if enabled)
      const isLobehubSkillEnabled =
        typeof window !== 'undefined' &&
        window.global_serverConfigStore?.getState()?.serverConfig?.enableLobehubSkill;

      if (isLobehubSkillEnabled) {
        const allLobehubSkillServers = lobehubSkillStoreSelectors.getServers(toolState);

        for (const provider of LOBEHUB_SKILL_PROVIDERS) {
          const server = allLobehubSkillServers.find((s) => s.identifier === provider.id);

          officialTools.push({
            description: `LobeHub Skill Provider: ${provider.label}`,
            enabled: enabledPlugins.includes(provider.id),
            identifier: provider.id,
            installed: !!server,
            name: provider.label,
            type: 'lobehub-skill',
          });
        }
      }

      agentBuilderContext = {
        ...baseContext,
        officialTools,
      };
    }

    // Apply context engineering with preprocessing configuration
    // Note: agentConfig.systemRole is already resolved by resolveAgentConfig for builtin agents
    const modelMessages = await contextEngineering({
      agentBuilderContext,
      agentId: targetAgentId,
      enableHistoryCount:
        chatConfigByIdSelectors.getEnableHistoryCountById(targetAgentId)(getAgentStoreState()),
      enableUserMemories,
      groupId,
      historyCount:
        chatConfigByIdSelectors.getHistoryCountById(targetAgentId)(getAgentStoreState()) + 2,
      // Page editor context from agent runtime
      initialContext: options?.initialContext,
      inputTemplate: chatConfig.inputTemplate,
      manifests: enabledManifests,
      messages,
      model: payload.model,
      provider: payload.provider!,
      sessionId: options?.trace?.sessionId,
      stepContext: options?.stepContext,
      systemRole: agentConfig.systemRole,
      tools: enabledToolIds,
      topicId,
    });

    // ============  3. process extend params   ============ //

    const extendParams = resolveModelExtendParams({
      chatConfig,
      model: payload.model,
      provider: payload.provider!,
    });

    return this.getChatCompletion(
      {
        ...params,
        ...extendParams,
        enabledSearch: searchConfig.enabledSearch && searchConfig.useModelSearch ? true : undefined,
        messages: modelMessages,
        // Use the chatConfig from the target agent for streaming preference
        stream: chatConfig.enableStreaming !== false,
        tools,
      },
      { ...options, agentId: targetAgentId, topicId },
    );
  };

  createAssistantMessageStream = async ({
    params,
    abortController,
    onAbort,
    onMessageHandle,
    onErrorHandle,
    onFinish,
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
      signal: abortController?.signal,
      stepContext,
      trace: this.mapTrace(trace, TraceTagMap.Chat),
    });
  };

  getChatCompletion = async (params: Partial<ChatStreamPayload>, options?: FetchOptions) => {
    const { agentId, signal, responseAnimation, topicId } = options ?? {};

    const { provider = ModelProvider.OpenAI, ...res } = params;

    // =================== process model =================== //
    // ===================================================== //
    let model = res.model || DEFAULT_AGENT_CONFIG.model;

    // if the provider is Azure, get the deployment name as the request model
    const providersWithDeploymentName = [
      ModelProvider.Azure,
      ModelProvider.Volcengine,
      ModelProvider.AzureAI,
      ModelProvider.Qwen,
    ] as string[];

    if (providersWithDeploymentName.includes(provider)) {
      model = findDeploymentName(model, provider);
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

    const payload = merge(
      {
        model: DEFAULT_AGENT_CONFIG.model,
        stream: chatConfig.enableStreaming !== false, // Default to true if not set
        ...DEFAULT_AGENT_CONFIG.params,
      },
      { ...res, apiMode, model },
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
          return await this.fetchOnClient({ payload, provider, runtimeProvider: sdkType, signal });
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
        ...(agentId && { 'x-agent-id': agentId }),
        ...(topicId && { 'x-topic-id': topicId }),
      },
      provider,
    });

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
      fetcher: fetcher,
      headers,
      method: 'POST',
      onAbort: options?.onAbort,
      onErrorHandle: options?.onErrorHandle,
      onFinish: options?.onFinish,
      onMessageHandle: options?.onMessageHandle,
      responseAnimation: mergedResponseAnimation,
      signal,
    });
  };

  /**
   * run the plugin api to get result
   * @param params
   * @param options
   */
  runPluginApi = async (params: PluginRequestPayload, options?: FetchOptions) => {
    const s = getToolStoreState();

    const settings = pluginSelectors.getPluginSettingsById(params.identifier)(s);
    const manifest = pluginSelectors.getToolManifestById(params.identifier)(s);

    const traceHeader = createTraceHeader(this.mapTrace(options?.trace, TraceTagMap.ToolCalling));

    const headers = await createHeaderWithAuth({
      headers: { ...createHeadersWithPluginSettings(settings), ...traceHeader },
    });

    const gatewayURL = manifest?.gateway ?? API_ENDPOINTS.gateway;

    const res = await fetch(gatewayURL, {
      body: JSON.stringify({ ...params, manifest }),
      headers,
      method: 'POST',
      signal: options?.signal,
    });

    if (!res.ok) {
      throw await getMessageError(res);
    }

    const text = await res.text();
    return { text, traceId: getTraceId(res) };
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

    return agentRuntime.chat(data, { signal: params.signal });
  };
}

export const chatService = new ChatService();
