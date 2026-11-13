import type { BriefItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { GoalService } from '@/server/services/goal';
import { GoalBriefService } from '@/server/services/goal/goalBriefs';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';

import { resolveAcceptanceForWrite } from '../acceptance';
import { dispatchAcceptanceRepair } from './acceptanceRepairDispatch';

type GoalBriefContext = Parameters<typeof dispatchAcceptanceRepair>[0] & {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
};

/** Actions that only move the brief itself, never the goal behind it. */
const PASSIVE_ACTIONS = new Set(['ignore', 'openGoal', 'read']);

/**
 * Answer a goal brief from the inbox the same way the goal page would: a gate
 * option is a `decide`, a sign-off is the Goal-level acceptance's accept or
 * reject. The brief is settled by that write — the goal is the state, the
 * brief only carried the question — so the caller re-reads it afterwards.
 *
 * Returns whether the action was a goal action.
 */
export const applyGoalBriefAction = async (
  ctx: GoalBriefContext,
  brief: BriefItem,
  action?: string,
  comment?: string,
): Promise<boolean> => {
  const goal = brief.metadata?.goal;
  if (!goal || !action || PASSIVE_ACTIONS.has(action)) return false;
  const workspaceId = ctx.workspaceId ?? undefined;

  if (goal.kind === 'decision' && goal.decisionId) {
    await new GoalService(ctx.serverDB, ctx.userId, workspaceId).decide(
      goal.goalId,
      goal.decisionId,
      action,
      comment?.trim() || undefined,
    );
    await scheduleGoalAdvance({
      goalId: goal.goalId,
      trigger: 'decide',
      userId: ctx.userId,
      workspaceId,
    });
    return true;
  }

  if (goal.kind === 'signOff' && goal.signOffAcceptanceId) {
    const { acceptance, service } = await resolveAcceptanceForWrite(ctx, goal.signOffAcceptanceId);
    if (action === 'signOff') {
      await service.accept(acceptance.id, comment?.trim() || undefined);
    } else if (action === 'requestChanges') {
      await service.reject(acceptance.id, comment?.trim() || undefined);
      await dispatchAcceptanceRepair(ctx, service, acceptance, comment?.trim() || undefined);
    } else {
      return false;
    }
    await new GoalBriefService(ctx.serverDB, ctx.userId, workspaceId).settleSignOff(
      acceptance.id,
      action,
      comment,
    );
    return true;
  }

  return false;
};
