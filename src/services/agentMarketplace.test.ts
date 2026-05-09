import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchOnboardingAgentTemplates } from './agentMarketplace';

const mocks = vi.hoisted(() => ({
  getOnboardingFull: vi.fn(),
}));

vi.mock('i18next', () => ({
  default: {
    language: 'en-US',
    resolvedLanguage: 'zh',
  },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    market: {
      agent: {
        getOnboardingFull: {
          query: mocks.getOnboardingFull,
        },
      },
    },
  },
}));

describe('fetchOnboardingAgentTemplates', () => {
  beforeEach(() => {
    mocks.getOnboardingFull.mockReset();
  });

  it('requests onboarding marketplace templates with the normalized current locale', async () => {
    const signal = new AbortController().signal;
    mocks.getOnboardingFull.mockResolvedValue({
      engineering: [
        {
          description: 'Helps with code',
          identifier: 'agent-template-engineer',
          name: 'Engineer',
        },
      ],
    });

    const result = await fetchOnboardingAgentTemplates({ signal });

    expect(mocks.getOnboardingFull).toHaveBeenCalledWith({ locale: 'zh-CN' }, { signal });
    expect(result).toEqual([
      {
        category: 'engineering',
        description: 'Helps with code',
        id: 'agent-template-engineer',
        title: 'Engineer',
      },
    ]);
  });
});
