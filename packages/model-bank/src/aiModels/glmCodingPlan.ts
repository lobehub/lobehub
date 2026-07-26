import { type AIChatModelCard } from '../types/aiModel';

// ref: https://docs.bigmodel.cn/cn/coding-plan/overview
// Models synced from https://models.dev/api.json → zhipuai-coding-plan

const glmCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_000_000,
    description: 'Open flagship GLM for long-horizon coding agents and million-token context work',
    displayName: 'GLM-5.2',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.2',
    id: 'glm-5.2',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2026-06-13',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["high", "max"]}]
      extendParams: ['glm5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 200_000,
    description: 'Flagship GLM model for hybrid reasoning, coding, and agentic engineering',
    displayName: 'GLM-5.1',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.1',
    id: 'glm-5.1',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2026-03-27',
    settings: {
      // reasoning_options: [{"type": "toggle"}]
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 200_000,
    description: 'Efficient GLM model for fast reasoning, coding, and agent workflows',
    displayName: 'GLM-5-Turbo',
    enabled: false,
    family: 'glm',
    generation: 'glm-5',
    id: 'glm-5-turbo',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2026-03-16',
    settings: {
      // reasoning_options: [{"type": "toggle"}]
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 200_000,
    description: 'GLM vision model for visual reasoning, documents, and multimodal agents',
    displayName: 'GLM-5V-Turbo',
    enabled: false,
    family: 'glm',
    generation: 'glm-5',
    id: 'glm-5v-turbo',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2026-04-01',
    settings: {
      // reasoning_options: [{"type": "toggle"}]
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'Flagship GLM model for hybrid reasoning, coding, and agentic engineering',
    displayName: 'GLM-4.7',
    enabled: false,
    family: 'glm',
    generation: 'glm-4.7',
    id: 'glm-4.7',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2025-12-22',
    settings: {
      // reasoning_options: [{"type": "toggle"}]
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 128_000,
    description: 'GLM vision model for visual reasoning, documents, and multimodal agents',
    displayName: 'GLM-4.6V',
    enabled: false,
    family: 'glm',
    generation: 'glm-4.6',
    id: 'glm-4.6v',
    maxOutput: 32_768,
    organization: 'Zhipu',
    releasedAt: '2025-12-08',
    settings: {
      // reasoning_options: [{"type": "toggle"}]
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 131_072,
    description: 'Efficient GLM model for fast reasoning, coding, and agent workflows',
    displayName: 'GLM-4.5-Air',
    enabled: false,
    family: 'glm',
    generation: 'glm-4.5',
    id: 'glm-4.5-air',
    maxOutput: 98_304,
    organization: 'Zhipu',
    releasedAt: '2025-07-28',
    settings: {
      // reasoning_options: [{"type": "toggle"}]
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
];

export default glmCodingPlanChatModels;
