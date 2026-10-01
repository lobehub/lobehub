import { useMemo } from 'react';

import {
  deriveOperationGoals,
  type OperationGoal,
} from '@/features/Conversation/Messages/GoalTaskCard/deriveOperationGoals';
import {
  getGoalTaskProgress,
  type GoalTaskPhase,
} from '@/features/Conversation/Messages/GoalTaskCard/goalTaskProgress';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { goalSelectors, useGoalStore } from '@/store/goal';

import { isGoalRequestGenerating } from '../../ChatInput/LinkedGoalTray/linkedGoals';
import { useAgentContext } from '../../useAgentContext';
import {
  buildWorkflowRows,
  type GoalWorkflowRow,
  type GoalWorkflowSummary,
  mergeTopicGoals,
  summarizeWorkflow,
} from './goalWorkflowView';

/**
 * Every Goal a conversation created — the sidebar shows one card per goal.
 * Message-derived goals are merged with the goal rows linked to the topic, so a
 * goal a CLI agent created without a parseable tool result still gets a card.
 */
export const useTopicOperationGoals = (): OperationGoal[] => {
  const context = useAgentContext();
  const chatKey = messageMapKey(context);
  const dbMessages = useChatStore((s) => s.dbMessagesMap[chatKey]);
  // Discover a goal the in-flight `/goal` run is creating, like the composer tray.
  const goalRequestGenerating = useChatStore((s) =>
    isGoalRequestGenerating(
      s.dbMessagesMap[chatKey],
      operationSelectors.isAgentRuntimeRunningByContext(context)(s),
    ),
  );
  const useFetchTopicGoals = useGoalStore((s) => s.useFetchTopicGoals);
  const { data } = useFetchTopicGoals(context.topicId, goalRequestGenerating);

  return useMemo(
    () => mergeTopicGoals(deriveOperationGoals(dbMessages ?? []), data?.goals),
    [dbMessages, data],
  );
};

export interface GoalWorkflowView {
  /** The graph request failed before any snapshot arrived. */
  error?: unknown;
  goalId: string;
  /** No snapshot yet and the first graph request is in flight. */
  loading?: boolean;
  pendingDecisions: number;
  phase: GoalTaskPhase;
  /** Re-request the graph after a failure. */
  retry?: () => void;
  rows: GoalWorkflowRow[];
  startedAt?: Date | null;
  summary: GoalWorkflowSummary;
  title?: string;
}

/**
 * One goal's live workflow view for the sidebar card: the graph snapshot →
 * lifecycle phase, ordered task rows (with their assignees) and open decision
 * gates. The card only holds the goal id, so everything is fetched here,
 * polling while the coordinator advances the graph.
 */
export const useGoalWorkflow = (goal: OperationGoal): GoalWorkflowView => {
  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  const { error, isLoading, mutate } = useFetchGoalGraph(goal.goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(goal.goalId));

  const taskNodes = snapshot?.nodes.filter((node) => node.kind === 'task') ?? [];
  // The graph numbers Tasks in creation order; the workflow rows must read the same.
  const orderedTaskNodes = [...taskNodes].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const progress = getGoalTaskProgress({
    criteriaCount: goal.criteriaCount,
    pendingDecisions:
      snapshot?.decisions.filter((decision) => decision.status === 'pending').length ?? 0,
    status: snapshot?.goal.status,
    taskDone: taskNodes.filter((node) => ['rejected', 'resolved', 'retired'].includes(node.status))
      .length,
    taskTotal: taskNodes.length,
  });
  const rows = buildWorkflowRows(orderedTaskNodes, snapshot?.assignees);

  return {
    // Like the Goal portal: only a missing snapshot turns into loading / error,
    // so a failed background poll keeps showing the last known graph.
    error: snapshot ? undefined : error,
    goalId: goal.goalId,
    loading: !snapshot && !error && isLoading,
    pendingDecisions:
      snapshot?.decisions.filter((decision) => decision.status === 'pending').length ?? 0,
    phase: progress.phase,
    retry: () => void mutate(),
    rows,
    startedAt: snapshot?.goal.startedAt,
    summary: summarizeWorkflow(rows),
    title: snapshot?.goal.title ?? goal.name,
  };
};
