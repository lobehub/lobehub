import type { AIChatModelCard } from '../types/aiModel';

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
    id: 'openai/gpt-5.2',
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
      extendParams: ['gpt5_2ReasoningEffort', 'textVerbosity'],
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
    id: 'openai/gpt-5.2-pro',
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
    id: 'openai/gpt-5.2-chat',
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
    id: 'google/gemini-3-pro-image-preview',
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
      imageOutput: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    description: 'Gemini 3 Pro Image free tier with limited-quota multimodal generation.',
    displayName: 'Gemini 3 Pro Image (Nano Banana) Free',
    enabled: true,
    id: 'google/gemini-3-pro-image-preview-free',
    maxOutput: 32_768,
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
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'Gemini 3 Pro is the next-generation multimodal reasoning model in the Gemini family, understanding text, audio, images, and video, and handling complex tasks and large codebases.',
    displayName: 'Gemini 3 Pro Preview',
    id: 'google/gemini-3-pro-preview',
    maxOutput: 65_530,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-20',
    settings: {
      extendParams: ['thinkingLevel2', 'urlContext'],
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
      'Gemini 3 Pro Preview Free offers the same multimodal understanding and reasoning as the standard version, but with quota and rate limits, making it better for trials and low-frequency use.',
    displayName: 'Gemini 3 Pro Preview Free',
    enabled: true,
    id: 'google/gemini-3-pro-preview-free',
    maxOutput: 65_530,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['thinkingLevel2', 'urlContext'],
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
    id: 'openai/gpt-5.1',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5_1ReasoningEffort', 'textVerbosity'],
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
    id: 'openai/gpt-5.1-chat',
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
    id: 'openai/gpt-5.1-codex',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5_1ReasoningEffort'],
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
    id: 'openai/gpt-5.1-codex-mini',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5_1ReasoningEffort'],
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
    contextWindowTokens: 2_000_000,
    description:
      'Grok 4 Fast is xAI’s high-throughput, low-cost model (supports a 2M context window), ideal for high-concurrency and long-context use cases.',
    displayName: 'Grok 4 Fast',
    id: 'x-ai/grok-4-fast',
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
    displayName: 'Grok 4 Fast (Non-Reasoning)',
    id: 'x-ai/grok-4-fast-non-reasoning',
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
      reasoning: true,
    },
    contextWindowTokens: 256_000,
    description:
      "Grok 4 is xAI's flagship reasoning model with strong reasoning and multimodal capability.",
    displayName: 'Grok 4',
    id: 'x-ai/grok-4',
    maxOutput: 256_000,
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
      reasoning: true,
    },
    contextWindowTokens: 256_000,
    description:
      "Grok Code Fast 1 is xAI's fast code model with readable, engineering-friendly output.",
    displayName: 'Grok Code Fast 1',
    id: 'x-ai/grok-code-fast-1',
    maxOutput: 10_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ERNIE 5.0 Thinking Preview is Baidu’s next-generation native multimodal ERNIE model, strong in multimodal understanding, instruction following, creation, factual Q&A, and tool calling.',
    displayName: 'ERNIE-5.0-Thinking-Preview',
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
    id: 'anthropic/claude-haiku-4.5',
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
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek-V3 is DeepSeek’s high-performance hybrid reasoning model for complex tasks and tool integration.',
    displayName: 'DeepSeek-V3.2-Exp (Non-thinking Mode)',
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
    id: 'google/gemini-2.5-pro',
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
      'Gemini 2.5 Pro free tier offers limited-quota multimodal long-context, suitable for trials and light workflows.',
    displayName: 'Gemini 2.5 Pro Free',
    id: 'google/gemini-2.5-pro-free',
    maxOutput: 65_530,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
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
      'Gemini 2.5 Flash (Lite/Pro/Flash) is Google’s family spanning low latency to high-performance reasoning.',
    displayName: 'Gemini 2.5 Flash',
    id: 'google/gemini-2.5-flash',
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
    id: 'openai/gpt-5-pro',
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
    id: 'openai/gpt-5',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-5 Chat is a GPT-5 variant optimized for conversations with lower latency for better interactivity.',
    displayName: 'GPT-5 Chat',
    id: 'openai/gpt-5-chat',
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
    id: 'openai/gpt-5-mini',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
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
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 Nano is the ultra-small variant for scenarios with strict cost and latency constraints.',
    displayName: 'GPT-5 Nano',
    id: 'openai/gpt-5-nano',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
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
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5-Codex is a GPT-5 variant further optimized for coding and large-scale code workflows.',
    displayName: 'GPT-5 Codex',
    id: 'openai/gpt-5-codex',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
    },
    contextWindowTokens: 1_050_000,
    description:
      'The GPT-4.1 series provides larger context windows and stronger engineering and reasoning capabilities.',
    displayName: 'GPT-4.1',
    id: 'openai/gpt-4.1',
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
    id: 'openai/gpt-4.1-mini',
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
    id: 'openai/gpt-4.1-nano',
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
    id: 'claude-opus-4-5-20251101',
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
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Opus 4.1 is Anthropic’s high-end model optimized for programming, complex reasoning, and long-running tasks.',
    displayName: 'Claude Opus 4.1',
    id: 'anthropic/claude-opus-4.1',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
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
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Opus 4 is Anthropic’s flagship model designed for complex tasks and enterprise applications.',
    displayName: 'Claude Opus 4',
    id: 'anthropic/claude-opus-4',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
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
      imageOutput: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Gemini 2.5 Flash Image (Nano Banana) is Google’s image generation model with multimodal conversation support.',
    displayName: 'Gemini 2.5 Flash Image (Nano Banana)',
    id: 'google/gemini-2.5-flash-image',
    maxOutput: 8192,
    pricing: {
      approximatePricePerImage: 0.039,
      units: [
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      imageOutput: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description: 'Gemini 2.5 Flash Image free tier with limited-quota multimodal generation.',
    displayName: 'Gemini 2.5 Flash Image (Nano Banana) Free',
    id: 'google/gemini-2.5-flash-image-free',
    maxOutput: 8192,
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
      'Claude Sonnet 4.5 is Anthropic’s latest hybrid reasoning model optimized for complex reasoning and coding.',
    displayName: 'Claude Sonnet 4.5',
    id: 'anthropic/claude-sonnet-4.5',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
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
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Claude Sonnet 4 is Anthropic’s hybrid reasoning model with mixed thinking and non-thinking capability.',
    displayName: 'Claude Sonnet 4',
    id: 'anthropic/claude-sonnet-4',
    maxOutput: 64_000,
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
    contextWindowTokens: 200_000,
    description: 'OpenAI o4-mini is a small, efficient reasoning model for low-latency scenarios.',
    displayName: 'o4 Mini',
    id: 'openai/o4-mini',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
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
    },
    contextWindowTokens: 128_000,
    description:
      'The GPT-4o family is OpenAI’s Omni model with text + image input and text output.',
    displayName: 'GPT-4o',
    id: 'openai/gpt-4o',
    maxOutput: 16_380,
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
    description: 'GPT-4o-mini is a fast, small GPT-4o variant for low-latency multimodal use.',
    displayName: 'GPT-4o-mini',
    id: 'openai/gpt-4o-mini',
    maxOutput: 16_380,
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
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Kimi K2 0711 is the instruct variant in the Kimi series, suited for high-quality code and tool use.',
    displayName: 'Kimi K2 0711',
    id: 'moonshotai/kimi-k2-0711',
    maxOutput: 32_000,
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
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GLM 4.5 Air is a lightweight GLM 4.5 variant for cost-sensitive scenarios while retaining strong reasoning.',
    displayName: 'GLM 4.5 Air',
    id: 'z-ai/glm-4.5-air',
    maxOutput: 96_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.11, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
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
      'Claude 3.5 Haiku features enhanced speed, coding accuracy, and tool use, suitable for scenarios with demanding requirements for speed and tool interaction.',
    displayName: 'Claude 3.5 Haiku',
    id: 'anthropic/claude-3.5-haiku',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
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
      'Claude 3.5 Sonnet is the fast, efficient model in the Sonnet family, offering better coding and reasoning performance, with some versions gradually replaced by Sonnet 3.7 and later.',
    displayName: 'Claude 3.5 Sonnet',
    id: 'anthropic/claude-3.5-sonnet',
    maxOutput: 8192,
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
    contextWindowTokens: 200_000,
    description:
      'Claude 3.7 Sonnet is an upgraded Sonnet model with stronger reasoning and coding, suitable for enterprise-grade complex tasks.',
    displayName: 'Claude 3.7 Sonnet',
    id: 'anthropic/claude-3.7-sonnet',
    maxOutput: 64_000,
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
      search: true,
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek-V3.1 is DeepSeek’s long-context hybrid reasoning model, supporting mixed thinking/non-thinking modes and tool integration.',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek/deepseek-chat-v3.1',
    maxOutput: 65_540,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.11, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_050_000,
    description:
      'Gemini 2.0 Flash is Google’s high-performance reasoning model for extended multimodal tasks.',
    displayName: 'Gemini 2.0 Flash',
    id: 'google/gemini-2.0-flash',
    maxOutput: 8192,
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
    contextWindowTokens: 1_050_000,
    description:
      'Gemini 2.0 Flash Lite is a lightweight Gemini variant with thinking disabled by default to improve latency and cost, but it can be enabled via parameters.',
    displayName: 'Gemini 2.0 Flash Lite',
    id: 'google/gemini-2.0-flash-lite-001',
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
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'Gemini 2.5 Flash Lite is the lightweight Gemini 2.5 variant optimized for latency and cost, suitable for high-throughput scenarios.',
    displayName: 'Gemini 2.5 Flash Lite',
    id: 'google/gemini-2.5-flash-lite',
    maxOutput: 65_530,
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
      'Kimi K2 0905 is an update that expands context and reasoning performance with coding optimizations.',
    displayName: 'Kimi K2 0905',
    id: 'moonshotai/kimi-k2-0905',
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
      reasoning: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Qwen3-235B-A22B-Instruct-2507 is the Instruct variant in the Qwen3 series, balancing multilingual instruction use with long-context scenarios.',
    displayName: 'Qwen3 235B A22B Instruct 2507',
    id: 'qwen/qwen3-235b-a22b-2507',
    maxOutput: 262_100,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.11, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Qwen3-235B-A22B-Thinking-2507 is the Thinking variant of Qwen3, strengthened for complex math and reasoning tasks.',
    displayName: 'Qwen3 235B A22B Thinking 2507',
    id: 'qwen/qwen3-235b-a22b-thinking-2507',
    maxOutput: 262_100,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.78, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: { reasoning: true },
    contextWindowTokens: 128_000,
    description:
      'GLM 4.5 is Z.AI’s flagship model with hybrid reasoning optimized for engineering and long-context tasks.',
    displayName: 'GLM 4.5',
    id: 'z-ai/glm-4.5',
    maxOutput: 96_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.54, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...zenmuxChatModels];

export default allModels;
