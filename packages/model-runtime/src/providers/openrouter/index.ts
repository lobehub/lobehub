import { BRANDING_NAME } from '@lobechat/const';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { fetchOpenRouterModels } from './modelFetch';
import type { OpenRouterReasoning } from './type';

export { fetchOpenRouterModels, mapOpenRouterModelCard } from './modelFetch';

export const params = {
  baseURL: 'https://openrouter.ai/api/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const {
        reasoning_effort,
        thinking,
        reasoning: _reasoning,
        thinkingLevel,
        imageAspectRatio,
        imageResolution,
        model,
        ...rest
      } = payload;

      let reasoning: OpenRouterReasoning | undefined;

      if (
        thinking?.type ||
        thinking?.budget_tokens !== undefined ||
        reasoning_effort ||
        thinkingLevel
      ) {
        if (thinking?.type === 'disabled') {
          reasoning = { enabled: false };
        } else if (thinking?.budget_tokens !== undefined) {
          reasoning = {
            max_tokens: thinking?.budget_tokens,
          };
        } else if (reasoning_effort) {
          reasoning = { effort: reasoning_effort };
        } else if (thinkingLevel) {
          reasoning = { effort: thinkingLevel };
        }
      }

      // Add modalities and image_config for image generation models
      const isImageModel = model.includes('-image') || model.includes('flux');
      const modalities =
        (payload as any).modalities ?? (isImageModel ? ['image', 'text'] : undefined);

      // Map imageResolution to image_size: '512' → '0.5K', others pass through.
      // OpenRouter's image_size field expects '0.5K' for 512px output; the rest
      // ('1K'/'2K'/'4K') are passed through verbatim.
      const imageSizeValue = imageResolution
        ? imageResolution === '512'
          ? '0.5K'
          : imageResolution
        : undefined;

      // 'auto' means use model default — omit the parameter
      const aspectRatioValue =
        imageAspectRatio && imageAspectRatio !== 'auto' ? imageAspectRatio : undefined;

      const image_config =
        (payload as any).image_config ??
        (isImageModel && (aspectRatioValue || imageSizeValue)
          ? {
              ...(aspectRatioValue && { aspect_ratio: aspectRatioValue }),
              ...(imageSizeValue && { image_size: imageSizeValue }),
            }
          : undefined);

      return {
        ...rest,
        ...(image_config && { image_config }),
        ...(modalities && { modalities }),
        model: payload.enabledSearch ? `${payload.model}:online` : payload.model,
        ...(reasoning && { reasoning }),
        stream: payload.stream ?? true,
      } as any;
    },
  },
  constructorOptions: {
    defaultHeaders: {
      'HTTP-Referer': 'https://lobehub.com',
      'X-Title': BRANDING_NAME,
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENROUTER_CHAT_COMPLETION === '1',
  },
  models: fetchOpenRouterModels,
  provider: ModelProvider.OpenRouter,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeOpenRouterAI = createOpenAICompatibleRuntime(params);
