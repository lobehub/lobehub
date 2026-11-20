'use client';

import { EditorProvider } from '@lobehub/editor/react';
import { memo, type PropsWithChildren } from 'react';

import { PlanVersionProvider } from '@/features/AgentGoals/ProcessControl/BatchPlan/planVersion';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

/**
 * Shares what a node's header picks with its body — a plan's version — and
 * starts over for every node opened.
 */
const Wrapper = memo<PropsWithChildren>(({ children }) => {
  const view = useChatStore(chatPortalSelectors.goalNodeView);
  return (
    <EditorProvider>
      <PlanVersionProvider key={view?.nodeId}>{children}</PlanVersionProvider>
    </EditorProvider>
  );
});

Wrapper.displayName = 'GoalNodePortalWrapper';

export default Wrapper;
