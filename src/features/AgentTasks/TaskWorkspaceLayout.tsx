'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Outlet } from 'react-router';

import AgentTaskManager from '@/features/AgentTaskManager';
import MobilePortal from '@/features/Portal/Mobile';
import { useIsMobile } from '@/hooks/useIsMobile';

const TaskWorkspaceLayout = memo(() => {
  const isMobile = useIsMobile();

  return (
    <Flexbox flex={1} height={'100%'} horizontal={!isMobile} width={'100%'}>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <Outlet />
      </Flexbox>
      {isMobile ? <MobilePortal /> : <AgentTaskManager />}
    </Flexbox>
  );
});

TaskWorkspaceLayout.displayName = 'TaskWorkspaceLayout';

export default TaskWorkspaceLayout;
