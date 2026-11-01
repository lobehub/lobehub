import { useMemo } from 'react';

import {
  buildNorthStarCards,
  type NorthStarCard,
  type NorthStarTaskRef,
} from '@/features/AgentGoals/NorthStarMetrics/northStar';
import { buildGoalGraphView } from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import { goalSelectors, useGoalStore } from '@/store/goal';

/**
 * One declared clause of a goal joined with its measured series — the same
 * derivation the goal page's card renders, so the panel and the card it was
 * opened from can never disagree about the number.
 */
export const useNorthStarCard = (goalId: string, metricKey: string) => {
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId));
  const useFetchGoalMetricSeries = useGoalStore((s) => s.useFetchGoalMetricSeries);
  const series = useGoalStore(goalSelectors.goalMetricSeries(goalId));

  const criterion = snapshot?.goal.config?.acceptance?.metrics?.find(
    (item) => item.key === metricKey,
  );
  const { error, isLoading, mutate } = useFetchGoalMetricSeries(criterion ? goalId : undefined);
  const matched = series?.find((item) => item.key === metricKey);

  const card = useMemo<NorthStarCard | undefined>(
    () => (criterion ? buildNorthStarCards([criterion], series ?? [])[0] : undefined),
    [criterion, series],
  );

  // Finished task nodes, so each observation can name the work it measures.
  const nodes = snapshot?.nodes;
  const tasks = useMemo<NorthStarTaskRef[]>(
    () =>
      (nodes ?? []).flatMap((node) =>
        node.kind === 'task' && node.status === 'resolved' && node.resolvedAt
          ? [{ id: node.id, resolvedAt: new Date(node.resolvedAt), title: node.title }]
          : [],
      ),
    [nodes],
  );

  // The graph view routes a task link the way the map does (see `useGoalNodeSelect`).
  const graph = useMemo(() => (snapshot ? buildGoalGraphView(snapshot) : undefined), [snapshot]);

  return {
    card,
    criterion,
    error,
    graph,
    isLoading: !series && isLoading,
    loaded: !!snapshot,
    points: matched?.points ?? [],
    retry: () => void mutate(),
    tasks,
  };
};
