import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { getAgentPersistConfig, getAgentRuntimeConfig } from '../../index';
import { BUILTIN_AGENT_SLUGS } from '../../types';

describe('ONBOARDING_UNDERSTANDING', () => {
  it('is registered on the memory-analysis mini model', () => {
    expect(getAgentPersistConfig(BUILTIN_AGENT_SLUGS.onboardingUnderstanding)).toMatchObject({
      model: DEFAULT_SYSTEM_AGENT_CONFIG.memoryAnalysisAgentConfig.model,
      provider: DEFAULT_SYSTEM_AGENT_CONFIG.memoryAnalysisAgentConfig.provider,
      slug: 'onboarding-understanding',
    });
  });

  it('has no tools, memory, search, or ambient agent mode', () => {
    const runtime = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.onboardingUnderstanding, {
      plugins: ['gmail', 'lobe-web-browsing'],
    });

    expect(runtime).toMatchObject({
      agencyConfig: { executionTarget: 'none' },
      chatConfig: {
        enableAgentMode: false,
        memory: { enabled: false },
        searchMode: 'off',
        toolMode: 'custom',
      },
      plugins: [],
    });
    expect(runtime?.systemRole).toContain('explicit self-description');
    expect(runtime?.systemRole).toContain('Never infer pronouns');
  });
});
