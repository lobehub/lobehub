import type { AIChatModelCard } from '../../types/aiModel';

// https://quicksilverpro.io/pricing.json — catalog v83 (2026-11-17), USD per 1M tokens.
export const openModelsChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'DeepSeek V4 Flash',
    family: 'deepseek',
    id: 'deepseek-v4-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.015, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.18, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'DeepSeek V4.1 Flash',
    enabled: true,
    family: 'deepseek',
    id: 'deepseek-v4.1-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.154, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0046, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.462, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'DeepSeek V4.1 Flash 1017',
    family: 'deepseek',
    id: 'deepseek-v4.1-flash-1017',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.098, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.00294, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.294, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'DeepSeek V4 Pro',
    family: 'deepseek',
    id: 'deepseek-v4-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Qwen3.8 Max',
    family: 'qwen',
    id: 'qwen3.8-max',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1000000,
    displayName: 'Qwen4-Max',
    family: 'qwen',
    id: 'qwen4-max',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Qwen3.8 Max Prime',
    family: 'qwen',
    id: 'qwen3.8-max-prime',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      audio: true,
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Qwen3.8 Omni Flash',
    family: 'qwen',
    id: 'qwen3.8-omni-flash',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.016, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.47, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Qwen3.7 Max',
    family: 'qwen',
    id: 'qwen3.7-max',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 1.5625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Qwen3.7 Plus',
    family: 'qwen',
    id: 'qwen3.7-plus',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.256, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0512, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.32, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.024, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Qwen3.7 Flash',
    family: 'qwen',
    id: 'qwen3.7-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.024, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0048, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.104, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Qwen3.6 Plus',
    family: 'qwen',
    id: 'qwen3.6-plus',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.325, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.56, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262144,
    displayName: 'Qwen3.6-35B-A3B',
    family: 'qwen',
    id: 'qwen3.6-35b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1000000,
    displayName: 'Qwen3.8 27B',
    enabled: true,
    family: 'qwen',
    id: 'qwen3.8-27b',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.34, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.068, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.425, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.04, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1000000,
    displayName: 'Qwen3.8 27B Decentered',
    family: 'qwen',
    id: 'qwen3.8-27b-decentered',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.238, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.428, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1000000,
    displayName: 'Qwen3.8 Flash Next',
    family: 'qwen',
    id: 'qwen3.8-flash-next',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0128, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.376, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 256000,
    displayName: 'Kimi K2.6',
    family: 'moonshot',
    id: 'kimi-k2.6',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.45, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.045, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.95, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 256000,
    displayName: 'Kimi K2.7 Code',
    family: 'moonshot',
    id: 'kimi-k2.7-code',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6712, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.18, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.35, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Kimi K3.1 Pro',
    family: 'moonshot',
    id: 'kimi-k3.1-pro',
    maxOutput: 943718,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Kimi K3.1 Pro Highspeed',
    family: 'moonshot',
    id: 'kimi-k3.1-pro-highspeed',
    maxOutput: 943718,
    pricing: {
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Kimi K3',
    family: 'moonshot',
    id: 'kimi-k3',
    pricing: {
      units: [
        { name: 'textInput', rate: 2.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.255, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12.75, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Muse Wonder',
    family: 'meta',
    id: 'muse-wonder',
    maxOutput: 943718,
    pricing: {
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1000000,
    displayName: 'Muse Spark Open',
    family: 'meta',
    id: 'muse-spark-open',
    maxOutput: 262144,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.25, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Muse Spark 1.3',
    family: 'meta',
    id: 'muse-spark-1.3',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.4, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Muse Spark 1.2',
    family: 'meta',
    id: 'muse-spark-1.2',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.4, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131072,
    displayName: 'Muse Glimmer 30B',
    family: 'meta',
    id: 'muse-glimmer-30b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'GLM 5.3',
    enabled: true,
    family: 'z-ai',
    id: 'glm-5.3',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'GLM 5.3 Prime',
    family: 'z-ai',
    id: 'glm-5.3-prime',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.448, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.04, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'GLM 5.3 Flash',
    enabled: true,
    family: 'z-ai',
    id: 'glm-5.3-flash',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.0284, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0284, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.0923, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'GLM 5.2',
    family: 'z-ai',
    id: 'glm-5.2',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.105, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262144,
    displayName: 'Nemotron 3 Ultra',
    family: 'nvidia',
    id: 'nemotron-3-ultra',
    maxOutput: 16384,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262144,
    displayName: 'Nemotron 3.5 Lightning',
    family: 'nvidia',
    id: 'nemotron-3.5-lightning',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.066, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.033, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.176, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 500000,
    displayName: 'Grok 4.5',
    family: 'xai',
    id: 'grok-4.5',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.8, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 500000,
    displayName: 'Grok 4.6',
    family: 'xai',
    id: 'grok-4.6',
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
              rate: 0.5,
              upTo: 200000,
            },
            {
              rate: 1,
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
              rate: 6,
              upTo: 200000,
            },
            {
              rate: 12,
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
    contextWindowTokens: 500000,
    displayName: 'Grok 4.7',
    enabled: true,
    family: 'xai',
    id: 'grok-4.7',
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
              rate: 0.5,
              upTo: 200000,
            },
            {
              rate: 1,
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
              rate: 6,
              upTo: 200000,
            },
            {
              rate: 12,
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
    displayName: 'MiniMax M3',
    family: 'minimax',
    id: 'minimax-m3',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.048, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.96, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'MiMo-V2.6-Pro',
    enabled: true,
    family: 'xiaomi',
    id: 'mimo-v2.6-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.426, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0036, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.861, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'MiMo-V2.6-Flash',
    family: 'xiaomi',
    id: 'mimo-v2.6-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.112, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.00224, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.224, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'MiMo-V2.5',
    family: 'xiaomi',
    id: 'mimo-v2.5',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.32, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.064, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Hy4',
    family: 'tencent',
    id: 'hy4',
    maxOutput: 65536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.459, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0231, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.375, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1048576,
    displayName: 'Hy4 Preview',
    family: 'tencent',
    id: 'hy4-preview',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6672, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0336, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.0008, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262144,
    displayName: 'Hy3',
    family: 'tencent',
    id: 'hy3',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.091, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0227, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.363, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Step 5 Preview',
    family: 'stepfun',
    id: 'step-5-preview',
    maxOutput: 65536,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.7, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 524288,
    displayName: 'Mistral Large 4',
    family: 'mistral',
    id: 'mistral-large-4',
    maxOutput: 131072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.68, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.09, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Muse Ember',
    family: 'meta',
    id: 'muse-ember',
    maxOutput: 524288,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.004, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'Inkling 2 Small',
    family: 'thinkingmachines',
    id: 'inkling-2-small',
    maxOutput: 943718,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.165, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.033, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];
