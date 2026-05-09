import { describe, expect, it } from 'vitest';

import {
  AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE,
  createAgentSignalNightlyReviewMessages,
} from './nightlyReview';

describe('agent signal nightly review prompt', () => {
  /**
   * @example
   * The prompt keeps automatic mutations constrained to explicit low-risk maintenance.
   */
  it('documents the auto-apply boundary for nightly maintenance', () => {
    expect(AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE).toContain(
      'Use noop for ordinary successful days',
    );
    expect(AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE).toContain(
      'Auto-safe memory candidates must be explicit',
    );
    expect(AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE).toContain(
      'Consolidation should stay proposal_only',
    );
  });

  /**
   * @example
   * The prompt starts from maintenance signals and forbids model-side reclassification.
   */
  it('documents the structured maintenance signal boundary', () => {
    const [system] = createAgentSignalNightlyReviewMessages({ maintenanceSignals: [] });

    expect(system.content).toContain('Start from maintenanceSignals');
    expect(system.content).toContain('Do not re-judge satisfaction');
    expect(system.content).toContain('Tool activity alone must not trigger skill consolidation');
    expect(system.content).toContain('Use receiptActivity to avoid duplicate or stale proposals');
  });

  /**
   * @example
   * A private-safe bounded digest is sent as the user message beside the stable system role.
   */
  it('builds structured generation messages from bounded review context', () => {
    const messages = createAgentSignalNightlyReviewMessages({
      agentId: 'agent-1',
      topics: [{ summary: 'User explicitly prefers concise PR summaries.' }],
    });

    expect(messages).toEqual([
      {
        content: AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE,
        role: 'system',
      },
      {
        content:
          '{"agentId":"agent-1","topics":[{"summary":"User explicitly prefers concise PR summaries."}]}',
        role: 'user',
      },
    ]);
  });
});
