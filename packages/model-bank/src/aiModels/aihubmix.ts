import { gptImage2Schema, nanoBanana2LiteParameters } from '../const/imageParameters';
import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

const aihubmixChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description: 'GPT-5.5 is our newest frontier model for the most complex professional work.',
    displayName: 'GPT-5.5',
    enabled: true,
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
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.4 mini brings GPT-5.4 strengths to a faster, more efficient model for high-volume coding and agentic workflows.',
    displayName: 'GPT-5.4 mini',
    enabled: true,
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
    releasedAt: '2026-03-17',
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
      'GPT-5.4 nano is our lowest-cost GPT-5.4-class model for high-throughput tasks where speed and cost matter most.',
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
    releasedAt: '2026-03-17',
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
      extendParams: ['gpt5_2ProReasoningEffort'],
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
      'GPT-5.2 pro: smarter, more precise GPT-5.2 (Responses API only), for hard problems and longer multi-turn reasoning.',
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
      extendParams: ['gpt5_2ProReasoningEffort', 'textVerbosity'],
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
      imageOutput: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.1 is the flagship model optimized for coding and agent tasks, with configurable reasoning intensity and longer context.',
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
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: 'GPT-5.1 Chat: the ChatGPT variant of GPT-5.1, built for chat scenarios.',
    displayName: 'GPT-5.1 Chat',
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'gpt-5.1-chat-latest',
    knowledgeCutoff: '2024-09',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-13',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      imageOutput: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.1 Codex: GPT-5.1 optimized for agentic coding tasks, for more complex code/agent workflows in the Responses API.',
    displayName: 'GPT-5.1 Codex',
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'gpt-5.1-codex',
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
      extendParams: ['gpt5_1ReasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      imageOutput: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.1 Codex mini: smaller, lower-cost Codex variant optimized for agentic coding.',
    displayName: 'GPT-5.1 Codex mini',
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'gpt-5.1-codex-mini',
    knowledgeCutoff: '2024-09',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-13',
    settings: {
      extendParams: ['gpt5_1ReasoningEffort'],
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
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 Codex is a GPT-5 variant optimized for agentic coding tasks in Codex-like environments.',
    displayName: 'GPT-5 Codex',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-codex',
    knowledgeCutoff: '2024-09',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-15',
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
      'Best model for cross-domain coding and agent tasks. GPT-5 delivers leaps in accuracy, speed, reasoning, context awareness, structured thinking, and problem solving.',
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
      'A faster, more cost-effective GPT-5 variant for well-defined tasks, delivering faster responses while maintaining quality.',
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
        { name: 'textInput_cacheRead', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
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
      reasoning: true,
      structuredOutput: false,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'The GPT-5 model used in ChatGPT, combining strong language understanding and generation for conversational apps.',
    displayName: 'GPT-5 Chat',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-chat-latest',
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
      'o4-mini is our latest small o-series model, optimized for fast, efficient reasoning with strong coding and vision performance.',
    displayName: 'o4-mini',
    family: 'o-series',
    generation: 'o4',
    id: 'o4-mini',
    knowledgeCutoff: '2024-06',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.275, strategy: 'fixed', unit: 'millionTokens' },
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
      'o3-pro uses more compute to think deeper and consistently deliver better answers, available only via the Responses API.',
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
      'o3 is a powerful general-purpose model that excels across domains. It sets a new bar for math, science, coding, and vision reasoning, and is strong at technical writing and instruction following. Use it to analyze text, code, and images and solve complex multi-step problems.',
    displayName: 'o3',
    family: 'o-series',
    generation: 'o3',
    id: 'o3',
    knowledgeCutoff: '2024-06',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
    description: 'GPT-4.1 mini balances intelligence, speed, and cost for many use cases.',
    displayName: 'GPT-4.1 mini',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1-mini',
    knowledgeCutoff: '2024-06',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
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
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description: 'A non-reasoning variant for simple use cases',
    displayName: 'Grok 4.20 (Non-Reasoning)',
    enabled: true,
    family: 'grok',
    generation: 'grok-4',
    id: 'grok-4-20-non-reasoning',
    maxOutput: 2_000_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
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
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description: 'Intelligent, blazing-fast model that reasons before responding',
    displayName: 'Grok 4.20',
    enabled: true,
    family: 'grok',
    generation: 'grok-4',
    id: 'grok-4-20-reasoning',
    maxOutput: 2_000_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
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
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description:
      'A team of 4 or 16 agents, Excels at research use cases, Does not currently support client-side tools. Only supports xAI server side tools (eg X Search, Web Search tools) and remote MCP tools.',
    displayName: 'Grok 4.20 Multi-Agent',
    enabled: true,
    family: 'grok',
    generation: 'grok-4.20',
    id: 'grok-4.20-multi-agent-0309',
    maxOutput: 2_000_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-09',
    settings: {
      extendParams: ['grok4_20ReasoningEffort'],
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
    contextWindowTokens: 1_000_000,
    description:
      "Claude Opus 4.7 is Anthropic's most capable generally available model for complex reasoning and agentic coding.",
    displayName: 'Claude Opus 4.7',
    enabled: true,
    family: 'claude-opus',
    generation: 'claude-4.7',
    id: 'claude-opus-4-7',
    knowledgeCutoff: '2026-01',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-16',
    settings: {
      extendParams: ['disableContextCaching', 'enableAdaptiveThinking', 'opus47Effort'],
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
    contextWindowTokens: 1_000_000,
    description:
      'Claude Opus 4.6 is Anthropic’s most intelligent model for building agents and coding.',
    displayName: 'Claude Opus 4.6',
    family: 'claude-opus',
    generation: 'claude-4.6',
    id: 'claude-opus-4-6',
    knowledgeCutoff: '2025-05',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 10, '5m': 6.25 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-05',
    settings: {
      extendParams: ['disableContextCaching', 'enableAdaptiveThinking', 'effort'],
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
    contextWindowTokens: 1_000_000,
    description: 'Claude Sonnet 4.6 is Anthropic’s best combination of speed and intelligence.',
    displayName: 'Claude Sonnet 4.6',
    enabled: true,
    family: 'claude-sonnet',
    generation: 'claude-4.6',
    id: 'claude-sonnet-4-6',
    knowledgeCutoff: '2025-05',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 6, '5m': 3.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-17',
    settings: {
      extendParams: [
        'disableContextCaching',
        'enableAdaptiveThinking',
        'enableReasoning',
        'reasoningBudgetToken',
        'effort',
      ],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek-V3.1 thinking mode: a new hybrid reasoning model with thinking and non-thinking modes, more efficient than DeepSeek-R1-0528. Post-training optimizations significantly improve agent tool use and agent task performance.',
    displayName: 'DeepSeek V3.1 (Think)',
    family: 'deepseek',
    generation: 'deepseek-v3.1',
    id: 'DeepSeek-V3.1-Think',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.68, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'ByteDance Volcengine’s open deployment is currently the most stable; recommended. It has been auto-upgraded to the latest release (250324).',
    displayName: 'DeepSeek V3',
    family: 'deepseek',
    generation: 'deepseek-v3',
    id: 'DeepSeek-V3',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.272, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.088, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 131_072 + 32_768,
    description:
      "Gemini 3.1 Flash Image (Nano Banana 2) is Google's fastest native image generation model with thinking support, conversational image generation and editing.",
    displayName: 'Nano Banana 2',
    enabled: true,
    family: 'gemini',
    generation: 'gemini-3.1',
    id: 'gemini-3.1-flash-image-preview',
    knowledgeCutoff: '2025-01',
    maxOutput: 32_768,
    pricing: {
      approximatePricePerImage: 0.067,
      units: [
        { name: 'imageOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-26',
    settings: {
      extendParams: ['imageAspectRatio2', 'imageResolution2', 'thinkingLevel4'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      audio: true,
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 3.1 Pro Preview provides better thinking, improved token efficiency, and a reliable experience optimized for software engineering behavior.',
    displayName: 'Gemini 3.1 Pro Preview',
    enabled: true,
    family: 'gemini',
    generation: 'gemini-3.1',
    id: 'gemini-3.1-pro-preview',
    knowledgeCutoff: '2025-01',
    maxOutput: 65_536,
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 200_000 },
            { rate: 0.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 200_000 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 12, upTo: 200_000 },
            { rate: 18, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          lookup: { prices: { '1h': 4.5 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-19',
    settings: {
      extendParams: ['thinkingLevel3', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      audio: true,
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 3 Flash is the smartest model built for speed, combining cutting-edge intelligence with excellent search grounding.',
    displayName: 'Gemini 3 Flash Preview',
    enabled: true,
    family: 'gemini',
    generation: 'gemini-3',
    id: 'gemini-3-flash-preview',
    knowledgeCutoff: '2025-01',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 1 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-12-17',
    settings: {
      extendParams: ['thinkingLevel', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 131_072 + 32_768,
    description:
      'Gemini 3 Pro Image (Nano Banana Pro) is Google’s image generation model with multimodal chat support.',
    displayName: 'Nano Banana Pro',
    family: 'gemini',
    generation: 'gemini-3',
    id: 'gemini-3-pro-image-preview',
    knowledgeCutoff: '2025-01',
    maxOutput: 32_768,
    pricing: {
      approximatePricePerImage: 0.134,
      units: [
        { name: 'imageOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-20',
    settings: {
      searchImpl: 'params',
      searchProvider: 'google',
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
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 2.5 Pro is Google’s most advanced thinking model for reasoning over complex problems in code, math, and STEM, and for analyzing large datasets, codebases, and documents with long context.',
    displayName: 'Gemini 2.5 Pro',
    family: 'gemini',
    generation: 'gemini-2.5',
    id: 'gemini-2.5-pro',
    knowledgeCutoff: '2025-01',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-17',
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
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
    contextWindowTokens: 1_048_576 + 65_536,
    description: 'Gemini 2.5 Flash is Google’s best-value model with full capabilities.',
    displayName: 'Gemini 2.5 Flash',
    family: 'gemini',
    generation: 'gemini-2.5',
    id: 'gemini-2.5-flash',
    knowledgeCutoff: '2025-01',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-17',
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      vision: true,
    },
    contextWindowTokens: 32_768 + 8192,
    description:
      'Nano Banana is Google’s newest, fastest, and most efficient native multimodal model, allowing image generation and editing through conversation.',
    displayName: 'Nano Banana',
    family: 'gemini',
    generation: 'gemini-2.5',
    id: 'gemini-2.5-flash-image',
    knowledgeCutoff: '2025-06',
    maxOutput: 8192,
    pricing: {
      approximatePricePerImage: 0.039,
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-26',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 2.5 Flash-Lite is Google’s smallest, best-value model, designed for large-scale use.',
    displayName: 'Gemini 2.5 Flash-Lite',
    family: 'gemini',
    generation: 'gemini-2.5',
    id: 'gemini-2.5-flash-lite',
    knowledgeCutoff: '2025-01',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-22',
    settings: {
      extendParams: ['thinkingBudget', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 thinking-mode open-source model. Compared to the previous version (Qwen3-235B-A22B), it significantly improves logic, general ability, knowledge, and creativity, suitable for hard reasoning scenarios.',
    displayName: 'Qwen3 235B A22B Thinking 2507',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-235b-a22b-thinking-2507',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-25',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 non-thinking open-source model. Compared to the previous version (Qwen3-235B-A22B), it slightly improves subjective creativity and model safety.',
    displayName: 'Qwen3 235B A22B Instruct 2507',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-235b-a22b-instruct-2507',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-22',
    type: 'chat',
  },
];

const aihubmixImageModels: AIImageModelCard[] = [
  {
    description:
      "GPT-Image-2.5 Flare is OpenAI's latest image model, the fastest and suited for everyday high-quality image generation. It accepts text and image inputs and produces image outputs. The model supports quality settings: low, medium, high, xhigh, max, and auto.",
    displayName: 'GPT Image 2.5 Flare',
    enabled: true,
    id: 'gpt-image-2.5-flare',
    // The probed schema for this model only confirms `size` accepts 'auto' or a
    // WIDTHxHEIGHT string (gateway validates pixel/aspect/divisibility limits
    // server-side); it doesn't enumerate which exact sizes are valid. Reusing the
    // sibling gpt-image-2's already-vetted enum as a known-reasonable default set,
    // not independently confirmed for this specific model.
    parameters: gptImage2Schema,
    pricing: {
      units: [
        { name: 'imageInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-08',
    type: 'image',
  },
  {
    description:
      'GPT Image 2.5 Sunburst is OpenAI’s latest image model, capable of generating and editing images from text and image inputs. It is suitable for workflows that require extremely high editing precision. The model supports quality settings: low, medium, high, xhigh, max, and auto.',
    displayName: 'GPT Image 2.5 Sunburst',
    enabled: true,
    id: 'gpt-image-2.5-sunburst',
    // Same caveat as gpt-image-2.5-flare above: size enum borrowed from the sibling
    // gpt-image-2 entry, not independently confirmed for this model.
    parameters: gptImage2Schema,
    pricing: {
      units: [
        { name: 'imageInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-08',
    type: 'image',
  },
  {
    description:
      'GPT Image 1.5 is a new image generation model powered by OpenAI’s flagship visual capabilities, comprehensively upgraded for high-quality creative and production workflows. It delivers significant improvements in instruction understanding, fine-grained image editing, and detail preservation, while achieving up to 4x faster generation compared to previous versions.',
    displayName: 'GPT Image 1.5',
    enabled: true,
    id: 'gpt-image-1.5',
    // Not gptImage1Schema: that schema's `size` enum includes the literal 'auto', but the
    // probed request schema for this model (`/call/schema/models/gpt-image-1.5/endpoints`)
    // only confirms '1024x1024' | '1536x1024' | '1024x1536' | null — 'auto' is not a
    // verified accepted value here, so it's dropped to avoid a default that the gateway
    // may reject.
    parameters: {
      imageUrls: { default: [], maxCount: 1, maxFileSize: 5 * 1024 * 1024 },
      prompt: { default: '' },
      size: {
        default: '1024x1024',
        enum: ['1024x1024', '1536x1024', '1024x1536'],
      },
    },
    pricing: {
      units: [
        { name: 'imageInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-25',
    type: 'image',
  },
  {
    description:
      "MAI-Image-2.6 is Microsoft's latest image-generation and editing model. It can generate images from text prompts and supports image-guided editing in multiple aspect ratios.",
    displayName: 'Mai Image 2.6',
    enabled: true,
    id: 'mai-image-2.6',
    // enum values confirmed via the probed request schema; the schema itself declares
    // no default for `resolution`, so '1K' below is a UI-convenience pick (a value known
    // to be in the confirmed enum), not a gateway-reported default.
    parameters: {
      imageUrls: { default: [] },
      prompt: { default: '' },
      resolution: { default: '1K', enum: ['512', '1K', '2K', '4K'] },
    },
    pricing: {
      units: [
        { name: 'imageInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-05',
    type: 'image',
  },
  {
    description:
      'MAI-Image-2.6 Flash is Microsoft’s low-latency version of the latest image model MAI-Image-2.6. It supports image generation in multiple aspect ratios and image-guided editing.',
    displayName: 'Mai Image 2.6 Flash',
    enabled: true,
    id: 'mai-image-2.6-flash',
    // Same caveat as mai-image-2.6 above: '1K' default is a UI-convenience pick, not
    // gateway-reported.
    parameters: {
      imageUrls: { default: [] },
      prompt: { default: '' },
      resolution: { default: '1K', enum: ['512', '1K', '2K', '4K'] },
    },
    pricing: {
      units: [
        { name: 'imageInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-05',
    type: 'image',
  },
  {
    description:
      "Agnes Image 2.1 Flash is Agnes AI's high-performance image generation and image editing model, supporting text-to-image, image-to-image, and multi-image composition. It is suitable for creative design, marketing visuals, e-commerce product images, and social content production.",
    displayName: 'Agnes Image 2.1 Flash',
    enabled: true,
    id: 'agnes-image-2.1-flash',
    parameters: {
      aspectRatio: {
        default: '1:1',
        enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'],
      },
      imageUrls: { default: [] },
      prompt: { default: '' },
    },
    pricing: {
      units: [
        { name: 'imageInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'image',
  },
  {
    description:
      'The Qwen-Image-2.0 series accelerated models integrate image generation and image editing; they offer more professional text rendering with support for 1k-token instructions, finer realistic textures and delicate portrayal of photorealistic scenes, and stronger semantic adherence. The accelerated version effectively achieves an optimal balance between model quality and performance.',
    displayName: 'Qwen Image 2.0',
    enabled: true,
    id: 'qwen-image-2.0',
    parameters: {
      imageUrls: { default: [] },
      prompt: { default: '' },
    },
    pricing: {
      units: [
        { name: 'imageInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-03',
    type: 'image',
  },
  {
    description:
      'The Qwen-Image-2.0 full-powered models achieve the integration of image generation and image editing; they offer more professional text rendering with support for 1k-token instructions, more refined photorealistic textures and delicate depiction of realistic scenes, and stronger semantic adherence. The full-powered version delivers the strongest text rendering capability and realism in the 2.0 series.',
    displayName: 'Qwen Image 2.0 Pro',
    enabled: true,
    id: 'qwen-image-2.0-pro',
    parameters: {
      imageUrls: { default: [] },
      prompt: { default: '' },
    },
    pricing: {
      units: [
        { name: 'imageInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-03',
    type: 'image',
  },
  {
    description:
      'GLM-Image is Zhipu AI’s new flagship image generation model. The model is trained entirely on domestic chips and adopts an original hybrid architecture combining "autoregressive + diffusion decoder," balancing global instruction understanding with local detail depiction. It overcomes generation challenges in knowledge-intensive scenarios such as posters, PPTs, and popular science illustrations.',
    displayName: 'GLM Image',
    enabled: true,
    id: 'glm-image',
    // The probed request schema (`/call/schema/models/glm-image/endpoints`) only lists
    // `prompt`, `size`, `n`, `model`, `async`, `extra` as top-level fields — `size` there
    // is a free-form `^\d+x\d+$` pattern with no enum, and there is no top-level
    // `resolution` or `watermark` field. `resolution`/`watermark` are therefore dropped
    // here: adding UI controls for fields the gateway doesn't accept as top-level params
    // risks the request being rejected. The `size` enum below is reused from the
    // already-vetted native Zhipu entry for the same underlying model
    // (packages/model-bank/src/aiModels/zhipu.ts) as a known-good subset of sizes — the
    // gateway probe's own default ('1280x1280') matches it exactly, but the full set of
    // sizes aihubmix itself accepts beyond this subset is unconfirmed.
    parameters: {
      prompt: { default: '' },
      size: {
        default: '1280x1280',
        enum: [
          '1280x1280',
          '1568x1056',
          '1056x1568',
          '1472x1088',
          '1088x1472',
          '1728x960',
          '960x1728',
        ],
      },
    },
    pricing: {
      units: [
        { name: 'imageInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    // The aihubmix `/v1/models` listing has no release_date for this model; this date
    // matches the repo's own native Zhipu entry (zhipu.ts) for the same model and is
    // independently corroborated by Zhipu AI's own GLM-Image announcement (2026-01-14).
    releasedAt: '2026-01-14',
    type: 'image',
  },
  {
    description:
      'Wanxiang 2.7 — image generation and editing: supports text-to-image, text-to-multi-image, image-to-multi-image, image editing, multi-image reference generation, and interactive editing, with stronger performance in text rendering, subject consistency, and following complex instructions.',
    displayName: 'Wan2.7 Image',
    enabled: true,
    id: 'wan2.7-image',
    // enum values confirmed via the probed request schema; the schema itself declares no
    // default for `aspect_ratio`, so '1:1' below is a UI-convenience pick (a value known
    // to be in the confirmed enum), not a gateway-reported default.
    parameters: {
      aspectRatio: {
        default: '1:1',
        enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9', '9:21'],
      },
      imageUrls: { default: [] },
      prompt: { default: '' },
    },
    pricing: {
      units: [
        { name: 'imageInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-29',
    type: 'image',
  },
  {
    description:
      'Wanxiang 2.7 — image generation and editing: supports text-to-image, text-to-multi-image, image-to-multi-image, image editing, multi-image reference generation, and interactive editing, with stronger performance in text rendering, subject consistency, and following complex instructions.',
    displayName: 'Wan2.7 Image Pro',
    enabled: true,
    id: 'wan2.7-image-pro',
    // Same caveat as wan2.7-image above: '1:1' default is a UI-convenience pick, not
    // gateway-reported.
    parameters: {
      aspectRatio: {
        default: '1:1',
        enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9', '9:21'],
      },
      imageUrls: { default: [] },
      prompt: { default: '' },
    },
    pricing: {
      units: [
        { name: 'imageInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-29',
    type: 'image',
  },
  // Restored: originally in this PR's removal list as "no longer exists upstream", but
  // a live check of aihubmix's /v1/models catalog confirms retire_stage is still
  // "active" for both of the following — the earlier removal was a misjudgment.
  {
    description:
      "Gemini 3.1 Flash Lite Image (Nano Banana 2 Lite) is Google's fastest and most cost-efficient image generation model, built for high-volume generation and editing.",
    displayName: 'Nano Banana 2 Lite',
    enabled: true,
    id: 'gemini-3.1-flash-lite-image:image',
    parameters: nanoBanana2LiteParameters,
    pricing: {
      approximatePricePerImage: 0.034,
      units: [
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-30',
    type: 'image',
  },
  {
    description:
      "OpenAI's next-generation multimodal image model with native reasoning, up to 4K resolution, near-perfect text rendering, and high-fidelity multilingual support.",
    displayName: 'GPT Image 2',
    enabled: true,
    id: 'gpt-image-2',
    parameters: gptImage2Schema,
    pricing: {
      // Medium quality at 1024x1024: ~1767 output tokens * $30/M = $0.053 per image.
      // Source: https://aihubmix.com/model/gpt-image-2
      approximatePricePerImage: 0.053,
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-21',
    type: 'image',
  },
];

export const allModels = [...aihubmixChatModels, ...aihubmixImageModels];

export default allModels;
