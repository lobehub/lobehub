'use client';

import { useParams } from 'react-router';

import { GoalDetailPage } from '@/features/AgentGoals';

/**
 * Goal detail without an agent in the path, mirroring the bare `/task/:taskId`
 * route. A goal created from a project page has no responsible agent, so this
 * is the only way to open one.
 */
const GoalDetailRoute = () => {
  const { goalId } = useParams<{ goalId?: string }>();

  if (!goalId) return null;

  return <GoalDetailPage goalId={goalId} />;
};

export default GoalDetailRoute;
