import type { AIChatModelCard } from '../types/aiModel';

const sambanovaChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_000,
    description:
      'Llama 3.3 is the most advanced multilingual open-source Llama model, delivering near-405B performance at very low cost. It is Transformer-based and improved with SFT and RLHF for usefulness and safety. The instruction-tuned version is optimized for multilingual chat and beats many open and closed chat models on industry benchmarks. Knowledge cutoff: Dec 2023.',
    displayName: 'Meta Llama 3.3 70B Instruct',
    enabled: true,
    id: 'Meta-Llama-3.3-70B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_000,
    description:
      'Cutting-edge small language model with strong language understanding, excellent reasoning, and text generation.',
    displayName: 'Meta Llama 3.2 1B Instruct',
    id: 'Meta-Llama-3.2-1B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8000,
    description:
      'Cutting-edge small language model with strong language understanding, excellent reasoning, and text generation.',
    displayName: 'Meta Llama 3.2 3B Instruct',
    id: 'Meta-Llama-3.2-3B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 4000,
    description:
      'Strong image reasoning on high-resolution images, suited for visual understanding applications.',
    displayName: 'Meta Llama 3.2 11B Vision Instruct',
    enabled: true,
    id: 'Llama-3.2-11B-Vision-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 4000,
    description: 'Advanced image reasoning for visual-understanding agent applications.',
    displayName: 'Meta Llama 3.2 90B Vision Instruct',
    enabled: true,
    id: 'Llama-3.2-90B-Vision-Instruct	',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_000,
    description:
      'Llama 3.1 instruction-tuned text model optimized for multilingual chat, performing strongly on common industry benchmarks among open and closed chat models.',
    displayName: 'Meta Llama 3.1 8B Instruct',
    id: 'Meta-Llama-3.1-8B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Llama 3.1 instruction-tuned text model optimized for multilingual chat, performing strongly on common industry benchmarks among open and closed chat models.',
    displayName: 'Meta Llama 3.1 70B Instruct',
    id: 'Meta-Llama-3.1-70B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_000,
    description:
      'Llama 3.1 instruction-tuned text model optimized for multilingual chat, performing strongly on common industry benchmarks among open and closed chat models.',
    displayName: 'Meta Llama 3.1 405B Instruct',
    id: 'Meta-Llama-3.1-405B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_000,
    displayName: 'Llama 3.1 Tulu 3 405B',
    id: 'Llama-3.1-Tulu-3-405B',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 4000,
    description: 'State-of-the-art efficient LLM, strong at reasoning, math, and coding.',
    displayName: 'DeepSeek R1',
    id: 'DeepSeek-R1',
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description:
      'DeepSeek R1, the larger and smarter model in the DeepSeek suite, is distilled into the Llama 70B architecture. Benchmarks and human evals show it is smarter than the base Llama 70B, especially on math and fact-precision tasks.',
    displayName: 'DeepSeek R1 Distill Llama 70B',
    enabled: true,
    id: 'DeepSeek-R1-Distill-Llama-70B',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 16_000,
    description: 'Qwen QwQ is an experimental research model focused on improving reasoning.',
    displayName: 'QwQ 32B Preview',
    enabled: true,
    id: 'QwQ-32B-Preview',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_000,
    description: 'LLM for Chinese and English, tuned for language, coding, math, and reasoning.',
    displayName: 'Qwen2.5 72B Instruct',
    enabled: true,
    id: 'Qwen2.5-72B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_000,
    description:
      'Advanced LLM for code generation, reasoning, and bug fixing across major programming languages.',
    displayName: 'Qwen2.5 Coder 32B Instruct',
    enabled: true,
    id: 'Qwen2.5-Coder-32B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...sambanovaChatModels];

export default allModels;
