import type { AIChatModelCard } from '../../types/aiModel';
import { openaiDecisionModels } from './decision';
import { openaiLegacyChatModels } from './legacyChat';
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
    knowledgeCutoff: '2025-12',
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
    isOfficial: true,
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
  ...openaiLegacyChatModels,
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
