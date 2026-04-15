import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo, useEffect } from 'react';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import Breadcrumb from '../shared/Breadcrumb';
import TaskActivities from './TaskActivities';
import TaskDetailDeleteAction from './TaskDetailDeleteAction';
import TaskDetailRunPauseAction from './TaskDetailRunPauseAction';
import TaskDetailTitleInput from './TaskDetailTitleInput';
import TaskInstruction from './TaskInstruction';
import TaskModelConfig from './TaskModelConfig';
import TaskParentBar from './TaskParentBar';
import TaskProperties from './TaskProperties';
import TaskSubtasks from './TaskSubtasks';

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
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        right={<TaskDetailDeleteAction />}
        left={
          <>
            <Breadcrumb agentId={agentId} taskId={taskId} />
            {saveStatus !== 'idle' ? <AutoSaveHint saveStatus={saveStatus} /> : undefined}
          </>
        }
        styles={{
          left: {
            paddingLeft: 4,
            gap: 8,
          },
        }}
      />

      <WideScreenContainer>
        {isLoading ? (
          <Loading debugId="TaskDetail" />
        ) : (
          <>
            <Flexbox horizontal gap={16}>
              <Flexbox flex={1}>
                <TaskDetailTitleInput />
                <Flexbox align={'flex-start'} gap={8}>
                  <TaskParentBar />
                  <TaskModelConfig />
                  <TaskDetailRunPauseAction />
                </Flexbox>
              </Flexbox>
              <TaskProperties />
            </Flexbox>
            <Divider />
            <TaskInstruction />
            <TaskSubtasks />
            <TaskActivities />
          </>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
});

export default TaskDetailPage;
