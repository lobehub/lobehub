'use client';

import { memo, useMemo } from 'react';

import ExplorationGraph from '@/features/AgentGoals/ProcessControl/Graph/ExplorationGraph';

import { sharedGoalToGraphView } from './sharedGoalGraph';
import type { SharedGoalData } from './sharedGoalTypes';

const noop = () => {};

/**
 * The exploration map with the report's mainline on. A visitor can fold
 * experiments, switch the map's view and filter node kinds; there is no node
 * drill-down, because the product behind it is not theirs to open.
 */
const SharedGoalGraph = memo<{ view: SharedGoalData }>(({ view }) => {
  const graph = useMemo(() => sharedGoalToGraphView(view), [view]);

  return <ExplorationGraph initialShowMainline graph={graph} onSelect={noop} />;
});

SharedGoalGraph.displayName = 'SharedGoalGraph';

export default SharedGoalGraph;
