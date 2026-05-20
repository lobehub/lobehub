import type { AIChatModelCard } from '../../../types/aiModel';

// Authoritative pricing + capability + RPM/TPM reference:
//   https://platform.xiaomimimo.com/docs/pricing  (SPA — fetch via chrome-devtools MCP, not WebFetch)
// Model detail pages:
//   https://mimo.xiaomi.com/mimo-v2-5-pro   (URL uses dashes for dots)
//   https://mimo.xiaomi.com/mimo-v2-5
// IMPORTANT: Xiaomi's Token Plan (Credits subscription) billing and the
// per-token API billing are separate. Announcements like "unified 256K/1M
// Credit multiplier" only affect Token Plan; the per-token API billing still
// keeps context-tiered pricing (0-256K / 256K-1M). Always cross-check
// /docs/pricing when updating these rates.
export const xiaomimimoChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: false,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Xiaomi MiMo-V2.5-Pro is the flagship of the MiMo-V2.5 series. It retains the 1T total / 42B active hybrid-attention architecture with a 1M context window, and delivers major gains in general agentic capabilities, complex software engineering, and long-horizon tasks (more than a thousand tool calls per task). Performance on demanding agentic benchmarks is comparable to Claude Opus 4.6.',
    displayName: 'MiMo-V2.5 Pro',
    enabled: true,
    id: 'mimo-v2.5-pro',
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
    releasedAt: '2026-04-22',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: false,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Xiaomi MiMo-V2.5 is a native omni-modal Agent foundation model with 1M context that understands images, video, audio, and text in a unified architecture. It delivers Pro-level agentic performance at roughly half the inference cost, with stronger multimodal perception than MiMo-V2-Omni and faster inference — a strong fit for latency-sensitive, multi-step agent frameworks.',
    displayName: 'MiMo-V2.5',
    enabled: true,
    id: 'mimo-v2.5',
    maxOutput: 131_072,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.4, upTo: 256_000 },
            { rate: 0.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.08, upTo: 256_000 },
            { rate: 0.16, upTo: 'infinity' },
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
            { rate: 2, upTo: 256_000 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-22',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: false,
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
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: false,
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
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: false,
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
    },
    type: 'chat',
  },
];
