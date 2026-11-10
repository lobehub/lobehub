import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import TaskAcceptance from '@/features/AgentTasks/AgentTaskDetail/TaskAcceptance';
import TaskActivities from '@/features/AgentTasks/AgentTaskDetail/TaskActivities';
import TaskArtifacts from '@/features/AgentTasks/AgentTaskDetail/TaskArtifacts';
import TaskDetailSkeleton from '@/features/AgentTasks/AgentTaskDetail/TaskDetailSkeleton';
import TopicChatDrawer, {
  TopicChatDrawerBody,
} from '@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer';
import { useActiveTaskResult } from '@/features/AgentTasks/AgentTaskDetail/useActiveTaskResult';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { useLiveRun } from './useLiveRun';

const Body = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useChatStore(chatPortalSelectors.taskResultId);
  const { error, isInitialLoading, isNotFound, onRetry } = useActiveTaskResult(taskId);
  const liveRun = useLiveRun();

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

  // While the run is in flight there is no report yet — the thing to read is
  // the run itself. Stream its conversation in place; the task detail polls
  // while the run is live, so the panel turns into the report once it settles.
  if (!isInitialLoading && liveRun)
    return (
      <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
        <TopicChatDrawerBody
          agentId={liveRun.agentId}
          key={liveRun.topicId}
          runningOperation={liveRun.activity.runningOperation}
          topicId={liveRun.topicId}
        />
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
        <TaskDetailSkeleton chrome={'body'} />
      ) : (
        <>
          {/* Report, then the verdict on it, then the artifacts it produced.
              The acceptance used to sit last, so on any report longer than a
              screen the checks — the reason to trust what you just read — were
              off the bottom of the panel and read as missing. */}
          <TaskActivities variant={'result'} />
          <TaskAcceptance variant={'result'} />
          <TaskArtifacts />
        </>
      )}
      <TopicChatDrawer />
    </Flexbox>
  );
});

Body.displayName = 'TaskResultPortalBody';
export default Body;
