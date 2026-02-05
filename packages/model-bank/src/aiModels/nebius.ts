import type { AIChatModelCard } from '../types/aiModel';

// https://studio.nebius.com/

const nebiusChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Kimi-K2-Instruct',
    id: 'moonshotai/Kimi-K2-Instruct',
    organization: 'moonshotai',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
    id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'gpt-oss-120b',
    enabled: true,
    id: 'openai/gpt-oss-120b',
    organization: 'openai',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'gpt-oss-20b',
    id: 'openai/gpt-oss-20b',
    organization: 'openai',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'GLM-4.5',
    id: 'zai-org/GLM-4.5',
    organization: 'zai-org',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'GLM-4.5-Air',
    id: 'zai-org/GLM-4.5-Air',
    organization: 'zai-org',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    displayName: 'DeepSeek-R1-0528',
    id: 'deepseek-ai/DeepSeek-R1-0528',
    organization: 'deepseek',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    displayName: 'DeepSeek-R1-0528 (fast)',
    id: 'deepseek-ai/DeepSeek-R1-0528-fast',
    organization: 'deepseek',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen3-235B-A22B-Instruct-2507',
    id: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    displayName: 'Qwen3-30B-A3B',
    id: 'Qwen/Qwen3-30B-A3B',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    displayName: 'Qwen3-32B',
    id: 'Qwen/Qwen3-32B',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    displayName: 'Qwen3-32B (fast)',
    id: 'Qwen/Qwen3-32B-fast',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    displayName: 'Qwen3-14B',
    id: 'Qwen/Qwen3-14B',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Llama-3_1-Nemotron-Ultra-253B-v1',
    id: 'nvidia/Llama-3_1-Nemotron-Ultra-253B-v1',
    organization: 'nvidia',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 163_840,
    displayName: 'DeepSeek-V3-0324',
    id: 'deepseek-ai/DeepSeek-V3-0324',
    organization: 'deepseek',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    displayName: 'DeepSeek-V3-0324 (fast)',
    id: 'deepseek-ai/DeepSeek-V3-0324-fast',
    organization: 'deepseek',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 163_840,
    displayName: 'DeepSeek-V3',
    id: 'deepseek-ai/DeepSeek-V3',
    organization: 'deepseek',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Llama-3.3-70B-Instruct',
    id: 'meta-llama/Llama-3.3-70B-Instruct',
    organization: 'meta',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Llama-3.3-70B-Instruct (fast)',
    id: 'meta-llama/Llama-3.3-70B-Instruct-fast',
    organization: 'meta',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Meta-Llama-3.1-8B-Instruct',
    id: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    organization: 'meta',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Meta-Llama-3.1-8B-Instruct (fast)',
    id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-fast',
    organization: 'meta',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.09, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Meta-Llama-3.1-405B-Instruct',
    id: 'meta-llama/Meta-Llama-3.1-405B-Instruct',
    organization: 'meta',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    displayName: 'Qwen2.5-Coder-7B (fast)',
    id: 'Qwen/Qwen2.5-Coder-7B-fast',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.09, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    displayName: 'Gemma-2-2b-it',
    id: 'google/gemma-2-2b-it',
    organization: 'google',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    displayName: 'Gemma-2-9b-it (fast)',
    id: 'google/gemma-2-9b-it-fast',
    organization: 'google',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.09, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Qwen2.5-72B-Instruct',
    id: 'Qwen/Qwen2.5-72B-Instruct',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'QwQ-32B',
    id: 'Qwen/QwQ-32B',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.45, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'QwQ-32B (fast)',
    id: 'Qwen/QwQ-32B-fast',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Hermes-3-Llama-3.1-405B',
    id: 'NousResearch/Hermes-3-Llama-405B',
    organization: 'NousResearch',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Hermes-4-70B',
    id: 'NousResearch/Hermes-4-70B',
    organization: 'NousResearch',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Hermes-4-405B',
    id: 'NousResearch/Hermes-4-405B',
    organization: 'NousResearch',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    displayName: 'Devstral-Small-2505',
    id: 'mistralai/Devstral-Small-2505',
    organization: 'mistralai',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen3-30B-A3B-Thinking-2507',
    id: 'Qwen/Qwen3-30B-A3B-Thinking-2507',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen3-30B-A3B-Instruct-2507',
    id: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen3-Coder-30B-A3B-Instruct',
    id: 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Meta-Llama-Guard-3-8B',
    id: 'meta-llama/Llama-Guard-3-8B',
    organization: 'meta',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 110_000,
    displayName: 'Gemma-3-27b-it',
    id: 'google/gemma-3-27b-it',
    organization: 'google',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 110_000,
    displayName: 'Gemma-3-27b-it (fast)',
    id: 'google/gemma-3-27b-it-fast',
    organization: 'google',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 32_000,
    displayName: 'Qwen2.5-VL-72B-Instruct',
    id: 'Qwen/Qwen2.5-VL-72B-Instruct',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

// Models below are pending verification

// export const nebiusImageModels: AIImageModelCard[] = [
//   {
//     contextWindowTokens: 0,
//     displayName: 'FLUX.1-dev',
//     id: 'black-forest-labs/flux-dev',
//     pricing: {
//       units: [
//         { name: 'imageGeneration', rate: 0.007, strategy: 'fixed', unit: 'image' },
//       ],
//     },
//     type: 'image',
//   },
//   {
//     contextWindowTokens: 0,
//     displayName: 'FLUX.1-schnell',
//     id: 'black-forest-labs/flux-schnell',
//     pricing: {
//       units: [
//         { name: 'imageGeneration', rate: 0.0013, strategy: 'fixed', unit: 'image' },
//       ],
//     },
//     type: 'image',
//   },
// ];

// export const nebiusEmbeddingModels: AIEmbeddingModelCard[] = [
//   {
//     contextWindowTokens: 32_768,
//     displayName: 'BGE-ICL',
//     id: 'BAAI/bge-en-icl',
//     maxDimension: 3072,
//     pricing: {
//       units: [
//         { name: 'textInput', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
//       ],
//     },
//     type: 'embedding',
//   },
//   {
//     contextWindowTokens: 8192,
//     displayName: 'bge-multilingual-gemma2',
//     id: 'BAAI/bge-multilingual-gemma2',
//     maxDimension: 3072,
//     pricing: {
//       units: [
//         { name: 'textInput', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
//       ],
//     },
//     type: 'embedding',
//   },
//   {
//     contextWindowTokens: 32_768,
//     displayName: 'e5-mistral-7b-instruct',
//     id: 'intfloat/e5-mistral-7b-instruct',
//     maxDimension: 1536,
//     pricing: {
//       units: [
//         { name: 'textInput', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
//       ],
//     },
//     type: 'embedding',
//   },
//   {
//     contextWindowTokens: 40_960,
//     displayName: 'Qwen3-Embedding-8B',
//     id: 'Qwen/Qwen3-Embedding-8B',
//     maxDimension: 3072,
//     pricing: {
//       units: [
//         { name: 'textInput', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
//       ],
//     },
//     type: 'embedding',
//   },
// ];

export const allModels = [...nebiusChatModels];

export default allModels;
