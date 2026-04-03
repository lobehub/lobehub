import {
  createWebOnboardingToolResult,
  formatWebOnboardingStateMessage,
} from '@lobechat/builtin-tool-web-onboarding/utils';
import { describe, expect, it } from 'vitest';

describe('web onboarding tool result helpers', () => {
  it('keeps tool action content message-first', () => {
    const result = createWebOnboardingToolResult({
      content: 'Saved interests and response language.',
      savedFields: ['interests', 'responseLanguage'],
      success: true,
    });

    expect(result.content).toBe('Saved interests and response language.');
    expect(result.state).toEqual({
      isError: false,
      savedFields: ['interests', 'responseLanguage'],
      success: true,
    });
    expect(result.content.trim().startsWith('{')).toBe(false);
  });

  it('formats onboarding state as a plain-language summary', () => {
    const message = formatWebOnboardingStateMessage({
      finished: false,
      missingStructuredFields: ['interests'],
      phase: 'discovery',
      topicId: 'topic-1',
      version: 1,
    });

    expect(message).toContain('Structured fields still needed: interests.');
    expect(message).toContain('Phase: Discovery');
    expect(message).toContain(
      'Questioning rule: use `lobe-user-interaction________builtin` tool for structured collection or explicit UI input. For natural exploratory questions, plain text is allowed.',
    );
  });

  it('includes pacing hint when remaining discovery exchanges > 0', () => {
    const message = formatWebOnboardingStateMessage({
      discoveryUserMessageCount: 1,
      finished: false,
      missingStructuredFields: [],
      phase: 'discovery',
      remainingDiscoveryExchanges: 3,
      topicId: 'topic-1',
      version: 1,
    });

    expect(message).toContain('Recommended: 3 more user exchange(s) before moving to summary.');
    expect(message).toContain('Phase: Discovery');
  });

  it('omits pacing hint when remaining discovery exchanges is 0', () => {
    const message = formatWebOnboardingStateMessage({
      discoveryUserMessageCount: 4,
      finished: false,
      missingStructuredFields: [],
      phase: 'summary',
      remainingDiscoveryExchanges: 0,
      topicId: 'topic-1',
      version: 1,
    });

    expect(message).not.toContain('more user exchange(s) before moving to summary');
  });
});
