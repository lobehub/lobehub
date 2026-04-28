'use client';

import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import { useScenarioEnabledTools } from '@/hooks/useScenarioEnabledTools';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const AllTasksLayout = memo(() => {
  useScenarioEnabledTools(TaskIdentifier);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const { enableAgentTask } = useServerConfigStore(featureFlagsSelectors);

  if (serverConfigInit && !enableAgentTask) {
    return <Navigate replace to="/" />;
  }

  return (
    <Flexbox flex={1} height={'100%'} width={'100%'}>
      <Outlet />
    </Flexbox>
  );
});

AllTasksLayout.displayName = 'AllTasksLayout';

export default AllTasksLayout;
