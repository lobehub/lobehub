import type { AIChatModelCard } from '../../../types/aiModel';

export const xiaomimimoChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Xiaomi MiMo-V2-Pro features over 1 trillion parameters (42B activated), an innovative hybrid attention architecture, and supports ultra-long context up to 1M tokens. Designed for high-intensity agent workflows with strong generalization from coding to real-world task execution.',
    displayName: 'MiMo-V2 Pro',
    enabled: true,
    id: 'mimo-v2-pro',
    maxOutput: 131_072,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1, upTo: 256_000 },
            { rate: 2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 256_000 },
            { rate: 0.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        // Cache write is temporarily free per official announcement
        // TODO: restore actual pricing when promotion ends
        { name: 'textInput_cacheWrite', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 3, upTo: 256_000 },
            { rate: 6, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-18',
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
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'MiMo-V2-Omni is a full-modality model integrating text, vision, and speech, unifying perception and action in a single architecture. It enables native multimodal perception, tool usage, and GUI operations for complex real-world interaction scenarios.',
    displayName: 'MiMo-V2 Omni',
    enabled: true,
    id: 'mimo-v2-omni',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
        // Cache write is temporarily free per official announcement
        // TODO: restore actual pricing when promotion ends
        { name: 'textInput_cacheWrite', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
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
    },
    contextWindowTokens: 262_144,
    description:
      'MiMo-V2-Flash is a 309B MoE model (15B activated) optimized for extreme inference efficiency. It ranks among the top open-source models in agent benchmarks while delivering 2x generation speed at minimal cost.',
    displayName: 'MiMo-V2 Flash',
    enabled: true,
    id: 'mimo-v2-flash',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
        // Cache write is temporarily free per official announcement
        // TODO: restore actual pricing when promotion ends
        { name: 'textInput_cacheWrite', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
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
