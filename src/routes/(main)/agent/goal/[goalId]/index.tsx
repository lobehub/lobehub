'use client';

import { memo, useEffect } from 'react';
import { useParams } from 'react-router';

import { GoalDetailPage } from '@/features/AgentGoals';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const GoalDetailRoute = memo(() => {
  const { aid, goalId } = useParams<{ aid?: string; goalId?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const enabled = useUserStore(labPreferSelectors.enableTopicAcceptance);

  useEffect(() => {
    if (aid && !enabled) navigate(`/agent/${aid}`, { replace: true });
  }, [aid, enabled, navigate]);

  if (!aid || !goalId) return null;
  if (!enabled) return null;

  return <GoalDetailPage agentId={aid} goalId={goalId} />;
});

export default GoalDetailRoute;
