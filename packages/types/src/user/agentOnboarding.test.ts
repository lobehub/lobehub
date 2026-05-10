import { describe, expect, it } from 'vitest';

import { SaveUserQuestionInputSchema, UserAgentOnboardingContextSchema } from './agentOnboarding';

describe('SaveUserQuestionInputSchema', () => {
  it('accepts the flat structured payload', () => {
    const parsed = SaveUserQuestionInputSchema.parse({
      fullName: 'Ada Lovelace',
      customInterests: ['AI tooling'],
      interests: ['coding'],
    });

    expect(parsed).toEqual({
      customInterests: ['AI tooling'],
      fullName: 'Ada Lovelace',
      interests: ['coding'],
    });
  });

  it('rejects the old node-scoped payload', () => {
    expect(() => SaveUserQuestionInputSchema.parse({ updates: [] })).toThrow();
  });

  it('treats empty and whitespace strings as missing', () => {
    const parsed = SaveUserQuestionInputSchema.parse({
      agentEmoji: '',
      agentName: '   ',
      fullName: 'Ada Lovelace',
    });

    expect(parsed).toEqual({ fullName: 'Ada Lovelace' });
  });

  it('drops empty interests entries and an all-empty array', () => {
    const partial = SaveUserQuestionInputSchema.parse({
      customInterests: ['AI tooling', '', '   '],
      interests: ['coding', '', '   '],
    });
    expect(partial).toEqual({ customInterests: ['AI tooling'], interests: ['coding'] });

    const allEmpty = SaveUserQuestionInputSchema.parse({
      customInterests: ['', '   '],
      fullName: 'Ada',
      interests: ['', '   '],
    });
    expect(allEmpty).toEqual({ fullName: 'Ada' });
  });

  it('accepts a fully empty object as a no-op', () => {
    expect(SaveUserQuestionInputSchema.parse({})).toEqual({});
  });
});

describe('UserAgentOnboardingContextSchema', () => {
  it('accepts the minimal onboarding context', () => {
    const parsed = UserAgentOnboardingContextSchema.parse({
      finished: false,
      missingStructuredFields: ['fullName', 'interests'],
      phase: 'user_identity',
      topicId: 'topic-1',
      version: 2,
    });

    expect(parsed).toEqual({
      finished: false,
      missingStructuredFields: ['fullName', 'interests'],
      phase: 'user_identity',
      topicId: 'topic-1',
      version: 2,
    });
  });
});
