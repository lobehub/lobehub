'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Outlet } from 'react-router';

import AgentTaskManager from '@/features/AgentTaskManager';
import MobilePortal from '@/features/Portal/Mobile';
import { WorkspaceSidePanelProvider } from '@/features/RightPanel/WorkspaceSidePanel';
import { useIsMobile } from '@/hooks/useIsMobile';

const TaskWorkspaceLayout = memo(() => {
  const isMobile = useIsMobile();

  // This layout owns the side panel: the task manager or the mobile portal is
  // the one host for every route under it, so the routed page must not mount a
  // second one (see WorkspaceSidePanel).
  return (
    <WorkspaceSidePanelProvider>
      <Flexbox flex={1} height={'100%'} horizontal={!isMobile} width={'100%'}>
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <Outlet />
        </Flexbox>
        {isMobile ? <MobilePortal /> : <AgentTaskManager />}
      </Flexbox>
    </WorkspaceSidePanelProvider>
  );
});

TaskWorkspaceLayout.displayName = 'TaskWorkspaceLayout';

export default TaskWorkspaceLayout;
