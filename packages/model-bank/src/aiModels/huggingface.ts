import type { AIChatModelCard } from '../types/aiModel';

const huggingfaceChatModels: AIChatModelCard[] = [
  {
    contextWindowTokens: 32_768,
    description: 'Mistral AI instruction-tuned model.',
    displayName: 'Mistral 7B Instruct v0.3',
    id: 'mistralai/Mistral-7B-Instruct-v0.3',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: 'Lightweight instruction-tuned model from Google.',
    displayName: 'Gemma 2 2B Instruct',
    id: 'google/gemma-2-2b-it',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Large language model developed by the Qwen team at Alibaba Cloud.',
    displayName: 'Qwen 2.5 72B Instruct',
    id: 'Qwen/Qwen2.5-72B-Instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Qwen2.5-Coder focuses on coding tasks.',
    displayName: 'Qwen 2.5 Coder 32B Instruct',
    id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description: 'Qwen QwQ is an experimental research model focused on improving reasoning.',
    displayName: 'QwQ 32B Preview',
    id: 'Qwen/QwQ-32B-Preview',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    displayName: 'Phi 3.5 mini instruct',
    id: 'microsoft/Phi-3.5-mini-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    displayName: 'Hermes 3 Llama 3.1 8B',
    id: 'NousResearch/Hermes-3-Llama-3.1-8B',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 16_384,
    displayName: 'DeepSeek R1 (Distill Qwen 32B)',
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    displayName: 'DeepSeek R1',
    id: 'deepseek-ai/DeepSeek-R1',
    type: 'chat',
  },
];

export const allModels = [...huggingfaceChatModels];

export default allModels;
