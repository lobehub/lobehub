import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import {
  type OpenAICompatibleFactoryOptions,
  createOpenAICompatibleRuntime,
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

export const params = {
  baseURL: 'https://api.groq.com/openai/v1',
  chatCompletion: {
    handleError: (error) => {
      // 403 means the location is not supported
      if (error.status === 403)
        return { error, errorType: AgentRuntimeErrorType.LocationNotSupportError };
    },
    handlePayload: (payload) => {
      const { temperature, ...restPayload } = payload;

      // Groq doesn't support temperature <= 0, set to undefined in that case
      const resolvedParams = resolveParameters({ temperature }, { normalizeTemperature: false });

      return {
        ...restPayload,
        stream: payload.stream ?? true,
        temperature:
          resolvedParams.temperature !== undefined && resolvedParams.temperature <= 0
            ? undefined
            : resolvedParams.temperature,
      } as any;
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
    ];

    const reasoningKeywords = ['deepseek-r1'];

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
