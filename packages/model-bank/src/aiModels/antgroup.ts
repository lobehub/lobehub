import { type AIChatModelCard } from '../types/aiModel';

const antgroupChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
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
      functionCall: true,
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
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
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
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'It is a high-performance reasoning model deeply optimized based on the Ling-flash-2.0 MoE architecture. With 100B total parameters, it activates only 6.1B parameters per inference, enabling sparse and highly efficient execution for each reasoning task. Through the proprietary IcePop algorithm, the model addresses the instability challenges in MoE reinforcement learning training, allowing its complex reasoning capabilities to continuously improve over long training horizons. The model achieves breakthroughs across multiple high-difficulty benchmarks, including mathematical competitions, code generation, and logical reasoning, outperforming dense models below the 40B parameter scale. It also demonstrates a relatively rare strength among reasoning models: strong creative writing capabilities.',
    displayName: 'Ring-flash-2.0',
    id: 'Ring-flash-2.0',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-23',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'It is a high-performance reasoning model deeply optimized based on the Ling-mini-2.0 MoE architecture. The model demonstrates strong performance in logical reasoning, coding, and mathematical tasks. In addition, it is characterized by both speed and efficiency: it supports up to a 128K context window with generation speeds exceeding 300 tokens per second, and with a total of 16B parameters—activating only 1.4B per inference—it achieves overall reasoning capability comparable to dense models under the 10B scale. This makes it an optimal choice for reasoning tasks in resource-constrained environments.',
    displayName: 'Ring-mini-2.0',
    id: 'Ring-mini-2.0',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-23',
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
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-04',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'It is a general-purpose model based on the Ling 2.0 MoE architecture. Leveraging a sparse MoE design—with a total parameter scale of 100B, activating 6.1B parameters per token (4.8B excluding embeddings)—the model delivers exceptional cost-performance and strong overall capabilities across most language model use cases. Despite its relatively lightweight configuration, the model demonstrates performance comparable to or even surpassing 40B-scale dense models and larger MoE models on multiple authoritative benchmarks.',
    displayName: 'Ling-flash-2.0',
    id: 'Ling-flash-2.0',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-26',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'A small-scale, high-performance large language model based on a Mixture-of-Experts (MoE) architecture. It has a total of 16B parameters, while activating only 1.4B parameters per token (789M excluding embeddings), enabling extremely high generation speed. Thanks to its efficient MoE design and large-scale high-quality training data, the model delivers top-tier performance on downstream tasks. Despite activating only 1.4B parameters, it achieves results comparable to dense LLMs under 10B parameters as well as larger-scale MoE models.',
    displayName: 'Ling-mini-2.0',
    id: 'Ling-mini-2.0',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-29',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'The Ant Group’s AntAngel Medical Large Language Model (AntAngelMed), designed to be more medically knowledgeable and better at reasoning, has officially been released. As the largest open-source medical large language model in terms of parameter scale, it is not only highly knowledgeable but also equipped with clinician-like reasoning capabilities. Whether for symptom analysis, health consultations, or medical education, AntAngelMed can deliver a more professional and reliable medical dialogue experience.',
    displayName: 'AntAngelMed',
    enabled: true,
    id: 'AntAngelMed',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-10',
    type: 'chat',
  },
];

export default antgroupChatModels;
