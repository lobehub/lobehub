'use client';

import { memo } from 'react';
import { useParams } from 'react-router';

import { GoalDetailPage } from '@/features/AgentGoals';

const GoalDetailRoute = memo(() => {
  const { aid, goalId } = useParams<{ aid?: string; goalId?: string }>();
  if (!aid || !goalId) return null;

  return <GoalDetailPage agentId={aid} goalId={goalId} />;
});

export default GoalDetailRoute;
