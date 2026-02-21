import type { AIChatModelCard } from '../types/aiModel';

// https://openrouter.ai/docs/api-reference/list-available-models
const openrouterChatModels: AIChatModelCard[] = [
  {
    contextWindowTokens: 2_000_000,
    description:
      'Based on context length, topic, and complexity, your request is routed to Llama 3 70B Instruct, Claude 3.5 Sonnet (self-moderated), or GPT-4o.',
    displayName: 'Auto (best for prompt)',
    enabled: true,
    id: 'openrouter/auto',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-V3.1 is a large hybrid reasoning model with 128K context and efficient mode switching, delivering excellent performance and speed for tool use, code generation, and complex reasoning.',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek/deepseek-chat-v3.1',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-21',
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      vision: true,
    },
    contextWindowTokens: 32_768 + 8192,
    description: 'Gemini 2.5 Flash experimental model with image generation support.',
    displayName: 'Nano Banana',
    id: 'google/gemini-2.5-flash-image-preview',
    maxOutput: 8192,
    pricing: {
      approximatePricePerImage: 0.039,
      units: [
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-26',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-V3.1 is a large hybrid reasoning model with 128K context and efficient mode switching, delivering excellent performance and speed for tool use, code generation, and complex reasoning.',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek/deepseek-chat-v3.1',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-21',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3 is the latest Qwen LLM generation with dense and MoE architectures, excelling at reasoning, multilingual support, and advanced agent tasks. Its unique ability to switch between a thinking mode for complex reasoning and a non-thinking mode for efficient chat ensures versatile, high-quality performance.\n\nQwen3 significantly outperforms prior models like QwQ and Qwen2.5, delivering excellent math, coding, commonsense reasoning, creative writing, and interactive chat. The Qwen3-30B-A3B variant has 30.5B parameters (3.3B active), 48 layers, 128 experts (8 active per task), and supports up to 131K context with YaRN, setting a new bar for open models.',
    displayName: 'Qwen3 30B A3B (Free)',
    id: 'qwen/qwen3-30b-a3b:free',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3 is the latest Qwen LLM generation with dense and MoE architectures, excelling at reasoning, multilingual support, and advanced agent tasks. Its unique ability to switch between a thinking mode for complex reasoning and a non-thinking mode for efficient chat ensures versatile, high-quality performance.\n\nQwen3 significantly outperforms prior models like QwQ and Qwen2.5, delivering excellent math, coding, commonsense reasoning, creative writing, and interactive chat. The Qwen3-30B-A3B variant has 30.5B parameters (3.3B active), 48 layers, 128 experts (8 active per task), and supports up to 131K context with YaRN, setting a new bar for open models.',
    displayName: 'Qwen3 30B A3B',
    id: 'qwen/qwen3-30b-a3b',
    maxOutput: 40_960,
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
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3-8B is a dense 8.2B-parameter causal LLM built for reasoning-heavy tasks and efficient chat. It switches between a thinking mode for math, coding, and logic and a non-thinking mode for general chat. Fine-tuned for instruction following, agent integration, and creative writing across 100+ languages and dialects. It natively supports 32K context and scales to 131K with YaRN.',
    displayName: 'Qwen3 8B (Free)',
    id: 'qwen/qwen3-8b:free',
    maxOutput: 40_960,
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3-14B is a dense 14.8B-parameter causal LLM built for complex reasoning and efficient chat. It switches between a thinking mode for math, coding, and logic and a non-thinking mode for general chat. Fine-tuned for instruction following, agent tool use, and creative writing across 100+ languages and dialects. It natively handles 32K context and scales to 131K with YaRN.',
    displayName: 'Qwen3 14B (Free)',
    id: 'qwen/qwen3-14b:free',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3-14B is a dense 14.8B-parameter causal LLM built for complex reasoning and efficient chat. It switches between a thinking mode for math, coding, and logic and a non-thinking mode for general chat. Fine-tuned for instruction following, agent tool use, and creative writing across 100+ languages and dialects. It natively handles 32K context and scales to 131K with YaRN.',
    displayName: 'Qwen3 14B',
    id: 'qwen/qwen3-14b',
    maxOutput: 40_960,
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
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3-32B is a dense 32.8B-parameter causal LLM optimized for complex reasoning and efficient chat. It switches between a thinking mode for math, coding, and logic and a non-thinking mode for faster general chat. It performs strongly on instruction following, agent tool use, and creative writing across 100+ languages and dialects. It natively handles 32K context and scales to 131K with YaRN.',
    displayName: 'Qwen3 32B (Free)',
    id: 'qwen/qwen3-32b:free',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3-32B is a dense 32.8B-parameter causal LLM optimized for complex reasoning and efficient chat. It switches between a thinking mode for math, coding, and logic and a non-thinking mode for faster general chat. It performs strongly on instruction following, agent tool use, and creative writing across 100+ languages and dialects. It natively handles 32K context and scales to 131K with YaRN.',
    displayName: 'Qwen3 32B',
    id: 'qwen/qwen3-32b',
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
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3-235B-A22B is a 235B-parameter MoE model from Qwen with 22B active per forward pass. It switches between a thinking mode for complex reasoning, math, and code and a non-thinking mode for efficient chat. It offers strong reasoning, multilingual support (100+ languages/dialects), advanced instruction following, and agent tool use. It natively handles 32K context and scales to 131K with YaRN.',
    displayName: 'Qwen3 235B A22B (Free)',
    id: 'qwen/qwen3-235b-a22b:free',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3-235B-A22B is a 235B-parameter MoE model from Qwen with 22B active per forward pass. It switches between a thinking mode for complex reasoning, math, and code and a non-thinking mode for efficient chat. It offers strong reasoning, multilingual support (100+ languages/dialects), advanced instruction following, and agent tool use. It natively handles 32K context and scales to 131K with YaRN.',
    displayName: 'Qwen3 235B A22B',
    id: 'qwen/qwen3-235b-a22b',
    maxOutput: 40_960,
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
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1T-Chimera is created by merging DeepSeek-R1 and DeepSeek-V3 (0324), combining R1 reasoning with V3 token efficiency. It is based on the DeepSeek-MoE Transformer and optimized for general text generation.\n\nIt merges pretrained weights to balance reasoning, efficiency, and instruction following. Released under the MIT license for research and commercial use.',
    displayName: 'DeepSeek R1T Chimera (Free)',
    id: 'tngtech/deepseek-r1t-chimera:free',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description:
      'GLM Z1 Rumination 32B is a 32B deep reasoning model in the GLM-4-Z1 series, optimized for complex open-ended tasks that require long thinking. Built on glm-4-32b-0414, it adds extra RL stages and multi-stage alignment, introducing a “rumination” capability that simulates extended cognitive processing. This includes iterative reasoning, multi-hop analysis, and tool-augmented workflows such as search, retrieval, and citation-aware synthesis.\n\nIt excels at research writing, comparative analysis, and complex QA. It supports function calling for search/navigation primitives (`search`, `click`, `open`, `finish`) for agent pipelines. Rumination behavior is controlled by multi-round loops with rule-based reward shaping and delayed decision mechanisms, benchmarked against deep research frameworks like OpenAI’s internal alignment stack. This variant is for depth over speed.',
    displayName: 'GLM Z1 Rumination 32B',
    id: 'thudm/glm-z1-rumination-32b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
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
      'GLM-Z1-32B-0414 is an enhanced reasoning variant of GLM-4-32B, built for deep math, logic, and code-focused problem solving. It applies expanded RL (task-specific and general pairwise preference) to improve complex multi-step tasks. Compared to GLM-4-32B, Z1 significantly improves structured reasoning and formal-domain capability.\n\nIt supports enforcing “thinking” steps via prompt engineering, improved coherence for long outputs, and is optimized for agent workflows with long context (via YaRN), JSON tool calling, and fine-grained sampling for stable reasoning. Ideal for use cases requiring careful multi-step or formal derivations.',
    displayName: 'GLM Z1 32B',
    id: 'thudm/glm-z1-32b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
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
      'GLM-4-32B-0414 is a 32B bilingual (Chinese/English) open-weights model optimized for code generation, function calling, and agent tasks. It is pretrained on 15T high-quality and reasoning-heavy data and further refined with human preference alignment, rejection sampling, and RL. It excels at complex reasoning, artifact generation, and structured output, reaching GPT-4o and DeepSeek-V3-0324-level performance on multiple benchmarks.',
    displayName: 'GLM 4 32B (Free)',
    id: 'thudm/glm-4-32b:free',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description:
      'GLM-4-32B-0414 is a 32B bilingual (Chinese/English) open-weights model optimized for code generation, function calling, and agent tasks. It is pretrained on 15T high-quality and reasoning-heavy data and further refined with human preference alignment, rejection sampling, and RL. It excels at complex reasoning, artifact generation, and structured output, reaching GPT-4o and DeepSeek-V3-0324-level performance on multiple benchmarks.',
    displayName: 'GLM 4 32B',
    id: 'thudm/glm-4-32b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.5 Pro is Google’s most advanced thinking model for reasoning over complex problems in code, math, and STEM, and for analyzing large datasets, codebases, and documents with long context.',
    displayName: 'Gemini 2.5 Pro',
    id: 'google/gemini-2.5-pro',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.5 Pro Preview is Google’s most advanced thinking model for reasoning over complex problems in code, math, and STEM, and for analyzing large datasets, codebases, and documents with long context.',
    displayName: 'Gemini 2.5 Pro Preview',
    id: 'google/gemini-2.5-pro-preview',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.5 Flash is Google’s most advanced flagship model, built for advanced reasoning, coding, math, and science tasks. It includes built-in “thinking” to deliver higher-accuracy responses with finer context processing.\n\nNote: This model has two variants—thinking and non-thinking. Output pricing differs significantly depending on whether thinking is enabled. If you choose the standard variant (without the “:thinking” suffix), the model will explicitly avoid generating thinking tokens.\n\nTo use thinking and receive thinking tokens, you must select the “:thinking” variant, which incurs higher thinking output pricing.\n\nGemini 2.5 Flash can also be configured via the “max reasoning tokens” parameter as documented (https://openrouter.ai/docs/use-cases/reasoning-tokens#max-tokens-for-reasoning).',
    displayName: 'Gemini 2.5 Flash',
    id: 'google/gemini-2.5-flash',
    maxOutput: 65_535,
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
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.5 Flash is Google’s most advanced flagship model, built for advanced reasoning, coding, math, and science tasks. It includes built-in “thinking” to deliver higher-accuracy responses with finer context processing.\n\nNote: This model has two variants—thinking and non-thinking. Output pricing differs significantly depending on whether thinking is enabled. If you choose the standard variant (without the “:thinking” suffix), the model will explicitly avoid generating thinking tokens.\n\nTo use thinking and receive thinking tokens, you must select the “:thinking” variant, which incurs higher thinking output pricing.\n\nGemini 2.5 Flash can also be configured via the “max reasoning tokens” parameter as documented (https://openrouter.ai/docs/use-cases/reasoning-tokens#max-tokens-for-reasoning).',
    displayName: 'Gemini 2.5 Flash Preview',
    id: 'google/gemini-2.5-flash-preview',
    maxOutput: 65_535,
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
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.5 Flash is Google’s most advanced flagship model, built for advanced reasoning, coding, math, and science tasks. It includes built-in “thinking” to deliver higher-accuracy responses with finer context processing.\n\nNote: This model has two variants—thinking and non-thinking. Output pricing differs significantly depending on whether thinking is enabled. If you choose the standard variant (without the “:thinking” suffix), the model will explicitly avoid generating thinking tokens.\n\nTo use thinking and receive thinking tokens, you must select the “:thinking” variant, which incurs higher thinking output pricing.\n\nGemini 2.5 Flash can also be configured via the “max reasoning tokens” parameter as documented (https://openrouter.ai/docs/use-cases/reasoning-tokens#max-tokens-for-reasoning).',
    displayName: 'Gemini 2.5 Flash Preview (thinking)',
    id: 'google/gemini-2.5-flash-preview:thinking',
    maxOutput: 65_535,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 200_000,
    description:
      'o3 is a powerful general-purpose model that excels across domains. It sets a new bar for math, science, coding, and vision reasoning, and is strong at technical writing and instruction following. Use it to analyze text, code, and images and solve complex multi-step problems.',
    displayName: 'o3',
    id: 'openai/o3',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-17',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o4-mini high reasoning tier, optimized for fast, efficient reasoning with strong coding and vision performance.',
    displayName: 'o4-mini (high)',
    id: 'openai/o4-mini-high',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.275, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-17',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o4-mini is optimized for fast, effective reasoning with strong efficiency and performance in coding and vision tasks.',
    displayName: 'o4-mini',
    id: 'openai/o4-mini',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.275, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-17',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 is the flagship model for complex tasks and cross-domain problem solving.',
    displayName: 'GPT-4.1',
    id: 'openai/gpt-4.1',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description: 'GPT-4.1 mini balances intelligence, speed, and cost for many use cases.',
    displayName: 'GPT-4.1 mini',
    id: 'openai/gpt-4.1-mini',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description: 'GPT-4.1 nano is the fastest and most cost-effective GPT-4.1 model.',
    displayName: 'GPT-4.1 nano',
    id: 'openai/gpt-4.1-nano',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o3-mini (high reasoning) delivers higher intelligence at the same cost and latency targets as o1-mini.',
    displayName: 'o3-mini (high)',
    id: 'openai/o3-mini-high',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-31',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o3-mini delivers higher intelligence at the same cost and latency targets as o1-mini.',
    displayName: 'o3-mini',
    id: 'openai/o3-mini',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-31',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'o1-mini is a fast, cost-effective reasoning model designed for coding, math, and science. It has 128K context and an October 2023 knowledge cutoff.',
    displayName: 'o1-mini',
    id: 'openai/o1-mini',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-12',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'o1 is OpenAI’s new reasoning model for complex tasks requiring broad knowledge. It has 128K context and an October 2023 knowledge cutoff.',
    displayName: 'o1-preview',
    id: 'openai/o1-preview',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-4o mini is OpenAI’s latest model after GPT-4 Omni, supporting image+text input with text output. As their most advanced small model, it is far cheaper than recent frontier models and over 60% cheaper than GPT-3.5 Turbo, while retaining top-tier intelligence. It scores 82% on MMLU and ranks above GPT-4 in chat preference.',
    displayName: 'GPT-4o mini',
    id: 'openai/gpt-4o-mini',
    maxOutput: 16_385,
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
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o is a dynamic model updated in real time. It combines strong language understanding and generation for large-scale use cases like customer support, education, and technical assistance.',
    displayName: 'GPT-4o',
    id: 'openai/gpt-4o',
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'DeepSeek-R1 greatly improves reasoning with minimal labeled data and outputs a chain-of-thought before the final answer to improve accuracy.',
    displayName: 'DeepSeek R1 0528',
    id: 'deepseek/deepseek-r1-0528',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.18, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-28',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1 greatly improves reasoning with minimal labeled data and outputs a chain-of-thought before the final answer to improve accuracy.',
    displayName: 'DeepSeek R1 0528 (Free)',
    id: 'deepseek/deepseek-r1-0528:free',
    releasedAt: '2025-05-28',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1 greatly improves reasoning with minimal labeled data and outputs a chain-of-thought before the final answer to improve accuracy.',
    displayName: 'DeepSeek R1',
    id: 'deepseek/deepseek-r1',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-20',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1 greatly improves reasoning with minimal labeled data and outputs a chain-of-thought before the final answer to improve accuracy.',
    displayName: 'DeepSeek R1 (Free)',
    id: 'deepseek/deepseek-r1:free',
    releasedAt: '2025-01-20',
    type: 'chat',
  },
  {
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V3 is a 685B-parameter MoE model and the latest iteration of DeepSeek’s flagship chat series.\n\nIt builds on [DeepSeek V3](/deepseek/deepseek-chat-v3) and performs strongly across tasks.',
    displayName: 'DeepSeek V3 0324',
    id: 'deepseek/deepseek-chat-v3-0324',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.27, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V3 is a 685B-parameter MoE model and the latest iteration of DeepSeek’s flagship chat series.\n\nIt builds on [DeepSeek V3](/deepseek/deepseek-chat-v3) and performs strongly across tasks.',
    displayName: 'DeepSeek V3 0324 (Free)',
    id: 'deepseek/deepseek-chat-v3-0324:free',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude Opus 4.5 is Anthropic’s flagship model, combining top-tier intelligence with scalable performance for complex, high-quality reasoning tasks.',
    displayName: 'Claude Opus 4.5',
    id: 'anthropic/claude-opus-4.5',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-24',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description: 'Claude Sonnet 4.5 is Anthropic’s most intelligent model to date.',
    displayName: 'Claude Sonnet 4.5',
    id: 'anthropic/claude-sonnet-4.5',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-30',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3 Haiku is Anthropic’s fastest and most compact model, designed for near-instant responses with fast, accurate performance.',
    displayName: 'Claude 3 Haiku',
    id: 'anthropic/claude-3-haiku',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 0.3125 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2024-03-07',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3.5 Haiku is Anthropic’s fastest next-gen model. Compared to Claude 3 Haiku, it improves across skills and surpasses the previous largest model Claude 3 Opus on many intelligence benchmarks.',
    displayName: 'Claude 3.5 Haiku',
    id: 'anthropic/claude-3.5-haiku',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 1.25 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2024-11-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3.5 Sonnet offers capability beyond Opus and faster speed than Sonnet while keeping Sonnet pricing. It is especially strong at coding, data science, vision, and agent tasks.',
    displayName: 'Claude 3.5 Sonnet',
    id: 'anthropic/claude-3.5-sonnet',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 3.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2024-06-20',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3.7 Sonnet is Anthropic’s most intelligent model and the first hybrid reasoning model on the market. It can produce near-instant responses or extended step-by-step reasoning that users can see. Sonnet is especially strong at coding, data science, vision, and agent tasks.',
    displayName: 'Claude 3.7 Sonnet',
    id: 'anthropic/claude-3.7-sonnet',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 3.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-02-24',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude Sonnet 4 can produce near-instant responses or extended step-by-step reasoning that users can see. API users can finely control how long the model thinks.',
    displayName: 'Claude Sonnet 4',
    id: 'anthropic/claude-sonnet-4',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-23',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude Opus 4 is Anthropic’s most powerful model for highly complex tasks, excelling in performance, intelligence, fluency, and comprehension.',
    displayName: 'Claude Opus 4',
    id: 'anthropic/claude-opus-4',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-23',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3 Opus is Anthropic’s most powerful model for highly complex tasks, excelling in performance, intelligence, fluency, and comprehension.',
    displayName: 'Claude 3 Opus',
    id: 'anthropic/claude-3-opus',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 18.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2024-02-29',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_008_192,
    description:
      'Gemini 1.5 Flash provides optimized multimodal processing for a range of complex tasks.',
    displayName: 'Gemini 1.5 Flash',
    id: 'google/gemini-flash-1.5',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576 + 8192,
    description:
      'Gemini 2.0 Flash delivers next-gen capabilities, including excellent speed, native tool use, multimodal generation, and a 1M-token context window.',
    displayName: 'Gemini 2.0 Flash',
    id: 'google/gemini-2.0-flash-001',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 2_008_192,
    description:
      'Gemini 1.5 Pro combines the latest optimizations for more efficient multimodal data processing.',
    displayName: 'Gemini 1.5 Pro',
    id: 'google/gemini-pro-1.5',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'LLaMA 3.2 is designed for tasks combining vision and text. It excels at image captioning and visual QA, bridging language generation and visual reasoning.',
    displayName: 'Llama 3.2 11B Vision',
    id: 'meta-llama/llama-3.2-11b-vision-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.162, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.162, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'LLaMA 3.2 is designed for tasks combining vision and text. It excels at image captioning and visual QA, bridging language generation and visual reasoning.',
    displayName: 'Llama 3.2 90B Vision',
    id: 'meta-llama/llama-3.2-90b-vision-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'Llama 3.3 is the most advanced multilingual open-source Llama model, delivering near-405B performance at very low cost. It is Transformer-based and improved with SFT and RLHF for usefulness and safety. The instruction-tuned version is optimized for multilingual chat and beats many open and closed chat models on industry benchmarks. Knowledge cutoff: Dec 2023.',
    displayName: 'Llama 3.3 70B Instruct',
    id: 'meta-llama/llama-3.3-70b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 65_536,
    description:
      'Llama 3.3 is the most advanced multilingual open-source Llama model, delivering near-405B performance at very low cost. It is Transformer-based and improved with SFT and RLHF for usefulness and safety. The instruction-tuned version is optimized for multilingual chat and beats many open and closed chat models on industry benchmarks. Knowledge cutoff: Dec 2023.',
    displayName: 'Llama 3.3 70B Instruct (Free)',
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen2 is a new large language model family with stronger understanding and generation.',
    displayName: 'Qwen2 7B (Free)',
    id: 'qwen/qwen-2-7b-instruct:free',
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'LLaMA 3.1 offers multilingual support and is one of the leading generative models.',
    displayName: 'Llama 3.1 8B (Free)',
    id: 'meta-llama/llama-3.1-8b-instruct:free',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: 'Gemma 2 is Google’s lightweight open-source text model family.',
    displayName: 'Gemma 2 9B (Free)',
    id: 'google/gemma-2-9b-it:free',
    type: 'chat',
  },
];

export const allModels = [...openrouterChatModels];

export default allModels;
