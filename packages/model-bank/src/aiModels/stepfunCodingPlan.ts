import { type AIChatModelCard } from '../types/aiModel';

// ref: https://platform.stepfun.com/docs/zh/step-plan/integrations/cherry-studio

const stepfunCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Step 3.5 Flash is a fast, sharp, and reliable agentic intelligence model optimized for coding tasks.',
    displayName: 'Step 3.5 Flash',
    enabled: true,
    id: 'step-3.5-flash',
    maxOutput: 131_072,
    organization: 'StepFun',
    releasedAt: '2026-02-12',
    type: 'chat',
  },
];

export default stepfunCodingPlanChatModels;
