import type { ChatStreamPayload } from '@lobechat/types';

import {
  AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE,
  createAgentSignalAnalyzeIntentRoutePrompt,
} from '../../../prompts';

/**
 * Builds the prompt chain for Agent Signal user-feedback domain routing.
 *
 * Use when:
 * - A caller needs a reusable `{ system, user }` contract for domain routing
 *
 * Expects:
 * - `message` is one normalized feedback message
 * - `result`, `reason`, and `evidence` come from the upstream satisfaction stage
 *
 * Returns:
 * - A two-message chat payload for the route step
 */
export const chainAgentSignalAnalyzeIntentRoute = (input: {
  evidence: Array<{
    cue: string;
    excerpt: string;
  }>;
  message: string;
  reason: string;
  result: 'neutral' | 'not_satisfied' | 'satisfied';
}): Partial<ChatStreamPayload> => {
  return {
    messages: [
      {
        content: AGENT_SIGNAL_ANALYZE_INTENT_ROUTE_SYSTEM_ROLE,
        role: 'system',
      },
      {
        content: createAgentSignalAnalyzeIntentRoutePrompt(input),
        role: 'user',
      },
    ],
  };
};
