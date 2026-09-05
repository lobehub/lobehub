import { type AIChatModelCard } from '../types/aiModel';

const antgroupChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Ring-2.6-1T is a trillion-parameter-scale reasoning model that activates approximately 63B parameters per inference. Designed for Agent workflows, it focuses on agent capabilities, tool use, and long-horizon task execution, achieving leading performance on benchmarks such as PinchBench, ClawEval, TAU2-Bench, and GAIA2-search. The model is optimized across execution quality, latency, and cost, making it well suited for advanced coding agents, complex reasoning pipelines, and large-scale autonomous systems.',
    displayName: 'Ring-2.6-1T',
    enabled: true,
    family: 'ring',
    generation: 'ring-2.6',
    id: 'Ring-2.6-1T',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 18, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-15',
    settings: {
      extendParams: ['ring2_6ReasoningEffort'],
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
    },
    contextWindowTokens: 262_144, // Model can support 1M context window but API only release 256K
    description:
      'Ling-3.0-flash is the latest generation high cost-performance model in the Ling series. It adopts a Mixture-of-Experts (MoE) architecture, with a total parameter count of 124B and 5.1B activated parameters per token. It natively supports a 256K context window, which can be expanded up to 1M. Compared to the previous flash version, Ling-3.0-flash significantly enhances long-horizon task stability, tool call accuracy, and adaptation to common Harness environments.',
    displayName: 'Ling-3.0-flash',
    enabled: true,
    family: 'ling',
    generation: 'ling-3.0',
    id: 'Ling-3.0-flash',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-23',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262_144, // Model can support 1M context window but API only release 256K
    description:
      'The latest flagship large language model, featuring support for a 1M-token context window and enabling an end-to-end workflow from logical reasoning to task execution.',
    displayName: 'Ling-2.6-1T',
    family: 'ling',
    generation: 'ling-2.6',
    id: 'Ling-2.6-1T',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 18, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-29',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Ling-2.6-flash is the latest generation high cost-performance model in the Ling series. It adopts a Mixture-of-Experts (MoE) architecture, with a total parameter count of 100B and 6.1B activated parameters per token, achieving an optimal balance between inference performance and computational cost.',
    displayName: 'Ling-2.6-flash',
    family: 'ling',
    generation: 'ling-2.6',
    id: 'Ling-2.6-flash',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-22',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

export default antgroupChatModels;
