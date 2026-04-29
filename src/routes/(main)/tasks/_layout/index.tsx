'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import AgentTaskManager from '@/features/AgentTaskManager';
import { useIsMobile } from '@/hooks/useIsMobile';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const AllTasksLayout = memo(() => {
  const isMobile = useIsMobile();
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const { enableAgentTask } = useServerConfigStore(featureFlagsSelectors);

  if (serverConfigInit && !enableAgentTask) {
    return <Navigate replace to="/" />;
  }

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
