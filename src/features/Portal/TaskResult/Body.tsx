import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import TaskAcceptance from '@/features/AgentTasks/AgentTaskDetail/TaskAcceptance';
import TaskActivities from '@/features/AgentTasks/AgentTaskDetail/TaskActivities';
import TaskArtifacts from '@/features/AgentTasks/AgentTaskDetail/TaskArtifacts';
import TaskDetailSkeleton from '@/features/AgentTasks/AgentTaskDetail/TaskDetailSkeleton';
import TopicChatDrawer from '@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer';
import { useActiveTaskResult } from '@/features/AgentTasks/AgentTaskDetail/useActiveTaskResult';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Body = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useChatStore(chatPortalSelectors.taskResultId);
  const { error, isInitialLoading, isNotFound, onRetry } = useActiveTaskResult(taskId);

  if (!taskId) return null;
  if (error)
    return (
      <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflowY: 'auto' }}>
        <AsyncError error={error} variant={'page'} onRetry={onRetry} />
      </Flexbox>
    );
  if (isNotFound)
    return (
      <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflowY: 'auto' }}>
        <NotFound desc={t('taskDetail.notFound.desc')} title={t('taskDetail.notFound.title')} />
      </Flexbox>
    );

  return (
    <Flexbox
      flex={1}
      gap={24}
      height={'100%'}
      paddingBlock={20}
      paddingInline={16}
      style={{ minHeight: 0, overflowY: 'auto' }}
    >
      {isInitialLoading ? (
        <TaskDetailSkeleton />
      ) : (
        <>
          <TaskActivities variant={'result'} />
          <TaskArtifacts />
          <TaskAcceptance />
        </>
      )}
      <TopicChatDrawer />
    </Flexbox>
  );
});

Body.displayName = 'TaskResultPortalBody';
export default Body;
