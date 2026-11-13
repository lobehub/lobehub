import { type AIChatModelCard } from '../../types/aiModel';
import { zhipuImageModels, zhipuVideoModels } from './nonChat';

// USD price: https://docs.z.ai/guides/overview/pricing
// CNY price (cards z.ai does not sell): https://bigmodel.cn/pricing
// ref: https://docs.bigmodel.cn/cn/guide/start/model-overview

const zhipuChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Zhipu’s latest flagship model. Built on the same base as GLM-5.2, it scales post-training with tens of times more long-horizon task environments and substantially longer training cycles. Coding experience improves by about 50% over the previous generation, ranking first among open-source models on Terminal Bench 3.0. It also shows strong cybersecurity capability, approaching Mythos 5 on white-box code review and vulnerability discovery.',
    displayName: 'GLM-5.3',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.3',
    id: 'glm-5.3',
    isOfficial: true,
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-14',
    settings: {
      extendParams: ['glm5_3ReasoningEffort'],
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
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'GLM-5.3-Flash is the first natively multimodal GLM-5 model. It inherits the GLM-5.3 text contract with always-on thinking, adds image and video understanding, and lands coding quality close to the flagship at roughly one-tenth of the price.',
    displayName: 'GLM-5.3-Flash',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.3',
    id: 'glm-5.3-flash',
    isOfficial: true,
    maxOutput: 131_072,
    // List price; the 50% launch promo ends 2026-09-09, so it is intentionally not encoded here.
    // https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-26',
    settings: {
      extendParams: ['glm5_3ReasoningEffort', 'preserveThinking'],
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
    contextWindowTokens: 1_048_576,
    description:
      'GLM-5.2 is Zhipu’s flagship model for the era of long-horizon tasks. It supports a solid 1M context window that can hold project-scale engineering context, with more stable long-horizon execution and more reliable adherence to engineering conventions. A single task can complete the full development path from requirements to multi-platform deployable artifacts.',
    displayName: 'GLM-5.2',
    family: 'glm',
    generation: 'glm-5.2',
    id: 'glm-5.2',
    isOfficial: true,
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-17',
    settings: {
      extendParams: ['enableReasoning', 'glm5_2ReasoningEffort'],
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
    contextWindowTokens: 200_000,
    description:
      'GLM-5.1 is Zhipu’s latest flagship model, aligned with Claude Opus 4.6 on overall and coding capabilities. It excels at long-horizon tasks, able to autonomously plan, execute, and iterate for up to 8 hours in a single task, making it an ideal foundation for Autonomous Agents and long-horizon Coding Agents.',
    displayName: 'GLM-5.1',
    family: 'glm',
    generation: 'glm-5.1',
    id: 'glm-5.1',
    isOfficial: true,
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-27',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'GLM-5V-Turbo is Zhipu’s multimodal Coding foundation model for visual programming tasks. It natively handles images, video, text, and files, and is optimized for long-horizon planning, complex coding, and agent execution in multimodal workflows.',
    displayName: 'GLM-5V-Turbo',
    enabled: true,
    family: 'glm',
    generation: 'glm-5',
    id: 'glm-5v-turbo',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
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
    contextWindowTokens: 200_000,
    description:
      'GLM-5-Turbo is a foundation model deeply optimized for agentic scenarios. It has been specifically optimized for core requirements of agent tasks from the training phase, enhancing key capabilities such as tool invocation, command following, and long-chain execution. It is ideal for building high-performance agent assistants.',
    displayName: 'GLM-5-Turbo',
    family: 'glm',
    generation: 'glm-5',
    id: 'glm-5-turbo',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-15',
    settings: {
      extendParams: ['enableReasoning'],
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
    contextWindowTokens: 200_000,
    description:
      'GLM-5 is Zhipu’s next-generation flagship foundation model, purpose-built for Agentic Engineering. It delivers reliable productivity in complex systems engineering and long-horizon agentic tasks. In coding and agent capabilities, GLM-5 achieves state-of-the-art performance among open-source models. In real-world programming scenarios, its user experience approaches that of Claude Opus 4.5. It excels at complex systems engineering and long-horizon agent tasks, making it an ideal foundation model for general-purpose agent assistants.',
    displayName: 'GLM-5',
    family: 'glm',
    generation: 'glm-5',
    id: 'glm-5',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-12',
    settings: {
      extendParams: ['enableReasoning', 'preserveThinking'],
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
    contextWindowTokens: 200_000,
    description:
      "GLM-4.7 is Zhipu's latest flagship model, enhanced for Agentic Coding scenarios with improved coding capabilities, long-term task planning, and tool collaboration. It achieves leading performance among open-source models on multiple public benchmarks. General capabilities are improved with more concise and natural responses and more immersive writing. For complex agent tasks, instruction following during tool calls is stronger, and the frontend aesthetics and long-term task completion efficiency of Artifacts and Agentic Coding are further enhanced.",
    displayName: 'GLM-4.7',
    family: 'glm',
    generation: 'glm-4.7',
    id: 'glm-4.7',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.11, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-22',
    settings: {
      extendParams: ['enableReasoning', 'preserveThinking'],
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
    contextWindowTokens: 200_000,
    description:
      'GLM-4.7-Flash, as a 30B-level SOTA model, offers a new choice that balances performance and efficiency. It enhances coding capabilities, long-term task planning, and tool collaboration for Agentic Coding scenarios, achieving leading performance among open-source models of the same size in multiple current benchmark leaderboards. In executing complex intelligent agent tasks, it has stronger instruction compliance during tool calls, and further improves the aesthetics of front-end and the efficiency of long-term task completion for Artifacts and Agentic Coding.',
    displayName: 'GLM-4.7-Flash',
    enabled: true,
    family: 'glm',
    generation: 'glm-4.7',
    id: 'glm-4.7-flash',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-19',
    settings: {
      extendParams: ['enableReasoning'],
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
    contextWindowTokens: 200_000,
    description:
      'GLM-4.7-Flash, as a 30B-level SOTA model, offers a new choice that balances performance and efficiency. It enhances coding capabilities, long-term task planning, and tool collaboration for Agentic Coding scenarios, achieving leading performance among open-source models of the same size in multiple current benchmark leaderboards. In executing complex intelligent agent tasks, it has stronger instruction compliance during tool calls, and further improves the aesthetics of front-end and the efficiency of long-term task completion for Artifacts and Agentic Coding.',
    displayName: 'GLM-4.7-FlashX',
    family: 'glm',
    generation: 'glm-4.7',
    id: 'glm-4.7-flashx',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-19',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'The GLM-4.6V series represents a major iteration of the GLM family in the multimodal direction, comprising GLM-4.6V (flagship), GLM-4.6V-FlashX (lightweight and high-speed), and GLM-4.6V-Flash (fully free). It extends the training-time context window to 128k tokens, achieves state-of-the-art visual understanding accuracy at comparable parameter scales, and, for the first time, natively integrates Function Call (tool invocation) capabilities into the visual model architecture. This unifies the pipeline from “visual perception” to “executable actions,” providing a consistent technical foundation for multimodal agents in real-world production scenarios.',
    displayName: 'GLM-4.6V',
    family: 'glm',
    generation: 'glm-4.6',
    id: 'glm-4.6v',
    maxOutput: 32_768,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-08',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'The GLM-4.6V series represents a major iteration of the GLM family in the multimodal direction, comprising GLM-4.6V (flagship), GLM-4.6V-FlashX (lightweight and high-speed), and GLM-4.6V-Flash (fully free). It extends the training-time context window to 128k tokens, achieves state-of-the-art visual understanding accuracy at comparable parameter scales, and, for the first time, natively integrates Function Call (tool invocation) capabilities into the visual model architecture. This unifies the pipeline from “visual perception” to “executable actions,” providing a consistent technical foundation for multimodal agents in real-world production scenarios.',
    displayName: 'GLM-4.6V-FlashX',
    family: 'glm',
    generation: 'glm-4.6',
    id: 'glm-4.6v-flashx',
    maxOutput: 32_768,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.004, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-08',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'The GLM-4.6V series represents a major iteration of the GLM family in the multimodal direction, comprising GLM-4.6V (flagship), GLM-4.6V-FlashX (lightweight and high-speed), and GLM-4.6V-Flash (fully free). It extends the training-time context window to 128k tokens, achieves state-of-the-art visual understanding accuracy at comparable parameter scales, and, for the first time, natively integrates Function Call (tool invocation) capabilities into the visual model architecture. This unifies the pipeline from “visual perception” to “executable actions,” providing a consistent technical foundation for multimodal agents in real-world production scenarios.',
    displayName: 'GLM-4.6V-Flash',
    family: 'glm',
    generation: 'glm-4.6',
    id: 'glm-4.6v-flash',
    maxOutput: 32_768,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-08',
    settings: {
      extendParams: ['enableReasoning'],
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
    contextWindowTokens: 200_000,
    description:
      "Zhipu's latest flagship model GLM-4.6 (355B) fully surpasses its predecessors in advanced coding, long-text processing, reasoning, and agent capabilities. It particularly aligns with Claude Sonnet 4 in programming ability, becoming China's top Coding model.",
    displayName: 'GLM-4.6',
    family: 'glm',
    generation: 'glm-4.6',
    id: 'glm-4.6',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.11, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-08',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    description:
      'Zhipu’s next-generation MoE vision reasoning model has 106B total parameters with 12B active, achieving SOTA among similarly sized open-source multimodal models across image, video, document understanding, and GUI tasks.',
    displayName: 'GLM-4.5V',
    family: 'glm',
    generation: 'glm-4.5',
    id: 'glm-4.5v',
    maxOutput: 16_384,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.11, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
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
      'Zhipu flagship model with a switchable thinking mode, delivering open-source SOTA overall and up to 128K context.',
    displayName: 'GLM-4.5',
    family: 'glm',
    generation: 'glm-4.5',
    id: 'glm-4.5',
    maxOutput: 98_304,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.11, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
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
      'GLM-4.5 fast edition, delivering strong performance with generation speeds up to 100 tokens/sec.',
    displayName: 'GLM-4.5-X',
    family: 'glm',
    generation: 'glm-4.5',
    id: 'glm-4.5-x',
    maxOutput: 98_304,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.45, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
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
      'GLM-4.5 lightweight edition that balances performance and cost, with flexible hybrid thinking modes.',
    displayName: 'GLM-4.5-Air',
    family: 'glm',
    generation: 'glm-4.5',
    id: 'glm-4.5-air',
    maxOutput: 98_304,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
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
    description: 'GLM-4.5-Air fast edition with quicker responses for high-scale, high-speed use.',
    displayName: 'GLM-4.5-AirX',
    family: 'glm',
    generation: 'glm-4.5',
    id: 'glm-4.5-airx',
    maxOutput: 98_304,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.22, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    description:
      'GLM-4.1V-Thinking is the strongest known ~10B VLM, covering SOTA tasks like video understanding, image QA, subject solving, OCR, document and chart reading, GUI agents, frontend coding, and grounding. It even surpasses the 8x larger Qwen2.5-VL-72B on many tasks. With advanced RL, it uses chain-of-thought reasoning to improve accuracy and richness, outperforming traditional non-thinking models in both outcomes and explainability.',
    displayName: 'GLM-4.1V-Thinking-FlashX',
    family: 'glm',
    generation: 'glm-4.1',
    id: 'glm-4.1v-thinking-flashx',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    description:
      'GLM-4.1V-Thinking is the strongest known ~10B VLM, covering SOTA tasks like video understanding, image QA, subject solving, OCR, document and chart reading, GUI agents, frontend coding, and grounding. It even surpasses the 8x larger Qwen2.5-VL-72B on many tasks. With advanced RL, it uses chain-of-thought reasoning to improve accuracy and richness, outperforming traditional non-thinking models in both outcomes and explainability.',
    displayName: 'GLM-4.1V-Thinking-Flash',
    family: 'glm',
    generation: 'glm-4.1',
    id: 'glm-4.1v-thinking-flash',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 16_384,
    description:
      'GLM-Zero-Preview delivers strong complex reasoning, excelling in logic, math, and programming.',
    displayName: 'GLM-Zero-Preview',
    family: 'glm',
    generation: 'glm-zero',
    id: 'glm-zero-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description: 'Reasoning model with strong reasoning for tasks that require deep inference.',
    displayName: 'GLM-Z1-Air',
    family: 'glm',
    generation: 'glm-z1',
    id: 'glm-z1-air',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
    contextWindowTokens: 32_768,
    description: 'Ultra-fast reasoning with high reasoning quality.',
    displayName: 'GLM-Z1-AirX',
    family: 'glm',
    generation: 'glm-z1',
    id: 'glm-z1-airx',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
      'Fast and low-cost: Flash-enhanced with ultra-fast reasoning and higher concurrency.',
    displayName: 'GLM-Z1-FlashX',
    family: 'glm',
    generation: 'glm-z1',
    id: 'glm-z1-flashx',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
      'GLM-Z1 series provides strong complex reasoning, excelling in logic, math, and programming.',
    displayName: 'GLM-Z1-Flash',
    family: 'glm',
    generation: 'glm-z1',
    id: 'glm-z1-flash',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
    description: 'GLM-4-Flash is ideal for simple tasks: fastest and free.',
    displayName: 'GLM-4-Flash-250414',
    family: 'glm',
    generation: 'glm-4',
    id: 'glm-4-flash-250414',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
    description: 'GLM-4-FlashX is an enhanced Flash version with ultra-fast reasoning.',
    displayName: 'GLM-4-FlashX-250414',
    family: 'glm',
    generation: 'glm-4',
    id: 'glm-4-flashx',
    maxOutput: 4095,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
    contextWindowTokens: 1_024_000,
    description:
      'GLM-4-Long supports ultra-long inputs for memory-style tasks and large-scale document processing.',
    displayName: 'GLM-4-Long',
    family: 'glm',
    generation: 'glm-4',
    id: 'glm-4-long',
    maxOutput: 4095,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
      'GLM-4-Air is a high-value option with performance close to GLM-4, fast speed, and lower cost.',
    displayName: 'GLM-4-Air-250414',
    family: 'glm',
    generation: 'glm-4',
    id: 'glm-4-air-250414',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
    contextWindowTokens: 8192,
    description:
      'GLM-4-AirX is a more efficient GLM-4-Air variant with up to 2.6x faster reasoning.',
    displayName: 'GLM-4-AirX',
    family: 'glm',
    generation: 'glm-4',
    id: 'glm-4-airx',
    maxOutput: 4095,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
      'GLM-4-Plus is a high-intelligence flagship with strong long-text and complex-task handling and upgraded overall performance.',
    displayName: 'GLM-4-Plus',
    family: 'glm',
    generation: 'glm-4',
    id: 'glm-4-plus',
    maxOutput: 4095,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
      'GLM-4-0520 is the latest model version, designed for highly complex and diverse tasks with excellent performance.',
    displayName: 'GLM-4-0520',
    id: 'glm-4-0520', // Deprecation date: December 30, 2025
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 4096,
    description:
      'GLM-4V-Flash focuses on efficient single-image understanding for fast analysis scenarios such as real-time or batch image processing.',
    displayName: 'GLM-4V-Flash',
    family: 'glm',
    generation: 'glm-4',
    id: 'glm-4v-flash',
    maxOutput: 1024,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-09',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 16_000,
    description:
      'GLM-4V-Plus understands video and multiple images, suitable for multimodal tasks.',
    displayName: 'GLM-4V-Plus-0111',
    family: 'glm',
    generation: 'glm-4',
    id: 'glm-4v-plus-0111',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 4096,
    description: 'GLM-4V provides strong image understanding and reasoning across visual tasks.',
    displayName: 'GLM-4V',
    family: 'glm',
    generation: 'glm-4',
    id: 'glm-4v',
    maxOutput: 1024,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 50, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 50, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'CodeGeeX-4 is a powerful AI coding assistant that supports multilingual Q&A and code completion to boost developer productivity.',
    displayName: 'CodeGeeX-4',
    family: 'codegeex',
    id: 'codegeex-4',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'CharGLM-4 is built for roleplay and emotional companionship, supporting ultra-long multi-turn memory and personalized dialogue.',
    displayName: 'CharGLM-4',
    family: 'charglm',
    id: 'charglm-4',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Emohaa is a mental health model with professional counseling abilities to help users understand emotional issues.',
    displayName: 'Emohaa',
    family: 'emohaa',
    id: 'emohaa',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...zhipuChatModels, ...zhipuImageModels, ...zhipuVideoModels];

export default allModels;
