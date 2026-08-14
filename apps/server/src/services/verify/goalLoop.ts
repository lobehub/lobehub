import type { BriefAction, TaskContext, TaskGoalConfig, TaskItem } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';
import { TaskRunnerService } from '@/server/services/taskRunner';

import { resolveGoalRoundBudget } from './goalBudget';

const log = debug('lobe-server:verify-goal-loop');

export { DEFAULT_GOAL_MAX_ROUNDS, resolveGoalRoundBudget } from './goalBudget';

export type GoalLoopOutcome = 'continued' | 'exhausted-cost' | 'exhausted-rounds' | 'spawn-failed';

/**
 * The goal outer loop: after a goal task's verify run settles as failed, spawn
 * the next round (a fresh task topic) unless a budget ran out. Never throws —
 * a spawn failure degrades to the caller's pause-and-notify path.
 *
 * The check-level auto-repair inner loop (same-topic re-run in repairService)
 * has already been exhausted by the time a run settles as failed, so this is
 * strictly the round-level loop.
 */
export const maybeContinueGoalLoop = async (params: {
  db: LobeChatDatabase;
  goal: TaskGoalConfig;
  task: TaskItem;
  userId: string;
  workspaceId?: string;
}): Promise<GoalLoopOutcome> => {
  const { db, goal, task, userId, workspaceId } = params;

  const roundsRun = task.totalTopics || 0;
  const roundBudget = resolveGoalRoundBudget(goal);
  if (roundsRun >= roundBudget) {
    log('task %s exhausted round budget (%d/%s)', task.identifier, roundsRun, roundBudget);
    return 'exhausted-rounds';
  }

  if (typeof goal.maxTotalCost === 'number') {
    const spent = await new AgentOperationModel(db, userId, workspaceId).sumCostByTask(task.id);
    if (spent >= goal.maxTotalCost) {
      log('task %s exhausted cost budget ($%d >= $%d)', task.identifier, spent, goal.maxTotalCost);
      return 'exhausted-cost';
    }
  }

  try {
    await new TaskRunnerService(db, userId, workspaceId).runTask({
      taskId: task.id,
      trigger: 'goal',
    });
    log('task %s → goal round %d spawned', task.identifier, roundsRun + 1);
    return 'continued';
  } catch (error) {
    // CONFLICT (a topic is still running) or any spawn failure — the caller
    // falls back to pause + brief so the loop can never crash the settle path.
    log('task %s goal round spawn failed (non-fatal): %O', task.identifier, error);
    return 'spawn-failed';
  }
};

/** User-facing copy for the pause brief when a budget ran out. */
export const goalExhaustedBriefCopy = (
  task: TaskItem,
  outcome: Extract<GoalLoopOutcome, 'exhausted-cost' | 'exhausted-rounds'>,
  goal: TaskGoalConfig,
): { summary: string; title: string } =>
  outcome === 'exhausted-cost'
    ? {
        summary: `The goal did not pass verification and its cost budget ($${goal.maxTotalCost}) is used up. Adjust the plan or budget to restart the loop.`,
        title: `${task.identifier} goal paused — cost budget exhausted`,
      }
    : {
        summary: `The goal did not pass verification after ${task.totalTopics || 0} rounds (budget ${resolveGoalRoundBudget(goal)}). Adjust the plan or budget to restart the loop.`,
        title: `${task.identifier} goal paused — round budget exhausted`,
      };

/**
 * User-facing copy for the one brief a converged goal SHOULD raise: the loop is
 * done iterating and the delivery is waiting on the user's sign-off.
 *
 * Per-round result briefs are suppressed for goal tasks (see
 * `TaskLifecycleService.onTopicComplete`), so this is the moment the user is
 * pulled back in — not once per round.
 */
export const goalReadyForReviewBriefCopy = (
  task: TaskItem,
  acceptanceId?: string,
): { actions: BriefAction[]; summary: string; title: string } => ({
  // A `decision` brief, not a `result` one, for two reasons: `result` briefs are
  // filed unconditionally under "news" (nothing to do), and their approve button
  // completes the task outright — which would bypass the very sign-off this
  // change exists to require. The only action offered is a link to the
  // acceptance page, so the button promises exactly what it does.
  actions: acceptanceId
    ? [
        {
          key: 'review',
          label: 'Review delivery',
          type: 'link',
          url: `/acceptance/${acceptanceId}`,
        },
      ]
    : [],
  summary: `The goal passed verification after ${task.totalTopics || 1} round(s) and is waiting for your sign-off. Review the checks, then accept or send it back.`,
  title: `${task.identifier} goal delivered — ready for your review`,
});

/**
 * Push the goal's latest phase onto the `createGoal` tool card in the origin
 * conversation, keyed by the toolCallId recorded at creation time. Best-effort:
 * a missing origin (task created outside a conversation) or a missing card is
 * a silent no-op, and failures never propagate into the settle path.
 */
export const syncGoalToolState = async (params: {
  db: LobeChatDatabase;
  state: {
    phase: 'done' | 'paused' | 'review' | 'running';
    roundBudget?: number | null;
    roundsRun?: number;
  } & Record<string, unknown>;
  task: TaskItem;
  userId: string;
  workspaceId?: string;
}): Promise<void> => {
  const { db, state, task, userId, workspaceId } = params;
  const toolCallId = (task.context as TaskContext | undefined)?.origin?.toolCallId;
  if (!toolCallId) return;

  try {
    const messageModel = new MessageModel(db, userId, workspaceId);
    const toolMessageId = await messageModel.findToolMessageIdByToolCallId(toolCallId);
    if (!toolMessageId) return;

    await messageModel.updateToolMessage(toolMessageId, {
      pluginState: { goalPhase: state.phase, ...state, updatedAt: new Date().toISOString() },
    });
  } catch (error) {
    log('goal tool-state sync failed for task %s (non-fatal): %O', task.identifier, error);
  }
};
