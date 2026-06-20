import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import TaskActivities from './TaskActivities';
import TaskArtifacts from './TaskArtifacts';
import TaskDetailAssignee from './TaskDetailAssignee';
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
  );
});

export default TaskDetailSections;
