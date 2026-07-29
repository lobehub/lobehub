import type { AIChatModelCard } from '../types/aiModel';

const xiaomimimoChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      "MiMo-V2.5-Pro is Xiaomi's most capable flagship model to date, delivering significant improvements in general agentic capabilities, complex software engineering, and long-horizon tasks. It retains the 1T total / 42B active hybrid-attention architecture with a 1M context window, and can sustain complex long-horizon tasks spanning more than a thousand tool calls. Performance on demanding agentic benchmarks (ClawEval, GDPVal, SWE-bench Pro) is comparable to Claude Opus 4.6.",
    displayName: 'MiMo-V2.5 Pro',
    enabled: true,
    family: 'mimo',
    id: 'mimo-v2.5-pro',
    knowledgeCutoff: '2024-12',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-22',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'MiMo-V2.5 is a native omni-modal Agent foundation model that understands images, video, audio, and text in a unified architecture, with a 1M context window. It delivers Pro-level agentic performance at roughly half the inference cost of MiMo-V2.5-Pro, with improved multimodal perception over MiMo-V2-Omni. Its built-in agentic capabilities (browsing, understanding, reasoning, execution) and faster inference make it well-suited to latency-sensitive and multi-step agent frameworks such as OpenClaw.',
    displayName: 'MiMo-V2.5',
    enabled: true,
    family: 'mimo',
    id: 'mimo-v2.5',
    knowledgeCutoff: '2024-12',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-22',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262_144,
    description:
      'MiMo-V2-Flash is now officially open source! This is a MoE (Mixture-of-Experts) model purpose-built for extreme inference efficiency, with 309B total parameters (15B activated). Through innovations in a hybrid attention architecture and multi-layer MTP inference acceleration, it ranks among the global Top 2 open-source models across multiple agent benchmarking suites. Its coding capabilities surpass all open-source models and rival leading closed-source models such as Claude 4.5 Sonnet, while incurring only 2.5% of the inference cost and delivering 2× faster generation speed—pushing large-model inference efficiency to the limit.',
    displayName: 'MiMo-V2 Flash',
    family: 'mimo',
    id: 'mimo-v2-flash',
    knowledgeCutoff: '2024-12',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-03',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

export const allModels = [...xiaomimimoChatModels];

export default allModels;
