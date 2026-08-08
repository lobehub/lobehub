import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import {
  createOpenAICompatibleRuntime,
  transformResponseToStream,
} from '../../core/openaiCompatibleFactory';
import { resolveParameters } from '../../core/parameterResolver';
import { AgentRuntimeErrorType } from '../../types/error';

export interface GroqModelCard {
  context_window: number;
  id: string;
}

/**
 * Filter out advanced JSON Schema properties that Groq doesn't support
 */
const filterAdvancedFields = (schema: any): any => {
  if (typeof schema !== 'object' || schema === null) {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(filterAdvancedFields);
  }

  const filtered: any = {};

  // List of advanced properties to filter out
  const unsupportedProperties = new Set([
    'maxItems',
    'minItems',
    'maxLength',
    'minLength',
    'pattern',
    'format',
    'uniqueItems',
    'maxProperties',
    'minProperties',
    'multipleOf',
    'maximum',
    'minimum',
    'exclusiveMaximum',
    'exclusiveMinimum',
  ]);

  for (const [key, value] of Object.entries(schema)) {
    if (unsupportedProperties.has(key)) {
      continue;
    }

    filtered[key] = filterAdvancedFields(value);
  }

  return filtered;
};

/** Models that accept the `reasoning_format` parameter */
const supportsReasoningFormat = (model: string): boolean => {
  const lower = model.toLowerCase();
  return ['deepseek-r1', 'qwen3'].some((kw) => lower.includes(kw));
};

/** Qwen-family reasoning models: effort values are "none" | "default" */
const isQwenEffortModel = (model: string): boolean => model.toLowerCase().includes('qwen3.6-27b');

/** GPT-OSS reasoning models: effort values are "low" | "medium" | "high" */
const isGptOssModel = (model: string): boolean => model.toLowerCase().includes('gpt-oss-');

export const params = {
  baseURL: 'https://api.groq.com/openai/v1',
  chatCompletion: {
    handleError: (error) => {
      // 403 means the location is not supported
      if (error.status === 403)
        return { error, errorType: AgentRuntimeErrorType.LocationNotSupportError };
    },
    handlePayload: (payload) => {
      const {
        temperature,
        // Lobe-internal fields to strip
        thinking,
        reasoning,
        reasoning_effort,
        effort,
        ...restPayload
      } = payload;

      // Groq doesn't support temperature <= 0, set to undefined in that case
      const resolvedParams = resolveParameters({ temperature }, { normalizeTemperature: false });
      const resolvedTemp =
        resolvedParams.temperature !== undefined && resolvedParams.temperature <= 0
          ? undefined
          : resolvedParams.temperature;

      // --- Reasoning parameters ---
      const isThinkingDisabled = thinking?.type === 'disabled';
      const model = payload.model;
      const groqReasoningParams: Record<string, unknown> = {};

      // 1. reasoning_format (only for DeepSeek R1 and Qwen3 series)
      if (supportsReasoningFormat(model)) {
        if (isThinkingDisabled) {
          groqReasoningParams.reasoning_format = 'hidden';
        } else {
          // Default to parsed, also required when tools or JSON mode are used
          groqReasoningParams.reasoning_format = 'parsed';
        }
      }

      // 2. reasoning_effort
      const effortVal = reasoning_effort || reasoning?.effort || effort;
      if (isQwenEffortModel(model)) {
        groqReasoningParams.reasoning_effort =
          isThinkingDisabled || effortVal === 'none' ? 'none' : 'default';
      } else if (isGptOssModel(model)) {
        // Map Lobe effort values to Groq's low/medium/high
        const effortMap: Record<string, string> = {
          low: 'low',
          minimal: 'low',
          medium: 'medium',
          high: 'high',
          xhigh: 'high',
          max: 'high',
        };
        if (effortVal && effortMap[effortVal]) {
          groqReasoningParams.reasoning_effort = effortMap[effortVal];
        }
      }

      return {
        ...restPayload,
        ...groqReasoningParams,
        stream: payload.stream ?? true,
        temperature: resolvedTemp,
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
    chatCompletion: () => process.env.DEBUG_GROQ_CHAT_COMPLETION === '1',
  },
  generateObject: {
    handleSchema: filterAdvancedFields,
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const functionCallKeywords = [
      'tool',
      'llama-3.3',
      'llama-3.1',
      'llama3-',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
      'qwen3.6-27b',
    ];

    const reasoningKeywords = ['deepseek-r1', 'qwen3.6-27b', 'qwen3', 'gpt-oss-'];

    const modelsPage = (await client.models.list()) as any;
    const modelList: GroqModelCard[] = modelsPage.data;

    return modelList
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => model.id.toLowerCase() === m.id.toLowerCase(),
        );

        return {
          contextWindowTokens: model.context_window,
          displayName: knownModel?.displayName ?? undefined,
          enabled: knownModel?.enabled || false,
          functionCall:
            functionCallKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.functionCall ||
            false,
          id: model.id,
          reasoning:
            reasoningKeywords.some((keyword) => model.id.toLowerCase().includes(keyword)) ||
            knownModel?.abilities?.reasoning ||
            false,
          vision:
            model.id.toLowerCase().includes('vision') || knownModel?.abilities?.vision || false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.Groq,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeGroq = createOpenAICompatibleRuntime(params);
