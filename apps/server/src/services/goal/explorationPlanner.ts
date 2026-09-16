import { TRACING_SCENARIOS } from '@lobechat/const';
import type { GoalExploreInput } from '@lobechat/prompts';
import {
  chainGoalExplore,
  GOAL_EXPLORE_JSON_SCHEMA,
  GOAL_EXPLORE_PROMPT_VERSION,
} from '@lobechat/prompts';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { resolveGoalModelConfig } from './modelConfig';

const planSchema = z
  .object({
    action: z.enum(['expand', 'revise', 'verify']),
    parentNodeId: z.string(),
    title: z.string().max(80),
    instruction: z.string().max(12000),
    reason: z.string().min(1).max(4000),
  })
  .superRefine((plan, ctx) => {
    if (
      plan.action === 'expand' &&
      (!plan.parentNodeId || !plan.title.trim() || !plan.instruction.trim())
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'An expansion requires a parent, title and instruction',
      });
    }
    // A revision reuses its parent's container and title, so only the corrected
    // protocol and the experiment it corrects are mandatory.
    if (plan.action === 'revise' && (!plan.parentNodeId || !plan.instruction.trim())) {
      ctx.addIssue({
        code: 'custom',
        message: 'A revision requires the experiment it corrects and a corrected instruction',
      });
    }
  });

export type GoalExplorationPlan = z.infer<typeof planSchema>;

export class GoalExplorationPlanner {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  async plan(input: GoalExploreInput): Promise<GoalExplorationPlan> {
    const model = await resolveGoalModelConfig(this.db, this.userId);
    const result = await new AiGenerationService(
      this.db,
      this.userId,
      this.workspaceId,
    ).generateObject(
      {
        ...chainGoalExplore(input),
        ...model,
        schema: GOAL_EXPLORE_JSON_SCHEMA,
        thinking: { type: 'disabled' },
      },
      {
        tracing: {
          scenario: TRACING_SCENARIOS.GoalExplore,
          promptVersion: GOAL_EXPLORE_PROMPT_VERSION,
          schemaName: GOAL_EXPLORE_JSON_SCHEMA.name,
        },
      },
    );
    return planSchema.parse(result);
  }
}
