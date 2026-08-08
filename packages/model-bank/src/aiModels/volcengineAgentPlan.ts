import { type AIChatModelCard } from '../types/aiModel';

// ref: https://www.volcengine.com/docs/82379/1925114

const volcengineAgentPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-2.0-mini',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-2.0-mini is A lightweight, balanced multimodal model that supports understanding across four modalities—text, images, speech, and video—as well as cross-modal reasoning.',
    displayName: 'Doubao Seed 2.0 mini',
    enabled: true,
    family: 'doubao',
    id: 'doubao-seed-2.0-mini',
    maxOutput: 128_000,
    releasedAt: '2026-02-15',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-2.0-lite',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-2.0-lite is A lightweight multimodal model that supports cross-modal joint understanding across four modalities: text, images, speech, and video.',
    displayName: 'Doubao Seed 2.0 lite',
    enabled: true,
    family: 'doubao',
    id: 'doubao-seed-2.0-lite',
    maxOutput: 128_000,
    releasedAt: '2026-02-15',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
];

export default volcengineAgentPlanChatModels;
