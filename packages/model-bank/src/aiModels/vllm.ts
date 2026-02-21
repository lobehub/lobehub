import type { AIChatModelCard } from '../types/aiModel';

const vllmChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Llama 3.1 is Meta’s leading model family, scaling up to 405B parameters for complex dialogue, multilingual translation, and data analysis.',
    displayName: 'Llama 3.1 70B',
    enabled: true,
    id: 'meta-llama/Meta-Llama-3.1-70B',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Llama 3.1 is Meta’s leading model family, scaling up to 405B parameters for complex dialogue, multilingual translation, and data analysis.',
    displayName: 'Llama 3.1 405B Instruct',
    id: 'meta-llama/Meta-Llama-3.1-405B-Instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Gemma 2 is Google’s efficient model family for use cases from small apps to complex data processing.',
    displayName: 'Gemma 2 9B',
    id: 'google/gemma-2-9b',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Gemma 2 is Google’s efficient model family for use cases from small apps to complex data processing.',
    displayName: 'Gemma 2 27B',
    id: 'google/gemma-2-27b',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Mistral (7B) Instruct is known for strong performance across many language tasks.',
    displayName: 'Mistral 7B Instruct v0.1',
    id: 'mistralai/Mistral-7B-Instruct-v0.1',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Mixtral-8x7B Instruct (46.7B) provides high capacity for large-scale data processing.',
    displayName: 'Mistral 8x7B Instruct v0.1',
    id: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek-V3 is a 671B-parameter MoE model using MLA and DeepSeekMoE with loss-free load balancing for efficient training and inference. Pretrained on 14.8T high-quality tokens with SFT and RL, it outperforms other open models and approaches leading closed models.',
    displayName: 'DeepSeek V3',
    enabled: true,
    id: 'deepseek-ai/DeepSeek-V3',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description: 'Qwen QwQ is an experimental research model focused on improved AI reasoning.',
    displayName: 'QwQ 32B Preview',
    enabled: true,
    id: 'Qwen/QwQ-32B-Preview',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen2-7B-Instruct is a 7B instruction-tuned model in the Qwen2 series using Transformer, SwiGLU, QKV bias, and grouped-query attention. It handles large inputs and performs strongly across understanding, generation, multilingual, coding, math, and reasoning benchmarks, outperforming most open models and surpassing Qwen1.5-7B-Chat in multiple evaluations.',
    displayName: 'Qwen2 7B Instruct',
    enabled: true,
    id: 'Qwen/Qwen2-7B-Instruct',
    type: 'chat',
  },
];

export const allModels = [...vllmChatModels];

export default allModels;
