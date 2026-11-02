import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

import { AgentModel } from '@/database/models/agent';
import { GoalService } from '@/server/services/goal';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';

import { quickNoteGoalPayloadSchema } from './schemas';
import type { QuickNoteProposalExecutor } from './types';
import { QuickNoteApplyError } from './types';

/**
 * `goal` Proposals: create a Goal through the Goal service and queue its first advance.
 *
 * The Goal is supervised by the user's Inbox agent: a Goal agent runs planning turns with the Goal
 * tools, which the Quick Note analyzer does not mount.
 */
export const goalExecutor: QuickNoteProposalExecutor<'goal'> = {
  execute: async (ctx, payload) => {
    const inbox = await new AgentModel(ctx.db, ctx.userId, ctx.workspaceId).getBuiltinAgent(
      BUILTIN_AGENT_SLUGS.inbox,
    );
    if (!inbox) throw new QuickNoteApplyError('not_found', 'Inbox agent is not available');

    const graph = await new GoalService(ctx.db, ctx.userId, ctx.workspaceId).create({
      agentId: inbox.id,
      problemDescription: payload.problemDescription,
      requirement: payload.requirement,
      title: payload.title,
    });
    const goalId = graph.goal.id;

    return {
      // Same kickoff as `goal.create`: the coordinator advances it without a client loop.
      afterCommit: () =>
        scheduleGoalAdvance({
          goalId,
          trigger: 'create',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }),
      resultId: goalId,
      resultType: 'goal',
    };
  },
  kind: 'goal',
  schema: quickNoteGoalPayloadSchema,
};
