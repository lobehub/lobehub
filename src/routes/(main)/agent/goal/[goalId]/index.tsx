'use client';

import { memo } from 'react';
import { Navigate, useParams } from 'react-router';

import { GoalDetailPage } from '@/features/AgentGoals';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const GoalDetailRoute = memo(() => {
  const { aid, goalId } = useParams<{ aid?: string; goalId?: string }>();
  const enabled = useUserStore(labPreferSelectors.enableTopicAcceptance);

  if (!aid || !goalId) return null;
  if (!enabled) return <Navigate replace to={`/agent/${aid}`} />;

  return <GoalDetailPage agentId={aid} goalId={goalId} />;
});

export default GoalDetailRoute;
