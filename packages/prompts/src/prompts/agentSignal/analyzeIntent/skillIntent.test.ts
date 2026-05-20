import { describe, expect, it } from 'vitest';

import { createAgentSignalAnalyzeIntentSkillIntentMessages } from './skillIntent';

describe('agent signal skill intent prompt', () => {
  /**
   * @example
   * Skill intent classifier messages include serialized context and strict route labels.
   */
  it('renders classifier messages', () => {
    expect(
      createAgentSignalAnalyzeIntentSkillIntentMessages({
        message: 'For future PR reviews, reuse this checklist.',
        serializedContext: 'topic=PR review; checklist: inspect locale keys',
        topicLabel: 'PR review',
      }),
    ).toMatchSnapshot();
  });
});
