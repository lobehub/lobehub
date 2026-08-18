import { describe, expect, it } from 'vitest';

import {
  AGENT_SIGNAL_SKILL_INTENT_JSON_SCHEMA,
  AGENT_SIGNAL_SKILL_INTENT_PROMPT_VERSION,
  chainAgentSignalSkillIntent,
} from './skillIntent';

describe('agent signal skill intent prompt', () => {
  /**
   * @example
   * Skill intent classifier messages include serialized context and strict route labels.
   */
  it('renders classifier messages', () => {
    expect(
      chainAgentSignalSkillIntent({
        message: 'For future PR reviews, reuse this checklist.',
        serializedContext: 'topic=PR review; checklist: inspect locale keys',
        topicLabel: 'PR review',
      }),
    ).toMatchSnapshot();
    expect(AGENT_SIGNAL_SKILL_INTENT_PROMPT_VERSION).toBe('v1');
    expect(AGENT_SIGNAL_SKILL_INTENT_JSON_SCHEMA.name).toBe('agent_signal_skill_intent');
  });
});
