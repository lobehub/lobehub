import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import {
  createOpenAICompatibleRuntime,
  transformResponseToStream,
} from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const params = {
  baseURL: 'https://api.cerebras.ai/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const {
        frequency_penalty: _frequencyPenalty,
        presence_penalty: _presencePenalty,
        model,
        thinking,
        reasoning,
        reasoning_effort,
        effort,
        // Extract reasoning_format so it doesn't leak into ...rest and get sent twice
        reasoning_format: _incomingReasoningFormat,
        ...rest
      } = payload as any;

      const effortVal = reasoning_effort || reasoning?.effort || effort;
      const isThinkingDisabled = thinking?.type === 'disabled' || effortVal === 'none';
      const isThinkingEnabled = thinking?.type === 'enabled' || (effortVal && effortVal !== 'none');
      const lowerModel = model.toLowerCase();

      const isGlm = lowerModel.includes('glm');
      const isGemma4 = lowerModel.includes('gemma-4');
      const isGptOss = lowerModel.includes('gpt-oss');

      const cerebrasReasoningParams: Record<string, unknown> = {};

      if (isGlm) {
        if (isThinkingDisabled) {
          cerebrasReasoningParams.reasoning_effort = 'none';
        } else {
          cerebrasReasoningParams.reasoning_format = _incomingReasoningFormat || 'parsed';
        }
      } else if (isGemma4) {
        if (isThinkingDisabled) {
          cerebrasReasoningParams.reasoning_effort = 'none';
        } else if (isThinkingEnabled) {
          cerebrasReasoningParams.reasoning_effort = 'medium';
          cerebrasReasoningParams.reasoning_format = 'parsed';
        }
      } else if (isGptOss) {
        if (isThinkingDisabled) {
          cerebrasReasoningParams.reasoning_format = 'hidden';
        } else {
          const effortMap: Record<string, string> = {
            low: 'low',
            minimal: 'low',
            medium: 'medium',
            high: 'high',
            xhigh: 'high',
            max: 'high',
          };
          cerebrasReasoningParams.reasoning_effort =
            (effortVal && effortMap[effortVal]) || 'medium';
          cerebrasReasoningParams.reasoning_format = _incomingReasoningFormat || 'parsed';
        }
      }

      // --- Reasoning context retention ---
      // Cerebras does not accept a standalone `reasoning_content` field.
      // Per docs: inject prior reasoning into the `content` of assistant messages.
      // GLM: wrap in <think>...</think> tags. GPT-OSS: prepend directly.
      const messages = ((rest.messages as any[]) || []).map((msg: any) => {
        if (msg.role !== 'assistant') return msg;

        const { reasoning_content, ...msgRest } = msg;
        if (!reasoning_content) return msg;

        const existingContent = typeof msgRest.content === 'string' ? msgRest.content : '';
        let newContent: string;
        if (isGlm) {
          newContent = `<think>${reasoning_content}</think>${existingContent}`;
        } else if (isGptOss) {
          newContent = `${reasoning_content}${existingContent}`;
        } else {
          // Gemma 4: docs don't specify a retention format; drop reasoning_content
          return msgRest;
        }

        return { ...msgRest, content: newContent };
      });

      return {
        ...rest,
        ...cerebrasReasoningParams,
        messages,
        model,
      } as any;
    },
    handleTransformResponseToStream: (data) => {
      const choices = data.choices || [];
      for (const choice of choices) {
        if (choice.message && 'reasoning' in choice.message) {
          (choice.message as any).reasoning_content = (choice.message as any).reasoning;
        }
      }
      return transformResponseToStream(data);
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_CEREBRAS_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList = Array.isArray(modelsPage?.data)
      ? modelsPage.data
      : Array.isArray(modelsPage)
        ? modelsPage
        : [];

    return await processMultiProviderModelList(modelList, 'cerebras');
  },
  provider: ModelProvider.Cerebras,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeCerebrasAI = createOpenAICompatibleRuntime(params);
