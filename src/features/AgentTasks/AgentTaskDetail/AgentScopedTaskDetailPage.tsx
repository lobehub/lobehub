'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AgentTaskManager from '@/features/AgentTaskManager';
import MobilePortal from '@/features/Portal/Mobile';
import { useIsMobile } from '@/hooks/useIsMobile';

import TaskDetailPage from './TaskDetailPage';

interface AgentScopedTaskDetailPageProps {
  agentId?: string;
  taskId: string;
}

const AgentScopedTaskDetailPage = memo<AgentScopedTaskDetailPageProps>(({ agentId, taskId }) => {
  const isMobile = useIsMobile();

  return (
    <Flexbox horizontal flex={1} height={'100%'} style={{ minHeight: 0 }} width={'100%'}>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <TaskDetailPage showTaskAgentPanelToggle={!isMobile} taskId={taskId} />
      </Flexbox>
      {isMobile ? (
        <MobilePortal />
      ) : (
        <AgentTaskManager preferredAgentId={agentId} viewedTaskId={taskId} />
      )}
    </Flexbox>
  );
});

AgentScopedTaskDetailPage.displayName = 'AgentScopedTaskDetailPage';

export default AgentScopedTaskDetailPage;
