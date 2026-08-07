'use client';

import { memo, useEffect } from 'react';
import { useParams } from 'react-router';

import { AgentGoalsPage } from '@/features/AgentGoals';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const AgentGoalsRoute = memo(() => {
  const { aid } = useParams<{ aid?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const enabled = useUserStore(labPreferSelectors.enableTopicAcceptance);

  useEffect(() => {
    if (aid && !enabled) navigate(`/agent/${aid}`, { replace: true });
  }, [aid, enabled, navigate]);

  if (!aid) return null;
  if (!enabled) return null;

  return <AgentGoalsPage agentId={aid} />;
});

export default AgentGoalsRoute;
