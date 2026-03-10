import type { AIChatModelCard } from '../types/aiModel';

const perplexityChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 127_072,
    description:
      'Deep Research performs comprehensive expert-level research and synthesizes it into accessible, actionable reports.',
    displayName: 'Sonar Deep Research',
    enabled: true,
    id: 'sonar-deep-research',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-14',
    settings: {
      extendParams: ['reasoningEffort'],
      searchImpl: 'internal',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 127_072,
    description:
      'An advanced search product with search grounding for complex queries and follow-ups.',
    displayName: 'Sonar Reasoning Pro',
    enabled: true,
    id: 'sonar-reasoning-pro',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-21',
    settings: {
      searchImpl: 'internal',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 127_072,
    description:
      'An advanced search product with search grounding for complex queries and follow-ups.',
    displayName: 'Sonar Reasoning',
    enabled: true,
    id: 'sonar-reasoning',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-21',
    settings: {
      searchImpl: 'internal',
    },
    type: 'chat',
  },
  {
    abilities: {
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'An advanced search product with search grounding for complex queries and follow-ups.',
    displayName: 'Sonar Pro',
    enabled: true,
    id: 'sonar-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-21',
    settings: {
      searchImpl: 'internal',
    },
    type: 'chat',
  },
  {
    abilities: {
      search: true,
      vision: true,
    },
    contextWindowTokens: 127_072,
    description: 'A lightweight search-grounded product, faster and cheaper than Sonar Pro.',
    displayName: 'Sonar',
    enabled: true,
    id: 'sonar',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-21',
    settings: {
      searchImpl: 'internal',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 127_072,
    description:
      'R1-1776 is a post-trained variant of DeepSeek R1 designed to provide uncensored, unbiased factual information.',
    displayName: 'R1 1776',
    id: 'r1-1776',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-18',
    type: 'chat',
  },
];

export const allModels = [...perplexityChatModels];

export default allModels;
