import type { AIChatModelCard } from '../types/aiModel';

// https://novita.ai/pricing
const novitaChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Qwen3 VL 235B A22B Instruct',
    id: 'qwen/qwen3-vl-235b-a22b-instruct',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Qwen3 VL 235B A22B Thinking',
    id: 'qwen/qwen3-vl-235b-a22b-thinking',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.98, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.95, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Qwen3 Next 80B A3B Thinking',
    id: 'qwen/qwen3-next-80b-a3b-thinking',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Qwen3 Next 80B A3B Instruct',
    id: 'qwen/qwen3-next-80b-a3b-instruct',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    displayName: 'Qwen MT Plus',
    id: 'qwen/qwen-mt-plus',
    maxOutput: 2048,
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
    contextWindowTokens: 262_144,
    description:
      'kimi-k2-0905-preview offers a 256k context window, stronger agentic coding, better front-end code quality, and improved context understanding.',
    displayName: 'Kimi K2 0905',
    id: 'moonshotai/kimi-k2-0905',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    displayName: 'Deepseek V3.2 Exp',
    enabled: true,
    id: 'deepseek/deepseek-v3.2-exp',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.27, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.41, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'DeepSeek V3.1 Terminus',
    id: 'deepseek/deepseek-v3.1-terminus',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.27, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'DeepSeek V3.1',
    id: 'deepseek/deepseek-v3.1',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.27, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 65_536,
    displayName: 'Qwen3 Coder 480B A35B Instruct',
    id: 'qwen/qwen3-coder-480b-a35b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.29, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    displayName: 'OpenAI GPT OSS 120B',
    id: 'openai/gpt-oss-120b',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'OpenAI: GPT OSS 20B',
    id: 'openai/gpt-oss-20b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    displayName: 'GLM-4.5V',
    id: 'zai-org/glm-4.5v',
    maxOutput: 16_384,
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
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'GLM-4.5',
    id: 'zai-org/glm-4.5',
    maxOutput: 98_304,
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
    },
    contextWindowTokens: 131_072,
    displayName: 'Qwen3 235B A22B Instruct 2507',
    id: 'qwen/qwen3-235b-a22b-instruct-2507',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Qwen3 235B A22b Thinking 2507',
    id: 'qwen/qwen3-235b-a22b-thinking-2507',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'BaiChuan M2 32B',
    id: 'baichuan/baichuan-m2-32b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Kimi K2 0711',
    id: 'moonshotai/kimi-k2-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.57, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    displayName: 'GLM 4.1V 9B Thinking',
    id: 'thudm/glm-4.1v-9b-thinking',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.035, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.138, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 120_000,
    displayName: 'ERNIE 4.5 21B A3B',
    id: 'baidu/ernie-4.5-21B-a3b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'ERNIE 4.5 21B A3B Thinking',
    id: 'baidu/ernie-4.5-21B-a3b-thingking',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 123_000,
    displayName: 'ERNIE 4.5 300B A47B Paddle',
    id: 'baidu/ernie-4.5-300b-a47b-paddle',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 30_000,
    displayName: 'ERNIE 4.5 VL 28B A3B',
    id: 'baidu/ernie-4.5-vl-28b-a3b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 123_000,
    displayName: 'ERNIE 4.5 VL 424B A47B',
    id: 'baidu/ernie-4.5-vl-424b-a47b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.42, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    displayName: 'MiniMax M1 80K',
    id: 'minimaxai/minimax-m1-80k',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    displayName: 'Qwen3 4B FP8',
    id: 'qwen/qwen3-4b-fp8',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    displayName: 'Qwen3 235B A22B FP8',
    id: 'qwen/qwen3-235b-a22b-fp8',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    displayName: 'Qwen3 30B A3B FP8',
    id: 'qwen/qwen3-30b-a3b-fp8',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.09, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.45, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    displayName: 'Qwen3 32B FP8',
    id: 'qwen/qwen3-32b-fp8',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.45, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Llama 3.3 70B Instruct',
    id: 'meta-llama/llama-3.3-70b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.39, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    displayName: 'Qwen3 8B FP8',
    id: 'qwen/qwen3-8b-fp8',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.035, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.138, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Llama 4 Scout 17B Instruct',
    id: 'meta-llama/llama-4-scout-17b-16e-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    displayName: 'Llama 4 Maverick 17B Instruct',
    id: 'meta-llama/llama-4-maverick-17b-128e-instruct-fp8',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.17, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.85, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      'Llama 3.1 8B Instruct is optimized for high-quality dialogue, outperforming many leading closed models.',
    displayName: 'Llama 3.1 8B Instruct',
    id: 'meta-llama/llama-3.1-8b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Llama 3 8B Instruct is optimized for high-quality dialogue, outperforming many closed models.',
    displayName: 'Llama 3 8B Instruct',
    id: 'meta-llama/llama-3-8b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Llama 3 70B Instruct is optimized for high-quality dialogue and performs strongly in human evaluations.',
    displayName: 'Llama 3 70B Instruct',
    id: 'meta-llama/llama-3-70b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.51, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.74, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Gemma 3 27B is a Google open-source language model setting a new bar for efficiency and performance.',
    displayName: 'Gemma 3 27B',
    id: 'google/gemma-3-27b-it',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.119, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Gemma 3 12B is a Google open-source language model setting a new bar for efficiency and performance.',
    displayName: 'Gemma 3 12B',
    id: 'google/gemma-3-12b-it',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 60_288,
    description:
      'Mistral Nemo is a 7.3B model with multilingual support and strong coding performance.',
    displayName: 'Mistral Nemo',
    id: 'mistralai/mistral-nemo',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.17, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 65_535,
    description:
      'WizardLM-2 8x22B is Microsoft AI’s most advanced Wizard model with highly competitive performance.',
    displayName: 'WizardLM-2 8x22B',
    id: 'microsoft/wizardlm-2-8x22b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.62, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.62, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Hermes 2 Pro Llama 3 8B is an updated Nous Hermes 2 version with the latest internally developed datasets.',
    displayName: 'Hermes 2 Pro Llama 3 8B',
    id: 'nousresearch/hermes-2-pro-llama-3-8b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description:
      'MythoMax L2 13B is a creative, intelligent language model merged from multiple top models.',
    displayName: 'MythoMax l2 13B',
    id: 'gryphe/mythomax-l2-13b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.09, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.09, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 160_000,
    displayName: 'Deepseek Prover V2 671B',
    id: 'deepseek/deepseek-prover-v2-671b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 64_000,
    displayName: 'Deepseek V3 Turbo',
    id: 'deepseek/deepseek-v3-turbo',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 163_840,
    displayName: 'Deepseek V3 0324',
    id: 'deepseek/deepseek-v3-0324',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.14, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Deepseek R1 0528',
    id: 'deepseek/deepseek-r1-0528',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    displayName: 'DeepSeek R1 0528 Qwen3 8B',
    id: 'deepseek/deepseek-r1-0528-qwen3-8b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.09, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 64_000,
    displayName: 'Deepseek R1 Turbo',
    id: 'deepseek/deepseek-r1-turbo',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    displayName: 'Deepseek R1 Distill Llama 70B',
    id: 'deepseek/deepseek-r1-distill-llama-70b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    displayName: 'Deepseek R1 Distill Qwen 14B',
    id: 'deepseek/deepseek-r1-distill-qwen-14b',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 64_000,
    displayName: 'Deepseek R1 Distill Qwen 32B',
    id: 'deepseek/deepseek-r1-distill-qwen-32b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    displayName: 'L3 8B Stheno v3.2',
    id: 'Sao10K/L3-8B-Stheno-v3.2',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_000,
    displayName: 'Qwen2.5 72B Instruct',
    id: 'qwen/qwen-2.5-72b-instruct',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.38, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    displayName: 'L3 70B Euryale v2.1',
    id: 'sao10k/l3-70b-euryale-v2.1',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.48, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.48, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    displayName: 'Midnight Rose 70B',
    id: 'sophosympatheia/midnight-rose-70b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    displayName: 'L3 8B Lunaris',
    id: 'sao10k/l3-8b-lunaris',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    displayName: 'Qwen2.5 VL 72B Instruct',
    id: 'qwen/qwen2.5-vl-72b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    displayName: 'Llama 3.2 3B Instruct',
    id: 'meta-llama/llama-3.2-3b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    displayName: 'Llama 3.1 8B Instruct BF16',
    id: 'meta-llama/llama-3.1-8b-instruct-bf16',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'L31 70B Euryale v2.2',
    id: 'sao10k/l31-70b-euryale-v2.2',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.48, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.48, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_000,
    displayName: 'Qwen2.5 7B Instruct',
    id: 'qwen/qwen2.5-7b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...novitaChatModels];

export default allModels;
