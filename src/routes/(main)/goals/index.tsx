'use client';

import { memo, useEffect } from 'react';

import GoalSkeleton from '@/components/Skeleton/Goal';
import { AgentGoalsPage } from '@/features/AgentGoals';
import { useAgentLabGate } from '@/features/AgentGoals/useAgentLabGate';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/** Every agent's goals in one list, the goal counterpart of the global `/tasks`. */
const GoalsRoute = memo(() => {
  const navigate = useWorkspaceAwareNavigate();
  const { enabled, initFailed, isPreferenceInit, shouldRedirect } = useAgentLabGate();

  useEffect(() => {
    if (shouldRedirect) navigate('/', { replace: true });
  }, [navigate, shouldRedirect]);

  // Same gate as the agent-scoped route: hold the skeleton until the lab
  // preference settles instead of flashing an empty pane or redirecting early.
  if (!isPreferenceInit && !initFailed) return <GoalSkeleton />;
  if (!enabled) return null;

  return <AgentGoalsPage />;
});

export default GoalsRoute;
