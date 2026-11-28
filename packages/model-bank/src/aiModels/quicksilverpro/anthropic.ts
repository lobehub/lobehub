import type { AIChatModelCard } from '../../types/aiModel';

// https://quicksilverpro.io/pricing.json — catalog v83 (2026-11-17), USD per 1M tokens.
export const anthropicChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1000000,
    displayName: 'Claude Opus 5.5',
    enabled: true,
    family: 'anthropic',
    id: 'claude-opus-5-5',
    maxOutput: 128000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1000000,
    displayName: 'Claude Opus 5',
    family: 'anthropic',
    id: 'claude-opus-5',
    maxOutput: 128000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 1.5625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1000000,
    displayName: 'Claude Fable 5.2',
    family: 'anthropic',
    id: 'claude-fable-5-2',
    maxOutput: 128000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1000000,
    displayName: 'Claude Fable 5.1',
    family: 'anthropic',
    id: 'claude-fable-5-1',
    maxOutput: 128000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1000000,
    displayName: 'Claude Fable 5',
    family: 'anthropic',
    id: 'claude-fable-5',
    maxOutput: 128000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1000000,
    displayName: 'Claude Opus 4.8',
    family: 'anthropic',
    id: 'claude-opus-4-8',
    maxOutput: 128000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 1.5625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1000000,
    displayName: 'Claude Sonnet 5.5',
    enabled: true,
    family: 'anthropic',
    id: 'claude-sonnet-5-5',
    maxOutput: 128000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.625, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1000000,
    displayName: 'Claude Sonnet 5',
    family: 'anthropic',
    id: 'claude-sonnet-5',
    maxOutput: 128000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1000000,
    displayName: 'Claude Haiku 5.5',
    family: 'anthropic',
    id: 'claude-haiku-5-5',
    maxOutput: 128000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 0.025,
              upTo: 200000,
            },
            {
              rate: 0.125,
              upTo: 'infinity',
            },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            {
              rate: 0.0025,
              upTo: 200000,
            },
            {
              rate: 0.0125,
              upTo: 'infinity',
            },
          ],
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheWrite', rate: 0.03125, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 0.125,
              upTo: 200000,
            },
            {
              rate: 0.625,
              upTo: 'infinity',
            },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200000,
    displayName: 'Claude Haiku 4.5',
    family: 'anthropic',
    id: 'claude-haiku-4-5',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.3125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];
