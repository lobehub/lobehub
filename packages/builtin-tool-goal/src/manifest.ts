import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { GoalApiName } from './types';

export const GoalIdentifier = 'lobe-goal';

export const GoalManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Create and immediately start a goal-driven task with an editable acceptance plan. Use this only when the user explicitly starts their request with /goal. The call pauses for confirmation; after approval it creates the underlying task, persists the acceptance criteria, enables bounded automatic repair, and runs the current agent in a separate task topic. Once it succeeds, do not execute or reproduce the work in the current conversation; the live result card is the progress and result entry point.',
      humanIntervention: 'always',
      name: GoalApiName.createGoal,
      parameters: {
        additionalProperties: false,
        properties: {
          criteria: {
            description:
              'Concrete acceptance criteria derived from every explicit user requirement.',
            items: {
              additionalProperties: false,
              properties: {
                description: { type: 'string' },
                instruction: {
                  description: 'Detailed judging instruction. Omit for program checks.',
                  type: 'string',
                },
                onFail: { enum: ['auto_repair', 'manual'], type: 'string' },
                required: { type: 'boolean' },
                title: { type: 'string' },
                verifierConfig: { type: 'object' },
                verifierType: { enum: ['agent', 'llm', 'program'], type: 'string' },
              },
              required: ['title'],
              type: 'object',
            },
            type: 'array',
          },
          instruction: { description: 'Detailed task direction and constraints.', type: 'string' },
          maxIterations: {
            description:
              'Maximum automatic execution/repair rounds. Default 3, minimum 2. Null means no user-specified cap.',
            type: ['number', 'null'],
          },
          maxTotalCost: {
            description: 'Optional total USD budget. Null means no user-specified cap.',
            type: ['number', 'null'],
          },
          name: { description: 'Short goal title.', type: 'string' },
        },
        required: ['name', 'instruction', 'criteria'],
        type: 'object',
      },
      renderDisplayControl: 'expand',
    },
  ],
  identifier: GoalIdentifier,
  meta: {
    avatar: '🎯',
    description: 'Plan and start goals with editable acceptance criteria',
    title: 'Goal',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
