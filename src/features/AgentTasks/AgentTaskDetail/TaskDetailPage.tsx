import { Flexbox } from '@lobehub/ui';
import { memo, useEffect } from 'react';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import Breadcrumb from '../shared/Breadcrumb';
import TaskActivities from './TaskActivities';
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
  agentId: string;
  taskId: string;
}

const TaskDetailPage = memo<TaskDetailPageProps>(({ agentId, taskId }) => {
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const useFetchTaskDetail = useTaskStore((s) => s.useFetchTaskDetail);
  const isLoading = useTaskStore(taskDetailSelectors.isTaskDetailLoading);
  const saveStatus = useTaskStore(taskDetailSelectors.taskSaveStatus);

  useEffect(() => {
    setActiveTaskId(taskId);
    return () => setActiveTaskId(undefined);
  }, [taskId, setActiveTaskId]);

  useFetchTaskDetail(taskId);

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0 }}>
      <NavHeader
        right={<ToggleRightPanelButton hideWhenExpanded />}
        left={
          <>
            <Breadcrumb agentId={agentId} taskId={taskId} />
            <TaskDetailHeaderActions />
            {saveStatus === 'saving' ? <AutoSaveHint saveStatus={saveStatus} /> : undefined}
          </>
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
                <TaskActivities />
              </Flexbox>
            </>
          )}
        </WideScreenContainer>
      </Flexbox>
      <TopicChatDrawer />
    </Flexbox>
  );
});

export default TaskDetailPage;
