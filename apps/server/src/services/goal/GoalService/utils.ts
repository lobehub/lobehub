import type { GoalItem } from '@lobechat/types';
import debug from 'debug';

/** Ends a person reached, or the coordinator's verdict of success: nothing reopens these but `resume`. */
export const GOAL_ENDED_STATUSES = new Set<string>(['achieved', 'canceled']);

/** Why a decomposition did or did not become a batch: DEBUG=lobe-server:goal-rollout. */
export const log = debug('lobe-server:goal-rollout');

/** Who does the goal's Tasks: its dedicated executor, else the goal agent itself. */
export const goalTaskAgentId = (goal: Pick<GoalItem, 'agentId' | 'config'>) =>
  goal.config?.taskAgentId ?? goal.agentId ?? undefined;
