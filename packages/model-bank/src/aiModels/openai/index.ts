import type { AIChatModelCard } from '../../types/aiModel';
import { openaiDecisionModels } from './decision';
import {
  openaiASRModels,
  openaiEmbeddingModels,
  openaiImageModels,
  openaiRealtimeModels,
  openaiTTSModels,
  openaiVideoModels,
} from './nonChat';

// Keep every card array importable from `model-bank/openai` as before the split.
export * from './decision';
export * from './nonChat';

export const openaiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-6.1 Sol delivers near-Astra performance for complex coding, computer use, and professional work at a lower cost.',
    displayName: 'GPT-6.1 Sol',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6.1',
    id: 'gpt-6.1-sol',
    knowledgeCutoff: '2026-04',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 272_000 },
            { rate: 4, upTo: 'infinity' },
          ],
        },
        {
          name: 'textInput_cacheRead',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 0.1, upTo: 272_000 },
            { rate: 0.2, upTo: 'infinity' },
          ],
        },
        {
          name: 'textInput_cacheWrite',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 2.5, upTo: 272_000 },
            { rate: 5, upTo: 'infinity' },
          ],
        },
        {
          name: 'textOutput',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 10, upTo: 272_000 },
            { rate: 15, upTo: 'infinity' },
          ],
        },
      ],
    },
    releasedAt: '2026-09-29',
    settings: {
      extendParams: ['gpt6ReasoningEffort', 'textVerbosity'],
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
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'OpenAI’s most capable model for complex reasoning, coding, computer use, research, and document creation.',
    displayName: 'GPT-6 Astra',
    enabled: true,
    id: 'gpt-6-astra',
    maxOutput: 128_000,
    /** @see https://developers.openai.com/api/docs/models/gpt-6-astra */
    pricing: {
      units: [
        {
          name: 'textInput',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 10, upTo: 272_000 },
            { rate: 20, upTo: 'infinity' },
          ],
        },
        {
          name: 'textInput_cacheRead',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 1, upTo: 272_000 },
            { rate: 2, upTo: 'infinity' },
          ],
        },
        {
          name: 'textInput_cacheWrite',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 12.5, upTo: 272_000 },
            { rate: 25, upTo: 'infinity' },
          ],
        },
        {
          name: 'textOutput',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 50, upTo: 272_000 },
            { rate: 75, upTo: 'infinity' },
          ],
        },
      ],
    },
    releasedAt: '2026-09-03',
    settings: {
      extendParams: ['gpt6ReasoningEffort', 'textVerbosity'],
      searchImpl: 'params',
    },
    type: 'chat',
    family: 'gpt',
    generation: 'gpt-6',
    knowledgeCutoff: '2026-04',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description: 'GPT-6 Sol is built for complex coding and agentic workflows.',
    displayName: 'GPT-6 Sol',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6',
    id: 'gpt-6-sol',
    knowledgeCutoff: '2026-04',
    maxOutput: 128_000,
    /** @see https://developers.openai.com/api/docs/models/gpt-6-sol */
    pricing: {
      units: [
        {
          name: 'textInput',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 272_000 },
            { rate: 4, upTo: 'infinity' },
          ],
        },
        {
          name: 'textInput_cacheRead',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 272_000 },
            { rate: 0.4, upTo: 'infinity' },
          ],
        },
        {
          name: 'textInput_cacheWrite',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 2.5, upTo: 272_000 },
            { rate: 5, upTo: 'infinity' },
          ],
        },
        {
          name: 'textOutput',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 10, upTo: 272_000 },
            { rate: 15, upTo: 'infinity' },
          ],
        },
      ],
    },
    releasedAt: '2026-09-22',
    settings: {
      extendParams: ['gpt5_6ReasoningEffort', 'textVerbosity'],
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
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description: 'GPT-6 Luna is OpenAI’s most efficient model for focused, high-volume tasks.',
    displayName: 'GPT-6 Luna',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6',
    id: 'gpt-6-luna',
    knowledgeCutoff: '2026-05',
    maxOutput: 128_000,
    /** @see https://developers.openai.com/api/docs/models/gpt-6-luna */
    pricing: {
      units: [
        {
          name: 'textInput',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 0.1, upTo: 272_000 },
            { rate: 0.2, upTo: 'infinity' },
          ],
        },
        {
          name: 'textInput_cacheRead',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 0.01, upTo: 272_000 },
            { rate: 0.02, upTo: 'infinity' },
          ],
        },
        {
          name: 'textInput_cacheWrite',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 0.125, upTo: 272_000 },
            { rate: 0.25, upTo: 'infinity' },
          ],
        },
        {
          name: 'textOutput',
          unit: 'millionTokens',
          strategy: 'tiered',
          tiers: [
            { rate: 0.5, upTo: 272_000 },
            { rate: 0.75, upTo: 'infinity' },
          ],
        },
      ],
    },
    releasedAt: '2026-09-22',
    settings: {
      extendParams: ['gpt5_6ReasoningEffort', 'textVerbosity'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description: 'Latest Instant model used in ChatGPT.',
    displayName: 'Chat Latest',
    id: 'chat-latest',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-05',
    settings: {
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
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      "GPT-5.6 Sol is OpenAI's latest flagship and most capable model, the top choice in the GPT family for coding and agentic work.",
    displayName: 'GPT-5.6 Sol',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-sol',
    knowledgeCutoff: '2026-02',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 4, upTo: 272_000 },
            { rate: 8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.4, upTo: 272_000 },
            { rate: 0.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheWrite',
          strategy: 'tiered',
          tiers: [
            { rate: 5, upTo: 272_000 },
            { rate: 10, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 20, upTo: 272_000 },
            { rate: 30, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-07-09',
    settings: {
      extendParams: ['reasoningMode', 'gpt5_6ReasoningEffort', 'textVerbosity'],
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
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.6 Terra balances intelligence and cost for everyday professional work, competitive with GPT-5.5 at about half the price.',
    displayName: 'GPT-5.6 Terra',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-terra',
    knowledgeCutoff: '2026-02',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 272_000 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 272_000 },
            { rate: 0.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheWrite',
          strategy: 'tiered',
          tiers: [
            { rate: 2.5, upTo: 272_000 },
            { rate: 5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 12, upTo: 272_000 },
            { rate: 18, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-07-09',
    settings: {
      extendParams: ['reasoningMode', 'gpt5_6ReasoningEffort', 'textVerbosity'],
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
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.6 Luna is optimized for cost-sensitive, high-volume workloads with the lowest price in the GPT-5.6 family.',
    displayName: 'GPT-5.6 Luna',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-luna',
    knowledgeCutoff: '2026-02',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 272_000 },
            { rate: 0.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.02, upTo: 272_000 },
            { rate: 0.04, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheWrite',
          strategy: 'tiered',
          tiers: [
            { rate: 0.25, upTo: 272_000 },
            { rate: 0.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.2, upTo: 272_000 },
            { rate: 1.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-07-09',
    settings: {
      extendParams: ['reasoningMode', 'gpt5_6ReasoningEffort', 'textVerbosity'],
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
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      "GPT-5.5 is OpenAI's previous-generation frontier model for complex professional work.",
    displayName: 'GPT-5.5',
    family: 'gpt',
    generation: 'gpt-5.5',
    id: 'gpt-5.5',
    knowledgeCutoff: '2025-12',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 5, upTo: 272_000 },
            { rate: 10, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.5, upTo: 272_000 },
            { rate: 1, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 30, upTo: 272_000 },
            { rate: 45, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-23',
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
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.5 pro uses more compute to think harder and provide consistently better answers.',
    displayName: 'GPT-5.5 Pro',
    family: 'gpt',
    generation: 'gpt-5.5',
    id: 'gpt-5.5-pro',
    knowledgeCutoff: '2025-12',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          rate: 30,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          rate: 180,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-23',
    settings: {
      extendParams: ['gpt5_2ProReasoningEffort', 'textVerbosity'],
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
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.4 is the frontier model for complex professional work with highest reasoning capability.',
    displayName: 'GPT-5.4',
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2.5, upTo: 272_000 },
            { rate: 5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.25, upTo: 272_000 },
            { rate: 0.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 15, upTo: 272_000 },
            { rate: 22.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-05',
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
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.4 Pro uses more compute to think harder and provide consistently better answers, available in the Responses API only.',
    displayName: 'GPT-5.4 Pro',
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4-pro',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 30, upTo: 272_000 },
            { rate: 60, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 180, upTo: 272_000 },
            { rate: 270, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-05',
    settings: {
      extendParams: ['gpt5_2ProReasoningEffort', 'textVerbosity'],
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
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      "GPT-5.4 mini is OpenAI's strongest mini model for coding, computer use, and subagents.",
    displayName: 'GPT-5.4 mini',
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4-mini',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
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
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      "GPT-5.4 nano is OpenAI's cheapest GPT-5.4-class model for simple high-volume tasks.",
    displayName: 'GPT-5.4 nano',
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4-nano',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
    settings: {
      extendParams: ['gpt5_2ReasoningEffort', 'textVerbosity'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
      structuredOutput: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-5.3 Chat is the latest ChatGPT model used in ChatGPT with improved conversation experiences.',
    displayName: 'GPT-5.3 Chat',
    family: 'gpt',
    generation: 'gpt-5.3',
    id: 'gpt-5.3-chat-latest',
    knowledgeCutoff: '2025-08',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-04',
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
      'GPT-5.3-Codex is the most capable agentic coding model to date, optimized for agentic coding tasks in Codex or similar environments.',
    displayName: 'GPT-5.3 Codex',
    family: 'gpt',
    generation: 'gpt-5.3',
    id: 'gpt-5.3-codex',
    knowledgeCutoff: '2025-08',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-05',
    settings: {
      extendParams: ['codexMaxReasoningEffort'],
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
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.2 is a flagship model for coding and agentic workflows with stronger reasoning and long-context performance.',
    displayName: 'GPT-5.2',
    family: 'gpt',
    generation: 'gpt-5.2',
    id: 'gpt-5.2',
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
      'GPT-5.2 pro: a smarter, more precise GPT-5.2 variant (Responses API only), suited for hard problems and longer multi-turn reasoning.',
    displayName: 'GPT-5.2 pro',
    family: 'gpt',
    generation: 'gpt-5.2',
    id: 'gpt-5.2-pro',
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
      extendParams: ['gpt5_2ProReasoningEffort'],
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
      'GPT-5.2 Chat is the ChatGPT variant (chat-latest) for the latest conversation improvements.',
    displayName: 'GPT-5.2 Chat',
    family: 'gpt',
    generation: 'gpt-5.2',
    id: 'gpt-5.2-chat-latest',
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
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.1 — a flagship model optimized for coding and agent tasks with configurable reasoning effort and longer context.',
    displayName: 'GPT-5.1',
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'gpt-5.1',
    knowledgeCutoff: '2024-09',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-13',
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
      'GPT-5 pro uses more compute to think deeper and consistently deliver better answers.',
    displayName: 'GPT-5 pro',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-pro',
    knowledgeCutoff: '2024-09',
    maxOutput: 272_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-06',
    settings: {
      extendParams: ['textVerbosity'],
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
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'The best model for cross-domain coding and agent tasks. GPT-5 leaps in accuracy, speed, reasoning, context awareness, structured thinking, and problem solving.',
    displayName: 'GPT-5',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5',
    knowledgeCutoff: '2024-09',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-07',
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
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
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'A faster, more cost-efficient GPT-5 variant for well-defined tasks, delivering quicker responses while maintaining quality.',
    displayName: 'GPT-5 mini',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-mini',
    knowledgeCutoff: '2024-05',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-07',
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
      searchImpl: 'params',
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
      'The fastest and most cost-effective GPT-5 variant, ideal for latency- and cost-sensitive applications.',
    displayName: 'GPT-5 nano',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-nano',
    knowledgeCutoff: '2024-05',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.005, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-07',
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
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
      'o4-mini is the latest small o-series model, optimized for fast, effective reasoning with high efficiency in coding and vision tasks.',
    displayName: 'o4-mini',
    family: 'o-series',
    generation: 'o4',
    id: 'o4-mini',
    knowledgeCutoff: '2024-06',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.275, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-17',
    settings: {
      extendParams: ['reasoningEffort'],
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
      'o3-pro uses more compute to think deeper and consistently deliver better answers; available only via the Responses API.',
    displayName: 'o3-pro',
    family: 'o-series',
    generation: 'o3',
    id: 'o3-pro',
    knowledgeCutoff: '2024-06',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 80, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-10',
    settings: {
      extendParams: ['reasoningEffort'],
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
      'o3 is a powerful all-round model that sets a new bar for math, science, programming, and visual reasoning. It excels at technical writing and instruction following and can analyze text, code, and images for multi-step problems.',
    displayName: 'o3',
    family: 'o-series',
    generation: 'o3',
    id: 'o3',
    knowledgeCutoff: '2024-06',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-16',
    settings: {
      extendParams: ['reasoningEffort'],
      searchImpl: 'params',
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
      'o3-mini is our latest small reasoning model, delivering higher intelligence at the same cost and latency targets as o1-mini.',
    displayName: 'o3-mini',
    family: 'o-series',
    generation: 'o3',
    id: 'o3-mini',
    knowledgeCutoff: '2023-10',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-31',
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
      'The o1 series is trained with reinforcement learning to think before answering and handle complex reasoning. o1-pro uses more compute for deeper thinking and consistently higher-quality answers.',
    displayName: 'o1-pro',
    family: 'o-series',
    generation: 'o1',
    id: 'o1-pro',
    knowledgeCutoff: '2023-10',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 150, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 600, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-19',
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
      'o1 is OpenAI’s new reasoning model with text+image input and text output, suited for complex tasks requiring broad knowledge. It has a 200K context window and an October 2023 knowledge cutoff.',
    displayName: 'o1',
    family: 'o-series',
    generation: 'o1',
    id: 'o1',
    knowledgeCutoff: '2023-10',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-17',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 is our flagship model for complex tasks and cross-domain problem solving.',
    displayName: 'GPT-4.1',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1',
    knowledgeCutoff: '2024-06',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 mini balances intelligence, speed, and cost, making it attractive for many use cases.',
    displayName: 'GPT-4.1 mini',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1-mini',
    knowledgeCutoff: '2024-06',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
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
    contextWindowTokens: 1_047_576,
    description: 'GPT-4.1 nano is the fastest and most cost-effective GPT-4.1 model.',
    displayName: 'GPT-4.1 nano',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1-nano',
    knowledgeCutoff: '2024-06',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-4o mini is OpenAI’s latest model after GPT-4 Omni, supporting text+image input with text output. It is their most advanced small model, far cheaper than recent frontier models and over 60% cheaper than GPT-3.5 Turbo, while maintaining top-tier intelligence (82% MMLU).',
    displayName: 'GPT-4o mini',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o-mini',
    knowledgeCutoff: '2023-10',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-07-18',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o is a dynamic model updated in real time, combining strong understanding and generation for large-scale use cases like customer support, education, and technical support.',
    displayName: 'GPT-4o',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o',
    knowledgeCutoff: '2023-10',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-05-13',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o is a dynamic model updated in real time, combining strong understanding and generation for large-scale use cases like customer support, education, and technical support.',
    displayName: 'GPT-4o 1120',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o-2024-11-20',
    knowledgeCutoff: '2023-10',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-11-20',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o is a dynamic model updated in real time, combining strong understanding and generation for large-scale use cases like customer support, education, and technical support.',
    displayName: 'GPT-4o 0513',
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o-2024-05-13',
    knowledgeCutoff: '2023-10',
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-05-13',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      audio: true,
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT Audio is a general chat model for audio input/output, supported in the Chat Completions API.',
    displayName: 'GPT Audio',
    family: 'gpt',
    generation: 'gpt-audio',
    id: 'gpt-audio',
    knowledgeCutoff: '2023-10',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },

        { name: 'audioInput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 80, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-28',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'The latest GPT-4 Turbo adds vision. Visual requests support JSON mode and function calling. It is a cost-effective multimodal model that balances accuracy and efficiency for real-time applications.',
    displayName: 'GPT-4 Turbo',
    family: 'gpt',
    generation: 'gpt-4',
    id: 'gpt-4-turbo',
    knowledgeCutoff: '2023-12',
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
    contextWindowTokens: 128_000,
    description:
      'The latest GPT-4 Turbo adds vision. Visual requests support JSON mode and function calling. It is a cost-effective multimodal model that balances accuracy and efficiency for real-time applications.',
    displayName: 'GPT-4 Turbo Vision 0409',
    family: 'gpt',
    generation: 'gpt-4',
    id: 'gpt-4-turbo-2024-04-09',
    knowledgeCutoff: '2023-12',
    pricing: {
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-04-09',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description:
      'GPT-4 provides a larger context window to handle longer inputs, suitable for broad information synthesis and data analysis.',
    displayName: 'GPT-4',
    family: 'gpt',
    generation: 'gpt-4',
    id: 'gpt-4',
    knowledgeCutoff: '2021-09',
    pricing: {
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
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
      'GPT-4 provides a larger context window to handle longer inputs, suitable for broad information synthesis and data analysis.',
    displayName: 'GPT-4 0613',
    family: 'gpt',
    generation: 'gpt-4',
    id: 'gpt-4-0613',
    knowledgeCutoff: '2021-09',
    pricing: {
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2023-06-13',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_384,
    description:
      'GPT 3.5 Turbo for text generation and understanding; currently points to gpt-3.5-turbo-0125.',
    displayName: 'GPT-3.5 Turbo',
    family: 'gpt',
    generation: 'gpt-3.5',
    id: 'gpt-3.5-turbo',
    knowledgeCutoff: '2021-09',
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
    contextWindowTokens: 16_384,
    description:
      'GPT 3.5 Turbo for text generation and understanding; currently points to gpt-3.5-turbo-0125.',
    displayName: 'GPT-3.5 Turbo 0125',
    family: 'gpt',
    generation: 'gpt-3.5',
    id: 'gpt-3.5-turbo-0125',
    knowledgeCutoff: '2021-09',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-01-25',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_384,
    description:
      'GPT 3.5 Turbo for text generation and understanding; currently points to gpt-3.5-turbo-0125.',
    displayName: 'GPT-3.5 Turbo 1106',
    family: 'gpt',
    generation: 'gpt-3.5',
    id: 'gpt-3.5-turbo-1106',
    knowledgeCutoff: '2021-09',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2023-11-06',
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description:
      'GPT 3.5 Turbo for text generation and understanding tasks, optimized for instruction following.',
    displayName: 'GPT-3.5 Turbo Instruct',
    family: 'gpt',
    generation: 'gpt-3.5',
    id: 'gpt-3.5-turbo-instruct',
    knowledgeCutoff: '2021-09',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [
  ...openaiChatModels,
  ...openaiEmbeddingModels,
  ...openaiTTSModels,
  ...openaiASRModels,
  ...openaiImageModels,
  ...openaiRealtimeModels,
  ...openaiVideoModels,
  ...openaiDecisionModels,
];

export default allModels;
