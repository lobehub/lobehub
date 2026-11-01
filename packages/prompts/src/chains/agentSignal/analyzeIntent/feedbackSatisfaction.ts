import {
  AGENT_SIGNAL_ANALYZE_INTENT_FEEDBACK_SATISFACTION_SYSTEM_ROLE,
  createAgentSignalAnalyzeIntentFeedbackSatisfactionPrompt,
} from '../../../prompts';

/**
 * Builds the prompt chain for Agent Signal feedback-satisfaction judging.
 *
 * Use when:
 * - A caller needs a reusable `{ system, user }` contract for satisfaction-only analysis
 *
 * Expects:
 * - `message` is one normalized feedback message
 * - `serializedContext` is the optional serialized execution context for the same feedback event
 *
 * Returns:
 * - A two-message chat payload for the satisfaction step
 */
export const AGENT_SIGNAL_FEEDBACK_SATISFACTION_PROMPT_VERSION = 'v1';

export const AGENT_SIGNAL_FEEDBACK_SATISFACTION_JSON_SCHEMA = {
  name: 'agent_signal_feedback_satisfaction',
  schema: {
    additionalProperties: false,
    properties: {
      confidence: { maximum: 1, minimum: 0, type: 'number' },
      evidence: {
        items: {
          additionalProperties: false,
          properties: {
            cue: { type: 'string' },
            excerpt: { type: 'string' },
          },
          required: ['cue', 'excerpt'],
          type: 'object',
        },
        type: 'array',
      },
      reason: { type: 'string' },
      result: { enum: ['neutral', 'not_satisfied', 'satisfied'], type: 'string' },
    },
    required: ['confidence', 'evidence', 'reason', 'result'],
    type: 'object' as const,
  },
  strict: true,
};

export const chainAgentSignalAnalyzeIntentFeedbackSatisfaction = (input: {
  message: string;
  serializedContext?: string;
}): { messages: Array<{ content: string; role: 'system' | 'user' }> } => {
  return {
    messages: [
      {
        content: AGENT_SIGNAL_ANALYZE_INTENT_FEEDBACK_SATISFACTION_SYSTEM_ROLE,
        role: 'system',
      },
      {
        content: createAgentSignalAnalyzeIntentFeedbackSatisfactionPrompt(input),
        role: 'user',
      },
    ],
  };
};
