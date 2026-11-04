import type { AIChatModelCard } from '../types/aiModel';

// Model IDs come from GET https://modelflare.dev/v1/models.
// Modelflare billing depends on the account's pricing group, so no static pricing is listed here.
// ref: https://modelflare.dev/pricing
const modelflareChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      "GPT-5.5 is OpenAI's previous-generation frontier model for complex professional work.",
    displayName: 'GPT-5.5',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.5',
    id: 'gpt-5.5',
    knowledgeCutoff: '2025-12',
    maxOutput: 128_000,
    releasedAt: '2026-04-23',
    settings: {
      extendParams: ['gpt5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.4 is the frontier model for complex professional work with highest reasoning capability.',
    displayName: 'GPT-5.4',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    releasedAt: '2026-03-05',
    settings: {
      extendParams: ['gpt5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      "Claude Opus 5 is Anthropic's strongest Opus model, built for deep reasoning, agentic coding, and long-horizon professional work.",
    displayName: 'Claude Opus 5',
    enabled: true,
    family: 'claude-opus',
    generation: 'claude-5',
    id: 'claude-opus-5',
    knowledgeCutoff: '2026-05',
    maxOutput: 128_000,
    releasedAt: '2026-07-24',
    settings: {
      disabledParams: ['temperature', 'top_p'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      "Claude Sonnet 5 is Anthropic's most agentic Sonnet model, built for sustained coding, tool use, and long-context workflows with Sonnet-tier speed and efficiency.",
    displayName: 'Claude Sonnet 5',
    enabled: true,
    family: 'claude-sonnet',
    generation: 'claude-5',
    id: 'claude-sonnet-5',
    knowledgeCutoff: '2026-01',
    maxOutput: 128_000,
    releasedAt: '2026-06-30',
    settings: {
      disabledParams: ['temperature', 'top_p'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 200_000,
    description:
      'Claude Haiku 4.5 by Anthropic — next-gen Haiku with enhanced reasoning and vision.',
    displayName: 'Claude Haiku 4.5',
    enabled: true,
    family: 'claude-haiku',
    generation: 'claude-4.5',
    id: 'claude-haiku-4-5',
    knowledgeCutoff: '2025-02',
    maxOutput: 32_000,
    releasedAt: '2025-10-15',
    type: 'chat',
  },
  {
    abilities: {
      audio: true,
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      "Gemini 3.8 Flash is Google's most intelligent Flash model, engineered for long-horizon software engineering, autonomous agents, and complex enterprise workflows.",
    displayName: 'Gemini 3.8 Flash',
    enabled: true,
    family: 'gemini',
    generation: 'gemini-3.8',
    id: 'gemini-3.8-flash',
    knowledgeCutoff: '2026-03',
    maxOutput: 65_536,
    releasedAt: '2026-09-02',
    settings: {
      disabledParams: ['temperature', 'top_p'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4 Pro is the flagship of the V4 family, built for high-intensity reasoning and agentic workflows with a 1M context window — excellent Chinese writing and outstanding value for money.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    releasedAt: '2026-08-13',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4 Flash is the fast, cost-efficient member of the V4 family with a 1M context window and hybrid thinking — one of the cheapest capable models available.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash',
    maxOutput: 393_216,
    releasedAt: '2026-07-31',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
      structuredOutput: true,
    },
    contextWindowTokens: 500_000,
    description:
      'Grok 4.7 is more reliable than Grok 4.6 on long-running coding and knowledge work, at the same price and speed, with a 500K context window.',
    displayName: 'Grok 4.7',
    enabled: true,
    id: 'grok-4.7',
    releasedAt: '2026-09-21',
    type: 'chat',
    family: 'grok',
    generation: 'grok-4.7',
    knowledgeCutoff: '2026-05',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      "Kimi K3 is Kimi's most capable model to date, with 2.8 trillion parameters. Built on Kimi Delta Attention and Attention Residuals, it offers native visual understanding and a 1M-token context window for frontier intelligence scenarios such as software engineering, knowledge work, and deep reasoning. Reasoning is always on, configured via the top-level reasoning_effort field.",
    displayName: 'Kimi K3',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k3',
    id: 'kimi-k3',
    maxOutput: 131_072,
    releasedAt: '2026-07-16',
    settings: {
      disabledParams: ['frequency_penalty', 'presence_penalty', 'temperature', 'top_p'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.8 Max supports complex coding, multimodal understanding, and long-horizon agentic workflows with a 1M context window.',
    displayName: 'Qwen3.8 Max',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.8',
    id: 'qwen3.8-max',
    maxOutput: 131_072,
    releasedAt: '2026-08-02',
    type: 'chat',
  },
];

export const allModels = [...modelflareChatModels];

export default allModels;
