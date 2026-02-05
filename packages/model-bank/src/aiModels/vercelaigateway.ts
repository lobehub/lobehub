import type { AIChatModelCard, AIEmbeddingModelCard } from '../types/aiModel';

// Model list provided by Vercel AI Gateway, sorted by SOTA, large models, small models
const vercelAIGatewayChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.5 Pro is our most advanced Gemini reasoning model for complex problems. It has a 2M-token context window and supports multimodal input including text, images, audio, video, and PDFs.',
    displayName: 'Gemini 2.5 Pro',
    enabled: true,
    id: 'google/gemini-2.5-pro',
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
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude Opus 4.1 is a drop-in replacement for Opus 4, delivering excellent performance and precision for real-world coding and agent tasks. It reaches 74.5% on SWE-bench Verified and handles complex multi-step problems with greater rigor and attention to detail.',
    displayName: 'Claude Opus 4.1',
    id: 'anthropic/claude-opus-4.1',
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 18.75, strategy: 'fixed', unit: 'millionTokens' },
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
      'Claude Opus 4 is Anthropic’s most powerful model and a top coding model, leading on SWE-bench (72.5%) and Terminal-bench (43.2%). It sustains performance on long tasks with thousands of steps and can work for hours, significantly extending agent capabilities.',
    displayName: 'Claude Opus 4',
    id: 'anthropic/claude-opus-4',
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 18.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude Sonnet 4 significantly improves on Sonnet 3.7, excelling at coding with a 72.7% SWE-bench score. It balances performance and efficiency for internal and external use cases, with enhanced controllability.',
    displayName: 'Claude Sonnet 4',
    id: 'anthropic/claude-sonnet-4',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 is OpenAI’s flagship language model, excelling at complex reasoning, broad real-world knowledge, code-heavy work, and multi-step agent tasks.',
    displayName: 'GPT-5',
    enabled: true,
    id: 'openai/gpt-5',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
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
      'OpenAI o3 is the most powerful reasoning model, setting new SOTA in coding, math, science, and visual perception. It excels at complex, multi-faceted queries and is particularly strong at analyzing images, charts, and diagrams.',
    displayName: 'o3',
    id: 'openai/o3',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
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
      'OpenAI o1 is a flagship reasoning model built for complex problems that require deep thinking, delivering strong reasoning and higher accuracy on multi-step tasks.',
    displayName: 'o1',
    id: 'openai/o1',
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
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
      'Claude 3.7 Sonnet is the first hybrid reasoning model and Anthropic’s most intelligent to date, delivering SOTA performance in coding, content creation, data analysis, and planning on top of Claude 3.5 Sonnet.',
    displayName: 'Claude 3.7 Sonnet',
    id: 'anthropic/claude-3.7-sonnet',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
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
      'Claude 3.5 Sonnet strikes an ideal balance between intelligence and speed, especially for enterprise workloads, offering strong performance at lower cost and durability for large-scale AI deployments.',
    displayName: 'Claude 3.5 Sonnet',
    id: 'anthropic/claude-3.5-sonnet',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
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
      'Claude 3 Opus is Anthropic’s most intelligent model with market-leading performance on highly complex tasks, handling open-ended prompts and novel scenarios with exceptional fluency and human-like understanding.',
    displayName: 'Claude 3 Opus',
    id: 'anthropic/claude-3-opus',
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 18.75, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 128_000,
    description:
      'GPT-4o from OpenAI combines broad general knowledge with domain expertise, follows complex natural-language instructions, and matches GPT-4 Turbo performance with a faster, cheaper API.',
    displayName: 'GPT-4o',
    id: 'openai/gpt-4o',
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 mini is a cost-optimized model that excels at reasoning and chat, offering the best balance of speed, cost, and capability.',
    displayName: 'GPT-5 mini',
    id: 'openai/gpt-5-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 nano is a high-throughput model that performs well on simple instructions or classification tasks.',
    displayName: 'GPT-5 nano',
    id: 'openai/gpt-5-nano',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.005, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description: 'A highly capable general-purpose LLM with strong, controllable reasoning.',
    displayName: 'gpt-oss-120b',
    id: 'openai/gpt-oss-120b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'A compact, open-weights language model optimized for low latency and resource-constrained environments, including local and edge deployments.',
    displayName: 'gpt-oss-20b',
    id: 'openai/gpt-oss-20b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
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
      'o3-mini is OpenAI’s latest small reasoning model, delivering higher intelligence at the same cost and latency targets as o1-mini.',
    displayName: 'o3-mini',
    id: 'openai/o3-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
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
      'OpenAI o4-mini delivers fast, cost-effective reasoning with outstanding performance for its size, especially in math (best on AIME), coding, and vision tasks.',
    displayName: 'o4-mini',
    id: 'openai/o4-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.275, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT 4.1 is OpenAI’s flagship model for complex tasks and cross-domain problem solving.',
    displayName: 'GPT-4.1',
    id: 'openai/gpt-4.1',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'Kimi K2 is a large MoE model from Moonshot AI with 1T total parameters and 32B active per forward pass, optimized for agent capabilities including advanced tool use, reasoning, and code synthesis.',
    displayName: 'Kimi K2',
    enabled: true,
    id: 'moonshotai/kimi-k2',
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
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3-Coder-480B-A35B-Instruct is Qwen’s most agentic code model, performing strongly on agentic coding, agentic browser use, and other core coding tasks, matching Claude Sonnet-level results.',
    displayName: 'Qwen3 Coder 480B A35B Instruct',
    enabled: true,
    id: 'alibaba/qwen3-coder',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'Qwen3 is the latest generation in the Qwen series, offering a comprehensive set of dense and MoE models. Built on extensive training, it brings breakthroughs in reasoning, instruction following, agent capabilities, and multilingual support.',
    displayName: 'Qwen3 235B A22B Instruct 2507',
    id: 'alibaba/qwen-3-235b',
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
    contextWindowTokens: 131_072,
    description:
      'The GLM-4.5 series is designed for agents. The flagship GLM-4.5 combines reasoning, coding, and agent skills with 355B total params (32B active) and offers dual operation modes as a hybrid reasoning system.',
    displayName: 'GLM-4.5',
    id: 'zai/glm-4.5',
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
    contextWindowTokens: 128_000,
    description:
      'GLM-4.5 and GLM-4.5-Air are our latest flagships for agent applications, both using MoE. GLM-4.5 has 355B total and 32B active per forward pass; GLM-4.5-Air is slimmer with 106B total and 12B active.',
    displayName: 'GLM 4.5 Air',
    id: 'zai/glm-4.5-air',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 65_536,
    description:
      'GLM-4.5V builds on GLM-4.5-Air, inheriting proven GLM-4.1V-Thinking techniques and scaling with a strong 106B-parameter MoE architecture.',
    displayName: 'GLM 4.5V',
    id: 'zai/glm-4.5v',
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
    contextWindowTokens: 40_960,
    description:
      'Qwen3 is the latest generation in the Qwen series, offering a comprehensive set of dense and MoE models. Built on extensive training, it brings breakthroughs in reasoning, instruction following, agent capabilities, and multilingual support.',
    displayName: 'Qwen3 32B',
    id: 'alibaba/qwen-3-32b',
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
    description:
      'Qwen3 is the latest generation in the Qwen series, offering a comprehensive set of dense and MoE models. Built on extensive training, it brings breakthroughs in reasoning, instruction following, agent capabilities, and multilingual support.',
    displayName: 'Qwen3 30B A3B',
    id: 'alibaba/qwen-3-30b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'Qwen3 is the latest generation in the Qwen series, offering a comprehensive set of dense and MoE models. Built on extensive training, it brings breakthroughs in reasoning, instruction following, agent capabilities, and multilingual support.',
    displayName: 'Qwen3 14B',
    id: 'alibaba/qwen-3-14b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Command A is Cohere’s strongest model yet, excelling at tool use, agents, RAG, and multilingual use cases. It has a 256K context length, runs on just two GPUs, and delivers 150% higher throughput than Command R+ 08-2024.',
    displayName: 'Command A',
    id: 'cohere/command-a',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
      'Command R is optimized for chat and long-context tasks, positioned as a “scalable” model that balances high performance and accuracy so companies can move beyond prototypes into production.',
    displayName: 'Command R',
    id: 'cohere/command-r',
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
    },
    contextWindowTokens: 128_000,
    description:
      'Command R+ is Cohere’s latest LLM optimized for chat and long context, aiming for exceptional performance so companies can move past prototypes into production.',
    displayName: 'Command R+',
    id: 'cohere/command-r-plus',
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
    contextWindowTokens: 128_000,
    description:
      'DeepSeek R1 has been updated to DeepSeek-R1-0528. With more compute and post-training algorithmic optimizations, it significantly improves reasoning depth and capability. It performs strongly across math, programming, and general logic benchmarks, approaching leaders like o3 and Gemini 2.5 Pro.',
    displayName: 'DeepSeek R1 0528',
    id: 'deepseek/deepseek-r1',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.19, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 163_840,
    description: 'A fast general-purpose LLM with enhanced reasoning.',
    displayName: 'DeepSeek V3 0324',
    id: 'deepseek/deepseek-v3',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.77, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.77, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description: 'DeepSeek V3.1 Base is an improved version of the DeepSeek V3 model.',
    displayName: 'DeepSeek V3.1 Base',
    id: 'deepseek/deepseek-v3.1-base',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1999, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8001, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'Gemini 2.0 Flash delivers next-gen features including exceptional speed, built-in tool use, multimodal generation, and a 1M-token context window.',
    displayName: 'Gemini 2.0 Flash',
    id: 'google/gemini-2.0-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'Gemini 2.0 Flash Lite delivers next-gen features including exceptional speed, built-in tool use, multimodal generation, and a 1M-token context window.',
    displayName: 'Gemini 2.0 Flash Lite',
    id: 'google/gemini-2.0-flash-lite',
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
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Gemini 2.5 Flash is a reasoning model with excellent overall capability, balancing price and performance with multimodal support and a 1M-token context window.',
    displayName: 'Gemini 2.5 Flash',
    id: 'google/gemini-2.5-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
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
      'Gemini 2.5 Flash-Lite is a balanced, low-latency model with configurable thinking budget and tool connectivity (e.g., Google Search grounding and code execution). It supports multimodal input and a 1M-token context window.',
    displayName: 'Gemini 2.5 Flash Lite',
    id: 'google/gemini-2.5-flash-lite',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'A 9B open-source model fine-tuned by Google for chat, served by Groq on LPU hardware for fast, efficient inference.',
    displayName: 'Gemma 2 9B IT',
    id: 'google/gemma-2-9b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 256_000,
    description:
      'xAI’s newest flagship model with unparalleled performance in natural language, math, and reasoning—an ideal all-rounder.',
    displayName: 'Grok 4',
    id: 'xai/grok-4',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'xAI’s lightweight model that thinks before responding, ideal for simple or logic-based tasks without deep domain knowledge. Raw reasoning traces are available. The fast variant runs on quicker infrastructure for much faster responses at higher per-token cost.',
    displayName: 'Grok 3 Mini Fast Beta',
    id: 'xai/grok-3-mini-fast',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'xAI’s lightweight model that thinks before responding, ideal for simple or logic-based tasks without deep domain knowledge. Raw reasoning traces are available.',
    displayName: 'Grok 3 Mini Beta',
    id: 'xai/grok-3-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'xAI’s flagship model excels in enterprise use cases like data extraction, coding, and summarization, with deep domain knowledge in finance, healthcare, law, and science. The fast variant runs on quicker infrastructure for much faster responses at higher per-token cost.',
    displayName: 'Grok 3 Fast Beta',
    id: 'xai/grok-3-fast',
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'xAI’s flagship model excels in enterprise use cases like data extraction, coding, and summarization, with deep domain knowledge in finance, healthcare, law, and science.',
    displayName: 'Grok 3 Beta',
    id: 'xai/grok-3',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Grok 2 Vision excels at visual tasks, delivering SOTA performance on visual math reasoning (MathVista) and document QA (DocVQA). It handles documents, charts, graphs, screenshots, and photos.',
    displayName: 'Grok 2 Vision',
    id: 'xai/grok-2-vision',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'Grok 2 is a frontier model with state-of-the-art reasoning, strong chat, coding, and reasoning performance, and ranks above Claude 3.5 Sonnet and GPT-4 Turbo on LMSYS.',
    displayName: 'Grok 2',
    id: 'xai/grok-2',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description:
      'A 70B open-source model fine-tuned by Meta for instruction following, served by Groq on LPU hardware for fast, efficient inference.',
    displayName: 'Llama 3 70B Instruct',
    id: 'meta/llama-3-70b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.59, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.79, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description:
      'An 8B open-source model fine-tuned by Meta for instruction following, served by Groq on LPU hardware for fast, efficient inference.',
    displayName: 'Llama 3 8B Instruct',
    id: 'meta/llama-3-8b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
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
      'An updated Meta Llama 3 70B Instruct with 128K context, multilingual support, and improved reasoning.',
    displayName: 'Llama 3.1 70B Instruct',
    id: 'meta/llama-3.1-70b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_000,
    description:
      'Llama 3.1 8B supports a 128K context window, ideal for real-time chat and data analysis, and offers significant cost savings versus larger models. Served by Groq on LPU hardware for fast, efficient inference.',
    displayName: 'Llama 3.1 8B Instruct',
    id: 'meta/llama-3.1-8b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
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
      'An instruction-tuned image reasoning model (text+image input, text output) optimized for visual recognition, image reasoning, captioning, and general image QA.',
    displayName: 'Llama 3.2 11B Vision Instruct',
    id: 'meta/llama-3.2-11b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
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
      'Text-only model for on-device use cases like multilingual local retrieval, summarization, and rewriting.',
    displayName: 'Llama 3.2 1B Instruct',
    id: 'meta/llama-3.2-1b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
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
      'Text-only model fine-tuned for on-device use cases like multilingual local retrieval, summarization, and rewriting.',
    displayName: 'Llama 3.2 3B Instruct',
    id: 'meta/llama-3.2-3b',
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
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'An instruction-tuned image reasoning model (text+image input, text output) optimized for visual recognition, image reasoning, captioning, and general image QA.',
    displayName: 'Llama 3.2 90B Vision Instruct',
    id: 'meta/llama-3.2-90b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
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
      'A perfect balance of performance and efficiency. Built for high-performance conversational AI in content creation, enterprise apps, and research, with strong language understanding for summarization, classification, sentiment, and code generation.',
    displayName: 'Llama 3.3 70B Instruct',
    id: 'meta/llama-3.3-70b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'The Llama 4 family is a native multimodal AI model set supporting text and multimodal experiences, using MoE for leading text and image understanding. Llama 4 Maverick is a 17B model with 128 experts, served by DeepInfra.',
    displayName: 'Llama 4 Maverick 17B 128E Instruct',
    id: 'meta/llama-4-maverick',
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
    contextWindowTokens: 131_072,
    description:
      'The Llama 4 family is a native multimodal AI model set supporting text and multimodal experiences, using MoE for leading text and image understanding. Llama 4 Scout is a 17B model with 16 experts, served by DeepInfra.',
    displayName: 'Llama 4 Scout 17B 16E Instruct',
    id: 'meta/llama-4-scout',
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
    contextWindowTokens: 256_000,
    description:
      'Mistral Codestral 25.01 is a state-of-the-art coding model optimized for low latency and high-frequency use. It supports 80+ languages and excels at FIM, code correction, and test generation.',
    displayName: 'Mistral Codestral 25.01',
    id: 'mistral/codestral',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
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
      'Devstral is an agentic LLM for software engineering tasks, making it a strong choice for software engineering agents.',
    displayName: 'Devstral Small',
    id: 'mistral/devstral-small',
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
    },
    contextWindowTokens: 128_000,
    description:
      'Complex thinking supported by deep understanding with transparent reasoning you can follow and verify. It maintains high-fidelity reasoning across languages, even mid-task.',
    displayName: 'Magistral Medium 2509',
    id: 'mistral/magistral-medium',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
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
      'Complex thinking supported by deep understanding with transparent reasoning you can follow and verify. It maintains high-fidelity reasoning across languages, even mid-task.',
    displayName: 'Magistral Small 2506',
    id: 'mistral/magistral-small',
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
    contextWindowTokens: 128_000,
    description:
      'A compact, efficient model for on-device tasks like assistants and local analytics, delivering low-latency performance.',
    displayName: 'Ministral 3B',
    id: 'mistral/ministral-3b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
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
      'A more powerful model with faster, memory-efficient inference, ideal for complex workflows and demanding edge applications.',
    displayName: 'Ministral 8B',
    id: 'mistral/ministral-8b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_000,
    description:
      'Mistral Large is ideal for complex tasks that require strong reasoning or specialization—synthetic text generation, code generation, RAG, or agents.',
    displayName: 'Mistral Large',
    id: 'mistral/mistral-large',
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
    contextWindowTokens: 32_000,
    description:
      'Mistral Small is ideal for simple, batchable tasks like classification, customer support, or text generation, delivering great performance at an affordable price.',
    displayName: 'Mistral Small',
    id: 'mistral/mistral-small',
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
    contextWindowTokens: 65_536,
    description: '8x22B Instruct model. 8x22B is an open MoE model served by Mistral.',
    displayName: 'Mixtral MoE 8x22B Instruct',
    id: 'mistral/mixtral-8x22b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
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
    description: 'A 12B model with image understanding and text.',
    displayName: 'Pixtral 12B 2409',
    id: 'mistral/pixtral-12b',
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
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Pixtral Large is the second model in our multimodal family with frontier-level image understanding. It handles documents, charts, and natural images while retaining Mistral Large 2’s leading text understanding.',
    displayName: 'Pixtral Large',
    id: 'mistral/pixtral-large',
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
    contextWindowTokens: 32_768,
    description:
      'Mercury Coder Small is ideal for code generation, debugging, and refactoring with minimal latency.',
    displayName: 'Mercury Coder Small Beta',
    id: 'inception/mercury-coder-small',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
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
      'Morph provides a specialized model to apply code changes suggested by frontier models (e.g., Claude or GPT-4o) to your existing files at FAST 4500+ tokens/sec. It is the final step in an AI coding workflow and supports 16k input/output tokens.',
    displayName: 'Morph V3 Fast',
    id: 'morph/morph-v3-fast',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
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
      'Morph provides a specialized model to apply code changes suggested by frontier models (e.g., Claude or GPT-4o) to your existing files at FAST 2500+ tokens/sec. It is the final step in an AI coding workflow and supports 16k input/output tokens.',
    displayName: 'Morph V3 Large',
    id: 'morph/morph-v3-large',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_385,
    description:
      'OpenAI’s most capable and cost-effective GPT-3.5 model, optimized for chat but still strong on classic completions.',
    displayName: 'GPT-3.5 Turbo',
    id: 'openai/gpt-3.5-turbo',
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
    contextWindowTokens: 8192,
    description:
      'Similar capabilities to GPT-3-era models, compatible with legacy completion endpoints rather than chat.',
    displayName: 'GPT-3.5 Turbo Instruct',
    id: 'openai/gpt-3.5-turbo-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
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
      'OpenAI’s gpt-4-turbo has broad general knowledge and domain expertise, follows complex natural-language instructions, and solves difficult problems accurately. Knowledge cutoff is April 2023 with a 128k context window.',
    displayName: 'GPT-4 Turbo',
    id: 'openai/gpt-4-turbo',
    pricing: {
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT 4.1 mini balances intelligence, speed, and cost, making it attractive for many use cases.',
    displayName: 'GPT-4.1 mini',
    id: 'openai/gpt-4.1-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
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
      'GPT-4o mini is OpenAI’s most advanced and cost-effective small model. It is multimodal (text or image input, text output) with higher intelligence than gpt-3.5-turbo at similar speed.',
    displayName: 'GPT-4o mini',
    id: 'openai/gpt-4o-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 127_000,
    description:
      'Perplexity’s lightweight product with search grounding, faster and cheaper than Sonar Pro.',
    displayName: 'Sonar',
    id: 'perplexity/sonar',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Perplexity’s flagship product with search grounding, supporting advanced queries and follow-ups.',
    displayName: 'Sonar Pro',
    id: 'perplexity/sonar-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 127_000,
    description:
      'A reasoning-focused model that outputs chain-of-thought (CoT) with detailed, search-grounded explanations.',
    displayName: 'Sonar Reasoning',
    id: 'perplexity/sonar-reasoning',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 127_000,
    description:
      'An advanced reasoning-focused model that outputs CoT with enhanced search, including multiple search queries per request.',
    displayName: 'Sonar Reasoning Pro',
    id: 'perplexity/sonar-reasoning-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
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
      'Access the models behind v0 to generate, fix, and optimize modern web apps with framework-specific reasoning and up-to-date knowledge.',
    displayName: 'v0-1.0-md',
    id: 'vercel/v0-1.0-md',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
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
      'Access the models behind v0 to generate, fix, and optimize modern web apps with framework-specific reasoning and up-to-date knowledge.',
    displayName: 'v0-1.5-md',
    id: 'vercel/v0-1.5-md',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 300_000,
    description:
      'A very low-cost multimodal model with extremely fast processing of image, video, and text inputs.',
    displayName: 'Nova Lite',
    id: 'amazon/nova-lite',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: 'A text-only model offering ultra-low latency at very low cost.',
    displayName: 'Nova Micro',
    id: 'amazon/nova-micro',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.035, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Claude 3.5 Haiku is the next generation of our fastest model. It matches Claude 3 Haiku’s speed while improving across skills and surpassing the previous flagship Claude 3 Opus on many benchmarks.',
    displayName: 'Claude 3.5 Haiku',
    id: 'anthropic/claude-3.5-haiku',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Claude 3 Haiku is Anthropic’s fastest model, designed for enterprise workloads with longer prompts. It can quickly analyze large documents like quarterly reports, contracts, or legal cases at half the cost of peers.',
    displayName: 'Claude 3 Haiku',
    id: 'anthropic/claude-3-haiku',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 300_000,
    description:
      'A highly capable multimodal model with the best balance of accuracy, speed, and cost for a wide range of tasks.',
    displayName: 'Nova Pro',
    id: 'amazon/nova-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

const vercelAIGatewayEmbeddingModels: AIEmbeddingModelCard[] = [
  {
    description:
      'Amazon Titan Text Embeddings V2 is a lightweight, efficient multilingual embedding model supporting 1024, 512, and 256 dimensions.',
    displayName: 'Titan Text Embeddings V2',
    id: 'amazon/titan-embed-text-v2',
    maxDimension: 1024,
    pricing: {
      units: [{ name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description:
      'A state-of-the-art embedding model with strong performance in English, multilingual, and code tasks.',
    displayName: 'Gemini Embedding 001',
    id: 'google/gemini-embedding-001',
    maxDimension: 768,
    pricing: {
      units: [{ name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description:
      'An English-focused text embedding model optimized for code and English language tasks.',
    displayName: 'Text Embedding 005',
    id: 'google/text-embedding-005',
    maxDimension: 768,
    pricing: {
      units: [{ name: 'textInput', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description:
      'A multilingual text embedding model optimized for cross-lingual tasks across many languages.',
    displayName: 'Text Multilingual Embedding 002',
    id: 'google/text-multilingual-embedding-002',
    maxDimension: 768,
    pricing: {
      units: [{ name: 'textInput', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description:
      'A model that classifies or converts text, images, or mixed content into embeddings.',
    displayName: 'Embed v4.0',
    id: 'cohere/embed-v4.0',
    maxDimension: 1024,
    pricing: {
      units: [{ name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description:
      'A code embedding model for embedding codebases and repositories to support coding assistants.',
    displayName: 'Codestral Embed',
    id: 'mistral/codestral-embed',
    maxDimension: 1024,
    pricing: {
      units: [{ name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description:
      'A general text embedding model for semantic search, similarity, clustering, and RAG workflows.',
    displayName: 'Mistral Embed',
    id: 'mistral/mistral-embed',
    maxDimension: 1024,
    pricing: {
      units: [{ name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: 'OpenAI’s most capable embedding model for English and non-English tasks.',
    displayName: 'text-embedding-3-large',
    id: 'openai/text-embedding-3-large',
    maxDimension: 3072,
    pricing: {
      units: [{ name: 'textInput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: 'OpenAI’s improved, higher-performance ada embedding model variant.',
    displayName: 'text-embedding-3-small',
    id: 'openai/text-embedding-3-small',
    maxDimension: 1536,
    pricing: {
      units: [{ name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: 'OpenAI’s legacy text embedding model.',
    displayName: 'text-embedding-ada-002',
    id: 'openai/text-embedding-ada-002',
    maxDimension: 1536,
    pricing: {
      units: [{ name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
];

export const allModels = [...vercelAIGatewayChatModels, ...vercelAIGatewayEmbeddingModels];

export default allModels;
