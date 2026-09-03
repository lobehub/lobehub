import { TargetIcon } from 'lucide-react';

import GoalSkeleton from '@/components/Skeleton/Goal';
import GoalDetailSkeleton from '@/components/Skeleton/GoalDetail';
import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { routeMeta } from '@/spa/router/routeMeta';
import { goalSelectors, useGoalStore } from '@/store/goal';

export const goalsRouteMeta = routeMeta({
  icon: TargetIcon,
  Skeleton: GoalSkeleton,
  titleKey: 'navigation.goals',
});

const GoalDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const goalId = params.goalId ?? '';
  const title = useGoalStore((s) => {
    const snapshot = goalSelectors.goalGraph(goalId)(s);
    if (snapshot?.goal.title) return snapshot.goal.title;
    // Before the detail page fetches the graph, the agent's goal list (already
    // loaded when the tab was opened from the goals rail) may know the title.
    if (!params.aid) return undefined;
    return goalSelectors
      .goalList(params.aid)(s)
      .find((item) => item.goal.id === goalId)?.goal.title;
  });

  usePublishDynamicRouteMeta({ title: title || undefined }, onResolve);

  return null;
};

export const goalDetailRouteMeta = routeMeta({
  DynamicMeta: GoalDynamicMeta,
  icon: TargetIcon,
  Skeleton: GoalDetailSkeleton,
  titleKey: 'navigation.goals',
});
