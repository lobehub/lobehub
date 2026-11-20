import type { AIChatModelCard } from '../../types/aiModel';

// https://quicksilverpro.io/pricing.json — catalog v83 (2026-11-17), USD per 1M tokens.
export const openaiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131072,
    displayName: 'GPT-OSS 120B',
    family: 'openai',
    id: 'gpt-oss-120b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
    contextWindowTokens: 1050000,
    displayName: 'GPT-6.2 Astra',
    family: 'openai',
    id: 'gpt-6.2-astra',
    maxOutput: 128000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 8,
              upTo: 200000,
            },
            {
              rate: 16,
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
              rate: 0.4,
              upTo: 200000,
            },
            {
              rate: 0.8,
              upTo: 'infinity',
            },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 40,
              upTo: 200000,
            },
            {
              rate: 60,
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
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'GPT-6 Astra',
    family: 'openai',
    id: 'gpt-6-astra',
    maxOutput: 128000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 10,
              upTo: 200000,
            },
            {
              rate: 20,
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
              rate: 1,
              upTo: 200000,
            },
            {
              rate: 2,
              upTo: 'infinity',
            },
          ],
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheWrite', rate: 12.5, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 50,
              upTo: 200000,
            },
            {
              rate: 75,
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
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'GPT-6 Luna',
    family: 'openai',
    id: 'gpt-6-luna',
    maxOutput: 128000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 0.1,
              upTo: 200000,
            },
            {
              rate: 0.2,
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
              rate: 0.01,
              upTo: 200000,
            },
            {
              rate: 0.02,
              upTo: 'infinity',
            },
          ],
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheWrite', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 0.5,
              upTo: 200000,
            },
            {
              rate: 0.75,
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
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1050000,
    displayName: 'GPT-6.2 Sol',
    family: 'openai',
    id: 'gpt-6.2-sol',
    maxOutput: 128000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 2,
              upTo: 200000,
            },
            {
              rate: 4,
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
              rate: 0.1,
              upTo: 200000,
            },
            {
              rate: 0.2,
              upTo: 'infinity',
            },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 10,
              upTo: 200000,
            },
            {
              rate: 15,
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
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'GPT-6.1 Sol',
    enabled: true,
    family: 'openai',
    id: 'gpt-6.1-sol',
    maxOutput: 128000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 2,
              upTo: 200000,
            },
            {
              rate: 4,
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
              rate: 0.1,
              upTo: 200000,
            },
            {
              rate: 0.2,
              upTo: 'infinity',
            },
          ],
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheWrite', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 10,
              upTo: 200000,
            },
            {
              rate: 15,
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
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1050000,
    displayName: 'GPT-6.1 Terra',
    family: 'openai',
    id: 'gpt-6.1-terra',
    maxOutput: 128000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 1,
              upTo: 200000,
            },
            {
              rate: 2,
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
              rate: 0.1,
              upTo: 200000,
            },
            {
              rate: 0.2,
              upTo: 'infinity',
            },
          ],
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheWrite', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 5,
              upTo: 200000,
            },
            {
              rate: 7.5,
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
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1050000,
    displayName: 'GPT-6.1 Terra Pro',
    family: 'openai',
    id: 'gpt-6.1-terra-pro',
    maxOutput: 128000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 1,
              upTo: 200000,
            },
            {
              rate: 2,
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
              rate: 0.1,
              upTo: 200000,
            },
            {
              rate: 0.2,
              upTo: 'infinity',
            },
          ],
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheWrite', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 5,
              upTo: 200000,
            },
            {
              rate: 7.5,
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
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'GPT-6 Sol',
    family: 'openai',
    id: 'gpt-6-sol',
    maxOutput: 128000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 2,
              upTo: 200000,
            },
            {
              rate: 4,
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
              rate: 0.2,
              upTo: 200000,
            },
            {
              rate: 0.4,
              upTo: 'infinity',
            },
          ],
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheWrite', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            {
              rate: 10,
              upTo: 200000,
            },
            {
              rate: 15,
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
      structuredOutput: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'GPT-5.6 Luna',
    family: 'openai',
    id: 'gpt-5.6-luna',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.016, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.96, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'GPT-5.6 Terra',
    family: 'openai',
    id: 'gpt-5.6-terra',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'GPT-5.6 Sol',
    family: 'openai',
    id: 'gpt-5.6-sol',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];
