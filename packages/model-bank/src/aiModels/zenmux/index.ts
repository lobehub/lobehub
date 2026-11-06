import type { AIChatModelCard } from '../../types/aiModel';
import { zenmuxLegacyChatModels } from './legacyChat';

const zenmuxChatModels: AIChatModelCard[] = [
  {
    description:
      'ZenMux auto-routing selects the best-value, best-performing model from supported options based on your request.',
    displayName: 'Auto Router',
    id: 'zenmux/auto',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.2 is a flagship model for coding and agentic workflows with stronger reasoning and long-context performance.',
    displayName: 'GPT-5.2',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.2',
    id: 'openai/gpt-5.2',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-11',
    settings: {
      extendParams: ['textVerbosity'],
      reasoningEffort: { levels: ['none', 'low', 'medium', 'high', 'xhigh'] },
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
    contextWindowTokens: 400_000,
    description:
      'GPT-5.2 Pro: a smarter, more precise GPT-5.2 variant (Responses API only), suited for harder problems and longer multi-turn reasoning.',
    displayName: 'GPT-5.2 pro',
    family: 'gpt',
    generation: 'gpt-5.2',
    id: 'openai/gpt-5.2-pro',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 168, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-11',
    settings: {
      searchImpl: 'params',
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
      'GPT-5.2 Chat is the ChatGPT variant for experiencing the newest conversation improvements.',
    displayName: 'GPT-5.2 Chat',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.2',
    id: 'openai/gpt-5.2-chat',
    knowledgeCutoff: '2025-08',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-11',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      imageOutput: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    description:
      'Gemini 3 Pro Image (Nano Banana Pro) is Google’s image generation model with multimodal conversation support.',
    displayName: 'Gemini 3 Pro Image (Nano Banana Pro)',
    family: 'gemini',
    generation: 'gemini-3',
    id: 'google/gemini-3-pro-image-preview',
    knowledgeCutoff: '2025-01',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'imageOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-20',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'Gemini 3 Pro is the next-generation multimodal reasoning model in the Gemini family, understanding text, audio, images, and video, and handling complex tasks and large codebases.',
    displayName: 'Gemini 3 Pro Preview',
    family: 'gemini',
    generation: 'gemini-3',
    id: 'google/gemini-3-pro-preview',
    knowledgeCutoff: '2025-01',
    maxOutput: 65_530,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-20',
    settings: {
      extendParams: ['urlContext'],
      reasoningEffort: { levels: ['low', 'high'] },
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.1 is the latest flagship in the GPT-5 series, with significant improvements over GPT-5 in general reasoning, instruction following, and conversational naturalness, suitable for broad tasks.',
    displayName: 'GPT-5.1',
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'openai/gpt-5.1',
    knowledgeCutoff: '2024-09',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['textVerbosity'],
      reasoningEffort: { levels: ['none', 'low', 'medium', 'high'] },
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
      'GPT-5.1 Chat is the lightweight member of the GPT-5.1 family, optimized for low-latency conversations while retaining strong reasoning and instruction execution.',
    displayName: 'GPT-5.1 Chat',
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'openai/gpt-5.1-chat',
    knowledgeCutoff: '2024-09',
    maxOutput: 16_380,
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
    contextWindowTokens: 400_000,
    description:
      'GPT-5.1-Codex is a GPT-5.1 variant optimized for software engineering and coding workflows, suitable for large refactors, complex debugging, and long autonomous coding tasks.',
    displayName: 'GPT-5.1-Codex',
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'openai/gpt-5.1-codex',
    knowledgeCutoff: '2024-09',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      reasoningEffort: { levels: ['none', 'low', 'medium', 'high'] },
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.1-Codex-Mini is a smaller, faster version of GPT-5.1-Codex, better for latency- and cost-sensitive coding scenarios.',
    displayName: 'GPT-5.1-Codex-Mini',
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'openai/gpt-5.1-codex-mini',
    knowledgeCutoff: '2024-09',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      reasoningEffort: { levels: ['none', 'low', 'medium', 'high'] },
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description:
      'Grok 4 Fast is xAI’s high-throughput, low-cost model (supports a 2M context window), ideal for high-concurrency and long-context use cases.',
    displayName: 'Grok 4.1 Fast',
    family: 'grok',
    generation: 'grok-4.1',
    id: 'x-ai/grok-4.1-fast',
    maxOutput: 30_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 2_000_000,
    description:
      'Grok 4 Fast (Non-Reasoning) is xAI’s high-throughput, low-cost multimodal model (supports a 2M context window) for scenarios sensitive to latency and cost that do not require in-model reasoning. It sits alongside the reasoning version of Grok 4 Fast, and reasoning can be enabled via the API reasoning parameter when needed. Prompts and completions may be used by xAI or OpenRouter to improve future models.',
    displayName: 'Grok 4.1 Fast (Non-Reasoning)',
    family: 'grok',
    generation: 'grok-4.1',
    id: 'x-ai/grok-4.1-fast-non-reasoning',
    maxOutput: 30_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
      'ERNIE 5.0 Thinking Preview is Baidu’s next-generation native multimodal ERNIE model, strong in multimodal understanding, instruction following, creation, factual Q&A, and tool calling.',
    displayName: 'ERNIE-5.0-Thinking-Preview',
    family: 'ernie',
    generation: 'ernie-5.0',
    id: 'baidu/ernie-5.0-thinking-preview',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.84, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.37, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-Code is ByteDance Volcano Engine’s LLM optimized for agentic programming, performing strongly on programming and agent benchmarks with 256K context support.',
    displayName: 'Doubao-Seed-Code',
    family: 'doubao',
    id: 'volcengine/doubao-seed-code',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.17, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.12, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      'Kimi K2 Thinking is Moonshot’s reasoning model optimized for deep reasoning tasks, with general agent capabilities.',
    displayName: 'Kimi K2 Thinking',
    family: 'kimi',
    generation: 'kimi-k2',
    id: 'moonshotai/kimi-k2-thinking',
    maxOutput: 262_144,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      'Kimi K2 Thinking Turbo is a high-speed version of Kimi K2 Thinking, significantly lowering latency while retaining deep reasoning.',
    displayName: 'Kimi K2 Thinking Turbo',
    family: 'kimi',
    generation: 'kimi-k2',
    id: 'moonshotai/kimi-k2-thinking-turbo',
    maxOutput: 262_144,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
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
      'Ming-flash-omni Preview is inclusionAI’s multimodal model, supporting speech, image, and video inputs, with improved image rendering and speech recognition.',
    displayName: 'Ming-flash-omini Preview',
    id: 'inclusionai/ming-flash-omini-preview',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Ring-1T is inclusionAI’s trillion-parameter MoE reasoning model, suited for large-scale reasoning and research tasks.',
    displayName: 'Ring-1T',
    family: 'ring',
    id: 'inclusionai/ring-1t',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Ling-1T is inclusionAI’s 1T MoE model, optimized for high-intensity reasoning tasks and large-context workloads.',
    displayName: 'Ling-1T',
    family: 'ling',
    id: 'inclusionai/ling-1t',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Ling-flash-2.0 is inclusionAI’s MoE model optimized for efficiency and reasoning performance, suitable for mid-to-large tasks.',
    displayName: 'Ling-flash-2.0',
    family: 'ling',
    id: 'inclusionai/ling-flash-2.0',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Ring-flash-2.0 is a Ring model variant from inclusionAI for high-throughput scenarios, emphasizing speed and cost efficiency.',
    displayName: 'Ring-flash-2.0',
    family: 'ring',
    id: 'inclusionai/ring-flash-2.0',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Ling-mini-2.0 is inclusionAI’s lightweight MoE model, significantly reducing cost while retaining reasoning capability.',
    displayName: 'Ling-mini-2.0',
    family: 'ling',
    id: 'inclusionai/ling-mini-2.0',
    maxOutput: 32_000,
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
    contextWindowTokens: 128_000,
    description:
      "Ring-mini-2.0 is inclusionAI's high-throughput lightweight MoE model, built for concurrency.",
    displayName: 'Ring-mini-2.0',
    family: 'ring',
    id: 'inclusionai/ring-mini-2.0',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'MiniMax-M2 is a high-value model that excels at coding and agent tasks for many engineering scenarios.',
    displayName: 'MiniMax M2',
    family: 'minimax',
    generation: 'minimax-m2',
    id: 'minimax/minimax-m2',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 256_000,
    description:
      'KAT-Coder-Pro-V1 (limited-time free) focuses on code understanding and automation for efficient coding agents.',
    displayName: 'KAT-Coder-Pro-V1 (Limited-time Free)',
    family: 'kat-coder',
    id: 'kuaishou/kat-coder-pro-v1',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
    description:
      'Claude Haiku 4.5 is Anthropic’s high-performance fast model, delivering very low latency while maintaining high accuracy.',
    displayName: 'Claude Haiku 4.5',
    family: 'claude-haiku',
    generation: 'claude-4.5',
    id: 'anthropic/claude-haiku-4.5',
    knowledgeCutoff: '2025-02',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek-V3 is DeepSeek’s high-performance hybrid reasoning model for complex tasks and tool integration.',
    displayName: 'DeepSeek-V3.2-Exp (Non-thinking Mode)',
    family: 'deepseek',
    id: 'deepseek/deepseek-chat',
    maxOutput: 8000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.68, strategy: 'fixed', unit: 'millionTokens' },
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
      'DeepSeek-V3 Thinking (reasoner) is DeepSeek’s experimental reasoning model, suitable for high-complexity reasoning tasks.',
    displayName: 'DeepSeek-V3.2-Exp (Thinking Mode)',
    family: 'deepseek',
    id: 'deepseek/deepseek-reasoner',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.42, strategy: 'fixed', unit: 'millionTokens' },
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
      'DeepSeek R1 0528 is an updated variant focused on open availability and deeper reasoning.',
    displayName: 'DeepSeek R1 0528',
    family: 'deepseek',
    generation: 'deepseek-r1',
    id: 'deepseek/deepseek-r1-0528',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.23, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
    contextWindowTokens: 1_050_000,
    description:
      'Gemini 2.5 Pro is Google’s flagship reasoning model with long context support for complex tasks.',
    displayName: 'Gemini 2.5 Pro',
    family: 'gemini',
    generation: 'gemini-2.5',
    id: 'google/gemini-2.5-pro',
    knowledgeCutoff: '2025-01',
    maxOutput: 65_530,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
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
    contextWindowTokens: 1_050_000,
    description:
      'Gemini 2.5 Flash is Google’s family spanning low latency to high-performance reasoning.',
    displayName: 'Gemini 2.5 Flash',
    family: 'gemini',
    generation: 'gemini-2.5',
    id: 'google/gemini-2.5-flash',
    knowledgeCutoff: '2025-01',
    maxOutput: 65_530,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 Pro is OpenAI’s flagship model, providing stronger reasoning, code generation, and enterprise-grade features, with test-time routing and stricter safety policies.',
    displayName: 'GPT-5 Pro',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'openai/gpt-5-pro',
    knowledgeCutoff: '2024-09',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 is OpenAI’s high-performance model for a wide range of production and research tasks.',
    displayName: 'GPT-5',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'openai/gpt-5',
    knowledgeCutoff: '2024-09',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['textVerbosity'],
      reasoningEffort: { levels: ['minimal', 'low', 'medium', 'high'] },
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
      'GPT-5 Chat is a GPT-5 variant optimized for conversations with lower latency for better interactivity.',
    displayName: 'GPT-5 Chat',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'openai/gpt-5-chat',
    knowledgeCutoff: '2024-09',
    maxOutput: 16_380,
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
    contextWindowTokens: 400_000,
    description: 'GPT-5 Mini is a smaller GPT-5 variant for low-latency, low-cost scenarios.',
    displayName: 'GPT-5 Mini',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'openai/gpt-5-mini',
    knowledgeCutoff: '2024-05',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['textVerbosity'],
      reasoningEffort: { levels: ['minimal', 'low', 'medium', 'high'] },
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
      'GPT-5 Nano is the ultra-small variant for scenarios with strict cost and latency constraints.',
    displayName: 'GPT-5 Nano',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'openai/gpt-5-nano',
    knowledgeCutoff: '2024-05',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['textVerbosity'],
      reasoningEffort: { levels: ['minimal', 'low', 'medium', 'high'] },
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
      'GPT-5-Codex is a GPT-5 variant further optimized for coding and large-scale code workflows.',
    displayName: 'GPT-5 Codex',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'openai/gpt-5-codex',
    knowledgeCutoff: '2024-09',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['textVerbosity'],
      reasoningEffort: { levels: ['minimal', 'low', 'medium', 'high'] },
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'The GPT-4.1 series provides larger context windows and stronger engineering and reasoning capabilities.',
    displayName: 'GPT-4.1',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'openai/gpt-4.1',
    knowledgeCutoff: '2024-06',
    maxOutput: 32_770,
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
      reasoning: true,
    },
    contextWindowTokens: 1_050_000,
    description: 'GPT-4.1 Mini offers lower latency and better value for mid-context workloads.',
    displayName: 'GPT-4.1 Mini',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'openai/gpt-4.1-mini',
    knowledgeCutoff: '2024-06',
    maxOutput: 32_770,
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
      reasoning: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-4.1 Nano is an ultra-low-cost, low-latency option for high-frequency short chats or classification.',
    displayName: 'GPT-4.1 Nano',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'openai/gpt-4.1-nano',
    knowledgeCutoff: '2024-06',
    maxOutput: 32_770,
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
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 Max (preview) is the Max variant for advanced reasoning and tool integration.',
    displayName: 'Qwen3 Max Thinking Preview',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen/qwen3-max-preview',
    maxOutput: 65_540,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 Max is the high-end reasoning model in the Qwen3 series for multilingual reasoning and tool integration.',
    displayName: 'Qwen3 Max',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen/qwen3-max',
    maxOutput: 65_540,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 VL-Plus is the vision-enhanced Qwen3 variant with improved multimodal reasoning and video processing.',
    displayName: 'Qwen3-VL-Plus',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen/qwen3-vl-plus',
    maxOutput: 32_770,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3-Coder-Plus is a Qwen-series coding agent model optimized for more complex tool use and long-running sessions.',
    displayName: 'Qwen3-Coder-Plus',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen/qwen3-coder-plus',
    maxOutput: 65_540,
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
    contextWindowTokens: 256_000,
    description:
      'Qwen3-Coder is the Qwen3 code-generation family, strong at long-document code understanding and generation.',
    displayName: 'Qwen3-Coder',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen/qwen3-coder',
    maxOutput: 261_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5.01, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description: 'Qwen3-14B is the 14B variant for general reasoning and chat scenarios.',
    displayName: 'Qwen3 14B',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen/qwen3-14b',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      "GLM 4.6 is Z.AI's flagship model with extended context length and coding capability.",
    displayName: 'GLM 4.6',
    family: 'glm',
    generation: 'glm-4.6',
    id: 'z-ai/glm-4.6',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.54, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude Opus 4.5 is Anthropic’s flagship model, combining outstanding intelligence with scalable performance, ideal for complex tasks requiring the highest-quality responses and reasoning.',
    displayName: 'Claude Opus 4.5',
    family: 'claude-opus',
    generation: 'claude-4.5',
    id: 'claude-opus-4-5-20251101',
    knowledgeCutoff: '2025-05',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-24',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

export const allModels = [...zenmuxChatModels, ...zenmuxLegacyChatModels];

export default allModels;
