import type Anthropic from '@anthropic-ai/sdk';
import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import {
  buildDefaultAnthropicPayload,
  createAnthropicCompatibleParams,
  createAnthropicCompatibleRuntime,
} from '../../core/anthropicCompatibleFactory';
import { ChatStreamPayload } from '../../types';
import { getModelPropertyWithFallback } from '../../utils/getFallbackModelProperty';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

export interface MoonshotModelCard {
  id: string;
}

const DEFAULT_MOONSHOT_BASE_URL = 'https://api.moonshot.ai/anthropic';

const normalizeMoonshotMessages = (messages: ChatStreamPayload['messages']) =>
  messages.map((message) => {
    if (message.role !== 'assistant') return message;
    if (message.content !== '' && message.content !== null && message.content !== undefined)
      return message;

    /** Add a non-empty placeholder to preserve assistant turn ordering (#8418). */
    return { ...message, content: [{ text: ' ', type: 'text' as const }] };
  });

const appendMoonshotSearchTool = (
  tools: Anthropic.MessageCreateParams['tools'] | undefined,
  enabledSearch?: boolean,
) => {
  if (!enabledSearch) return tools;

  const moonshotSearchTool = {
    function: { name: '$web_search' },
    type: 'builtin_function',
  } as any;

  return tools?.length ? [...tools, moonshotSearchTool] : [moonshotSearchTool];
};

const buildMoonshotPayload = async (
  payload: ChatStreamPayload,
): Promise<Anthropic.MessageCreateParams> => {
  const normalizedMessages = normalizeMoonshotMessages(payload.messages);
  const resolvedMaxTokens =
    payload.max_tokens ??
    (await getModelPropertyWithFallback<number | undefined>(
      payload.model,
      'maxOutput',
      ModelProvider.Moonshot,
    )) ??
    8192;

  const basePayload = await buildDefaultAnthropicPayload({
    ...payload,
    enabledSearch: false,
    max_tokens: resolvedMaxTokens,
    messages: normalizedMessages,
  });

  const tools = appendMoonshotSearchTool(basePayload.tools, payload.enabledSearch);
  const basePayloadWithSearch = { ...basePayload, tools };

  const isK25Model = payload.model === 'kimi-k2.5';
  if (!isK25Model) return basePayloadWithSearch;

  const resolvedThinkingBudget = payload.thinking?.budget_tokens
    ? Math.min(payload.thinking.budget_tokens, resolvedMaxTokens - 1)
    : 1024;
  const thinkingParam =
    payload.thinking?.type === 'disabled'
      ? ({ type: 'disabled' } as const)
      : ({ budget_tokens: resolvedThinkingBudget, type: 'enabled' } as const);
  const isThinkingEnabled = thinkingParam.type === 'enabled';

  return {
    ...basePayloadWithSearch,
    temperature: isThinkingEnabled ? 1 : 0.6,
    thinking: thinkingParam,
    top_p: 0.95,
  };
};

const fetchMoonshotModels = async ({
  apiKey,
  baseURL,
}: {
  apiKey?: string;
  baseURL: string;
}): Promise<ChatModelCard[]> => {
  if (!apiKey) {
    throw new Error('Missing Moonshot API key for model listing');
  }

  const response = await fetch(`${baseURL}/v1/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Moonshot models: ${response.status} ${response.statusText}`);
  }

  const modelsPage = (await response.json()) as { data?: MoonshotModelCard[] };
  const modelList = modelsPage.data || [];

  return processModelList(modelList, MODEL_LIST_CONFIGS.moonshot, 'moonshot');
};

export const params = createAnthropicCompatibleParams({
  baseURL: DEFAULT_MOONSHOT_BASE_URL,
  chatCompletion: {
    handlePayload: buildMoonshotPayload,
  },
  customClient: {},
  debug: {
    chatCompletion: () => process.env.DEBUG_MOONSHOT_CHAT_COMPLETION === '1',
  },
  models: fetchMoonshotModels,
  provider: ModelProvider.Moonshot,
});

export const LobeMoonshotAI = createAnthropicCompatibleRuntime(params);
