'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router';

import { TaskDetailPage } from '@/features/AgentTasks';
import ChatPortal from '@/routes/(main)/agent/features/Portal';

const AgentTaskDetailRoute = memo(() => {
  const { taskId } = useParams<{ taskId?: string }>();

  if (!taskId) return null;

  return (
    <Flexbox horizontal flex={1} height={'100%'} style={{ minHeight: 0 }} width={'100%'}>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <TaskDetailPage showTaskAgentPanelToggle={false} taskId={taskId} />
      </Flexbox>
      {/* Task detail opens acceptance checks in the portal. This route sits
        beside the (chat) subtree that normally mounts one, so without its own
        host every check click pushed a view nothing rendered — a dead click. */}
      <ChatPortal />
    </Flexbox>
  );
});

export default AgentTaskDetailRoute;
