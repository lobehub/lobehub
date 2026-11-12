import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { ActionIcon, Button, Flexbox } from '@lobehub/ui';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import Breadcrumb from '../shared/Breadcrumb';
import TaskDetailCopyActions from './TaskDetailCopyActions';
import TaskDetailHeaderActions from './TaskDetailHeaderActions';
import { TASK_DETAIL_PAGE_WIDTH } from './taskDetailLayoutStyles';
import TaskDetailSections from './TaskDetailSections';
import TaskDetailSkeleton from './TaskDetailSkeleton';
import { useTaskFindBar } from './TaskFind';
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
  const { bar: findBar, openFind, rootRef: findRootRef } = useTaskFindBar();
  const findHotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.FindInTopic));

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
            {saveStatus === 'saving' || saveStatus === 'failed' ? (
              <AutoSaveHint saveStatus={saveStatus} />
            ) : undefined}
          </>
        }
        right={
          <>
            <ActionIcon
              icon={SearchIcon}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              title={t('taskDetail.find.open')}
              tooltipProps={{ hotkey: findHotkey, placement: 'bottom' }}
              onClick={openFind}
            />
            <TaskDetailCopyActions />
            {showTaskAgentPanelToggle ? (
              <ToggleRightPanelButton
                hideWhenExpanded
                expand={showTaskAgentPanel}
                onToggle={() => toggleTaskAgentPanel()}
              />
            ) : undefined}
          </>
        }
        styles={{
          left: {
            paddingLeft: 4,
            gap: 8,
          },
        }}
      />
      {/* The find bar floats over the detail rather than inside it, so its own
          re-renders never reach the scroll container's match observer. */}
      <Flexbox flex={1} style={{ minHeight: 0, position: 'relative' }}>
        {findBar}
        <Flexbox flex={1} ref={findRootRef} style={{ minHeight: 0, overflowY: 'auto' }}>
          {/* Detail is prose — instruction, deliverables, activity — so it keeps the
              centered reading column rather than the list page's full-bleed rows,
              whose value is the horizontal room for their metadata columns. */}
          <WideScreenContainer minWidth={TASK_DETAIL_PAGE_WIDTH}>
            {isInitialLoading ? <TaskDetailSkeleton chrome={'body'} /> : <TaskDetailSections />}
          </WideScreenContainer>
        </Flexbox>
      </Flexbox>
      {/* The task page has nothing else to read beside a run, so it opens wide. */}
      <TopicChatDrawer defaultExpanded />
    </Flexbox>
  );
});

export default TaskDetailPage;
