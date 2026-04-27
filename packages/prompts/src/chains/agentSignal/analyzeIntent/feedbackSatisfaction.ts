import type { ChatStreamPayload } from '@lobechat/types';

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
export const chainAgentSignalAnalyzeIntentFeedbackSatisfaction = (input: {
  message: string;
  serializedContext?: string;
}): Partial<ChatStreamPayload> => {
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
