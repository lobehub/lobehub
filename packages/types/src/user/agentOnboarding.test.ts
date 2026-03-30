import { describe, expect, it } from 'vitest';

import { SaveUserQuestionInputSchema, UserAgentOnboardingContextSchema } from './agentOnboarding';

describe('SaveUserQuestionInputSchema', () => {
  it('accepts the flat structured payload', () => {
    const parsed = SaveUserQuestionInputSchema.parse({
      fullName: 'Ada Lovelace',
      interests: ['AI tooling'],
      responseLanguage: 'en-US',
    });

    expect(parsed).toEqual({
      fullName: 'Ada Lovelace',
      interests: ['AI tooling'],
      responseLanguage: 'en-US',
    });
  });

  it('rejects the old node-scoped payload', () => {
    expect(() => SaveUserQuestionInputSchema.parse({ updates: [] })).toThrow();
  });
});

describe('UserAgentOnboardingContextSchema', () => {
  it('accepts the minimal onboarding context', () => {
    const parsed = UserAgentOnboardingContextSchema.parse({
      finished: false,
      missingStructuredFields: ['fullName', 'responseLanguage'],
      phase: 'user_identity',
      topicId: 'topic-1',
      version: 2,
    });

    expect(parsed).toEqual({
      finished: false,
      missingStructuredFields: ['fullName', 'responseLanguage'],
      phase: 'user_identity',
      topicId: 'topic-1',
      version: 2,
    });
  });
});
