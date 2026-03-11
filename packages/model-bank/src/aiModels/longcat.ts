import type { AIChatModelCard } from '../types/aiModel';

const longcatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 327_680,
    description:
      'The LongCat-Flash-Lite model has been officially released. It adopts an efficient Mixture-of-Experts (MoE) architecture, with 68.5 billion total parameters and approximately 3 billion activated parameters. Through the use of an N-gram embedding table, it achieves highly efficient parameter utilization, and it is deeply optimized for inference efficiency and specific application scenarios. Compared to models of a similar scale, its core features are as follows:Outstanding Inference Efficiency: By leveraging the N-gram embedding table to fundamentally alleviate the I/O bottleneck inherent in MoE architectures, combined with dedicated caching mechanisms and kernel-level optimizations, it significantly reduces inference latency and improves overall efficiency. Strong Agent and Code Performance: It demonstrates highly competitive capabilities in tool invocation and software development tasks, delivering exceptional performance relative to its model size.',
    displayName: 'LongCat-Flash-Lite',
    enabled: true,
    id: 'LongCat-Flash-Lite',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'The LongCat-Flash-Thinking-2601 model has been officially released. As an upgraded reasoning model built on a Mixture-of-Experts (MoE) architecture, it features a total of 560 billion parameters. While maintaining strong competitiveness across traditional reasoning benchmarks, it systematically enhances Agent-level reasoning capabilities through large-scale multi-environment reinforcement learning. Compared to the LongCat-Flash-Thinking model, the key upgrades are as follows: Extreme Robustness in Noisy Environments: Through systematic curriculum-style training targeting noise and uncertainty in real-world settings, the model demonstrates outstanding performance in Agent tool invocation, Agent-based search, and tool-integrated reasoning, with significantly improved generalization. Powerful Agent Capabilities: By constructing a tightly coupled dependency graph encompassing more than 60 tools, and scaling training through multi-environment expansion and large-scale exploratory learning, the model markedly improves its ability to generalize to complex and out-of-distribution real-world scenarios. Advanced Deep Thinking Mode: It expands the breadth of reasoning via parallel inference and deepens analytical capability through recursive feedback-driven summarization and abstraction mechanisms, effectively addressing highly challenging problems.',
    displayName: 'LongCat-Flash-Thinking-2601',
    enabled: true,
    id: 'LongCat-Flash-Thinking-2601',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'LongCat-Flash-Thinking has been officially released and open-sourced simultaneously. It is a deep reasoning model that can be used for free conversations within LongCat Chat, or accessed via API by specifying model=LongCat-Flash-Thinking.',
    displayName: 'LongCat-Flash-Thinking',
    id: 'LongCat-Flash-Thinking',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-22',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'The LongCat-Flash-Chat model has been upgraded to a new version. This update involves enhancements to model capabilities only; the model name and API invocation method remain unchanged. Building upon its hallmark “extreme efficiency” and “lightning-fast response,” the new version further strengthens contextual understanding and real-world programming performance: Significantly Enhanced Coding Capabilities: Deeply optimized for developer-centric scenarios, the model delivers substantial improvements in code generation, debugging, and explanation tasks. Developers are strongly encouraged to evaluate and benchmark these enhancements. Support for 256K Ultra-Long Context: The context window has doubled from the previous generation (128K) to 256K, enabling efficient processing of massive documents and long-sequence tasks. Comprehensively Improved Multilingual Performance: Provides strong support for nine languages, including Spanish, French, Arabic, Portuguese, Russian, and Indonesian. More Powerful Agent Capabilities: Demonstrates greater robustness and efficiency in complex tool invocation and multi-step task execution.',
    displayName: 'LongCat-Flash-Chat',
    enabled: true,
    id: 'LongCat-Flash-Chat',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-12',
    type: 'chat',
  },
];

export const allModels = [...longcatModels];

export default allModels;
