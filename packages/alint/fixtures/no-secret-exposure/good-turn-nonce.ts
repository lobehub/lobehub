// A planning-turn `token` is a correlation nonce (also the suffix of a visible message
// id) read back by the goal's owner. It authenticates nothing on its own.
import { randomUUID } from 'node:crypto';

import { GoalModel } from './goal';
import type { ManagerContext } from './types';

export const managerTurnToken = (goalId: string) => `${goalId}_${randomUUID()}`;

export const sourceMessageId = (token: string) => `msg_goal_manager_${token}`;

export const planState = async (ctx: ManagerContext, goalId: string) => {
  const goal = await new GoalModel(ctx.db, ctx.userId, ctx.workspaceId).findById(goalId);
  const state = goal?.config?.managerState;

  return {
    goal: goal ? { agentId: goal.agentId, status: goal.status } : null,
    turn: state
      ? {
          consumed: !!state.consumed,
          operationId: state.operationId ?? null,
          startedAt: state.startedAt,
          token: state.token,
          turns: state.turns,
        }
      : null,
  };
};
