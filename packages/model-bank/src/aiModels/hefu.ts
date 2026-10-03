import type { AIChatModelCard } from '../types/aiModel';

// HeFu model list based on src/config/modelProviders/hefu.ts
// HeFu reuses upstream standard model ids, so the model fetcher
// (processMultiProviderModelList) fills in metadata for the full catalog.
const hefuChatModels: AIChatModelCard[] = [
  // OpenAI GPT series
  {
    abilities: { functionCall: true, reasoning: true, search: true, vision: true },
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
    type: 'chat',
  },

  // Anthropic Claude series
  {
    abilities: { functionCall: true, reasoning: true, search: true, vision: true },
    contextWindowTokens: 1_000_000,
    description:
      "Claude Opus 4.8 is Anthropic's flagship Opus model, building on Opus 4.7 with improvements across reasoning, agentic coding, and tool use.",
    displayName: 'Claude Opus 4.8',
    family: 'claude-opus',
    generation: 'claude-4.8',
    id: 'claude-opus-4-8',
    knowledgeCutoff: '2026-01',
    maxOutput: 128_000,
    releasedAt: '2026-05-28',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, search: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Claude Sonnet 4.6 is Anthropic’s best combination of speed and intelligence.',
    displayName: 'Claude Sonnet 4.6',
    enabled: true,
    family: 'claude-sonnet',
    generation: 'claude-4.6',
    id: 'claude-sonnet-4-6',
    knowledgeCutoff: '2025-08',
    maxOutput: 64_000,
    releasedAt: '2026-02-17',
    type: 'chat',
  },

  // DeepSeek series
  {
    abilities: { functionCall: true, reasoning: true, search: true },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek-V4-Pro is DeepSeek’s flagship MoE model, supporting both non-thinking and thinking modes for advanced reasoning, code generation, and complex agent workflows.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    releasedAt: '2026-04-24',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, search: true },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek-V4-Flash is DeepSeek’s efficient 1M-context model, balancing speed and cost while keeping strong reasoning and agent capabilities.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash',
    maxOutput: 393_216,
    releasedAt: '2026-04-24',
    type: 'chat',
  },

  // Moonshot Kimi series
  {
    abilities: { functionCall: true, reasoning: true, video: true, vision: true },
    contextWindowTokens: 1_048_576,
    description:
      "Kimi K3 is Kimi's most capable model to date, offering native visual understanding and a 1M-token context window for frontier intelligence scenarios such as software engineering, knowledge work, and deep reasoning.",
    displayName: 'Kimi K3',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k3',
    id: 'kimi-k3',
    maxOutput: 131_072,
    releasedAt: '2026-07-16',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, video: true, vision: true },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.6 is Kimi's latest and most capable model, delivering stronger long-horizon coding, instruction following, and self-correction while supporting text, image, and video inputs plus chat and agent tasks.",
    displayName: 'Kimi K2.6',
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'kimi-k2.6',
    maxOutput: 32_768,
    releasedAt: '2026-04-20',
    type: 'chat',
  },

  // Alibaba Qwen series
  {
    abilities: { functionCall: true, reasoning: true, search: true },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.7 Max is the flagship omnipotent model of the AI agent era, offering comprehensive capabilities across text, image, and video understanding. It provides superior reasoning, function calling, and agent task execution performance.',
    displayName: 'Qwen3.7 Max',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.7',
    id: 'qwen3.7-max',
    maxOutput: 65_536,
    releasedAt: '2026-05-20',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, search: true, video: true, vision: true },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.6 Plus supports text, image, and video input. It delivers a balanced performance across quality, speed, and cost. Its multimodal capabilities are significantly improved compared to the Qwen3 VL series.',
    displayName: 'Qwen3.6 Plus',
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen3.6-plus',
    maxOutput: 65_536,
    releasedAt: '2026-04-02',
    type: 'chat',
  },

  // Zhipu GLM series
  {
    abilities: { functionCall: true, reasoning: true, search: true },
    contextWindowTokens: 1_048_576,
    description:
      'GLM-5.3 is Zhipu’s latest flagship model. Built on the same base as GLM-5.2, it scales post-training with tens of times more long-horizon task environments and substantially longer training cycles.',
    displayName: 'GLM-5.3',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.3',
    id: 'glm-5.3',
    maxOutput: 131_072,
    releasedAt: '2026-08-14',
    type: 'chat',
  },

  // MiniMax series
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 512_000,
    description: 'MiniMax M3: Coding & Agentic Frontier. 1M context window. Native Multimodality.',
    displayName: 'MiniMax M3',
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'minimax-m3',
    type: 'chat',
  },

  // xAI Grok series
  {
    abilities: { functionCall: true, search: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'The most truth-seeking large language model in the world',
    displayName: 'Grok 4.3',
    enabled: true,
    family: 'grok',
    generation: 'grok-4.3',
    id: 'grok-4.3',
    knowledgeCutoff: '2025-12',
    releasedAt: '2026-05-01',
    type: 'chat',
  },
];

export const allModels = [...hefuChatModels];

export default allModels;
