import { type AIChatModelCard } from '../types/aiModel';

const antgroupChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Compared to the previously released Ring-1T, Ring-2.5-1T achieves significant improvements across three key dimensions: generation efficiency, reasoning depth, and long-horizon task execution capability: Generation Efficiency**: By leveraging a high proportion of linear attention mechanisms, Ring-2.5-1T reduces memory access overhead by more than 10×. When processing sequences exceeding 32K tokens, it delivers over 3× higher generation throughput, making it particularly well-suited for deep reasoning and long-horizon task execution. Deep Reasoning**: Building on RLVR, a dense reward mechanism is introduced to provide feedback on the rigor of the reasoning process. This enables Ring-2.5-1T to achieve gold-medal-level performance in both IMO 2025 and CMO 2025 (self-evaluated). Long-Horizon Task Execution**: Through large-scale fully asynchronous agent-based reinforcement learning training, the model significantly enhances its ability to autonomously execute complex tasks over extended periods. This allows Ring-2.5-1T to seamlessly integrate with agent programming frameworks such as Claude Code and OpenClaw personal AI assistants.',
    displayName: 'Ring-2.5-1T',
    enabled: true,
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
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Ring-1T is the world’s first open-source trillion-parameter reasoning model and the flagship model in the Bailing Mixture-of-Experts (MoE) reasoning series, representing the largest scale and strongest reasoning capability within the Ring family. Built on the IcePop methodology for RLVR training, the model demonstrates outstanding natural language reasoning abilities. It achieves state-of-the-art (SOTA) performance across multiple benchmarks, including AIME 2025, Codeforces, HMMT 2025, LiveCodeBench, and ARC-AGI v1, ranking among the top open-source models on numerous metrics.',
    displayName: 'Ring-1T',
    id: 'Ring-1T',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-28',
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
    contextWindowTokens: 262_144,
    description:
      'Ling-2.6-flash is the latest generation high cost-performance model in the Ling series. It adopts a Mixture-of-Experts (MoE) architecture, with a total parameter count of 100B and 6.1B activated parameters per token, achieving an optimal balance between inference performance and computational cost.',
    displayName: 'Ling-2.6-flash',
    enabled: true,
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
    enabled: true,
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
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Ling-1T is a flagship trillion-parameter natural language model in the Bailing Mixture-of-Experts (MoE) architecture series, pre-trained on over 20T high-quality tokens. As one of the latest released open-source models at the trillion-parameter scale, it delivers strong performance across a wide range of benchmarks. It is well-suited as a next-generation open foundation model, offering excellent usability and a superior overall user experience.',
    displayName: 'Ling-1T',
    id: 'Ling-1T',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-04',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

export default antgroupChatModels;
