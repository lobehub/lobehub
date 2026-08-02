import { describe, expect, it } from 'vitest';

import {
  chainOnboardingTaskRecommendation,
  DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG,
} from './onboardingTaskRecommendation';

/** @example Onboarding task prompts preserve evidence boundaries and autonomous work policy. */
describe('chainOnboardingTaskRecommendation', () => {
  /** @example GitHub guidance and evidence produce an isolated system/user message pair. */
  it('combines shared policy, provider few-shots, and delimited evidence', () => {
    const messages = chainOnboardingTaskRecommendation({
      context: '{"pullRequest":1}',
      guide: DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG.providers.github,
      limit: 3,
      providerId: 'github',
      responseLanguage: 'en-US',
      writingGuide: DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG.writing,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain('Return at most 3 recommendations.');
    expect(messages[0].content).toContain('Never comment, submit a review, approve');
    expect(messages[0].content).toContain('Title: Analyze mobile lifecycle risk');
    expect(messages[1].content).toContain('<connector-evidence provider="github">');
    expect(messages[1].content).toContain('{"pullRequest":1}');
  });

  /** @example Gmail guidance keeps side effects behind later user approval. */
  it('keeps mail recommendations read-only by default', () => {
    const { providers, writing } = DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG;

    expect(providers.gmail.principles.join('\n')).toContain(
      'Never unsubscribe, send, archive, or delete',
    );
    expect(writing.instructionPrinciples.join('\n')).toContain('finish asynchronously');
    expect(writing.instructionPrinciples.join('\n')).toContain(
      'require a later explicit user-approved action',
    );
  });
});
