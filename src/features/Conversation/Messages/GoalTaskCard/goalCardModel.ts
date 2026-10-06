import type { GoalStatus } from '@lobechat/const/goal';
import type { GoalGraphSnapshot } from '@lobechat/types';

import { coordinatorNodeTitleKey } from '@/features/AgentGoals/ProcessControl/coordinatorCopy';
import {
  buildGoalGraphView,
  type GoalNodeView,
} from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';

/** The goal's big stages, read left to right on the card. */
export const GOAL_CARD_STAGES = ['planning', 'executing', 'verifying', 'achieved'] as const;

export type GoalCardStage = (typeof GOAL_CARD_STAGES)[number];

/** How the current stage is doing — a stopped goal keeps its stage but changes color. */
export type GoalCardTone = 'active' | 'canceled' | 'error' | 'paused' | 'waiting';

export type PlanStepState =
  | 'done'
  | 'failed'
  | 'lost'
  | 'queued'
  | 'retired'
  | 'running'
  | 'stopped'
  | 'verifying'
  | 'waiting';

export interface PlanStep {
  id: string;
  state: PlanStepState;
  title: string;
  /** Locale key for a coordinator-authored fixed title (the terminal acceptance task). */
  titleKey?: string;
}

export interface GoalCardModel {
  findingCount: number;
  /** Steps folded after the visible window. */
  hiddenAfter: number;
  /** Steps folded before the visible window. */
  hiddenBefore: number;
  needsYou: number;
  stage: GoalCardStage;
  /** The visible window of the plan, in the order the tasks were planned. */
  steps: PlanStep[];
  taskDone: number;
  taskTotal: number;
  tone: GoalCardTone;
  totalCost: number;
}

const CLOSED_NODE_STATUSES = new Set(['resolved', 'rejected', 'retired']);
const CLOSED_STEP_STATES = new Set<PlanStepState>(['done', 'failed', 'retired']);

/** Same vocabulary as the goal map's task chips, reduced to what a chip can show. */
export const planStepState = (view: GoalNodeView): PlanStepState => {
  const { status } = view.node;
  if (status === 'resolved') return 'done';
  if (status === 'rejected') return 'failed';
  if (status === 'retired') return 'retired';
  // The goal closed under this run: it was interrupted, not still going.
  if (view.halted) return 'stopped';
  if (view.decision) return 'waiting';
  if (status === 'active') {
    if (view.isVerifying) return 'verifying';
    if (view.isStale) return 'lost';
    return 'running';
  }
  if (status === 'waiting' || view.blockers.length > 0) return 'waiting';
  return 'queued';
};

const resolveStage = (
  status: GoalStatus,
  taskTotal: number,
  allTasksClosed: boolean,
): GoalCardStage => {
  switch (status) {
    case 'achieved': {
      return 'achieved';
    }
    case 'review':
    case 'verifying': {
      return 'verifying';
    }
    case 'planning': {
      return 'planning';
    }
  }
  // A `/goal` run marks its goal running at creation, before the plan lands a Task.
  if (taskTotal === 0) return 'planning';
  // A goal that stopped after its tasks closed stopped at acceptance, not execution.
  return allTasksClosed && status !== 'running' ? 'verifying' : 'executing';
};

const resolveTone = (status: GoalStatus, needsYou: number): GoalCardTone => {
  if (status === 'canceled') return 'canceled';
  if (status === 'failed') return 'error';
  // A decision gate outranks pause: it is the reason the goal is not moving.
  if (needsYou > 0) return 'waiting';
  if (status === 'paused') return 'paused';
  return 'active';
};

/**
 * Keep the chain readable at any plan size: show a window that starts one step
 * before the first unfinished task, so the card always shows what just closed,
 * what is moving, and what comes next.
 */
export const windowPlanSteps = (steps: PlanStep[], maxSteps: number) => {
  if (steps.length <= maxSteps) return { hiddenAfter: 0, hiddenBefore: 0, visible: steps };

  const firstOpen = steps.findIndex((step) => !CLOSED_STEP_STATES.has(step.state));
  const focus = firstOpen === -1 ? steps.length - 1 : firstOpen;
  const start = Math.min(Math.max(focus - 1, 0), steps.length - maxSteps);

  return {
    hiddenAfter: steps.length - start - maxSteps,
    hiddenBefore: start,
    visible: steps.slice(start, start + maxSteps),
  };
};

/** Everything the conversation card shows about a goal, from one graph snapshot. */
export const buildGoalCardModel = (
  snapshot: GoalGraphSnapshot,
  { maxSteps = 4, now = Date.now() }: { maxSteps?: number; now?: number } = {},
): GoalCardModel => {
  const view = buildGoalGraphView(snapshot, now);
  const tasks = view.nodes.filter((item) => item.node.kind === 'task');
  const taskDone = tasks.filter((item) => CLOSED_NODE_STATUSES.has(item.node.status)).length;
  const needsYou = snapshot.decisions.filter((decision) => decision.status === 'pending').length;

  const { hiddenAfter, hiddenBefore, visible } = windowPlanSteps(
    tasks.map((item) => ({
      id: item.node.id,
      state: planStepState(item),
      title: item.node.title,
      titleKey: coordinatorNodeTitleKey(item),
    })),
    maxSteps,
  );

  return {
    findingCount: view.findings.length,
    hiddenAfter,
    hiddenBefore,
    needsYou,
    stage: resolveStage(snapshot.goal.status, tasks.length, taskDone === tasks.length),
    steps: visible,
    taskDone,
    taskTotal: tasks.length,
    tone: resolveTone(snapshot.goal.status, needsYou),
    totalCost: snapshot.spend?.totalCost ?? 0,
  };
};
