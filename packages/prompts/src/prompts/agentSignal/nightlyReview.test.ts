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
    expect(AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE).toContain('Noop is silent maintenance state');
    expect(AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE).toContain(
      'Auto-safe memory candidates must be explicit',
    );
    expect(AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE).toContain(
      'A durable_user_preference signal means',
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
    expect(system.content).toContain('proposalActivity');
    expect(system.content).toContain('Do not re-judge satisfaction');
    expect(system.content).toContain('Tool activity alone must not trigger skill consolidation');
    expect(system.content).toContain(
      'Use proposalActivity for unresolved proposal refresh, stale proposal, and duplicate proposal checks',
    );
  });

  /**
   * @example
   * The prompt treats existing proposals as lifecycle state and keeps destructive changes reviewable.
   */
  it('documents proposal lifecycle and mutation safety boundaries', () => {
    const [system] = createAgentSignalNightlyReviewMessages({
      maintenanceSignals: [],
      proposalActivity: { active: [] },
    });

    expect(system.content).toContain(
      'Existing maintenance proposals are state, not fresh evidence',
    );
    expect(system.content).toContain(
      'Refresh a compatible pending proposal instead of creating a duplicate',
    );
    expect(system.content).toContain('Supersede an incompatible pending proposal');
    expect(system.content).toContain(
      'Do not use old proposal content as the only evidence for a mutation',
    );
    expect(system.content).toContain(
      'Broad in-document rewrites can be auto-applied when they preserve resource identity',
    );
    expect(system.content).toContain(
      'value.bodyMarkdown must contain the complete replacement Markdown body',
    );
    expect(system.content).toContain('Structural or destructive changes must become proposals');
    expect(system.content).toContain(
      'Use safe write tools for mutations; every write tool performs freshness and idempotency checks',
    );
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
