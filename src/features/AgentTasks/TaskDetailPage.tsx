import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo, useEffect } from 'react';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import Breadcrumb from './Breadcrumb';
import { styles } from './style';
import TaskActivities from './TaskActivities';
import TaskDetailHeader from './TaskDetailHeader';
import TaskInstruction from './TaskInstruction';
import TaskModelConfig from './TaskModelConfig';
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
        left={saveStatus !== 'idle' ? <AutoSaveHint saveStatus={saveStatus} /> : undefined}
      />
      <Breadcrumb agentId={agentId} />
      <div className={styles.container}>
        {isLoading ? (
          <Loading debugId="TaskDetail" />
        ) : (
          <div className={styles.detailContent}>
            <Flexbox style={{ marginBottom: 12 }}>
              <TaskDetailHeader />
              <Flexbox
                horizontal
                align={'center'}
                gap={8}
                justify={'flex-start'}
                style={{ marginBottom: 12 }}
              >
                <TaskModelConfig />
              </Flexbox>
            </Flexbox>
            <Divider style={{ marginBlock: 0 }} />
            <TaskInstruction />
            <TaskSubtasks />
            <TaskActivities />
          </div>
        )}
      </div>
    </Flexbox>
  );
});

export default TaskDetailPage;
