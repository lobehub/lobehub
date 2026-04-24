'use client';

import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import AgentTaskManager from '@/features/AgentTaskManager';
import { useScenarioEnabledTools } from '@/hooks/useScenarioEnabledTools';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const TaskDetailLayout = memo(() => {
  useScenarioEnabledTools(TaskIdentifier);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const { enableAgentTask } = useServerConfigStore(featureFlagsSelectors);

  if (serverConfigInit && !enableAgentTask) {
    return <Navigate replace to="/" />;
  }

  return (
    <Flexbox horizontal flex={1} height={'100%'} width={'100%'}>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <Outlet />
      </Flexbox>
      <AgentTaskManager />
    </Flexbox>
  );
});

TaskDetailLayout.displayName = 'TaskDetailLayout';

export default TaskDetailLayout;
