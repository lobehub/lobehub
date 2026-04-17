'use client';

import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Outlet } from 'react-router-dom';

import { useScenarioEnabledTools } from '@/hooks/useScenarioEnabledTools';

/**
 * Layout for the cross-agent `/tasks` page. Full-width single column — no
 * right-side chat panel like `/agent/:aid/tasks/_layout` has, because this view
 * is not scoped to any single agent.
 */
const AllTasksLayout = memo(() => {
  useScenarioEnabledTools(TaskIdentifier);

  return (
    <Flexbox flex={1} height={'100%'} width={'100%'}>
      <Outlet />
    </Flexbox>
  );
});

AllTasksLayout.displayName = 'AllTasksLayout';

export default AllTasksLayout;
