'use client';

import { memo, useMemo } from 'react';

import PlanHeaderActions from '@/features/AgentGoals/ProcessControl/BatchPlan/PlanHeaderActions';
import { buildGoalGraphView } from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import { findBatchPlan } from '@/features/AgentGoals/ProcessControl/Graph/batchModel';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';

import PortalHeader from '../components/Header';
import Title from './Title';

/** The shared portal header; a batch's plan adds its version controls on the right. */
const Header = memo<{ onClose?: () => void }>(({ onClose }) => {
  const view = useChatStore(chatPortalSelectors.goalNodeView);
  const snapshot = useGoalStore(goalSelectors.goalGraph(view?.goalId ?? ''));
  const plan = useMemo(() => {
    if (!snapshot || !view) return undefined;
    const graph = buildGoalGraphView(snapshot);
    const found = findBatchPlan(graph, view.nodeId);
    return found && { graph, ...found };
  }, [snapshot, view]);

  return (
    <PortalHeader
      title={<Title />}
      rightExtra={
        plan && <PlanHeaderActions graph={plan.graph} model={plan.model} round={plan.round} />
      }
      onClose={onClose}
    />
  );
});

Header.displayName = 'GoalNodePortalHeader';

export default Header;
