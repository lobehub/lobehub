import { Button, Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import Loading from '@/components/Loading/BrandTextLoading';
import DocumentPreviewModal from '@/features/DocumentModal/Preview';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import Breadcrumb from '../shared/Breadcrumb';
import TaskDetailHeaderActions from './TaskDetailHeaderActions';
import TaskDetailSections from './TaskDetailSections';
import TopicChatDrawer from './TopicChatDrawer';
import { useActiveTaskDetail } from './useActiveTaskDetail';

interface TaskDetailPageProps {
  showTaskAgentPanelToggle?: boolean;
  taskId: string;
}

const TaskDetailPage = memo<TaskDetailPageProps>(({ taskId, showTaskAgentPanelToggle = true }) => {
  const { t } = useTranslation('chat');
  const saveStatus = useTaskStore(taskDetailSelectors.taskSaveStatus);
  const [showTaskAgentPanel, toggleTaskAgentPanel] = useGlobalStore((s) => [
    systemStatusSelectors.showTaskAgentPanel(s),
    s.toggleTaskAgentPanel,
  ]);

  const { isInitialLoading, isNotFound, error, onRetry } = useActiveTaskDetail(taskId);

  // A transient fetch failure (network / 500) is not a 404 — keep the URL and
  // offer Reload instead of the terminal "task was deleted" dead-end below.
  if (error) {
    return (
      <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, position: 'relative' }}>
        <NavHeader
          left={<Breadcrumb taskId={taskId} />}
          styles={{ left: { paddingLeft: 4, gap: 8 } }}
        />
        <Flexbox flex={1} style={{ minHeight: 0, overflowY: 'auto' }}>
          <AsyncError error={error} variant={'page'} onRetry={onRetry} />
        </Flexbox>
      </Flexbox>
    );
  }

  if (isNotFound) {
    return (
      <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, position: 'relative' }}>
        <NavHeader
          left={<Breadcrumb taskId={taskId} />}
          styles={{ left: { paddingLeft: 4, gap: 8 } }}
        />
        <Flexbox flex={1} style={{ minHeight: 0, overflowY: 'auto' }}>
          <NotFound
            desc={t('taskDetail.notFound.desc')}
            title={t('taskDetail.notFound.title')}
            extra={
              <Link to={'/tasks'}>
                <Button type={'primary'}>{t('taskDetail.notFound.backToTasks')}</Button>
              </Link>
            }
          />
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, position: 'relative' }}>
      <NavHeader
        left={
          <>
            <Breadcrumb taskId={taskId} />
            <TaskDetailHeaderActions />
            {saveStatus === 'saving' ? <AutoSaveHint saveStatus={saveStatus} /> : undefined}
          </>
        }
        right={
          showTaskAgentPanelToggle ? (
            <ToggleRightPanelButton
              hideWhenExpanded
              expand={showTaskAgentPanel}
              onToggle={() => toggleTaskAgentPanel()}
            />
          ) : undefined
        }
        styles={{
          left: {
            paddingLeft: 4,
            gap: 8,
          },
        }}
      />
      <Flexbox flex={1} style={{ minHeight: 0, overflowY: 'auto' }}>
        <WideScreenContainer>
          {isInitialLoading ? <Loading debugId="TaskDetail" /> : <TaskDetailSections />}
        </WideScreenContainer>
      </Flexbox>
      <TopicChatDrawer />
      <DocumentPreviewModal />
    </Flexbox>
  );
});

export default TaskDetailPage;
