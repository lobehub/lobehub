import { describe, expect, it } from 'vitest';

import { AGENT_SIGNAL_ANALYZE_INTENT_FEEDBACK_SATISFACTION_SYSTEM_ROLE } from './feedbackSatisfaction';
import { AGENT_SIGNAL_ANALYZE_INTENT_GATE_SYSTEM_ROLE } from './gate';
import {
  AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE,
  createAgentSignalAnalyzeIntentRoutePrompt,
} from './route';

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

  /**
   * @example
   * A short feedback message like "use this workflow next time" must be judged
   * with nearby conversation context, otherwise the route step cannot see the
   * reusable workflow the user is referring to.
   */
  it('includes serialized context and rules for implicit reusable workflow feedback', () => {
    const prompt = createAgentSignalAnalyzeIntentRoutePrompt({
      evidence: [{ cue: '这种方式', excerpt: '以后都用这种方式做吧。' }],
      message: '以后都用这种方式做吧。',
      reason: 'positive reusable workflow reinforcement',
      result: 'satisfied',
      serializedContext:
        '<feedback_analysis_context><conversation><message role="assistant">Used web browsing to review the GitHub PR.</message></conversation></feedback_analysis_context>',
    });

    expect(prompt).toContain('serializedContext=');
    expect(prompt).toContain('Used web browsing to review the GitHub PR');
    expect(AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE).toContain(
      'If the feedback refers to "this way"',
    );
    expect(AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE).toContain(
      'recent context contains a reusable multi-step workflow',
    );
  });
});
