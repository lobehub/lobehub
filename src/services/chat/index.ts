import {
  REQUEST_AGENT_ID_HEADER,
  REQUEST_TOPIC_ID_HEADER,
  REQUEST_TRIGGER_HEADER,
} from '@lobechat/const';
import { type FetchSSEOptions } from '@lobechat/fetch-sse';
import { fetchSSE, standardizeAnimationStyle } from '@lobechat/fetch-sse';
import { isResponsesAPIModel } from '@lobechat/model-runtime/providers/openai/modelId';
import {
  type ChatMessageError,
  type RequestTrigger,
  type TracePayload,
  TraceTagMap,
} from '@lobechat/types';
import { merge } from 'es-toolkit/compat';
import { ModelProvider } from 'model-bank/modelProvider';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { oneShotRelay } from '@/services/llmRelay';
import { getAgentStoreState } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { getUserStoreState, useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors, userProfileSelectors } from '@/store/user/selectors';
import { type ChatStreamPayload } from '@/types/openai/chat';
import { createTraceHeader } from '@/utils/trace';

import { createHeaderWithAuth } from '../_auth';
import { API_ENDPOINTS } from '../_url';
import { findDeploymentName } from './helper';
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

interface FetchAITaskResultParams extends FetchSSEOptions {
  abortController?: AbortController;
  onError?: (e: Error, rawError?: any) => void;
  /**
   * Loading state change handler function
   * @param loading - Whether in loading state
   */
  onLoadingChange?: (loading: boolean) => void;
  /**
   * Request object. The messages are the task's complete prompt and are sent as-is.
   */
  params: Partial<ChatStreamPayload>;
  trace?: TracePayload;
  /**
   * Request source recorded on spend / route-attempt logs. Required so every
   * preset task names its own feature instead of being counted as `chat`.
   */
  trigger: RequestTrigger;
}

/**
 * A relayed call that fails on the device reaches the stream as its executor's
 * error (`{ provider, errorType, error }`), not the `ChatMessageError`
 * (`{ type, body, message }`) the legacy browser path produced for the same
 * failure. Callers read `type` / `body.error` (the Ollama error views, the
 * provider checker), so give them that shape again.
 */
const toRelayedChatError = (error: ChatMessageError): ChatMessageError => {
  const relayed = error as unknown as {
    error?: { message?: unknown };
    errorType?: unknown;
    message?: unknown;
    type?: unknown;
  };
  if (!relayed || typeof relayed !== 'object' || relayed.type || !relayed.errorType) return error;
  const message =
    (typeof relayed.error?.message === 'string' && relayed.error.message) ||
    (typeof relayed.message === 'string' && relayed.message) ||
    String(relayed.errorType);
  return { body: relayed, message, type: relayed.errorType as ChatMessageError['type'] };
};

class ChatService {
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

    return oneShotRelay.run(
      // A provider only this device reaches: the server makes the call and
      // relays it back to this tab (one-shot relay), so the browser never dials
      // the provider on its own. `run` decides once the provider state is
      // loaded — a custom provider is device-only by settings that arrive late.
      provider,
      (relay) =>
        fetchSSE(API_ENDPOINTS.chat(provider), {
          body: JSON.stringify(payload),
          headers: relay ? { ...(headers as Record<string, string>), ...relay.headers } : headers,
          method: 'POST',
          onAbort: options?.onAbort,
          onErrorHandle:
            relay && options?.onErrorHandle
              ? (error) => options.onErrorHandle!(toRelayedChatError(error))
              : options?.onErrorHandle,
          onFinish: options?.onFinish,
          onMessageHandle: options?.onMessageHandle,
          requestContext: { apiMode, model, provider },
          responseAnimation: mergedResponseAnimation,
          signal,
        }),
      { signal },
    );
  };

  fetchPresetTaskResult = async ({
    params,
    onMessageHandle,
    onFinish,
    onError,
    onLoadingChange,
    abortController,
    trace,
    trigger,
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
      // A preset task (translate, compress, rewrite, …) carries its own complete
      // prompt. Running it through the agent context pipeline would mix in the
      // current agent's identity, workspace and management context, which small
      // models echo back verbatim.
      await this.getChatCompletion(params, {
        metadata: { trigger },
        onErrorHandle: (error) => {
          errorHandle(new Error(error.message), error);
        },
        onFinish,
        onMessageHandle,
        signal: abortController?.signal,
        trace: this.mapTrace(trace, TraceTagMap.SystemChain),
      });

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
}

export const chatService = new ChatService();
