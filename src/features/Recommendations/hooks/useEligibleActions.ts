import { isDesktop } from '@lobechat/const';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateHeteroAgent } from '@/hooks/useCreateHeteroAgent';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { recommendedActionsRegistry } from '../actions/registry';
import type { ActionContext, RecommendedAction } from '../actions/types';
import { useHeteroDetections } from './useHeteroDetections';

interface EligibleActionsResult {
  actions: (RecommendedAction & { run: () => Promise<void> })[];
  context: ActionContext;
}

export const useEligibleActions = (): EligibleActionsResult => {
  const { t } = useTranslation('home');
  const agents = useHomeStore(homeAgentListSelectors.allAgents);
  const heteroDetections = useHeteroDetections();
  const createHeteroAgent = useCreateHeteroAgent();

  const context = useMemo<ActionContext>(
    () => ({
      agents,
      createHeteroAgent,
      heteroDetections,
      isDesktop,
      t,
    }),
    [agents, createHeteroAgent, heteroDetections, t],
  );

  const actions = useMemo(
    () =>
      recommendedActionsRegistry
        .filter((action) => action.isEligible(context))
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        .map((action) => ({
          ...action,
          run: () => action.execute(context),
        })),
    [context],
  );

  return { actions, context };
};
