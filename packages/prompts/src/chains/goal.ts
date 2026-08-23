import type { OpenAIChatMessage } from '@lobechat/types';

import {
  VERIFY_EVIDENCE_MODALITIES,
  VERIFY_EVIDENCE_SCOPES,
  VERIFY_EVIDENCE_TYPES,
  VERIFY_ON_FAIL_ACTIONS,
  VERIFY_VERIFIER_TYPES,
} from './verify';

/** Bump when the create-goal criteria drafting prompt meaningfully changes. */
export const GOAL_CRITERIA_DRAFT_PROMPT_VERSION = 'v1';

export const GOAL_CRITERIA_DRAFT_JSON_SCHEMA = {
  name: 'goal_criteria_draft',
  schema: {
    additionalProperties: false,
    properties: {
      criteria: {
        items: {
          additionalProperties: false,
          properties: {
            description: { maxLength: 280, type: 'string' },
            instruction: { type: 'string' },
            onFail: { enum: [...VERIFY_ON_FAIL_ACTIONS], type: 'string' },
            requiredEvidence: {
              items: {
                additionalProperties: false,
                properties: {
                  hint: { type: 'string' },
                  modality: { enum: [...VERIFY_EVIDENCE_MODALITIES], type: 'string' },
                  scope: { enum: [...VERIFY_EVIDENCE_SCOPES], type: 'string' },
                  type: { enum: [...VERIFY_EVIDENCE_TYPES], type: 'string' },
                },
                required: ['type', 'modality', 'scope', 'hint'],
                type: 'object',
              },
              type: 'array',
            },
            required: { type: 'boolean' },
            title: { maxLength: 80, minLength: 1, type: 'string' },
            verifierType: { enum: [...VERIFY_VERIFIER_TYPES], type: 'string' },
          },
          required: [
            'title',
            'description',
            'instruction',
            'verifierType',
            'required',
            'onFail',
            'requiredEvidence',
          ],
          type: 'object',
        },
        maxItems: 8,
        type: 'array',
      },
    },
    required: ['criteria'],
    type: 'object' as const,
  },
  strict: true,
};

interface GoalCriteriaDraftInput {
  context?: string;
  goal: string;
  maxCriteria: number;
}

/** Draft the standing acceptance contract shown during goal creation. */
export const chainGoalCriteriaDraft = ({
  context,
  goal,
  maxCriteria,
}: GoalCriteriaDraftInput): { messages: OpenAIChatMessage[] } => ({
  messages: [
    {
      content: [
        'You define the standing acceptance contract for a persistent autonomous goal.',
        'Turn the goal into a concise set of durable, user-reviewable pass/fail criteria that can be applied after every iteration.',
        'Guidelines:',
        `- Return at most ${maxCriteria} criteria. Prefer fewer independent criteria that together define success.`,
        '- Describe outcomes and delivered artifacts, not implementation steps or one particular execution plan.',
        '- Criteria must remain valid across multiple attempts. Do not mention the current round, temporary progress, or how the agent should work.',
        '- Never use unit tests, test suites, coverage, type-checks, lint, or a clean build as user-facing acceptance criteria.',
        '- List the evidence needed to judge each criterion. Use [] only when the final text answer alone is sufficient.',
        '- Use verifierType="agent" when judging requires active investigation, opening files, or multiple evidence types; use "llm" only for inline text or a directly inspectable image; use "program" only for deterministic command checks.',
        '- Set required=true when failure means the goal has not been achieved.',
        '- Set onFail="auto_repair" when another autonomous iteration can address the failure; otherwise use "manual".',
        '- description is a one-sentence summary. instruction is the exact, detailed judging rubric, including pass conditions, failure conditions, evidence, and important edge cases.',
        '- Write all human-facing fields in the language used by the goal.',
      ].join('\n'),
      role: 'system',
    },
    {
      content: [`## Goal\n${goal}`, context ? `\n## Context\n${context}` : '']
        .filter(Boolean)
        .join('\n'),
      role: 'user',
    },
  ],
});
