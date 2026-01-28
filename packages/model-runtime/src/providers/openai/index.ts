import { ModelProvider } from 'model-bank';

import { responsesAPIModels } from '../../const/models';
import { pruneReasoningPayload } from '../../core/contextBuilders/openai';
import {
  OpenAICompatibleFactoryOptions,
  createOpenAICompatibleRuntime,
} from '../../core/openaiCompatibleFactory';
import { ChatStreamPayload } from '../../types';
import { processMultiProviderModelList } from '../../utils/modelParse';

export interface OpenAIModelCard {
  id: string;
}

const prunePrefixes = ['o1', 'o3', 'o4', 'codex', 'computer-use', 'gpt-5'];
const oaiSearchContextSize = process.env.OPENAI_SEARCH_CONTEXT_SIZE; // low, medium, high
const enableServiceTierFlex = process.env.OPENAI_SERVICE_TIER_FLEX === '1';
const flexSupportedModels = ['gpt-5', 'o3', 'o4-mini']; // Flex tier is only available for these models

const supportsFlexTier = (model: string) => {
  // Exclude o3-mini, which does not support Flex tier
  if (model.startsWith('o3-mini')) {
    return false;
  }
  return flexSupportedModels.some((supportedModel) => model.startsWith(supportedModel));
};

export const params = {
  baseURL: 'https://api.openai.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { enabledSearch, model, ...rest } = payload;

      // Transform reasoning object to reasoning_content string for models that require it
      // This is needed for models like deepseek-reasoner and kimi when used under OpenAI provider
      const messages = payload.messages.map((message: any) => {
        // Only transform if message has reasoning.content
        if (message.reasoning?.content) {
          const { reasoning, ...restMessage } = message;
          return {
            ...restMessage,
            reasoning_content: reasoning.content,
          };
        }
        // If message has reasoning but no content, remove reasoning field entirely
        if (message.reasoning) {
          const { reasoning, ...restMessage } = message;
          return restMessage;
        }
        return message;
      });

      if (responsesAPIModels.has(model) || enabledSearch) {
        return { ...rest, apiMode: 'responses', enabledSearch, messages, model } as ChatStreamPayload;
      }

      if (prunePrefixes.some((prefix) => model.startsWith(prefix))) {
        return pruneReasoningPayload({ ...payload, messages }) as any;
      }

      if (model.includes('-search-')) {
        return {
          ...rest,
          frequency_penalty: undefined,
          messages,
          model,
          presence_penalty: undefined,
          stream: payload.stream ?? true,
          temperature: undefined,
          top_p: undefined,
          ...(enableServiceTierFlex && supportsFlexTier(model) && { service_tier: 'flex' }),
          ...(oaiSearchContextSize && {
            web_search_options: {
              search_context_size: oaiSearchContextSize,
            },
          }),
        } as any;
      }

      return {
        ...rest,
        messages,
        model,
        ...(enableServiceTierFlex && supportsFlexTier(model) && { service_tier: 'flex' }),
        stream: payload.stream ?? true,
      };
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENAI_CHAT_COMPLETION === '1',
    responses: () => process.env.DEBUG_OPENAI_RESPONSES === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: OpenAIModelCard[] = modelsPage.data;

    // Automatically detect model provider and select corresponding configuration
    return processMultiProviderModelList(modelList, 'openai');
  },
  provider: ModelProvider.OpenAI,
  responses: {
    handlePayload: (payload) => {
      const { enabledSearch, model, tools, verbosity, ...rest } = payload;

      // Transform reasoning object to reasoning_content string for models that require it
      const messages = payload.messages.map((message: any) => {
        // Only transform if message has reasoning.content
        if (message.reasoning?.content) {
          const { reasoning, ...restMessage } = message;
          return {
            ...restMessage,
            reasoning_content: reasoning.content,
          };
        }
        // If message has reasoning but no content, remove reasoning field entirely
        if (message.reasoning) {
          const { reasoning, ...restMessage } = message;
          return restMessage;
        }
        return message;
      });

      const openaiTools = enabledSearch
        ? [
            ...(tools || []),
            {
              type: 'web_search',
              ...(oaiSearchContextSize && {
                search_context_size: oaiSearchContextSize,
              }),
            },
          ]
        : tools;

      if (prunePrefixes.some((prefix) => model.startsWith(prefix))) {
        const reasoning = payload.reasoning
          ? { ...payload.reasoning, summary: 'auto' }
          : { summary: 'auto' };
        if (model.startsWith('gpt-5-pro')) {
          reasoning.effort = 'high';
        }
        return pruneReasoningPayload({
          ...rest,
          messages,
          model,
          reasoning,
          ...(enableServiceTierFlex && supportsFlexTier(model) && { service_tier: 'flex' }),
          stream: payload.stream ?? true,
          tools: openaiTools as any,
          // computer-use series must set truncation as auto
          ...(model.startsWith('computer-use') && { truncation: 'auto' }),
          text: verbosity ? { verbosity } : undefined,
        }) as any;
      }

      return {
        ...rest,
        messages,
        model,
        ...(enableServiceTierFlex && supportsFlexTier(model) && { service_tier: 'flex' }),
        stream: payload.stream ?? true,
        tools: openaiTools,
      } as any;
    },
  },
} satisfies OpenAICompatibleFactoryOptions;

export const LobeOpenAI = createOpenAICompatibleRuntime(params);
