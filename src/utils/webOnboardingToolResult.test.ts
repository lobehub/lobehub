import {
  createWebOnboardingToolResult,
  formatWebOnboardingStateMessage,
} from '@lobechat/builtin-tool-web-onboarding/utils';
import { describe, expect, it } from 'vitest';

describe('web onboarding tool result helpers', () => {
  it('keeps tool action content message-first', () => {
    const result = createWebOnboardingToolResult({
      content: 'Saved full name and interests.',
      savedFields: ['fullName', 'interests'],
      success: true,
    });

    expect(result.content).toBe('Saved full name and interests.');
    expect(result.state).toEqual({
      isError: false,
      savedFields: ['fullName', 'interests'],
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
      'Questioning rule: prefer the `lobe-user-interaction____askUserQuestion` tool call for structured collection or explicit UI input. For natural exploratory questions, plain text is allowed.',
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

    expect(message).toContain('Discovery progress: 1/4 user exchange(s) observed');
    expect(message).toContain('Recommended: 3 more user exchange(s) before moving to summary.');
    expect(message).toContain('Phase: Discovery');
  });

  it('formats target-reached discovery progress when remaining discovery exchanges is 0', () => {
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
    expect(message).toContain(
      'Discovery progress: recommended target reached after 4 user exchange(s).',
    );
  });
});
