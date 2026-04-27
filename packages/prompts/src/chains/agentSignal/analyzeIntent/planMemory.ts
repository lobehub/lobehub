import type { ChatStreamPayload } from '@lobechat/types';

import {
  AGENT_SIGNAL_ANALYZE_INTENT_PLAN_MEMORY_SYSTEM_ROLE,
  createAgentSignalAnalyzeIntentPlanMemoryPrompt,
} from '../../../prompts';

/**
 * Builds the prompt chain for Agent Signal user-feedback memory planning.
 *
 * Use when:
 * - A caller needs a reusable `{ system, user }` contract for memory-lane planning
 *
 * Expects:
 * - `message` is one normalized feedback message already routed to the memory lane
 *
 * Returns:
 * - A two-message chat payload for the plan-memory step
 */
export const chainAgentSignalAnalyzeIntentPlanMemory = (
  message: string,
): Partial<ChatStreamPayload> => {
  return {
    messages: [
      {
        content: AGENT_SIGNAL_ANALYZE_INTENT_PLAN_MEMORY_SYSTEM_ROLE,
        role: 'system',
      },
      {
        content: createAgentSignalAnalyzeIntentPlanMemoryPrompt(message),
        role: 'user',
      },
    ],
  };
};
