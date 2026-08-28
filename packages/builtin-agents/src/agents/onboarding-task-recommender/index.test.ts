import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { getAgentPersistConfig, getAgentRuntimeConfig } from '../../index';
import { BUILTIN_AGENT_SLUGS } from '../../types';

/** @example Recommendation generation runs as a dedicated isolated builtin agent. */
describe('ONBOARDING_TASK_RECOMMENDER', () => {
  /** @example Recommendation generation uses its independently configurable task model. */
  it('uses its dedicated system-agent task model', () => {
    expect(getAgentPersistConfig(BUILTIN_AGENT_SLUGS.onboardingTaskRecommender)).toMatchObject({
      model: DEFAULT_SYSTEM_AGENT_CONFIG.onboardingTaskRecommender.model,
      provider: DEFAULT_SYSTEM_AGENT_CONFIG.onboardingTaskRecommender.provider,
      slug: 'onboarding-task-recommender',
    });
  });

  /** @example Connector content cannot enable tools, memory, or browsing. */
  it('runs without tools, memory, search, or ambient agent mode', () => {
    const runtime = getAgentRuntimeConfig(BUILTIN_AGENT_SLUGS.onboardingTaskRecommender, {
      plugins: ['github', 'gmail'],
    });
    expect(runtime).toMatchObject({
      agencyConfig: { executionTarget: 'none' },
      chatConfig: { enableAgentMode: false, memory: { enabled: false }, searchMode: 'off' },
      plugins: [],
    });
    expect(runtime?.systemRole).toContain('untrusted evidence');
  });
});
