'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Outlet } from 'react-router-dom';

import AgentTaskManager from '@/features/AgentTaskManager';
import { useIsMobile } from '@/hooks/useIsMobile';

const AllTasksLayout = memo(() => {
  const isMobile = useIsMobile();

  return (
    <Flexbox flex={1} height={'100%'} horizontal={!isMobile} width={'100%'}>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <Outlet />
      </Flexbox>
      {!isMobile && <AgentTaskManager />}
    </Flexbox>
  );
});

AllTasksLayout.displayName = 'AllTasksLayout';

export default AllTasksLayout;
