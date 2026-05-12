import type { BuiltinToolManifest } from '@lobechat/types';

import { SELF_FEEDBACK_INTENT_API_NAME, SELF_FEEDBACK_INTENT_IDENTIFIER } from './types';

/**
 * Self-iteration intent builtin tool manifest.
 *
 * Use when:
 * - A running agent may declare advisory self-feedback intent
 * - The runtime must expose a source-event boundary without direct resource mutation
 *
 * Expects:
 * - Downstream handlers own all memory and skill review or mutation decisions
 *
 * Returns:
 * - A manifest that can be registered as a hidden builtin tool
 */
export const selfFeedbackIntentManifest = {
  api: [
    {
      description:
        'Declare advisory self-feedback intent for future review. This only records intent and does not mutate memory or skills.',
      name: SELF_FEEDBACK_INTENT_API_NAME,
      parameters: {
        additionalProperties: false,
        properties: {
          action: {
            description: 'Self-iteration action the agent believes may be useful.',
            enum: ['write', 'create', 'refine', 'consolidate', 'proposal'],
            type: 'string',
          },
          kind: {
            description: 'Self-iteration target category for the declaration.',
            enum: ['memory', 'skill', 'gap'],
            type: 'string',
          },
          confidence: {
            description: 'Agent confidence from 0 to 1.',
            maximum: 1,
            minimum: 0,
            type: 'number',
          },
          summary: {
            description: 'Short summary of the self-feedback intent.',
            type: 'string',
          },
          reason: {
            description: 'Rationale for why this self-feedback intent may be useful.',
            type: 'string',
          },
          evidenceRefs: {
            description: 'Optional references that justify the declaration.',
            items: {
              additionalProperties: false,
              properties: {
                id: { description: 'Stable evidence identifier.', type: 'string' },
                type: {
                  description: 'Evidence object type.',
                  enum: ['message', 'tool_call', 'receipt', 'document', 'custom'],
                  type: 'string',
                },
              },
              required: ['id', 'type'],
              type: 'object',
            },
            type: 'array',
          },
          memoryId: {
            description: 'Existing memory id when the declaration targets a known memory.',
            type: 'string',
          },
          skillId: {
            description: 'Existing skill id when the declaration targets a known skill.',
            type: 'string',
          },
        },
        required: ['action', 'kind', 'confidence', 'summary', 'reason'],
        type: 'object',
      },
    },
  ],
  identifier: SELF_FEEDBACK_INTENT_IDENTIFIER,
  meta: {
    description:
      'Let a running agent declare advisory self-feedback intent without mutating memory or skills directly.',
    title: 'Self Feedback Intent',
  },
  systemRole:
    'Declare advisory self-feedback intent only when future self-review may improve memory or skills. This tool records intent and must not claim that it directly mutates resources.',
  type: 'builtin',
} as const satisfies BuiltinToolManifest;
