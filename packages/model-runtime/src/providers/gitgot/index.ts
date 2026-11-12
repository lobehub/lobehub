import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

export const params = {
  baseURL: 'https://inference.gitgot.ai/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const { thinking, reasoning, reasoning_effort, effort, model, ...rest } = payload as any;

      const effortVal = reasoning_effort || reasoning?.effort || effort;
      const thinkingOff = thinking?.type === 'disabled' || effortVal === 'none';

      // `reasoning_effort` means three different things here because the models
      // differ, and sending one shape to all of them gets a control that
      // silently does nothing:
      //
      //   gpt-oss   grades on low/medium/high
      //   DeepSeek  treats the field as on/off — the value is ignored, and
      //             omitting it is the only way to turn reasoning off
      //   Kimi      always reasons; nothing sent changes it
      const lowerModel = String(model).toLowerCase();
      const isDeepSeek = lowerModel.includes('deepseek');
      const isGraded = lowerModel.includes('gpt-oss');

      const reasoningParams: Record<string, unknown> = {};
      if (!thinkingOff) {
        if (isGraded) {
          const effortMap: Record<string, string> = {
            high: 'high',
            low: 'low',
            max: 'high',
            medium: 'medium',
            minimal: 'low',
            xhigh: 'high',
          };
          reasoningParams.reasoning_effort = (effortVal && effortMap[effortVal]) || 'medium';
        } else if (isDeepSeek && effortVal) {
          // Presence is the switch; the value is not read, so pass the
          // caller's through unchanged rather than inventing a level.
          reasoningParams.reasoning_effort = effortVal;
        }
      }

      return { ...rest, ...reasoningParams, model } as any;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_GITGOT_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList = Array.isArray(modelsPage?.data) ? modelsPage.data : [];

    return await processMultiProviderModelList(modelList, 'gitgot');
  },
  provider: ModelProvider.GitGot,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeGitGotAI = createOpenAICompatibleRuntime(params);
