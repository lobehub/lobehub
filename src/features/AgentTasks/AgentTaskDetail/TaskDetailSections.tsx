import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import TaskAcceptance from './TaskAcceptance';
import TaskActivities from './TaskActivities';
import TaskArtifacts from './TaskArtifacts';
import TaskDetailAssignee from './TaskDetailAssignee';
import { taskDetailLayoutStyles as styles } from './taskDetailLayoutStyles';
import TaskDetailRunPauseAction from './TaskDetailRunPauseAction';
import TaskDetailTitleInput from './TaskDetailTitleInput';
import TaskInstruction from './TaskInstruction';
import TaskModelConfig from './TaskModelConfig';
import TaskParentBar from './TaskParentBar';
import TaskProperties from './TaskProperties';
import TaskSubtasks from './TaskSubtasks';

/**
 * The scrollable body sections of a task detail, shared by the full-page
 * `/task/[tid]` route and the chat-side Portal. All children read the active
 * task from the task store, so the host is responsible for setting
 * `activeTaskId` (e.g. via `setActiveTaskId`) before rendering this.
 */
const TaskDetailSections = memo(() => {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Flexbox className={styles.main} gap={12}>
          <TaskParentBar />
          <TaskDetailTitleInput />
          <Flexbox horizontal align={'center'} gap={8} style={{ maxWidth: '100%' }} wrap={'wrap'}>
            <TaskDetailRunPauseAction />
            <TaskDetailAssignee />
            <TaskModelConfig />
          </Flexbox>
        </Flexbox>
        <div className={styles.side}>
          <TaskProperties />
        </div>
      </div>
      <Flexbox gap={24} style={{ paddingBottom: 120 }}>
        <TaskInstruction />
        <TaskAcceptance />
        <TaskSubtasks />
        <TaskArtifacts />
        <TaskActivities />
      </Flexbox>
    </div>
  );
});

export default TaskDetailSections;
