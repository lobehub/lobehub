import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import Loading from '@/components/Loading/BrandTextLoading';
import { TaskDetailSections, TopicChatDrawer, useActiveTaskDetail } from '@/features/AgentTasks';
import DocumentPreviewModal from '@/features/DocumentModal/Preview';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Body = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useChatStore(chatPortalSelectors.taskDetailId);
  // Same data wiring as the full /task/[tid] page — owns activeTaskId + polling
  // fetch so the shared section components resolve to this task.
  const { isInitialLoading, isNotFound, error, onRetry } = useActiveTaskDetail(taskId);

  if (!taskId) return null;

  // A transient fetch failure keeps the URL and offers Reload — distinct from a
  // resolved not-found (deleted task), which is a terminal 404.
  if (error) {
    return (
      <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflowY: 'auto' }}>
        <AsyncError error={error} variant={'page'} onRetry={onRetry} />
      </Flexbox>
    );
  }

  if (isNotFound) {
    return (
      <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflowY: 'auto' }}>
        <NotFound desc={t('taskDetail.notFound.desc')} title={t('taskDetail.notFound.title')} />
      </Flexbox>
    );
  }

  return (
    <Flexbox
      flex={1}
      height={'100%'}
      paddingInline={16}
      style={{ minHeight: 0, overflowY: 'auto' }}
    >
      {isInitialLoading ? <Loading debugId="PortalTaskDetail" /> : <TaskDetailSections />}
      <TopicChatDrawer />
      <DocumentPreviewModal />
    </Flexbox>
  );
});

export default Body;
