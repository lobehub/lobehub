import type { AIChatModelCard } from '../types/aiModel';

// https://platform.sensenova.cn/pricing
// https://www.sensecore.cn/help/docs/model-as-a-service/nova/release

const sensenovaChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'With comprehensive updates to multimodal, language, and reasoning data plus training strategy optimization, the new model significantly improves multimodal reasoning and generalized instruction following, supports up to a 128k context window, and excels in OCR and cultural tourism IP recognition tasks.',
    displayName: 'SenseNova V6.5 Pro',
    enabled: true,
    id: 'SenseNova-V6-5-Pro',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-23',
    // settings: {
    //   extendParams: ['enableReasoning'],
    // },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'With comprehensive updates to multimodal, language, and reasoning data plus training strategy optimization, the new model significantly improves multimodal reasoning and generalized instruction following, supports up to a 128k context window, and excels in OCR and cultural tourism IP recognition tasks.',
    displayName: 'SenseNova V6.5 Turbo',
    enabled: true,
    id: 'SenseNova-V6-5-Turbo',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-23',
    // settings: {
    //   extendParams: ['enableReasoning'],
    // },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen3-235B-A22B is a MoE model that introduces a hybrid reasoning mode, letting users switch seamlessly between thinking and non-thinking. It supports understanding and reasoning across 119 languages and dialects and has strong tool-calling capabilities, competing with mainstream models like DeepSeek R1, OpenAI o1, o3-mini, Grok 3, and Google Gemini 2.5 Pro across benchmarks in general ability, code and math, multilingual capability, and knowledge reasoning.',
    displayName: 'Qwen3 235B A22B',
    id: 'Qwen3-235B',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-27',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen3-32B is a dense model that introduces a hybrid reasoning mode, letting users switch between thinking and non-thinking. With architecture improvements, more data, and better training, it performs on par with Qwen2.5-72B.',
    displayName: 'Qwen3 32B',
    id: 'Qwen3-32B',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-27',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Combines vision and language deep reasoning, supporting slow thinking and full chain-of-thought.',
    displayName: 'SenseNova V6 Reasoner',
    id: 'SenseNova-V6-Reasoner',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Natively unifies image, text, and video, breaking traditional multimodal silos. It leads across core multimodal and language capabilities and ranks top-tier in multiple evaluations.',
    displayName: 'SenseNova V6 Turbo',
    id: 'SenseNova-V6-Turbo',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Natively unifies image, text, and video, breaking traditional multimodal silos; wins top spots on OpenCompass and SuperCLUE.',
    displayName: 'SenseNova V6 Pro',
    id: 'SenseNova-V6-Pro',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Some performance exceeds SenseChat-5-1202.',
    displayName: 'SenseChat 5.5 Beta',
    id: 'SenseChat-5-beta',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Latest version based on V5.5, with significant gains in Chinese/English fundamentals, chat, STEM knowledge, humanities knowledge, writing, math/logic, and length control.',
    displayName: 'SenseChat 5.5 1202',
    id: 'SenseChat-5-1202',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-30',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Latest lightweight model reaching 90%+ of full-model capability with significantly lower inference cost.',
    displayName: 'SenseChat Turbo 1202',
    id: 'SenseChat-Turbo-1202',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-30',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Latest V5.5 with 128K context; major gains in math reasoning, English chat, instruction following, and long-text understanding, comparable to GPT-4o.',
    displayName: 'SenseChat 5.5',
    id: 'SenseChat-5',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 16_384,
    description:
      'Latest V5.5 with multi-image input and broad core improvements in attribute recognition, spatial relations, action/event detection, scene understanding, emotion recognition, commonsense reasoning, and text understanding/generation.',
    displayName: 'SenseChat 5.5 Vision',
    id: 'SenseChat-Vision',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description: 'Suitable for fast Q&A and model fine-tuning scenarios.',
    displayName: 'SenseChat 5.0 Turbo',
    id: 'SenseChat-Turbo',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'Base V4 with 128K context, strong in long-text understanding and generation.',
    displayName: 'SenseChat 4.0 128K',
    id: 'SenseChat-128K',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Base V4 with 32K context, flexible for many scenarios.',
    displayName: 'SenseChat 4.0 32K',
    id: 'SenseChat-32K',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 36, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 36, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: 'Base V4 with 4K context and strong general capability.',
    displayName: 'SenseChat 4.0 4K',
    id: 'SenseChat',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Designed for Hong Kong dialogue habits, slang, and local knowledge; surpasses GPT-4 in Cantonese understanding and rivals GPT-4 Turbo in knowledge, reasoning, math, and coding.',
    displayName: 'SenseChat 5.0 Cantonese',
    id: 'SenseChat-5-Cantonese',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 27, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 27, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: 'Standard character chat model with 8K context and high response speed.',
    displayName: 'SenseChat Character',
    id: 'SenseChat-Character',
    maxOutput: 1024,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Advanced character chat model with 32K context, improved capability, and Chinese/English support.',
    displayName: 'SenseChat Character Pro',
    id: 'SenseChat-Character-Pro',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'DeepSeek-V3 is a MoE model developed by DeepSeek. It surpasses other open models like Qwen2.5-72B and Llama-3.1-405B on many benchmarks and is competitive with leading closed models such as GPT-4o and Claude 3.5 Sonnet.',
    displayName: 'DeepSeek V3',
    id: 'DeepSeek-V3',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'DeepSeek-R1 applies large-scale reinforcement learning during post-training, greatly boosting reasoning with very little labeled data. It matches the OpenAI o1 production model on math, code, and natural language reasoning tasks.',
    displayName: 'DeepSeek R1',
    id: 'DeepSeek-R1',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'DeepSeek-R1-Distill models are fine-tuned from open-source models using sample data generated by DeepSeek-R1.',
    displayName: 'DeepSeek R1 Distill Qwen 14B',
    id: 'DeepSeek-R1-Distill-Qwen-14B',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 8192,
    description:
      'DeepSeek-R1-Distill models are fine-tuned from open-source models using sample data generated by DeepSeek-R1.',
    displayName: 'DeepSeek R1 Distill Qwen 32B',
    id: 'DeepSeek-R1-Distill-Qwen-32B',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...sensenovaChatModels];

export default allModels;
