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
   * Existing reusable checklist self-iteration should route to skill, while prompt
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
      'create, update, refine, merge, consolidate, deduplicate, or reorganize',
    );
    expect(AGENT_SIGNAL_ANALYZE_INTENT_FEEDBACK_SATISFACTION_SYSTEM_ROLE).toContain(
      'Create a reusable skill for future PR reviews',
    );
    expect(AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE).toContain(
      'Route to "skill" for explicit requests',
    );
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
      evidence: [{ cue: 'this workflow', excerpt: 'Use this workflow next time.' }],
      message: 'Use this workflow next time.',
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

  /**
   * @example
   * Future-scoped procedural reuse should route to skill, while personal style
   * and negative approach preferences remain memory candidates.
   */
  it('documents the memory versus skill boundary for future-scoped feedback', () => {
    expect(AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE).toContain(
      'future-scoped reuse of a concrete procedure',
    );
    expect(AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE).toContain(
      'Do not route to "memory" merely because the feedback contains future-oriented language',
    );
    expect(AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE).toContain(
      'For future database migration reviews',
    );
    expect(AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE).toContain(
      'This approach is not suitable',
    );
  });
});
