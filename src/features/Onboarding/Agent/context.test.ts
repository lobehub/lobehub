import { describe, expect, it } from 'vitest';

import { resolveAgentOnboardingContext } from './context';

describe('resolveAgentOnboardingContext', () => {
  it('prefers the bootstrap topic id when available', () => {
    const result = resolveAgentOnboardingContext({
      bootstrapContext: {
        agentOnboarding: {
          activeTopicId: 'topic-bootstrap',
          version: 1,
        },
        context: {
          finished: false,
          missingStructuredFields: ['interests'],
          phase: 'discovery',
          topicId: 'topic-bootstrap',
          version: 1,
        },
        topicId: 'topic-bootstrap',
      },
      storedAgentOnboarding: {
        activeTopicId: 'topic-store',
        version: 1,
      },
    });

    expect(result).toEqual({
      topicId: 'topic-bootstrap',
    });
  });

  it('falls back to the stored onboarding topic id when bootstrap data is absent', () => {
    const result = resolveAgentOnboardingContext({
      storedAgentOnboarding: {
        activeTopicId: 'topic-store',
        version: 1,
      },
    });

    expect(result).toEqual({
      topicId: 'topic-store',
    });
  });
});
