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
export const AGENT_SIGNAL_FEEDBACK_DOMAIN_PROMPT_VERSION = 'v1';

export const AGENT_SIGNAL_FEEDBACK_DOMAIN_JSON_SCHEMA = {
  name: 'agent_signal_feedback_domain_route',
  schema: {
    additionalProperties: false,
    properties: {
      targets: {
        items: {
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
            target: { enum: ['memory', 'none', 'prompt', 'skill'], type: 'string' },
          },
          required: ['confidence', 'evidence', 'reason', 'target'],
          type: 'object',
        },
        maxItems: 4,
        minItems: 1,
        type: 'array',
      },
    },
    required: ['targets'],
    type: 'object' as const,
  },
  strict: true,
};

export const chainAgentSignalAnalyzeIntentRoute = (input: {
  evidence: Array<{
    cue: string;
    excerpt: string;
  }>;
  message: string;
  reason: string;
  result: 'neutral' | 'not_satisfied' | 'satisfied';
  serializedContext?: string;
}): { messages: Array<{ content: string; role: 'system' | 'user' }> } => {
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
