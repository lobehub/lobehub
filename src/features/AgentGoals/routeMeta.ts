import { TargetIcon } from 'lucide-react';

import GoalSkeleton from '@/components/Skeleton/Goal';
import GoalDetailSkeleton from '@/components/Skeleton/GoalDetail';
import { routeMeta } from '@/spa/router/routeMeta';

export const goalsRouteMeta = routeMeta({
  icon: TargetIcon,
  Skeleton: GoalSkeleton,
  titleKey: 'navigation.goals',
});

export const goalDetailRouteMeta = routeMeta({
  icon: TargetIcon,
  Skeleton: GoalDetailSkeleton,
  titleKey: 'navigation.goals',
});
