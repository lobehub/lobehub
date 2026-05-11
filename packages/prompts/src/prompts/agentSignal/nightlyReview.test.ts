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
      'noop is silent and must not create a Daily Brief or proposal',
    );
    expect(AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE).toContain(
      'Auto-safe memory candidates must be explicit',
    );
    expect(AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE).toContain(
      'A durable_user_preference signal means',
    );
    expect(AGENT_SIGNAL_NIGHTLY_REVIEW_SYSTEM_ROLE).toContain(
      'Consolidation must be proposed with a frozen consolidate_skill operation',
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
      'Use proposalActivity for unresolved proposal refresh, stale proposal, duplicate proposal checks',
    );
  });

  /**
   * @example
   * expect(prompt).toContain('write tools')
   */
  it('instructs nightly maintenance to use tools as the only mutation boundary', () => {
    const prompt = createAgentSignalNightlyReviewMessages({ maintenanceSignals: [] })
      .map((message) => message.content)
      .join('\n');

    expect(prompt).toContain('Mutations only count through write tools');
    expect(prompt).toContain(
      'this structured review may only emit candidate write actions for the server maintenance runtime',
    );
    expect(prompt).toContain(
      'Never infer intent with regexp, keyword lists, or hard-coded content heuristics',
    );
    expect(prompt).toContain('refine_skill requires complete replacement bodyMarkdown');
    expect(prompt).toContain('do not emit patch-only');
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
    expect(system.content).toContain('Proposal only: structural/destructive changes');
    expect(system.content).toContain(
      'Plan only mutations that can be routed through safe write tools',
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
