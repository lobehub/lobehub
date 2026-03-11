import type { AIChatModelCard } from '../types/aiModel';

const ppioChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 64_000,
    description:
      'DeepSeek R1 is the latest open-source model released by the DeepSeek team, with very strong reasoning performance, especially in math, coding, and reasoning tasks, comparable to OpenAI o1.',
    displayName: 'DeepSeek: DeepSeek R1 (Community)',
    enabled: true,
    id: 'deepseek/deepseek-r1/community',
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
    contextWindowTokens: 64_000,
    description:
      'DeepSeek-V3 delivers a major breakthrough in reasoning speed over previous models. It ranks first among open-source models and rivals the most advanced closed models. DeepSeek-V3 adopts Multi-Head Latent Attention (MLA) and the DeepSeekMoE architecture, both fully validated in DeepSeek-V2. It also introduces a lossless auxiliary strategy for load balancing and a multi-token prediction training objective for stronger performance.',
    displayName: 'DeepSeek: DeepSeek V3 (Community)',
    enabled: true,
    id: 'deepseek/deepseek-v3/community',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 64_000,
    description:
      'DeepSeek R1 is the latest open-source model released by the DeepSeek team, with very strong reasoning performance, especially in math, coding, and reasoning tasks, comparable to OpenAI o1.',
    displayName: 'DeepSeek R1',
    enabled: true,
    id: 'deepseek/deepseek-r1',
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
    contextWindowTokens: 64_000,
    description:
      'DeepSeek-V3 delivers a major breakthrough in reasoning speed over previous models. It ranks first among open-source models and rivals the most advanced closed models. DeepSeek-V3 adopts Multi-Head Latent Attention (MLA) and the DeepSeekMoE architecture, both fully validated in DeepSeek-V2. It also introduces a lossless auxiliary strategy for load balancing and a multi-token prediction training objective for stronger performance.',
    displayName: 'DeepSeek V3',
    enabled: true,
    id: 'deepseek/deepseek-v3',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
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
      'DeepSeek R1 Distill Llama 70B is a distilled LLM based on Llama 3.3 70B, fine-tuned using DeepSeek R1 outputs to achieve competitive performance with large frontier models.',
    displayName: 'DeepSeek R1 Distill Llama 70B',
    enabled: true,
    id: 'deepseek/deepseek-r1-distill-llama-70b',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 64_000,
    description:
      'DeepSeek R1 Distill Qwen 32B is a distilled LLM based on Qwen 2.5 32B, trained using DeepSeek R1 outputs. It surpasses OpenAI o1-mini on multiple benchmarks, achieving state-of-the-art results among dense models. Benchmark highlights:\nAIME 2024 pass@1: 72.6\nMATH-500 pass@1: 94.3\nCodeForces Rating: 1691\nFine-tuning on DeepSeek R1 outputs delivers competitive performance with larger frontier models.',
    displayName: 'DeepSeek: DeepSeek R1 Distill Qwen 32B',
    enabled: true,
    id: 'deepseek/deepseek-r1-distill-qwen-32b',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.18, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.18, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 64_000,
    description:
      'DeepSeek R1 Distill Qwen 14B is a distilled LLM based on Qwen 2.5 14B, trained using DeepSeek R1 outputs. It surpasses OpenAI o1-mini on multiple benchmarks, achieving state-of-the-art results among dense models. Benchmark highlights:\nAIME 2024 pass@1: 69.7\nMATH-500 pass@1: 93.9\nCodeForces Rating: 1481\nFine-tuning on DeepSeek R1 outputs delivers competitive performance with larger frontier models.',
    displayName: 'DeepSeek: DeepSeek R1 Distill Qwen 14B',
    enabled: true,
    id: 'deepseek/deepseek-r1-distill-qwen-14b',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
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
      'DeepSeek R1 Distill Llama 8B is a distilled LLM based on Llama-3.1-8B-Instruct, trained using DeepSeek R1 outputs.',
    displayName: 'DeepSeek: DeepSeek R1 Distill Llama 8B',
    enabled: true,
    id: 'deepseek/deepseek-r1-distill-llama-8b',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5-72B-Instruct is one of Alibaba Cloud’s latest LLM releases. The 72B model brings notable improvements in coding and math, supports over 29 languages (including Chinese and English), and significantly improves instruction following, structured data understanding, and structured output (especially JSON).',
    displayName: 'qwen/qwen-2.5-72b-instruct',
    enabled: true,
    id: 'qwen/qwen-2.5-72b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.88, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen2-VL is the latest iteration of Qwen-VL, reaching state-of-the-art performance on vision benchmarks such as MathVista, DocVQA, RealWorldQA, and MTVQA. It can understand 20+ minutes of video for high-quality video Q&A, dialogue, and content creation. It also handles complex reasoning and decision-making, integrating with mobile devices and robots to act based on visual context and text instructions. Beyond English and Chinese, it also reads text in images across many languages, including most European languages, Japanese, Korean, Arabic, and Vietnamese.',
    displayName: 'qwen/qwen-2-vl-72b-instruct',
    enabled: true,
    id: 'qwen/qwen-2-vl-72b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'meta-llama/llama-3.2-3b-instruct',
    displayName: 'meta-llama/llama-3.2-3b-instruct',
    enabled: true,
    id: 'meta-llama/llama-3.2-3b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.216, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.36, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Qwen2.5-32B-Instruct is one of Alibaba Cloud’s latest LLM releases. The 32B model brings notable improvements in coding and math, supports over 29 languages (including Chinese and English), and significantly improves instruction following, structured data understanding, and structured output (especially JSON).',
    displayName: 'qwen/qwen2.5-32b-instruct',
    enabled: true,
    id: 'qwen/qwen2.5-32b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.26, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 14_336,
    description:
      'Baichuan-13B is an open-source, commercially usable 13B-parameter LLM from Baichuan, achieving best-in-class results for its size on authoritative Chinese and English benchmarks.',
    displayName: 'baichuan/baichuan2-13b-chat',
    enabled: true,
    id: 'baichuan/baichuan2-13b-chat',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Meta’s latest Llama 3.1 series, the 70B instruction-tuned variant optimized for high-quality dialogue. In industry evaluations, it shows strong performance against leading closed models. (Available only to enterprise-verified entities.)',
    displayName: 'meta-llama/llama-3.1-70b-instruct',
    enabled: true,
    id: 'meta-llama/llama-3.1-70b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.45, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.82, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Meta’s latest Llama 3.1 series, the 8B instruction-tuned variant is especially fast and efficient. In industry evaluations, it delivers strong performance, surpassing many leading closed models. (Available only to enterprise-verified entities.)',
    displayName: 'meta-llama/llama-3.1-8b-instruct',
    enabled: true,
    id: 'meta-llama/llama-3.1-8b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      '01.AI’s latest open-source fine-tuned model with 34B parameters, supporting multiple dialogue scenarios, trained on high-quality data and aligned with human preferences.',
    displayName: '01-ai/yi-1.5-34b-chat',
    enabled: true,
    id: '01-ai/yi-1.5-34b-chat',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      '01.AI’s latest open-source fine-tuned model with 9B parameters, supporting multiple dialogue scenarios, trained on high-quality data and aligned with human preferences.',
    displayName: '01-ai/yi-1.5-9b-chat',
    enabled: true,
    id: '01-ai/yi-1.5-9b-chat',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'The open-source release of Zhipu AI’s latest GLM-4 pretraining model.',
    displayName: 'thudm/glm-4-9b-chat',
    enabled: true,
    id: 'thudm/glm-4-9b-chat',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen2 is the new Qwen LLM series. Qwen2 7B is a transformer-based model that excels in language understanding, multilingual capability, programming, math, and reasoning.',
    displayName: 'qwen/qwen-2-7b-instruct',
    enabled: true,
    id: 'qwen/qwen-2-7b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.32, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.32, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...ppioChatModels];

export default allModels;
