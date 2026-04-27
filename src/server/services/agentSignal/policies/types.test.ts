// @vitest-environment node
import { describe, expect, it } from 'vitest';

describe('agent signal policy ids', () => {
  it('co-locates runtime ids with the policy type definitions', async () => {
    const {
      AGENT_SIGNAL_POLICIES,
      AGENT_SIGNAL_POLICY_ACTION_TYPES,
      AGENT_SIGNAL_POLICY_SIGNAL_TYPES,
    } = await import('./types');

    expect(AGENT_SIGNAL_POLICIES.feedbackActionPlanner).toBe('feedback-action-planner');
    expect(AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainMemory).toBe(
      'signal.feedback.domain.memory',
    );
    expect(AGENT_SIGNAL_POLICY_SIGNAL_TYPES.feedbackDomainPrompt).toBe(
      'signal.feedback.domain.prompt',
    );
    expect(AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle).toBe('action.user-memory.handle');
  });
});
