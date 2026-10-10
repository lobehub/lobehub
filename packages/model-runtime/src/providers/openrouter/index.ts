import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';
import {
  isAdaptiveThinkingDefaultOnModel,
  isAlwaysThinkingClaudeModel,
  parseClaudeModelId,
  rejectsDisabledThinkingAtEffort,
} from '../anthropic/modelId';
import type { OpenRouterModelCard, OpenRouterReasoning } from './type';

const formatPrice = (price?: string) => {
  if (price === undefined || price === '-1') return undefined;
  return Number((Number(price) * 1e6).toPrecision(5));
};

export const params = {
  baseURL: 'https://openrouter.ai/api/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      const {
        effort,
        reasoning_effort,
        thinking,
        reasoning: _reasoning,
        thinkingLevel,
        imageAspectRatio,
        imageResolution,
        model,
        ...rest
      } = payload;

      // Claude effort (`opus47Effort`) has no top-level field on OpenRouter; it travels as
      // `reasoning.effort`, which OpenRouter maps to Anthropic's `output_config.effort`.
      const resolvedEffort = effort || reasoning_effort;

      let reasoning: OpenRouterReasoning | undefined;

      if (thinking?.type === 'disabled') {
        if (isAlwaysThinkingClaudeModel(model)) {
          // OpenRouter registers these as mandatory-reasoning and rejects any disable request with
          // a 400 before routing, so only the effort is kept.
          if (resolvedEffort) reasoning = { effort: resolvedEffort };
        } else {
          // Anthropic applies effort to the whole response, so it still shapes non-thinking output;
          // Claude 5 only rejects disabled thinking at `xhigh` / `max`.
          const keepsEffort =
            !!resolvedEffort &&
            !!parseClaudeModelId(model) &&
            !rejectsDisabledThinkingAtEffort(model, resolvedEffort);

          reasoning = keepsEffort ? { effort: resolvedEffort, enabled: false } : { enabled: false };
        }
      } else if (thinking?.budget_tokens !== undefined) {
        reasoning = { max_tokens: thinking.budget_tokens };
      } else if (resolvedEffort) {
        reasoning = { effort: resolvedEffort };
      } else if (thinkingLevel) {
        reasoning = { effort: thinkingLevel };
      } else if (thinking?.type === 'adaptive') {
        reasoning = { enabled: true };
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
      'X-Title': 'LobeHub',
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_OPENROUTER_CHAT_COMPLETION === '1',
  },
  models: async () => {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) {
      throw new Error(`OpenRouter models API request failed with status ${response.status}`);
    }

    const data = (await response.json()) as { data: OpenRouterModelCard[] };
    const modelList = data.data;

    // Process the model info fetched from the frontend and convert to standard format
    const formattedModels = modelList.map((model) => {
      const { top_provider, architecture, pricing, supported_parameters } = model;

      const inputModalities = architecture.input_modalities || [];

      // Process the name, by default strip the colon and everything before it
      let displayName = model.name;
      const colonIndex = displayName.indexOf(':');
      if (colonIndex !== -1) {
        const prefix = displayName.slice(0, Math.max(0, colonIndex)).trim();
        const suffix = displayName.slice(Math.max(0, colonIndex + 1)).trim();

        const isDeepSeekPrefix = prefix.toLowerCase() === 'deepseek';
        const suffixHasDeepSeek = suffix.toLowerCase().includes('deepseek');

        if (isDeepSeekPrefix && !suffixHasDeepSeek) {
          displayName = model.name;
        } else {
          displayName = suffix;
        }
      }

      const inputPrice = formatPrice(pricing.prompt);
      const outputPrice = formatPrice(pricing.completion);
      const cachedInputPrice = formatPrice(pricing.input_cache_read);
      const writeCacheInputPrice = formatPrice(pricing.input_cache_write);

      const isFree = inputPrice === 0 && outputPrice === 0 && !displayName.endsWith('(free)');
      if (isFree) {
        displayName += ' (free)';
      }

      const hasReasoning = supported_parameters.includes('reasoning');
      // Claude 5 thinks adaptively only: OpenRouter drops `reasoning.max_tokens` and effort is the
      // depth control, so these models get an effort selector instead of a budget slider.
      const isAdaptiveOnlyClaude = isAdaptiveThinkingDefaultOnModel(model.id);

      return {
        contextWindowTokens: top_provider.context_length || model.context_length,
        description: model.description,
        displayName,
        functionCall: supported_parameters.includes('tools'),
        id: model.id,
        maxOutput:
          typeof top_provider.max_completion_tokens === 'number'
            ? top_provider.max_completion_tokens
            : typeof model.context_length === 'number'
              ? model.context_length
              : undefined,
        pricing: {
          cachedInput: cachedInputPrice,
          input: inputPrice,
          output: outputPrice,
          writeCacheInput: writeCacheInputPrice,
        },
        reasoning: hasReasoning,
        releasedAt: new Date(model.created * 1000).toISOString().split('T')[0],
        vision: inputModalities.includes('image'),
        // Merge all applicable extendParams for settings
        ...(() => {
          const extendParams: string[] = [];
          if (
            !isAdaptiveOnlyClaude &&
            model.description &&
            model.description.includes('`reasoning` `enabled`')
          ) {
            extendParams.push('enableReasoning');
          }
          if (
            hasReasoning &&
            (model.id.includes('gpt-5.2') ||
              model.id.includes('gpt-5.4') ||
              model.id.includes('gpt-5.5'))
          ) {
            extendParams.push('gpt5_2ReasoningEffort', 'textVerbosity');
          } else if (hasReasoning && model.id.includes('gpt-5.1')) {
            extendParams.push('gpt5_1ReasoningEffort', 'textVerbosity');
          } else if (hasReasoning && model.id.includes('gpt-5')) {
            extendParams.push('gpt5ReasoningEffort', 'textVerbosity');
          } else if (hasReasoning && model.id.includes('openai')) {
            extendParams.push('reasoningEffort', 'textVerbosity');
          }
          if (hasReasoning && isAdaptiveOnlyClaude) {
            // Always-thinking models are mandatory-reasoning on OpenRouter, so no off switch.
            if (!isAlwaysThinkingClaudeModel(model.id)) extendParams.push('enableAdaptiveThinking');
            extendParams.push('opus47Effort');
          } else if (hasReasoning && model.id.includes('claude')) {
            extendParams.push('enableReasoning', 'reasoningBudgetToken');
          }
          if (model.id.includes('claude') && writeCacheInputPrice && writeCacheInputPrice !== 0) {
            extendParams.push('disableContextCaching');
          }
          if (hasReasoning && model.id.includes('gemini-2.5')) {
            extendParams.push('reasoningBudgetToken');
          }
          if (hasReasoning && model.id.includes('gemini-3-pro')) {
            extendParams.push('thinkingLevel2');
          }
          if (hasReasoning && model.id.includes('gemini-3-flash')) {
            extendParams.push('thinkingLevel');
          }
          return extendParams.length > 0 ? { settings: { extendParams } } : {};
        })(),
      };
    });

    return await processMultiProviderModelList(formattedModels, 'openrouter');
  },
  provider: ModelProvider.OpenRouter,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeOpenRouterAI = createOpenAICompatibleRuntime(params);
