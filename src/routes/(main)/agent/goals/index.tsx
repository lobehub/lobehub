'use client';

import { memo } from 'react';
import { useParams } from 'react-router';

import { AgentGoalsPage } from '@/features/AgentGoals';

const AgentGoalsRoute = memo(() => {
  const { aid } = useParams<{ aid?: string }>();
  if (!aid) return null;

  return <AgentGoalsPage agentId={aid} />;
});

export default AgentGoalsRoute;
