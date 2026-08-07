'use client';

import { memo } from 'react';
import { Navigate, useParams } from 'react-router';

import { AgentGoalsPage } from '@/features/AgentGoals';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const AgentGoalsRoute = memo(() => {
  const { aid } = useParams<{ aid?: string }>();
  const enabled = useUserStore(labPreferSelectors.enableTopicAcceptance);

  if (!aid) return null;
  if (!enabled) return <Navigate replace to={`/agent/${aid}`} />;

  return <AgentGoalsPage agentId={aid} />;
});

export default AgentGoalsRoute;
