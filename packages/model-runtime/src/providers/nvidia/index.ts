import { ModelProvider, nvidia as nvidiaChatModels } from 'model-bank';

import { type OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { processMultiProviderModelList } from '../../utils/modelParse';

// Thinking param patterns derived from build.nvidia.com page templates
// Ref: /tmp/NVIDIA_28_Models_Analysis.md

// Pattern A: chat_template_kwargs.thinking (boolean toggle)
const chatTemplateKwargsThinkingModels = new Set([
  'moonshotai/kimi-k2.6',
]);

// Pattern B: chat_template_kwargs.enable_thinking (boolean toggle)
const enableThinkingModels = new Set([
  'google/gemma-4-31b-it',
  'nvidia/ising-calibration-1-35b-a3b',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/nemotron-3-super-120b-a12b',
  'qwen/qwen3.5-122b-a10b',
]);

// Pattern C: chat_template_kwargs.enable_thinking + clear_thinking (preserved thinking)
// Ref: https://docs.z.ai/guides/capabilities/thinking-mode#preserved-thinking
const preservedThinkingModels = new Set(['z-ai/glm-5.1']);

// Pattern D: chat_template_kwargs.thinking + reasoning_effort (DeepSeek V4)
const dsV4Models = new Set([
  'deepseek-ai/deepseek-v4-flash',
  'deepseek-ai/deepseek-v4-pro',
]);

// Models that should use Responses API (gpt-oss on NVIDIA NIM)
const responsesModels = new Set([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
]);

const nemotron9bModel = 'nvidia/nvidia-nemotron-nano-9b-v2';

// Models that require reasoning_content on all assistant messages when thinking is enabled.
// Without this, multi-turn tool-call conversations return HTTP 400.
const forceReasoningModels = new Set([
  'z-ai/glm-5.1',
  'deepseek-ai/deepseek-v4-flash',
  'deepseek-ai/deepseek-v4-pro',
  'moonshotai/kimi-k2.6',
]);

// Nvidia's Kimi K2.6 NIM backend rejects:
// 1. Property names matching JSON Schema keywords (e.g., `type` in properties)
// 2. `type: ["string", "null"]` / `enum: ["a", null]` from Zod nullable
// 3. `type: ["string", "number"]` multi-type arrays
const renameTypeProperty = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(renameTypeProperty);

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties' && typeof value === 'object' && !Array.isArray(value)) {
      const renamed: Record<string, any> = {};
      for (const [propName, propValue] of Object.entries(value as Record<string, unknown>)) {
        renamed[propName === 'type' ? '_type' : propName] = renameTypeProperty(propValue);
      }
      result.properties = renamed;
      continue;
    }
    if (key === 'required' && Array.isArray(value)) {
      result.required = value.map((v: any) => (v === 'type' ? '_type' : v));
      continue;
    }
    if (['allOf', 'anyOf', 'oneOf'].includes(key) && Array.isArray(value)) {
      result[key] = value.map(renameTypeProperty);
      continue;
    }
    if (key === 'definitions' || key === '$defs') {
      const nested: Record<string, any> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        nested[k] = renameTypeProperty(v);
      }
      result[key] = nested;
      continue;
    }
    if (key === 'items' || key === 'additionalProperties' || key === 'not' || key === 'if' ||
        key === 'then' || key === 'else') {
      result[key] = renameTypeProperty(value);
      continue;
    }
    result[key] = renameTypeProperty(value);
  }
  return result;
};

const flattenTypeArrays = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(flattenTypeArrays);

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type' && Array.isArray(value)) {
      const nonNull = value.filter((t: any) => t !== 'null' && t !== null);
      if (nonNull.includes('string')) result.type = 'string';
      else if (nonNull.length >= 1) result.type = nonNull[0];
      else result.type = 'string';
      continue;
    }
    if (['properties', 'items', 'additionalProperties', 'not', 'if', 'then', 'else',
         'definitions', '$defs'].includes(key)) {
      result[key] = flattenTypeArrays(value);
      continue;
    }
    if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key) && Array.isArray(value)) {
      result[key] = value.map(flattenTypeArrays);
      continue;
    }
    result[key] = flattenTypeArrays(value);
  }
  return result;
};

// Nvidia NIM rejects `enum: ["a", null]` from Zod nullable enums.
// This is separate from flattenTypeArrays which handles `type` arrays.
const removeEnumNull = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(removeEnumNull);

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'enum' && Array.isArray(value)) {
      const filtered = value.filter((v: any) => v !== null);
      if (filtered.length > 0) result[key] = filtered;
      continue;
    }
    if (
      ['properties', 'items', 'additionalProperties', 'not', 'if', 'then', 'else',
       'definitions', '$defs'].includes(key)
    ) {
      result[key] = removeEnumNull(value);
      continue;
    }
    if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key) && Array.isArray(value)) {
      result[key] = value.map(removeEnumNull);
      continue;
    }
    result[key] = removeEnumNull(value);
  }
  return result;
};

