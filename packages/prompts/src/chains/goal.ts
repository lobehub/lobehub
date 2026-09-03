import type { OpenAIChatMessage } from '@lobechat/types';

import {
  VERIFY_EVIDENCE_MODALITIES,
  VERIFY_EVIDENCE_SCOPES,
  VERIFY_EVIDENCE_TYPES,
  VERIFY_ON_FAIL_ACTIONS,
  VERIFY_VERIFIER_TYPES,
} from './verify';

/** Bump when the create-goal criteria drafting prompt meaningfully changes. */
export const GOAL_CRITERIA_DRAFT_PROMPT_VERSION = 'v3';

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
      instruction: { minLength: 1, type: 'string' },
      title: { maxLength: 80, minLength: 1, type: 'string' },
    },
    required: ['title', 'instruction', 'criteria'],
    type: 'object' as const,
  },
  strict: true,
};

/** Bump when the goal decomposition planning prompt meaningfully changes. */
export const GOAL_DECOMPOSE_PROMPT_VERSION = 'v3';

export const GOAL_DECOMPOSE_JSON_SCHEMA = {
  name: 'goal_decomposition',
  schema: {
    additionalProperties: false,
    properties: {
      problemStatement: { maxLength: 280, minLength: 1, type: 'string' },
      tasks: {
        items: {
          additionalProperties: false,
          properties: {
            dependsOn: { items: { minimum: 0, type: 'integer' }, type: 'array' },
            instruction: { minLength: 1, type: 'string' },
            title: { maxLength: 80, minLength: 1, type: 'string' },
          },
          required: ['title', 'instruction', 'dependsOn'],
          type: 'object',
        },
        maxItems: 5,
        minItems: 1,
        type: 'array',
      },
    },
    required: ['problemStatement', 'tasks'],
    type: 'object' as const,
  },
  strict: true,
};

interface GoalDecomposeInput {
  requirement: string;
}

/**
 * Plan the opening exploration structure of a goal graph: the core question it
 * answers plus the independent task directions to pursue, before anything runs.
 */
export const chainGoalDecompose = ({
  requirement,
}: GoalDecomposeInput): {
  messages: OpenAIChatMessage[];
} => ({
  messages: [
    {
      content: [
        'You plan the opening exploration structure for a persistent autonomous goal.',
        'Decompose the goal into the core question it must answer and the independent task directions that together answer it.',
        'Guidelines:',
        '- problemStatement is 1–2 sentences naming the core question or outcome of the goal, in your own words. Never copy the acceptance-criteria list into it.',
        '- Return 1–5 tasks. A complex goal (analysis, research, multi-stage delivery) must be split into several directions that can be explored independently or in sequence — e.g. gather the raw material, analyze it from distinct angles, then synthesize. A genuinely small single-step goal may stay as one task.',
        '- Each task.title names its direction concisely; titles must be distinct from each other and from the goal name.',
        '- Each task.instruction is a complete, self-contained brief for an autonomous agent working on that direction only: what to do, the concrete deliverable, and how that deliverable will be judged. Include only the requirements relevant to this direction — never paste the full goal acceptance list into every task.',
        '- Preserve every concrete URL, scope, constraint, and numeric threshold from the goal in whichever task it belongs to.',
        '- Order tasks so that earlier ones produce what later ones consume.',
        '- For each task, set dependsOn to the 0-based indices of the earlier tasks whose outputs it consumes; use [] for a task that can start immediately. A pipeline-shaped goal (gather → analyze → synthesize) must express those edges — do not mark every task independent — but never invent a dependency the task does not actually need.',
        '- Write all fields in the language used by the goal.',
      ].join('\n'),
      role: 'system',
    },
    { content: `## Goal\n${requirement}`, role: 'user' },
  ],
});

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
        '- title is a concise goal name, not a copy of the full request.',
        '- The top-level instruction is a complete, actionable task brief for the autonomous agent. Preserve every concrete URL, scope, constraint, and requested outcome from the user.',
        `- Return at most ${maxCriteria} criteria. Prefer fewer independent criteria that together define success.`,
        '- Describe outcomes and delivered artifacts, not implementation steps or one particular execution plan.',
        '- Criteria must remain valid across multiple attempts. Do not mention the current round, temporary progress, or how the agent should work.',
        '- Preserve every explicit numeric threshold, comparison operator, unit, time window, and stopping condition from the user exactly; never weaken or omit them.',
        '- When the user did not provide a numeric threshold, do not invent an arbitrary one. Define a measurable, domain-appropriate success condition from the stated outcome and make any assumption explicit for user review.',
        '- Never use unit tests, test suites, coverage, type-checks, lint, or a clean build as user-facing acceptance criteria.',
        '- List the evidence needed to judge each criterion. Use [] only when the final text answer alone is sufficient.',
        '- Use verifierType="agent" when judging requires active investigation, opening files, or multiple evidence types; use "llm" only for inline text or a directly inspectable image; use "program" only for deterministic command checks.',
        '- Set required=true when failure means the goal has not been achieved.',
        '- Set onFail="auto_repair" when another autonomous iteration can address the failure; otherwise use "manual".',
        '- Each criteria[].description is a one-sentence summary. Each criteria[].instruction is the exact, detailed judging rubric, including pass conditions, failure conditions, evidence, and important edge cases.',
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
