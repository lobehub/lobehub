// @vitest-environment node
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import { describe, expect, it } from 'vitest';

import { AGENT_SIGNAL_POLICY_SIGNAL_TYPES } from './types';

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

describe('agent signal procedure type catalog', () => {
  /**
   * @example
   * expect(AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted).toBe('tool.outcome.completed');
   */
  it('exposes generic direct tool outcome source types', () => {
    expect(AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeCompleted).toBe('tool.outcome.completed');
    expect(AGENT_SIGNAL_SOURCE_TYPES.toolOutcomeFailed).toBe('tool.outcome.failed');
  });

  /**
   * @example
   * expect(AGENT_SIGNAL_POLICY_SIGNAL_TYPES.toolOutcome).toBe('signal.tool.outcome');
   */
  it('exposes procedure policy signal types', () => {
    expect(AGENT_SIGNAL_POLICY_SIGNAL_TYPES.toolOutcome).toBe('signal.tool.outcome');
    expect(AGENT_SIGNAL_POLICY_SIGNAL_TYPES.procedureBucketScored).toBe(
      'signal.procedure.bucket.scored',
    );
  });
});
