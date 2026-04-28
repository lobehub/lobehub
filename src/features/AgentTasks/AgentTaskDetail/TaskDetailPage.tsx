import { Flexbox } from '@lobehub/ui';
import { memo, useEffect } from 'react';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import Breadcrumb from '../shared/Breadcrumb';
import PageModal from './PageModal';
import TaskActivities from './TaskActivities';
import TaskArtifacts from './TaskArtifacts';
import TaskDetailAssignee from './TaskDetailAssignee';
import TaskDetailHeaderActions from './TaskDetailHeaderActions';
import TaskDetailRunPauseAction from './TaskDetailRunPauseAction';
import TaskDetailTitleInput from './TaskDetailTitleInput';
import TaskInstruction from './TaskInstruction';
import TaskModelConfig from './TaskModelConfig';
import TaskParentBar from './TaskParentBar';
import TaskProperties from './TaskProperties';
import TaskSubtasks from './TaskSubtasks';
import TopicChatDrawer from './TopicChatDrawer';

interface TaskDetailPageProps {
  agentId?: string;
  taskId: string;
}

const TaskDetailPage = memo<TaskDetailPageProps>(({ agentId, taskId }) => {
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const useFetchTaskDetail = useTaskStore((s) => s.useFetchTaskDetail);
  const isLoading = useTaskStore(taskDetailSelectors.isTaskDetailLoading);
  const saveStatus = useTaskStore(taskDetailSelectors.taskSaveStatus);

  const [showTaskAgentPanel, toggleTaskAgentPanel] = useGlobalStore((s) => [
    systemStatusSelectors.showTaskAgentPanel(s),
    s.toggleTaskAgentPanel,
  ]);

  useEffect(() => {
    setActiveTaskId(taskId);
    return () => setActiveTaskId(undefined);
  }, [taskId, setActiveTaskId]);

  // Sync the task's assignee agent into chat store so the right-side
  // AgentTaskManager conversation knows which agent to talk to.
  useEffect(() => {
    if (!agentId) return;
    useChatStore.setState({ activeAgentId: agentId }, false, 'TaskDetailPage/syncAgentId');
    return () => {
      const current = useChatStore.getState().activeAgentId;
      if (current === agentId) {
        useChatStore.setState({ activeAgentId: undefined }, false, 'TaskDetailPage/clearAgentId');
      }
    };
  }, [agentId]);

  useFetchTaskDetail(taskId);

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0 }}>
      <NavHeader
        left={
          <>
            <Breadcrumb taskId={taskId} />
            <TaskDetailHeaderActions />
            {saveStatus === 'saving' ? <AutoSaveHint saveStatus={saveStatus} /> : undefined}
          </>
        }
        right={
          <ToggleRightPanelButton
            hideWhenExpanded
            expand={showTaskAgentPanel}
            onToggle={() => toggleTaskAgentPanel()}
          />
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
          {isLoading ? (
            <Loading debugId="TaskDetail" />
          ) : (
            <>
              <Flexbox gap={4} style={{ paddingBlock: '24px 36px' }}>
                <TaskDetailTitleInput />
                <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'}>
                  <Flexbox align={'flex-start'} flex={1} gap={16}>
                    <TaskParentBar />
                    <Flexbox horizontal align={'center'} gap={8}>
                      <TaskDetailAssignee />
                      <TaskModelConfig />
                    </Flexbox>
                    <TaskDetailRunPauseAction />
                  </Flexbox>
                  <TaskProperties />
                </Flexbox>
              </Flexbox>
              <Flexbox gap={24} style={{ paddingBottom: 120 }}>
                <TaskInstruction />
                <TaskSubtasks />
                <TaskArtifacts />
                <TaskActivities />
              </Flexbox>
            </>
          )}
        </WideScreenContainer>
      </Flexbox>
      <TopicChatDrawer />
      <PageModal />
    </Flexbox>
  );
});

export default TaskDetailPage;
