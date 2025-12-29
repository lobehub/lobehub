import { AIChatModelCard } from '../types/aiModel';

const zenmuxChatModels: AIChatModelCard[] = [
  {
    description:
      'ZenMux 的自动路由功能会根据你的请求内容，在支持的模型中自动选择当前性价比最高、表现最好的模型。',
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
    description: 'GPT-5.2 — 面向编码与 agentic 工作流的旗舰模型，提供更强推理与长上下文能力。',
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
      extendParams: ['gpt5_1ReasoningEffort', 'textVerbosity'],
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
      'GPT-5.2 pro：更聪明、更精确的 GPT-5.2 版本（Responses API Only），适合高难度问题与更长的多轮推理。',
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
    description: 'GPT-5.2 Chat：ChatGPT 使用的 GPT-5.2 变体（chat-latest），用于体验最新对话改进。',
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
      'Gemini 3 Pro Image（Nano Banana Pro）是 Google 的图像生成模型，同时支持多模态对话。',
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
    description: 'Gemini 3 Pro Image ，最新的多模态生成模型。',
    displayName: 'Gemini 3 Pro Image (Nano Banana)',
    enabled: true,
    id: 'google/gemini-3-pro-image-preview',
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
      'Gemini 3 Pro 是 Gemini 系列下一代多模态推理模型，可理解文本、音频、图像、视频等多种输入，并处理复杂任务与大型代码库。',
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
      'Gemini 3 Pro 预览版，具备与标准版相同的多模态理解与推理能力，但受免费额度与速率限制影响，更适合作为体验与低频使用。',
    displayName: 'Gemini 3 Pro Preview',
    enabled: true,
    id: 'google/gemini-3-pro-preview',
    maxOutput: 65_530,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['thinkingLevel', 'urlContext'],
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
      'GPT-5.1 是 GPT-5 系列最新旗舰模型，相比 GPT-5 在通用推理、指令遵循和对话自然度上均有显著提升，适合广泛任务场景。',
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
      'GPT-5.1 Chat 是 GPT-5.1 家族的轻量成员，针对低延迟对话进行优化，同时保留较强的推理与指令执行能力。',
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
      'GPT-5.1-Codex 是针对软件工程和编码工作流优化的 GPT-5.1 变体，适合大型重构、复杂调试与长时间自主编码任务。',
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
      'GPT-5.1-Codex-Mini 是 GPT-5.1-Codex 的小型加速版本，更适合对延迟和成本敏感的编码场景。',
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
      'Grok 4 Fast 是 xAI 的高吞吐、低成本模型（支持 2M 上下文窗口），适合需要高并发与长上下文的使用场景。',
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
      'Grok 4 Fast（Non-Reasoning）是 xAI 的高吞吐、低成本多模态模型（支持 2M 上下文窗口），面向对延迟和成本敏感但不需要启用模型内推理的场景。它与 Grok 4 Fast 的 reasoning 版本并列，可通过 API 的 reasoning enable 参数在需要时开启推理功能。Prompts 和 completions 可能会被 xAI 或 OpenRouter 用于改进未来模型。',
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
      'Grok 4 Fast 是 xAI 的高吞吐、低成本模型（支持 2M 上下文窗口），适合需要高并发与长上下文的使用场景。',
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
      'Grok 4 Fast（Non-Reasoning）是 xAI 的高吞吐、低成本多模态模型（支持 2M 上下文窗口），面向对延迟和成本敏感但不需要启用模型内推理的场景。它与 Grok 4 Fast 的 reasoning 版本并列，可通过 API 的 reasoning enable 参数在需要时开启推理功能。Prompts 和 completions 可能会被 xAI 或 OpenRouter 用于改进未来模型。',
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
    description: 'Grok 4 是 xAI 的旗舰推理模型，提供强大的推理与多模态能力。',
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
    description: 'Grok Code Fast 1 是 xAI 的快速代码模型，输出具可读性与工程化适配。',
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
      'ERNIE 5.0 Thinking Preview 是百度新一代原生多模态文心模型，擅长多模态理解、指令遵循、创作、事实问答与工具调用。',
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
      'Doubao-Seed-Code 是字节火山引擎面向 Agentic Programming 优化的大模型，在多项编程与代理基准上表现优异，支持 256K 上下文。',
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
      'Kimi K2 Thinking 是 Moonshot 针对深度推理任务优化的思考模型，具备通用 Agent 能力。',
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
      'Kimi K2 Thinking Turbo 是 Kimi K2 Thinking 的高速版本，在保持深度推理能力的同时，显著降低响应延迟。',
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
      'Ming-flash-omni Preview 是 inclusionAI 的多模态模型，支持语音、图像和视频输入，优化了图像渲染与语音识别能力。',
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
      'Ring-1T 是 inclusionAI 的 trillion-parameter MoE 思考模型，适合大规模推理与研究类任务。',
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
      'Ling-1T 是 inclusionAI 的 1T MoE 大模型，针对高强度推理任务与大规模上下文进行了优化。',
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
      'Ling-flash-2.0 是 inclusionAI 的 MoE 模型，优化了效率与推理表现，适合中大型任务。',
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
      'Ring-flash-2.0 是 inclusionAI 面向高吞吐场景的 Ring 模型变体，强调速度与成本效率。',
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
      'Ling-mini-2.0 是 inclusionAI 的轻量化 MoE 模型，在保持推理能力的同时显著降低成本。',
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
    description: 'Ring-mini-2.0 是 inclusionAI 的高吞吐轻量化 MoE 版本，主要用于并发场景。',
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
    description: 'MiniMax-M2 是一款在编码与代理任务上表现出色的高性价比模型，适合多种工程场景。',
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
    description: 'KAT-Coder-Pro-V1（限时免费）专注于代码理解与自动化编程，用于高效的编程代理任务。',
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
      'Claude Haiku 4.5 是 Anthropic 的高性能快速模型，在保持较高准确性的同时具有极低延迟。',
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
    description: 'DeepSeek-V3 是 DeepSeek 团队的一款高性能混合推理模型，适合复杂任务与工具集成。',
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
      'DeepSeek-V3 Thinking（reasoner）是 DeepSeek 的实验 reasoning 模型，适合高复杂度推理任务。',
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
    description: 'DeepSeek R1 0528 是 DeepSeek 的更新变体，注重开源可用与推理深度。',
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
    description: 'Gemini 2.5 Pro 是 Google 的旗舰级推理模型，支持长上下文与复杂任务。',
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
    description: 'Gemini 2.5 Pro 免费版，支持受限额度的多模态长上下文，适合试用与轻量工作流。',
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
    description: 'Gemini 2.5 Flash（Lite/Pro/Flash）系列是 Google 的中低延迟到高性能推理模型。',
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
      'GPT-5 Pro 是 OpenAI 的旗舰模型，提供更强的推理、代码生成与企业级功能，支持测试时路由与更严谨的安全策略。',
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
    description: 'GPT-5 是 OpenAI 的高性能模型，适用广泛的生产与研究任务。',
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
    description: 'GPT-5 Chat 是为对话场景优化的 GPT-5 子型号，降低延迟以提升交互体验。',
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
    description: 'GPT-5 Mini 是 GPT-5 家族的精简版，适用于低延迟低成本场景。',
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
    description: 'GPT-5 Nano 是家族中的超小型版本，适合对成本和延迟要求非常高的场景。',
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
    description: 'GPT-5-Codex 是针对编码场景进一步优化的 GPT-5 变体，适合大规模代码工作流。',
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
    description: 'GPT-4.1 系列提供了更大上下文与更强的工程与推理能力。',
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
    description: 'GPT-4.1 Mini 提供更低延迟与更佳性价比，适合中等上下文上下线路。',
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
    description: 'GPT-4.1 Nano 是极低成本低延迟选项，适合高频次短对话或分类场景。',
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
    description: 'Qwen3 Max (preview) 是 Qwen 系列面向高级推理与工具集成的 Max 版本（预览）。',
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
    description: 'Qwen3 Max 是 Qwen3 系列的高端推理模型，适合多语言推理和工具集成。',
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
    description: 'Qwen3 VL-Plus 为 Qwen3 的视觉增强版本，提升了多模态推理与视频处理的能力。',
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
      'Qwen3-Coder-Plus 为 Qwen 系列特别优化的编码代理模型，支持更复杂的工具调用与长期会话。',
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
    description: 'Qwen3-Coder 是 Qwen3 的代码生成器家族，擅长长文档内的代码理解与生成。',
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
    description: 'Qwen3-14B 是 Qwen 系列的 14B 版本，适合常规推理与对话场景。',
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
    description: 'GLM 4.6 是 Z.AI 的旗舰模型，扩展了上下文长度和编码能力。',
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
      'Claude Opus 4.5 是 Anthropic 的旗舰模型，结合了卓越的智能与可扩展性能，适合需要最高质量回应和推理能力的复杂任务。',
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
    description: 'Opus 4.1 是 Anthropic 的高端模型，优化于编程、复杂推理和持续任务。',
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
    description: 'Opus 4 是 Anthropic 的旗舰级模型，专为复杂任务和企业级应用设计。',
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
      'Gemini 2.5 Flash Image（Nano Banana）是 Google 的图像生成模型，同时支持多模态对话。',
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
    description: 'Gemini 2.5 Flash Image 免费版，支持受限额度的多模态生成。',
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
    description: 'Claude Sonnet 4.5 是 Anthropic 最新的混合推理模型，优化于复杂推理和编码。',
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
    description: 'Claude Sonnet 4 是 Anthropic 的混合推理版本，提供思维/非思维混合能力。',
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
    description: 'OpenAI o4-mini 是 OpenAI 的小型高效推理模型，适合低延迟场景。',
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
    description: 'GPT-4o 系列是 OpenAI 的 Omni 模型，支持文本 + 图片输入与文本输出。',
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
    description: 'GPT-4o-mini 是 GPT-4o 的快速小模型版本，适合低延迟图文混合场景。',
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
    description: 'Kimi K2 0711 是 Kimi 系列的 Instruct 版本，适合高质量代码与工具调用场景。',
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
    description: 'GLM 4.5 Air 是 GLM 4.5 的轻量化版本，适合成本敏感场景但保留强推理能力。',
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
      'Claude 3.5 Haiku features enhanced capabilities in speed, coding accuracy, and tool use. 适用于对速度与工具交互有高要求的场景。',
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
      'Claude 3.5 Sonnet 是 Sonnet 家族的快速高效模型，提供更好的编码与推理性能，部分版本将逐步被 Sonnet 3.7 等替代。',
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
      'Claude 3.7 Sonnet 是 Sonnet 系列的升级版，提供更强的推理与编码能力，适用于企业级复杂任务。',
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
      'DeepSeek-V3.1 是 DeepSeek 的长上下文混合推理模型，支持思考/非思考混合模式与工具集成。',
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
    description: 'Gemini 2.0 Flash 是 Google 的高性能推理模型，适用于延展的多模态任务。',
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
      'Gemini 2.0 Flash Lite 是 Gemini 家族的轻量版本，默认不启用思考以提升延迟与成本表现，但可通过参数开启。',
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
      'Gemini 2.5 Flash Lite 是 Gemini 2.5 的轻量版本，优化了延迟与成本，适合高吞吐场景。',
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
    description: 'Kimi K2 0905 是 Kimi 系列的 0905 更新，扩充了上下文与推理性能，优化了编码场景。',
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
      'Qwen3-235B-A22B-Instruct-2507 为 Qwen3 系列的 Instruct 版本，兼顾多语言指令与长上下文场景。',
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
      'Qwen3-235B-A22B-Thinking-2507 为 Qwen3 的 Thinking 变体，针对复杂数学与推理任务进行了强化。',
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
    description: 'GLM 4.5 是 Z.AI 的旗舰模型，支持混合推理模式并优化于工程与长上下文任务。',
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
