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
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Compared to the previously released Ring-1T, Ring-2.5-1T achieves significant improvements across three key dimensions: generation efficiency, reasoning depth, and long-horizon task execution capability: Generation Efficiency**: By leveraging a high proportion of linear attention mechanisms, Ring-2.5-1T reduces memory access overhead by more than 10×. When processing sequences exceeding 32K tokens, it delivers over 3× higher generation throughput, making it particularly well-suited for deep reasoning and long-horizon task execution. Deep Reasoning**: Building on RLVR, a dense reward mechanism is introduced to provide feedback on the rigor of the reasoning process. This enables Ring-2.5-1T to achieve gold-medal-level performance in both IMO 2025 and CMO 2025 (self-evaluated). Long-Horizon Task Execution**: Through large-scale fully asynchronous agent-based reinforcement learning training, the model significantly enhances its ability to autonomously execute complex tasks over extended periods. This allows Ring-2.5-1T to seamlessly integrate with agent programming frameworks such as Claude Code and OpenClaw personal AI assistants.',
    displayName: 'Ring-2.5-1T',
    family: 'ring',
    generation: 'ring-2.5',
    id: 'Ring-2.5-1T',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-15',
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
    contextWindowTokens: 262_144, // Model can support 1M context window but API only release 256K
    description:
      'The latest flagship large language model, featuring support for a 1M-token context window and enabling an end-to-end workflow from logical reasoning to task execution.',
    displayName: 'Ling-2.6-1T',
    enabled: true,
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
    enabled: true,
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
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'As the latest flagship real-time model in the Ling series, Ling-2.5-1T introduces comprehensive upgrades in model architecture, token efficiency, and preference alignment, aiming to elevate the quality of accessible AI to a new level.',
    displayName: 'Ling-2.5-1T',
    family: 'ling',
    generation: 'ling-2.5',
    id: 'Ling-2.5-1T',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-16',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

export default antgroupChatModels;
