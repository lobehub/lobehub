'use client';

import { GoalDetailPage } from '@/features/AgentGoals';
import { useParams } from '@/libs/router/navigation';

/**
 * Goal detail without an agent in the path, mirroring the bare `/task/:taskId`
 * route. A goal created from a project page has no responsible agent, so this
 * is the only way to open one.
 */
const GoalDetailRoute = () => {
  const { goalId } = useParams<{ goalId?: string }>('goalId');

  if (!goalId) return null;

  return <GoalDetailPage goalId={goalId} />;
};

export default GoalDetailRoute;
