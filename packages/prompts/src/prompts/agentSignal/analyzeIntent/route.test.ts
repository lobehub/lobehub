import { describe, expect, it } from 'vitest';

import { AGENT_SIGNAL_ANALYZE_INTENT_FEEDBACK_SATISFACTION_SYSTEM_ROLE } from './feedbackSatisfaction';
import { AGENT_SIGNAL_ANALYZE_INTENT_GATE_SYSTEM_ROLE } from './gate';
import { AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE } from './route';

describe('agent signal analyze-intent route prompt', () => {
  /**
   * @example
   * Existing reusable checklist maintenance should route to skill, while prompt
   * remains reserved for assistant self-rules.
   */
  it('keeps prompt lane limited to assistant self-rules and routes reusable artifacts to skill', () => {
    expect(AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE).toContain(
      'only when the feedback is clearly about the assistant',
    );
    expect(AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE).toContain(
      'Route to "skill", not "prompt"',
    );
    expect(AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE).toContain(
      'The PR review checklist and release-risk checklist overlap',
    );
    expect(AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE).toContain(
      'Create a reusable skill for future PR reviews',
    );
    expect(AGENT_SIGNAL_ANALYZE_INTENT_FEEDBACK_SATISFACTION_SYSTEM_ROLE).toContain(
      'Create a reusable skill for future PR reviews',
    );
    expect(AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE).toContain('这个 review 流程挺好');
    expect(AGENT_SIGNAL_ANALYZE_INTENT_FEEDBACK_SATISFACTION_SYSTEM_ROLE).toContain(
      '这个 review 流程挺好',
    );
    expect(AGENT_SIGNAL_ANALYZE_INTENT_GATE_SYSTEM_ROLE).toContain('这个 review 流程挺好');
  });
});
