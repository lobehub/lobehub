import { Flexbox } from '@lobehub/ui';
import { memo, useEffect } from 'react';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import Breadcrumb from '../shared/Breadcrumb';
import { styles } from '../shared/style';
import TaskActivities from './TaskActivities';
import TaskDetailHeader from './TaskDetailHeader';
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
          <div className={styles.detailLayout}>
            <div className={styles.detailMain}>
              <TaskDetailHeader />
              <TaskParentBar />
              <div style={{ paddingBlock: 8 }}>
                <TaskModelConfig />
              </div>
              <TaskInstruction />
              <TaskSubtasks />
              <TaskActivities />
            </div>
            <TaskProperties />
          </div>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
});

export default TaskDetailPage;
