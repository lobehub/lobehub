import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import TaskAcceptance from './TaskAcceptance';
import TaskActivities from './TaskActivities';
import TaskArtifacts from './TaskArtifacts';
import { taskDetailLayoutStyles as styles } from './taskDetailLayoutStyles';
import TaskDetailTitleInput from './TaskDetailTitleInput';
import TaskFusePauseNotice from './TaskFusePauseNotice';
import TaskGoalBar from './TaskGoalBar';
import TaskInstruction from './TaskInstruction';
import TaskParentBar from './TaskParentBar';
import TaskProperties from './TaskProperties';
import TaskStatusStrip from './TaskStatusStrip';
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
      <div className={styles.grid}>
        <Flexbox className={styles.main} gap={12}>
          <div className={styles.meta}>
            <TaskGoalBar />
            <TaskParentBar />
          </div>
          <TaskDetailTitleInput />
          <TaskStatusStrip />
          <TaskFusePauseNotice />
        </Flexbox>
        <div className={styles.side}>
          <TaskProperties />
        </div>
        <Flexbox className={styles.body} gap={24}>
          <TaskInstruction />
          <TaskAcceptance />
          <TaskSubtasks />
          <TaskArtifacts />
          <TaskActivities />
        </Flexbox>
      </div>
    </div>
  );
});

export default TaskDetailSections;
