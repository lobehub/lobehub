import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRole } from './systemRole';

const modelConfig = DEFAULT_SYSTEM_AGENT_CONFIG.memoryAnalysisAgentConfig;

export const ONBOARDING_UNDERSTANDING: BuiltinAgentDefinition = {
  persist: {
    chatConfig: {
      enableAgentMode: false,
      searchMode: 'off',
      toolMode: 'custom',
    },
    model: modelConfig.model,
    provider: modelConfig.provider,
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
  slug: BUILTIN_AGENT_SLUGS.onboardingUnderstanding,
};