export interface NvidiaModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://integrate.api.nvidia.com/v1',
  chatCompletion: {
    // NVIDIA NIM rejects requests where prompt tokens already meet or
    // exceed the model context window (returns 400 "requested 0 output
    // tokens and your prompt contains at least N+1 input tokens"). Fail
    // fast so the UI can surface a fork / switch-model affordance instead
    // of a raw provider error. See .
    contextPreFlight: { models: nvidiaChatModels },
    handlePayload: (payload) => {
      const { model, reasoning_effort, thinking, messages, ...rest } = payload;

      const thinkingFlag =
        thinking?.type === 'enabled' ? true : thinking?.type === 'disabled' ? false : undefined;

      // gpt-oss models use Responses API with reasoning_effort
      if (typeof model === 'string' && responsesModels.has(model)) {
        const effort = reasoning_effort ?? 'medium';
        return { ...rest, reasoning_effort: effort, model, apiMode: 'responses' };
      }

      const shouldForceAssistantReasoningContent =
        thinkingFlag === true && typeof model === 'string' && forceReasoningModels.has(model);

      // nemotron-nano-9b: thinking via system message tag
      if (model === nemotron9bModel && thinkingFlag !== undefined) {
        const thinkTag = thinkingFlag ? '/think' : '/no_think';
        const processed: any[] = [];
        let hasSystem = false;
        for (const msg of messages ?? []) {
          if (msg.role === 'system') {
            processed.push({ ...msg, content: String(msg.content ?? '') + thinkTag });
            hasSystem = true;
          } else {
            processed.push(msg);
          }
        }
        if (!hasSystem) {
          processed.unshift({ role: 'system', content: thinkTag });
        }

        const result: any = { ...rest, model, messages: processed };

        if (thinkingFlag) {
          result.extra_body = { min_thinking_tokens: 1024, max_thinking_tokens: 4096 };
        }

        return result;
      }

      const processedMessages = messages?.map((message: any) => {
        if (message.role !== 'assistant') return message;

        const { reasoning, ...restMsg } = message;
        const reasoningContent =
          typeof restMsg.reasoning_content === 'string'
            ? restMsg.reasoning_content
            : typeof reasoning?.content === 'string'
              ? reasoning.content
              : undefined;

        if (shouldForceAssistantReasoningContent) {
          return { ...restMsg, reasoning_content: reasoningContent ?? '' };
        }

        if (reasoningContent !== undefined) {
          return { ...restMsg, reasoning_content: reasoningContent };
        }

        return restMsg;
      });

      const chatTemplateKwargs: Record<string, any> = {};

      // DeepSeek V4: reasoning_effort drives thinking + effort in kwargs
      // Template maps: "none" → {thinking:false}, "high"/"max" → {thinking:true, reasoning_effort}
      if (typeof model === 'string' && dsV4Models.has(model)) {
        if (reasoning_effort && reasoning_effort !== 'none') {
          chatTemplateKwargs.thinking = true;
          chatTemplateKwargs.reasoning_effort = reasoning_effort;
        } else if (reasoning_effort === 'none') {
          chatTemplateKwargs.thinking = false;
        } else if (thinkingFlag !== undefined) {
          chatTemplateKwargs.thinking = thinkingFlag;
        }
      } else if (thinkingFlag !== undefined) {
        if (preservedThinkingModels.has(model)) {
          chatTemplateKwargs.enable_thinking = thinkingFlag;
          chatTemplateKwargs.clear_thinking = false;
        } else if (enableThinkingModels.has(model)) {
          chatTemplateKwargs.enable_thinking = thinkingFlag;
        } else if (chatTemplateKwargsThinkingModels.has(model)) {
          chatTemplateKwargs.thinking = thinkingFlag;
        }
      }

      // Schemas sanitization: only Kimi K2.6 needs renameTypeProperty et al.
      const tools = model === 'moonshotai/kimi-k2.6' && rest.tools
        ? (rest.tools as any[]).map((tool: any) => {
            if (!tool.function?.parameters) return tool;
            let params = renameTypeProperty(tool.function.parameters);
            params = removeEnumNull(params);
            params = flattenTypeArrays(params);
            return {
              ...tool,
              function: {
                ...tool.function,
                parameters: params,
              },
            };
          })
        : rest.tools;

      const result: any = {
        ...rest,
        model,
        messages: processedMessages,
      };

      if (tools !== undefined) {
        result.tools = tools;
      }

      if (Object.keys(chatTemplateKwargs).length > 0) {
        result.chat_template_kwargs = chatTemplateKwargs;
      }

      return result;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_NVIDIA_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const modelsPage = (await client.models.list()) as any;
    const modelList: NvidiaModelCard[] = modelsPage.data;

    return processMultiProviderModelList(modelList, 'nvidia');
  },
  provider: ModelProvider.Nvidia,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeNvidiaAI = createOpenAICompatibleRuntime(params);
