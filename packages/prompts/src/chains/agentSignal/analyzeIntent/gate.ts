import type { ChatStreamPayload } from '@lobechat/types';

import {
  AGENT_SIGNAL_ANALYZE_INTENT_GATE_SYSTEM_ROLE,
  createAgentSignalAnalyzeIntentGatePrompt,
} from '../../../prompts';

/**
 * Builds the prompt chain for Agent Signal user-feedback gate decisions.
 *
 * Use when:
 * - A caller needs a reusable `{ system, user }` contract for gate-level filtering
 *
 * Expects:
 * - `message` is one normalized feedback message
 *
 * Returns:
 * - A two-message chat payload for the gate step
 */
export const chainAgentSignalAnalyzeIntentGate = (message: string): Partial<ChatStreamPayload> => {
  return {
    messages: [
      {
        content: AGENT_SIGNAL_ANALYZE_INTENT_GATE_SYSTEM_ROLE,
        role: 'system',
      },
      {
        content: createAgentSignalAnalyzeIntentGatePrompt(message),
        role: 'user',
      },
    ],
  };
};
