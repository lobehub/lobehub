import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import {
  SELF_FEEDBACK_INTENT_ACTIONS,
  SELF_FEEDBACK_INTENT_EVIDENCE_REF_TYPES,
  SELF_FEEDBACK_INTENT_IDENTIFIER,
  SELF_FEEDBACK_INTENT_KINDS,
  SelfFeedbackIntentApiName,
} from './types';

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
        'Declare advisory self-feedback intent for future review whenever the running agent finds a concrete, reusable improvement opportunity. Use this proactively for memory, skill, or system gap feedback; it only records intent and does not mutate memory or skills.',
      name: SelfFeedbackIntentApiName.declareSelfFeedbackIntent,
      parameters: {
        additionalProperties: false,
        properties: {
          action: {
            description:
              'Self-iteration action the agent believes may be useful. Use write for memory, create/refine/consolidate for skills, and proposal for system or workflow gaps.',
            enum: [...SELF_FEEDBACK_INTENT_ACTIONS],
            type: 'string',
          },
          kind: {
            description:
              'Self-iteration target category: memory for durable user signals, skill for reusable procedures or capabilities, gap for product/runtime/tooling/policy feedback.',
            enum: [...SELF_FEEDBACK_INTENT_KINDS],
            type: 'string',
          },
          confidence: {
            description:
              'Agent confidence from 0 to 1 that this declaration is worth downstream review. Prefer >=0.75 for well-grounded evidence and 0.45-0.74 for plausible but review-needed feedback.',
            maximum: 1,
            minimum: 0,
            type: 'number',
          },
          summary: {
            description:
              'Short, actionable summary of the self-feedback intent. Name the target and desired improvement.',
            type: 'string',
          },
          reason: {
            description:
              'Rationale explaining the triggering evidence, why it matters, and the expected future benefit.',
            type: 'string',
          },
          evidenceRefs: {
            description:
              'Optional stable references that justify the declaration. Prefer concrete message, tool_call, operation, topic, receipt, task, agent_document, or memory refs.',
            items: {
              additionalProperties: false,
              properties: {
                id: { description: 'Stable evidence identifier.', type: 'string' },
                summary: {
                  description: 'Optional short note explaining why this evidence matters.',
                  type: 'string',
                },
                type: {
                  description: 'Evidence object type.',
                  enum: [...SELF_FEEDBACK_INTENT_EVIDENCE_REF_TYPES],
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
  executors: ['server'],
  identifier: SELF_FEEDBACK_INTENT_IDENTIFIER,
  meta: {
    description:
      'Let a running agent proactively declare advisory self-feedback intent without mutating memory or skills directly.',
    title: 'Self Feedback Intent',
  },
  systemRole: systemPrompt,
  type: 'builtin',
} as const satisfies BuiltinToolManifest;
