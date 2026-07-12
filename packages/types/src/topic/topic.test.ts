import { describe, expect, it } from 'vitest';

import { chatTopicMetadataUpdateSchema } from './topic';

describe('chatTopicMetadataUpdateSchema', () => {
  it('parses a scheduled heterogeneous continuation patch', () => {
    const metadata = {
      scheduledRun: {
        createdAt: '2026-07-12T00:00:00.000Z',
        failedAssistantMessageId: 'assistant-1',
        rateLimit: { rateLimitType: 'seven_day', resetsAt: 1_800_000_000 },
        reason: 'rate_limit',
        resume: { sessionId: 'session-1', workingDirectory: '/repo' },
        source: 'heterogeneous_agent',
        updatedAt: '2026-07-12T00:00:00.000Z',
        userMessageId: 'user-1',
      },
    };

    expect(chatTopicMetadataUpdateSchema.parse(metadata)).toEqual(metadata);
    expect(chatTopicMetadataUpdateSchema.parse({ scheduledRun: null })).toEqual({
      scheduledRun: null,
    });
  });

  it('keeps the onboarding feedback comment limit at the shared contract boundary', () => {
    const result = chatTopicMetadataUpdateSchema.safeParse({
      onboardingFeedback: {
        comment: 'x'.repeat(501),
        rating: 'good',
        submittedAt: '2026-07-12T00:00:00.000Z',
      },
    });

    expect(result.success).toBe(false);
  });
});
