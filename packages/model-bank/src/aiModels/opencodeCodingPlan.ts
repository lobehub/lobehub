import { type AIChatModelCard } from '../types/aiModel';

// ref: https://opencode.ai/go
// Models synced from https://models.dev/api.json → opencode-go
// `settings.extendParams` follows each model's `reasoning_options`:
//   - { type: 'effort', values: ['high','max'] } → deepseekV4ReasoningEffort / glm5_2ReasoningEffort
//   - { type: 'effort', values: ['low','medium','high'] } → grok4_5ReasoningEffort
//   - { type: 'effort', values: ['max'] } → no switch (native always-on)
//   - { type: 'toggle' } → enableReasoning
//   - { type: 'budget_tokens', max } → reasoningBudgetToken / reasoningBudgetToken80k / ...

const opencodeCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Multimodal Kimi model with 1M context and toggleable max-effort thinking for long-horizon agent work',
    displayName: 'Kimi K3',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k3',
    id: 'kimi-k3',
    maxOutput: 131_072,
    organization: 'Moonshot',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-16',
    // reasoning_options: [{ type: 'effort', values: ['max'] }] — always-on, no UI switch
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 500_000,
    description: "xAI's latest Grok for chat, coding, agentic tools, and lower hallucination risk",
    displayName: 'Grok 4.5',
    enabled: false,
    family: 'grok',
    generation: 'grok-4.5',
    id: 'grok-4.5',
    maxOutput: 500_000,
    organization: 'xAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-08',
    settings: {
      // reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }]
      extendParams: ['grok4_5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_000_000,
    description: 'Open flagship GLM for long-horizon coding agents and million-token context work',
    displayName: 'GLM-5.2',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.2',
    id: 'glm-5.2',
    maxOutput: 131_072,
    organization: 'Zhipu',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-13',
    settings: {
      // reasoning_options: [{ type: 'effort', values: ['high', 'max'] }]
      extendParams: ['glm5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_000_000,
    description: 'Flagship DeepSeek model for coding, reasoning, and agentic work',
    displayName: 'DeepSeek V4 Pro',
    enabled: false,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro',
    maxOutput: 384_000,
    organization: 'DeepSeek',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.74, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.48, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0145, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      // reasoning_options: [{ type: 'effort', values: ['high', 'max'] }]
      // deepseekV4ReasoningEffort also exposes 'none' for non-thinking mode
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_000_000,
    description: 'Fast DeepSeek model for efficient chat, coding help, and agent loops',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash',
    maxOutput: 384_000,
    organization: 'DeepSeek',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0028, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      // reasoning_options: [{ type: 'effort', values: ['high', 'max'] }]
      extendParams: ['deepseekV4ReasoningEffort'],
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
    contextWindowTokens: 262_144,
    description:
      'Coding-focused Kimi model, stronger on long-horizon repo work with less overthinking',
    displayName: 'Kimi K2.7 Code',
    enabled: false,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'kimi-k2.7-code',
    maxOutput: 262_144,
    organization: 'Moonshot',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.19, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-12',
    // reasoning_options: [] — native thinking, no switch
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 202_752,
    description: 'Flagship GLM model for hybrid reasoning, coding, and agentic engineering',
    displayName: 'GLM-5.1',
    enabled: false,
    family: 'glm',
    generation: 'glm-5.1',
    id: 'glm-5.1',
    maxOutput: 32_768,
    organization: 'Zhipu',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-07',
    // reasoning_options: [] — no effort / toggle control exposed by opencode-go
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 262_144,
    description: 'Kimi multimodal agent model for visual understanding, coding, and planning',
    displayName: 'Kimi K2.6',
    enabled: false,
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'kimi-k2.6',
    maxOutput: 65_536,
    organization: 'Moonshot',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-21',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Multimodal reasoning model for visual analysis, planning, and tool use',
    displayName: 'Qwen3.7 Plus',
    enabled: false,
    family: 'qwen',
    generation: 'qwen3.7',
    id: 'qwen3.7-plus',
    maxOutput: 65_536,
    organization: 'Alibaba',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-02',
    settings: {
      // reasoning_options: [{ type: 'toggle' }, { type: 'budget_tokens', max: 262144 }]
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_000_000,
    description: 'Flagship model for demanding analysis, coding, and production agent workflows',
    displayName: 'Qwen3.7 Max',
    enabled: false,
    family: 'qwen',
    generation: 'qwen3.7',
    id: 'qwen3.7-max',
    maxOutput: 65_536,
    organization: 'Alibaba',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-21',
    settings: {
      // reasoning_options: [{ type: 'toggle' }, { type: 'budget_tokens', max: 262144 }]
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Multimodal reasoning model for visual analysis, planning, and tool use',
    displayName: 'Qwen3.6 Plus',
    enabled: false,
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen3.6-plus',
    maxOutput: 65_536,
    organization: 'Alibaba',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.625, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-02',
    settings: {
      // reasoning_options: [{ type: 'toggle' }, { type: 'budget_tokens', max: 81920 }]
      extendParams: ['enableReasoning', 'reasoningBudgetToken80k'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'MiMo omni model for text, image, video, audio, and agents',
    displayName: 'MiMo-V2.5',
    enabled: false,
    family: 'mimo',
    id: 'mimo-v2.5',
    knowledgeCutoff: '2024-12',
    maxOutput: 128_000,
    organization: 'Xiaomi',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0028, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-22',
    // reasoning_options: [] — no effort control exposed by opencode-go
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_048_576,
    description: 'MiMo pro model for strong multimodal reasoning and agent execution',
    displayName: 'MiMo-V2.5 Pro',
    enabled: false,
    family: 'mimo',
    id: 'mimo-v2.5-pro',
    knowledgeCutoff: '2024-12',
    maxOutput: 128_000,
    organization: 'Xiaomi',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.74, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.48, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0145, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-22',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'MiniMax multimodal coding model for long-context reasoning and agent tasks',
    displayName: 'MiniMax M3',
    enabled: false,
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'minimax-m3',
    maxOutput: 131_072,
    organization: 'MiniMax',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-31',
    settings: {
      // reasoning_options: [{ type: 'toggle' }]
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'MiniMax model for chat, coding, office work, and agentic tasks',
    displayName: 'MiniMax M2.7',
    enabled: false,
    family: 'minimax',
    generation: 'minimax-m2.7',
    id: 'minimax-m2.7',
    maxOutput: 131_072,
    organization: 'MiniMax',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
    // reasoning_options: []
    type: 'chat',
  },
];

export default opencodeCodingPlanChatModels;
