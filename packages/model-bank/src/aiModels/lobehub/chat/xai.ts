import type { AIChatModelCard } from '../../../types/aiModel';

export const xaiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description: 'Intelligent, blazing-fast model that reasons before responding',
    displayName: 'Grok 4.20 Beta',
    enabled: true,
    id: 'grok-4.20-beta-0309-reasoning',
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 0.2 },
            { rate: 0.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 0.2 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 6, upTo: 0.2 },
            { rate: 12, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-09',
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
    contextWindowTokens: 2_000_000,
    description: 'A non-reasoning variant for simple use cases',
    displayName: 'Grok 4.20 Beta (Non-Reasoning)',
    enabled: true,
    id: 'grok-4.20-beta-0309-non-reasoning',
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 0.2 },
            { rate: 0.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 0.2 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 6, upTo: 0.2 },
            { rate: 12, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-09',
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
      vision: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Our newest and strongest flagship model, excelling in NLP, math, and reasoning—an ideal all-rounder.',
    displayName: 'Grok 4',
    enabled: true,
    id: 'grok-4',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-09',
    settings: {
      // reasoning_effort is not supported by grok-4. Specifying reasoning_effort parameter will get an error response.
      // extendParams: ['reasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
];
