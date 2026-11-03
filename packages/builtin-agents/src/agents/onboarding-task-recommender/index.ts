import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRole } from './systemRole';

export const ONBOARDING_TASK_RECOMMENDER: BuiltinAgentDefinition = {
  persist: {
    chatConfig: {
      enableAgentMode: false,
      searchMode: 'off',
      toolMode: 'custom',
    },
    model: DEFAULT_SYSTEM_AGENT_CONFIG.onboardingTaskRecommender.model,
    provider: DEFAULT_SYSTEM_AGENT_CONFIG.onboardingTaskRecommender.provider,
  },
  runtime: {
    agencyConfig: { executionTarget: 'none' },
    chatConfig: {
      enableAgentMode: false,
      memory: { enabled: false },
      searchMode: 'off',
      toolMode: 'custom',
    },
    plugins: [],
    systemRole,
  },
  slug: BUILTIN_AGENT_SLUGS.onboardingTaskRecommender,
};
