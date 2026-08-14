'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router';

import AgentTaskManager from '@/features/AgentTaskManager';
import { TaskDetailPage } from '@/features/AgentTasks';
import MobilePortal from '@/features/Portal/Mobile';
import { useIsMobile } from '@/hooks/useIsMobile';

const AgentTaskDetailRoute = memo(() => {
  const isMobile = useIsMobile();
  const { aid, taskId } = useParams<{ aid?: string; taskId?: string }>();

  if (!taskId) return null;

  return (
    <Flexbox horizontal flex={1} height={'100%'} style={{ minHeight: 0 }} width={'100%'}>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <TaskDetailPage showTaskAgentPanelToggle={!isMobile} taskId={taskId} />
      </Flexbox>
      {isMobile ? <MobilePortal /> : <AgentTaskManager preferredAgentId={aid} />}
    </Flexbox>
  );
});

export default AgentTaskDetailRoute;
