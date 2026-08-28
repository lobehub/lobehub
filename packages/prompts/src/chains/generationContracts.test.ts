import { describe, expect, it } from 'vitest';

import {
  AGENT_SIGNAL_FEEDBACK_DOMAIN_JSON_SCHEMA,
  AGENT_SIGNAL_FEEDBACK_DOMAIN_PROMPT_VERSION,
  AGENT_SIGNAL_FEEDBACK_SATISFACTION_JSON_SCHEMA,
  AGENT_SIGNAL_FEEDBACK_SATISFACTION_PROMPT_VERSION,
  chainAgentSignalAnalyzeIntentFeedbackSatisfaction,
  chainAgentSignalAnalyzeIntentRoute,
  chainFollowUpAction,
  chainTopicAutoSummary,
  FOLLOW_UP_JSON_SCHEMA,
  FOLLOW_UP_PROMPT_VERSION,
  TOPIC_AUTO_SUMMARY_JSON_SCHEMA,
  TOPIC_AUTO_SUMMARY_PROMPT_VERSION,
} from './index';

describe('application generation chains', () => {
  it('builds the complete topic auto-summary contract', () => {
    const { messages } = chainTopicAutoSummary({
      previousSummary: 'Earlier decision',
      transcript: 'USER: Continue',
    });

    expect(TOPIC_AUTO_SUMMARY_PROMPT_VERSION).toBe('v1');
    expect(TOPIC_AUTO_SUMMARY_JSON_SCHEMA.name).toBe('topic_auto_summary');
    expect(messages[0].content).toContain('Summarize the conversation for future reference');
    expect(messages[1].content).toContain('Previous rolling summary:\nEarlier decision');
    expect(messages[1].content).toContain('Recent conversation:\nUSER: Continue');
  });

  it('adds onboarding policy to the follow-up contract', () => {
    const { messages } = chainFollowUpAction({
      assistantText: 'What should I call you?',
      hint: { kind: 'onboarding', phase: 'agent_identity' },
    });

    expect(FOLLOW_UP_PROMPT_VERSION).toBe('v1.0');
    expect(FOLLOW_UP_JSON_SCHEMA.name).toBe('follow_up_suggestions');
    expect(messages[0].content).toContain('Phase: agent_identity');
    expect(messages[1].content).toContain('What should I call you?');
  });

  it('keeps Agent Signal satisfaction messages, schema, and version together', () => {
    const { messages } = chainAgentSignalAnalyzeIntentFeedbackSatisfaction({
      message: 'This works better.',
      serializedContext: 'topic=review',
    });

    expect(AGENT_SIGNAL_FEEDBACK_SATISFACTION_PROMPT_VERSION).toBe('v1');
    expect(AGENT_SIGNAL_FEEDBACK_SATISFACTION_JSON_SCHEMA.name).toBe(
      'agent_signal_feedback_satisfaction',
    );
    expect(messages[1].content).toContain('This works better.');
  });

  it('keeps Agent Signal domain-routing messages, schema, and version together', () => {
    const { messages } = chainAgentSignalAnalyzeIntentRoute({
      evidence: [{ cue: 'future', excerpt: 'Remember this workflow.' }],
      message: 'Remember this workflow.',
      reason: 'Reusable instruction',
      result: 'satisfied',
    });

    expect(AGENT_SIGNAL_FEEDBACK_DOMAIN_PROMPT_VERSION).toBe('v1');
    expect(AGENT_SIGNAL_FEEDBACK_DOMAIN_JSON_SCHEMA.name).toBe(
      'agent_signal_feedback_domain_route',
    );
    expect(messages[1].content).toContain('Remember this workflow.');
  });
});
