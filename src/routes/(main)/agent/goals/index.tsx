'use client';

import { memo, useEffect } from 'react';
import { useParams } from 'react-router';

import GoalSkeleton from '@/components/Skeleton/Goal';
import { AgentGoalsPage } from '@/features/AgentGoals';
import { useAgentLabGate } from '@/features/AgentGoals/useAgentLabGate';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

const AgentGoalsRoute = memo(() => {
  const { aid } = useParams<{ aid?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const { enabled, initFailed, isPreferenceInit, shouldRedirect } = useAgentLabGate();

  useEffect(() => {
    if (aid && shouldRedirect) navigate(`/agent/${aid}`, { replace: true });
  }, [aid, navigate, shouldRedirect]);

  if (!aid) return null;
  // Preference still loading: the gate cannot be judged yet, so hold the page
  // skeleton instead of painting nothing (the white flash) or redirecting.
  // A failed user-state init keeps the legacy escape: fall through to the
  // redirect below rather than an endless skeleton.
  if (!isPreferenceInit && !initFailed) return <GoalSkeleton />;
  if (!enabled) return null;

  return <AgentGoalsPage agentId={aid} />;
});

export default AgentGoalsRoute;
