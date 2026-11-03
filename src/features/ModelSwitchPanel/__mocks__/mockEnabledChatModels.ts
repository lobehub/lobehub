import { type AiModelForSelect } from 'model-bank';

import { type EnabledProviderWithModels } from '@/types/aiProvider';

/**
 * Mock data for testing ModelSwitchPanel
 *
 * This data includes:
 * - Multiple providers (OpenAI, Azure, Ollama)
 * - Same model provided by multiple providers (gpt-4o -> model-item-multiple)
 * - Single provider model (llama3 -> model-item-single)
 */
export const mockEnabledChatModels: EnabledProviderWithModels[] = [
  {
    children: [
      {
        abilities: {
          functionCall: true,
          reasoning: false,
          vision: true,
        },
        contextWindowTokens: 128_000,
        displayName: 'GPT-4o',
        id: 'gpt-4o',
        maxOutput: 16_384,
        releasedAt: '2024-05-13',
        type: 'chat',
      } as AiModelForSelect,
      {
        abilities: {
          functionCall: true,
          reasoning: false,
          vision: true,
        },
        contextWindowTokens: 128_000,
        displayName: 'GPT-4o Mini',
        id: 'gpt-4o-mini',
        maxOutput: 16_384,
        releasedAt: '2024-07-18',
        type: 'chat',
      } as AiModelForSelect,
      {
        abilities: {
          functionCall: true,
          reasoning: true,
          vision: false,
        },
        contextWindowTokens: 200_000,
        displayName: 'o1',
        id: 'o1',
        maxOutput: 100_000,
        releasedAt: '2024-12-17',
        type: 'chat',
      } as AiModelForSelect,
    ],
    id: 'openai',
    logo: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.45.0/files/dark/openai.png',
    name: 'OpenAI',
    source: 'builtin',
  },
  {
    children: [
      {
        // Same displayName as OpenAI's gpt-4o -> will create model-item-multiple
        abilities: {
          functionCall: true,
          reasoning: false,
          vision: true,
        },
        contextWindowTokens: 128_000,
        displayName: 'GPT-4o',
        id: 'gpt-4o',
        maxOutput: 16_384,
        type: 'chat',
      } as AiModelForSelect,
      {
        // Same displayName as OpenAI's gpt-4o-mini -> will create model-item-multiple
        abilities: {
          functionCall: true,
          reasoning: false,
          vision: true,
        },
        contextWindowTokens: 128_000,
        displayName: 'GPT-4o Mini',
        id: 'gpt-4o-mini',
        maxOutput: 16_384,
        type: 'chat',
      } as AiModelForSelect,
    ],
    id: 'azure',
    logo: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.45.0/files/dark/azure.png',
    name: 'Azure OpenAI',
    source: 'builtin',
  },
  {
    children: [
      {
        // Unique model -> will create model-item-single
        abilities: {
          functionCall: true,
          reasoning: false,
          vision: false,
        },
        contextWindowTokens: 128_000,
        displayName: 'Llama 3.3 70B',
        id: 'llama3.3:70b',
        maxOutput: 8192,
        type: 'chat',
      } as AiModelForSelect,
      {
        abilities: {
          functionCall: false,
          reasoning: false,
          vision: true,
        },
        contextWindowTokens: 128_000,
        displayName: 'Llava',
        id: 'llava:latest',
        maxOutput: 4096,
        type: 'chat',
      } as AiModelForSelect,
    ],
    id: 'ollama',
    logo: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.45.0/files/dark/ollama.png',
    name: 'Ollama',
    source: 'builtin',
  },
  {
    children: [
      {
        // Same as OpenAI's o1 -> will create model-item-multiple
        abilities: {
          functionCall: true,
          reasoning: true,
          vision: false,
        },
        contextWindowTokens: 200_000,
        displayName: 'o1',
        id: 'o1',
        maxOutput: 100_000,
        type: 'chat',
      } as AiModelForSelect,
    ],
    id: 'openrouter',
    logo: 'https://registry.npmmirror.com/@lobehub/icons-static-png/1.45.0/files/dark/openrouter.png',
    name: 'OpenRouter',
    source: 'builtin',
  },
];

/**
 * Expected result when groupMode = 'byModel':
 *
 * - GPT-4o (model-item-multiple) -> OpenAI, Azure
 * - GPT-4o Mini (model-item-multiple) -> OpenAI, Azure
 * - Llama 3.3 70B (model-item-single) -> Ollama
 * - Llava (model-item-single) -> Ollama
 * - o1 (model-item-multiple) -> OpenAI, OpenRouter
 */
